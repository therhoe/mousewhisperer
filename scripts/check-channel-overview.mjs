import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// No database or network access: exercise the real aggregation/SSR code with
// scoped SQL mocks, including cache and no-data semantics.
// Run: node scripts/check-channel-overview.mjs
const require = createRequire(import.meta.url);
const NOW = "2026-08-26T12:30:00.000Z";
class FixedDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : [NOW]));
  }
  static now() {
    return Date.parse(NOW);
  }
}

function compile(relativePath, mocks = {}, extraExports = "") {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  const compiled = ts.transpileModule(
    `${readFileSync(path, "utf8")}\n${extraExports}`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    },
  );
  const runtimeModule = { exports: {} };
  runInNewContext(
    compiled.outputText,
    {
      exports: runtimeModule.exports,
      module: runtimeModule,
      require: (specifier) =>
        specifier in mocks ? mocks[specifier] : require(specifier),
      Date: FixedDate,
    },
    { filename: path },
  );
  return runtimeModule.exports;
}

const snapshot = {
  id: "overview-regression",
  name: "August acquisition",
  status: "ACTIVE",
  startedAt: new Date("2026-08-24T09:00:00.000Z"),
  endsAt: null,
  completedAt: null,
  updatedAt: new Date("2026-08-24T09:00:00.000Z"),
};
const rows = [
  {
    bucket: "2026-08-24T00:00:00Z",
    channel: "Organic Search",
    sessions: 2,
    real: 1,
    zombies: 0,
    conversions: 1,
  },
  {
    bucket: "2026-08-25T00:00:00Z",
    channel: "Organic Search",
    sessions: 110,
    real: 90,
    zombies: 10,
    conversions: 0,
  },
  {
    bucket: "2026-08-26T00:00:00Z",
    channel: "Email",
    sessions: 10,
    real: 6,
    zombies: 2,
    conversions: 2,
  },
];
let activeSnapshot = snapshot;
let latestSnapshot = snapshot;
let queryError;
let queryGate;
const lookups = [];
const queries = [];
const cache = compile("../app/utils/loader-cache.server.ts");
const { getOverviewWindow, buildChannelOverview, getChannelOverview } = compile(
  "../app/utils/channel-overview.server.ts",
  {
    "../db.server": {
      channelSnapshot: {
        findFirst: async (input) => {
          lookups.push(input);
          return input.where.status === "ACTIVE"
            ? activeSnapshot
            : latestSnapshot;
        },
      },
      $queryRaw: async (sql, ...values) => {
        queries.push({ sql: sql.join("?"), values });
        if (queryGate) await queryGate;
        if (queryError) throw queryError;
        return rows;
      },
    },
    "./loader-cache.server": cache,
  },
);

const now = new Date(NOW);
const hourly = getOverviewWindow(
  { ...snapshot, startedAt: new Date("2026-08-25T14:00:00.000Z") },
  now,
);
assert.equal(hourly.unit, "hour");
assert.equal(hourly.buckets.length, 23);
assert.equal(hourly.buckets[0], "2026-08-25T14:00:00.000Z");
assert.equal(hourly.buckets.at(-1), "2026-08-26T12:00:00.000Z");
const exactlyOneDay = getOverviewWindow(
  { ...snapshot, startedAt: new Date("2026-08-25T12:30:00.000Z") },
  now,
);
assert.equal(exactlyOneDay.unit, "hour");
assert.equal(exactlyOneDay.buckets.length, 25);
const daily = getOverviewWindow(snapshot, now);
assert.equal(daily.unit, "day");
assert.equal(daily.buckets.length, 3);
assert.equal(daily.start.toISOString(), snapshot.startedAt.toISOString());
const longSnapshot = {
  ...snapshot,
  startedAt: new Date("2026-01-01T00:00:00.000Z"),
};
const longWindow = getOverviewWindow(longSnapshot, now);
assert.equal(longWindow.buckets.length, 90);
assert.equal(longWindow.truncated, true);
assert.equal(longWindow.start.toISOString(), longWindow.buckets[0]);
assert.equal(longWindow.buckets.at(-1), "2026-08-26T00:00:00.000Z");
const paused = {
  ...longSnapshot,
  status: "PAUSED",
  updatedAt: new Date("2026-01-03T11:00:00.000Z"),
};
assert.equal(
  getOverviewWindow(paused, now).end.toISOString(),
  paused.updatedAt.toISOString(),
);
const completed = {
  ...snapshot,
  status: "COMPLETED",
  completedAt: new Date("2026-08-25T16:00:00.000Z"),
};
assert.equal(
  getOverviewWindow(completed, now).end.toISOString(),
  completed.completedAt.toISOString(),
);
const expired = { ...snapshot, endsAt: new Date("2026-08-25T17:00:00.000Z") };
assert.equal(
  buildChannelOverview(expired, [], now).snapshot.status,
  "COMPLETED",
);
assert.equal(
  getOverviewWindow(expired, now).end.toISOString(),
  expired.endsAt.toISOString(),
);

