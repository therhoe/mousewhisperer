// Local-only transport/lifecycle checks. No browser, Shopify, or database calls.
// Run: node --test scripts/check-background-transport.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const compiled = new Map();
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const valid = (value) => Boolean(value && typeof value.value === "number");
const json = (value, status = 200) => Response.json(value, { status });
const sameDeps = (a, b) =>
  Boolean(
    a &&
    b &&
    a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index])),
  );

function loadModule(file, mocks, globals = {}) {
  if (!compiled.has(file)) {
    compiled.set(
      file,
      ts.transpileModule(source(file), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      }).outputText,
    );
  }
  const runtimeModule = { exports: {} };
  runInNewContext(
    compiled.get(file),
    {
      exports: runtimeModule.exports,
      module: runtimeModule,
      require: (specifier) => {
        if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
        if (specifier.startsWith("react")) return require(specifier);
        throw new Error(`Unexpected dependency: ${specifier}`);
      },
      URL,
      AbortController,
      DOMException,
      Response,
      Promise,
      ...globals,
    },
    { filename: file },
  );
  return runtimeModule.exports;
}

// A small deterministic hook scheduler lets these checks exercise the actual
// hook/effect code with delayed promises, without adding a DOM/test dependency.
function harness(options = {}) {
  const slots = [];
  const effects = new Map();
  const timers = new Map();
  let cursor = 0;
  let timerId = 0;
  let dirty = false;
  let mounted = true;
  let props = {
    path: "/api/dashboard-conversion?period=month",
    isData: valid,
    errorMessage: "Report unavailable. Please retry.",
    scopeKey: "shop-a",
    ...options.props,
  };
  const state = {
    current: undefined,
    calls: [],
    tokenCalls: 0,
    updatesAfterUnmount: 0,
    fetch: options.fetch || (async () => json({ value: 1 })),
    token: options.token || (async () => "ephemeral-test-token"),
  };
  const bridge = {
    idToken: () => {
      state.tokenCalls++;
      return state.token();
    },
  };
  const react = {
    useRef: (initial) => {
      const index = cursor++;
      slots[index] ||= { kind: "ref", current: initial };
      return slots[index];
    },
    useState: (initial) => {
      const index = cursor++;
      slots[index] ||= {
        kind: "state",
        value: typeof initial === "function" ? initial() : initial,
      };
      return [
        slots[index].value,
        (next) => {
          if (!mounted) {
            state.updatesAfterUnmount++;
            return;
          }
          slots[index].value =
            typeof next === "function" ? next(slots[index].value) : next;
          dirty = true;
        },
      ];
    },
    useCallback: (callback, deps) => {
      const index = cursor++;
      if (!sameDeps(slots[index]?.deps, deps))
        slots[index] = { kind: "callback", callback, deps };
      return slots[index].callback;
    },
    useEffect: (effect, deps) => {
      const index = cursor++;
      slots[index] ||= { kind: "effect" };
      if (!sameDeps(slots[index].deps, deps))
        effects.set(index, { effect, deps });
    },
  };
  const globals = {
    window: {
      location: { origin: "https://app.test" },
      setTimeout: (callback, delay) => {
        const id = ++timerId;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      get localStorage() {
        throw new Error("Do not persist session tokens");
      },
      get sessionStorage() {
        throw new Error("Do not persist session tokens");
      },
    },
    fetch: (path, init) => {
      state.calls.push({ path, init });
      return state.fetch(path, init);
    },
    console: {
      log() {
        assert.fail("Do not log background credentials");
      },
      warn() {},
      error() {},
    },
  };
  const helper = loadModule(
    "app/utils/background-json.ts",
    {
      react,
      "@shopify/app-bridge-react": { useAppBridge: () => bridge },
    },
    globals,
  );
  const render = (next) => {
    if (next) props = { ...props, ...next };
    cursor = 0;
    dirty = false;
    state.current = helper.useBackgroundJson(props);
    return state.current;
  };
  const flushEffects = () => {
    for (const [index, pending] of effects) {
      const slot = slots[index];
      slot.cleanup?.();
      Object.assign(slot, pending);
      slot.cleanup = slot.effect();
    }
    effects.clear();
  };
  const flush = async () => {
    for (let pass = 0; pass < 4; pass++) {
      await new Promise(setImmediate);
      if (dirty) render();
      flushEffects();
    }
  };
  const fireTimers = () => {
    const pending = [...timers.values()];
    timers.clear();
    for (const timer of pending) timer.callback();
  };
  const unmount = () => {
    mounted = false;
    for (const slot of slots) if (slot?.kind === "effect") slot.cleanup?.();
    effects.clear();
  };
  const repeatEffects = () => {
    for (const slot of slots) {
      if (slot?.kind !== "effect") continue;
      slot.cleanup?.();
      slot.cleanup = slot.effect();
    }
  };
  render();
  return {
    state,
    helper,
    bridge,
    render,
    flushEffects,
    flush,
    fireTimers,
    timers,
    unmount,
    repeatEffects,
  };
}

test("only root-relative same-origin API paths can request an auth token", async () => {
  const h = harness();
  for (const path of [
    "https://external.test/api/report",
    "https://app.test/api/report",
    "//external.test/api/report",
    "api/report",
    "/app/report",
    "/api/../outside",
    "/api/%2e%2e/outside",
    "/api/\\external.test",
    "/api/report\n",
    "/api/report#fragment",
  ]) {
    await assert.rejects(
      h.helper.fetchBackgroundJson(path, {
        getIdToken: h.bridge.idToken,
        signal: new AbortController().signal,
        isData: valid,
      }),
      /app API path/,
    );
  }
  assert.equal(h.state.tokenCalls, 0);
  assert.equal(h.state.calls.length, 0);
});

test("GET uses a fresh ephemeral token, same-origin credentials, no-store, and no redirects", async () => {
  const h = harness();
  const controller = new AbortController();
  for (let index = 0; index < 2; index++) {
    assert.equal(
      (
        await h.helper.fetchBackgroundJson("/api/report?period=month", {
          getIdToken: h.bridge.idToken,
          signal: controller.signal,
          isData: valid,
        })
      ).value,
      1,
    );
  }
  assert.equal(h.state.tokenCalls, 2);
  const { path, init } = h.state.calls[0];
  assert.equal(path, "/api/report?period=month");
  assert.equal(init.method, "GET");
  assert.equal(init.headers.Authorization, "Bearer ephemeral-test-token");
  assert.equal(init.headers.Accept, "application/json");
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.cache, "no-store");
  assert.equal(init.redirect, "error");
  assert.equal(init.signal, controller.signal);
});

