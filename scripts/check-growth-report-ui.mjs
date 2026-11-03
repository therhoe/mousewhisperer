// Render checks for the redesigned Project report sections. No Shopify, no database.
// Run: node --test scripts/check-growth-report-ui.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
const require = createRequire(import.meta.url);

const t = (key, vars = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
const i18n = {
  useI18n: () => ({
    t,
    formatNumber: (value, options) =>
      new Intl.NumberFormat("en-US", options).format(value),
  }),
};
const el = React.createElement;
const simple = (tag) => (props) => el(tag, null, props.children);
const polaris = new Proxy(
  {
    DataTable: ({ headings, rows }) =>
      el(
        "table",
        null,
        el(
          "thead",
          null,
          el(
            "tr",
            null,
            headings.map((h, i) => el("th", { key: i }, h)),
          ),
        ),
        el(
          "tbody",
          null,
          rows.map((row, i) =>
            el(
              "tr",
              { key: i },
              row.map((cell, j) => el("td", { key: j }, cell)),
            ),
          ),
        ),
      ),
    Badge: ({ children }) => el("mark", null, children),
    ProgressBar: ({ progress }) =>
      el("progress", { value: progress, max: 100 }),
    Pagination: ({ label }) => el("nav", null, label),
    Button: ({ children }) => el("button", null, children),
  },
  { get: (target, name) => target[name] || simple("div") },
);
const tile = {
  MetricTile: ({ label, value, caption }) =>
    el(
      "div",
      { "data-tile": label },
      `${label}=${value}`,
      caption ? ` [${caption}]` : "",
    ),
};
function load(file, mocks = {}) {
  const mod = { exports: {} };
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      },
    ).outputText,
    {
      module: mod,
      exports: mod.exports,
      require: (id) => (id in mocks ? mocks[id] : require(id)),
      Intl,
      URL,
      URLSearchParams,
    },
  );
  return mod.exports;
}
const common = {
  "@shopify/polaris": polaris,
  "../utils/i18n": i18n,
  "./GrowthOverviewCard": tile,
};
const render = (component, props) => renderToStaticMarkup(el(component, props));

const summary = {
  available: true,
  timeMedianSeconds: 74,
  pagesPerSession: 2.25,
  averageScroll: 61.4,
  clickThroughRate: 38.2,
  searchRate: 12.5,
  topSearches: [{ term: "winter boots", sessions: 41 }],
  devices: [
    { device: "mobile", sessions: 880, share: 65.7, conversionRate: 2.4 },
    { device: "desktop", sessions: 410, share: 30.6, conversionRate: 4.9 },
  ],
};

test("funnel shows each step as a share of all sessions", () => {
  const { GrowthConversionFunnel } = load(
    "app/components/GrowthConversionFunnel.tsx",
    common,
  );
  const html = render(GrowthConversionFunnel, {
    funnel: {
      sessions: 200,
      addedToCart: 40,
      checkoutStarted: 10,
      purchased: 12,
    },
  });
  assert.match(html, /Sessions=200/);
  assert.match(html, /Added to cart=40 \[20% of sessions\]/);
  assert.match(html, /Reached checkout=10 \[5% of sessions\]/);
  assert.match(
    html,
    /Purchased=12 \[6% of sessions\]/,
    "Purchases may exceed checkouts",
  );
});

test("funnel compares each step with the comparison measurement in points", () => {
  const { GrowthConversionFunnel } = load(
    "app/components/GrowthConversionFunnel.tsx",
    common,
  );
  const html = render(GrowthConversionFunnel, {
    funnel: {
      sessions: 200,
      addedToCart: 40,
      checkoutStarted: 10,
      purchased: 12,
    },
    before: {
      sessions: 100,
      addedToCart: 10,
      checkoutStarted: 5,
      purchased: 3,
    },
    comparisonName: "Baseline",
  });
  assert.match(html, /Sessions=200 \[100 in Baseline\]/);
  assert.match(html, /Added to cart=40 \[20% of sessions · \+10 pts\]/);
  assert.match(html, /Purchased=12 \[6% of sessions · \+3 pts\]/);
  assert.match(html, /Compared with Baseline using the same filters/);
});

test("funnel shows the share without a delta when the comparison has no sessions", () => {
  const { GrowthConversionFunnel } = load(
    "app/components/GrowthConversionFunnel.tsx",
    common,
  );
  const html = render(GrowthConversionFunnel, {
    funnel: {
      sessions: 200,
      addedToCart: 40,
      checkoutStarted: 10,
      purchased: 12,
    },
    before: {
      sessions: 0,
      addedToCart: 0,
      checkoutStarted: 0,
      purchased: 0,
    },
    comparisonName: "Baseline",
  });
  assert.match(html, /Added to cart=40 \[20% of sessions\]/);
  assert.doesNotMatch(html, /pts/);
});

test("funnel with no sessions shows zero shares, not NaN", () => {
  const { GrowthConversionFunnel } = load(
    "app/components/GrowthConversionFunnel.tsx",
    common,
  );
  const html = render(GrowthConversionFunnel, {
    funnel: { sessions: 0, addedToCart: 0, checkoutStarted: 0, purchased: 0 },
  });
  assert.doesNotMatch(html, /NaN/);
  assert.match(html, /Added to cart=0 \[0% of sessions\]/);
});

test("store engagement metrics show time on site, pages per session, click-through, searches, devices and exit pages", () => {
  const { GrowthEngagementMetrics } = load(
    "app/components/GrowthEngagementMetrics.tsx",
    common,
  );
  const html = render(GrowthEngagementMetrics, {
    summary,
    layout: "store",
    exitPages: [
      {
        path: "/collections/autumn",
        exits: 160,
        sessions: 420,
        exitRate: 38.1,
      },
    ],
  });
  assert.match(html, /Time on site=1m 14s/);
  assert.match(html, /Pages per session=2\.3/);
  assert.match(html, /Click-through rate=38\.2%/);
  assert.match(html, /Sessions that searched=12\.5%/);
  assert.match(html, /winter boots/);
  assert.match(html, /Mobile/);
  assert.match(html, /\/collections\/autumn/);
});

