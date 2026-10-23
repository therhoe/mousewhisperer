import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// DB-free route and server-rendered UI checks. All authenticated/service calls are mocked.
// Run: node scripts/check-channel-snapshot-ui.mjs
const require = createRequire(import.meta.url);
const polaris = require("@shopify/polaris");
const { AppProvider } = polaris;
const i18n = require("@shopify/polaris/locales/en.json");

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
      URL,
      URLSearchParams,
      Request,
      Response,
      FormData,
    },
    { filename: path },
  );
  return runtimeModule.exports;
}

const { buildChannelReport } = compile("../app/utils/channel-report.ts");
const navigationHelpers = compile("../app/utils/page-snapshot-navigation.ts");
for (const [resourceType, category] of Object.entries({
  PRODUCT: "products",
  COLLECTION: "collections",
  HOMEPAGE: "homepage",
  PAGE: "pages",
  BLOG: "blogs",
})) {
  const path = navigationHelpers.getPageSnapshotResourcePath(resourceType);
  assert.equal(path, `/app/page-snapshots/${category}`);
  assert.equal(navigationHelpers.isPageSnapshotsPath(path), true);
  assert.equal(
    navigationHelpers.isPageSnapshotsPath(`/app/audits/${category}`),
    true,
  );
}
assert.equal(
  navigationHelpers.getPageSnapshotResourcePath("UNKNOWN"),
  "/app/page-snapshots/products",
);
assert.equal(
  navigationHelpers.isPageSnapshotsPath("/app/project/regression"),
  true,
);
assert.equal(
  navigationHelpers.isPageSnapshotsPath("/app/channel-snapshots"),
  false,
);
assert.equal(
  navigationHelpers.isPageSnapshotsPath("/app/page-snapshots-other"),
  false,
);
const snapshot = {
  id: "channel-regression",
  name: "Channel regression",
  status: "ACTIVE",
  completionMode: "HUMAN_SESSIONS",
  targetSessions: 1000,
  durationDays: null,
  startedAt: "2026-08-26T10:00:00.000Z",
  endsAt: null,
  completedAt: null,
};
const sessionRows = ["REAL", "REAL", "REAL", "REAL", "ZOMBIE", "BOT"].map(
  (visitorType, index) => ({
    id: String(index),
    channel: "Organic Search",
    source: "google",
    medium: "organic",
    campaign: "summer",
    visitorType,
    pageViews: 2,
    timeOnPage: 60_000,
    averageScrollDepth: 40,
    addedToCart: index < 2,
    checkoutStarted: index === 0,
    converted: index === 0,
  }),
);
const reportFixture = {
  snapshot,
  ...buildChannelReport(sessionRows),
  progress: {
    label: "5 of 1,000 human sessions",
    current: 5,
    target: 1000,
    percent: 0.5,
  },
};
const billingAccess = {
  plan: "WHISPER",
  planName: "Whisper",
  canCreateNormalSnapshot: true,
  usage: { normalSnapshots: 2, storeSnapshots: 1, abTests: 0 },
  limits: {
    normalSnapshots: 50,
    storeSnapshots: 10,
    abTests: 5,
    maxSnapshotTargetVisitors: 10000,
  },
};
const historyFixture = {
  snapshots: Array.from({ length: 10 }, (_, index) => ({
    ...snapshot,
    id: `history-${index}`,
    name: `Regression ${index + 1}`,
    _count: { sessions: 6 },
  })),
  page: 1,
  pageCount: 2,
  total: 12,
  activeSnapshotId: snapshot.id,
};
let loadedData = {
  ...historyFixture,
  billingAccess,
};
const overviewFixture = {
  snapshot: null,
  range: null,
  buckets: [],
  channels: [],
  summary: {
    sessions: 0,
    real: 0,
    humanSessions: 0,
    conversions: 0,
    realShare: null,
    conversionRate: null,
  },
  updatedAt: "2026-08-26T12:00:00.000Z",
};
let actionData;
let fetcherData;
let overviewError;
let serviceReport = reportFixture;
let authError;
let transitionError;
let creationError;
let pixelSetup = { ready: true, pixelId: "pixel-regression", changed: false };
let expanded = false;
let stateIndex = 0;
let currentSearch = new URLSearchParams();
const capturedSelects = [];
const capturedPagination = [];
const calls = [];

