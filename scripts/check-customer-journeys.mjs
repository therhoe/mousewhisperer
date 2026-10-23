// Real PostgreSQL regression checks. Only accepts an explicit loopback test DB.
// JOURNEY_TEST_DATABASE_URL=postgresql://...@127.0.0.1:55439/... node --test scripts/check-customer-journeys.mjs
import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { PrismaClient, Prisma } from "@prisma/client";

const testUrl = process.env.JOURNEY_TEST_DATABASE_URL;
assert.ok(
  testUrl && ["127.0.0.1", "localhost"].includes(new URL(testUrl).hostname),
  "Use an explicit disposable loopback PostgreSQL database.",
);
const db = new PrismaClient({ datasources: { db: { url: testUrl } } });
function load(path, imports) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const module = { exports: {} };
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    URL,
    Date,
    Response,
    Request,
    console,
    Map,
    Set,
    require: (name) => {
      assert.ok(name in imports, name);
      return imports[name];
    },
  });
  return module.exports;
}
const rules = load("../app/utils/customer-journey.ts", {});
const channel = load("../app/utils/channel-report.ts", {});
class PlanLimitError extends Error {}
const server = load("../app/utils/customer-journey.server.ts", {
  "@prisma/client": { Prisma },
  "../db.server": db,
  "./channel-report": channel,
  "./customer-journey": rules,
  "./billing.server": {
    PlanLimitError,
    clearBillingDisplayCache() {},
    getBillingAccess: async () => ({
      canCreateNormalSnapshot: true,
      limits: { maxSnapshotTargetVisitors: 1000 },
    }),
  },
});
const shop = "journey-regression.myshopify.com";
const otherShop = "journey-other.myshopify.com";
let started;
let snapshot;
beforeEach(async () => {
  // Migration replay may have imported this disposable fixture into Projects.
  await db.growthProject.deleteMany({ where: { shop: { in: [shop, otherShop] } } });
  await db.customerSnapshot.deleteMany({
    where: { shop: { in: [shop, otherShop] } },
  });
  started = new Date(Date.now() - 30_000);
  snapshot = await db.customerSnapshot.create({
    data: {
      shop,
      name: "Campaign test",
      source: "facebook",
      medium: "paid_social",
      campaign: "sale",
      adId: "123",
      destinationUrl: "https://store.test/products/shoe",
      startedAt: new Date(started.getTime() - 60_000),
      endsAt: new Date(Date.now() + 86_400_000),
      targetSessions: 3,
    },
  });
});
after(async () => {
  await db.$disconnect();
});
function batch(overrides = {}) {
  return {
    sessionId: "browser-1",
    pageViewId: "page-1",
    pagePath: "/products/shoe?email=private@example.com",
    startedAt: +started,
    timeOnPage: 10000,
    scrollDepth: 30,
    acquisition: {
      id: "acq_test_123",
      startedAt: +started,
      source: "facebook",
      medium: "paid_social",
      campaign: "sale",
      adId: "123",
      sourceCategory: "Paid Social",
      landingPath: "/products/shoe",
    },
    events: [
      {
        id: "page-1:0",
        type: "page_view",
        at: +started,
        path: "/products/shoe?secret=private",
      },
      {
        id: "page-1:1",
        type: "click",
        at: +started + 1000,
        path: "/products/shoe",
        label: "Size guide",
        target: "/pages/sizes?token=secret",
      },
    ],
    ...overrides,
  };
}
function commerce(overrides = {}) {
  return {
    shop,
    sessionId: "browser-1",
    acquisitionSessionId: "acq_test_123",
    eventType: "conversion",
    timestamp: new Date(),
    orderId: "gid://shopify/Order/999",
    totalPrice: "48.5",
    currency: "USD",
    ...overrides,
  };
}

