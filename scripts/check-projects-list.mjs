// Projects list filters, counts and table (plan 2a). Read-only: mocked
// Prisma; never touches a database.
// Run: node --test scripts/check-projects-list.mjs
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

const pure = loadModule("app/utils/growth-projects.ts");

test("list filters are normalised, capped and default to everything", () => {
  const parse = (query) => pure.parseProjectListFilters(new URLSearchParams(query));
  assert.deepEqual(parse(""), { status: "ALL", scope: "ALL", query: "", page: 1 });
  assert.deepEqual(parse("status=idle&scope=page&q=%20Spring%20&page=3"), {
    status: "IDLE",
    scope: "PAGE",
    query: "Spring",
    page: 3,
  });
  assert.deepEqual(parse("status=bogus&scope=x&page=-2"), { status: "ALL", scope: "ALL", query: "", page: 1 });
  assert.equal(parse(`q=${"a".repeat(300)}`).query.length, 120);
  assert.equal(parse("q=a%00b%07c").query, "abc");
  assert.equal(parse("page=2.7").page, 2);
});

test("a project is Measuring while a capture runs, Completed when its latest finished, otherwise Idle", () => {
  assert.equal(pure.projectListStatus(null), "IDLE");
  assert.equal(pure.projectListStatus(undefined), "IDLE");
  assert.equal(pure.projectListStatus({ storeSnapshot: { status: "ACTIVE" } }), "MEASURING");
  assert.equal(pure.projectListStatus({ snapshot: { status: "COMPLETED" } }), "COMPLETED");
  assert.equal(pure.projectListStatus({ channelSnapshot: { status: "PAUSED" } }), "IDLE");
  assert.equal(pure.projectListStatus({}), "COMPLETED", "no capture counts as finished, as on the Project page");
});

test("counts cover every status, the filter keeps one, and stale pages clamp", () => {
  const rows = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: `idle-${i}`, status: "IDLE" })),
    { id: "run", status: "MEASURING" },
    { id: "done", status: "COMPLETED" },
  ];
  const all = pure.selectProjectPage(rows, "ALL", 1, 10);
  assert.deepEqual(all.counts, { ALL: 14, MEASURING: 1, IDLE: 12, COMPLETED: 1 });
  assert.equal(all.rows.length, 10);
  assert.equal(all.pageCount, 2);
  const idle = pure.selectProjectPage(rows, "IDLE", 99, 10);
  assert.equal(idle.page, 2);
  assert.deepEqual(idle.rows.map((row) => row.id), ["idle-10", "idle-11"]);
  const none = pure.selectProjectPage([], "MEASURING", 3, 10);
  assert.equal(none.page, 1);
  assert.equal(none.pageCount, 1);
  assert.deepEqual(none.rows, []);
});

test("the project list filters scope and search in the database and keeps its order", async () => {
  const calls = [];
  const capture = (status) => ({ status, startedAt: new Date("2026-11-01T00:00:00Z"), endsAt: null, completedAt: null });
  const summaries = [
    { id: "p1", measurements: [{ snapshot: null, storeSnapshot: { status: "ACTIVE" }, channelSnapshot: null, customerSnapshot: null }] },
    { id: "p2", measurements: [] },
    { id: "p3", measurements: [{ snapshot: { status: "COMPLETED" }, storeSnapshot: null, channelSnapshot: null, customerSnapshot: null }] },
    { id: "p4", measurements: [{ snapshot: null, storeSnapshot: { status: "PAUSED" }, channelSnapshot: null, customerSnapshot: null }] },
  ];
  const full = [
    {
      id: "p4",
      title: "Four",
      measurements: [{
        id: "m4", name: "Baseline", snapshotId: null, storeSnapshotId: "s4", channelSnapshotId: null, customerSnapshotId: null,
        snapshot: null, storeSnapshot: capture("PAUSED"), channelSnapshot: null, customerSnapshot: null,
      }],
    },
    { id: "p2", title: "Two", measurements: [] },
  ];
  const db = {
    growthProject: {
      findMany: async (args) => {
        calls.push(args);
        return args.select ? summaries : full.filter((row) => args.where.id.in.includes(row.id));
      },
    },
  };
  const server = loadModule("app/utils/growth-projects.server.ts", {
    "../db.server": { __esModule: true, default: db },
    "./billing.server": { getBillingAccess: async () => ({}), PlanLimitError: class extends Error {} },
    "./web-pixel.server": { ensureWebPixel: async () => ({ ready: true }) },
    "./snapshot-setup.server": { resolveSetupPage: async () => ({}), savedTrackerState: async () => "active" },
    "./loader-cache.server": {
      cachedValue: async (key, _ttl, load) => (key.startsWith("growth-expiry:") ? undefined : load()),
      clearCacheKey() {},
      clearCachePrefix() {},
      loaderCacheKeys: { dashboard: () => "", billingDisplay: () => "", categoryPrefix: () => "", categoryFastPrefix: () => "" },
    },
  });
  const list = await server.listGrowthProjects("a.myshopify.com", { status: "IDLE", scope: "STORE", query: "spring", page: 1 });
  assert.deepEqual(calls[0].where, {
    shop: "a.myshopify.com",
    scope: "STORE",
    OR: [
      { title: { contains: "spring", mode: "insensitive" } },
      { goal: { contains: "spring", mode: "insensitive" } },
    ],
  });
  assert.deepEqual(calls[1].where, { shop: "a.myshopify.com", id: { in: ["p2", "p4"] } });
  assert.deepEqual(list.counts, { ALL: 4, MEASURING: 1, IDLE: 2, COMPLETED: 1 });
  assert.deepEqual(list.projects.map((row) => [row.id, row.listStatus]), [["p2", "IDLE"], ["p4", "IDLE"]]);
  assert.equal(list.projects[1].latestMeasurement.status, "PAUSED");
  assert.equal(list.page, 1);
  calls.length = 0;
  const everything = await server.listGrowthProjects("a.myshopify.com");
  assert.deepEqual(calls[0].where, { shop: "a.myshopify.com" });
  assert.equal(everything.total, 4);
});