const data = buildChannelOverview(snapshot, rows, now);
assert.equal(data.range.timezone, "UTC");
assert.equal(data.summary.sessions, 122);
assert.equal(data.summary.humanSessions, 109);
assert.equal(data.summary.real, 97);
assert.equal(data.summary.conversions, 3);
assert.equal(data.summary.conversionRate, (3 / 109) * 100);
assert.equal(data.summary.realShare, (97 / 122) * 100);
assert.equal(data.channels[0].channel, "Organic Search");
assert.equal(data.channels[0].humanSessions, 101);
assert.equal(data.channels[0].points[0].conversionRate, 100);
assert.equal(data.channels[0].points[1].conversionRate, 0);
assert.equal(data.channels[0].points[2].conversionRate, null);
assert.equal(data.channels[0].points[2].humanSessions, 0);
assert.notEqual(
  data.summary.conversionRate,
  50,
  "Never average daily percentages",
);
const duplicateAggregate = buildChannelOverview(
  snapshot,
  [rows[0], rows[0]],
  now,
);
assert.equal(duplicateAggregate.channels[0].points[0].humanSessions, 2);
assert.equal(duplicateAggregate.channels[0].points[0].conversionRate, 100);
const bounded = buildChannelOverview(
  snapshot,
  [
    ...rows,
    { ...rows[0], bucket: "2026-01-01T00:00:00Z", sessions: 999 },
    { ...rows[0], bucket: "not-a-date", sessions: 999 },
  ],
  now,
);
assert.equal(
  bounded.summary.sessions,
  122,
  "Ignore buckets outside the displayed capture window",
);
const empty = buildChannelOverview(null, [], now);
assert.equal(empty.snapshot, null);
assert.equal(empty.buckets.length, 0);
assert.equal(empty.channels.length, 0);
assert.equal(empty.summary.conversionRate, null);
const noHumans = buildChannelOverview(
  snapshot,
  [
    {
      ...rows[0],
      channel: "Unknown",
      real: 0,
      zombies: 0,
      conversions: 0,
    },
  ],
  now,
);
assert.equal(noHumans.summary.sessions, 2);
assert.equal(noHumans.summary.humanSessions, 0);
assert.equal(noHumans.summary.conversionRate, null);

const result = await getChannelOverview("regression.myshopify.com");
assert.equal(result.snapshot.id, snapshot.id);
assert.equal(
  lookups.length,
  1,
  "Prefer the current active snapshot without loading history",
);
assert.equal(lookups[0].where.shop, "regression.myshopify.com");
assert.equal(lookups[0].where.status, "ACTIVE");
assert.equal(lookups[0].where.OR[1].endsAt.gt.toISOString(), NOW);
assert.equal(queries.length, 1);
assert.match(queries[0].sql, /capture\.shop = \?/);
assert.match(queries[0].sql, /s\."channelSnapshotId" = \?/);
assert.match(queries[0].sql, /s\."startedAt" >= \?/);
assert.match(queries[0].sql, /s\."startedAt" <= \?/);
assert.match(queries[0].sql, /GROUP BY s\.id/);
assert.match(queries[0].sql, /GROUP BY bucket, channel/);
assert.match(
  queries[0].sql,
  /"visitorType" IN \('REAL', 'ZOMBIE'\) AND converted/,
);
assert.match(queries[0].sql, /ELSE 'Unknown' END AS channel/);
assert.equal(queries[0].values[0], "day");
assert.equal(queries[0].values[1], "regression.myshopify.com");
assert.equal(queries[0].values[2], snapshot.id);
assert.equal(
  queries[0].values[3].toISOString(),
  snapshot.startedAt.toISOString(),
);
assert.equal(queries[0].values[4].toISOString(), NOW);
await getChannelOverview("regression.myshopify.com");
assert.equal(
  queries.length,
  1,
  "A warm overview does not repeat the aggregation",
);
await getChannelOverview("regression.myshopify.com", { force: true });
assert.equal(
  queries.length,
  2,
  "Refresh explicitly invalidates the cached graph",
);
await getChannelOverview("other.myshopify.com");
assert.equal(queries.length, 3, "Cached overview data is scoped by shop");