test("HTTP errors, login HTML, malformed JSON and invalid payloads are rejected", async () => {
  const h = harness();
  const responses = [
    () => json({ error: "service unavailable" }, 503),
    () =>
      new Response("<html>Log in</html>", {
        headers: { "Content-Type": "text/html" },
      }),
    () =>
      new Response("not-json", {
        headers: { "Content-Type": "application/json" },
      }),
    () => json({ error: "unexpected API payload" }),
  ];
  for (const response of responses) {
    h.state.fetch = async () => response();
    await assert.rejects(
      h.helper.fetchBackgroundJson("/api/report", {
        getIdToken: h.bridge.idToken,
        signal: new AbortController().signal,
        isData: valid,
      }),
    );
  }
});

test("auth rejection and missing tokens never start an unauthenticated fetch", async () => {
  const h = harness();
  for (const token of [
    async () => {
      throw new Error("token unavailable");
    },
    async () => "",
  ]) {
    await assert.rejects(
      h.helper.fetchBackgroundJson("/api/report", {
        getIdToken: token,
        signal: new AbortController().signal,
        isData: valid,
      }),
    );
  }
  assert.equal(h.state.calls.length, 0);
});

test("abort before or during token lookup prevents the request", async () => {
  const h = harness();
  const before = new AbortController();
  before.abort();
  await assert.rejects(
    h.helper.fetchBackgroundJson("/api/report", {
      getIdToken: h.bridge.idToken,
      signal: before.signal,
      isData: valid,
    }),
    { name: "AbortError" },
  );
  assert.equal(h.state.tokenCalls, 0);
  const token = deferred();
  const during = new AbortController();
  const request = h.helper.fetchBackgroundJson("/api/report", {
    getIdToken: () => token.promise,
    signal: during.signal,
    isData: valid,
  });
  during.abort();
  token.resolve("obsolete-test-token");
  await assert.rejects(request, { name: "AbortError" });
  assert.equal(h.state.calls.length, 0);
});

