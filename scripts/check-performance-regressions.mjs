// DB-free checks: no Shopify requests, credentials, or real store mutations.
// Run: node --test scripts/check-performance-regressions.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const json = (value, init) => new Response(JSON.stringify(value), init);
const quietConsole = { info() {}, warn() {}, error() {} };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

function loadModule(file, mocks = {}, globals = {}) {
  const runtimeModule = { exports: {} };
  const compiled = ts.transpileModule(source(file), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  runInNewContext(
    compiled.outputText,
    {
      exports: runtimeModule.exports,
      module: runtimeModule,
      require: (specifier) => {
        if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
        if (specifier === "@remix-run/node")
          return {
            json,
            redirect: (to) =>
              new Response(null, { status: 302, headers: { Location: to } }),
          };
        if (
          specifier.startsWith("@shopify/") ||
          specifier === "@remix-run/react"
        )
          return {};
        if (specifier.startsWith("react")) return require(specifier);
        throw new Error(`Unexpected dependency ${specifier} from ${file}`);
      },
      Date,
      URL,
      Response,
      Headers,
      FormData,
      Promise,
      process: { env: { NODE_ENV: "test", SHOPIFY_API_KEY: "qa-key" } },
      console: quietConsole,
      ...globals,
    },
    { filename: fileURLToPath(new URL(`../${file}`, import.meta.url)) },
  );
  return runtimeModule.exports;
}

function loadCache(globals) {
  return loadModule("app/utils/loader-cache.server.ts", {}, globals);
}

test("eight concurrent cold cache requests execute one query, with warm reuse", async () => {
  const cache = loadCache();
  const pending = deferred();
  let calls = 0;
  const load = () => {
    calls++;
    return pending.promise;
  };
  const results = Array.from({ length: 8 }, () =>
    cache.cachedValue("shop-a:summary", 1000, load),
  );
  await Promise.resolve();
  assert.equal(calls, 1);
  pending.resolve({ count: 4 });
  assert.equal((await Promise.all(results)).length, 8);
  assert.equal(
    (await cache.cachedValue("shop-a:summary", 1000, load)).count,
    4,
  );
  assert.equal(calls, 1);
});

test("cache expiration reloads and zero TTL only shares in-flight work", async () => {
  let now = 1;
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  const cache = loadCache({ Date: Clock });
  let calls = 0;
  const load = async () => ++calls;
  assert.equal(await cache.cachedValue("ttl", 10, load), 1);
  now = 12;
  assert.equal(await cache.cachedValue("ttl", 10, load), 2);
  assert.equal(await cache.cachedValue("fresh", 0, load), 3);
  assert.equal(await cache.cachedValue("fresh", 0, load), 4);
});

test("invalidation fences old in-flight results and preserves another tenant", async () => {
  const cache = loadCache();
  const old = deferred();
  const stale = cache.cachedValue(
    "category:shop-a:products",
    1000,
    () => old.promise,
  );
  await cache.cachedValue(
    "category:shop-b:products",
    1000,
    async () => "other-shop",
  );
  cache.clearCachePrefix("category:shop-a:");
  assert.equal(
    await cache.cachedValue(
      "category:shop-a:products",
      1000,
      async () => "new",
    ),
    "new",
  );
  old.resolve("old");
  assert.equal(await stale, "old");
  assert.equal(
    await cache.cachedValue(
      "category:shop-a:products",
      1000,
      async () => "wrong",
    ),
    "new",
  );
  assert.equal(
    await cache.cachedValue(
      "category:shop-b:products",
      1000,
      async () => "wrong",
    ),
    "other-shop",
  );
});

test("failed cache loads can retry and cannot evict a newer pending query", async () => {
  const cache = loadCache();
  const old = deferred();
  const next = deferred();
  const first = cache.cachedValue("retry", 1000, () => old.promise);
  const rejected = assert.rejects(first, /old failed/);
  cache.clearCacheKey("retry");
  const second = cache.cachedValue("retry", 1000, () => next.promise);
  old.reject(new Error("old failed"));
  await rejected;
  let duplicateCalls = 0;
  const third = cache.cachedValue("retry", 1000, async () => {
    duplicateCalls++;
    return "wrong";
  });
  next.resolve("recovered");
  assert.equal(await second, "recovered");
  assert.equal(await third, "recovered");
  assert.equal(duplicateCalls, 0);
  await assert.rejects(
    cache.cachedValue("failure", 1000, async () => {
      throw new Error("fail");
    }),
  );
  assert.equal(
    await cache.cachedValue("failure", 1000, async () => "retry-ok"),
    "retry-ok",
  );
});

test("cache is bounded and retains recently used keys", async () => {
  const cache = loadCache();
  for (let i = 0; i < 500; i++)
    await cache.cachedValue(`key-${i}`, 60_000, async () => i);
  await cache.cachedValue("key-0", 60_000, async () => -1);
  await cache.cachedValue("key-500", 60_000, async () => 500);
  assert.equal(await cache.cachedValue("key-0", 60_000, async () => -1), 0);
  assert.equal(await cache.cachedValue("key-1", 60_000, async () => -1), -1);
});

function billingHarness() {
  const cache = loadCache();
  const state = {
    row: null,
    usage: {
      storeSnapshots: 0,
      pageSnapshots: 0,
      channelSnapshots: 0,
      customerSnapshots: 0,
      abTests: 0,
    },
    reads: 0,
    counts: 0,
  };
  const db = {
    shopBilling: {
      findUnique: async () => {
        state.reads++;
        return state.row;
      },
      upsert: async ({ create, update }) => {
        state.row = { ...(state.row ? update : create) };
        return state.row;
      },
    },
    $queryRaw: async (strings, ...shops) => {
      state.counts++;
      assert.equal(shops.length, 5, "each count must be tenant-scoped");
      assert.ok(shops.every((shop) => shop === "qa.myshopify.com"));
      assert.match(
        strings.join("?"),
        /JOIN "Project" p ON p.id = s\."projectId"/,
      );
      return [{ ...state.usage }];
    },
  };
  const plans = loadModule("app/utils/billing-plans.ts");
  const billing = loadModule("app/utils/billing.server.ts", {
    "../db.server": db,
    "./loader-cache.server": cache,
    "./billing-plans": plans,
  });
  return { cache, state, billing, plans };
}

test("billing display uses two queries and coalesces eight concurrent page loads", async () => {
  const { state, billing } = billingHarness();
  state.usage.pageSnapshots = 3;
  state.usage.channelSnapshots = 2;
  state.usage.customerSnapshots = 1;
  const access = await Promise.all(
    Array.from({ length: 8 }, () =>
      billing.getBillingDisplayAccess("qa.myshopify.com"),
    ),
  );
  assert.equal(state.reads, 1);
  assert.equal(state.counts, 1);
  assert.equal(access[0].usage.normalSnapshots, 6);
  assert.equal(access[0].usage.customerSnapshots, 1);
  await billing.getBillingDisplayAccess("qa.myshopify.com");
  assert.equal(state.counts, 1);
});

test("fresh creation guards never authorize from cached usage or cached paid plans", async () => {
  const { state, billing, plans } = billingHarness();
  state.row = { plan: "WHISPER", status: "ACTIVE", currentPeriodEnd: null };
  const display = await billing.getBillingDisplayAccess("qa.myshopify.com");
  assert.equal(display.isPaid, true);
  state.row = null;
  state.usage.customerSnapshots = plans.PLAN_LIMITS.FREE.normalSnapshots;
  await assert.rejects(
    billing.assertCanCreateNormalSnapshots("qa.myshopify.com", 1),
    (error) => error.code === "PLAN_LIMIT",
  );
  await assert.rejects(
    billing.assertCanCreateAbTest("qa.myshopify.com"),
    (error) => error.code === "PLAN_LIMIT",
  );
  await assert.rejects(
    billing.assertSnapshotTargetAllowed(
      "qa.myshopify.com",
      plans.PLAN_LIMITS.FREE.maxSnapshotTargetVisitors + 1,
    ),
    (error) => error.code === "PLAN_LIMIT",
  );
  assert.equal(
    (await billing.getBillingDisplayAccess("qa.myshopify.com")).isPaid,
    false,
  );
  assert.ok(state.counts >= 5);
});

test("cancelled plan retains only its existing paid-through entitlement", async () => {
  const { state, billing } = billingHarness();
  state.row = {
    plan: "WHISPER",
    status: "CANCELLED",
    currentPeriodEnd: new Date(Date.now() + 60_000),
  };
  assert.equal(
    (await billing.getBillingAccess("qa.myshopify.com")).isPaid,
    true,
  );
  state.row.currentPeriodEnd = new Date(Date.now() - 1);
  assert.equal(
    (await billing.getBillingAccess("qa.myshopify.com")).isPaid,
    false,
  );
});

test("subscription webhook mirroring invalidates cached billing display", async () => {
  const { state, billing } = billingHarness();
  await billing.getBillingDisplayAccess("qa.myshopify.com");
  await billing.syncShopBillingFromSubscription("qa.myshopify.com", {
    name: "Whisper",
    status: "ACTIVE",
  });
  assert.equal(state.row.plan, "WHISPER");
  assert.equal(
    (await billing.getBillingDisplayAccess("qa.myshopify.com")).isPaid,
    true,
  );
});

test("layout authenticates but never waits on billing, analytics, or eager page preloads", async () => {
  let authenticated = 0;
  const route = loadModule("app/routes/app.tsx", {
    "../shopify.server": {
      authenticate: {
        admin: async () => {
          authenticated++;
          return { session: { shop: "qa.myshopify.com" } };
        },
      },
    },
    "../components/BackgroundBillingSync": {},
    "../utils/features": { COMMUNITY_FEATURES_ENABLED: false },
    "../utils/page-snapshot-navigation": {},
    "../utils/i18n": {},
    "../utils/i18n.server": { resolveRequestLocale: async () => "en" },
    "@shopify/polaris/build/esm/styles.css?url": "qa.css",
  });
  assert.equal(
    (await route.loader({ request: new Request("https://qa.test/app") }))
      .apiKey,
    "qa-key",
  );
  assert.equal(authenticated, 1);
  const currentUrl = new URL("https://qa.test/app?shop=qa.myshopify.com");
  const nextUrl = new URL("https://qa.test/app/projects?shop=qa.myshopify.com");
  assert.equal(route.shouldRevalidate({ currentUrl, nextUrl }), false);
  assert.equal(route.shouldRevalidate({ currentUrl, nextUrl, formAction: "/api/locale" }), true);
  assert.equal(route.shouldRevalidate({ currentUrl, nextUrl: new URL("https://qa.test/app?shop=qa.myshopify.com&locale=de") }), true);
  assert.doesNotMatch(
    source("app/routes/app.tsx"),
    /PrefetchPageLinks|prefetch="render"|reconcileShopBillingFromShopify/,
  );
  assert.match(source("app/routes/app.tsx"), /prefetch="intent"/);
});

test("Projects dashboard returns recent projects without requesting Shopify analytics or source discovery", { timeout: 1000 }, async () => {
  let analyticsRequests = 0;
  const lookups = [];
  const route = loadModule("app/routes/app._index.tsx", {
    "../shopify.server": { authenticate: { admin: async () => ({ session: { shop: "qa.myshopify.com" }, admin: { graphql: () => { analyticsRequests++; return new Promise(() => {}); } } }) } },
    "../utils/growth-projects.server": { listGrowthProjects: async (shop) => { lookups.push(shop); return { projects: Array.from({ length: 8 }, (_, index) => ({ id: `project-${index}` })) }; } },
    "../components/GrowthProjectList": {}, "../components/GrowthProjectForm": {}, "../components/GrowthOverviewCard": {},
    "../utils/i18n": {}, "../styles/projects.css?url": "test.css",
  });
  const response = await route.loader({ request: new Request("https://qa.test/app?shop=other.myshopify.com") });
  const data = await response.json();
  assert.equal(data.shop, "qa.myshopify.com");
  assert.deepEqual(lookups, ["qa.myshopify.com"]);
  assert.equal(data.projects.length, 5);
  assert.equal(analyticsRequests, 0);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal("conversionDashboard" in data, false);
  assert.doesNotMatch(source("app/routes/app._index.tsx"), /getGrowthMetrics|getConversionProgress|getProjectSources|discover.*Sources/);
  assert.match(source("app/components/GrowthOverviewCard.tsx"), /useBackgroundJson/);
  assert.match(source("app/components/GrowthProjectForm.tsx"), /if \(open && !projectId\)/);
});

test("preserved legacy dashboard shell returns without requesting Shopify analytics or CRO activity", async () => {
  let requests = 0;
  const db = {
    shopSettings: { findUnique: async () => null },
    storeSnapshot: {
      findMany: async ({ take }) => {
        assert.equal(take, 5);
        return [];
      },
    },
  };
  const route = loadModule("app/components/LegacySnapshotDashboard.tsx", {
    "../shopify.server": {
      authenticate: {
        admin: async () => ({
          session: { shop: "qa.myshopify.com" },
          admin: {
            graphql: () => {
              requests++;
              return new Promise(() => {});
            },
          },
        }),
      },
    },
    "../db.server": db,
    "../utils/notifications.server": {},
    "../utils/features": { COMMUNITY_FEATURES_ENABLED: false },
    "../utils/web-pixel.server": {},
    "../utils/loader-cache.server": loadCache(),
    "../utils/store-snapshot.server": {},
    "../components/PremiumGate": {},
    "../components/DashboardConversionPanel": {},
    "../components/SnapshotSetupGuide": {},
    "../utils/billing.server": {
      getBillingDisplayAccess: async () => ({ plan: "FREE" }),
    },
  });
  const response = await route.loader({
    request: new Request("https://qa.test/app"),
  });
  const data = await response.json();
  assert.equal(data.shop, "qa.myshopify.com");
  assert.equal(data.setupGuideDismissed, false);
  assert.equal(data.completedCount, 0);
  assert.equal(requests, 0);
  assert.equal("conversionDashboard" in data, false);
  assert.match(
    response.headers.get("Server-Timing"),
    /auth;dur=\d+, shell;dur=\d+/,
  );
  assert.match(
    source("app/components/DashboardConversionPanel.tsx"),
    /useBackgroundJson/,
  );
  assert.match(source("app/utils/background-json.ts"), /useEffect/);
  assert.match(
    source("app/components/DashboardConversionPanel.tsx"),
    /Retry conversion report/,
  );
});

test("setup exit and restore persist only for the authenticated store and invalidate its dashboard cache", async () => {
  const dashboardSource = source("app/components/LegacySnapshotDashboard.tsx");
  assert.match(dashboardSource, /key=\{`setup:\$\{shop\}`\}/);
  assert.match(dashboardSource, /key=\{`conversion:\$\{shop\}`\}/);
  let dismissed = false;
  let failWrite = false;
  const writes = [];
  const route = loadModule("app/components/LegacySnapshotDashboard.tsx", {
    "../shopify.server": {
      authenticate: {
        admin: async () => ({
          session: { shop: "qa.myshopify.com" },
          admin: {},
        }),
      },
    },
    "../db.server": {
      shopSettings: {
        findUnique: async () => ({ setupGuideDismissed: dismissed }),
        upsert: async (input) => {
          if (failWrite) throw new Error("Database unavailable");
          writes.push(input);
          dismissed = input.update.setupGuideDismissed;
        },
      },
      storeSnapshot: { findMany: async () => [] },
    },
    "../utils/notifications.server": {},
    "../utils/features": { COMMUNITY_FEATURES_ENABLED: false },
    "../utils/web-pixel.server": {},
    "../utils/loader-cache.server": loadCache(),
    "../utils/store-snapshot.server": {},
    "../components/PremiumGate": {},
    "../components/DashboardConversionPanel": {},
    "../components/SnapshotSetupGuide": {},
    "../utils/billing.server": {
      getBillingDisplayAccess: async () => ({ plan: "FREE" }),
    },
  });
  const preference = async () =>
    (
      await (
        await route.loader({ request: new Request("https://qa.test/app") })
      ).json()
    ).setupGuideDismissed;
  const update = (action) =>
    route.action({
      request: new Request("https://qa.test/app?index", {
        method: "POST",
        body: new URLSearchParams({ action, shop: "other.myshopify.com" }),
      }),
    });
  assert.equal(await preference(), false);
  for (const [action, expected] of [
    ["dismissSetup", true],
    ["restoreSetup", false],
  ]) {
    const result = await update(action);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).setupGuideDismissed, expected);
    assert.equal(
      await preference(),
      expected,
      "A warm cache must not retain the old preference",
    );
    const saved = writes.at(-1);
    assert.equal(saved.where.shop, "qa.myshopify.com");
    assert.equal(saved.create.shop, "qa.myshopify.com");
    assert.equal(saved.create.setupGuideDismissed, expected);
  }
  failWrite = true;
  const failed = await update("dismissSetup");
  assert.equal(failed.status, 503);
  assert.match((await failed.json()).error, /Could not save/);
  assert.equal(await preference(), false);
});

