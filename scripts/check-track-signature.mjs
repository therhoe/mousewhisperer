// Checks that storefront tracking requires Shopify's app proxy signature for
// anything that creates tracking data, with a log-only rollout mode.
// Run: node --test scripts/check-track-signature.mjs
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
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
// Shopify signs proxied requests; the mock accepts only signature=good. The
// real check is exercised further down with a throwaway signing secret.
const shopifyServer = {
  validateAppProxySignature: async (request) =>
    new URL(request.url).searchParams.get("signature") === "good",
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
      "../utils/order-attribution.server": {},
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

// The real app/shopify.server.ts, signing with throwaway test values (never
// real credentials). Its Prisma session table passes the startup check, then
// every session lookup fails the way the 2026-11-06 cold start did.
const TEST_SECRET = "throwaway-app-proxy-test-secret";
function loadShopifyServerWithUnreachableSessions() {
  const sessionQueries = [];
  const unreachable = async (...args) => {
    sessionQueries.push(args);
    throw new Error("Can't reach database server at `db.test:5432`");
  };
  const prisma = {
    session: {
      count: async () => 0,
      findUnique: unreachable,
      findMany: unreachable,
      upsert: unreachable,
      delete: unreachable,
      deleteMany: unreachable,
    },
  };
  const shopifyServer = run(
    "app/shopify.server.ts",
    {
      "./db.server": { __esModule: true, default: prisma },
      "./utils/billing-plans": { WHISPER_PLAN: "Whisper", SIGNAL_PLAN: "Signal" },
      "./utils/polaris": { POLARIS_URL: "https://cdn.shopify.com/shopifycloud/polaris-2.js" },
    },
    {
      URLSearchParams,
      process: {
        env: {
          SHOPIFY_API_KEY: "throwaway-api-key",
          SHOPIFY_API_SECRET: TEST_SECRET,
          SHOPIFY_APP_URL: "https://app.test",
          SCOPES: "read_products",
        },
      },
    },
  );
  return { shopifyServer, sessionQueries };
}
const loadAuthWith = (shopifyServer) =>
  run("app/utils/tracking-auth.server.ts", { "../shopify.server": shopifyServer }, {
    process: { env: { TRACKING_SIGNATURE_MODE: "enforce" } },
  });
// Shopify's app proxy signature: HMAC-SHA256 (hex) over the query's key=value
// pairs, sorted by key and joined with nothing in between.
const signProxyParams = (params, secret = TEST_SECRET) =>
  createHmac("sha256", secret)
    .update(Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join(""))
    .digest("hex");
function signedProxyParams(overrides = {}) {
  const params = {
    shop: "owner.myshopify.com",
    path_prefix: "/apps/api",
    timestamp: String(Math.floor(Date.now() / 1000)),
    logged_in_customer_id: "",
    ...overrides,
  };
  return { ...params, signature: signProxyParams(params) };
}
const postWith = (params) => post(new URLSearchParams(params).toString());

test("a correctly signed request counts as signed even when session storage is unreachable", async () => {
  const { shopifyServer, sessionQueries } = loadShopifyServerWithUnreachableSessions();
  const { verifyTrackingRequest } = loadAuthWith(shopifyServer);
  const warnings = [];
  const result = await verifyTrackingRequest(postWith(signedProxyParams()), undefined, {
    warn: (...args) => warnings.push(args),
  });
  assert.deepEqual(
    { result: { ...result }, warnings: warnings.map(([, detail]) => detail.reason), sessionQueries: sessionQueries.length },
    { result: { allowed: true, signed: true }, warnings: [], sessionQueries: 0 },
  );
});

test("a tampered app proxy signature is still reported as invalid", async () => {
  const { shopifyServer } = loadShopifyServerWithUnreachableSessions();
  const { verifyTrackingRequest } = loadAuthWith(shopifyServer);
  const { signature: _signature, ...unsigned } = signedProxyParams();
  const cases = {
    "shop changed after signing": { ...signedProxyParams(), shop: "intruder.myshopify.com" },
    "signed with another secret": { ...unsigned, signature: signProxyParams(unsigned, "another-secret") },
    "signature replayed after the 90 s window": signedProxyParams({
      timestamp: String(Math.floor(Date.now() / 1000) - 600),
    }),
  };
  for (const [name, params] of Object.entries(cases)) {
    const warnings = [];
    const result = await verifyTrackingRequest(postWith(params), undefined, {
      warn: (...args) => warnings.push(args),
    });
    assert.deepEqual(
      { result: { ...result }, warnings: warnings.map(([, detail]) => detail.reason) },
      { result: { allowed: false, signed: false }, warnings: ["invalid"] },
      name,
    );
  }
});
