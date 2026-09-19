// Local regression checks for the four findings in customer-snapshots-qa-2026-09-17.md.
// Executes the real modules with explicit boundary mocks; no production writes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

function load(file, mocks = {}, globals = {}, extra = "") {
  const source =
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8") + extra;
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (name) => {
      if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`);
      return mocks[name];
    },
    URL,
    Response,
    Blob,
    AbortController,
    setTimeout,
    clearTimeout,
    ...globals,
  });
  return module.exports;
}

function statusHarness(
  body,
  {
    url = "https://shop.example/",
    contentType = "text/html",
    status = 200,
    fail = false,
  } = {},
) {
  const { getStorefrontTrackerStatus } = load(
    "app/utils/storefront-tracker-status.server.ts",
    {},
    {
      fetch: async () => {
        if (fail) throw new Error("network unavailable");
        const response = new Response(body, {
          status,
          headers: { "Content-Type": contentType },
        });
        Object.defineProperty(response, "url", { value: url });
        return response;
      },
    },
  );
  return () =>
    getStorefrontTrackerStatus(
      { graphql: async () => Response.json({ data: { shop: {} } }) },
      "shop.example",
    );
}
test("password redirect is unknown, never a missing embed", async () => {
  const result = await statusHarness(
    '<form action="/password"><input name="password"></form>',
    { url: "https://shop.example/password" },
  )();
  assert.equal(result.status, "unknown");
  assert.match(result.message, /password/);
});
test("password form/challenge at original URL remains unverified", async () => {
  for (const html of [
    '<input name="password">',
    '<script src="/cdn-cgi/challenge-platform/x"></script>',
  ]) {
    assert.equal((await statusHarness(html)()).status, "unknown");
  }
});
test("known storefront with and without tracker is detected correctly", async () => {
  assert.equal(
    (
      await statusHarness(
        '<script>Shopify.shop = "shop.example"</script><script src="tracker.js"></script>',
      )()
    ).status,
    "active",
  );
  assert.equal(
    (await statusHarness('<div id="shopify-section-header">Store</div>')())
      .status,
    "missing",
  );
});
test("non-storefront, non-HTML, HTTP failures and network failures remain unknown", async () => {
  for (const [body, options] of [
    ["Maintenance", {}],
    ['Shopify.shop = "x"', { contentType: "application/json" }],
    ["Denied", { status: 403 }],
    ["", { fail: true }],
  ]) {
    assert.equal((await statusHarness(body, options)()).status, "unknown");
  }
});

const orderDate = new Date("2026-09-17T00:00:00Z");
function storeHarness(rows = [], cached = null) {
  const calls = { queries: [], updates: [], cacheWrites: [] };
  const snapshot = {
    id: "old-active",
    shop: "shop.example",
    status: "ACTIVE",
    startedAt: new Date("2026-07-01T00:00:00Z"),
    completionMode: "HUMAN_VISITORS",
    targetHumanVisitors: 100,
    completedAt: null,
    statsCache: cached,
  };
  const db = {
    storeSnapshotVisit: {
      findMany: async (query) => {
        calls.queries.push(query);
        if (!query.where.sessionId) return rows;
        const w = query.where;
        return rows.filter(
          (row) =>
            row.sessionId === w.sessionId &&
            row.startedAt >= w.startedAt.gte &&
            row.startedAt <= w.startedAt.lte &&
            row.storeSnapshot.shop === w.storeSnapshot.shop &&
            w.storeSnapshot.status.in.includes(row.storeSnapshot.status) &&
            row.storeSnapshot.startedAt <= w.storeSnapshot.startedAt.lte &&
            !row[w.converted === false ? "converted" : "checkoutStarted"],
        );
      },
      update: async (input) => {
        calls.updates.push(input);
        return {};
      },
    },
    storeSnapshot: {
      findUnique: async () => snapshot,
      findFirst: async () => null,
    },
    storeSnapshotStatsCache: {
      deleteMany: async () => ({}),
      upsert: async (input) => calls.cacheWrites.push(input),
    },
    storeSnapshotRecommendation: {
      deleteMany: async () => ({}),
      create: async () => ({ id: "recommendation" }),
    },
    storeSnapshotPageAggregate: {
      deleteMany: async () => ({}),
      create: async () => ({ id: "aggregate" }),
    },
  };
  const mod = load(
    "app/utils/store-snapshot.server.ts",
    {
      "../db.server": db,
      "./notifications.server": { createNotification: async () => {} },
      "./loader-cache.server": { clearCacheKey: () => {}, loaderCacheKeys: {} },
    },
    {},
    "\nexport { classifyStoreSessions, computeStoreSnapshotStats };\n",
  );
  return { ...mod, calls, snapshot };
}
function visit(sessionId, visitorType, extra = {}) {
  return {
    id: `${sessionId}-${visitorType}`,
    sessionId,
    visitorType,
    storeSnapshotId: "old-active",
    pagePath: "/products/test",
    pageTitle: "Test",
    resourceType: "PRODUCT",
    resourceHandle: "test",
    isLandingPage: true,
    timeOnPage: 10000,
    scrollDepth: 50,
    addedToCart: false,
    checkoutStarted: false,
    converted: false,
    orderValue: null,
    ctaClicks: null,
    searchQuery: null,
    exitType: null,
    filterInteractions: 0,
    startedAt: new Date("2026-09-16T23:00:00Z"),
    endedAt: null,
    storeSnapshot: {
      shop: "shop.example",
      status: "ACTIVE",
      startedAt: new Date("2026-07-01T00:00:00Z"),
    },
    ...extra,
  };
}
test("visitor quality is mutually exclusive and independent of row ordering", () => {
  const rows = [
    visit("a", "ZOMBIE"),
    visit("a", "REAL"),
    visit("b", "ZOMBIE"),
    visit("b", "PENDING"),
    visit("c", "BOT"),
    visit("d", "PENDING"),
  ];
  const { classifyStoreSessions } = storeHarness();
  for (const ordered of [rows, [...rows].reverse()]) {
    const classes = classifyStoreSessions(ordered);
    assert.equal(classes.size, 4);
    assert.deepEqual(
      ["a", "b", "c", "d"].map((id) => classes.get(id)),
      ["REAL", "ZOMBIE", "BOT", "PENDING"],
    );
  }
});
test("whole-session metrics retain commerce on a Zombie page of a Real session", async () => {
  const h = storeHarness([
    visit("a", "ZOMBIE", {
      addedToCart: true,
      converted: true,
      orderValue: 10,
    }),
    visit("a", "REAL"),
    visit("b", "ZOMBIE"),
  ]);
  const stats = await h.computeStoreSnapshotStats(h.snapshot);
  assert.equal(stats.visitorBreakdown.total, 2);
  assert.equal(stats.visitorBreakdown.humans, 1);
  assert.equal(stats.visitorBreakdown.zombies, 1);
  assert.equal(stats.metrics.orderCount, 1);
  assert.equal(stats.metrics.revenue, 10);
  assert.equal(stats.metrics.conversionRate, 100);
  assert.equal(stats.metrics.addToCartRate, 100);
});
test("old overlapping caches recompute; versioned caches are reused", async () => {
  const old = storeHarness([], {
    stats: { stale: true },
    recomputedAt: new Date(),
  });
  assert.equal((await old.getStoreSnapshotStats("old-active")).version, 2);
  assert.equal(old.calls.cacheWrites.length, 1);
  const current = storeHarness([], {
    stats: { version: 2, sentinel: true },
    recomputedAt: new Date(),
  });
  assert.equal(
    (await current.getStoreSnapshotStats("old-active")).sentinel,
    true,
  );
  assert.equal(current.calls.queries.length, 0);
});
for (const event of ["purchase", "checkout"]) {
  test(`${event}: old active/completed captures accept recent visits; stale/future/cross-tenant/paused visits do not`, async () => {
    const recent = visit("qa", "REAL");
    const completed = visit("qa", "REAL", {
      id: "completed",
      storeSnapshotId: "completed",
      storeSnapshot: { ...recent.storeSnapshot, status: "COMPLETED" },
    });
    const h = storeHarness([
      recent,
      completed,
      visit("qa", "REAL", { id: "stale", startedAt: new Date("2026-08-01") }),
      visit("qa", "REAL", { id: "future", startedAt: new Date("2026-09-18") }),
      visit("qa", "REAL", {
        id: "other",
        storeSnapshot: { ...recent.storeSnapshot, shop: "other.example" },
      }),
      visit("qa", "REAL", {
        id: "paused",
        storeSnapshot: { ...recent.storeSnapshot, status: "PAUSED" },
      }),
    ]);
    const args = {
      shop: "shop.example",
      sessionId: "qa",
      timestamp: orderDate,
      totalPrice: 10,
      currency: "USD",
    };
    const count = await (event === "purchase"
      ? h.attributeStoreSnapshotOrder(args)
      : h.updateStoreSnapshotCheckoutStarted(args));
    assert.equal(count, 2);
    assert.deepEqual(
      h.calls.updates.map((x) => x.where.id),
      [recent.id, "completed"],
    );
    assert.equal(
      h.calls.queries[0].where.storeSnapshot.startedAt.gte,
      undefined,
    );
  });
}
test("invalid event dates do not query or mutate reporting data", async () => {
  const h = storeHarness();
  const args = { shop: "shop.example", sessionId: "qa", timestamp: "invalid" };
  assert.equal(await h.attributeStoreSnapshotOrder(args), 0);
  assert.equal(await h.updateStoreSnapshotCheckoutStarted(args), 0);
  assert.equal(h.calls.queries.length, 0);
});

function downloadHarness({
  response = () =>
    Response.json({ id: "visitor-1", snapshotId: "qa", pages: [], events: [] }),
  token = "fixture-token",
} = {}) {
  const calls = {
    fetch: [],
    clicks: 0,
    removed: 0,
    revoked: [],
    timers: [],
    tokens: 0,
    blobs: [],
  };
  const link = { click: () => calls.clicks++, remove: () => calls.removed++ };
  const { downloadCustomerJourney } = load(
    "app/utils/customer-journey-download.ts",
    {},
    {
      fetch: async (...args) => {
        calls.fetch.push(args);
        return response();
      },
      URL: {
        createObjectURL: (blob) => {
          calls.blobs.push(blob);
          return "blob:fixture";
        },
        revokeObjectURL: (url) => calls.revoked.push(url),
      },
      document: { createElement: () => link, body: { appendChild: () => {} } },
      window: { setTimeout: (fn) => calls.timers.push(fn) },
    },
  );
  const controller = new AbortController();
  const options = {
    snapshotId: "qa",
    sessionId: "visitor-1",
    signal: controller.signal,
    getIdToken: async () => {
      calls.tokens++;
      return token;
    },
  };
  return {
    calls,
    link,
    controller,
    options,
    run: (overrides = {}) =>
      downloadCustomerJourney({ ...options, ...overrides }),
  };
}
test("export uses a fresh bearer token, downloads JSON, and never redirects/navigates", async () => {
  const h = downloadHarness();
  await h.run();
  assert.equal(h.calls.tokens, 1);
  assert.equal(
    h.calls.fetch[0][0],
    "/app/customer-snapshots/qa/journey/visitor-1/export",
  );
  assert.equal(h.calls.fetch[0][1].redirect, "error");
  assert.equal(
    h.calls.fetch[0][1].headers.Authorization,
    "Bearer fixture-token",
  );
  assert.equal(h.calls.clicks, 1);
  assert.equal(h.link.download, "customer-journey-visitor-1.json");
  assert.equal(h.calls.removed, 1);
  assert.equal(JSON.parse(await h.calls.blobs[0].text()).id, "visitor-1");
  h.calls.timers.forEach((fn) => fn());
  assert.deepEqual(h.calls.revoked, ["blob:fixture"]);
});
test("export rejects auth failures, HTML and mismatched resources without downloading", async () => {
  for (const response of [
    () => new Response("Unauthorized", { status: 401 }),
    () => new Response("Login", { headers: { "Content-Type": "text/html" } }),
    () =>
      Response.json({ id: "other", snapshotId: "qa", pages: [], events: [] }),
    () =>
      Response.json({
        id: "visitor-1",
        snapshotId: "other",
        pages: [],
        events: [],
      }),
  ]) {
    const h = downloadHarness({ response });
    await assert.rejects(h.run());
    assert.equal(h.calls.clicks, 0);
  }
});
test("export rejects invalid identifiers, missing tokens and cancellation", async () => {
  const h = downloadHarness();
  await assert.rejects(h.run({ snapshotId: "../other" }));
  assert.equal(h.calls.tokens, 0);
  h.controller.abort();
  await assert.rejects(h.run());
  assert.equal(h.calls.fetch.length, 0);
  const missing = downloadHarness({ token: "" });
  await assert.rejects(missing.run());
  assert.equal(missing.calls.fetch.length, 0);
});
