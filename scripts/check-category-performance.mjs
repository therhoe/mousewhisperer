// DB-free request-count, tenant-isolation, cache, and rendered loading-state checks.
// Run: node --test scripts/check-category-performance.mjs
// Optional historical comparison: node scripts/check-category-performance.mjs --compare-head
/* eslint jest/no-deprecated-functions: "off", jest/expect-expect: ["error", { "assertFunctionNames": ["assert", "assert.*"] }] */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const routePath = "app/routes/app.audits.$category.tsx";
const routeSource = read(routePath);
const polaris = require("@shopify/polaris");
const i18n = require("@shopify/polaris/locales/en.json");

function compile(source, mocks = {}, globals = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const runtimeModule = { exports: {} };
  runInNewContext(compiled.outputText, {
    exports: runtimeModule.exports,
    module: runtimeModule,
    require: (specifier) =>
      specifier in mocks ? mocks[specifier] : require(specifier),
    URL,
    Request,
    Response,
    FormData,
    process: { env: { NODE_ENV: "test" } },
    ...globals,
  });
  return runtimeModule.exports;
}

const navigationHelpers = compile(
  read("app/utils/page-snapshot-navigation.ts"),
);
const billing = {
  planName: "Whisper",
  canCreateNormalSnapshot: true,
  usage: { normalSnapshots: 1 },
  limits: { normalSnapshots: 50 },
};

function graph(shop, category) {
  return {
    id: category,
    title: `${shop}:${category}`,
    chart: { current: [1, 2], previous: [2, 1] },
  };
}

