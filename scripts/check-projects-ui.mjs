// Read-only mocked route/SSR checks; never connects to Shopify or a database.
// Run: node --test scripts/check-projects-ui.mjs
/* eslint jest/no-deprecated-functions: "off", jest/expect-expect: ["error", { "assertFunctionNames": ["assert", "assert.*"] }] */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
// React Router 7: screen loaders import json() from ../utils/route-data; this
// double answers with a real Response so the assertions below stay unchanged.
const routeDataMock = {
  json: (body, init) =>
    Response.json(JSON.parse(JSON.stringify(body) ?? "null"), typeof init === "number" ? { status: init } : init),
};
const require = createRequire(import.meta.url);
const read = (file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
// Controllable timers: the compile context gets these instead of real ones.
const timers = [];
const fakeSetTimeout = (fn, ms) => {
  timers.push({ fn, ms, cancelled: false, fired: false });
  return timers.length;
};
const fakeClearTimeout = (id) => {
  if (timers[id - 1]) timers[id - 1].cancelled = true;
};
const fireTimers = () => {
  for (const timer of timers.splice(0)) if (!timer.cancelled && !timer.fired) { timer.fired = true; timer.fn(); }
};
function compile(file, mocks = {}) {
  const mod = { exports: {} };
  runInNewContext(
    ts.transpileModule(read(file), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports: mod.exports,
      module: mod,
      require: (id) => (id in mocks ? mocks[id] : id === "../utils/route-data" ? routeDataMock : require(id)),
      URL,
      URLSearchParams,
      Request,
      Response,
      FormData,
      Date,
      crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" },
      console,
      setTimeout: fakeSetTimeout,
      clearTimeout: fakeClearTimeout,
    },
  );
  return mod.exports;
}
const pure = compile("app/utils/growth-projects.ts");
const reportPure = compile("app/utils/growth-report.ts");
const embeddedFilters = compile("app/utils/embedded-filter-params.ts");
const navigation = compile("app/utils/navigation.ts");
const revenuePure = compile("app/utils/revenue.ts");
const realJsx = require("react/jsx-runtime");
// Records the click handlers of Polaris elements so tests can press them.
function jsxRuntime(state) {
  const record = (type, props) => {
    if (type === "s-search-field" && typeof props?.onInput === "function") state.searchInput = props.onInput;
    if (type === "s-press-button" || type === "s-select")
      state.controls?.push({ type, label: props.children, pressed: props.pressed, value: props.value, ref: props.ref, onClick: props.onClick, onChange: props.onChange });
    if (typeof type === "string" && type.startsWith("s-") && typeof props?.onClick === "function")
      state.buttons.push({ type, slot: props.slot, label: props.children, onClick: props.onClick });
  };
  return {
    ...realJsx,
    jsx: (type, props, key) => { record(type, props); return realJsx.jsx(type, props, key); },
    jsxs: (type, props, key) => { record(type, props); return realJsx.jsxs(type, props, key); },
  };
}
const t = (key, vars = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
const i18n = {
  useI18n: () => ({
    t,
    formatNumber: String,
    formatDate: (date) => new Date(date).toISOString(),
  }),
};
const project = {
  id: "project-one",
  title: "Checkout goal",
  goal: "Improve checkout",
  scope: "STORE",
  defaultSource: "facebook",
  defaultMedium: "paid",
  defaultCampaign: "launch",
  journeyTracking: false,
  resourceProject: null,
  measurements: [
    {
      id: "measurement-one",
      name: "Baseline",
      status: "ACTIVE",
      completionMode: "VISITORS",
      targetVisitors: 100,
      createdAt: "2026-10-20",
      reportUrl: "/app/store-snapshots/capture-one",
    },
  ],
  abTests: [
    {
      id: "test-one",
      name: "Checkout button",
      status: "DRAFT",
      goal: "CONVERSION",
      createdAt: "2026-10-20",
    },
  ],
  activities: [],
};
function harness(file, data = { project, shop: "owner.myshopify.com" }) {
  const state = {
    params: new URLSearchParams(),
    appData: { apiKey: "test-key" },
    data,
    owned: true,
    calls: [],
    buttons: [],
    controls: [],
    primary: null,
    secondary: [],
    states: [],
    refs: [],
    effects: [],
    pending: [],
    modalClose: null,
    stateIndex: 0,
    refIndex: 0,
    effectIndex: 0,
  };
  const fetcher = {
    state: "idle",
    data: undefined,
    submit: (payload) => state.calls.push(["submit", payload]),
    load: (path) => state.calls.push(["load", path]),
    Form: ({ children, ...props }) =>
      React.createElement("form", props, children),
  };
  const simple = (tag) =>
    function ComponentStub({ children }) {
      return React.createElement(tag, null, children);
    };
  const Modal = ({ children, primaryAction, onClose }) => {
    state.primary = primaryAction;
    state.modalClose = onClose;
    return React.createElement("section", null, children);
  };
  Modal.Section = simple("div");
  const Field = ({ label, value }) => React.createElement("label", null, label, React.createElement("input", { value, readOnly: true }));
  const Pagination = ({ label }) => React.createElement("nav", null, label);
  const IndexTable = simple("table");
  IndexTable.Row = simple("tr");
  IndexTable.Cell = simple("td");
  const FormLayout = simple("div");
  FormLayout.Group = simple("div");
  const polaris = new Proxy(
    {
      Modal,
      FormLayout,
      IndexTable,
      Pagination,
      Checkbox: Field,
      TextField: Field,
      Select: Field,
      ChoiceList: ({ title }) => React.createElement("fieldset", null, title),
      Page: ({ title, primaryAction, secondaryActions, children }) => {
        state.primary = primaryAction;
        state.pagePrimary = primaryAction;
        state.secondary = secondaryActions;
        return React.createElement(
          "main",
          null,
          React.createElement("h1", null, title),
          children,
        );
      },
      Tabs: ({ tabs, selected, onSelect }) => {
        state.tabs = { tabs, selected, onSelect };
        return React.createElement("nav", null, tabs.map((tab) => tab.content).join("|"));
      },
      Link: ({ url, children }) => React.createElement("a", { href: url }, children),
      Button: ({ children, onClick, url, disabled }) => {
        state.buttons.push({ label: children, onClick, url, disabled });
        return React.createElement("button", { disabled }, children);
      },
    },
    {
      get: (target, name) => {
        if (!(name in target)) {
          const stub = simple("div");
          for (const part of ["Section", "Row", "Cell", "Group", "Item"])
            stub[part] = simple("div");
          target[name] = stub;
        }
        return target[name];
      },
    },
  );
  const services = {
    listGrowthProjects: async (shop, filters) => {
      state.calls.push(["list", shop, filters]);
      return { projects: [], page: 1, pageCount: 1, total: 0, counts: { ALL: 0, MEASURING: 0, IDLE: 0, COMPLETED: 0 } };
    },
    createGrowthProject: async (shop, _admin, form, options) => {
      state.calls.push(["create", shop, form, options]);
      return { projectId: "project-one" };
    },
    getGrowthProject: async (shop, id) => {
      state.calls.push(["get", shop, id]);
      return project;
    },
    startGrowthMeasurement: async (shop, _admin, id, form) => {
      state.calls.push(["start", shop, id, form]);
      return { measurementId: "measurement-two" };
    },
    transitionGrowthMeasurement: async (...args) =>
      state.calls.push(["transition", ...args]),
  };
  const mocks = {
    react: {
      ...React,
      useState: (initial) => {
        const i = state.stateIndex++;
        if (!(i in state.states))
          state.states[i] = typeof initial === "function" ? initial() : initial;
        return [
          state.states[i],
          (value) =>
            (state.states[i] =
              typeof value === "function" ? value(state.states[i]) : value),
        ];
      },
      useEffect: (effect, deps) => {
        const i = state.effectIndex++;
        const old = state.effects[i];
        if (!old || deps.some((value, j) => value !== old[j]))
          state.pending.push(effect);
        state.effects[i] = deps;
      },
      useRef: (initial) => {
        const i = state.refIndex++;
        return (state.refs[i] ??= { current: initial });
      },
    },
    "react-router": {
    ...require("react-router"),
      useLoaderData: () => state.data,
      useRouteLoaderData: () => state.appData,
      useSearchParams: () => [
        state.params,
        (params, options) => {
          // holdNavigation simulates a slow loader: the address stays put until the test lets it arrive.
          if (state.holdNavigation) state.requested = params;
          else state.params = params;
          state.navigationOptions = options;
        },
      ],
      useFetcher: () => fetcher,
      useNavigate: () => (url) => state.calls.push(["navigate", url]),
      Form: ({ children, ...props }) =>
        React.createElement("form", props, children),
      Link: ({ to, children, ...props }) =>
        React.createElement("a", { href: to, ...props }, children),
    },
    "@shopify/polaris": polaris,
    "../shopify.server": {
      authenticate: {
        admin: async () => {
          state.calls.push(["auth"]);
          return { session: { shop: "owner.myshopify.com" }, admin: {} };
        },
      },
    },
    "../db.server": {
      growthProject: {
        findFirst: async ({ where }) => {
          state.calls.push(["ownership", where]);
          return state.owned ? { id: where.id } : null;
        },
        update: async () => ({}),
      },
      growthProjectActivity: {
        create: async () => {
          state.calls.push(["activity"]);
          return {};
        },
      },
      $transaction: async (values) => Promise.all(values),
    },
    "../utils/growth-projects.server": services,
    "../utils/growth-projects": pure,
    "../utils/growth-report": reportPure,
    "../utils/revenue": revenuePure,
    "../utils/embedded-filter-params": embeddedFilters,
    "../utils/growth-report.server": reportPure,
    "../utils/billing.server": { isPlanLimitError: () => false },
    "../utils/i18n": i18n,
    "react/jsx-runtime": jsxRuntime(state),
    "../utils/navigation": navigation,
    "../components/ProjectsTable": {
      ProjectsTable: (props) => {
        state.table = props;
        return React.createElement("table", { "data-page": props.page });
      },
    },
    "@shopify/app-bridge-react": {
      useAppBridge: () => ({ resourcePicker: async () => [] }),
      Modal: ({ open, children }) =>
        React.createElement("dialog", { "data-open": String(open) }, children),
      TitleBar: () => null,
    },
    "../utils/snapshot-setup": { trackerEditorUrl: () => "https://owner.myshopify.com/admin/themes/current/editor" },
    "../components/GrowthProjectForm": {
      GrowthProjectForm: ({ projectId, next, onClose }) => {
        state.modalClose = onClose;
        return React.createElement("div", {
          "data-create-project": projectId || "new",
          "data-next": next,
        });
      },
    },
    "../components/GrowthProjectList": {
      GrowthProjectList: () => null,
      ScopeBadge: () => null,
      StatusBadge: ({ status }) => React.createElement("span", null, status),
    },
    "../components/GrowthMeasurementResults": {
      GrowthMeasurementResults: () => null,
    },
    "../components/GrowthProjectJourneys": {
      GrowthProjectJourneys: ({ projectId, measurementId, filters }) =>
        React.createElement("div", {
          "data-project-journeys": projectId,
          "data-measurement": measurementId,
          "data-audience": filters.audience,
          "data-source": filters.source,
          "data-medium": filters.medium,
          "data-campaign": filters.campaign,
        }),
    },
    "../components/GrowthResultsSheet": {
      GrowthResultsSheet: (props) => {
        state.sheet = props;
        return React.createElement("div", {
          "data-results-open": String(props.open),
          "data-measurement": props.selected.id,
          "data-audience": props.filters.audience,
          "data-source": props.filters.source,
          "data-medium": props.filters.medium,
        });
      },
    },
    "../components/GrowthOverviewCard": {
      MetricTile: ({ label, value, caption }) =>
        React.createElement("div", { "data-tile": label }, `${label}=${value}${caption ? ` [${caption}]` : ""}`),
    },
    "./GrowthOverviewCard": {
      MetricTile: ({ label, value }) => React.createElement("div", null, label, value),
    },
    "../components/LanguageMenu": {
      useLanguageActionGroup: () => ({ title: "Language", actions: [] }),
    },
    "../utils/background-json": {
      useBackgroundJson: () => state.background ?? { data: undefined, loading: true, error: null, reload() {} },
    },
    "./GrowthMeasurementResults": {
      GrowthMeasurementResults: ({ measurementId, filters }) =>
        React.createElement("div", { "data-results": measurementId, "data-audience": filters.audience }),
    },
    "./GrowthProjectJourneys": {
      GrowthProjectJourneys: ({ projectId, measurementId, filters }) =>
        React.createElement("div", {
          "data-project-journeys": projectId,
          "data-measurement": measurementId,
          "data-audience": filters.audience,
          "data-source": filters.source,
          "data-medium": filters.medium,
          "data-campaign": filters.campaign,
        }),
    },
    "./GrowthProjectList": {
      ScopeBadge: () => null,
      StatusBadge: ({ status }) => React.createElement("span", null, status),
    },
  };
  const route = compile(file, mocks);
  const render = (props) => {
    state.stateIndex = 0;
    state.refIndex = 0;
    state.effectIndex = 0;
    state.buttons = [];
    state.controls = [];
    const html = renderToStaticMarkup(React.createElement(route.default || route.GrowthProjectForm || route.GrowthResultsSheet, props));
    // The DOM commit (props written, refs attached) comes before effects run.
    state.afterCommit?.();
    const effects = state.pending.splice(0);
    effects.forEach((effect) => effect());
    return html;
  };
  const action = async (entries = {}, id = "project-one") => {
    const body = new FormData();
    Object.entries(entries).forEach(([key, value]) => body.set(key, value));
    return route.action({
      request: new Request("https://app.test/app/projects/" + id, {
        method: "POST",
        body,
      }),
      params: { id },
    });
  };
  return { state, route, render, action };
}

test("project creation is authenticated, keeps quick-create destination, and rejects arbitrary redirects", async () => {
  const h = harness("app/routes/app.projects._index.tsx");
  const response = await h.action({
    intent: "create-project",
    next: "ab-test",
  });
  assert.equal(
    response.headers.get("location"),
    "/app/ab-tests?create=1&projectId=project-one",
  );
  assert.equal(h.state.calls[0][0], "auth");
  assert.equal(h.state.calls[1][1], "owner.myshopify.com");
  assert.equal(h.state.calls[1][3].startMeasurement, false);
  const normal = await h.action({
    intent: "create-project",
    next: "https://attacker.test",
  });
  assert.equal(normal.headers.get("location"), "/app/projects/project-one");
  assert.equal(h.state.calls.filter((call) => call[0] === "create")[1][3].startMeasurement, true);
  const invalid = await h.action({ intent: "delete" });
  assert.equal(invalid.status, 400);
});

test("project actions validate tenant ownership before start, transition or optimization writes", async () => {
  const h = harness("app/routes/app.projects.$id.tsx");
  h.state.owned = false;
  for (const intent of ["start-measurement", "transition", "log-activity"]) {
    const response = await h.action({
      intent,
      measurementId: "foreign",
      transition: "complete",
      title: "Change",
    });
    assert.equal(response.status, 404);
  }
  assert.equal(
    h.state.calls.filter((call) =>
      ["start", "transition", "activity"].includes(call[0]),
    ).length,
    0,
  );
  assert.equal(
    h.state.calls.find((call) => call[0] === "ownership")[1].shop,
    "owner.myshopify.com",
  );
  h.state.owned = true;
  const started = await h.action({ intent: "start-measurement" });
  assert.equal(
    started.headers.get("location"),
    "/app/projects/project-one?measurement=measurement-two",
  );
  const logged = await h.action({
    intent: "log-activity",
    title: "Fixed checkout",
  });
  assert.equal(
    logged.headers.get("location"),
    "/app/projects/project-one?tab=activity",
  );
});

test("validation responses retain interpolation keys for translated error messages", async () => {
  const h = harness("app/routes/app.projects.$id.tsx");
  const response = await h.action({
    intent: "log-activity",
    title: "x".repeat(121),
  });
  const error = await response.json();
  assert.equal(response.status, 400);
  assert.equal(error.errorKey, "Use no more than {maximum} characters.");
  assert.equal(error.errorValues.maximum, 120);
});

test("project default filters reach the results sheet and can be explicitly cleared without changing the audience", () => {
  const h = harness("app/routes/app.projects.$id.tsx");
  h.state.params = new URLSearchParams("audience=active");
  const html = h.render();
  assert.match(html, /data-results-open="false"/);
  assert.match(html, /data-audience="active" data-source="facebook" data-medium="paid"/);
  h.state.sheet.onChange({ source: "", medium: "", campaign: "" });
  assert.equal(h.state.params.get("source"), "");
  assert.equal(h.state.params.get("medium"), "");
  assert.equal(h.state.params.get("campaign"), "");
  assert.equal(h.state.params.get("audience"), "active");
  const cleared = reportPure.growthReportFilters(h.state.params, project);
  assert.equal(cleared.source, "");
  assert.equal(h.state.calls.filter((call) => call[0] === "submit").length, 0);
});

test("View results opens the full-screen sheet for the selected measurement and close removes it", () => {
  const h = harness("app/routes/app.projects.$id.tsx");
  h.render();
  assert.equal(h.state.pagePrimary.content, "View results");
  h.state.pagePrimary.onAction();
  assert.equal(h.state.params.get("results"), "1");
  assert.equal(h.state.params.get("measurement"), "measurement-one");
  assert.match(h.render(), /data-results-open="true"/);
  h.state.sheet.onClose();
  assert.equal(h.state.params.has("results"), false);
  assert.match(h.render(), /data-results-open="false"/);
});

test("Project report navigation preserves public embedded context without replaying a stale launch token", () => {
  const h = harness("app/routes/app.projects.$id.tsx");
  h.state.params = new URLSearchParams({
    shop: "owner.myshopify.com",
    host: "encoded-admin-host",
    embedded: "1",
    locale: "de",
    id_token: "expired-launch-token",
    hmac: "old-signature",
    timestamp: "123",
  });
  h.render();
  h.state.sheet.onChange({ audience: "active" });
  for (const [name, value] of Object.entries({ shop: "owner.myshopify.com", host: "encoded-admin-host", embedded: "1", locale: "de", audience: "active" })) {
    assert.equal(h.state.params.get(name), value);
  }
  for (const name of ["id_token", "hmac", "timestamp"]) assert.equal(h.state.params.has(name), false);
});

test("Project report navigation restores missing launch context from the authenticated parent loader", () => {
  const h = harness("app/routes/app.projects.$id.tsx");
  h.state.appData.embeddedContext = {
    shop: "owner.myshopify.com",
    host: "authenticated-admin-host",
    embedded: "1",
  };
  h.render();
  h.state.sheet.onChange({ source: "google" });
  for (const [name, value] of Object.entries(h.state.appData.embeddedContext)) {
    assert.equal(h.state.params.get(name), value);
  }
  assert.equal(h.state.params.get("source"), "google");
  assert.equal(h.state.params.has("session"), false);
});

test("before/after report API authorizes the Project and passes identical filters and the shop currency to both tenant-scoped measurements", async () => {
  const calls = [];
  let owned = true;
  const admin = { graphql: async () => Response.json({}) };
  const api = compile("app/routes/api.growth-report.tsx", {
    "../shopify.server": { authenticate: { admin: async () => ({ session: { shop: "owner.myshopify.com" }, admin }) } },
    "../db.server": { growthProject: { findFirst: async ({ where }) => {
      calls.push(["ownership", where]);
      return owned ? project : null;
    } } },
    "../utils/growth-projects": pure,
    "../utils/growth-report": reportPure,
    "../utils/shop-currency.server": { getShopCurrency: async (client, shop) => {
      calls.push(["currency", client === admin, shop]);
      return "EUR";
    } },
    "../utils/growth-report.server": { getGrowthMeasurementReport: async (...args) => {
      calls.push(["report", ...args]);
      if (args[2] === "foreign-measurement") throw new pure.GrowthProjectError("Measurement not found.", 404);
      return { sessions: 1 };
    } },
  });
  const get = (query) => api.loader({ request: new Request(`https://app.test/api/growth-report?${query}`) });
  const response = await get("projectId=project-one&measurement=after&compare=before&audience=active&source=&medium=&campaign=sale");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(calls[0][1].shop, "owner.myshopify.com");
  assert.deepEqual(
    calls.filter((call) => call[0] === "currency"),
    [["currency", true, "owner.myshopify.com"]],
    "One authenticated currency lookup for both reports",
  );
  const reports = calls.filter((call) => call[0] === "report");
  assert.deepEqual(reports.map((call) => call.slice(1, 4)), [
    ["owner.myshopify.com", "project-one", "after"],
    ["owner.myshopify.com", "project-one", "before"],
  ]);
  assert.equal(reports[0][4], reports[1][4]);
  assert.equal(reports[0][4].source, "");
  assert.equal(reports[0][4].audience, "active");
  assert.equal(reports[0][4].campaign, "sale");
  assert.deepEqual(reports.map((call) => call[5]), ["EUR", "EUR"]);
  await assert.rejects(() => get("projectId=project-one&measurement=after&compare=foreign-measurement"), (error) => error.status === 404);
  owned = false;
  calls.length = 0;
  await assert.rejects(() => get("projectId=foreign&measurement=after"), (error) => error.status === 404);
  assert.equal(calls.filter((call) => call[0] === "report").length, 0);
  assert.equal(calls.filter((call) => call[0] === "currency").length, 0, "No Shopify call for a foreign Project");
});

test("Project tabs preserve filters and A/B shortcut preselects the containing project", () => {
  const h = harness("app/routes/app.projects.$id.tsx");
  h.state.params = new URLSearchParams("tab=tests&source=facebook");
  const html = h.render();
  assert.equal(h.state.tabs.selected, 1);
  assert.match(html, /href="\/app\/ab-tests\/test-one"/);
  h.state.tabs.onSelect(0);
  assert.equal(h.state.params.get("tab"), "measurements");
  assert.equal(h.state.params.get("source"), "facebook");
  assert.equal(h.state.params.get("listPage"), "1");
  assert.equal(
    h.state.secondary.find((action) => action.content === "Create A/B test")
      .url,
    "/app/ab-tests?create=1&projectId=project-one",
  );
});

test("results sheet shows journeys only with enabled tracking and a companion capture, using the selected filters", () => {
  const h = harness("app/components/GrowthResultsSheet.tsx");
  const selected = { ...project.measurements[0], customerSnapshotId: "journey-one" };
  const filters = { audience: "active", source: "google", medium: "cpc", campaign: "sale" };
  const props = {
    open: true,
    onClose() {},
    onChange() {},
    shop: "owner.myshopify.com",
    project: { ...project, journeyTracking: true, measurements: [selected] },
    selected,
    filters,
  };
  const html = h.render(props);
  assert.match(html, /data-results="measurement-one" data-audience="active"/);
  assert.match(html, /data-project-journeys="project-one"/);
  assert.match(html, /data-audience="active" data-source="google" data-medium="cpc" data-campaign="sale"/);
  // The sheet is its own frame; an href there would load the bare URL without the embedded session.
  const classic = h.state.buttons.find((button) => button.label === "Open classic report");
  assert.equal(classic.url, undefined);
  classic.onClick();
  assert.deepEqual(h.state.calls.at(-1), ["navigate", "/app/store-snapshots/capture-one"]);
  assert.doesNotMatch(h.render({ ...props, project: { ...props.project, journeyTracking: false } }), /data-project-journeys/);
  assert.doesNotMatch(h.render({ ...props, selected: project.measurements[0] }), /data-project-journeys/);
  assert.doesNotMatch(h.render({ ...props, open: false }), /data-results=/);
});

test("successful measurement redirect closes the same-route modal", () => {
  const h = harness("app/routes/app.projects.$id.tsx");
  h.render();
  h.state.secondary.find((action) => action.content === "Start measurement").onAction();
  assert.match(h.render(), /data-create-project="project-one"/);
  h.state.params = new URLSearchParams("measurement=measurement-two");
  h.render();
  assert.doesNotMatch(h.render(), /data-create-project/);
});

const projectsData = (overrides = {}) => ({
  projects: [{ id: "p1" }],
  page: 2,
  pageCount: 3,
  total: 23,
  shop: "owner.myshopify.com",
  counts: { ALL: 23, MEASURING: 2, IDLE: 14, COMPLETED: 7 },
  filters: { status: "ALL", scope: "ALL", query: "", page: 2 },
  ...overrides,
});

test("Projects reads its filters from the address and passes them to the list", async () => {
  const h = harness("app/routes/app.projects._index.tsx", projectsData());
  const response = await h.route.loader({
    request: new Request("https://app.test/app/projects?status=idle&scope=page&q=%20spring%20&page=3"),
  });
  const call = h.state.calls.find((entry) => entry[0] === "list");
  assert.deepEqual(JSON.parse(JSON.stringify(call[2])), { status: "IDLE", scope: "PAGE", query: "spring", page: 3 });
  assert.equal((await response.json()).filters.status, "IDLE");
});

test("Projects filters replace the address, reset the page and keep the embedded context", () => {
  const h = harness("app/routes/app.projects._index.tsx", projectsData());
  h.state.params = new URLSearchParams("page=2&shop=owner.myshopify.com&host=abc");
  const html = h.render();
  assert.match(html, /<s-page heading="Projects">/);
  assert.match(html, /slot="primary-action" variant="primary">Create project</);
  assert.match(html, /slot="secondary-actions" href="\/app\/ab-tests\?create=1">Create A\/B test</);
  assert.equal((html.match(/variant="primary"/g) || []).length, 1, "one primary button per screen");
  for (const label of ["All 23", "Measuring 2", "Idle 14", "Completed 7"]) assert.ok(html.includes(label), label);
  assert.equal(h.state.table.page, 2);
  h.state.buttons.find((button) => button.label === "Idle 14").onClick();
  assert.equal(h.state.params.get("status"), "IDLE");
  assert.equal(h.state.params.has("page"), false, "a filter change starts at page 1");
  assert.equal(h.state.params.get("shop"), "owner.myshopify.com");
  assert.equal(h.state.navigationOptions.replace, true, "filters never add Back steps");
  h.render();
  h.state.table.onPage(3);
  assert.equal(h.state.params.get("page"), "3");
  assert.equal(h.state.params.get("status"), "IDLE");
  assert.equal(h.state.navigationOptions.replace, true, "pages never add Back steps");
});

test("Projects quick-create opens from the address or the button and closes cleanly", () => {
  const h = harness("app/routes/app.projects._index.tsx", projectsData());
  assert.doesNotMatch(h.render(), /data-create-project/);
  h.state.params = new URLSearchParams("create=1&next=ab-test");
  h.render();
  assert.match(h.render(), /data-create-project="new" data-next="ab-test"/);
  h.state.modalClose();
  assert.equal(h.state.params.has("create"), false);
  assert.equal(h.state.params.has("next"), false);
  h.render();
  h.state.buttons.find((button) => button.slot === "primary-action").onClick();
  assert.doesNotMatch(h.render(), /data-next="ab-test"/);
});

test("Projects shows the first-project state, and a no-match state with Clear filters", () => {
  const empty = harness("app/routes/app.projects._index.tsx", projectsData({
    projects: [],
    total: 0,
    pageCount: 1,
    counts: { ALL: 0, MEASURING: 0, IDLE: 0, COMPLETED: 0 },
    filters: { status: "ALL", scope: "ALL", query: "", page: 1 },
  }));
  const first = empty.render();
  assert.match(first, /Start your first project/);
  assert.doesNotMatch(first, /<table/);
  const filtered = harness("app/routes/app.projects._index.tsx", projectsData({
    projects: [],
    total: 0,
    filters: { status: "COMPLETED", scope: "ALL", query: "zzz", page: 1 },
  }));
  filtered.state.params = new URLSearchParams("status=COMPLETED&q=zzz");
  assert.match(filtered.render(), /No projects match these filters\./);
  filtered.state.buttons.find((button) => button.label === "Clear filters").onClick();
  assert.equal(filtered.state.params.toString(), "");
  assert.equal(filtered.state.navigationOptions.replace, true);
});

const typeInto = (h, value) => h.state.searchInput({ currentTarget: { value } });

test("a pending search cannot undo Clear filters while the loader is slow", () => {
  const h = harness("app/routes/app.projects._index.tsx", projectsData({
    projects: [],
    total: 0,
    filters: { status: "COMPLETED", scope: "ALL", query: "zzz", page: 1 },
  }));
  h.state.params = new URLSearchParams("status=COMPLETED&q=zzz");
  h.state.holdNavigation = true;
  h.render();
  typeInto(h, "zzzy");
  h.render();
  h.state.buttons.find((button) => button.label === "Clear filters").onClick();
  h.render();
  fireTimers();
  h.render();
  fireTimers();
  const last = h.state.requested;
  assert.equal(last.has("status"), false, "status stays cleared");
  assert.equal(last.has("q"), false, "the search stays cleared");
});

test("a pending search keeps a status chosen before it fires, and a status keeps the search", () => {
  const h = harness("app/routes/app.projects._index.tsx", projectsData({
    filters: { status: "ALL", scope: "ALL", query: "", page: 1 },
  }));
  h.state.params = new URLSearchParams();
  h.state.holdNavigation = true;
  h.render();
  typeInto(h, "spring");
  h.render();
  h.state.buttons.find((button) => button.label === "Idle 14").onClick();
  assert.equal(h.state.requested.get("status"), "IDLE");
  h.render();
  fireTimers();
  assert.equal(h.state.requested.get("status"), "IDLE", "the old address does not restore the status");
  assert.equal(h.state.requested.get("q"), "spring");
  assert.equal(h.state.navigationOptions.replace, true);
  assert.equal(h.state.navigationOptions.preventScrollReset, true);
});

test("results for our own search do not overwrite later typing, but an address change does", () => {
  const h = harness("app/routes/app.projects._index.tsx", projectsData({
    filters: { status: "ALL", scope: "ALL", query: "", page: 1 },
  }));
  h.state.params = new URLSearchParams();
  h.state.holdNavigation = true;
  h.render();
  typeInto(h, "spring");
  h.render();
  fireTimers();
  typeInto(h, "springs");
  // the loader answers the first request while the merchant has typed one more letter
  h.state.params = h.state.requested;
  h.state.data = projectsData({ filters: { status: "ALL", scope: "ALL", query: "spring", page: 1 } });
  h.render();
  assert.match(h.render(), /value="springs"/);
  // Back to an address the screen did not request
  h.state.params = new URLSearchParams("q=other");
  h.state.data = projectsData({ filters: { status: "ALL", scope: "ALL", query: "other", page: 1 } });
  h.render();
  assert.match(h.render(), /value="other"/);
});

test("the status press buttons sit in the button group's secondary-actions slot so Polaris shows them", () => {
  const h = harness("app/routes/app.projects._index.tsx", projectsData());
  h.render();
  const presses = h.state.buttons.filter((button) => button.type === "s-press-button");
  assert.deepEqual(presses.map((button) => button.label), ["All 23", "Measuring 2", "Idle 14", "Completed 7"]);
  for (const button of presses) assert.equal(button.slot, "secondary-actions", button.label);
});

test("A/B quick-create collects Project metadata without starting or requesting a baseline", () => {
  const h = harness("app/components/GrowthProjectForm.tsx");
  const props = { open: true, onClose() {}, shop: "owner.myshopify.com", next: "ab-test" };
  const html = h.render(props);
  assert.equal(h.state.primary.content, "Create project & continue");
  assert.match(html, /Project title/);
  assert.match(html, /Goal/);
  assert.doesNotMatch(html, /Complete measurement by|Target visitors|Duration \(days\)|Open theme editor/);
  h.state.primary.onAction();
  const posted = h.state.calls.find((call) => call[0] === "submit")[1];
  assert.equal(posted.next, "ab-test");
  for (const key of ["completionMode", "measurementName", "targetVisitors", "durationDays"]) assert.equal(key in posted, false);
  const normal = h.render({ ...props, next: undefined });
  assert.match(normal, /Complete measurement by/);
  assert.match(normal, /Target visitors/);
  assert.equal(h.state.primary.content, "Create project");
});

test("Project lists paginate ten items and clamp stale page numbers", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    ...project.measurements[0],
    id: `measurement-${i}`,
    name: `Measurement ${i}`,
  }));
  const h = harness("app/routes/app.projects.$id.tsx", {
    project: { ...project, measurements: many },
    shop: "owner.myshopify.com",
  });
  h.state.params = new URLSearchParams("tab=measurements&listPage=999");
  const html = h.render();
  assert.match(html, /Measurement 10/);
  assert.match(html, /Measurement 11/);
  assert.doesNotMatch(html, /<td><div>Measurement 0</);
  assert.match(html, /Page 2 of 2/);
});

