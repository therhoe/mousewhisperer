// Checks the Shopify App Pricing billing sync against the documented Partner API
// schema, with no network or database.
// Run: node --test scripts/check-billing-sync.mjs
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
    Response,
    Date,
    JSON,
    console: { log() {}, warn() {}, error() {} },
    ...globals,
  });
  return mod.exports;
}

// The fields Shopify documents for what the sync queries, Partner API 2026-07:
// https://shopify.dev/docs/api/partner/2026-07/queries/activeSubscription
// https://shopify.dev/docs/api/partner/2026-07/objects/ActiveSubscription
// ActiveSubscription has no `id`; `legacySubscriptionId` is the Admin API
// AppSubscription GID.
const PARTNER_API_VERSION = "2026-07";
const PARTNER_SCHEMA = {
  Query: { activeSubscription: "ActiveSubscription" },
  ActiveSubscription: {
    app: "AppReference",
    billingPeriod: null,
    cancelAtEndOfCycle: null,
    currentBillingCycle: "BillingCycle",
    items: "SubscriptionItem",
    legacySubscriptionId: null,
    pendingUpdate: "PendingUpdate",
    shop: "ShopReference",
    trialEndsAt: null,
  },
  BillingCycle: { endTime: null, startTime: null },
  SubscriptionItem: {
    description: null,
    discount: "SubscriptionDiscount",
    handle: null,
    price: "Price",
    usage: "Usage",
  },
  Price: { active: null, currency: null },
  AppReference: { apiKey: null, id: null, name: null },
  ShopReference: { id: null, myshopifyDomain: null, name: null },
};

// Walks the query's selection sets and reports fields the schema above lacks,
// worded like the Partner API's own error. Handles the plain nested selections
// the sync uses (no fragments or aliases).
function undocumentedFields(query) {
  const tokens = query.replace(/#[^\n]*/g, "").match(/[_A-Za-z][_0-9A-Za-z]*|[{}()]/g);
  const errors = [];
  let i = tokens.indexOf("{");
  const selectionSet = (type) => {
    const fields = PARTNER_SCHEMA[type] || {};
    i++;
    while (tokens[i] !== "}") {
      const field = tokens[i++];
      if (tokens[i] === "(") {
        let depth = 0;
        do {
          if (tokens[i] === "(") depth++;
          if (tokens[i] === ")") depth--;
          i++;
        } while (depth);
      }
      if (!(field in fields)) errors.push(`Field '${field}' doesn't exist on type '${type}'`);
      if (tokens[i] === "{") selectionSet(fields[field]);
    }
    i++;
  };
  selectionSet("Query");
  return errors;
}

const SHOP = "owner.myshopify.com";
const SHOP_GID = "gid://shopify/Shop/42";
const ORG_ID = "5678";

// Loads billing.server.ts with a fake Partner API that rejects undocumented
// fields the way production does, and an Admin API with no legacy subscription.
function loadBilling(activeSubscription) {
  const calls = { partner: [], upserts: [], warnings: [], legacyQueried: false };
  const prisma = {
    shopBilling: {
      upsert: async (args) => {
        calls.upserts.push(JSON.parse(JSON.stringify(args)));
        return { shop: SHOP };
      },
    },
  };
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.partner.push({ url, query: body.query, variables: body.variables });
    const errors = undocumentedFields(body.query);
    const payload = errors.length
      ? { errors: errors.map((message) => ({ message })) }
      : { data: { activeSubscription } };
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  const admin = {
    graphql: async (query) => {
      if (/currentAppInstallation/.test(query)) {
        calls.legacyQueried = true;
        return Response.json({ data: { currentAppInstallation: { activeSubscriptions: [] } } });
      }
      return Response.json({ data: { shop: { id: SHOP_GID } } });
    },
  };
  const billing = run(
    "app/utils/billing.server.ts",
    {
      "../db.server": prisma,
      "./loader-cache.server": {
        cachedValue: (_key, _ttl, load) => load(),
        clearCacheKey() {},
        loaderCacheKeys: { billingDisplay: (shop) => `billing:${shop}` },
      },
      "./billing-plans": run("app/utils/billing-plans.ts", {}),
    },
    {
      fetch,
      process: {
        env: {
          SHOPIFY_APP_ID: "1234",
          SHOPIFY_PARTNER_ORG_ID: ORG_ID,
          SHOPIFY_PARTNER_API_TOKEN: "test-partner-token",
        },
      },
      console: {
        log() {},
        error() {},
        warn: (message, detail) => calls.warnings.push([message, detail?.error]),
      },
    },
  );
  return { reconcile: () => billing.reconcileShopBillingFromShopify(admin, SHOP), calls };
}

const signalSubscription = (overrides = {}) => ({
  billingPeriod: "EVERY_30_DAYS",
  cancelAtEndOfCycle: false,
  currentBillingCycle: { endTime: "2026-12-06T00:00:00Z" },
  items: [{ handle: "signal", description: "Signal", price: { active: true } }],
  legacySubscriptionId: "gid://shopify/AppSubscription/9001",
  ...overrides,
});

test(`the App Pricing query selects only fields Partner API ${PARTNER_API_VERSION} documents`, async () => {
  const { reconcile, calls } = loadBilling(signalSubscription());
  await reconcile();
  assert.equal(calls.partner.length, 1);
  const [{ url, query, variables }] = calls.partner;
  assert.equal(url, `https://partners.shopify.com/${ORG_ID}/api/${PARTNER_API_VERSION}/graphql.json`);
  assert.deepEqual({ ...variables }, { appId: "gid://shopify/App/1234", shopId: SHOP_GID });
  assert.deepEqual(undocumentedFields(query), []);
});

test("an active App Pricing subscription syncs its plan and Admin API subscription id", async () => {
  const { reconcile, calls } = loadBilling(signalSubscription());
  await reconcile();
  assert.deepEqual(calls.warnings, []);
  assert.equal(calls.legacyQueried, false, "App Pricing should sync without the legacy fallback");
  const expected = {
    plan: "SIGNAL",
    status: "ACTIVE",
    shopifySubscriptionId: "gid://shopify/AppSubscription/9001",
    currentPeriodEnd: "2026-12-06T00:00:00.000Z",
  };
  assert.deepEqual(calls.upserts, [
    { where: { shop: SHOP }, create: { shop: SHOP, ...expected }, update: expected },
  ]);
});

test("without a legacySubscriptionId the plan handle is stored as the subscription id", async () => {
  const { reconcile, calls } = loadBilling(signalSubscription({ legacySubscriptionId: null }));
  await reconcile();
  assert.deepEqual(calls.warnings, []);
  assert.equal(calls.upserts.length, 1);
  assert.equal(calls.upserts[0].create.shopifySubscriptionId, "signal");
  assert.equal(calls.upserts[0].update.shopifySubscriptionId, "signal");
});
