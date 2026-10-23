import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
function compile(path, mocks = {}) {
  const code = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const module = { exports: {} };
  runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => (name in mocks ? mocks[name] : require(name)),
    URL,
    Response,
    Date,
    console,
  });
  return module.exports;
}
const journey = compile("../app/utils/customer-journey.ts");
const helpers = compile("../app/utils/snapshot-setup.ts", {
  "./customer-journey": journey,
});
// Render the actual guide so UI regressions do not depend on screenshots alone.
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { AppProvider } = require("@shopify/polaris");
const en = require("@shopify/polaris/locales/en.json");
const { SnapshotSetupGuide } = compile(
  "../app/components/SnapshotSetupGuide.tsx",
  {
    "@remix-run/react": {
      useFetcher: () => ({ state: "idle", load() {}, submit() {} }),
      useRouteLoaderData: () => ({ apiKey: "qa-key" }),
      Link: ({ to, ...props }) =>
        React.createElement("a", { href: to, ...props }),
    },
    "@shopify/app-bridge-react": { useAppBridge: () => ({}) },
    "../utils/snapshot-setup": helpers,
  },
);
const renderGuide = (visible, maxTarget = 1000) =>
  renderToStaticMarkup(
    React.createElement(
      AppProvider,
      { i18n: en },
      React.createElement(SnapshotSetupGuide, {
        shop: "qa.myshopify.com",
        maxTarget,
        visible,
        onExit() {},
      }),
    ),
  );
const guideMarkup = renderGuide(true);
assert.equal(
  (guideMarkup.match(/type="number"[^>]*value="100"/g) || []).length,
  2,
  "Both setup targets should default to 100",
);
assert.equal(
  (renderGuide(true, 50).match(/type="number"[^>]*value="50"/g) || []).length,
  2,
  "Defaults must still respect lower plan limits",
);
assert.match(guideMarkup, /Exit setup/);
assert.match(guideMarkup, /aria-label="About setup"/);
assert.match(guideMarkup, /aria-label="Collapse setup guide"/);
assert.match(guideMarkup, /rotate\(180deg\)/);
const editorTag =
  guideMarkup.match(
    /<a\b[^>]*href="https:\/\/qa.myshopify.com\/admin\/themes\/current\/editor[^>]*>/,
  )?.[0] || "";
assert.match(editorTag, /Polaris-Button--variantPrimary/);
assert.match(editorTag, /target="_blank"/);
assert.doesNotMatch(guideMarkup, /Check again|Checking…|>Enabled</);
assert.match(renderGuide(false), /^<div hidden=""/);
const {
  trackerEditorUrl,
  trackerSettingsState,
  trackerActivationState,
  setupTarget,
  setupCustomerLink,
  TRACKER_EXTENSION_ID,
} = helpers;
assert.equal(trackerEditorUrl("evil.example.com", "key"), null);
assert.equal(trackerEditorUrl("shop.myshopify.com", ""), null);
const link = new URL(trackerEditorUrl("shop.myshopify.com", "key"));
assert.equal(link.searchParams.get("activateAppId"), "key/tracker");
assert.equal(link.searchParams.get("context"), "apps");
assert.equal(
  trackerActivationState([
    {
      type: "theme_app_extension",
      activations: [{ handle: "tracker", target: "body", status: "active" }],
    },
  ]),
  "active",
);
assert.equal(
  trackerActivationState([
    {
      type: "theme_app_extension",
      activations: [{ handle: "tracker", target: "body", status: "available" }],
    },
  ]),
  "missing",
);
assert.equal(
  trackerActivationState([{ handle: "tracking-embed", activations: [] }]),
  "unknown",
);
const theme = (disabled) =>
  `/* generated */ ${JSON.stringify({ current: { blocks: { one: { type: `shopify://apps/snapshot/blocks/tracker/${TRACKER_EXTENSION_ID}`, disabled } } } })}`;
assert.equal(trackerSettingsState(theme(false)), "active");
assert.equal(trackerSettingsState(theme(true)), "missing");
assert.equal(trackerSettingsState("invalid"), "unknown");
assert.equal(trackerSettingsState('{"current":{}}'), "missing");
for (const invalid of ["", "1.2", "NaN", "-10", "24"])
  assert.throws(() => setupTarget(invalid));