function harness(source = routeSource) {
  let clock = 1_000;
  const calls = [];
  const state = {
    shop: "alpha.myshopify.com",
    authError: null,
    graphError: null,
    guardError: null,
    graphWait: null,
    loaderData: null,
    navigation: { state: "idle" },
    navigations: [],
    effects: [],
    timers: new Map(),
    nextTimer: 1,
    fetcherIndex: 0,
    fetcherLoads: [],
    tabs: null,
  };
  class Clock extends Date {
    static now() {
      return clock;
    }
  }
  const cache = compile(
    read("app/utils/loader-cache.server.ts"),
    {},
    { Date: Clock },
  );
  const fetcher = (kind) => ({
    state: "idle",
    data: undefined,
    load: (url) => state.fetcherLoads.push({ kind, url }),
  });
  const fetchers = [
    fetcher("resource"),
    fetcher("summary"),
    fetcher("activity"),
  ];
  const mocks = {
    react: {
      ...React,
      useState: (initial) => [
        typeof initial === "function" ? initial() : initial,
        () => {},
      ],
      useRef: (initial) => ({ current: initial }),
      useCallback: (callback) => callback,
      useEffect: (effect) => state.effects.push(effect),
    },
    "@shopify/polaris": {
      ...polaris,
      Tabs: (props) => {
        state.tabs = props;
        return React.createElement(polaris.Tabs, props);
      },
    },
    "@shopify/app-bridge-react": {
      TitleBar: ({ title, children }) =>
        React.createElement("header", { title }, children),
    },
    "@remix-run/react": {
      useLoaderData: () => state.loaderData,
      useNavigation: () => state.navigation,
      useNavigate: () => (path) => state.navigations.push(path),
      useSubmit: () => () => {},
      useFetcher: () => fetchers[state.fetcherIndex++],
      Link: ({ to, prefetch, children, ...props }) =>
        React.createElement(
          "a",
          { ...props, href: to, "data-prefetch": prefetch },
          children,
        ),
      PrefetchPageLinks: ({ page }) =>
        React.createElement("link", { rel: "prefetch", href: page }),
    },
    "../shopify.server": {
      authenticate: {
        admin: async () => {
          calls.push({ kind: "auth" });
          if (state.authError) throw state.authError;
          return { session: { shop: state.shop }, admin: {} };
        },
      },
    },
    "../db.server": {
      $queryRaw: async (strings, ...values) => {
        const fast = strings.join("").includes('"SnapshotStatsCache"');
        calls.push({ kind: fast ? "fast" : "summary", values });
        return [
          {
            id: `${values[0]}:${values[1]}`,
            productTitle: `${values[0]} ${values[1]} audit`,
            snapshotId: "snapshot-one",
            snapshotNumber: 1,
            snapshotCount: 1,
            snapshotStatus: "ACTIVE",
            targetVisitors: 1000,
            realCount: 5,
            stats: { atcRate: 20, convRate: 10, realCount: 5 },
            sessions: 12,
            real: 10,
            atc: 2,
            conv: 1,
            revenue: 50,
          },
        ];
      },
      visit: {
        findMany: async (args) => {
          calls.push({ kind: "interactions", args });
          return [];
        },
      },
      project: new Proxy(
        {},
        {
          get: () => () =>
            assert.fail("Unexpected project mutation/read in this test"),
        },
      ),
      snapshot: new Proxy(
        {},
        {
          get: () => () =>
            assert.fail("Unexpected snapshot mutation/read in this test"),
        },
      ),
    },
    "../utils/web-pixel.server": {
      ensureWebPixel: () => assert.fail("Pixel setup is not part of a loader"),
    },
    "../utils/loader-cache.server": cache,
    "../utils/billing.server": {
      getBillingAccess: async (shop) => {
        calls.push({ kind: "freshBilling", shop });
        return billing;
      },
      getBillingDisplayAccess: async (shop) => {
        calls.push({ kind: "displayBilling", shop });
        return billing;
      },
      assertCanCreateNormalSnapshots: async (shop) => {
        calls.push({ kind: "freshGuard", shop });
        if (state.guardError) throw state.guardError;
      },
      assertSnapshotTargetAllowed: async () => {},
      isPlanLimitError: (error) => error?.code === "PLAN_LIMIT",
      planLimitPayload: (error) => ({ error: error.message }),
    },
    "../components/PremiumGate": {
      planUsagePillLabel: () => "Whisper · 1/50 snapshots",
    },
    "../components/ResourceActivityChart": {
      ResourceActivityChart: ({ card }) =>
        React.createElement("section", { "data-graph": "ready" }, card.title),
    },
    "../utils/dashboard-activity.server": {
      getDashboardResourceActivity: async (shop, category) => {
        calls.push({ kind: "graph", shop, category });
        if (state.graphWait) await state.graphWait;
        if (state.graphError) throw state.graphError;
        return graph(shop, category);
      },
    },
    "../utils/page-snapshot-navigation": navigationHelpers,
  };
  const route = compile(source, mocks, {
    Date: Clock,
    console: {
      info: () => {},
      error: (...args) => calls.push({ kind: "loggedError", args }),
    },
    window: {
      setTimeout: (callback, delay) => {
        const id = state.nextTimer++;
        state.timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: (id) => state.timers.delete(id),
    },
  });
  const load = (
    search = "",
    category = "products",
    path = `/app/page-snapshots/${category}`,
  ) =>
    route.loader({
      request: new Request(`https://app.example${path}${search}`),
      params: { category },
    });
  const render = () => {
    state.fetcherIndex = 0;
    state.effects = [];
    return renderToStaticMarkup(
      React.createElement(
        polaris.AppProvider,
        { i18n },
        React.createElement(route.default),
      ),
    );
  };
  return {
    state,
    calls,
    route,
    cache,
    load,
    render,
    fetchers,
    advance: (ms) => {
      clock += ms;
    },
  };
}

const count = (h, kind) => h.calls.filter((call) => call.kind === kind).length;

test("first paint uses only the fast summary plus display billing, never the graph or fresh guards", async () => {
  const h = harness();
  h.state.graphError = new Error("The graph must not gate first paint");
  const data = await (await h.load()).json();
  assert.equal(data.shop, h.state.shop);
  assert.equal(data.category, "products");
  assert.equal(data.summaryPending, true);
  assert.equal(data.audits.length, 1);
  assert.equal(data.billingAccess.planName, "Whisper");
  assert.ok(!("activityCard" in data));
  assert.equal(count(h, "auth"), 1);
  assert.equal(count(h, "fast"), 1);
  assert.equal(count(h, "displayBilling"), 1);
  for (const kind of [
    "summary",
    "interactions",
    "freshBilling",
    "freshGuard",
    "graph",
  ])
    assert.equal(count(h, kind), 0, kind);
});

test("row enrichment does not fetch billing or graph again and still calculates the real row metrics", async () => {
  const h = harness();
  const data = await (await h.load("?_summary=1")).json();
  assert.equal(data.audits[0].metricValues.cvrRate, 10);
  assert.equal(data.audits[0].metricValues.atcRate, 20);
  assert.equal(data.audits[0].realCount, 10);
  assert.equal(count(h, "summary"), 1);
  assert.equal(count(h, "auth"), 1);
  for (const kind of ["fast", "displayBilling", "freshBilling", "graph"])
    assert.equal(count(h, kind), 0, kind);
  assert.ok(!("billingAccess" in data));
  assert.ok(!("activityCard" in data));
  await h.load("?_summary=1", "blogs");
  assert.equal(
    count(h, "interactions"),
    1,
    "Non-product enrichment is preserved",
  );
});

test("activity fetches only the graph and caches by authenticated shop and category for 60 seconds", async () => {
  const h = harness();
  const first = await (
    await h.load("?_activity=1&shop=untrusted.myshopify.com")
  ).json();
  assert.equal(first.shop, "alpha.myshopify.com");
  assert.equal(first.activityCard.title, "alpha.myshopify.com:PRODUCT");
  await h.load("?_activity=1");
  assert.equal(count(h, "graph"), 1);
  h.advance(59_999);
  await h.load("?_activity=1");
  assert.equal(count(h, "graph"), 1);
  h.advance(1);
  await h.load("?_activity=1");
  assert.equal(count(h, "graph"), 2);
  await h.load("?_activity=1", "collections");
  h.state.shop = "beta.myshopify.com";
  const otherShop = await (await h.load("?_activity=1")).json();
  assert.equal(otherShop.activityCard.title, "beta.myshopify.com:PRODUCT");
  assert.equal(count(h, "graph"), 4);
  assert.equal(
    count(h, "auth"),
    6,
    "Even warm cache reads require authentication",
  );
  for (const kind of ["fast", "summary", "displayBilling", "freshBilling"])
    assert.equal(count(h, kind), 0, kind);
});

test("concurrent graph fetches share one load and explicit cache invalidation refreshes the graph", async () => {
  const h = harness();
  let release;
  h.state.graphWait = new Promise((resolve) => {
    release = resolve;
  });
  const pending = [h.load("?_activity=1"), h.load("?_activity=1")];
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(count(h, "graph"), 1);
  release();
  await Promise.all(pending);
  const billingKey = h.cache.loaderCacheKeys.billingDisplay(h.state.shop);
  await h.cache.cachedValue(billingKey, 30_000, async () => "mid-write usage");
  h.cache.clearCachePrefix(h.cache.loaderCacheKeys.categoryPrefix(h.state.shop));
  h.cache.clearCacheKey(billingKey);
  await h.load("?_activity=1");
  assert.equal(count(h, "graph"), 2);
  assert.equal(
    await h.cache.cachedValue(
      billingKey,
      30_000,
      async () => "post-write usage",
    ),
    "post-write usage",
    "Post-action invalidation clears billing display data refilled during a mutation",
  );
});

test("graph errors stay inline, are not cached, and can be retried without reloading rows", async () => {
  const h = harness();
  h.state.graphError = new Error("Mock database unavailable");
  const response = await h.load("?_activity=1");
  assert.equal(response.status, 503);
  const errorData = await response.json();
  assert.match(errorData.error, /audit list is still available/);
  assert.ok(!JSON.stringify(errorData).includes("Mock database unavailable"));
  h.state.loaderData = await (await h.load()).json();
  h.fetchers[2].data = errorData;
  const html = h.render();
  assert.match(html, /Performance graph unavailable/);
  assert.match(html, /Retry graph/);
  assert.match(html, /alpha\.myshopify\.com PRODUCT audit/);
  h.state.graphError = null;
  const retry = await (await h.load("?_activity=1")).json();
  assert.ok(retry.activityCard);
  assert.equal(count(h, "graph"), 2);
  assert.equal(count(h, "fast"), 1);
});

test("authentication, input validation, legacy bookmarks, and fresh mutation guards remain intact", async () => {
  const h = harness();
  h.state.authError = new Response("Unauthorized", { status: 401 });
  await assert.rejects(h.load("?_activity=1"), (error) => error.status === 401);
  assert.equal(count(h, "graph"), 0);
  h.state.authError = null;
  for (const category of ["invalid", "constructor", "__proto__"]) {
    await assert.rejects(
      h.load("?_activity=1", category),
      (error) => error.status === 404,
    );
  }
  await assert.rejects(
    h.load("?_summary=1&_activity=1"),
    (error) => error.status === 400,
  );
  const legacy = await h.load(
    "?host=embedded&_data=route",
    "products",
    "/app/audits/products",
  );
  assert.equal(legacy.status, 302);
  assert.equal(
    legacy.headers.get("Location"),
    "/app/page-snapshots/products?host=embedded",
  );
  const legacyGraph = await h.load(
    "?_activity=1",
    "products",
    "/app/audits/products",
  );
  assert.equal(legacyGraph.status, 200);
  h.state.guardError = Object.assign(new Error("Limit reached"), {
    code: "PLAN_LIMIT",
    status: 402,
  });
  const response = await h.route.action({
    request: new Request("https://app.example/app/page-snapshots/products", {
      method: "POST",
      body: new URLSearchParams({
        action: "create",
        productId: "product-one",
        productHandle: "one",
        targetVisitors: "1000",
      }),
    }),
    params: { category: "products" },
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "/app/projects?create=1");
  assert.equal(count(h, "freshGuard"), 0, "Legacy creation redirects without starting an unlinked capture");
  assert.equal(
    count(h, "displayBilling"),
    0,
    "Cached billing is never mutation authorization",
  );
});

test("the initial shell has a structural graph skeleton, intent-only links, and schedules requests after paint", async () => {
  const h = harness();
  h.state.loaderData = await (await h.load()).json();
  const html = h.render();
  assert.match(html, /Loading Products performance/);
  assert.match(html, /Polaris-SkeletonDisplayText/);
  assert.match(html, /alpha\.myshopify\.com PRODUCT audit/);
  assert.match(html, /data-prefetch="intent"/);
  assert.doesNotMatch(html, /rel="prefetch"|data-prefetch="viewport"/);
  assert.equal(h.state.fetcherLoads.length, 0);
  const cleanups = h.state.effects.map((effect) => effect()).filter(Boolean);
  assert.equal(
    h.state.fetcherLoads.length,
    0,
    "Effects schedule rather than immediately load",
  );
  assert.deepEqual(
    Array.from(h.state.timers.values())
      .map(({ delay }) => delay)
      .sort((a, b) => a - b),
    [150, 600],
  );
  for (const timer of h.state.timers.values()) timer.callback();
  assert.deepEqual(h.state.fetcherLoads, [
    { kind: "summary", url: "/app/page-snapshots/products?_summary=1" },
    { kind: "activity", url: "/app/page-snapshots/products?_activity=1" },
  ]);
  for (const cleanup of cleanups) cleanup();
  assert.equal(
    h.state.timers.size,
    0,
    "Leaving a category cancels unstarted background work",
  );
  assert.doesNotMatch(
    routeSource,
    /PrefetchPageLinks|DETAIL_PREFETCH_LIMIT|prefetch="viewport"/,
  );
});

test("tab transitions show the selected destination skeleton immediately and ignore stale tenant/category fetcher data", async () => {
  const h = harness();
  h.state.loaderData = await (await h.load()).json();
  h.fetchers[2].data = {
    shop: "alpha.myshopify.com",
    category: "products",
    activityCard: graph("alpha.myshopify.com", "PRODUCT"),
  };
  h.state.navigation = {
    state: "loading",
    location: { pathname: "/app/page-snapshots/blogs" },
  };
  const pending = h.render();
  assert.match(
    pending,
    /role="tabpanel"[^>]*aria-labelledby="page-snapshots-blogs"[^>]*aria-busy="true"/,
  );
  assert.match(pending, /Loading Blogs performance/);
  assert.match(pending, /Loading Blogs audits/);
  assert.doesNotMatch(
    pending,
    /alpha\.myshopify\.com PRODUCT audit|data-graph="ready"/,
  );
  assert.equal(h.state.tabs.selected, 4);
  h.state.tabs.onSelect(0);
  assert.deepEqual(
    h.state.navigations,
    ["/app/page-snapshots/products"],
    "Selecting the current route can cancel an in-flight tab navigation",
  );
  for (const effect of h.state.effects) effect();
  assert.equal(
    h.state.timers.size,
    0,
    "Do not start outgoing category background queries",
  );

  h.state.navigation = { state: "idle" };
  for (const stale of [
    { shop: "beta.myshopify.com", category: "products" },
    { shop: "alpha.myshopify.com", category: "blogs" },
  ]) {
    h.fetchers[1].data = {
      ...stale,
      audits: [{ productTitle: "Stale tenant audit" }],
      baseline: { metricValues: {} },
    };
    h.fetchers[2].data = {
      ...stale,
      activityCard: graph("Stale tenant", "BLOG"),
    };
    const html = h.render();
    assert.match(html, /Loading Products performance/);
    assert.doesNotMatch(html, /Stale tenant/);
  }
});

test("canonical and legacy routes share loaders and leave normal navigation revalidation enabled", () => {
  const h = harness();
  const canonical = compile(
    read("app/routes/app.page-snapshots.$category.tsx"),
    { "./app.audits.$category": h.route },
  );
  assert.equal(canonical.loader, h.route.loader);
  assert.equal(canonical.action, h.route.action);
  assert.equal(canonical.shouldRevalidate, undefined);
  assert.equal(h.route.shouldRevalidate, undefined);
  assert.doesNotMatch(routeSource, /shouldRevalidate|billing-revalidation/);
  assert.doesNotMatch(
    read("app/routes/app.page-snapshots.$category.tsx"),
    /shouldRevalidate|billing-revalidation/,
  );
});

if (process.argv.includes("--compare-head")) {
  const baselineSource = execFileSync("git", ["show", `HEAD:${routePath}`], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  });
  for (const [version, source] of [
    ["HEAD before", baselineSource],
    ["Working tree after", routeSource],
  ]) {
    for (const mode of ["", "?_summary=1"]) {
      const h = harness(source);
      await h.load(mode);
      const counts = Object.fromEntries(
        ["fast", "summary", "displayBilling", "freshBilling", "graph"].map(
          (kind) => [kind, count(h, kind)],
        ),
      );
      console.log(
        `${version} ${mode || "first paint"}: ${JSON.stringify(counts)}`,
      );
    }
  }
}