test("measurement form submits exactly one completion field and keeps default target 100", () => {
  const form = read("app/components/GrowthProjectForm.tsx");
  assert.match(form, /useState\("100"\)/);
  assert.match(
    form,
    /if \(mode === "VISITORS"\) data.targetVisitors = target;\s*else data.durationDays = duration;/,
  );
  assert.match(form, /journeyTracking: String\(scope === "STORE" && journey\)/);
  assert.match(form, /if \(open && !projectId\)/);
  const target = new FormData();
  target.set("completionMode", "VISITORS");
  target.set("targetVisitors", "100");
  assert.equal(pure.parseMeasurementInput(target).durationDays, null);
  target.set("durationDays", "7");
  assert.throws(
    () => pure.parseMeasurementInput(target),
    /only one completion method/,
  );
});

// Fake DOM for the status buttons and the Scope select. Polaris flips `pressed`
// itself on every click, and React only writes a prop that changed between
// renders; this reproduces both so the screen's corrections can be checked.
function filterDom(h) {
  const els = new Map();
  const lastProp = new Map();
  const key = (control) => (control.type === "s-select" ? "scope" : String(control.label).replace(/ \d+$/, ""));
  const commit = () => {
    for (const control of h.state.controls) {
      const k = key(control);
      const prop = control.type === "s-select" ? control.value : control.pressed;
      const el = els.get(k) ?? {};
      if (!els.has(k) || lastProp.get(k) !== prop) el[control.type === "s-select" ? "value" : "pressed"] = prop;
      els.set(k, el);
      lastProp.set(k, prop);
      control.ref?.(el);
    }
  };
  h.state.afterCommit = commit;
  const render = () => h.render();
  const find = (name) => h.state.controls.find((control) => key(control) === name);
  return {
    render,
    el: (name) => els.get(name),
    pressed: () => [...els].filter(([k, el]) => k !== "scope" && el.pressed).map(([k]) => k),
    click(name) {
      els.get(name).pressed = !els.get(name).pressed; // Polaris's own handler runs first
      find(name).onClick();
    },
    choose(value) {
      els.get("scope").value = value;
      find("scope").onChange({ currentTarget: els.get("scope") });
    },
  };
}