activeSnapshot = null;
latestSnapshot = completed;
const lookupsBeforeFallback = lookups.length;
await getChannelOverview("history.myshopify.com");
assert.equal(lookups.length - lookupsBeforeFallback, 2);
assert.equal(lookups.at(-1).where.shop, "history.myshopify.com");
assert.equal(lookups.at(-1).where.status, undefined);
assert.equal(
  queries.at(-1).values[4].toISOString(),
  completed.completedAt.toISOString(),
);
latestSnapshot = null;
const queriesBeforeEmpty = queries.length;
const emptyResult = await getChannelOverview("empty.myshopify.com");
assert.equal(emptyResult.snapshot, null);
assert.equal(
  queries.length,
  queriesBeforeEmpty,
  "No capture means no aggregation query",
);

activeSnapshot = longSnapshot;
await getChannelOverview("long.myshopify.com");
assert.equal(
  queries.at(-1).values[3].toISOString(),
  longWindow.start.toISOString(),
);
activeSnapshot = snapshot;
queryError = new Error("Mock database temporarily unavailable");
await assert.rejects(
  () => getChannelOverview("retry.myshopify.com"),
  /temporarily unavailable/,
);
queryError = undefined;
assert.equal(
  (await getChannelOverview("retry.myshopify.com")).snapshot.id,
  snapshot.id,
);

let releaseQuery;
queryGate = new Promise((resolve) => {
  releaseQuery = resolve;
});
const queriesBeforeParallel = queries.length;
const pending = [
  getChannelOverview("parallel.myshopify.com"),
  getChannelOverview("parallel.myshopify.com"),
];
await new Promise((resolve) => setImmediate(resolve));
assert.equal(
  queries.length,
  queriesBeforeParallel + 1,
  "Cold graph requests share one aggregation",
);
releaseQuery();
await Promise.all(pending);
queryGate = undefined;

const polaris = require("@shopify/polaris");
const i18n = require("@shopify/polaris/locales/en.json");
let selectedMetric = "humanSessions";
let hoveredBucket = null;
const component = compile(
  "../app/components/ChannelPerformanceCard.tsx",
  {
    react: {
      ...React,
      useState: (initial) => [
        initial === "humanSessions" ? selectedMetric : hoveredBucket,
        () => {},
      ],
    },
  },
  "export { seriesPath, chartMaximum };",
);
function render(overview, props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      polaris.AppProvider,
      { i18n },
      React.createElement(component.ChannelPerformanceCard, {
        data: overview,
        loading: false,
        onRefresh: () => {},
        ...props,
      }),
    ),
  );
}
const defaultHtml = render(data);
assert.ok(defaultHtml.includes("Channel performance"));
assert.ok(defaultHtml.includes("Snapshot tracking"));
assert.ok(!defaultHtml.includes("Mouse Whisperer"));
assert.ok(defaultHtml.includes("Human sessions by channel"));
assert.ok(defaultHtml.includes("Organic Search"));
assert.ok(defaultHtml.includes("Email"));
assert.ok(defaultHtml.includes("UTC"));
assert.ok(defaultHtml.includes("Converted sessions"));
assert.ok(defaultHtml.includes("2.75% conversion rate"));
assert.ok(defaultHtml.includes("Each acquisition session is counted once"));
assert.ok(defaultHtml.includes("Current bucket may be partial"));
assert.ok(defaultHtml.includes(`href="/app/channel-snapshots/${snapshot.id}"`));
assert.ok(defaultHtml.includes('role="slider"'));
assert.ok(defaultHtml.includes('aria-valuemax="2"'));
assert.ok(defaultHtml.includes('aria-valuenow="2"'));
assert.ok(defaultHtml.includes('role="img"'));
selectedMetric = "conversionRate";
hoveredBucket = 0;
const cvrHtml = render(data);
assert.ok(cvrHtml.includes("Conversion rate by channel"));
assert.ok(cvrHtml.includes("Gaps mean no human sessions"));
assert.ok(cvrHtml.includes("100% (1/1)"));
assert.ok(cvrHtml.includes("— (0/0)"));
assert.ok(cvrHtml.includes('aria-valuenow="0"'));
assert.equal(
  component.seriesPath(
    [2, null, 5, 6],
    (x) => x,
    (y) => y,
  ),
  "M0.0,2.0 M2.0,5.0 L3.0,6.0",
);
assert.ok(component.chartMaximum(0, "humanSessions") >= 4);
assert.equal(component.chartMaximum(100, "conversionRate"), 100);
const isolated = buildChannelOverview(
  snapshot,
  [rows[0], { ...rows[0], bucket: "2026-08-26T00:00:00Z" }],
  now,
);
hoveredBucket = null;
assert.equal(
  (render(isolated).match(/<circle /g) || []).length,
  2,
  "Isolated CVR buckets remain visible without connecting missing data",
);
assert.ok(!render(empty).includes('role="img"'));
assert.ok(render(empty).includes("Start a channel snapshot"));
assert.ok(
  render(noHumans).includes("Bots and pending sessions are not plotted"),
);
assert.ok(!render(noHumans).includes('role="img"'));
const noRows = buildChannelOverview(snapshot, [], now);
assert.ok(render(noRows).includes("No sessions captured in this range yet"));
assert.ok(
  render(buildChannelOverview(longSnapshot, rows, now)).includes(
    "Last 90 days of this snapshot",
  ),
);
assert.ok(
  render(null, { loading: true }).includes("Loading channel performance"),
);
assert.ok(
  render(null, { error: "Could not load graph" }).includes("Retry graph"),
);
assert.ok(
  render(data, { error: "Could not refresh graph" }).includes(
    "Showing the last loaded graph",
  ),
);