class ChannelSnapshotError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
class PlanLimitError extends Error {
  constructor(message) {
    super(message);
    this.status = 403;
  }
}
const mocks = {
  react: {
    ...React,
    useState: (initial) => [
      expanded && stateIndex++ === 0
        ? true
        : typeof initial === "function"
          ? initial()
          : initial,
      () => {},
    ],
  },
  "@remix-run/react": {
    Link: ({ to, children, style }) =>
      React.createElement("a", { href: to, style }, children),
    useLoaderData: () => loadedData,
    useActionData: () => actionData,
    useNavigate: () => () => {},
    useNavigation: () => ({ state: "idle" }),
    useSubmit: () => () => {},
    useSearchParams: () => [
      currentSearch,
      (updater) => {
        currentSearch =
          typeof updater === "function"
            ? updater(currentSearch)
            : new URLSearchParams(updater);
      },
    ],
    useFetcher: () => ({
      state: "idle",
      data: fetcherData,
      load: () => {},
      submit: () => {},
    }),
    useRevalidator: () => ({ state: "idle", revalidate: () => {} }),
  },
  "@shopify/app-bridge-react": { TitleBar: () => null },
  "@shopify/polaris": {
    ...polaris,
    Select: (props) => {
      capturedSelects.push(props);
      return React.createElement(polaris.Select, props);
    },
    Pagination: (props) => {
      capturedPagination.push(props);
      return React.createElement(polaris.Pagination, props);
    },
  },
  "../shopify.server": {
    authenticate: {
      admin: async () => {
        if (authError) throw authError;
        return { session: { shop: "regression.myshopify.com" }, admin: {} };
      },
    },
  },
  "../utils/channel-snapshot.server": {
    ChannelSnapshotError,
    listChannelSnapshots: async (...args) => {
      calls.push(["list", ...args]);
      return historyFixture;
    },
    createChannelSnapshot: async (input) => {
      calls.push(["create", input]);
      if (creationError) throw creationError;
      return snapshot;
    },
    getChannelSnapshotReport: async (...args) => {
      calls.push(["report", ...args]);
      return serviceReport;
    },
    transitionChannelSnapshot: async (...args) => {
      calls.push(["transition", ...args]);
      if (transitionError) throw transitionError;
      return snapshot;
    },
  },
  "../utils/web-pixel.server": {
    ensureWebPixel: async () => {
      calls.push(["pixel"]);
      return pixelSetup;
    },
  },
  "../utils/billing.server": {
    getBillingAccess: async () => billingAccess,
    getBillingDisplayAccess: async (...args) => {
      calls.push(["billing-display", ...args]);
      return billingAccess;
    },
    isPlanLimitError: (error) => error instanceof PlanLimitError,
    planLimitPayload: (error) => ({
      error: error.message,
      upgradeUrl: "/app/upgrade",
    }),
  },
  "../utils/storefront-tracker-status.server": {
    getStorefrontTrackerStatus: async () => {
      throw new Error("The Channel shell must not inspect storefront tracking");
    },
  },
  "../utils/channel-overview.server": {
    getChannelOverview: async (...args) => {
      calls.push(["overview", ...args]);
      if (overviewError) throw overviewError;
      return overviewFixture;
    },
  },
  "../utils/loader-cache.server": {
    loaderCacheKeys: { billingDisplay: (shop) => `billing-display:${shop}` },
    clearCacheKey: (key) => {
      calls.push(["clear-cache", key]);
    },
  },
  "../components/PremiumGate": {
    planUsagePillLabel: () => "Whisper · 2/50 snapshots",
    TargetLimitText: () => null,
  },
};
mocks["../components/ChannelPerformanceCard"] = compile(
  "../app/components/ChannelPerformanceCard.tsx",
  mocks,
);
const index = compile("../app/routes/app.channel-snapshots._index.tsx", mocks);
const detail = compile(
  "../app/routes/app.channel-snapshots.$id.tsx",
  mocks,
  "export { countAndPercent, filterOptions };",
);