test("abort during JSON parsing cannot publish late data", async () => {
  const h = harness();
  const body = deferred();
  let parsing = false;
  h.state.fetch = async () => ({
    ok: true,
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => {
      parsing = true;
      return body.promise;
    },
  });
  const controller = new AbortController();
  const request = h.helper.fetchBackgroundJson("/api/report", {
    getIdToken: h.bridge.idToken,
    signal: controller.signal,
    isData: valid,
  });
  await new Promise(setImmediate);
  assert.equal(parsing, true);
  controller.abort();
  body.resolve({ value: 9 });
  await assert.rejects(request, { name: "AbortError" });
});

test("render never requests a token; delayed effects load once across rerenders", async () => {
  const h = harness({ props: { delayMs: 1000 } });
  assert.equal(h.state.tokenCalls, 0);
  assert.equal(h.state.current.loading, true);
  h.flushEffects();
  assert.equal(h.state.tokenCalls, 0);
  assert.equal([...h.timers.values()][0].delay, 1000);
  h.fireTimers();
  await h.flush();
  assert.equal(h.state.current.data.value, 1);
  assert.equal(h.state.current.loading, false);
  h.render();
  h.flushEffects();
  assert.equal(h.timers.size, 0);
  assert.equal(h.state.calls.length, 1);
});

test("real React SSR stays usable without browser globals or App Bridge token access", () => {
  const helper = loadModule("app/utils/background-json.ts", {
    react: React,
    "@shopify/app-bridge-react": {
      useAppBridge: () =>
        new Proxy(
          {},
          {
            get() {
              assert.fail("App Bridge APIs must not be read during SSR");
            },
          },
        ),
    },
  });
  function Probe() {
    const state = helper.useBackgroundJson({
      path: "/api/report",
      isData: valid,
      errorMessage: "Unavailable",
    });
    return React.createElement(
      "div",
      null,
      state.loading ? "Loading" : "Ready",
    );
  }
  assert.equal(
    renderToStaticMarkup(React.createElement(Probe)),
    "<div>Loading</div>",
  );
});

test("transport rejection becomes a local error and retry succeeds", async () => {
  const h = harness({
    fetch: async () => {
      throw new TypeError("Failed to fetch: secret-test-token");
    },
  });
  h.flushEffects();
  h.fireTimers();
  await h.flush();
  assert.equal(h.state.current.error, "Report unavailable. Please retry.");
  assert.equal(h.state.current.loading, false);
  assert.equal(h.state.current.data, undefined);
  assert.doesNotMatch(JSON.stringify(h.state.current), /secret-test-token/);
  h.state.fetch = async () => json({ value: 2 });
  h.state.current.reload();
  h.render();
  assert.equal(h.state.current.loading, true);
  await h.flush();
  assert.equal(h.state.current.data.value, 2);
  assert.equal(h.state.current.error, null);
});

test("last successful data remains visible while refreshing and after failure", async () => {
  const h = harness();
  h.flushEffects();
  h.fireTimers();
  await h.flush();
  const response = deferred();
  h.state.fetch = () => response.promise;
  h.state.current.reload();
  h.render();
  assert.equal(h.state.current.loading, true);
  assert.equal(h.state.current.data.value, 1);
  response.reject(new Error("temporary outage"));
  await h.flush();
  assert.equal(h.state.current.data.value, 1);
  assert.equal(h.state.current.loading, false);
  assert.equal(h.state.current.error, "Report unavailable. Please retry.");
});

