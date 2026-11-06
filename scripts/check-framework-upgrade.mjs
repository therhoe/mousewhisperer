// Guards for the framework upgrade (docs/superpowers/plans/2026-11-06-framework-upgrade.md).
// Read-only: reads source files and loads small modules with mocks; never
// connects to Shopify or a database.
// Run: node --test scripts/check-framework-upgrade.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const listFiles = (dir) =>
  readdirSync(new URL(`../${dir}`, import.meta.url), { recursive: true })
    .filter((name) => /\.(tsx?|mjs)$/.test(name))
    .map((name) => `${dir}/${name}`);
const routeFiles = listFiles("app/routes").filter((file) => /\.tsx?$/.test(file));
const isScreenRoute = (source) => /^export default/m.test(source);

// Transpiles one app file to CommonJS and runs it with the given module
// mocks; anything not mocked is required for real from node_modules.
function loadModule(file, mocks = {}) {
  const output = ts.transpileModule(read(file), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  const load = (id) => (id in mocks ? mocks[id] : require(id));
  new Function("module", "exports", "require", output)(mod, mod.exports, load);
  return mod.exports;
}

test("every route that calls authenticate.admin exports Shopify's boundary headers", () => {
  // Resource routes too: fetcher.load/submit reach them as single-fetch .data
  // requests, where a route without `headers` drops the thrown 401's
  // re-auth headers (X-Shopify-Retry-Invalid-Session-Request) and App Bridge
  // can't retry. Direct requests ignore the export, so it is always safe.
  const missing = routeFiles.filter((file) => {
    const source = read(file);
    if (!source.includes("authenticate.admin")) return false;
    return !/export const headers\b[\s\S]{0,160}?boundary\.headers\(/.test(source);
  });
  assert.deepEqual(missing, []);
});

test("no app file or check script uses Remix or Shopify's Remix package", () => {
  const offenders = [...listFiles("app"), ...listFiles("scripts")]
    .filter((file) => file !== "scripts/check-framework-upgrade.mjs")
    .filter((file) => /@remix-run\/|@shopify\/shopify-app-remix/.test(read(file)));
  assert.deepEqual(offenders, []);
});

test("package.json pins React Router 7.18.5 and Shopify's React Router package", () => {
  const pkg = JSON.parse(read("package.json"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const leftovers = Object.keys(deps).filter(
    (name) => name.startsWith("@remix-run/") || name === "@shopify/shopify-app-remix" || name === "@vercel/remix",
  );
  assert.deepEqual(leftovers, []);
  for (const name of ["react-router", "@react-router/node", "@react-router/serve", "@react-router/fs-routes", "@react-router/dev"]) {
    assert.equal(deps[name], "7.18.5", name);
  }
  assert.equal(deps["@shopify/shopify-app-react-router"], "4.0.1");
  assert.equal(deps["@shopify/app-bridge-react"], "4.2.15");
  assert.equal(pkg.engines.node, ">=22.12");
});

test("the preview harnesses only import packages installed at the top level", () => {
  // Remix used to bring esbuild and react-router-dom in as transitive
  // packages; the harnesses (and check-customer-journey-ui) need them direct.
  const packageName = (specifier) =>
    specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
  const missing = listFiles("scripts")
    .filter((file) => /^scripts\/preview-[^/]+\.mjs$/.test(file))
    .flatMap((file) =>
      [...read(file).matchAll(/(?:from|import)\s+['"]([^'"./][^'"]*)['"]/g)]
        .map((match) => match[1])
        .filter((specifier) => !specifier.startsWith("node:"))
        .map(packageName)
        .filter((name) => {
          try {
            readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url));
            return false;
          } catch {
            return true;
          }
        })
        .map((name) => `${file}: ${name}`),
    );
  assert.deepEqual([...new Set(missing)], []);
});

test("the preview harnesses keep route hooks and strip only server code from route files", () => {
  // Hooks like useLoaderData now come from "react-router" (they used to come
  // from @remix-run/react), so dropping that import breaks every route page.
  const strippers = listFiles("scripts")
    .filter((file) => /^scripts\/preview-[^/]+\.mjs$/.test(file))
    .filter((file) => /\["loader", "action"/.test(read(file)));
  assert.deepEqual(strippers, ["scripts/preview-customer-journeys.mjs", "scripts/preview-snapshot-changes.mjs"]);
  for (const file of strippers) {
    const source = read(file);
    assert.doesNotMatch(source, /(?:specifier|moduleSpecifier\.text) === "react-router"/, file);
    assert.match(source, /"@shopify\/shopify-app-react-router\/server"/, file);
    assert.match(source, /\["loader", "action", "headers"\]/, file);
  }
});

test("routes and React Router config are set up", () => {
  assert.match(read("app/routes.ts"), /from "@react-router\/fs-routes"/);
  assert.match(read("react-router.config.ts"), /ssr: true/);
});

test("the app's own host is an allowed action origin, so a TLS-ending proxy can't trip React Router's CSRF check", () => {
  // The Shopify CLI tunnel ends TLS before the dev server: the browser sends
  // Origin https://<host> while React Router sees http://<host>.
  const previous = process.env.SHOPIFY_APP_URL;
  process.env.SHOPIFY_APP_URL = "https://example-tunnel.trycloudflare.com";
  try {
    const config = loadModule("react-router.config.ts").default;
    assert.deepEqual(config.allowedActionOrigins, ["example-tunnel.trycloudflare.com"]);
  } finally {
    if (previous === undefined) delete process.env.SHOPIFY_APP_URL;
    else process.env.SHOPIFY_APP_URL = previous;
  }
});

test("json() keeps Remix's JSON data shape and still sets status and headers", () => {
  const { json } = loadModule("app/utils/route-data.ts");
  const result = json(
    { at: new Date("2026-11-06T10:00:00.000Z"), skipped: undefined, count: 2 },
    { status: 201, headers: { "X-Test": "1" } },
  );
  assert.deepEqual(result.data, { at: "2026-11-06T10:00:00.000Z", count: 2 });
  assert.equal(result.init.status, 201);
  assert.equal(new Headers(result.init.headers).get("X-Test"), "1");
  assert.equal(json({ ok: false }, 404).init.status, 404);
  assert.equal(json(undefined).data, null);
});

test("API and webhook routes answer with real JSON responses, never the removed json()", () => {
  const offenders = routeFiles.filter((file) => {
    const source = read(file);
    return !/^export default/m.test(source) && /(^|[^.\w$])json\(/m.test(source);
  });
  assert.deepEqual(offenders, []);
});

test("Polaris React links stay inside the app and keep external targets", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { MemoryRouter } = require("react-router");
  const { PolarisLink } = loadModule("app/components/PolarisLink.tsx");
  const render = (props) =>
    renderToStaticMarkup(
      React.createElement(MemoryRouter, null, React.createElement(PolarisLink, props, "Link")),
    );
  const internal = render({ url: "/app/projects" });
  assert.match(internal, /href="\/app\/projects"/);
  assert.doesNotMatch(internal, /\burl=/);
  // With a custom linkComponent, Polaris passes `external` through untouched
  // (UnstyledLink only adds target/rel when it renders its own <a>).
  const external = render({ url: "https://help.shopify.com", external: true });
  assert.match(external, /href="https:\/\/help\.shopify\.com"/);
  assert.match(external, /target="_blank"/);
  assert.match(external, /rel="noopener noreferrer"/);
  assert.doesNotMatch(external, /\bexternal=/);
});

test("the app frame loads Polaris 2 and keeps Polaris React translations per language", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const seen = {};
  const capture = (name) => (props) => {
    seen[name] = props;
    return React.createElement(React.Fragment, null, props.children);
  };
  const PolarisLinkMock = () => null;
  const mod = loadModule("app/routes/app.tsx", {
    "react-router": {
      Link: (props) => React.createElement("a", { href: props.to }, props.children),
      Outlet: () => React.createElement("main", null, "outlet"),
      useLoaderData: () => ({ apiKey: "test-key", locale: "de", shop: "owner.myshopify.com" }),
      useLocation: () => ({ pathname: "/app" }),
      useNavigation: () => ({ state: "idle" }),
      useRouteError: () => null,
    },
    "@shopify/shopify-app-react-router/server": { boundary: { error: () => null, headers: () => new Headers() } },
    "@shopify/shopify-app-react-router/react": { AppProvider: capture("shopify") },
    "@shopify/polaris": { AppProvider: capture("polaris") },
    "@shopify/app-bridge-react": { NavMenu: (props) => React.createElement("nav", null, props.children) },
    "@shopify/polaris/build/esm/styles.css?url": { __esModule: true, default: "/polaris.css" },
    "../shopify.server": { authenticate: {} },
    "../utils/embedded-filter-context.server": { embeddedContextForShop: () => ({}) },
    "../components/BackgroundBillingSync": { BackgroundBillingSync: () => null },
    "../components/PolarisLink": { PolarisLink: PolarisLinkMock },
    "../utils/features": { COMMUNITY_FEATURES_ENABLED: false },
    "../utils/i18n": { I18nProvider: (props) => props.children, useI18n: () => ({ locale: "de", t: (text) => text }) },
    "../utils/i18n.server": { resolveRequestLocale: async () => "de" },
    "../utils/page-snapshot-navigation": { isPageSnapshotsPath: () => false, PAGE_SNAPSHOTS_PATH: "/app/page-snapshots" },
    "../utils/polaris": { POLARIS_URL: "https://cdn.shopify.com/shopifycloud/polaris-2.js" },
  });
  renderToStaticMarkup(React.createElement(mod.default));
  assert.equal(seen.shopify.apiKey, "test-key");
  assert.equal(seen.shopify.polarisUrl, "https://cdn.shopify.com/shopifycloud/polaris-2.js");
  assert.equal(seen.polaris.i18n, require("@shopify/polaris/locales/de.json"));
  assert.equal(seen.polaris.linkComponent, PolarisLinkMock);
});

test("Vercel's React Router preset builds the app", () => {
  assert.match(read("react-router.config.ts"), /presets:\s*\[\s*vercelPreset\(\)\s*\]/);
  const vercel = JSON.parse(read("vercel.json"));
  assert.equal(vercel.framework, "react-router");
  assert.deepEqual(vercel.regions, ["fra1"]);
  assert.equal(vercel.outputDirectory, undefined);
});

test("document responses get Shopify's headers before Vercel renders them", async () => {
  const calls = [];
  const mod = loadModule("app/entry.server.tsx", {
    "@vercel/react-router/entry.server": {
      handleRequest: async (...args) => {
        calls.push(["vercel", ...args]);
        return new Response("ok");
      },
    },
    "./shopify.server": {
      addDocumentResponseHeaders: (request, headers) => {
        calls.push(["shopify", request, headers]);
        headers.set("X-Shopify-Test", "1");
      },
    },
  });
  const request = new Request("https://app.test/app");
  const headers = new Headers();
  const context = { marker: true };
  const loadContext = { load: true };
  const response = await mod.default(request, 200, headers, context, loadContext);
  assert.equal(await response.text(), "ok");
  assert.deepEqual(calls.map((call) => call[0]), ["shopify", "vercel"]);
  const [, vRequest, vStatus, vHeaders, vContext, vLoad] = calls[1];
  assert.equal(vRequest, request);
  assert.equal(vStatus, 200);
  assert.equal(vHeaders.get("X-Shopify-Test"), "1");
  assert.equal(vContext, context);
  assert.equal(vLoad, loadContext);
  assert.equal(mod.streamTimeout, 5000);
});

test("React and React DOM are the same 19.x version", () => {
  const deps = JSON.parse(read("package.json")).dependencies;
  assert.match(deps.react, /^19\.\d+\.\d+$/);
  assert.equal(deps["react-dom"], deps.react);
});

test("Polaris React still server-renders a page under the installed React", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { AppProvider, Page, Card, Badge, Button, Text } = require("@shopify/polaris");
  const html = renderToStaticMarkup(
    React.createElement(
      AppProvider,
      { i18n: require("@shopify/polaris/locales/en.json") },
      React.createElement(
        Page,
        { title: "Projects", primaryAction: { content: "Create project" } },
        React.createElement(
          Card,
          null,
          React.createElement(Text, { as: "p" }, "Spring collection"),
          React.createElement(Badge, { tone: "success" }, "Completed"),
          React.createElement(Button, null, "View results"),
        ),
      ),
    ),
  );
  assert.match(html, /Projects/);
  assert.match(html, /Completed/);
});

test("Polaris web component elements type-check in TSX", () => {
  const run = spawnSync("npx", ["tsc", "--noEmit", "-p", "scripts/fixtures/tsconfig.polaris.json"], {
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
