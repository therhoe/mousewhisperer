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
  "../utils/revenue": load("app/utils/revenue.ts"),
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
    { device: "mobile", sessions: 880, share: 65.7, conversions: 21, conversionRate: 2.4, revenue: 1050, pricedConversions: 20, unpricedConversions: 1 },
    { device: "desktop", sessions: 410, share: 30.6, conversions: 20, conversionRate: 4.9, revenue: 1200, pricedConversions: 20, unpricedConversions: 0 },
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
  weakness: null,
  revenue: 0,
  pricedConversions: 0,
  unpricedConversions: 0,
  focus: false,
  ...extra,
});

test("sessions by page explains each focus page by its weakness and badges it", () => {
  const { GrowthSessionsByPage } = load("app/components/GrowthSessionsByPage.tsx", common);
  const html = render(GrowthSessionsByPage, {
    available: true,
    pages: [
      ranked("/collections/autumn", "COLLECTION", 420, { keyRate: 20, typicalRate: 31, weakness: 46, focus: true }),
      ranked("/products/sample", "PRODUCT", 300, { keyRate: 16, typicalRate: 19, weakness: 9, focus: true }),
      ranked("/search", null, 40),
    ],
  });
  assert.match(
    html,
    /Weakness 46: about 46 fewer sessions continued from here than from your typical collection\./,
  );
  assert.match(
    html,
    /Weakness 9: about 9 fewer sessions added to cart here than on your typical product page\./,
  );
  assert.equal((html.match(/<mark>Focus here<\/mark>/g) || []).length, 4, "Two sentences and two table rows");
  assert.match(html, /Other/);
  assert.match(html, /—/, "Unranked pages show a dash for weakness");
  assert.match(html, /<th>Weakness<\/th>/);
  assert.match(html, /Weakness is how many sessions a page lost against the typical page of its type\./);
  assert.doesNotMatch(html, /Missed sessions|more sessions would have/);
});

