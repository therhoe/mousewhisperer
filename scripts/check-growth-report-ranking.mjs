// Database-free checks for the Store "Weakness" ranking.
// Run: node --test scripts/check-growth-report-ranking.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const mod = { exports: {} };
runInNewContext(
  ts.transpileModule(
    readFileSync(new URL("../app/utils/growth-report.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { module: mod, exports: mod.exports, URLSearchParams },
);
const { pageKeyRate, rankGrowthPages, EXIT_OUTCOMES } = mod.exports;
// Values built inside the VM have another realm's prototypes.
const plain = (value) => JSON.parse(JSON.stringify(value));
const page = (path, type, sessions, extra = {}) => ({
  path,
  type,
  sessions,
  carts: 0,
  forwards: 0,
  conversions: 0,
  exits: 0,
  ...extra,
});

test("key rate is add-to-cart for products and click-through for other page types", () => {
  assert.equal(pageKeyRate(page("/products/a", "PRODUCT", 50, { carts: 10, forwards: 40 })), 20);
  assert.equal(pageKeyRate(page("/collections/a", "COLLECTION", 50, { carts: 10, forwards: 40 })), 80);
  assert.equal(pageKeyRate(page("/", "HOMEPAGE", 50, { forwards: 5 })), 10);
  assert.equal(pageKeyRate(page("/blogs/news/post", "BLOG", 50, { forwards: 25 })), 50);
  assert.equal(pageKeyRate(page("/search", null, 50, { forwards: 5 })), null);
  assert.equal(pageKeyRate(page("/pages/a", "PAGE", 0)), null);
});

test("weakness compares a page with the median rate of its type", () => {
  const ranked = rankGrowthPages([
    page("/collections/a", "COLLECTION", 100, { forwards: 40 }),
    page("/collections/b", "COLLECTION", 100, { forwards: 30 }),
    page("/collections/c", "COLLECTION", 200, { forwards: 40 }),
  ]);
  const byPath = Object.fromEntries(ranked.map((row) => [row.path, row]));
  assert.equal(byPath["/collections/c"].typicalRate, 30);
  assert.equal(byPath["/collections/c"].weakness, 20);
  assert.equal(byPath["/collections/c"].focus, true);
  assert.equal(byPath["/collections/a"].weakness, 0);
  assert.equal(byPath["/collections/a"].focus, false);
  assert.equal(byPath["/collections/b"].weakness, 0);
  assert.equal(ranked[0].path, "/collections/c");
});

test("small pages and types with fewer than 3 eligible pages are listed but never ranked", () => {
  const ranked = rankGrowthPages([
    page("/products/a", "PRODUCT", 100, { carts: 30 }),
    page("/products/b", "PRODUCT", 100, { carts: 10 }),
    page("/products/c", "PRODUCT", 19),
    page("/blogs/news", "BLOG", 500, { forwards: 5 }),
  ]);
  assert.equal(ranked.length, 4);
  for (const row of ranked) {
    assert.equal(row.weakness, null);
    assert.equal(row.typicalRate, null);
    assert.equal(row.focus, false);
  }
  assert.deepEqual(plain(ranked.map((row) => row.path)), [
    "/blogs/news",
    "/products/a",
    "/products/b",
    "/products/c",
  ]);
});

test("only the top three pages with a weakness get a focus badge", () => {
  const ranked = rankGrowthPages(
    [10, 20, 30, 40, 50, 60].map((forwards, i) =>
      page(`/pages/p${i}`, "PAGE", 100, { forwards }),
    ),
  );
  assert.deepEqual(plain(ranked.filter((row) => row.focus).map((row) => row.path)), [
    "/pages/p0",
    "/pages/p1",
    "/pages/p2",
  ]);
  assert.deepEqual(plain(ranked.slice(0, 4).map((row) => row.weakness)), [25, 15, 5, 0]);
});

test("exit and conversion rates are shares of sessions that viewed the page", () => {
  const [row] = rankGrowthPages([
    page("/products/a", "PRODUCT", 40, { exits: 10, conversions: 2 }),
  ]);
  assert.equal(row.exitRate, 25);
  assert.equal(row.conversionRate, 5);
  const [empty] = rankGrowthPages([page("/pages/empty", "PAGE", 0)]);
  assert.equal(empty.exitRate, 0);
  assert.equal(empty.conversionRate, 0);
  assert.equal(empty.keyRate, null);
});

test("exit outcomes have a fixed display order", () => {
  assert.deepEqual(plain(EXIT_OUTCOMES), [
    "internal_link",
    "checkout",
    "back_button",
    "window_closed",
    "idle",
    "external_link",
    "unknown",
  ]);
});

test("ranked rows carry weakness and no longer carry missed", () => {
  const [row] = rankGrowthPages([
    page("/pages/a", "PAGE", 100, { forwards: 10 }),
    page("/pages/b", "PAGE", 100, { forwards: 30 }),
    page("/pages/c", "PAGE", 100, { forwards: 50 }),
  ]);
  assert.equal(row.path, "/pages/a");
  assert.equal(row.weakness, 20, "max(0, round(100 × (30 − 10) / 100))");
  assert.equal("missed" in row, false);
});