test("conversion-report failures stay within the graph instead of throwing the page", async () => {
  const route = loadModule("app/routes/api.dashboard-conversion.tsx", {
    "../db.server": {},
    "../shopify.server": {
      authenticate: {
        admin: async () => ({
          session: { shop: "qa.myshopify.com" },
          admin: {},
        }),
      },
    },
    "../utils/optimization-timeline.server": {},
    "../utils/shopify-analytics.server": {
      isConversionPeriod: () => false,
      getShopifyConversionProgress: async () => {
        throw new Error("offline");
      },
    },
  });
  const response = await route.loader({
    request: new Request("https://qa.test/api/dashboard-conversion"),
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /temporarily unavailable/);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("background billing transport errors stay local and changed state refreshes only when navigation is idle", async () => {
  for (const outcome of ["network-error", "unchanged", "changed"]) {
    let refreshNeeded = false;
    let revalidations = 0;
    let timer;
    let effects = [];
    const navigation = { state: "idle" };
    const route = loadModule(
      "app/components/BackgroundBillingSync.tsx",
      {
        react: {
          useRef: (current) => ({ current }),
          useState: () => [
            refreshNeeded,
            (next) => {
              refreshNeeded = next;
            },
          ],
          useEffect: (effect) => effects.push(effect),
        },
        "@remix-run/react": {
          useNavigation: () => navigation,
          useRevalidator: () => ({
            state: "idle",
            revalidate: () => {
              revalidations++;
            },
          }),
        },
        "@shopify/app-bridge-react": {
          useAppBridge: () => ({ idToken: async () => "qa-token-only" }),
        },
      },
      {
        AbortController,
        window: {
          setTimeout: (callback) => {
            timer = callback;
            return 1;
          },
          clearTimeout() {},
        },
        fetch: async (url, options) => {
          assert.equal(url, "/api/billing-sync");
          assert.equal(options.method, "POST");
          assert.equal(options.headers.Authorization, "Bearer qa-token-only");
          assert.equal(options.credentials, "same-origin");
          if (outcome === "network-error")
            throw new TypeError("Failed to fetch");
          return json({
            billingReconciled: true,
            changed: outcome === "changed",
          });
        },
      },
    );
    route.BackgroundBillingSync();
    effects.forEach((effect) => effect());
    timer();
    await new Promise(setImmediate);
    assert.equal(
      revalidations,
      0,
      "response must not interrupt navigation itself",
    );
    assert.equal(refreshNeeded, outcome === "changed");
    navigation.state = "loading";
    effects = [];
    route.BackgroundBillingSync();
    effects.at(-1)();
    assert.equal(revalidations, 0);
    navigation.state = "idle";
    effects = [];
    route.BackgroundBillingSync();
    effects.at(-1)();
    assert.equal(revalidations, outcome === "changed" ? 1 : 0);
  }
  assert.doesNotMatch(
    source("app/components/BackgroundBillingSync.tsx"),
    /useFetcher/,
  );
});

test("background billing is authenticated, coalesced, and nonfatal on DB failure", async () => {
  let syncs = 0;
  let fail = false;
  const route = loadModule("app/routes/api.billing-sync.tsx", {
    "../db.server": {
      shopBilling: {
        findUnique: async () => {
          if (fail) throw new Error("offline");
          return null;
        },
      },
    },
    "../shopify.server": {
      authenticate: {
        admin: async () => ({
          session: {
            shop: fail ? "offline.myshopify.com" : "qa.myshopify.com",
          },
          admin: {},
        }),
      },
    },
    "../utils/billing.server": {
      reconcileShopBillingFromShopify: async () => {
        syncs++;
        return null;
      },
    },
    "../utils/loader-cache.server": loadCache(),
  });
  const args = () => ({
    request: new Request("https://qa.test/api/billing-sync", {
      method: "POST",
    }),
  });
  const replies = await Promise.all(
    Array.from({ length: 8 }, () => route.action(args())),
  );
  assert.equal(syncs, 1);
  assert.equal((await replies[0].json()).changed, false);
  fail = true;
  const fallback = await route.action(args());
  assert.equal(fallback.status, 200);
  assert.equal((await fallback.json()).changed, false);
});

test("store shell routes no longer await live storefront checks", () => {
  for (const file of [
    "app/routes/app.store-snapshots._index.tsx",
    "app/routes/app.store-snapshots.$id.tsx",
  ]) {
    assert.doesNotMatch(source(file), /getStorefrontTrackerStatus/);
    assert.match(source(file), /<StorefrontTrackingStatus \/>/);
  }
  assert.match(
    source("app/components/StorefrontTrackingStatus.tsx"),
    /useBackgroundJson/,
  );
});