test("blog and other page types get their own weakness sentence", () => {
  const { GrowthSessionsByPage } = load("app/components/GrowthSessionsByPage.tsx", common);
  const html = render(GrowthSessionsByPage, {
    available: true,
    pages: [
      ranked("/blogs/news/a", "BLOG", 100, { weakness: 12, focus: true }),
      ranked("/pages/about", "PAGE", 100, { weakness: 5, focus: true }),
    ],
  });
  assert.match(html, /Weakness 12: about 12 fewer sessions continued from here than from your typical blog post\./);
  assert.match(html, /Weakness 5: about 5 fewer sessions continued from here than from your typical page of this type\./);
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

function resultsWith(report, comparison = null) {
  const section = (name) => (props) =>
    el("section", {
      "data-section": name,
      "data-layout": props.layout || "",
      "data-currency": props.currency ?? "",
    });
  return load("app/components/GrowthMeasurementResults.tsx", {
    ...common,
    "../utils/background-json": {
      useBackgroundJson: () => ({
        data: { report, comparison },
        loading: false,
        error: null,
        reload() {},
      }),
    },
    "./GrowthEngagementMetrics": { GrowthEngagementMetrics: section("engagement") },
    "./GrowthConversionFunnel": { GrowthConversionFunnel: section("funnel") },
    "./GrowthExitPaths": { GrowthExitPathsCard: section("exits") },
    "./GrowthSessionsByPage": { GrowthSessionsByPage: section("pages") },
    "./EngagementOutcomes": { EngagementOutcomesView: section("zones") },
  }).GrowthMeasurementResults;
}
const baseReport = {
  currency: "EUR",
  revenue: 180,
  pricedConversions: 4,
  unpricedConversions: 0,
  sessions: 100,
  addedToCart: 20,
  conversions: 4,
  conversionRate: 4,
  atcRate: 20,
  pageViews: 230,
  averageTime: 40,
  averageScroll: 55,
  series: [{ date: "2026-10-22", sessions: 100, conversions: 4, conversionRate: 4 }],
  channels: [
    { source: "facebook", medium: "paid", campaign: "", sessions: 100, addedToCart: 20, conversions: 4, conversionRate: 4, revenue: 180, pricedConversions: 4, unpricedConversions: 0 },
  ],
  sources: ["facebook"],
  engagement: { version: 1, maxSessions: 1, groups: [{ category: "Button", items: [] }] },
  engagementUnavailable: false,
  funnel: { sessions: 100, addedToCart: 20, checkoutStarted: 8, purchased: 4, revenue: 180, pricedConversions: 4, unpricedConversions: 0 },
  engagementSummary: { ...summary, clickThroughRate: 31.5 },
  exitPaths,
  pages: [],
};
const props = {
  shop: "s.myshopify.com",
  projectId: "p",
  measurementId: "m",
  comparisonId: "",
  filters: { audience: "all", source: "", medium: "", campaign: "" },
};
// Section order as rendered: mocked cards by data-section, real cards by heading text.
const order = (html) =>
  [...html.matchAll(/data-section="(\w+)"|Traffic by source|Conversion metrics/g)].map(
    (match) => match[1] || (match[0] === "Traffic by source" ? "traffic" : "conversion"),
  );

test("store layout orders engagement, funnel, traffic, pages and drops the chart", () => {
  const Results = resultsWith({ ...baseReport, layout: "store", pageType: null });
  const html = render(Results, props);
  assert.deepEqual(order(html), ["engagement", "funnel", "traffic", "pages"]);
  assert.doesNotMatch(html, /Conversion rate over time/);
  assert.doesNotMatch(html, /data-section="zones"/);
});

test("page layout orders conversion, engagement, zones, exits, traffic", () => {
  const Results = resultsWith({ ...baseReport, layout: "page", pageType: "PRODUCT" });
  const html = render(Results, props);
  assert.deepEqual(order(html), ["conversion", "engagement", "zones", "exits", "traffic"]);
  assert.doesNotMatch(html, /Conversion rate over time/);
});

test("product pages keep add-to-cart rate; other page types show click-through rate", () => {
  const product = render(resultsWith({ ...baseReport, layout: "page", pageType: "PRODUCT" }), props);
  assert.match(product, /Add-to-cart rate=20%/);
  assert.doesNotMatch(product, /Click-through rate=/);
  const collection = render(resultsWith({ ...baseReport, layout: "page", pageType: "COLLECTION" }), props);
  assert.match(collection, /Click-through rate=31\.5% \[Clicked through to a product\]/);
  assert.doesNotMatch(collection, /Add-to-cart rate=/);
  const blog = render(resultsWith({ ...baseReport, layout: "page", pageType: "BLOG" }), props);
  assert.match(blog, /Click-through rate=31\.5% \[Clicked through to another page\]/);
});

test("click-through tile says not recorded for imported page measurements", () => {
  const html = render(
    resultsWith({
      ...baseReport,
      layout: "page",
      pageType: "COLLECTION",
      engagementSummary: { ...summary, available: false },
    }),
    props,
  );
  assert.match(html, /Click-through rate=Not recorded/);
});

test("an empty report renders without NaN", () => {
  const empty = {
    ...baseReport,
    layout: "page",
    pageType: "COLLECTION",
    sessions: 0,
    addedToCart: 0,
    conversions: 0,
    conversionRate: 0,
    atcRate: 0,
    channels: [],
    funnel: { sessions: 0, addedToCart: 0, checkoutStarted: 0, purchased: 0 },
    engagementSummary: { ...summary, clickThroughRate: 0, devices: [], topSearches: [] },
  };
  const html = render(resultsWith(empty), props);
  assert.doesNotMatch(html, /NaN/);
  assert.match(html, /No sessions match these filters\./);
});

test("click-through delta is skipped when the comparison never recorded engagement", () => {
  const current = { ...baseReport, layout: "page", pageType: "COLLECTION" };
  const imported = {
    ...current,
    engagementSummary: { ...summary, available: false, clickThroughRate: 0 },
  };
  const html = render(resultsWith(current, imported), {
    ...props,
    comparisonId: "c",
    comparisonName: "Imported",
  });
  assert.match(html, /Click-through rate=31\.5% \[Clicked through to a product\]/);
  assert.doesNotMatch(html, /\+31\.5 pts/, "No points delta against unrecorded data");
});

test("page layout keeps Engagement by zone with a not-recorded note for imported measurements", () => {
  const html = render(
    resultsWith({
      ...baseReport,
      layout: "page",
      pageType: "COLLECTION",
      engagement: { version: 1, maxSessions: 1, groups: [] },
      engagementSummary: { ...summary, available: false },
    }),
    props,
  );
  assert.match(html, /Engagement by zone/);
  assert.match(html, /Not recorded for this measurement/);
  assert.ok(
    html.indexOf("Engagement by zone") < html.indexOf('data-section="exits"'),
    "Zone card sits before exit paths",
  );
  assert.doesNotMatch(html, /data-section="zones"/);
});

test("store layout leaves the comparison footer to the funnel card", () => {
  const store = { ...baseReport, layout: "store", pageType: null };
  const html = render(resultsWith(store, store), {
    ...props,
    comparisonId: "c",
    comparisonName: "Baseline",
  });
  assert.doesNotMatch(html, /Compared with/);
});

test("page tiles show no points delta against a comparison with no sessions", () => {
  const emptyComparison = (report) => ({
    ...report,
    sessions: 0,
    addedToCart: 0,
    conversions: 0,
    conversionRate: 0,
    atcRate: 0,
    funnel: { sessions: 0, addedToCart: 0, checkoutStarted: 0, purchased: 0 },
    engagementSummary: { ...summary, clickThroughRate: 0 },
  });
  const tileText = (html, label) =>
    html.match(new RegExp(`data-tile="${label}">([^<]*)<`))[1];
  const compared = { ...props, comparisonId: "c", comparisonName: "Empty" };
  const product = { ...baseReport, layout: "page", pageType: "PRODUCT" };
  const productHtml = render(resultsWith(product, emptyComparison(product)), compared);
  assert.equal(tileText(productHtml, "Conversion rate"), "Conversion rate=4%");
  assert.equal(tileText(productHtml, "Add-to-cart rate"), "Add-to-cart rate=20% [20 added to cart]");
  const collection = { ...baseReport, layout: "page", pageType: "COLLECTION" };
  const collectionHtml = render(resultsWith(collection, emptyComparison(collection)), compared);
  assert.equal(
    tileText(collectionHtml, "Click-through rate"),
    "Click-through rate=31.5% [Clicked through to a product]",
  );
  assert.doesNotMatch(collectionHtml, /pts/);
});

test("funnel shows revenue for purchases, with the hint, Not recorded, zero and the comparison", () => {
  const { GrowthConversionFunnel } = load("app/components/GrowthConversionFunnel.tsx", common);
  const funnel = {
    sessions: 200,
    addedToCart: 40,
    checkoutStarted: 10,
    purchased: 12,
    revenue: 480.5,
    pricedConversions: 12,
    unpricedConversions: 0,
  };
  assert.match(render(GrowthConversionFunnel, { funnel, currency: "EUR" }), /Revenue=€480\.50</);
  assert.match(
    render(GrowthConversionFunnel, { funnel: { ...funnel, pricedConversions: 10, unpricedConversions: 2 }, currency: "EUR" }),
    /Revenue=€480\.50 \[Some orders have no recorded amount\]/,
  );
  assert.match(
    render(GrowthConversionFunnel, { funnel: { ...funnel, revenue: 0, pricedConversions: 0, unpricedConversions: 12 }, currency: "EUR" }),
    /Revenue=Not recorded/,
  );
  assert.match(
    render(GrowthConversionFunnel, { funnel: { ...funnel, purchased: 0, revenue: 0, pricedConversions: 0 }, currency: "EUR" }),
    /Revenue=€0\.00</,
  );
  assert.match(
    render(GrowthConversionFunnel, { funnel, currency: "EUR", before: { ...funnel, revenue: 100 }, comparisonName: "Baseline" }),
    /Revenue=€480\.50 \[€100\.00 in Baseline\]/,
  );
});

test("devices show conversions and revenue beside the conversion rate and explain the mark", () => {
  const { GrowthEngagementMetrics } = load("app/components/GrowthEngagementMetrics.tsx", common);
  const html = render(GrowthEngagementMetrics, { summary, layout: "store", exitPages: [], currency: "EUR" });
  assert.match(html, /<th>Share of sessions<\/th><th>Conversions<\/th><th>Conversion rate<\/th><th>Revenue<\/th>/);
  assert.match(html, /<td>21<\/td><td>2\.4%<\/td><td>€1,050\.00\*<\/td>/);
  assert.match(html, /<td>20<\/td><td>4\.9%<\/td><td>€1,200\.00<\/td>/);
  assert.match(html, /\* Some orders have no recorded amount/);
});

test("sessions by page shows conversions and revenue per page, marking partly recorded rows", () => {
  const { GrowthSessionsByPage } = load("app/components/GrowthSessionsByPage.tsx", common);
  const html = render(GrowthSessionsByPage, {
    available: true,
    currency: "EUR",
    pages: [
      ranked("/collections/shoes", "COLLECTION", 2, { conversions: 2, conversionRate: 100, revenue: 90, pricedConversions: 2 }),
      ranked("/products/red", "PRODUCT", 3, { conversions: 3, conversionRate: 100, revenue: 40, pricedConversions: 1, unpricedConversions: 2 }),
      ranked("/pages/about", "PAGE", 1),
      ranked("/products/green", "PRODUCT", 1, { conversions: 1, conversionRate: 100, unpricedConversions: 1 }),
    ],
  });
  assert.match(html, /<th>Conversions<\/th><th>Conversion rate<\/th><th>Revenue<\/th><th>Weakness<\/th>/);
  assert.match(html, /<td>€90\.00<\/td>/);
  assert.match(html, /<td>€40\.00\*<\/td>/);
  assert.match(html, /<td>€0\.00<\/td>/, "A page without conversions has zero revenue");
  assert.match(html, /<td>Not recorded<\/td>/);
  assert.match(html, /\* Some orders have no recorded amount/);
  assert.match(html, /so one order can count on several pages\./);
});

test("sessions by page has no footnote when every amount was recorded", () => {
  const { GrowthSessionsByPage } = load("app/components/GrowthSessionsByPage.tsx", common);
  const html = render(GrowthSessionsByPage, {
    available: true,
    currency: "EUR",
    pages: [ranked("/collections/shoes", "COLLECTION", 2, { conversions: 2, revenue: 90, pricedConversions: 2 })],
  });
  assert.doesNotMatch(html, /Some orders have no recorded amount/);
});

test("page tiles show conversions, the conversion rate and revenue in the shop currency", () => {
  const html = render(resultsWith({ ...baseReport, layout: "page", pageType: "PRODUCT" }), props);
  assert.match(html, /Converted sessions=4/);
  assert.match(html, /Conversion rate=4%/);
  assert.match(html, /Revenue=€180\.00</);
});

test("the revenue tile hints at partial amounts and says Not recorded when none were recorded", () => {
  const partial = render(
    resultsWith({ ...baseReport, layout: "page", pageType: "PRODUCT", revenue: 150, pricedConversions: 3, unpricedConversions: 1 }),
    props,
  );
  assert.match(partial, /Revenue=€150\.00 \[Some orders have no recorded amount\]/);
  const imported = render(
    resultsWith({ ...baseReport, layout: "page", pageType: "PRODUCT", revenue: 0, pricedConversions: 0, unpricedConversions: 4 }),
    props,
  );
  assert.match(imported, /Revenue=Not recorded/);
  assert.doesNotMatch(imported, /NaN/);
});

test("the revenue tile names the comparison's revenue", () => {
  const current = { ...baseReport, layout: "page", pageType: "PRODUCT" };
  const html = render(resultsWith(current, { ...current, revenue: 100 }), {
    ...props,
    comparisonId: "c",
    comparisonName: "Baseline",
  });
  assert.match(html, /Revenue=€180\.00 \[€100\.00 in Baseline\]/);
});

test("traffic by source shows revenue next to the conversion rate and marks partly recorded rows", () => {
  const html = render(
    resultsWith({
      ...baseReport,
      layout: "store",
      pageType: null,
      channels: [
        baseReport.channels[0],
        { source: "google", medium: "", campaign: "", sessions: 20, addedToCart: 4, conversions: 2, conversionRate: 10, revenue: 30, pricedConversions: 1, unpricedConversions: 1 },
      ],
    }),
    props,
  );
  assert.match(html, /<th>Conversion rate<\/th><th>Revenue<\/th>/);
  assert.match(html, /<td>4%<\/td><td>€180\.00<\/td>/);
  assert.match(html, /<td>10%<\/td><td>€30\.00\*<\/td>/);
  assert.match(html, /\* Some orders have no recorded amount/);
});

test("the store layout hands the shop currency to the engagement, funnel and pages cards", () => {
  const html = render(resultsWith({ ...baseReport, layout: "store", pageType: null }), props);
  assert.equal((html.match(/data-currency="EUR"/g) || []).length, 3);
});