test("syncProjectFilterControls writes the requested status and scope onto the elements", () => {
  const controls = {
    statuses: { ALL: { pressed: false }, MEASURING: { pressed: true }, IDLE: { pressed: true }, COMPLETED: null },
    scope: { value: "STORE" },
  };
  pure.syncProjectFilterControls(controls, new URLSearchParams("status=idle&scope=page"));
  assert.deepEqual(
    [controls.statuses.ALL.pressed, controls.statuses.MEASURING.pressed, controls.statuses.IDLE.pressed],
    [false, false, true],
  );
  assert.equal(controls.scope.value, "PAGE");
  pure.syncProjectFilterControls(controls, new URLSearchParams("status=bogus"));
  assert.equal(controls.statuses.ALL.pressed, true);
  assert.equal(controls.statuses.IDLE.pressed, false);
  assert.equal(controls.scope.value, "ALL");
  pure.syncProjectFilterControls({ statuses: {}, scope: null }, new URLSearchParams());
});

test("clicking the status that is already applied keeps it pressed", () => {
  const h = harness("app/routes/app.projects._index.tsx", projectsData({ filters: { status: "ALL", scope: "ALL", query: "", page: 1 } }));
  const dom = filterDom(h);
  dom.render();
  assert.deepEqual(dom.pressed(), ["All"]);
  dom.click("All");
  assert.deepEqual(dom.pressed(), ["All"], "the self-toggle is undone");
  dom.render();
  assert.deepEqual(dom.pressed(), ["All"]);
});