function render(Component) {
  stateIndex = 0;
  return renderToStaticMarkup(
    React.createElement(AppProvider, { i18n }, React.createElement(Component)),
  );
}

const historyHtml = render(index.default);
assert.ok(historyHtml.includes("Channel Snapshots"));
assert.ok(historyHtml.includes("Page 1 of 2"));
assert.equal(
  (historyHtml.match(/href="\/app\/channel-snapshots\/history-/g) || []).length,
  20,
);
assert.ok(historyHtml.includes("30 minutes of inactivity"));
assert.ok(historyHtml.includes("not Shopify Analytics"));
assert.ok(historyHtml.includes("Whisper · 2/50 snapshots"));
assert.ok(!historyHtml.includes("Regression 11"));
assert.ok(historyHtml.includes("Channel performance"));
assert.ok(historyHtml.includes("Loading channel performance"));
assert.ok(historyHtml.includes("How channel traffic is measured"));
assert.ok(!historyHtml.includes("Check storefront tracking"));
assert.ok(!historyHtml.includes("One arrival, one channel"));
assert.ok(!historyHtml.includes("Mouse Whisperer"));
assert.ok(!historyHtml.includes("MW tracking"));
assert.ok(
  historyHtml.indexOf("Channel performance") <
    historyHtml.indexOf("Regression 1"),
  "Performance sits above snapshot history",
);
assert.ok(
  historyHtml.indexOf("How channel traffic is measured") >
    historyHtml.indexOf("Regression 10"),
  "The optional explanation is below history",
);
fetcherData = {
  error: "Channel performance could not be loaded. Please retry the graph.",
};
assert.ok(render(index.default).includes("Retry graph"));
fetcherData = undefined;
loadedData = {
  ...loadedData,
  snapshots: [],
  pageCount: 1,
  total: 0,
  activeSnapshotId: null,
};
assert.ok(render(index.default).includes("No channel snapshots yet"));
actionData = { error: "Your snapshot allowance is used up." };
assert.ok(render(index.default).includes(actionData.error));
actionData = undefined;

loadedData = {
  report: reportFixture,
  filters: { channel: "", source: "", campaign: "" },
};
const defaultHtml = render(detail.default);
const reportTableStart = defaultHtml.indexOf(
  'aria-label="Traffic quality by acquisition channel, source, and campaign"',
);
const reportTableEnd = defaultHtml.indexOf("</table>", reportTableStart);
assert.notEqual(reportTableStart, -1);
assert.notEqual(reportTableEnd, -1);
const reportTableHtml = defaultHtml.slice(reportTableStart, reportTableEnd);
const textOnly = (markup) => markup.replace(/<[^>]*>/g, "");
const reportHeaders = [
  ...reportTableHtml.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g),
].map((match) => textOnly(match[1]));
assert.deepEqual(reportHeaders, [
  "Channel / source",
  "Campaign",
  "Sessions",
  "Real",
  "Zombie",
  "Bot",
  "Add to cart",
  "Conversions",
  "Avg time",
  "Avg scroll",
]);
const firstReportRow = reportTableHtml.match(
  /<tbody><tr[^>]*>([\s\S]*?)<\/tr>/,
)?.[1];
assert.ok(firstReportRow);
const firstReportCells = [
  ...firstReportRow.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g),
].map((match) => textOnly(match[1]));
assert.deepEqual(firstReportCells.slice(2), [
  "6",
  "4",
  "1",
  "1",
  "2",
  "1",
  "1:00",
  "40%",
]);
assert.ok(defaultHtml.includes("Show percentages"));
assert.ok(defaultHtml.includes("min-width:1080px"));
assert.ok(defaultHtml.includes("Organic Search"));
assert.ok(defaultHtml.includes("conversion rate"));
assert.ok(defaultHtml.includes("converted human sessions ÷ human sessions"));
assert.ok(
  defaultHtml.includes("Unknown means the arrival source was not available"),
);
assert.ok(!defaultHtml.includes("4 (66.7%)"));
assert.ok(!defaultHtml.includes("1 (20%)"));
assert.ok(!reportTableHtml.includes("Pending"));
expanded = true;
const expandedHtml = render(detail.default);
assert.ok(expandedHtml.includes("Hide percentages"));
assert.ok(expandedHtml.includes("min-width:1320px"));
assert.ok(expandedHtml.includes("4 (66.7%)"));
assert.ok(expandedHtml.includes("1 (16.7%)"));
assert.ok(expandedHtml.includes("1 (20%)"));
assert.ok(expandedHtml.includes("2 (40%)"));
expanded = false;
assert.equal(detail.countAndPercent(0, 0, true), "0 (0%)");
assert.ok(
  detail
    .filterOptions(["__none__"], "All sources", "", "No source")
    .some(
      (option) => option.value === "__none__" && option.label === "No source",
    ),
);

