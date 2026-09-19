import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Run with: node scripts/check-dashboard-graph.mjs
// Uses declared app dependencies only; no database or authenticated store needed.
const require = createRequire(import.meta.url);
const componentPath = fileURLToPath(
  new URL("../app/components/ConversionProgressCard.tsx", import.meta.url),
);
const source = readFileSync(componentPath, "utf8");
const compiled = ts.transpileModule(
  `${source}\nexport { ConversionChart };\n`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  },
);
function loadComponents(react = React) {
  const runtimeModule = { exports: {} };
  runInNewContext(
    compiled.outputText,
    {
      exports: runtimeModule.exports,
      module: runtimeModule,
      require: (specifier) =>
        specifier === "react"
          ? react
          : specifier === "@remix-run/react"
            ? {
                useFetcher: () => ({
                  state: "idle",
                  data: undefined,
                  load: () => {},
                  submit: () => {},
                }),
              }
            : require(specifier),
    },
    { filename: componentPath },
  );
  return runtimeModule.exports;
}
const { ConversionChart, ConversionProgressCard } = loadComponents();
const { AppProvider } = require("@shopify/polaris");
const i18n = require("@shopify/polaris/locales/en.json");

const point = (date, conversionRate) => ({
  date,
  conversionRate,
  sessions: 100,
  completedCheckouts: conversionRate,
});
const event = (id, kind, title, start, end = null) => ({
  id,
  kind,
  title,
  start,
  end,
  description: "Regression activity details",
  category: null,
  scope: null,
  pagePath: null,
  sourceType: kind === "OPTIMIZATION" ? "MANUAL" : kind,
  editable: kind === "OPTIMIZATION",
});
const data = {
  progress: {
    status: "ready",
    period: "month",
    periodLabel: "Month to date",
    currentLabel: "Aug 1–Aug 3, 2026",
    previousLabel: "Jul 1–Jul 3, 2026",
    rangeStart: "2026-08-01",
    rangeEnd: "2026-08-03",
    previousRangeStart: "2026-07-01",
    previousRangeEnd: "2026-07-03",
    currentRate: 2,
    previousRate: 1,
    currentSessions: 300,
    currentCompletedCheckouts: 6,
    previousSessions: 300,
    previousCompletedCheckouts: 3,
    deltaPoints: 1,
    deltaPercent: 100,
    currentSeries: [
      point("2026-08-01", 1),
      point("2026-08-02", 3),
      point("2026-08-03", 2),
    ],
    previousSeries: [
      point("2026-07-01", 1),
      point("2026-07-02", 2),
      point("2026-07-03", 0),
    ],
    message: null,
    source: "SHOPIFY_ANALYTICS",
    updatedAt: "2026-08-03T12:00:00.000Z",
  },
  events: [
    event("opt", "OPTIMIZATION", "Regression optimization", "2026-08-02"),
    event("ab", "AB_TEST", "Regression experiment", "2026-08-01", "2026-08-03"),
    event("page", "SNAPSHOT", "Regression page measurement", "2026-08-02"),
    event(
      "store",
      "STORE_SNAPSHOT",
      "Regression store measurement",
      "2026-08-02",
    ),
    event(
      "channel",
      "CHANNEL_SNAPSHOT",
      "Regression channel measurement",
      "2026-08-02",
    ),
  ],
};
const originalData = JSON.stringify(data);
const layeredChart = renderToStaticMarkup(
  React.createElement(ConversionChart, { data, showActivity: true }),
);
const cleanChart = renderToStaticMarkup(
  React.createElement(ConversionChart, { data, showActivity: false }),
);

assert.equal((layeredChart.match(/role="button"/g) || []).length, 5);
for (const activity of data.events) {
  assert.ok(layeredChart.includes(activity.title));
  assert.ok(!cleanChart.includes(activity.title));
}
assert.ok(!cleanChart.includes('role="button"'));
assert.ok(!cleanChart.includes('fill="#7c3aed"'));
assert.ok(!cleanChart.includes('stroke="#008060"'));
assert.ok(!cleanChart.includes('stroke="#6d7175"'));
for (const chart of [layeredChart, cleanChart]) {
  assert.equal((chart.match(/<path\b/g) || []).length, 2);
  assert.ok(chart.includes('stroke="#149ed5"'));
  assert.ok(chart.includes('stroke="#78c1df"'));
  assert.ok(chart.includes('stroke-dasharray="5 8"'));
  assert.ok(chart.includes(`Current: ${data.progress.currentLabel}`));
  assert.ok(chart.includes(`Previous: ${data.progress.previousLabel}`));
  assert.ok(chart.includes("Aug 1"));
  assert.ok(chart.includes("4%"));
}
assert.equal(JSON.stringify(data), originalData);