test("link generation preserves other tools' tags, source aliases, and exact ad matching", () => {
  const link = rules.buildJourneyLink(
    "https://store.test/products/shoe?utm_content=creative-x&coupon=SALE",
    snapshot,
  );
  assert.equal(new URL(link).searchParams.get("utm_content"), "creative-x");
  assert.equal(new URL(link).searchParams.get("ad_id"), "123");
  assert.equal(rules.inspectJourneyLink(link, snapshot).ok, true);
  assert.equal(
    rules.inspectJourneyLink(link.replace("ad_id=123", "ad_id=456"), snapshot)
      .ok,
    false,
  );
  assert.equal(
    rules.matchesJourney(snapshot, {
      source: "fb",
      medium: "paid_social",
      campaign: "sale",
      adId: "123",
    }),
    true,
  );
  assert.equal(
    rules.inspectJourneyLink(
      "https://store.test?utm_source=facebook&ad_id={{ad.id}}",
      snapshot,
    ).ok,
    false,
  );
});

test("matches admission filters and deduplicates pages/events across heartbeat retries", async () => {
  assert.equal(
    (await server.recordCustomerJourney(shop, batch(), "REAL")).captured,
    true,
  );
  await server.recordCustomerJourney(
    shop,
    batch({ timeOnPage: 5000 }),
    "ZOMBIE",
  );
  assert.equal(await db.customerJourneySession.count({}), 1);
  assert.equal(await db.customerJourneyPage.count({}), 1);
  assert.equal(await db.customerJourneyEvent.count({}), 2);
  const page = await db.customerJourneyPage.findFirst();
  assert.equal(page.timeOnPage, 10000);
  assert.equal(page.visitorType, "REAL");
  assert.equal(page.pagePath, "/products/shoe");
  const wrongAd = batch();
  wrongAd.acquisition.adId = "456";
  wrongAd.acquisition.id = "acq_wrong_ad";
  assert.equal(
    (await server.recordCustomerJourney(shop, wrongAd, "REAL")).captured,
    false,
  );
});

test("multiple pages retain arrival and ordered, independently paginated events", async () => {
  await server.recordCustomerJourney(shop, batch(), "REAL");
  const second = batch({
    pageViewId: "page-2",
    pagePath: "/collections/shoes",
    events: Array.from({ length: 40 }, (_, i) => ({
      id: `page-2:${i}`,
      type: "click",
      at: +started + 2000 + i,
      label: `Action ${i}`,
      path: "/collections/shoes",
    })),
  });
  await server.recordCustomerJourney(shop, second, "REAL");
  const session = await db.customerJourneySession.findFirst();
  assert.equal(session.adId, "123");
  assert.equal(await db.customerJourneyPage.count({}), 2);
  const first = await server.getCustomerJourney(
    shop,
    snapshot.id,
    session.id,
    1,
  );
  const next = await server.getCustomerJourney(
    shop,
    snapshot.id,
    session.id,
    2,
  );
  assert.equal(first.events.length, 30);
  assert.equal(next.events.length, 12);
  assert.equal(
    new Set([...first.events, ...next.events].map((e) => e.id)).size,
    42,
  );
  assert.equal(
    await server.getCustomerJourney(otherShop, snapshot.id, session.id, 1),
    null,
  );
  assert.equal(
    await server.getCustomerSnapshotReport(otherShop, snapshot.id, 1),
    null,
  );
});

test("purchase pixel/webhook and click retries count once without switching ads or shops", async () => {
  await server.recordCustomerJourney(shop, batch(), "REAL");
  await server.recordCustomerCommerce(commerce({ fromPixel: true }));
  await server.recordCustomerCommerce(commerce({ orderId: 999 }));
  assert.equal(
    await db.customerJourneyEvent.count({ where: { type: "conversion" } }),
    1,
  );
  assert.equal(
    await server.recordCustomerCommerce(
      commerce({ acquisitionSessionId: "acq_other" }),
    ),
    0,
  );
  assert.equal(
    await server.recordCustomerCommerce(commerce({ shop: otherShop })),
    0,
  );
  assert.equal(
    await server.recordCustomerCommerce(
      commerce({ acquisitionSessionId: null }),
    ),
    0,
  );
  await server.recordCustomerCommerce(
    commerce({
      eventType: "add_to_cart",
      eventId: "optimistic",
      fromPixel: false,
    }),
  );
  assert.equal(
    (await db.customerJourneySession.findFirst()).addedToCart,
    false,
  );
  await server.recordCustomerCommerce(
    commerce({
      eventType: "add_to_cart",
      eventId: "pixel-atc",
      fromPixel: true,
    }),
  );
  assert.equal((await db.customerJourneySession.findFirst()).addedToCart, true);
  const report = await server.getCustomerSnapshotReport(shop, snapshot.id, 1);
  assert.equal(report.conversions, 1);
  assert.equal(report.humans, 1);
});