loadedData = {
  report: {
    ...reportFixture,
    ...buildChannelReport([]),
    snapshot: { ...snapshot, status: "COMPLETED" },
  },
  filters: { channel: "", source: "", campaign: "" },
};
const emptyHtml = render(detail.default);
assert.ok(emptyHtml.includes("No sessions captured yet"));
assert.ok(!emptyHtml.includes("Pause snapshot"));
assert.ok(!emptyHtml.includes("Resume snapshot"));
loadedData = {
  report: {
    ...reportFixture,
    ...buildChannelReport(sessionRows, { source: "unmatched" }),
  },
  filters: { channel: "", source: "unmatched", campaign: "" },
};
const filteredHtml = render(detail.default);
assert.ok(filteredHtml.includes("No traffic matches these filters"));
assert.ok(filteredHtml.includes("Clear filters"));
currentSearch = new URLSearchParams(
  "page=4&source=google&campaign=summer&host=embedded",
);
capturedSelects
  .filter((select) => select.label === "Channel")
  .at(-1)
  .onChange("Email");
assert.equal(currentSearch.get("channel"), "Email");
assert.equal(
  currentSearch.get("page"),
  null,
  "Changing a filter resets pagination",
);
assert.equal(currentSearch.get("source"), "google");
assert.equal(currentSearch.get("campaign"), "summer");
assert.equal(currentSearch.get("host"), "embedded");

const manyRows = Array.from({ length: 12 }, (_, index) => ({
  ...sessionRows[0],
  id: `source-${index}`,
  source: `source-${index}`,
}));
loadedData = {
  report: { ...reportFixture, ...buildChannelReport(manyRows) },
  filters: { channel: "", source: "", campaign: "" },
};
const paginatedHtml = render(detail.default);
assert.ok(paginatedHtml.includes("Page 1 of 2"));
assert.ok(paginatedHtml.includes("1–10 of 12 source groups"));
capturedPagination.at(-1).onNext();
assert.equal(currentSearch.get("page"), "2");
assert.equal(
  currentSearch.get("campaign"),
  "summer",
  "Pagination retains filters",
);