// Exercise actual keyboard/focus handlers against a narrow, scrolled chart.
// A separate graph viewport must move without changing page scroll or focus.
let keyboardBucket = null;
let scrollLeft = 0;
let scrollWrites = 0;
let focusCalls = 0;
let preventedKeys = 0;
const viewport = {
  clientWidth: 390,
  clientLeft: 0,
  scrollWidth: 560,
  scrollTop: 37,
  getBoundingClientRect: () => ({ left: 20, width: 390 }),
  get scrollLeft() {
    return scrollLeft;
  },
  set scrollLeft(value) {
    scrollLeft = value;
    scrollWrites++;
  },
  focus: () => {
    focusCalls++;
  },
};
const chart = {
  getBoundingClientRect: () => ({
    left: 20 - scrollLeft,
    width: viewport.scrollWidth,
  }),
  focus: () => {
    focusCalls++;
  },
};
let refIndex = 0;
const chartRefs = [{ current: viewport }, { current: chart }];
const keyboardComponent = compile(
  "../app/components/ChannelPerformanceCard.tsx",
  {
    react: {
      ...React,
      useId: () => "keyboard-regression",
      useRef: () => chartRefs[refIndex++],
      useState: () => [
        keyboardBucket,
        (value) => {
          keyboardBucket = value;
        },
      ],
    },
  },
  "export { ChannelTrendChart, revealChartPosition };",
);
function chartSlider() {
  refIndex = 0;
  return keyboardComponent.ChannelTrendChart({ data, metric: "humanSessions" })
    .props.children[0];
}
function keyDown(key) {
  chartSlider().props.onKeyDown({
    key,
    preventDefault: () => {
      preventedKeys++;
    },
  });
}
function assertBucketVisible() {
  const logicalX =
    44 + (keyboardBucket / (data.buckets.length - 1)) * (848 - 44);
  const relativeX = (logicalX / 860) * viewport.scrollWidth - scrollLeft;
  assert.ok(
    relativeX >= 0 && relativeX <= viewport.clientWidth,
    `Selected bucket ${keyboardBucket} must be inside the visible chart`,
  );
}
chartSlider().props.onFocus();
assert.equal(keyboardBucket, 2);
assertBucketVisible();
assert.equal(
  scrollLeft,
  170,
  "Focusing the default latest bucket reveals the right edge",
);
keyDown("Home");
assert.equal(keyboardBucket, 0);
assertBucketVisible();
const homeScroll = scrollLeft;
keyDown("ArrowRight");
assert.equal(keyboardBucket, 1);
assertBucketVisible();
assert.equal(
  scrollLeft,
  homeScroll,
  "Already-visible buckets do not shift the chart",
);
keyDown("End");
assert.equal(keyboardBucket, 2);
assertBucketVisible();
keyDown("ArrowLeft");
assert.equal(keyboardBucket, 1);
assertBucketVisible();
keyDown("Home");
assertBucketVisible();
const beforeTab = { scrollLeft, preventedKeys, keyboardBucket };
keyDown("Tab");
assert.deepEqual(
  { scrollLeft, preventedKeys, keyboardBucket },
  beforeTab,
  "Normal Tab navigation remains unhandled",
);
assert.equal(focusCalls, 0, "Scroll reveal must not call focus or steal focus");
assert.equal(
  viewport.scrollTop,
  37,
  "Scroll reveal does not change vertical scroll",
);
viewport.clientWidth = 860;
viewport.scrollWidth = 860;
scrollLeft = 0;
const beforeDesktop = scrollWrites;
keyDown("End");
assertBucketVisible();
assert.equal(
  scrollWrites,
  beforeDesktop,
  "A wide chart never scrolls unnecessarily",
);
viewport.clientWidth = 288;
viewport.scrollWidth = 560;
keyDown("End");
assertBucketVisible();
assert.equal(scrollLeft, 272, "The 320px layout also reveals its last bucket");
keyDown("Home");
assertBucketVisible();
keyboardComponent.revealChartPosition(null, null, 44);
console.log(
  "Channel overview aggregation, bounds, cache, chart and keyboard scroll-reveal regression checks passed.",
);
