// Navigation rules and Polaris helpers for the redesigned screens (plan 2a).
// Read-only: loads small modules with mocks; never touches Shopify or a database.
// Run: node --test scripts/check-navigation.mjs
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

// Transpiles an app file to CommonJS and runs it. Specifiers in `mocks` are
// replaced at every depth; other relative imports load the same way; packages
// load for real from node_modules.
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

const nav = loadModule("app/utils/navigation.ts");

test("Back pops only when an earlier in-app entry exists, otherwise replaces with the parent", () => {
  for (const index of [1, 2, 40])
    assert.deepEqual(nav.backTarget(index, "/app/projects"), { kind: "pop" });
  for (const index of [0, -1, 1.5, "3", null, undefined, Number.NaN])
    assert.deepEqual(nav.backTarget(index, "/app/projects"), {
      kind: "replace",
      to: "/app/projects",
    });
});

test("returnTo keeps in-app paths and drops signed launch values", () => {
  assert.equal(nav.safeReturnTo("/app"), "/app");
  assert.equal(
    nav.safeReturnTo("/app/projects/abc?results=m1&audience=all"),
    "/app/projects/abc?results=m1&audience=all",
  );
  assert.equal(
    nav.safeReturnTo(
      "/app/settings?id_token=x&hmac=y&session=z&timestamp=1&returnTo=%2Fapp&shop=a.myshopify.com",
    ),
    "/app/settings?shop=a.myshopify.com",
  );
  assert.equal(nav.safeReturnTo("/app/projects#top"), "/app/projects");
});

test("returnTo rejects anything outside the app", () => {
  for (const value of [
    "https://evil.example/app",
    "//evil.example/app",
    "/apps/other",
    "/application",
    "/app/../admin",
    "/app/%2e%2e/admin",
    "/app\\..\\admin",
    "/app/\nx",
    "javascript:alert(1)",
    "/auth/login",
    "",
    null,
    undefined,
    42,
    {},
    `/app/${"x".repeat(2001)}`,
  ])
    assert.equal(nav.safeReturnTo(value), null, String(value));
});

test("Plans links carry a safe screen to come back to", () => {
  assert.equal(
    nav.plansHref("/app/projects?status=IDLE"),
    "/app/plans?returnTo=%2Fapp%2Fprojects%3Fstatus%3DIDLE",
  );
  assert.equal(nav.plansHref("/app/settings"), "/app/plans?returnTo=%2Fapp%2Fsettings");
  for (const value of [null, undefined, "", "https://evil.example/app", "/app/plans", "/app/plans?billing=approved"])
    assert.equal(nav.plansHref(value), "/app/plans");
});

test("list filters reset the page, page changes keep filters, and signed values are dropped", () => {
  const current = new URLSearchParams(
    "shop=a.myshopify.com&host=abc&status=IDLE&page=3&id_token=secret",
  );
  const filtered = nav.listParams(current, { scope: "PAGE" });
  assert.equal(
    filtered.toString(),
    "shop=a.myshopify.com&host=abc&status=IDLE&scope=PAGE",
  );
  const paged = nav.listParams(filtered, { page: "2" });
  assert.equal(paged.get("page"), "2");
  assert.equal(paged.get("scope"), "PAGE");
  const cleared = nav.listParams(paged, { status: null, q: "" });
  assert.equal(cleared.has("status"), false);
  assert.equal(cleared.has("q"), false);
  assert.equal(cleared.has("page"), false);
  assert.equal(current.get("page"), "3", "the current params are not changed");
});

function navigateEvent(link) {
  const calls = [];
  return {
    calls,
    event: {
      target: {
        closest: (selector) => (selector === "[data-snapshot-back]" ? link : null),
      },
      stopImmediatePropagation: () => calls.push("stop"),
      preventDefault: () => calls.push("prevent"),
    },
  };
}
const backLink = (href) => ({
  getAttribute: (name) => (name === "href" ? href : null),
});

test("only Back links are intercepted, and they pop or replace", () => {
  let e = navigateEvent(backLink("/app/projects"));
  assert.deepEqual(nav.interceptBackNavigation(e.event, 3), { kind: "pop" });
  assert.deepEqual(e.calls, ["stop", "prevent"]);
  e = navigateEvent(backLink("/app/projects"));
  assert.deepEqual(nav.interceptBackNavigation(e.event, 0), {
    kind: "replace",
    to: "/app/projects",
  });
  e = navigateEvent(null);
  assert.equal(nav.interceptBackNavigation(e.event, 3), null);
  assert.deepEqual(e.calls, []);
  e = navigateEvent(backLink("https://evil.example/app"));
  assert.equal(nav.interceptBackNavigation(e.event, 3), null);
  assert.deepEqual(e.calls, []);
  assert.equal(
    nav.interceptBackNavigation(
      { target: null, stopImmediatePropagation() {}, preventDefault() {} },
      3,
    ),
    null,
  );
});