test("target blocks new arrivals but lets the last admitted visitor finish", async () => {
  await db.customerSnapshot.update({
    where: { id: snapshot.id },
    data: { targetSessions: 1 },
  });
  await server.recordCustomerJourney(shop, batch(), "REAL");
  const another = batch();
  another.acquisition.id = "acq_visitor_2";
  another.sessionId = "browser-2";
  assert.equal(
    (await server.recordCustomerJourney(shop, another, "REAL")).captured,
    false,
  );
  assert.equal(
    (
      await server.recordCustomerJourney(
        shop,
        batch({ pageViewId: "page-next" }),
        "REAL",
      )
    ).captured,
    true,
  );
  assert.equal(await server.recordCustomerCommerce(commerce()), 1);
});

test("old arrivals, expired sessions, paused and completed captures do not keep collecting", async () => {
  const old = batch();
  old.acquisition.startedAt = +snapshot.startedAt - 1000;
  assert.equal(
    (await server.recordCustomerJourney(shop, old, "REAL")).captured,
    false,
  );
  await server.recordCustomerJourney(shop, batch(), "REAL");
  await db.customerJourneySession.updateMany({
    data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) },
  });
  assert.equal(
    (await server.recordCustomerJourney(shop, batch(), "REAL")).captured,
    false,
  );
  assert.equal(await server.recordCustomerCommerce(commerce()), 0);
  await server.transitionCustomerSnapshot(shop, snapshot.id, "pause");
  assert.equal(
    (await server.recordCustomerJourney(shop, batch(), "REAL")).captured,
    false,
  );
  await server.transitionCustomerSnapshot(shop, snapshot.id, "complete");
  await assert.rejects(
    server.transitionCustomerSnapshot(shop, snapshot.id, "resume"),
    /cannot be restarted/,
  );
});

test("private paths, emails, invalid event types, and future timestamps are excluded", () => {
  const events = rules.readJourneyEvents(
    [
      {
        id: "a",
        type: "click",
        at: +started,
        label: "person@example.com",
        path: "/account/123",
        target: "mailto:person@example.com",
      },
      { id: "b", type: "keystroke", at: +started, label: "secret" },
      { id: "c", type: "click", at: Date.now() + 120000 },
    ],
    started,
    new Date(),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].label, null);
  assert.equal(events[0].pagePath, "/private-page");
  assert.equal(events[0].targetPath, null);
});

test("a successful cart event can arrive before the theme heartbeat without a synthetic page view", async () => {
  const first = commerce({
    eventType: "add_to_cart",
    eventId: "early-pixel-cart",
    fromPixel: true,
    acquisition: batch().acquisition,
  });
  assert.equal(await server.recordCustomerCommerce(first), 1);
  assert.equal(await db.customerJourneyPage.count({}), 0);
  assert.equal(await db.customerJourneySession.count({}), 1);
  await server.recordCustomerJourney(shop, batch(), "REAL");
  assert.equal(await db.customerJourneyPage.count({}), 1);
  assert.equal(await db.customerJourneySession.count({}), 1);
  assert.equal((await db.customerJourneySession.findFirst()).addedToCart, true);
});

