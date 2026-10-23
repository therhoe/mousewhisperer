// Database-free embedded GET navigation regression checks.
// Run: node --test scripts/check-embedded-filter-params.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function compile(file, mocks = {}) {
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
      URLSearchParams,
      Buffer,
    },
  );
  return mod.exports;
}
const navigation = compile("app/utils/embedded-filter-params.ts");
const { embeddedContextForShop } = compile("app/utils/embedded-filter-context.server.ts");
const authenticatedContext = embeddedContextForShop("owner.myshopify.com");
const launch = new URLSearchParams({
  shop: "owner.myshopify.com",
  host: "encoded-admin-host",
  embedded: "1",
  locale: "de",
  id_token: "expired-token",
  hmac: "old-signature",
  timestamp: "123",
  session: "launch-session",
  unrelated: "discard",
  source: "old-source",
});

function assertContext(params, expected = launch) {
  for (const key of ["shop", "host", "embedded", "locale"]) {
    assert.equal(params.get(key), expected.get(key));
  }
  for (const key of ["id_token", "hmac", "timestamp", "session", "unrelated"]) {
    assert.equal(params.has(key), false);
  }
}

test("GET context is allowlisted and explicit empty report filters stay empty", () => {
  const params = navigation.embeddedFilterParams(launch, {
    audience: "all",
    source: "",
    medium: "",
    campaign: "",
  });
  assertContext(params);
  assert.equal(params.get("source"), "");
  assert.equal(params.get("audience"), "all");
  assert.equal(launch.get("source"), "old-source");
  assert.equal(launch.get("id_token"), "expired-token");
});

test("missing embedded context is not invented", () => {
  assert.equal(
    navigation.embeddedFilterParams(new URLSearchParams(), { source: "google" }).toString(),
    "source=google",
  );
});

test("authenticated parent context restores a query-free internal route and overrides URL tenant hints", () => {
  assert.equal(authenticatedContext.shop, "owner.myshopify.com");
  assert.equal(Buffer.from(authenticatedContext.host, "base64").toString(), "admin.shopify.com/store/owner");
  assert.equal(embeddedContextForShop("attacker.test"), null);
  assert.equal(embeddedContextForShop("owner.myshopify.com/path"), null);
  const parent = new URLSearchParams(authenticatedContext);
  const restored = navigation.embeddedFilterParams(new URLSearchParams(), { source: "google" }, authenticatedContext);
  assertContext(restored, parent);
  assert.equal(restored.get("source"), "google");
  const overridden = navigation.embeddedFilterParams(new URLSearchParams("shop=other.myshopify.com&host=other&embedded=0&id_token=old"), {}, authenticatedContext);
  assertContext(overridden, parent);
});

test("both actual A/B filter controls retain embedded recovery context without a stale token", () => {
  const submissions = [];
  const buttons = [];
  const selects = [];
  let currentParams = launch;
  let parentContext;
  const Container = ({ children }) => React.createElement("div", null, children);
  const Layout = Object.assign(Container, { Section: Container });
  const route = compile("app/routes/app.ab-tests.$id.tsx", {
    "@remix-run/react": {
      Link: Container,
      useLoaderData: () => ({
        test: { id: "test-one", name: "QA", status: "LIVE", goal: "CONVERSION", trafficSplit: 50, targetPageType: "PRODUCT" },
        stats: [],
        filters: { audience: "all", source: "facebook", medium: "paid", campaign: "sale" },
        filterQuery: "",
        sources: ["facebook"],
      }),
      useNavigation: () => ({ state: "idle" }),
      useSearchParams: () => [currentParams],
      useRouteLoaderData: (id) => {
        assert.equal(id, "routes/app");
        return { embeddedContext: parentContext };
      },
      useSubmit: () => (params, options) => submissions.push({ params, options }),
    },
    "@shopify/polaris": {
      Badge: Container,
      BlockStack: Container,
      Button: ({ children, onClick }) => {
        buttons.push({ label: children, onClick });
        return React.createElement("button", null, children);
      },
      Card: Container,
      InlineStack: Container,
      Layout,
      Page: Container,
      ProgressBar: () => null,
      Select: (props) => { selects.push(props); return null; },
      Text: Container,
      TextField: () => null,
    },
    "@shopify/app-bridge-react": { Modal: () => null, TitleBar: () => null },
    "../shopify.server": {},
    "../db.server": {},
    "../components/AbTestDetailReport": { AbTestDetailReport: () => null },
    "../utils/ab-tests.server": {},
    "../utils/ab-test-activity.server": {},
    "../utils/loader-cache.server": {},
    "../utils/ab-project-targeting": {},
    "../utils/i18n": { useI18n: () => ({ t: (value) => value }) },
    "../utils/embedded-filter-params": navigation,
  });
  for (const queryFree of [false, true]) {
    buttons.length = selects.length = submissions.length = 0;
    currentParams = queryFree ? new URLSearchParams() : launch;
    parentContext = queryFree ? authenticatedContext : undefined;
    renderToStaticMarkup(React.createElement(route.default));
    buttons.find((item) => item.label === "Apply filters").onClick();
    selects.find((item) => item.label === "Audience").onChange("active");
    assert.equal(submissions.length, 2);
    for (const { params, options } of submissions) {
      assertContext(params, queryFree ? new URLSearchParams(authenticatedContext) : launch);
      assert.equal(options.method, "get");
      assert.equal(params.get("source"), "facebook");
      assert.equal(params.get("medium"), "paid");
      assert.equal(params.get("campaign"), "sale");
    }
    assert.equal(submissions[0].params.get("audience"), "all");
    assert.equal(submissions[1].params.get("audience"), "active");
  }
});
