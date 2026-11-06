// Plans and Settings screens (plan 2a). Read-only: mocked Shopify, billing and
// storage; never touches a database.
// Run: node --test scripts/check-plans-settings.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");

function loadModule(file, mocks = {}) {
  const filename = path.resolve(root, file);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  const load = (id) => {
    if (id in mocks) return mocks[id];
    if (!id.startsWith(".")) return require(id);
    const base = path.resolve(path.dirname(filename), id);
    const target = [`${base}.ts`, `${base}.tsx`, base].find(existsSync);
    if (!target) throw new Error(`Cannot resolve ${id} from ${file}`);
    return loadModule(path.relative(root, target), mocks);
  };
  new Function("module", "exports", "require", output)(mod, mod.exports, load);
  return mod.exports;
}

const billingAccess = {
  plan: "WHISPER",
  planName: "Whisper",
  isFree: false,
  isPaid: true,
  status: "ACTIVE",
  currentPeriodEnd: null,
  usage: { storeSnapshots: 3, normalSnapshots: 12, pageSnapshots: 10, channelSnapshots: 2, customerSnapshots: 0, abTests: 2 },
  limits: { storeSnapshots: 5, normalSnapshots: 50, maxSnapshotTargetVisitors: 5000, abTests: 5 },
  canCreateStoreSnapshot: true,
  canCreateNormalSnapshot: true,
  canCreateAbTest: true,
};
const boundaryMock = { boundary: { headers: () => new Headers() } };

