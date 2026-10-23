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
const require = createRequire(import.meta.url);
const read = (file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
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
      require: (id) => (id in mocks ? mocks[id] : require(id)),
      URL,
      URLSearchParams,
      Request,
      Response,
      FormData,
      Date,
      crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" },
      console,
    },
  );
  return mod.exports;
}
const pure = compile("app/utils/growth-projects.ts");
const reportPure = compile("app/utils/growth-report.ts");
const embeddedFilters = compile("app/utils/embedded-filter-params.ts");
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
  const services = {
    listGrowthProjects: async (shop, page) => {
      state.calls.push(["list", shop, page]);
      return { projects: [], page: 1, pageCount: 1 };
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
    "@remix-run/react": {
      useLoaderData: () => state.data,
      useRouteLoaderData: () => state.appData,
      useSearchParams: () => [
        state.params,
        (params) => {
          state.params = params;
        },
      ],
      useFetcher: () => fetcher,
      Form: ({ children, ...props }) =>
        React.createElement("form", props, children),
      Link: ({ to, children, ...props }) =>
        React.createElement("a", { href: to, ...props }, children),
    },
    "@shopify/polaris": {
      Modal,
      BlockStack: simple("div"),
      InlineStack: simple("div"),
      Checkbox: Field,
      TextField: Field,
      Select: Field,
      Page: ({ title, primaryAction, secondaryActions, children }) => {
        state.primary = primaryAction;
        state.secondary = secondaryActions;
        return React.createElement(
          "main",
          null,
          React.createElement("h1", null, title),
          children,
        );
      },
      Card: simple("section"),
      Text: simple("span"),
      Badge: simple("span"),
      Banner: simple("aside"),
      Button: ({ children, onClick, url, disabled }) => {
        state.buttons.push({ label: children, onClick, url, disabled });
        return React.createElement("button", { disabled }, children);
      },
    },
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
    "../utils/embedded-filter-params": embeddedFilters,
    "../utils/growth-report.server": reportPure,
    "../utils/billing.server": { isPlanLimitError: () => false },
    "../utils/i18n": i18n,
    "@shopify/app-bridge-react": { useAppBridge: () => ({ resourcePicker: async () => [] }) },
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
    "../components/GrowthProjectList": { GrowthProjectList: () => null },
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
    "../styles/projects.css?url": "test.css",
  };
  const route = compile(file, mocks);
  const render = (props) => {
    state.stateIndex = 0;
    state.refIndex = 0;
    state.effectIndex = 0;
    state.buttons = [];
    const html = renderToStaticMarkup(React.createElement(route.default || route.GrowthProjectForm, props));
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

test("project default filters can be explicitly cleared without changing collection or selected audience", () => {
  const h = harness("app/routes/app.projects.$id.tsx");
  h.state.params = new URLSearchParams("audience=active");
  const html = h.render();
  assert.match(html, /name="source"[^>]*value="facebook"/);
  assert.match(html, /name="medium"[^>]*value="paid"/);
  h.state.buttons.find((button) => button.label === "Clear filters").onClick();
  assert.equal(h.state.params.get("source"), "");
  assert.equal(h.state.params.get("medium"), "");
  assert.equal(h.state.params.get("campaign"), "");
  assert.equal(h.state.params.get("audience"), "active");
  const cleared = reportPure.growthReportFilters(h.state.params, project);
  assert.equal(cleared.source, "");
  assert.equal(h.state.calls.filter((call) => call[0] === "submit").length, 0);
});

test("Project GET filters preserve public embedded context without resubmitting a stale launch token", () => {
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
  const html = h.render();
  const form = html.match(/<form[^>]*method="get"[\s\S]*?<\/form>/)?.[0];
  assert.ok(form);
  for (const [name, value] of Object.entries({ shop: "owner.myshopify.com", host: "encoded-admin-host", embedded: "1", locale: "de" })) {
    assert.match(form, new RegExp(`type="hidden" name="${name}" value="${value}"`));
  }
  assert.doesNotMatch(form, /expired-launch-token|old-signature|name="(?:id_token|hmac|timestamp)"/);
});

test("Project GET filters restore missing launch context from the authenticated parent loader", () => {
  const h = harness("app/routes/app.projects.$id.tsx");
  h.state.appData.embeddedContext = {
    shop: "owner.myshopify.com",
    host: "authenticated-admin-host",
    embedded: "1",
  };
  const form = h.render().match(/<form[^>]*method="get"[\s\S]*?<\/form>/)?.[0];
  assert.ok(form);
  for (const [name, value] of Object.entries(h.state.appData.embeddedContext)) {
    assert.match(form, new RegExp(`type="hidden" name="${name}" value="${value}"`));
  }
  assert.doesNotMatch(form, /name="(?:id_token|hmac|timestamp|session)"/);
});

test("before/after report API authorizes the Project and passes identical filters to both tenant-scoped measurements", async () => {
  const calls = [];
  let owned = true;
  const api = compile("app/routes/api.growth-report.tsx", {
    "../shopify.server": { authenticate: { admin: async () => ({ session: { shop: "owner.myshopify.com" } }) } },
    "../db.server": { growthProject: { findFirst: async ({ where }) => {
      calls.push(["ownership", where]);
      return owned ? project : null;
    } } },
    "../utils/growth-projects": pure,
    "../utils/growth-report": reportPure,
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
  const reports = calls.filter((call) => call[0] === "report");
  assert.deepEqual(reports.map((call) => call.slice(1, 4)), [
    ["owner.myshopify.com", "project-one", "after"],
    ["owner.myshopify.com", "project-one", "before"],
  ]);
  assert.equal(reports[0][4], reports[1][4]);
  assert.equal(reports[0][4].source, "");
  assert.equal(reports[0][4].audience, "active");
  assert.equal(reports[0][4].campaign, "sale");
  await assert.rejects(() => get("projectId=project-one&measurement=after&compare=foreign-measurement"), (error) => error.status === 404);
  owned = false;
  calls.length = 0;
  await assert.rejects(() => get("projectId=foreign&measurement=after"), (error) => error.status === 404);
  assert.equal(calls.filter((call) => call[0] === "report").length, 0);
});

test("Project tabs preserve filters and A/B shortcut preselects the containing project", () => {
  const h = harness("app/routes/app.projects.$id.tsx");
  h.state.params = new URLSearchParams("tab=tests&source=facebook");
  const html = h.render();
  assert.match(
    html,
    /href="\?tab=measurements&amp;source=facebook&amp;listPage=1"/,
  );
  assert.match(html, /href="\/app\/ab-tests\/test-one"/);
  assert.equal(
    h.state.secondary.find((action) => action.content === "Create A/B test")
      .url,
    "/app/ab-tests?create=1&projectId=project-one",
  );
});

test("native journeys require enabled tracking and a companion capture and use the selected report filters", () => {
  const selected = { ...project.measurements[0], customerSnapshotId: "journey-one" };
  const h = harness("app/routes/app.projects.$id.tsx", {
    project: { ...project, journeyTracking: true, measurements: [selected] },
    shop: "owner.myshopify.com",
  });
  h.state.params = new URLSearchParams("audience=active&source=google&medium=cpc&campaign=sale");
  const html = h.render();
  assert.match(html, /data-project-journeys="project-one"/);
  assert.match(html, /data-measurement="measurement-one"/);
  assert.match(html, /data-audience="active" data-source="google" data-medium="cpc" data-campaign="sale"/);
  h.state.data.project.journeyTracking = false;
  assert.doesNotMatch(h.render(), /data-project-journeys/);
  h.state.data.project.journeyTracking = true;
  h.state.data.project.measurements = project.measurements;
  assert.doesNotMatch(h.render(), /data-project-journeys/);
});

test("successful measurement redirect closes the same-route modal", () => {
  const h = harness("app/routes/app.projects.$id.tsx");
  h.render();
  h.state.primary.onAction();
  assert.match(h.render(), /data-create-project="project-one"/);
  h.state.params = new URLSearchParams("measurement=measurement-two");
  h.render();
  assert.doesNotMatch(h.render(), /data-create-project/);
});

test("global quick-create opens on a new URL even when Project list is already mounted", () => {
  const h = harness("app/routes/app.projects._index.tsx", {
    projects: [],
    page: 1,
    pageCount: 1,
    shop: "owner.myshopify.com",
  });
  assert.doesNotMatch(h.render(), /data-create-project/);
  h.state.params = new URLSearchParams("create=1&next=ab-test");
  h.render();
  assert.match(h.render(), /data-create-project="new" data-next="ab-test"/);
  h.state.modalClose();
  assert.equal(h.state.params.has("create"), false);
  assert.equal(h.state.params.has("next"), false);
  h.render();
  h.state.primary.onAction();
  assert.doesNotMatch(h.render(), /data-next="ab-test"/);
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
  assert.doesNotMatch(html, />Measurement 0</);
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