const loaderResult = await index.loader({
  request: new Request("https://app.test/app/channel-snapshots?page=2"),
});
assert.equal(loaderResult.status, 200);
assert.deepEqual(
  calls.find((call) => call[0] === "list"),
  ["list", "regression.myshopify.com", 2],
);
assert.equal(
  calls.some((call) => call[0] === "overview"),
  false,
);
assert.deepEqual(
  calls.find((call) => call[0] === "billing-display"),
  ["billing-display", "regression.myshopify.com"],
);
assert.equal("trackerStatus" in (await loaderResult.json()), false);
const beforeOverview = calls.length;
const overviewResponse = await index.loader({
  request: new Request(
    "https://app.test/app/channel-snapshots?_overview=1&_refresh=1",
  ),
});
assert.equal(overviewResponse.status, 200);
assert.equal(
  overviewResponse.headers.get("Cache-Control"),
  "private, no-store",
);
assert.equal(
  JSON.stringify(await overviewResponse.json()),
  JSON.stringify({ overview: overviewFixture }),
);
assert.equal(
  JSON.stringify(calls.slice(beforeOverview)),
  JSON.stringify([["overview", "regression.myshopify.com", { force: true }]]),
  "The deferred chart request does not reload history, billing or storefront status",
);
overviewError = new Error("Mock aggregation failure");
const overviewFailure = await index.loader({
  request: new Request("https://app.test/app/channel-snapshots?_overview=1"),
});
assert.equal(overviewFailure.status, 503);
assert.match((await overviewFailure.json()).error, /retry the graph/);
overviewError = undefined;
const filteredRequest = new Request(
  "https://app.test/app/channel-snapshots/channel-regression?channel=Organic%20Search&source=__none__&campaign=summer&page=3",
);
await detail.loader({ request: filteredRequest, params: { id: snapshot.id } });
assert.equal(
  JSON.stringify(calls.find((call) => call[0] === "report")),
  JSON.stringify([
    "report",
    "regression.myshopify.com",
    snapshot.id,
    {
      channel: "Organic Search",
      source: "__none__",
      campaign: "summer",
      page: 3,
    },
  ]),
);
serviceReport = null;
await assert.rejects(
  () =>
    detail.loader({ request: filteredRequest, params: { id: snapshot.id } }),
  (response) => response.status === 404,
);
serviceReport = reportFixture;

function post(url, values) {
  return new Request(url, {
    method: "POST",
    body: new URLSearchParams(values),
  });
}
// Legacy reports remain readable, but all new captures start through Projects.
// Validation, readiness, quotas and atomic capture creation are exercised by
// check-growth-projects.mjs and the real PostgreSQL Project regression suite.
for (const values of [
  { completionMode: "INVALID" },
  { completionMode: "TOTAL_SESSIONS", targetSessions: "500", name: " Quality " },
  { completionMode: "TIME_WINDOW", durationDays: "7", targetSessions: "999" },
]) {
  const creation = await index.action({
    request: post("https://app.test/app/channel-snapshots", {
      action: "create-channel-snapshot",
      ...values,
    }),
  });
  assert.equal(creation.status, 302);
  assert.equal(creation.headers.get("Location"), "/app/projects?create=1");
}
assert.equal(calls.filter((call) => call[0] === "pixel").length, 0);
assert.equal(calls.filter((call) => call[0] === "create").length, 0);
assert.equal(calls.some((call) => call[0] === "clear-cache"), false);

const transitionRequest = (action) =>
  post(`https://app.test/app/channel-snapshots/${snapshot.id}`, { action });
const paused = await detail.action({
  request: transitionRequest("pause"),
  params: { id: snapshot.id },
});
assert.equal(paused.status, 200);
assert.deepEqual(
  calls.find((call) => call[0] === "transition"),
  ["transition", "regression.myshopify.com", snapshot.id, "pause"],
);
const deleteAttempt = await detail.action({
  request: transitionRequest("delete"),
  params: { id: snapshot.id },
});
assert.equal(deleteAttempt.status, 400);
transitionError = new ChannelSnapshotError("Another snapshot is active.", 409);
const conflict = await detail.action({
  request: transitionRequest("resume"),
  params: { id: snapshot.id },
});
assert.equal(conflict.status, 409);
assert.equal((await conflict.json()).error, transitionError.message);
transitionError = undefined;

authError = new Response("Unauthenticated", { status: 401 });
const previousCalls = calls.length;
await assert.rejects(
  () =>
    index.loader({
      request: new Request("https://app.test/app/channel-snapshots"),
    }),
  (response) => response.status === 401,
);
await assert.rejects(
  () =>
    detail.action({
      request: transitionRequest("pause"),
      params: { id: snapshot.id },
    }),
  (response) => response.status === 401,
);
assert.equal(
  calls.length,
  previousCalls,
  "Unauthenticated requests must not call channel services",
);
console.log("Channel Snapshot UI and route regression checks passed.");