const card = renderToStaticMarkup(
  React.createElement(
    AppProvider,
    { i18n },
    React.createElement(ConversionProgressCard, {
      initialData: data,
      shop: "regression.myshopify.com",
    }),
  ),
);
const toggle = card.match(
  /<button\b[^>]*aria-label="Clean graph: hide CRO activity overlays"[^>]*>/,
);
assert.ok(toggle, "The clean-graph toggle must have an accessible label");
assert.ok(
  toggle[0].includes('aria-pressed="false"'),
  "Layered view is the default",
);
const plotStart = card.indexOf(
  'aria-label="Month to date Shopify conversion rate compared with the prior period"',
);
assert.ok(plotStart > 0);
assert.ok(
  card.indexOf("What this rate means") > card.indexOf("</svg>", plotStart),
);
assert.ok(
  card.indexOf("What this rate means") > card.indexOf("Snapshot measurement"),
);
assert.ok(card.includes("Previous comparison: 1.00%"));
assert.ok(card.includes("Optimizations (1)"));
assert.ok(card.includes("Experiments (1)"));
assert.ok(card.includes("Measurements (3)"));
assert.ok(card.includes("Log optimization"));

// Exercise the actual element handlers without adding a DOM/test-renderer
// dependency. ConversionChart has one state hook. This harness checks handler
// transitions; real focus behavior and effect timing still require browser QA.
let selectedEventId = null;
const { ConversionChart: InteractiveChart } = loadComponents({
  ...React,
  useState: () => [
    selectedEventId,
    (value) => {
      selectedEventId =
        typeof value === "function" ? value(selectedEventId) : value;
    },
  ],
  useEffect: () => {},
});
function matchingElements(element, predicate) {
  if (Array.isArray(element))
    return element.flatMap((child) => matchingElements(child, predicate));
  if (!React.isValidElement(element)) return [];
  return [
    ...(predicate(element) ? [element] : []),
    ...matchingElements(element.props.children, predicate),
  ];
}
const interactive = () => InteractiveChart({ data, showActivity: true });
const hasTooltip = (chart) =>
  matchingElements(chart, (element) => element.props.pointerEvents === "none")
    .length === 1;
const scrollRegion = interactive();
assert.equal(scrollRegion.props.role, "region");
assert.equal(scrollRegion.props.tabIndex, 0);
assert.match(scrollRegion.props["aria-label"], /Scroll horizontally/);
for (const activity of data.events) {
  const marker = matchingElements(
    interactive(),
    (element) =>
      element.props.role === "button" &&
      element.props["aria-label"].startsWith(activity.title),
  )[0];
  assert.ok(marker, `Missing interactive marker for ${activity.kind}`);
  marker.props.onMouseEnter();
  marker.props.onFocus();
  marker.props.onClick();
  assert.equal(
    selectedEventId,
    activity.id,
    "Click must not dismiss the tooltip opened by hover/focus",
  );
  assert.ok(hasTooltip(interactive()));
  marker.props.onClick();
  assert.equal(
    selectedEventId,
    activity.id,
    "Repeated activation keeps details visible",
  );
  for (const [key, expectedId] of [
    ["Escape", null],
    ["Enter", activity.id],
    ["Escape", null],
    [" ", activity.id],
  ]) {
    let prevented = false;
    marker.props.onKeyDown({
      key,
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.ok(
      prevented,
      `${key} should not trigger page scrolling or other browser actions`,
    );
    assert.equal(selectedEventId, expectedId);
  }
  marker.props.onBlur();
  assert.equal(selectedEventId, null);
  marker.props.onMouseEnter();
  marker.props.onMouseLeave();
  assert.equal(selectedEventId, null);
}
selectedEventId = data.events[0].id;
const cleanInteractive = InteractiveChart({ data, showActivity: false });
assert.ok(
  !hasTooltip(cleanInteractive),
  "Clean mode hides an already-selected tooltip",
);
assert.equal(
  matchingElements(
    cleanInteractive,
    (element) => element.props.role === "button",
  ).length,
  0,
);
scrollRegion.props.onKeyDown({ key: "Escape" });
assert.equal(
  selectedEventId,
  null,
  "Escape also dismisses details from the focused scroll region",
);
console.log("Dashboard graph regression checks passed.");