test("overlapping requests abort the old request and never overwrite the latest result", async () => {
  const old = deferred();
  const h = harness({ fetch: () => old.promise });
  h.flushEffects();
  h.fireTimers();
  await h.flush();
  const oldSignal = h.state.calls[0].init.signal;
  h.state.fetch = async () => json({ value: 2 });
  h.state.current.reload();
  await h.flush();
  assert.equal(oldSignal.aborted, true);
  assert.equal(h.state.current.data.value, 2);
  old.resolve(json({ value: 1 }));
  await h.flush();
  assert.equal(h.state.current.data.value, 2);
  assert.equal(h.state.current.error, null);
});

test("unmount cancels scheduled, token-pending, and network-pending work", async () => {
  const scheduled = harness();
  scheduled.flushEffects();
  scheduled.unmount();
  scheduled.fireTimers();
  assert.equal(scheduled.state.tokenCalls, 0);

  const token = deferred();
  const auth = harness({ token: () => token.promise });
  auth.flushEffects();
  auth.fireTimers();
  auth.unmount();
  token.resolve("late-test-token");
  await auth.flush();
  assert.equal(auth.state.calls.length, 0);
  assert.equal(auth.state.updatesAfterUnmount, 0);

  const response = deferred();
  const network = harness({ fetch: () => response.promise });
  network.flushEffects();
  network.fireTimers();
  await network.flush();
  network.unmount();
  assert.equal(network.state.calls[0].init.signal.aborted, true);
  response.resolve(json({ value: 8 }));
  await network.flush();
  assert.equal(network.state.updatesAfterUnmount, 0);
});

test("tenant/resource changes hide old data immediately and reload the new scope", async () => {
  const h = harness();
  h.flushEffects();
  h.fireTimers();
  await h.flush();
  assert.equal(h.state.current.data.value, 1);
  h.render({ scopeKey: "shop-b" });
  assert.equal(h.state.current.data, undefined);
  assert.equal(h.state.current.loading, true);
  h.flushEffects();
  h.state.fetch = async () => json({ value: 3 });
  h.fireTimers();
  await h.flush();
  assert.equal(h.state.current.data.value, 3);
  h.render({ path: "/api/report?period=year" });
  assert.equal(h.state.current.data, undefined);
  h.flushEffects();
  h.fireTimers();
  await h.flush();
  assert.equal(h.state.calls.at(-1).path, "/api/report?period=year");
});

test("Strict Mode effect cleanup can restart instead of leaving a permanent skeleton", async () => {
  const firstToken = deferred();
  const h = harness({ token: () => firstToken.promise });
  h.flushEffects();
  h.fireTimers();
  assert.equal(h.state.tokenCalls, 1);
  h.repeatEffects();
  h.state.token = async () => "new-test-token";
  h.fireTimers();
  firstToken.resolve("obsolete-test-token");
  await h.flush();
  assert.equal(h.state.calls.length, 1);
  assert.equal(
    h.state.calls[0].init.headers.Authorization,
    "Bearer new-test-token",
  );
  assert.equal(h.state.current.data.value, 1);
});

test("auth, HTTP, HTML, and malformed payload failures remain local hook state", async () => {
  for (const options of [
    {
      token: async () => {
        throw new Error("App Bridge unavailable");
      },
    },
    { fetch: async () => json({ error: "failed" }, 503) },
    { fetch: async () => new Response("log in") },
    { fetch: async () => json({ wrong: "shape" }) },
  ]) {
    const h = harness(options);
    h.flushEffects();
    h.fireTimers();
    await h.flush();
    assert.equal(h.state.current.loading, false);
    assert.equal(h.state.current.error, "Report unavailable. Please retry.");
    assert.equal(h.state.current.data, undefined);
  }
});