function plansRoute({ data, search = "" } = {}) {
  return loadModule("app/routes/app.plans.tsx", {
    "../shopify.server": {
      authenticate: { admin: async () => ({ admin: {}, session: { shop: "owner.myshopify.com" } }) },
      isShopifyBillingTestMode: () => false,
    },
    "../utils/billing.server": {
      reconcileShopBillingFromShopify: async () => null,
      getBillingAccess: async () => billingAccess,
    },
    "@shopify/shopify-app-react-router/server": boundaryMock,
    "@shopify/app-bridge-react": { useAppBridge: () => ({ toast: { show() {} } }) },
    "react-router": {
      useLoaderData: () => data,
      useSearchParams: () => [new URLSearchParams(search)],
      useNavigate: () => () => {},
    },
  });
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test("Plans keeps prices and limits and links to Shopify's managed pricing page", async () => {
  const data = await plansRoute().loader({ request: new Request("https://app.test/app/plans") });
  assert.equal(
    data.managedPricingUrl,
    "https://admin.shopify.com/store/owner/charges/mousewhisperer/pricing_plans",
  );
  assert.deepEqual(data.usage, { store: 3, page: 12, abTests: 2 });
  const plans = loadModule("app/utils/plans.ts");
  assert.deepEqual(
    plans.PRICING_PLANS.map((plan) => [plan.name, plan.price, plan.limits.storeSnapshots, plan.limits.normalSnapshots, plan.limits.abTests, plan.limits.maxSnapshotTargetVisitors]),
    [["Whisper", "$49.99", 5, 50, 5, 5000], ["Signal", "$99.99", 20, 250, 25, 25000]],
  );
});

test("Plans shows usage, both paid plans and one primary Upgrade for a Whisper shop", async () => {
  const data = await plansRoute().loader({ request: new Request("https://app.test/app/plans") });
  const html = renderToStaticMarkup(
    React.createElement(plansRoute({ data, search: "returnTo=%2Fapp%2Fprojects" }).default),
  );
  assert.match(html, /<s-page heading="Plans">/);
  assert.match(html, /<s-link slot="breadcrumb-actions" href="\/app" data-snapshot-back="">Back<\/s-link>/);
  assert.match(html, /You&#x27;re on Whisper\. Billed by Shopify every 30 days\./);
  for (const usage of ["3 of 5", "12 of 50", "2 of 5", "Up to 5,000"]) assert.ok(html.includes(usage), usage);
  for (const text of ["$49.99", "$99.99", "20 store-level measurements", "250 page-level measurements", "Up to 25,000 visitors per measurement"])
    assert.ok(html.includes(text), text);
  assert.equal((html.match(/variant="primary"/g) || []).length, 1, "one primary button per screen");
  assert.match(html, /Upgrade to Signal/);
  assert.match(html, /<s-button disabled="">Current plan<\/s-button>/);
  assert.doesNotMatch(html, /snapshots/i, "labels say measurements, not snapshots");
});

test("Upgrade remembers a safe screen, then opens Shopify's plan page at the top", () => {
  const plans = loadModule("app/utils/plans.ts");
  const storage = memoryStorage();
  const opened = [];
  plans.startUpgrade({
    storage,
    shop: "a.myshopify.com",
    returnTo: "/app/projects?status=IDLE&id_token=x",
    url: "https://admin.shopify.com/store/a/charges/mousewhisperer/pricing_plans",
    open: (...args) => opened.push(args),
    now: 1000,
  });
  assert.deepEqual(opened, [["https://admin.shopify.com/store/a/charges/mousewhisperer/pricing_plans", "_top"]]);
  assert.deepEqual(JSON.parse(storage.getItem("snapshot_plans_return:a.myshopify.com")), {
    path: "/app/projects?status=IDLE",
    at: 1000,
  });
  plans.startUpgrade({ storage, shop: "a.myshopify.com", returnTo: "https://evil.example", url: "u", open() {}, now: 2000 });
  assert.equal(storage.getItem("snapshot_plans_return:a.myshopify.com"), null);
  const blocked = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  const openedWhileBlocked = [];
  assert.doesNotThrow(() =>
    plans.startUpgrade({ storage: blocked, shop: "a.myshopify.com", returnTo: "/app", url: "u", open: (...args) => openedWhileBlocked.push(args) }),
  );
  assert.equal(openedWhileBlocked.length, 1, "storage problems never stop the upgrade");
});

test("after Shopify's plan page, approval returns once to the saved screen", () => {
  const plans = loadModule("app/utils/plans.ts");
  const shop = "a.myshopify.com";
  const key = "snapshot_plans_return:a.myshopify.com";
  const storage = memoryStorage();
  storage.setItem(key, JSON.stringify({ path: "/app/settings", at: 1000 }));
  assert.equal(plans.finishUpgrade({ storage, shop, billing: null, now: 2000 }), null);
  assert.notEqual(storage.getItem(key), null, "an ordinary visit keeps the saved screen");
  assert.equal(plans.finishUpgrade({ storage, shop, billing: "approved", now: 2000 }), "/app/settings");
  assert.equal(plans.finishUpgrade({ storage, shop, billing: "approved", now: 2000 }), null, "only once");
  storage.setItem(key, JSON.stringify({ path: "/app/settings", at: 1000 }));
  assert.equal(plans.finishUpgrade({ storage, shop, billing: "not-approved", now: 2000 }), null);
  assert.equal(storage.getItem(key), null, "a declined charge forgets the screen");
  storage.setItem(key, JSON.stringify({ path: "/app/settings", at: 1000 }));
  assert.equal(plans.finishUpgrade({ storage, shop, billing: "approved", now: 1000 + 60 * 60 * 1000 + 1 }), null, "stale");
  storage.setItem(key, JSON.stringify({ path: "https://evil.example", at: 1000 }));
  assert.equal(plans.finishUpgrade({ storage, shop, billing: "approved", now: 2000 }), null, "unsafe");
  storage.setItem(key, "not json");
  assert.equal(plans.finishUpgrade({ storage, shop, billing: "approved", now: 2000 }), null);
  assert.equal(plans.finishUpgrade({ storage: null, shop, billing: "approved" }), null);
});

test("plan buttons say upgrade for a higher plan and switch otherwise", () => {
  const plans = loadModule("app/utils/plans.ts");
  assert.equal(plans.planChange("FREE", "WHISPER"), "upgrade");
  assert.equal(plans.planChange("WHISPER", "SIGNAL"), "upgrade");
  assert.equal(plans.planChange("SIGNAL", "WHISPER"), "switch");
  assert.equal(plans.planChange("PRO", "SIGNAL"), "switch");
  assert.equal(plans.planChange("UNKNOWN", "WHISPER"), "upgrade");
});

test("the retired /app/upgrade keeps its query and billing returns land on Plans", async () => {
  const upgrade = loadModule("app/routes/app.upgrade.tsx");
  const moved = await upgrade.loader({
    request: new Request("https://app.test/app/upgrade?billing=approved&shop=a.myshopify.com"),
  });
  assert.equal(moved.status, 302);
  assert.equal(moved.headers.get("Location"), "/app/plans?billing=approved&shop=a.myshopify.com");
  for (const [subscriptions, expected] of [
    [[{ name: "Signal" }], "/app/plans?billing=approved"],
    [[], "/app/plans?billing=not-approved"],
  ]) {
    const back = loadModule("app/routes/app.upgrade.return.tsx", {
      "../shopify.server": {
        authenticate: {
          admin: async () => ({
            session: { shop: "a.myshopify.com" },
            billing: { check: async () => ({ appSubscriptions: subscriptions }) },
          }),
        },
        isShopifyBillingTestMode: () => true,
      },
      "../utils/billing.server": { syncShopBillingFromSubscription: async () => null },
      "@shopify/shopify-app-react-router/server": boundaryMock,
    });
    const response = await back.loader({ request: new Request("https://app.test/app/upgrade/return") });
    assert.equal(response.headers.get("Location"), expected);
  }
});

test("the pixel status only reads: active, missing or unknown", async () => {
  const pixel = loadModule("app/utils/web-pixel.server.ts");
  const queries = [];
  const admin = (payload, ok = true) => ({
    graphql: async (query) => {
      queries.push(query);
      if (payload instanceof Error) throw payload;
      return new Response(JSON.stringify(payload), { status: ok ? 200 : 500 });
    },
  });
  assert.equal(await pixel.getWebPixelStatus(admin({ data: { webPixel: { id: "gid://shopify/WebPixel/1", settings: "{}" } } })), "active");
  assert.equal(await pixel.getWebPixelStatus(admin({ data: { webPixel: null } })), "missing");
  assert.equal(await pixel.getWebPixelStatus(admin({ errors: [{ message: "denied" }] })), "unknown");
  assert.equal(await pixel.getWebPixelStatus(admin({}, false)), "unknown");
  assert.equal(await pixel.getWebPixelStatus(admin(new Error("offline"))), "unknown");
  assert.ok(queries.every((query) => /query CurrentAppWebPixel/.test(query) && !/mutation/.test(query)));
});

test("the tracking status API answers with the theme embed and the pixel together", async () => {
  const route = loadModule("app/routes/api.storefront-tracker-status.tsx", {
    "../shopify.server": { authenticate: { admin: async () => ({ admin: {}, session: { shop: "a.myshopify.com" } }) } },
    "../utils/storefront-tracker-status.server": {
      getStorefrontTrackerStatus: async () => ({ status: "active", storefrontUrl: "https://a.example", checkedAt: "2026-11-06T00:00:00.000Z", message: "" }),
    },
    "../utils/web-pixel.server": { getWebPixelStatus: async () => "missing" },
    "../utils/loader-cache.server": { cachedValue: async (_key, _ttl, load) => load() },
    "@shopify/shopify-app-react-router/server": boundaryMock,
  });
  const body = await (await route.loader({ request: new Request("https://app.test/api/storefront-tracker-status") })).json();
  assert.equal(body.trackerStatus.status, "active");
  assert.equal(body.pixelStatus, "missing");
});

test("an unknown tracking status is not kept in the cache, so Retry asks again", async () => {
  const store = new Map();
  const cleared = [];
  let pixel = "unknown";
  let tracker = { status: "unknown", storefrontUrl: "", checkedAt: "", message: "offline" };
  let trackerCalls = 0;
  const route = loadModule("app/routes/api.storefront-tracker-status.tsx", {
    "../shopify.server": { authenticate: { admin: async () => ({ admin: {}, session: { shop: "a.myshopify.com" } }) } },
    "../utils/storefront-tracker-status.server": {
      getStorefrontTrackerStatus: async () => { trackerCalls += 1; return tracker; },
    },
    "../utils/web-pixel.server": { getWebPixelStatus: async () => pixel },
    "../utils/loader-cache.server": {
      cachedValue: async (key, _ttl, load) => {
        if (store.has(key)) return store.get(key);
        const value = await load();
        store.set(key, value);
        return value;
      },
      clearCacheKey: (key) => { cleared.push(key); store.delete(key); },
    },
    "@shopify/shopify-app-react-router/server": boundaryMock,
  });
  const ask = async () => (await route.loader({ request: new Request("https://app.test/api/storefront-tracker-status") })).json();
  const first = await ask();
  assert.equal(first.trackerStatus.status, "unknown");
  assert.equal(first.pixelStatus, "unknown");
  pixel = "active";
  tracker = { status: "active", storefrontUrl: "https://a.example", checkedAt: "", message: "" };
  const retry = await ask();
  assert.equal(retry.trackerStatus.status, "active", "Retry asked Shopify again");
  assert.equal(retry.pixelStatus, "active");
  assert.equal(trackerCalls, 2);
  const cachedCalls = trackerCalls;
  await ask();
  assert.equal(trackerCalls, cachedCalls, "an active result stays cached");
  pixel = "missing";
  store.clear();
  tracker = { status: "missing", storefrontUrl: "", checkedAt: "", message: "" };
  await ask();
  assert.deepEqual(cleared.length, 2, "only the two unknown results were cleared");
});

function settingsRoute(tracking) {
  let loaderData;
  const route = loadModule("app/routes/app.settings.tsx", {
    "../shopify.server": { authenticate: { admin: async () => ({ session: { shop: "a.myshopify.com" } }) } },
    "../utils/billing.server": { getBillingDisplayAccess: async () => billingAccess },
    "@shopify/shopify-app-react-router/server": boundaryMock,
    "../utils/background-json": { useBackgroundJson: () => tracking },
    "../components/LanguageMenu": { useLanguageSwitch: () => ({ locale: "de", change() {} }) },
    "react-router": { useLoaderData: () => loaderData, useNavigate: () => () => {} },
  });
  return {
    async html() {
      loaderData = await route.loader({ request: new Request("https://app.test/app/settings") });
      return renderToStaticMarkup(React.createElement(route.default));
    },
  };
}

test("Settings shows tracking, language and plan, with a warning when the embed is off", async () => {
  process.env.SHOPIFY_API_KEY = "test-key";
  const html = await settingsRoute({
    data: {
      trackerStatus: { status: "missing", storefrontUrl: "https://a.example", checkedAt: "2026-11-06T00:00:00.000Z", message: "" },
      pixelStatus: "active",
    },
    loading: false,
    error: null,
    reload() {},
  }).html();
  assert.match(html, /<s-page heading="Settings">/);
  assert.doesNotMatch(html, /breadcrumb-actions/, "Settings is a top-level screen");
  assert.match(html, /Snapshot Tracker must be turned on in your theme\./);
  assert.match(html, /<s-badge tone="warning">Not active<\/s-badge>/);
  assert.match(html, /<s-badge tone="success">Active<\/s-badge>/);
  assert.match(
    html,
    /href="https:\/\/a\.myshopify\.com\/admin\/themes\/current\/editor\?context=apps&amp;activateAppId=test-key%2Ftracker" target="_blank"/,
  );
  assert.match(html, /<s-select label="Language" value="de"/);
  for (const label of ["English", "Deutsch", "简体中文", "繁體中文"]) assert.ok(html.includes(label), label);
  assert.ok(html.includes("Whisper · $49.99 every 30 days"));
  assert.ok(html.includes("3 of 5 store-level and 12 of 50 page-level measurements used · 2 of 5 A/B tests"));
  assert.match(html, /href="\/app\/plans\?returnTo=%2Fapp%2Fsettings"/);
});

test("Settings says Checking… while the status loads and offers Retry when it fails", async () => {
  const loading = await settingsRoute({ data: undefined, loading: true, error: null, reload() {} }).html();
  assert.equal((loading.match(/Checking…/g) || []).length, 2);
  assert.doesNotMatch(loading, /must be turned on/);
  const failed = await settingsRoute({ data: undefined, loading: false, error: "Tracking status is temporarily unavailable.", reload() {} }).html();
  assert.equal((failed.match(/Unavailable/g) || []).length, 2);
  assert.match(failed, />Retry<\/s-button>/);
});
