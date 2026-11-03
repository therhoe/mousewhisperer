// Database-free checks that snapshot exports are authenticated and shop-scoped.
// Run: node --test scripts/check-report-export-auth.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const snapshot = {
  id: "snap-1",
  name: "Baseline",
  number: 1,
  targetVisitors: 100,
  visits: [],
  project: { shop: "owner.myshopify.com", productHandle: "red-shoe" },
};

function loadRoute({ shop = "owner.myshopify.com", authenticated = true, failQuery = false } = {}) {
  const calls = { authenticated: 0, where: null };
  const findFirst = async ({ where }) => {
    calls.where = where;
    if (failQuery) throw new Error("database exploded at secret/path.ts:42");
    return where.id === snapshot.id && where.project?.shop === snapshot.project.shop
      ? snapshot
      : null;
  };
  const prisma = { snapshot: { findFirst, findUnique: findFirst } };
  const mocks = {
    "../shopify.server": {
      authenticate: {
        admin: async () => {
          calls.authenticated += 1;
          if (!authenticated) throw new Response(null, { status: 401 });
          return { session: { shop } };
        },
      },
    },
    "../db.server": { default: prisma, __esModule: true },
    "@prisma/client": { PrismaClient: function PrismaClient() { return prisma; } },
    "../utils/export.server": {
      generateCSV: () => "csv-body",
      generatePDF: async () => new Uint8Array([1]),
    },
  };
  const mod = { exports: {} };
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../app/routes/api.export.$snapshotId.tsx", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      },
    ).outputText,
    {
      module: mod,
      exports: mod.exports,
      require: (id) => (id in mocks ? mocks[id] : require(id)),
      URL,
      Response,
      Buffer,
      console: { ...console, error: () => {} },
    },
  );
  return { loader: mod.exports.loader, calls };
}
const request = (format = "csv") =>
  new Request(`https://app.test/api/export/snap-1?format=${format}`);
const settle = (promise) =>
  promise.then(
    (value) => value,
    (thrown) => thrown,
  );

test("an export without an admin session is rejected before any data is read", async () => {
  const { loader, calls } = loadRoute({ authenticated: false });
  const response = await settle(loader({ request: request(), params: { snapshotId: "snap-1" } }));
  assert.equal(calls.authenticated, 1);
  assert.equal(response.status, 401);
  assert.equal(calls.where, null);
});

test("another shop's snapshot is not found", async () => {
  const { loader, calls } = loadRoute({ shop: "intruder.myshopify.com" });
  const response = await settle(loader({ request: request(), params: { snapshotId: "snap-1" } }));
  assert.equal(response.status, 404);
  assert.equal(calls.where.project.shop, "intruder.myshopify.com");
  assert.doesNotMatch(await response.text(), /snap-1/);
});

test("the owner's snapshot downloads as CSV", async () => {
  const { loader } = loadRoute();
  const response = await loader({ request: request(), params: { snapshotId: "snap-1" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /text\/csv/);
  assert.equal(await response.text(), "csv-body");
});

test("a failed export returns a plain message without internal details", async () => {
  const { loader } = loadRoute({ failQuery: true });
  const response = await settle(loader({ request: request(), params: { snapshotId: "snap-1" } }));
  assert.equal(response.status, 500);
  const body = await response.text();
  assert.doesNotMatch(body, /Stack|secret\/path|exploded/);
});