test("two quick status clicks before the loader answers leave exactly the latest pressed", () => {
  const h = harness("app/routes/app.projects._index.tsx", projectsData({ filters: { status: "ALL", scope: "ALL", query: "", page: 1 } }));
  h.state.holdNavigation = true;
  const dom = filterDom(h);
  dom.render();
  dom.click("Idle");
  const idleAddress = h.state.requested;
  dom.render();
  dom.click("Measuring");
  assert.deepEqual(dom.pressed(), ["Measuring"]);
  dom.render();
  assert.deepEqual(dom.pressed(), ["Measuring"]);
  // Idle's answer arrives while Measuring is still the latest request.
  h.state.params = idleAddress;
  h.state.data = projectsData({ filters: { status: "IDLE", scope: "ALL", query: "", page: 1 } });
  dom.render();
  assert.deepEqual(dom.pressed(), ["Measuring"]);
  // Measuring's answer arrives.
  h.state.params = h.state.requested;
  h.state.data = projectsData({ filters: { status: "MEASURING", scope: "ALL", query: "", page: 1 } });
  dom.render();
  assert.deepEqual(dom.pressed(), ["Measuring"]);
});

test("Back or Forward moves the pressed status to the one in the new address", () => {
  const h = harness("app/routes/app.projects._index.tsx", projectsData({ filters: { status: "IDLE", scope: "ALL", query: "", page: 1 } }));
  h.state.params = new URLSearchParams("status=IDLE");
  const dom = filterDom(h);
  dom.render();
  assert.deepEqual(dom.pressed(), ["Idle"]);
  h.state.params = new URLSearchParams("status=COMPLETED");
  h.state.data = projectsData({ filters: { status: "COMPLETED", scope: "ALL", query: "", page: 1 } });
  dom.render();
  assert.deepEqual(dom.pressed(), ["Completed"]);
});

