// DB-free A/B graph split, cache invalidation, and first-paint regressions.
// Run: node --test scripts/check-ab-test-activity.mjs
// Optional: node scripts/check-ab-test-activity.mjs --compare-head
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
const listPath = "app/routes/app.ab-tests._index.tsx";
const listSource = read(listPath);
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
  const mod = { exports: {} };
  runInNewContext(compiled.outputText, {
    exports: mod.exports,
    module: mod,
    require: (specifier) =>
      specifier in mocks ? mocks[specifier] : require(specifier),
    URL,
    Request,
    Response,
    FormData,
    ...globals,
  });
  return mod.exports;
}

function harness(source = listSource) {
  const calls = [];
  const state = {
    shop: "alpha.myshopify.com",
    now: 1_000,
    authError: null,
    graphError: null,
    graphWait: null,
    mutationError: null,
    guardError: null,
    missingTest: false,
    effects: [],
    timers: new Map(),
    nextTimer: 1,
    loads: [],
    retry: null,
  };
  class Clock extends Date {
    static now() {
      return state.now;
    }
  }
  const cache = compile(
    read("app/utils/loader-cache.server.ts"),
    {},
    { Date: Clock },
  );
  const activity = {
    getDashboardAbTestActivity: async (shop) => {
      calls.push({ kind: "graph", shop });
      if (state.graphWait) await state.graphWait;
      if (state.graphError) throw state.graphError;
      return {
        id: "ab-tests",
        title: `${shop} A/B performance`,
        chart: { current: [1, 2], previous: [2, 1] },
      };
    },
  };
  const activityCache = compile(read("app/utils/ab-test-activity.server.ts"), {
    "./loader-cache.server": cache,
    "./dashboard-activity.server": activity,
  });
  const date = new Date("2026-08-26T10:00:00Z");
  const row = {
    id: "test-one",
    name: "Real fixture test",
    status: "LIVE",
    targetPageType: "PRODUCT",
    goal: "CONVERSION",
    createdAt: date,
    launchedAt: date,
    pausedAt: null,
    endedAt: null,
    variants: [
      {
        id: "variant-a",
        key: "A",
        templateName: "Default",
        templateSuffix: null,
        createdAt: date,
        updatedAt: date,
      },
    ],
  };
  const billing = {
    planName: "Whisper",
    canCreateAbTest: true,
    usage: { abTests: 1 },
    limits: { abTests: 5 },
  };
  const snapshot = {
    id: "snapshot-one",
    number: 1,
    name: "Baseline",
    targetVisitors: 1000,
    createdAt: date,
    completedAt: date,
    project: {
      resourceType: "PRODUCT",
      productTitle: "Product one",
      productHandle: "one",
    },
    statsCache: { stats: { realCount: 10, totalSessions: 12, convRate: 10 } },
    _count: { visits: 12 },
  };
  const mutation = async (kind, args) => {
    calls.push({ kind, args });
    if (state.mutationError) throw state.mutationError;
    return { ...row, count: 1 };
  };
  const fetcher = {
    state: "idle",
    data: undefined,
    load: (url) => state.loads.push(url),
  };
  const mocks = {
    react: {
      ...React,
      useRef: (value) => ({ current: value }),
      useEffect: (effect) => state.effects.push(effect),
    },
    "@remix-run/react": { useFetcher: () => fetcher },
    "@shopify/polaris": {
      ...polaris,
      Button: (props) => {
        state.retry = props.onClick;
        return React.createElement(polaris.Button, props);
      },
    },
    "@shopify/app-bridge-react": { TitleBar: () => null, Modal: () => null },
    "../components/AbTestDetailReport": { AbTestDetailReport: () => null },
    "../components/PremiumGate": {
      PremiumGateCard: () => null,
      planUsagePillLabel: () => "Whisper",
    },
    "../components/ResourceActivityChart": {
      ResourceActivityChart: ({ card }) =>
        React.createElement("section", { "data-graph": "ready" }, card.title),
    },
    "../shopify.server": {
      authenticate: {
        admin: async () => {
          calls.push({ kind: "auth" });
          if (state.authError) throw state.authError;
          return {
            session: { shop: state.shop, scope: "read_themes,write_themes" },
            admin: {},
          };
        },
      },
    },
    "../utils/loader-cache.server": cache,
    "../utils/dashboard-activity.server": activity,
    "../utils/ab-test-activity.server": activityCache,
    "../utils/billing.server": {
      getBillingDisplayAccess: async (shop) => {
        calls.push({ kind: "displayBilling", shop });
        return billing;
      },
      getBillingAccess: async (shop) => {
        calls.push({ kind: "freshBilling", shop });
        return billing;
      },
      assertCanCreateAbTest: async (shop) => {
        calls.push({ kind: "guard", shop });
        if (state.guardError) throw state.guardError;
      },
      isPlanLimitError: (error) => error?.code === "PLAN_LIMIT",
      planLimitPayload: (error) => ({ error: error.message }),
    },
    "../utils/ab-tests.server": {
      getThemeTemplateOptions: async () => {
        calls.push({ kind: "templates" });
        return {
          needsThemeScope: false,
          templates: [
            { filename: "templates/product.json", templateName: "Default" },
          ],
        };
      },
      normalizeAbTestPageType: (value) => value || "PRODUCT",
      normalizeAbTestGoal: (value) => value || "CONVERSION",
      createTemplateAbTest: (args) => mutation("create", args),
    },
    "../db.server": {
      abTest: {
        findMany: async (args) => {
          calls.push({ kind: "tests", args });
          return [row];
        },
        findFirst: async (args) => {
          calls.push({ kind: "findTest", args });
          return state.missingTest ? null : row;
        },
        updateMany: (args) => mutation("pauseOthers", args),
        update: (args) => mutation("update", args),
        delete: (args) => mutation("delete", args),
      },
      snapshot: {
        findMany: async (args) => {
          calls.push({ kind: "snapshots", args });
          return [snapshot];
        },
      },
      abTestAssignment: {
        groupBy: async (args) => {
          calls.push({ kind: "rowStats", args });
          return [
            {
              variantId: "variant-a",
              visitorType: "REAL",
              converted: false,
              _count: { _all: 90 },
              _sum: { orderValue: null },
            },
            {
              variantId: "variant-a",
              visitorType: "REAL",
              converted: true,
              _count: { _all: 10 },
              _sum: { orderValue: 200 },
            },
            {
              variantId: "variant-a",
              visitorType: "BOT",
              converted: false,
              _count: { _all: 1000 },
              _sum: { orderValue: null },
            },
          ];
        },
      },
    },
  };
  const globals = {
    console: { error: () => {} },
    window: {
      setTimeout: (callback, delay) => {
        const id = state.nextTimer++;
        state.timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: (id) => state.timers.delete(id),
    },
  };
  const list = compile(
    `${source}${source.includes("function AbTestActivityPanel") ? "\nexport { AbTestActivityPanel };" : ""}`,
    mocks,
    globals,
  );
  const detail = compile(
    read("app/routes/app.ab-tests.$id.tsx"),
    mocks,
    globals,
  );
  const load = (query = "") =>
    list.loader({
      request: new Request(`https://app.example/app/ab-tests${query}`),
      params: {},
    });
  const action = (route, kind, extra = {}) =>
    route.action({
      request: new Request("https://app.example/app/ab-tests", {
        method: "POST",
        body: new URLSearchParams({
          action: kind,
          testId: "test-one",
          ...extra,
        }),
      }),
      params: { id: "test-one" },
    });
  const render = () => {
    state.effects = [];
    state.retry = null;
    return renderToStaticMarkup(
      React.createElement(
        polaris.AppProvider,
        { i18n },
        React.createElement(list.AbTestActivityPanel, { shop: state.shop }),
      ),
    );
  };
  return {
    state,
    calls,
    list,
    detail,
    load,
    action,
    render,
    fetcher,
    cache,
    activityCache,
  };
}

const count = (h, kind) => h.calls.filter((call) => call.kind === kind).length;

test("first paint preserves list metrics and wizard data without starting the graph", async () => {
  const h = harness();
  h.state.graphError = new Error("Must not block first paint");
  const data = await (await h.load()).json();
  assert.equal(data.shop, h.state.shop);
  assert.equal(data.tests[0].name, "Real fixture test");
  assert.equal(data.rowStatsByVariant["variant-a"].conversionRate, 10);
  assert.equal(data.rowStatsByVariant["variant-a"].revenue, 200);
  assert.equal(data.completedSnapshots[0].realCount, 10);
  assert.equal(
    data.themeTemplates.templates[0].filename,
    "templates/product.json",
  );
  assert.equal(data.canWriteThemes, true);
  assert.ok(!("activityCard" in data));
  for (const kind of [
    "auth",
    "tests",
    "rowStats",
    "templates",
    "snapshots",
    "displayBilling",
  ])
    assert.equal(count(h, kind), 1, kind);
  assert.equal(count(h, "graph"), 0);
  assert.equal(count(h, "freshBilling"), 0);
  for (const kind of ["tests", "rowStats"])
    assert.equal(
      h.calls.find((call) => call.kind === kind).args.where.shop,
      h.state.shop,
    );
  assert.match(listSource, /<AbTestActivityPanel shop=\{shop\}/);
});

test("background activity authenticates before cache access and skips list, billing and picker work", async () => {
  const h = harness();
  const data = await (
    await h.load("?_activity=1&shop=untrusted.myshopify.com")
  ).json();
  assert.equal(data.shop, "alpha.myshopify.com");
  assert.match(data.activityCard.title, /alpha/);
  assert.equal(count(h, "graph"), 1);
  for (const kind of [
    "tests",
    "rowStats",
    "templates",
    "snapshots",
    "displayBilling",
    "freshBilling",
  ])
    assert.equal(count(h, kind), 0, kind);
  h.state.authError = new Response("Unauthorized", { status: 401 });
  await assert.rejects(h.load("?_activity=1"), (error) => error.status === 401);
  assert.equal(count(h, "graph"), 1);
});

test("the graph cache is shop-scoped, coalesced, and expires after sixty seconds", async () => {
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
  h.state.now += 59_999;
  await h.load("?_activity=1");
  assert.equal(count(h, "graph"), 1);
  h.state.now += 1;
  await h.load("?_activity=1");
  assert.equal(count(h, "graph"), 2);
  h.state.shop = "beta.myshopify.com";
  const data = await (await h.load("?_activity=1")).json();
  assert.match(data.activityCard.title, /beta/);
  assert.equal(count(h, "graph"), 3);
  assert.equal(count(h, "auth"), 5);
});

test("graph failures remain inline and a retry is not served a cached failure", async () => {
  const h = harness();
  h.state.graphError = new Error("private database error");
  const failed = await h.load("?_activity=1");
  assert.equal(failed.status, 503);
  const data = await failed.json();
  assert.match(data.error, /test list is still available/);
  assert.doesNotMatch(JSON.stringify(data), /private database error/);
  h.fetcher.data = data;
  assert.match(h.render(), /Performance graph unavailable/);
  assert.equal(typeof h.state.retry, "function");
  h.state.retry();
  assert.deepEqual(h.state.loads, ["/app/ab-tests?_activity=1"]);
  h.state.graphError = null;
  assert.ok((await (await h.load("?_activity=1")).json()).activityCard);
  assert.equal(count(h, "graph"), 2);
});

test("list and detail lifecycle actions invalidate only this shop's graph after successful writes", async () => {
  for (const routeName of ["list", "detail"]) {
    for (const kind of [
      "launch-test",
      "pause-test",
      "end-test",
      "delete-test",
    ]) {
      const h = harness();
      await h.load("?_activity=1");
      h.state.shop = "beta.myshopify.com";
      await h.load("?_activity=1");
      h.state.shop = "alpha.myshopify.com";
      const response = await h.action(h[routeName], kind);
      assert.equal(response.status, 302, `${routeName} ${kind}`);
      assert.equal(
        h.calls.find((call) => call.kind === "findTest").args.where.shop,
        "alpha.myshopify.com",
      );
      await h.load("?_activity=1");
      assert.equal(
        count(h, "graph"),
        3,
        `${routeName} ${kind} invalidates the graph`,
      );
      h.state.shop = "beta.myshopify.com";
      await h.load("?_activity=1");
      assert.equal(count(h, "graph"), 3, "Other shops keep their cached graph");
    }
  }
});

test("failed/missing mutations neither clear a valid graph nor bypass shop lookup", async () => {
  for (const routeName of ["list", "detail"]) {
    const h = harness();
    await h.load("?_activity=1");
    h.state.missingTest = true;
    assert.equal((await h.action(h[routeName], "delete-test")).status, 404);
    assert.equal(count(h, "delete"), 0);
    h.state.missingTest = false;
    h.state.mutationError = new Error("write failure");
    await assert.rejects(h.action(h[routeName], "pause-test"), /write failure/);
    await h.load("?_activity=1");
    assert.equal(count(h, "graph"), 1);
  }
});

test("creating a test keeps fresh billing authorization and invalidates the graph only on success", async () => {
  const h = harness();
  await h.load("?_activity=1");
  h.state.guardError = Object.assign(new Error("Upgrade required"), {
    code: "PLAN_LIMIT",
    status: 402,
  });
  const form = {
    targetPageType: "PRODUCT",
    variantTemplateSuffix: "test-b",
    variantTemplateFileName: "templates/product.test-b.json",
  };
  assert.equal(
    (await h.action(h.list, "create-template-test", form)).status,
    402,
  );
  assert.equal(count(h, "create"), 0);
  await h.load("?_activity=1");
  assert.equal(count(h, "graph"), 1);
  h.state.guardError = null;
  assert.equal(
    (await h.action(h.list, "create-template-test", form)).status,
    302,
  );
  await h.load("?_activity=1");
  assert.equal(count(h, "graph"), 2);
  assert.equal(count(h, "guard"), 2);
  assert.equal(count(h, "displayBilling"), 0);
});

test("the graph panel renders a structural skeleton, defers loading, cancels unstarted work and ignores other shops", () => {
  const h = harness();
  assert.match(h.render(), /Loading A\/B test performance/);
  assert.match(h.render(), /Polaris-SkeletonDisplayText/);
  assert.equal(h.state.loads.length, 0);
  const cleanups = h.state.effects.map((effect) => effect()).filter(Boolean);
  assert.equal(h.state.loads.length, 0);
  const timer = Array.from(h.state.timers.values())[0];
  assert.equal(timer.delay, 150);
  timer.callback();
  assert.deepEqual(h.state.loads, ["/app/ab-tests?_activity=1"]);
  for (const cleanup of cleanups) cleanup();
  assert.equal(h.state.timers.size, 0);
  h.fetcher.data = {
    shop: "beta.myshopify.com",
    activityCard: { title: "Private other shop" },
  };
  const stale = h.render();
  assert.match(stale, /Loading A\/B test performance/);
  assert.doesNotMatch(stale, /Private other shop/);
  h.fetcher.data = {
    shop: h.state.shop,
    activityCard: { title: "Current shop graph" },
  };
  assert.match(h.render(), /data-graph="ready"[^>]*>Current shop graph/);
});

if (process.argv.includes("--compare-head")) {
  const previous = execFileSync("git", ["show", `HEAD:${listPath}`], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  });
  const before = harness(previous);
  const beforeData = await (await before.load()).json();
  const after = harness();
  const afterData = await (await after.load()).json();
  delete beforeData.activityCard;
  assert.deepEqual(
    afterData,
    beforeData,
    "All non-graph list/wizard payload fields remain identical to HEAD",
  );
  for (const [label, h] of [
    ["HEAD before", before],
    ["Working tree after", after],
  ]) {
    console.log(
      `${label}: ${JSON.stringify(Object.fromEntries(["tests", "rowStats", "templates", "snapshots", "graph", "freshBilling", "displayBilling"].map((kind) => [kind, count(h, kind)])))}`,
    );
  }
}
