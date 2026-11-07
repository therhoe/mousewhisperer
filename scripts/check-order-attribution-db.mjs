// One paid order converts one row per capture, whichever writer delivers it first.
// Drives the real checkout-pixel route (api.track) and orders/paid webhook route
// against a disposable loopback PostgreSQL only. Never reads DATABASE_URL/.env.
// Run: GROWTH_TEST_DATABASE_URL=postgresql://user@127.0.0.1:PORT/db node --test scripts/check-order-attribution-db.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test, { after } from "node:test";
import ts from "typescript";
import { PrismaClient } from "@prisma/client";

const url = process.env.GROWTH_TEST_DATABASE_URL;
assert.ok(
  url && ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
  "Provide an explicit disposable loopback PostgreSQL database.",
);
const db = new PrismaClient({ datasources: { db: { url } } });
const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const module = { exports: {} };
  const result = ts.transpileModule(
    readFileSync(new URL(file, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    },
  );
  runInNewContext(result.outputText, {
    module,
    exports: module.exports,
    require: (key) => (key in mocks ? mocks[key] : require(key)),
    URL,
    URLSearchParams,
    Date,
    Response,
    Request,
    process,
    console: { log() {}, warn() {}, error: console.error },
  });
  return module.exports;
}

const dbModule = { __esModule: true, default: db };
const orderId = load("../app/utils/order-id.ts");
const orders = load("../app/utils/order-attribution.server.ts", { "./order-id": orderId });
const tracking = load("../app/utils/growth-tracking.server.ts", {
  "../db.server": dbModule,
  "./customer-journey": load("../app/utils/customer-journey.ts"),
});
const cache = {
  cachedValue: async (_key, _ttl, fn) => fn(),
  clearCacheKey() {},
  clearCachePrefix() {},
  loaderCacheKeys: new Proxy({}, { get: () => () => "" }),
};
const store = load("../app/utils/store-snapshot.server.ts", {
  "../db.server": dbModule,
  "./growth-tracking.server": tracking,
  "./loader-cache.server": cache,
  "./notifications.server": { createNotification: async () => {} },
  "./order-attribution.server": orders,
});
const ab = load("../app/utils/ab-tests.server.ts", {
  "../db.server": dbModule,
  "./order-attribution.server": orders,
  "./ab-project-targeting": load("../app/utils/ab-project-targeting.ts"),
  "./ab-test-report": load("../app/utils/ab-test-report.ts"),
  "./click-engagement": load("../app/utils/click-engagement.ts"),
});
// Customer journeys and channel captures have their own order dedupe; not under test.
const customerJourney = {
  recordCustomerCommerce: async () => 0,
  recordCustomerJourney: async () => ({ accepted: true }),
};
const channel = { attributeChannelSnapshotEvent: async () => 0 };
const trackApi = load("../app/routes/api.track.tsx", {
  "../db.server": dbModule,
  "../utils/channel-report": load("../app/utils/channel-report.ts"),
  "../utils/growth-tracking.server": tracking,
  "../utils/customer-journey.server": customerJourney,
  "../utils/geo.server": { getClientIP: () => null },
  "../utils/datacenter-ips.server": { isDatacenterIP: () => ({ isDatacenter: false }) },
  "../utils/notifications.server": { createNotification: async () => {} },
  "../utils/ab-tests.server": ab,
  "../utils/store-snapshot.server": store,
  "../utils/channel-snapshot.server": channel,
  "../utils/order-attribution.server": orders,
  "../utils/tracking-auth.server": {
    verifyTrackingRequest: async () => ({ allowed: true, signed: true }),
  },
});
let webhookPayload;
let webhookShop;
const webhook = load("../app/routes/webhooks.orders.paid.tsx", {
  "../db.server": dbModule,
  "../shopify.server": {
    authenticate: {
      webhook: async () => ({
        payload: webhookPayload,
        shop: webhookShop,
        topic: "ORDERS_PAID",
        admin: null,
      }),
    },
  },
  "../utils/growth-tracking.server": tracking,
  "../utils/customer-journey.server": customerJourney,
  "../utils/ab-tests.server": ab,
  "../utils/store-snapshot.server": store,
  "../utils/channel-snapshot.server": channel,
  "../utils/order-attribution.server": orders,
});

// GDPR webhooks: each call answers with the payload set here.
let privacyWebhook;
const notifications = [];
const privacyImports = {
  "../db.server": dbModule,
  "../shopify.server": {
    authenticate: { webhook: async () => privacyWebhook },
  },
  "../utils/order-id": orderId,
  "../utils/order-attribution.server": orders,
  "../utils/notifications.server": {
    createNotification: async (data) => notifications.push(data),
  },
};
const dataRequest = load("../app/routes/webhooks.customers.data_request.tsx", privacyImports);
const redact = load("../app/routes/webhooks.customers.redact.tsx", privacyImports);
const privacyCall = async (route, shop, topic, payload) => {
  privacyWebhook = { shop, topic, payload };
  const response = await route.action({ request: new Request("https://app.test/webhooks/privacy", { method: "POST" }) });
  assert.equal(response.status, 200);
};

