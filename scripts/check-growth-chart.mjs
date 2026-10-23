// Local-only responsive chart tests; no browser, Shopify, or database access.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(
  new URL("../app/components/GrowthOverviewCard.tsx", import.meta.url),
  "utf8",
);
const points = [
  { date: "2026-10-01", value: 1 },
  { date: "2026-10-02", value: 2 },
];

function harness(withObserver = true) {
  let width = 358,
    state = 960,
    previousDeps,
    effect,
    cleanup,
    ref = { current: null };
  const calls = [];
  let onResize;
  const node = { getBoundingClientRect: () => ({ width }) };
  class Observer {
    constructor(callback) {
      onResize = callback;
      calls.push("create");
    }
    observe(target) {
      assert.equal(target, node);
      calls.push("observe");
    }
    disconnect() {
      calls.push("disconnect");
    }
  }
  const module = { exports: {} };
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      ResizeObserver: withObserver ? Observer : undefined,
      window: {
        addEventListener(name, callback) {
          assert.equal(name, "resize");
          onResize = callback;
          calls.push("listen");
        },
        removeEventListener(name, callback) {
          assert.equal(name, "resize");
          assert.equal(callback, onResize);
          calls.push("remove");
        },
      },
      require(id) {
        if (id === "react")
          return {
            ...React,
            useRef: () => ref,
            useState: () => [
              state,
              (next) => {
                state = next;
              },
            ],
            useEffect(callback, deps) {
              if (
                !previousDeps ||
                deps.some((value, index) => value !== previousDeps[index])
              )
                effect = callback;
              previousDeps = deps;
            },
          };
        if (id === "../utils/i18n")
          return {
            useI18n: () => ({
              t: (key) => key,
              formatDate: (value) => value.slice(0, 10),
              formatNumber: String,
            }),
          };
        if (id === "../utils/background-json" || id === "@shopify/polaris")
          return {};
        return require(id);
      },
    },
  );
  function render(data) {
    const tree = module.exports.GrowthLineChart({
      points: data,
      title: "Conversion rate",
      percent: true,
    });
    ref.current = tree.type === "svg" ? node : null;
    return renderToStaticMarkup(tree);
  }
  return {
    calls,
    render,
    flush() {
      if (effect) {
        cleanup?.();
        cleanup = effect();
        effect = undefined;
      }
    },
    resize(next) {
      width = next;
      onResize();
    },
    unmount() {
      cleanup?.();
    },
  };
}

test("responsive chart observes after loading and uses full-size mobile labels", () => {
  const h = harness();
  assert.match(h.render([]), /No data available/);
  h.flush();
  assert.deepEqual(h.calls, []);
  h.render(points);
  h.flush();
  const mobile = h.render(points);
  assert.match(mobile, /viewBox="0 0 358 270"/);
  assert.match(mobile, /height:270px/);
  assert.match(mobile, /font-size="11"/);
  assert.match(mobile, /font-size="12"/);
  assert.match(mobile, /x2="333"/);
  assert.deepEqual(h.calls, ["create", "observe"]);
  h.resize(950);
  assert.match(h.render(points), /viewBox="0 0 950 270"/);
  h.resize(0);
  assert.match(h.render(points), /viewBox="0 0 950 270"/);
  h.resize(280);
  assert.match(h.render(points), /viewBox="0 0 300 270"/);
  h.render([]);
  h.flush();
  assert.equal(h.calls.at(-1), "disconnect");
});

test("resize fallback cleans up and null values preserve gaps", () => {
  const h = harness(false);
  h.render(points);
  h.flush();
  assert.deepEqual(h.calls, ["listen"]);
  h.resize(620);
  const html = h.render([
    points[0],
    { date: "2026-10-02", value: null },
    { date: "2026-10-03", value: 3 },
  ]);
  assert.match(html, /viewBox="0 0 620 270"/);
  assert.match(html, /d="M[^L]+ M/);
  h.unmount();
  assert.equal(h.calls.at(-1), "remove");
});
