// Checks that storefront tracking requires Shopify's app proxy signature for
// anything that creates tracking data, with a log-only rollout mode.
// Run: node --test scripts/check-track-signature.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compile = (file) =>
  ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
function run(file, mocks, globals = {}) {
  const mod = { exports: {} };
  runInNewContext(compile(file), {
    module: mod,
    exports: mod.exports,
    require: (id) => (id in mocks ? mocks[id] : require(id)),
    URL,
    Request,
    Response,
    Date,
    console: { log() {}, warn() {}, error() {} },
    ...globals,
  });
  return mod.exports;
}
// Shopify signs proxied requests; the mock accepts only signature=good.
const shopifyServer = {
  authenticate: {
    public: {
      appProxy: async (request) => {
        if (new URL(request.url).searchParams.get("signature") !== "good")
          throw new Response(null, { status: 400 });
        return {};
      },
    },
  },
};
const loadAuth = (mode) =>
  run("app/utils/tracking-auth.server.ts", { "../shopify.server": shopifyServer }, {
    process: { env: { TRACKING_SIGNATURE_MODE: mode } },
  });
const url = (query) => `https://app.test/api/track?${query}`;
const post = (query) => new Request(url(query), { method: "POST", body: "{}" });

test("a correctly signed page view is allowed and marked signed", async () => {
  const { verifyTrackingRequest } = loadAuth("enforce");
  const result = await verifyTrackingRequest(post("shop=owner.myshopify.com&signature=good"), undefined);
  assert.deepEqual({ ...result }, { allowed: true, signed: true });
});

test("enforce mode rejects unsigned or tampered data-creating requests", async () => {
  const { verifyTrackingRequest } = loadAuth("enforce");
  for (const [query, eventType] of [
    ["shop=owner.myshopify.com", undefined],
    ["shop=owner.myshopify.com&signature=bad", undefined],
    ["shop=owner.myshopify.com", "journey_batch"],
    ["shop=owner.myshopify.com", "ab_test_assign"],
  ]) {
    const result = await verifyTrackingRequest(post(query), eventType);
    assert.equal(result.allowed, false, `${query} ${eventType}`);
  }
});

test("log mode lets unsigned requests through but records why", async () => {
  const warnings = [];
  const { verifyTrackingRequest } = loadAuth("log");
  const missing = await verifyTrackingRequest(post("shop=owner.myshopify.com"), "journey_batch", {
    warn: (...args) => warnings.push(args),
  });
  const invalid = await verifyTrackingRequest(post("shop=owner.myshopify.com&signature=bad"), undefined, {
    warn: (...args) => warnings.push(args),
  });
  assert.equal(missing.allowed, true);
  assert.equal(invalid.allowed, true);
  assert.deepEqual(
    warnings.map(([, detail]) => [detail.reason, detail.eventType, detail.mode]),
    [
      ["missing", "journey_batch", "log"],
      ["invalid", "page_view", "log"],
    ],
  );
});

test("unsigned web pixel commerce events stay allowed in enforce mode", async () => {
  const { verifyTrackingRequest } = loadAuth("enforce");
  for (const eventType of ["add_to_cart", "checkout_started", "conversion", "cart_removed", "customer_commerce"]) {
    const result = await verifyTrackingRequest(post("shop=owner.myshopify.com"), eventType);
    assert.equal(result.allowed, true, eventType);
  }
});

function loadTrackRoute(mode) {
  const seen = { projectWhere: [] };
  const prisma = {
    project: {
      findFirst: async ({ where }) => {
        seen.projectWhere.push(where);
        return null;
      },
    },
    storeSnapshot: { findFirst: async () => null },
  };
  const route = run(
    "app/routes/api.track.tsx",
    {
      "../db.server": { __esModule: true, default: prisma },
      "../utils/tracking-auth.server": loadAuth(mode),
      "../utils/channel-report": { readChannelAcquisition: () => null },
      "../utils/growth-tracking.server": { growthAcquisitionMatch: () => ({}), writeGrowthVisit: async () => ({}) },
      "../utils/customer-journey.server": { recordCustomerJourney: async () => ({}), recordCustomerCommerce: async () => {} },
      "../utils/geo.server": { getClientIP: () => null, getGeoData: async () => ({}) },
      "../utils/datacenter-ips.server": { isDatacenterIP: () => ({ isDatacenter: false }), calculateBotScore: () => 0 },
      "../utils/notifications.server": { createNotification: async () => {} },
      "../utils/ab-tests.server": {},
      "../utils/store-snapshot.server": { normalizeResourceType: (value) => (value ? String(value).toUpperCase() : null) },
      "../utils/channel-snapshot.server": { getActiveChannelSnapshot: async () => null },
    },
  );
  return { action: route.action, seen };
}
const pageView = (shop) =>
  JSON.stringify({
    sessionId: "sess_1",
    pageViewId: "pv_1",
    shop,
    productHandle: "red-shoe",
    resourceType: "product",
    pagePath: "/products/red-shoe",
  });

test("enforce mode answers 401 to an unsigned page view before reading any data", async () => {
  const { action, seen } = loadTrackRoute("enforce");
  const response = await action({
    request: new Request(url("shop=owner.myshopify.com"), { method: "POST", body: pageView("owner.myshopify.com") }),
  });
  assert.equal(response.status, 401);
  assert.equal(seen.projectWhere.length, 0);
});

test("a signed page view is scoped to the signed shop, not the body's shop", async () => {
  const { action, seen } = loadTrackRoute("enforce");
  const response = await action({
    request: new Request(url("shop=owner.myshopify.com&signature=good"), {
      method: "POST",
      body: pageView("intruder.myshopify.com"),
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(seen.projectWhere[0].shop, "owner.myshopify.com");
});

test("a page view with no shop never matches another shop's project", async () => {
  const { action, seen } = loadTrackRoute("log");
  const response = await action({
    request: new Request(url(""), { method: "POST", body: pageView(undefined) }),
  });
  assert.equal(response.status, 200);
  assert.equal(seen.projectWhere.length, 0);
});