assert.equal(setupTarget("25"), 25);
assert.equal(setupTarget("1", 1), 1);
const customer = setupCustomerLink(
  "https://shop.myshopify.com/products/test?utm_source=fb&utm_medium=paid_social&utm_campaign=launch&ad_id=123&email=private@example.com#secret",
);
assert.equal(customer.source, "facebook");
assert.equal(customer.adId, "123");
assert.equal(
  customer.destinationUrl,
  "https://shop.myshopify.com/products/test",
);
for (const invalid of [
  "https://shop.myshopify.com",
  "http://shop.myshopify.com?utm_source=fb",
  "https://shop.myshopify.com?utm_source={{source}}",
  "https://shop.myshopify.com/account?utm_source=fb",
])
  assert.throws(() => setupCustomerLink(invalid));

class PlanLimitError extends Error {
  status = 402;
}
let state,
  active,
  pixelReady,
  trackerEnabled,
  limits,
  graphPage,
  rollback,
  invalidate;
const calls = [];
const blank = () => ({
  snapshots: [],
  projects: [],
  store: [],
  channel: [],
  customer: [],
  settings: false,
});
function reset() {
  state = blank();
  active = null;
  pixelReady = true;
  trackerEnabled = true;
  limits = {
    maxSnapshotTargetVisitors: 1000,
    normalSnapshots: 20,
    storeSnapshots: 5,
  };
  graphPage = {
    __typename: "Product",
    id: "gid://shopify/Product/1",
    title: "Actual product",
    handle: "actual",
    status: "ACTIVE",
  };
  rollback = false;
  invalidate = 0;
  calls.length = 0;
}
const countModel = (name) => ({
  count: async () => state[name].length,
  findFirst: async (args) => {
    assert.equal(args.where.shop, "shop.myshopify.com");
    return active === name ? { id: "active" } : null;
  },
  create: async ({ data }) => {
    if (rollback) throw new Error("simulated write failure");
    state[name].push(data);
    return data;
  },
});
const db = {
  $executeRaw: async () => 1,
  snapshot: {
    count: async (args) => {
      assert.equal(args.where.project.shop, "shop.myshopify.com");
      return state.snapshots.length;
    },
    findFirst: async ({ where }) =>
      where.id ? state.snapshots.find((s) => s.id === where.id) || null : null,
    create: async ({ data }) => {
      state.snapshots.push(data);
      return data;
    },
  },
  project: {
    findFirst: async ({ where }) => {
      assert.equal(where.shop, "shop.myshopify.com");
      return where.snapshots ? null : state.projects[0] || null;
    },
    create: async ({ data }) => {
      const p = { id: "project-1", ...data };
      state.projects.push(p);
      return p;
    },
  },
  storeSnapshot: countModel("store"),
  channelSnapshot: countModel("channel"),
  customerSnapshot: countModel("customer"),
  shopSettings: {
    upsert: async () => {
      state.settings = true;
    },
  },
  $transaction: async (fn) => {
    const before = structuredClone(state);
    try {
      return await fn(db);
    } catch (e) {
      state = before;
      throw e;
    }
  },
};
const admin = {
  graphql: async (query, options) => {
    calls.push(query);
    if (query.includes("SetupTrackerStatus"))
      return Response.json({
        data: {
          themes: {
            nodes: [
              {
                files: {
                  nodes: [{ body: { content: theme(!trackerEnabled) } }],
                },
              },
            ],
          },
        },
      });
    if (query.includes("SetupDomain"))
      return Response.json({
        data: { shop: { primaryDomain: { host: "store.example.com" } } },
      });
    assert.equal(options.variables.id, "gid://shopify/Product/1");
    return Response.json({ data: { node: graphPage } });
  },
};
const service = compile("../app/utils/snapshot-setup.server.ts", {
  "./storefront-product.server": compile("../app/utils/storefront-product.server.ts", {
    "./growth-projects": compile("../app/utils/growth-projects.ts"),
  }),
  "../db.server": db,
  "./billing.server": {
    getBillingAccess: async () => ({ limits }),
    PlanLimitError,
  },
  "./web-pixel.server": { ensureWebPixel: async () => ({ ready: pixelReady }) },
  "./snapshot-setup": helpers,
  "./loader-cache.server": {
    clearCacheKey: () => invalidate++,
    clearCachePrefix: () => invalidate++,
    loaderCacheKeys: {
      dashboard: (s) => s,
      billingDisplay: (s) => s,
      categoryPrefix: (s) => s,
      categoryFastPrefix: (s) => s,
    },
  },
});
function form(kind = "store", extra = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    requestKey: "12345678-1234-1234-1234-123456789012",
    kind,
    target: "100",
    pageTarget: "100",
    pageType: "PRODUCT",
    pageId: "gid://shopify/Product/1",
    campaignLink:
      "https://shop.myshopify.com/products/test?utm_source=facebook",
    ...extra,
  }))
    f.set(k, v);
  return f;
}
const start = (f) =>
  service.startSetupSnapshots("shop.myshopify.com", admin, f);