test("Clear filters during a held load puts the Scope select back to all scopes", () => {
  const h = harness("app/routes/app.projects._index.tsx", projectsData({
    projects: [],
    total: 0,
    filters: { status: "ALL", scope: "PAGE", query: "", page: 1 },
  }));
  h.state.params = new URLSearchParams("scope=PAGE");
  h.state.holdNavigation = true;
  const dom = filterDom(h);
  dom.render();
  assert.equal(dom.el("scope").value, "PAGE");
  dom.choose("STORE");
  dom.render();
  h.state.buttons.find((button) => button.label === "Clear filters").onClick();
  assert.equal(dom.el("scope").value, "ALL");
  dom.render();
  assert.equal(dom.el("scope").value, "ALL");
});

test("the latest measurement shows conversions and revenue beside the conversion rate", () => {
  const h = harness("app/routes/app.projects.$id.tsx");
  const report = {
    sessions: 200,
    atcRate: 10,
    conversions: 6,
    conversionRate: 3,
    revenue: 240,
    pricedConversions: 6,
    unpricedConversions: 0,
    currency: "EUR",
  };
  const answer = (value) => ({ data: { report: value }, loading: false, error: null, reload() {} });
  h.state.background = answer(report);
  let html = h.render();
  assert.match(html, /Conversions=6</);
  assert.match(html, /Conversion rate=3%</);
  assert.match(html, /Revenue=240</);
  h.state.background = answer({ ...report, pricedConversions: 5, unpricedConversions: 1 });
  html = h.render();
  assert.match(html, /Revenue=240 \[Some orders have no recorded amount\]/);
  h.state.background = answer({ ...report, revenue: 0, pricedConversions: 0, unpricedConversions: 6 });
  html = h.render();
  assert.match(html, /Revenue=Not recorded/);
  h.state.background = undefined;
  assert.match(h.render(), /Revenue=…/, "Loading shows an ellipsis, not Not recorded");
});