test("concurrent arrivals cannot overfill the target or lose a purchase update", async () => {
  await db.customerSnapshot.update({
    where: { id: snapshot.id },
    data: { targetSessions: 1 },
  });
  const second = batch();
  second.sessionId = "browser-2";
  second.acquisition.id = "acq_parallel_2";
  await Promise.all([
    server.recordCustomerJourney(shop, batch(), "REAL"),
    server.recordCustomerJourney(shop, second, "REAL"),
  ]);
  assert.equal(await db.customerJourneySession.count({}), 1);
  const selected = await db.customerJourneySession.findFirst();
  await Promise.all(
    [0, 1, 2].map(() =>
      server.recordCustomerCommerce(
        commerce({
          sessionId: selected.trackingSessionId,
          acquisitionSessionId: selected.acquisitionId,
        }),
      ),
    ),
  );
  assert.equal(
    await db.customerJourneyEvent.count({ where: { type: "conversion" } }),
    1,
  );
});

test("customer privacy requests identify only matching shop/order journeys and redact them with cascades", async () => {
  await server.recordCustomerJourney(shop, batch(), "REAL");
  await server.recordCustomerCommerce(commerce());
  const journey = await db.customerJourneySession.findFirst();
  assert.equal(
    await server.exportCustomerJourney(otherShop, snapshot.id, journey.id),
    null,
  );
  assert.equal(
    (await server.exportCustomerJourney(shop, snapshot.id, journey.id)).events
      .length,
    3,
  );
  const notifications = [];
  const imports = {
    "../shopify.server": {
      authenticate: {
        webhook: async () => ({
          shop,
          topic: "customers/data_request",
          payload: {
            orders_requested: [999],
            orders_to_redact: [999],
            data_request: { id: 123 },
          },
        }),
      },
    },
    "../db.server": db,
    "../utils/customer-journey": rules,
    "../utils/notifications.server": {
      createNotification: async (data) => notifications.push(data),
    },
  };
  const request = load(
    "../app/routes/webhooks.customers.data_request.tsx",
    imports,
  );
  assert.equal(
    (await request.action({ request: new Request("http://localhost/") }))
      .status,
    200,
  );
  assert.equal(notifications.length, 1);
  assert.ok(notifications[0].linkUrl.includes(journey.id));
  const redact = load("../app/routes/webhooks.customers.redact.tsx", imports);
  assert.equal(
    (await redact.action({ request: new Request("http://localhost/") })).status,
    200,
  );
  assert.equal(await db.customerJourneySession.count({}), 0);
  assert.equal(await db.customerJourneyPage.count({}), 0);
  assert.equal(await db.customerJourneyEvent.count({}), 0);
});

test("event retries at the cap do not discard new actions or falsely mark a complete timeline partial", async () => {
  await server.recordCustomerJourney(shop, batch(), "REAL");
  const session = await db.customerJourneySession.findFirst();
  await db.customerJourneyEvent.createMany({
    data: Array.from({ length: rules.JOURNEY_EVENT_LIMIT - 3 }, (_, i) => ({
      sessionId: session.id,
      eventKey: `filler:${i}`,
      type: "click",
      occurredAt: started,
    })),
  });
  const retry = batch();
  retry.events.push({
    id: "new-final",
    type: "click",
    at: +started + 2000,
    label: "Final action",
  });
  await server.recordCustomerJourney(shop, retry, "REAL");
  assert.equal(
    await db.customerJourneyEvent.count({}),
    rules.JOURNEY_EVENT_LIMIT,
  );
  assert.equal((await db.customerJourneySession.findFirst()).truncated, false);
  retry.events.push({ id: "overflow", type: "click", at: +started + 3000 });
  await server.recordCustomerJourney(shop, retry, "REAL");
  assert.equal((await db.customerJourneySession.findFirst()).truncated, true);
});

test("database enforces one active customer capture per shop", async () => {
  await assert.rejects(
    server.createCustomerSnapshot({
      shop,
      name: "Another",
      source: "google",
      destinationUrl: "https://store.test/",
      durationDays: 7,
      targetSessions: 10,
    }),
    /already active/,
  );
});