const polaris = {
  Card: ({ children }) => React.createElement("section", null, children),
  BlockStack: ({ children }) => React.createElement("div", null, children),
  InlineStack: ({ children }) => React.createElement("div", null, children),
  Text: ({ as = "span", children }) => React.createElement(as, null, children),
  Banner: ({ title, children }) =>
    React.createElement("aside", { role: "alert" }, title, children),
  Badge: ({ children }) => React.createElement("span", null, children),
  Button: ({ children, loading, accessibilityLabel }) =>
    React.createElement(
      "button",
      {
        disabled: loading,
        "aria-label": accessibilityLabel,
        "aria-busy": loading || undefined,
      },
      children,
    ),
};
function component(file, state) {
  let options;
  const module = loadModule(file, {
    react: {
      ...React,
      lazy:
        () =>
        ({ initialData }) =>
          React.createElement(
            "div",
            { "data-report": "last-success" },
            initialData.progress.currentRate,
          ),
    },
    "@shopify/polaris": polaris,
    "../utils/background-json": {
      useBackgroundJson: (next) => {
        options = next;
        return { reload() {}, ...state };
      },
    },
  });
  return { module, options: () => options };
}
const report = {
  progress: { currentRate: 2.75, currentSeries: [], previousSeries: [] },
  events: [],
};

test("dashboard renders local initial/retry errors and keeps the successful chart during refresh failure", () => {
  const file = "app/components/DashboardConversionPanel.tsx";
  const render = (state) => {
    const view = component(file, state);
    const html = renderToStaticMarkup(
      React.createElement(view.module.DashboardConversionPanel, {
        shop: "shop-a",
      }),
    );
    return { view, html };
  };
  assert.match(render({ loading: true }).html, /Loading Shopify Analytics/);
  const failed = render({ error: "Report unavailable", loading: true });
  assert.match(failed.html, /Conversion report couldn’t load/);
  assert.match(failed.html, /Retry conversion report/);
  assert.match(failed.html, /aria-busy="true"/);
  assert.equal(failed.view.options().scopeKey, "shop-a");
  assert.equal(
    failed.view.options().path,
    "/api/dashboard-conversion?period=month",
  );
  assert.equal(failed.view.options().isData(report), true);
  assert.equal(failed.view.options().isData({ error: "unavailable" }), false);
  const retained = render({
    data: report,
    error: "Report unavailable",
    loading: false,
  });
  assert.match(retained.html, /last loaded report is still shown/);
  assert.match(retained.html, /data-report="last-success"/);
  assert.match(retained.html, /2\.75/);
  assert.match(source(file), /class ConversionPanelBoundary extends Component/);
  assert.match(source(file), /<ConversionPanelBoundary>/);
  assert.doesNotMatch(source(file), /useFetcher/);
});

test("tracking status has compact local retry states and never reports unknown as not active", () => {
  const render = (state) => {
    const view = component(
      "app/components/StorefrontTrackingStatus.tsx",
      state,
    );
    const html = renderToStaticMarkup(
      React.createElement(view.module.StorefrontTrackingStatus),
    );
    return { view, html };
  };
  assert.match(render({ loading: true }).html, /Checking…/);
  const failed = render({
    error: "Tracking status unavailable",
    loading: false,
  });
  assert.match(failed.html, /Unavailable/);
  assert.match(failed.html, /Retry storefront tracking status/);
  assert.equal(failed.view.options().delayMs, 1000);
  assert.equal(failed.view.options().path, "/api/storefront-tracker-status");
  const trackerStatus = {
    status: "active",
    storefrontUrl: "https://shop-a.test",
    checkedAt: "2026-08-26T00:00:00Z",
    message: "Active",
  };
  assert.equal(failed.view.options().isData({ trackerStatus }), true);
  assert.equal(
    failed.view.options().isData({ trackerStatus: { status: "active" } }),
    false,
  );
  const retained = render({
    data: { trackerStatus },
    error: "Failed refresh",
    loading: false,
  });
  assert.match(retained.html, />Active</);
  assert.match(retained.html, /shop-a\.test/);
  assert.match(retained.html, /Showing last check/);
  const unknown = render({
    data: { trackerStatus: { ...trackerStatus, status: "unknown" } },
  });
  assert.match(unknown.html, /Not verified/);
  assert.doesNotMatch(unknown.html, /Not active/);
  assert.match(unknown.html, /Retry storefront tracking status/);
  const missing = render({
    data: { trackerStatus: { ...trackerStatus, status: "missing" } },
  });
  assert.match(missing.html, /Not active/);
  assert.doesNotMatch(missing.html, /<button/);
});
