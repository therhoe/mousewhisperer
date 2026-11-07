// Revenue rules, money format and the shop currency lookup (plan 3a).
// Read-only: loads small modules with mocks; never touches Shopify or a database.
// Run: node --test scripts/check-revenue.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
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

const revenue = loadModule("app/utils/revenue.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));
const t = (key, vars = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
const formatters = (locale) => ({
  t,
  formatNumber: (value, options) => new Intl.NumberFormat(locale, options).format(value),
});
const counts = (sum, priced, unpriced) => ({
  revenue: sum,
  pricedConversions: priced,
  unpricedConversions: unpriced,
});

test("no conversions show the zero amount, never Not recorded", () => {
  assert.deepEqual(plain(revenue.revenueState(0, counts(0, 0, 0))), {
    kind: "amount",
    amount: 0,
    partial: false,
  });
  assert.deepEqual(plain(revenue.revenueText(0, counts(0, 0, 0), "EUR", formatters("en"))), {
    value: "€0.00",
    partial: false,
    hint: null,
  });
});

test("conversions without any recorded amount show Not recorded", () => {
  assert.deepEqual(plain(revenue.revenueState(3, counts(0, 0, 3))), { kind: "notRecorded" });
  // A converted session with no order row at all is neither priced nor unpriced.
  assert.deepEqual(plain(revenue.revenueState(2, counts(0, 0, 0))), { kind: "notRecorded" });
  assert.deepEqual(plain(revenue.revenueText(3, counts(0, 0, 3), "EUR", formatters("en"))), {
    value: "Not recorded",
    partial: false,
    hint: null,
  });
});

test("partly recorded revenue shows the recorded sum with the hint", () => {
  // Mixed currencies: the other-currency orders are unpriced, so the EUR sum is partial.
  assert.deepEqual(plain(revenue.revenueState(5, counts(90, 2, 3))), {
    kind: "amount",
    amount: 90,
    partial: true,
  });
  // One session bought twice, one order without an amount: priced and unpriced at once.
  assert.deepEqual(plain(revenue.revenueState(1, counts(50, 1, 1))), {
    kind: "amount",
    amount: 50,
    partial: true,
  });
  // A converted session that is neither priced nor unpriced still makes the figure partial.
  assert.equal(revenue.revenueState(3, counts(40, 2, 0)).partial, true);
  const text = revenue.revenueText(5, counts(90, 2, 3), "EUR", formatters("en"));
  assert.deepEqual(plain(text), {
    value: "€90.00",
    partial: true,
    hint: "Some orders have no recorded amount",
  });
  assert.equal(revenue.revenueCell(text), "€90.00*");
  assert.equal(revenue.PARTIAL_REVENUE_MARK, "*");
});

test("fully recorded revenue has no hint and no mark", () => {
  const text = revenue.revenueText(2, counts(42, 2, 0), "EUR", formatters("en"));
  assert.deepEqual(plain(text), { value: "€42.00", partial: false, hint: null });
  assert.equal(revenue.revenueCell(text), "€42.00");
});

test("money uses the shop currency in the app's language", () => {
  assert.equal(revenue.formatMoney(1234.5, "EUR", formatters("de").formatNumber), "1.234,50 €");
  assert.equal(revenue.formatMoney(1234.5, "USD", formatters("en").formatNumber), "$1,234.50");
  assert.equal(revenue.formatMoney(1234.5, "JPY", formatters("en").formatNumber), "¥1,235");
});

test("without a shop currency revenue shows Not recorded", () => {
  assert.equal(revenue.revenueText(2, counts(42, 2, 0), null, formatters("en")).value, "Not recorded");
  assert.equal(revenue.revenueText(0, counts(0, 0, 0), undefined, formatters("en")).value, "Not recorded");
});

test("missing or broken counts never produce NaN", () => {
  for (const value of [undefined, null, {}, counts(Number.NaN, Number.NaN, Number.NaN)])
    assert.equal(revenue.revenueText(2, value, "EUR", formatters("en")).value, "Not recorded");
  assert.equal(revenue.revenueText(Number.NaN, counts(10, 1, 0), "EUR", formatters("en")).value, "€0.00");
  assert.equal(revenue.revenueText(1, counts(Number.NaN, 1, 0), "EUR", formatters("en")).value, "€0.00");
});