for (const kind of ["store", "channel", "customer"]) {
  reset();
  const result = await start(form(kind));
  assert.equal(state.snapshots.length, 1);
  assert.equal(state[kind].length, 1);
  assert.equal(state.projects[0].productTitle, "Actual product");
  assert.equal(state.settings, true);
  assert.equal(invalidate, 4);
  assert.equal(result.pageUrl, "/app/project/project-1");
  assert.ok(result.snapshotUrl.includes(`/${kind}-snapshots/setup_`));
  await start(form(kind));
  assert.equal(state.snapshots.length, 1);
  assert.equal(state[kind].length, 1);
}
reset();
trackerEnabled = false;
await assert.rejects(start(form()), /Enable Snapshot Tracker/);
assert.equal(state.snapshots.length, 0);
reset();
pixelReady = false;
await assert.rejects(start(form()), /Checkout tracking/);
assert.equal(state.store.length, 0);
reset();
limits.normalSnapshots = 1;
await assert.rejects(start(form("channel")), /room for both/);
assert.equal(state.snapshots.length, 0);
reset();
limits.storeSnapshots = 0;
await assert.rejects(start(form()), /room for both/);
assert.equal(state.snapshots.length, 0);
reset();
active = "store";
await assert.rejects(start(form()), /already running/);
assert.equal(state.snapshots.length, 0);
reset();
rollback = true;
await assert.rejects(start(form()), /simulated/);
assert.equal(state.snapshots.length, 0);
assert.equal(state.projects.length, 0);
assert.equal(state.settings, false);
reset();
graphPage = null;
await assert.rejects(start(form()), /unavailable/);
reset();
graphPage.__typename = "Collection";
await assert.rejects(start(form()), /unavailable/);
reset();
await assert.rejects(
  start(
    form("customer", {
      campaignLink: "https://another-shop.com?utm_source=fb",
    }),
  ),
  /this store/,
);
await assert.rejects(start(form("store", { target: "1001" })), /up to 1,000/);
assert.equal(state.snapshots.length, 0);
console.log(
  "Snapshot setup: activation, deep link, validation, trusted resources, all 3 types, quotas, retries and rollback checks passed.",
);

// Optional read-only acceptance against the named development store. Never prints credentials.
if (process.argv.includes("--dev-store")) {
  const { PrismaClient } = require("@prisma/client");
  const liveDb = new PrismaClient();
  try {
    const shop = "shep-dev.myshopify.com";
    const session = await liveDb.session.findFirst({
      where: { shop, isOnline: false },
    });
    assert.ok(session?.accessToken, "Dev-store offline session required");
    const liveAdmin = {
      graphql: (query, options) =>
        fetch(`https://${shop}/admin/api/2026-01/graphql.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": session.accessToken,
          },
          body: JSON.stringify({ query, variables: options?.variables }),
        }),
    };
    const response = await liveAdmin.graphql(
      '{shop{plan{partnerDevelopment}} products(first:1,query:"status:active"){nodes{id}} pages(first:1){nodes{id}} blogs(first:1){nodes{id}} collections(first:1){nodes{id}}}',
    );
    const payload = await response.json();
    assert.ok(!payload.errors, "Shopify resource query must succeed");
    assert.equal(
      payload.data.shop.plan.partnerDevelopment,
      true,
      "Refusing non-development store",
    );
    // Real PostgreSQL check: advisory locks return void and cannot use $queryRaw.
    await liveDb.$transaction(async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`snapshot-setup:${shop}`}))`;
    });
    assert.equal(
      await service.savedTrackerState(liveAdmin),
      "active",
      "Saved live-theme tracker must be detected",
    );
    for (const [type, connection] of Object.entries({
      PRODUCT: "products",
      PAGE: "pages",
      BLOG: "blogs",
      COLLECTION: "collections",
    })) {
      const id = payload.data[connection].nodes[0]?.id;
      if (id) {
        const resource = await service.resolveSetupPage(liveAdmin, type, id);
        assert.equal(resource.id, id);
        console.log(`Dev-store ${type} resource resolution passed.`);
      }
    }
    console.log(
      "Dev-store read-only checks passed: published tracker enabled; authenticated January 2026 API queries valid. No snapshots created.",
    );
  } finally {
    await liveDb.$disconnect();
  }
}