const shops = [];
const PRODUCT = "gid://shopify/Product/101";
const now = Date.now();

async function fixture() {
  const shop = `order-attr-${randomUUID()}.myshopify.com`;
  shops.push(shop);
  const sessionId = `sid-${randomUUID()}`;
  const viewed = (minutes) => new Date(now - minutes * 60_000);
  const project = await db.project.create({
    data: {
      shop,
      productId: PRODUCT,
      productTitle: "Fixture product",
      productHandle: `fixture-${randomUUID()}`,
      resourceType: "PRODUCT",
    },
  });
  const snapshot = await db.snapshot.create({
    data: { projectId: project.id, number: 1, status: "ACTIVE" },
  });
  const storeSnapshot = await db.storeSnapshot.create({
    data: { shop, status: "ACTIVE", startedAt: viewed(120) },
  });
  const testRow = await db.abTest.create({
    data: {
      shop,
      name: "Fixture test",
      targetPageType: "PRODUCT",
      status: "LIVE",
    },
  });
  const variant = await db.abTestVariant.create({
    data: { testId: testRow.id, key: "A", name: "A", templateName: "product" },
  });
  const assignment = await db.abTestAssignment.create({
    data: { testId: testRow.id, variantId: variant.id, shop, sessionId },
  });
  // Fields a GDPR redact clears on order-linked rows, and the ones it keeps.
  const person = {
    ipAddress: "203.0.113.7",
    city: "Lagos",
    region: "LA",
    userAgent: "Mozilla/5.0 fixture",
    country: "Nigeria",
    countryCode: "NG",
    deviceType: "mobile",
  };
  // Two page views per capture, so a second genuine order has a row to convert.
  for (const [index, minutes] of [90, 60].entries()) {
    const pageViewId = `pv-${index}-${randomUUID()}`;
    await db.visit.create({
      data: {
        snapshotId: snapshot.id,
        sessionId,
        pageViewId,
        startedAt: viewed(minutes),
        addedToCart: true,
        ...person,
      },
    });
    await db.storeSnapshotVisit.create({
      data: {
        storeSnapshotId: storeSnapshot.id,
        sessionId,
        pageViewId,
        pagePath: "/products/fixture",
        isLandingPage: index === 0,
        pageOrder: index + 1,
        startedAt: viewed(minutes),
        ...person,
      },
    });
    await db.abTestVisit.create({
      data: {
        testId: testRow.id,
        variantId: variant.id,
        assignmentId: assignment.id,
        shop,
        sessionId,
        pageViewId,
        pagePath: "/products/fixture",
        isLandingPage: index === 0,
        pageOrder: index + 1,
        startedAt: viewed(minutes),
        ...person,
      },
    });
  }
  return { shop, sessionId, snapshot, storeSnapshot, testRow };
}