test("page engagement metrics show time on page and no store-only figures", () => {
  const { GrowthEngagementMetrics } = load(
    "app/components/GrowthEngagementMetrics.tsx",
    common,
  );
  const html = render(GrowthEngagementMetrics, {
    summary,
    layout: "page",
    exitPages: [],
  });
  assert.match(html, /Time on page=1m 14s/);
  assert.doesNotMatch(html, /Pages per session/);
  assert.doesNotMatch(html, /Click-through rate/);
  assert.doesNotMatch(html, /Top exit pages/);
});

test("engagement metrics say not recorded for imported measurements", () => {
  const { GrowthEngagementMetrics } = load(
    "app/components/GrowthEngagementMetrics.tsx",
    common,
  );
  const html = render(GrowthEngagementMetrics, {
    summary: { ...summary, available: false },
    layout: "store",
    exitPages: [],
  });
  assert.match(html, /Not recorded for this measurement/);
  assert.doesNotMatch(html, /Time on site=/);
});

test("short times show seconds only, and an empty search list explains why", () => {
  const { GrowthEngagementMetrics } = load(
    "app/components/GrowthEngagementMetrics.tsx",
    common,
  );
  const html = render(GrowthEngagementMetrics, {
    summary: {
      ...summary,
      timeMedianSeconds: 9.6,
      topSearches: [],
      devices: [],
    },
    layout: "page",
    exitPages: [],
  });
  assert.match(html, /Time on page=10s/);
  assert.match(html, /No search term was used by two or more sessions yet\./);
  assert.match(html, /No sessions match these filters\./);
});

const exitPaths = {
  available: true,
  outcomes: [
    { type: "internal_link", pageViews: 52, share: 52 },
    { type: "checkout", pageViews: 0, share: 0 },
    { type: "back_button", pageViews: 20, share: 20 },
    { type: "window_closed", pageViews: 28, share: 28 },
    { type: "idle", pageViews: 0, share: 0 },
    { type: "external_link", pageViews: 0, share: 0 },
    { type: "unknown", pageViews: 0, share: 0 },
  ],
  nextPages: [
    { path: "/products/merchant-sample", pageViews: 30 },
    { path: "/private-page", pageViews: 2 },
  ],
  exitPages: [],
};

test("exit paths list how visitors left and where they went next, skipping empty outcomes", () => {
  const { GrowthExitPathsCard } = load("app/components/GrowthExitPaths.tsx", common);
  const html = render(GrowthExitPathsCard, { exitPaths });
  assert.match(html, /Continued to another page/);
  assert.match(html, /Pressed back/);
  assert.match(html, /Closed or switched tab/);
  assert.doesNotMatch(html, /Went idle/, "Zero rows are hidden");
  assert.match(html, /\/products\/merchant-sample/);
  assert.match(html, /\/private-page/);
});

test("exit paths say not recorded for imported measurements", () => {
  const { GrowthExitPathsCard } = load("app/components/GrowthExitPaths.tsx", common);
  const html = render(GrowthExitPathsCard, { exitPaths: { ...exitPaths, available: false } });
  assert.match(html, /Not recorded for this measurement/);
  assert.doesNotMatch(html, /Continued to another page/);
});

const ranked = (path, type, sessions, extra = {}) => ({
  path,
  type,
  sessions,
  carts: 0,
  forwards: 0,
  conversions: 0,
  exits: 0,
  keyRate: null,
  exitRate: 0,
  conversionRate: 0,
  typicalRate: null,
  missed: null,
  focus: false,
  ...extra,
});

test("sessions by page explains each focus page in a sentence and badges it", () => {
  const { GrowthSessionsByPage } = load("app/components/GrowthSessionsByPage.tsx", common);
  const html = render(GrowthSessionsByPage, {
    available: true,
    pages: [
      ranked("/collections/autumn", "COLLECTION", 420, { keyRate: 20, typicalRate: 31, missed: 46, focus: true }),
      ranked("/products/sample", "PRODUCT", 300, { keyRate: 16, typicalRate: 19, missed: 9, focus: true }),
      ranked("/search", null, 40),
    ],
  });
  assert.match(html, /About 46 more sessions would have continued if this page matched your other collections\./);
  assert.match(html, /About 9 more sessions would have added to cart if this page matched your other products\./);
  assert.equal((html.match(/<mark>Focus here<\/mark>/g) || []).length, 4, "Two sentences and two table rows");
  assert.match(html, /Other/);
  assert.match(html, /—/, "Unranked pages show a dash for missed sessions");
});

test("sessions by page shows ten rows per page", () => {
  const { GrowthSessionsByPage } = load("app/components/GrowthSessionsByPage.tsx", common);
  const html = render(GrowthSessionsByPage, {
    available: true,
    pages: Array.from({ length: 12 }, (_, i) => ranked(`/pages/p${i}`, "PAGE", 100 - i)),
  });
  assert.match(html, /\/pages\/p9</);
  assert.doesNotMatch(html, /\/pages\/p10</);
  assert.match(html, /Page 1 of 2/);
});

test("sessions by page says not recorded for imported measurements", () => {
  const { GrowthSessionsByPage } = load("app/components/GrowthSessionsByPage.tsx", common);
  const html = render(GrowthSessionsByPage, { available: false, pages: [] });
  assert.match(html, /Not recorded for this measurement/);
});