// The pixel reports the presentment currency (EUR here); the webhook the shop's (USD).
// Production pixels send checkout.order.id as the bare numeric string (shep-dev
// order #1019 arrived as "18986055008350"); `gid` sends the GID form instead.
async function pixel(f, orderNumber, { total = "45.00", currency = "EUR", gid = false } = {}) {
  const response = await trackApi.action({
    request: new Request(`https://app.test/api/track?shop=${f.shop}`, {
      method: "POST",
      body: JSON.stringify({
        eventType: "conversion",
        shop: f.shop,
        sessionId: f.sessionId,
        timestamp: now,
        orderId: gid ? `gid://shopify/OrderIdentity/${orderNumber}` : String(orderNumber),
        orderNumber: `#${orderNumber}`,
        totalPrice: total,
        currency,
        products: [{ productId: PRODUCT }],
      }),
    }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function paidWebhook(f, orderNumber, { total = "48.50" } = {}) {
  webhookShop = f.shop;
  webhookPayload = {
    id: orderNumber,
    admin_graphql_api_id: `gid://shopify/Order/${orderNumber}`,
    order_number: orderNumber,
    created_at: new Date(now).toISOString(),
    total_price: total,
    currency: "USD",
    note_attributes: [{ name: "_mw_sid", value: f.sessionId }],
    line_items: [{ product_id: 101, quantity: 1 }],
  };
  const response = await webhook.action({
    request: new Request("https://app.test/webhooks/orders/paid", {
      method: "POST",
    }),
  });
  assert.equal(response.status, 200);
}

const pick = { orderId: true, orderValue: true, currency: true };
async function converted(f) {
  const where = { converted: true };
  return {
    visits: await db.visit.findMany({
      where: { ...where, snapshotId: f.snapshot.id },
      select: pick,
      orderBy: { startedAt: "asc" },
    }),
    store: await db.storeSnapshotVisit.findMany({
      where: { ...where, storeSnapshotId: f.storeSnapshot.id },
      select: pick,
      orderBy: { startedAt: "asc" },
    }),
    abVisits: await db.abTestVisit.findMany({
      where: { ...where, testId: f.testRow.id },
      select: pick,
      orderBy: { startedAt: "asc" },
    }),
    assignments: await db.abTestAssignment.findMany({
      where: { ...where, testId: f.testRow.id },
      select: pick,
    }),
  };
}

const usd = (orderId, orderValue = 48.5) => ({ orderId, orderValue, currency: "USD" });
const eur = (orderId, orderValue = 45) => ({ orderId, orderValue, currency: "EUR" });

function assertOneOrder(rows, expected) {
  assert.deepEqual(rows.visits, [expected], "one product visit per order");
  assert.deepEqual(rows.store, [expected], "one store visit per order");
  assert.deepEqual(rows.abVisits, [expected], "one A/B visit per order");
  assert.deepEqual(rows.assignments, [expected], "one A/B assignment per order");
}

after(async () => {
  await db.abTest.deleteMany({ where: { shop: { in: shops } } });
  await db.storeSnapshot.deleteMany({ where: { shop: { in: shops } } });
  await db.project.deleteMany({ where: { shop: { in: shops } } });
  await db.$disconnect();
});

test("both writers normalise the order id to the numeric Shopify id", () => {
  for (const [value, expected] of [
    ["18986055008350", "18986055008350"],
    [18986055008350, "18986055008350"],
    ["gid://shopify/Order/5551234", "5551234"],
    ["gid://shopify/OrderIdentity/5551234", "5551234"],
    [" 5551234 ", "5551234"],
  ]) {
    assert.equal(orders.orderAttributionId(value), expected, String(value));
  }
  for (const value of [null, undefined, "", "abc", -1, 1.5, "gid://shopify/Product/1", {}]) {
    assert.equal(orders.orderAttributionId(value), null, String(value));
  }
});

test("pixel then webhook: one conversion per capture, filled in with the shop-currency amount", async () => {
  const f = await fixture();
  const pixelResult = await pixel(f, 1001);
  assert.equal(pixelResult.conversionsTracked, 1);
  assertOneOrder(await converted(f), eur("1001"));

  await paidWebhook(f, 1001);
  assertOneOrder(await converted(f), usd("1001"));
});

test("a GID-form pixel order id matches the webhook's order too", async () => {
  const f = await fixture();
  const pixelResult = await pixel(f, 1003, { gid: true });
  assert.equal(pixelResult.conversionsTracked, 1);
  assertOneOrder(await converted(f), eur("1003"));

  await paidWebhook(f, 1003);
  assertOneOrder(await converted(f), usd("1003"));
});

test("pixel in the shop currency, then webhook: the HMAC-verified webhook amount wins", async () => {
  const f = await fixture();
  // The pixel's amount is client-reported; a forged or stale one must not stick.
  await pixel(f, 1002, { total: "999.00", currency: "USD" });
  await paidWebhook(f, 1002);
  assertOneOrder(await converted(f), usd("1002", 48.5));
});

test("webhook then pixel: the pixel converts nothing and keeps the webhook amount", async () => {
  const f = await fixture();
  await paidWebhook(f, 2001);
  const pixelResult = await pixel(f, 2001);
  assert.equal(pixelResult.conversionsTracked, 0);
  assert.equal(pixelResult.storeConversionsTracked, 0);
  assert.equal(pixelResult.abConversionsTracked, 0);
  assertOneOrder(await converted(f), usd("2001"));
});

test("webhook retries convert the order once", async () => {
  const f = await fixture();
  for (let attempt = 0; attempt < 3; attempt++) await paidWebhook(f, 3001);
  assertOneOrder(await converted(f), usd("3001"));
});

test("pixel and webhook racing still convert the order once, at the shop-currency amount", async () => {
  // Repeated, since which writer wins (and where the loser stops) varies per run.
  for (let round = 0; round < 8; round++) {
    const f = await fixture();
    const orderNumber = 4000 + round;
    const deliveries = [pixel(f, orderNumber), paidWebhook(f, orderNumber), paidWebhook(f, orderNumber)];
    if (round % 2) deliveries.reverse();
    await Promise.all(deliveries);
    assertOneOrder(await converted(f), usd(String(orderNumber)));
  }
});

test("two genuine orders in one session convert two visits with their own amounts", async () => {
  const f = await fixture();
  await pixel(f, 5001, { total: "20.00" });
  await paidWebhook(f, 5001, { total: "21.00" });
  await paidWebhook(f, 5002, { total: "31.00" });
  await pixel(f, 5002, { total: "30.00" });
  const rows = await converted(f);
  const byOrder = (list) =>
    [...list].sort((a, b) => a.orderId.localeCompare(b.orderId));
  const expected = [usd("5001", 21), usd("5002", 31)];
  assert.deepEqual(byOrder(rows.visits), expected);
  assert.deepEqual(byOrder(rows.store), expected);
  assert.deepEqual(byOrder(rows.abVisits), expected);
  // A visitor's assignment converts once: on the first order.
  assert.deepEqual(rows.assignments, [usd("5001", 21)]);
});

test("a pixel order without an id keeps the old behaviour (no dedupe key)", async () => {
  const f = await fixture();
  const result = await store.attributeStoreSnapshotOrder({
    shop: f.shop,
    sessionId: f.sessionId,
    timestamp: now,
    totalPrice: 10,
    currency: "USD",
  });
  assert.equal(result, 1);
  const rows = await converted(f);
  assert.deepEqual(rows.store, [{ orderId: null, orderValue: 10, currency: "USD" }]);
});

test("GDPR: a data request reports the order-linked rows; redact unlinks them in that shop only", async () => {
  const f = await fixture();
  const other = await fixture();
  await pixel(f, 6001);
  await paidWebhook(f, 6001);
  await paidWebhook(f, 6002);
  // Another shop holding the same order number must not be touched.
  await paidWebhook(other, 6001);
  notifications.length = 0;

  await privacyCall(dataRequest, f.shop, "customers/data_request", {
    orders_requested: [6001, "gid://shopify/Order/6002"],
    data_request: { id: 77 },
  });
  const notice = notifications.find((n) => n.referenceId === "order-privacy:77");
  assert.ok(notice, "the merchant is told about order-linked measurement rows");
  assert.equal(notice.shop, f.shop);
  assert.equal(notice.type, "PRIVACY_REQUEST");
  // 2 orders x (product visit, store visit, A/B visit) + the one A/B assignment.
  assert.match(notice.message, /\b7\b/);

  // A third page view of the session, linked to no order, keeps its fields.
  const unlinked = await db.storeSnapshotVisit.create({
    data: {
      storeSnapshotId: f.storeSnapshot.id,
      sessionId: f.sessionId,
      pageViewId: `pv-unlinked-${randomUUID()}`,
      pagePath: "/pages/about",
      ipAddress: "203.0.113.7",
      city: "Lagos",
    },
  });

  await privacyCall(redact, f.shop, "customers/redact", {
    orders_to_redact: ["6001", 6002],
  });
  const personFields = {
    ipAddress: true, city: true, region: true, userAgent: true,
    country: true, countryCode: true, deviceType: true,
    converted: true, orderValue: true, currency: true,
  };
  const redacted = {
    ipAddress: null, city: null, region: null, userAgent: null,
    country: "Nigeria", countryCode: "NG", deviceType: "mobile",
    converted: true, orderValue: 48.5, currency: "USD",
  };
  for (const [name, model, capture] of [
    ["visits", db.visit, { snapshotId: f.snapshot.id }],
    ["store", db.storeSnapshotVisit, { storeSnapshotId: f.storeSnapshot.id }],
    ["abVisits", db.abTestVisit, { testId: f.testRow.id }],
  ]) {
    const rows = await model.findMany({
      where: { ...capture, converted: true },
      select: personFields,
    });
    assert.equal(rows.length, 2, name);
    for (const row of rows) {
      // Order 6001 came from the pixel and the webhook, 6002 only from the webhook.
      assert.deepEqual(row, redacted, `${name} drops what can identify the customer`);
    }
  }
  assert.deepEqual(
    await db.storeSnapshotVisit.findUnique({
      where: { id: unlinked.id },
      select: { ipAddress: true, city: true },
    }),
    { ipAddress: "203.0.113.7", city: "Lagos" },
    "rows not linked to a redacted order are untouched",
  );
  const otherVisit = await db.visit.findFirst({
    where: { snapshotId: other.snapshot.id, converted: true },
    select: { ipAddress: true, userAgent: true },
  });
  assert.deepEqual(otherVisit, { ipAddress: "203.0.113.7", userAgent: "Mozilla/5.0 fixture" }, "another shop keeps its rows");
  const rows = await converted(f);
  for (const [name, list] of Object.entries(rows)) {
    assert.ok(list.length > 0, name);
    for (const row of list) {
      assert.equal(row.orderId, null, `${name} keeps no order link`);
      // The conversion and its revenue stay in the report.
      assert.equal(row.currency, "USD", name);
    }
  }
  assertOneOrder(await converted(other), usd("6001"));
});
