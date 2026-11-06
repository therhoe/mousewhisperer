# Framework Upgrade (Plan 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Snapshot from Remix v2 to React Router 7 and Shopify's React Router package, onto Vercel's React Router preset and (if the spike passes) React 19, with Polaris web components 2.0 loaded and typed. The merchant sees no change.

**Architecture:**
- Follow the official order: turn on single fetch while still on Remix, then run the Remix → React Router codemod and swap the Shopify, Vercel and React packages.
- Polaris React keeps rendering every screen. It sits inside Shopify's new AppProvider, which also loads App Bridge and `polaris-2.js` for the screen rewrites in plan 2.
- Remix's removed `json()` is replaced in two ways:
  - API and webhook routes return `Response.json()`, so their HTTP responses stay identical.
  - Screen routes use a small `json()` helper that keeps today's JSON data shape and returns React Router's `data()`.

**Tech Stack:**

| Package | Version |
|---|---|
| React Router (`react-router`, `@react-router/*`) | 7.18.5 |
| `@shopify/shopify-app-react-router` | 4.0.1 |
| `@shopify/app-bridge-react` | 4.2.15 |
| `@shopify/shopify-app-session-storage-prisma` | 11.0.2 |
| `@vercel/react-router` | 1.3.7 |
| React | 19.2 (Task 5, gated) |
| `@shopify/polaris` | 12.27.0 (unchanged) |
| `@shopify/polaris-types` | 2.0.0 |

Unchanged: Vite 6, Prisma 6.19, Node 22.

**Spec:** `docs/superpowers/specs/2026-11-06-polaris-ui-redesign-design.md`, section 9, steps 1–5. Plans 2 (screens) and 3 (number changes) come later.

## Global Constraints

- **No visible change.** Every screen looks and behaves as before this plan. Polaris React stays on every screen.
- **Exact versions** (always `--save-exact`):

  | Package | Version |
  |---|---|
  | `react-router`, `@react-router/node`, `@react-router/serve`, `@react-router/fs-routes`, `@react-router/dev` | `7.18.5` |
  | `@shopify/shopify-app-react-router` | `4.0.1` |
  | `@shopify/app-bridge-react` | `4.2.15` |
  | `@shopify/shopify-app-session-storage-prisma` | `11.0.2` |
  | `@vercel/react-router` | `1.3.7` |
  | `@shopify/polaris-types` | `2.0.0` (fallback `1.0.1`, see Task 6) |

- **Do not use React Router 8.x.** Shopify's and Vercel's packages require 7.
- **Node:** `package.json` `engines.node` is `">=22.12"`. The Dockerfile uses `node:22-alpine`.
- **Polaris script URL:** `https://cdn.shopify.com/shopifycloud/polaris-2.js`, defined once in `app/utils/polaris.ts`.
- **The local `.env` points at the PRODUCTION database.**
  - Never run `shopify app dev`, `npm run dev`, `npm run setup`, `prisma migrate`, `prisma db push` or a database-backed check without first exporting BOTH `DATABASE_URL` and `DIRECT_URL` to a loopback Postgres (Appendix A).
  - `shopify.web.toml`'s dev command runs `prisma migrate deploy`.
  - `scripts/run-checks.mjs` forces an unreachable database for every check.
- **Deploys:** no Vercel deploy of any kind (preview or production) without the user's explicit OK in chat. Never promote.
- **Git:**
  - Work on branch `polaris-ui-redesign`, one commit per task, and never push.
  - Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The commands below pass it as a second `-m`.
- **Regression bar:** `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-framework-upgrade-baseline.txt` exits 0 at the end of every task. `npm run build` succeeds at the end of every task.

## Review Focus

1. **Expired session during in-app navigation.**
   - Condition: a screen's data request (not a full page load) hits an expired session after single fetch is on.
   - Expected: the app re-authenticates through App Bridge instead of showing a blank screen or a raw 401.
   - Pinned by Task 2's "boundary headers on every screen route" test.
2. **Dates in loader data.**
   - Condition: screens read dates from loader data as ISO strings, because today's `json()` stringifies them.
   - Expected: they still get strings, not `Date` objects.
   - Pinned by Task 3's `json()` helper test.
3. **Language switch.**
   - Condition: the merchant switches to German or Chinese.
   - Expected: Polaris React's own strings (pagination, date pickers, modal close labels) follow the switch.
   - Pinned by Task 3's AppProvider test.
4. **Polaris `url` links.**
   - Condition: a Polaris React `url` link inside the embedded app, such as Button `url` or ResourceItem `url`.
   - Expected: it navigates in-app without reloading. External links still open a new tab.
   - Pinned by Task 3's PolarisLink test.
5. **Polaris React under React 19.**
   - Condition: Polaris React components (popovers, modals, toasts) run under React 19.
   - Expected: they open and close without errors.
   - Pinned by Task 5's server-render test plus the overlay steps in the Appendix A smoke test.

---

### Task 1: Branch, install, and record the baseline

**Files:**
- Create: `scripts/run-checks.mjs`
- Create: `docs/superpowers/plans/2026-11-06-framework-upgrade-baseline.txt` (generated)
- Create: `.smoke/baseline.md` (not committed)
- Modify: `.gitignore`

**Interfaces:**
- Produces: `node scripts/run-checks.mjs [--write <file>] [--compare <file>]`. It prints `PASS <file>` / `FAIL <file>` per check. With `--compare`, it exits 1 if any check that passed in the baseline now fails. Every later task uses it.

- [ ] **Step 1: Create the branch and commit the spec and this plan**

```bash
git switch -c polaris-ui-redesign
git add docs/superpowers/specs/2026-11-06-polaris-ui-redesign-design.md docs/superpowers/plans/2026-11-06-framework-upgrade.md
git commit -m "Add the UI redesign spec and the framework upgrade plan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Install exactly what the lockfile says**

Run `npm ci`. Expected: it finishes, and the postinstall `prisma generate` succeeds. Generating doesn't touch any database.

- [ ] **Step 3: Write the check runner**

Create `scripts/run-checks.mjs`:

```js
// Runs every node --test check script with an unreachable database, so no
// check can ever touch the production database from the local .env.
// Usage: node scripts/run-checks.mjs [--write <file>] [--compare <file>]
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const UNREACHABLE = "postgresql://none:none@127.0.0.1:1/none";
const env = { ...process.env, DATABASE_URL: UNREACHABLE, DIRECT_URL: UNREACHABLE };
delete env.GROWTH_TEST_DATABASE_URL;
delete env.JOURNEY_TEST_DATABASE_URL;

const files = readdirSync("scripts")
  .filter((name) => /^check-.*\.mjs$/.test(name) || /\.test\.mjs$/.test(name))
  .sort();
const results = files.map((name) => {
  const run = spawnSync(process.execPath, ["--test", `scripts/${name}`], {
    env,
    encoding: "utf8",
    timeout: 180_000,
  });
  return [name, run.status === 0 ? "PASS" : "FAIL"];
});
const text = `${results.map(([name, status]) => `${status} ${name}`).join("\n")}\n`;
process.stdout.write(text);

const writeTo = option("--write");
if (writeTo) writeFileSync(writeTo, text);

const compareTo = option("--compare");
if (compareTo) {
  const before = new Map(
    readFileSync(compareTo, "utf8")
      .split("\n")
      .filter((line) => /^(PASS|FAIL) /.test(line))
      .map((line) => {
        const [status, name] = line.split(" ");
        return [name, status];
      }),
  );
  const regressions = results
    .filter(([name, status]) => before.get(name) === "PASS" && status !== "PASS")
    .map(([name]) => name);
  if (regressions.length) {
    console.error(`Regressions against ${compareTo}: ${regressions.join(", ")}`);
    process.exit(1);
  }
  console.log(`No regressions against ${compareTo}`);
}
```

- [ ] **Step 4: Record the baseline**

```bash
node scripts/run-checks.mjs --write docs/superpowers/plans/2026-11-06-framework-upgrade-baseline.txt
npm run build && echo "build ok" >> docs/superpowers/plans/2026-11-06-framework-upgrade-baseline.txt
echo "tsc-errors $(npx tsc --noEmit 2>&1 | grep -c 'error TS')" >> docs/superpowers/plans/2026-11-06-framework-upgrade-baseline.txt
echo "eslint-errors $(npx eslint app --format compact 2>/dev/null | grep -c ' Error - ')" >> docs/superpowers/plans/2026-11-06-framework-upgrade-baseline.txt
```

Expected: the build succeeds and the file lists every check. The four database-backed checks fail here because the database is unreachable on purpose: `check-growth-report-sections`, `check-growth-reports`, `check-growth-projects-db` and `check-customer-journeys`. The TypeScript and ESLint error counts are recorded; the project already has TypeScript errors.

- [ ] **Step 5: Ignore smoke-test notes**

Append `.smoke/` to `.gitignore`.

- [ ] **Step 6: Record the screens as they look today**

Run the Appendix A smoke test. For each step, write one line into `.smoke/baseline.md`: the header text, the section headings in order, the primary button, and anything unusual. Later tasks compare against this file. Start the smoke test only when the user is available; they may need to sign in to the dev store in the browser pane.

- [ ] **Step 7: Commit**

```bash
git add scripts/run-checks.mjs docs/superpowers/plans/2026-11-06-framework-upgrade-baseline.txt .gitignore
git commit -m "Add a safe check runner and record the pre-upgrade baseline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Turn on single fetch while still on Remix

**Files:**
- Create: `scripts/check-framework-upgrade.mjs`
- Create: `app/types/single-fetch.d.ts` (Task 3 deletes it)
- Modify: `vite.config.ts`
- Modify: these 18 route files, each gaining a `headers` export:
  - `app/routes/app._index.tsx`
  - `app/routes/app.audits.$category.tsx`
  - `app/routes/app.upgrade.tsx`
  - `app/routes/app.challenges.$id.tsx`
  - `app/routes/app.ab-tests._index.tsx`
  - `app/routes/app.channel-snapshots._index.tsx`
  - `app/routes/app.challenges.profile.tsx`
  - `app/routes/app.customer-snapshots._index.tsx`
  - `app/routes/app.store-snapshots.$id.tsx`
  - `app/routes/app.projects.$id.tsx`
  - `app/routes/app.projects._index.tsx`
  - `app/routes/app.ab-tests.$id.tsx`
  - `app/routes/app.channel-snapshots.$id.tsx`
  - `app/routes/app.store-snapshots._index.tsx`
  - `app/routes/app.customer-snapshots.$id.tsx`
  - `app/routes/app.challenges.new.tsx`
  - `app/routes/app.challenges._index.tsx`
  - `app/routes/app.project.$id.tsx`

**Interfaces:**
- Produces: `scripts/check-framework-upgrade.mjs`, which later tasks extend with more tests, along with its `read(file)` and `routeFiles` helpers.
- Produces: every screen route that calls `authenticate.admin` exports `headers = (headersArgs) => boundary.headers(headersArgs)`.

- [ ] **Step 1: Write the failing test**

Create `scripts/check-framework-upgrade.mjs`:

```js
// Guards for the framework upgrade (docs/superpowers/plans/2026-11-06-framework-upgrade.md).
// Read-only: reads source files and loads small modules with mocks; never
// connects to Shopify or a database.
// Run: node --test scripts/check-framework-upgrade.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const listFiles = (dir) =>
  readdirSync(new URL(`../${dir}`, import.meta.url), { recursive: true })
    .filter((name) => /\.(tsx?|mjs)$/.test(name))
    .map((name) => `${dir}/${name}`);
const routeFiles = listFiles("app/routes").filter((file) => /\.tsx?$/.test(file));
const isScreenRoute = (source) => /^export default/m.test(source);

test("every screen route that calls authenticate.admin exports Shopify's boundary headers", () => {
  const missing = routeFiles.filter((file) => {
    const source = read(file);
    if (!isScreenRoute(source) || !source.includes("authenticate.admin")) return false;
    return !/export const headers\b[\s\S]{0,160}?boundary\.headers\(/.test(source);
  });
  assert.deepEqual(missing, []);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test scripts/check-framework-upgrade.mjs`
Expected: FAIL. The assertion lists the 18 route files above.

- [ ] **Step 3: Add the headers export to the 18 routes**

```bash
node --input-type=module - <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
const files = [
  "app/routes/app._index.tsx", "app/routes/app.audits.$category.tsx", "app/routes/app.upgrade.tsx",
  "app/routes/app.challenges.$id.tsx", "app/routes/app.ab-tests._index.tsx",
  "app/routes/app.channel-snapshots._index.tsx", "app/routes/app.challenges.profile.tsx",
  "app/routes/app.customer-snapshots._index.tsx", "app/routes/app.store-snapshots.$id.tsx",
  "app/routes/app.projects.$id.tsx", "app/routes/app.projects._index.tsx", "app/routes/app.ab-tests.$id.tsx",
  "app/routes/app.channel-snapshots.$id.tsx", "app/routes/app.store-snapshots._index.tsx",
  "app/routes/app.customer-snapshots.$id.tsx", "app/routes/app.challenges.new.tsx",
  "app/routes/app.challenges._index.tsx", "app/routes/app.project.$id.tsx",
];
for (const file of files) {
  let source = readFileSync(file, "utf8");
  if (/export const headers\b/.test(source)) continue;
  source =
    'import type { HeadersFunction } from "@remix-run/node";\n' +
    'import { boundary } from "@shopify/shopify-app-remix/server";\n' +
    source.replace(/\s*$/, "\n") +
    "\n// Single fetch applies route headers to data requests too; Shopify needs\n" +
    "// them so App Bridge can re-authenticate an expired session.\n" +
    "export const headers: HeadersFunction = (headersArgs) =>\n" +
    "  boundary.headers(headersArgs);\n";
  writeFileSync(file, source);
  console.log("headers added:", file);
}
JS
```

- [ ] **Step 4: Turn the flag on and drop `installGlobals`**

In `vite.config.ts`:
- Delete the line `import { installGlobals } from "@remix-run/node";`.
- Delete the line `installGlobals({ nativeFetch: true });`.
- Change `v3_singleFetch: false,` to `v3_singleFetch: true,`.

Node 22 has native `fetch`, and the single-fetch guide says `installGlobals` must go.

- [ ] **Step 5: Add the single-fetch typings**

Create `app/types/single-fetch.d.ts`:

```ts
// Remix v2 single-fetch typings. Deleted when the app moves to React Router 7.
import "@remix-run/server-runtime";

declare module "@remix-run/server-runtime" {
  interface Future {
    v3_singleFetch: true;
  }
}
```

- [ ] **Step 6: Run the tests and the regression bar**

```bash
node --test scripts/check-framework-upgrade.mjs
npm run build
node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-framework-upgrade-baseline.txt
```

Expected: the guard test passes, the build succeeds, and the runner prints "No regressions".

- [ ] **Step 7: Smoke test**

Run Appendix A and record the results in `.smoke/task-2.md`.

Single fetch changes how screen data travels: requests end in `.data` instead of `?_data=`. Pay attention to these steps:
- **Step 4:** the results sheet's filters.
- **Step 7:** Upgrade. If the plan page doesn't open, read https://community.shopify.dev/t/22575 ("Cannot use v3_singleFetch: true flag and billing remix function") before changing anything.
- **Step 2:** the language switch.

Every step must match `.smoke/baseline.md`.

- [ ] **Step 8: Commit**

```bash
git add -A app/routes app/types vite.config.ts scripts/check-framework-upgrade.mjs
git commit -m "Turn on single fetch and give every screen route Shopify's boundary headers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Move to React Router 7 and Shopify's React Router package

**Files:**
- Create:
  - `react-router.config.ts`
  - `app/utils/route-data.ts`
  - `app/utils/polaris.ts`
  - `app/components/PolarisLink.tsx`
- Delete: `app/types/single-fetch.d.ts`
- Modify (full contents given below):
  - `vite.config.ts`
  - `app/routes.ts`
  - `app/entry.server.tsx`
  - `tsconfig.json`
  - `env.d.ts`
  - `.eslintrc.cjs`
- Modify (edits given below):
  - `app/routes/app.tsx`
  - `app/shopify.server.ts`
  - `package.json`
  - `shopify.web.toml`
  - `Dockerfile`
  - `.gitignore`
- Modify (scripted import rewrites): every file under `app/` that imports `@remix-run/*` or `@shopify/shopify-app-remix`. That is 62 Remix importers, including the 17 screen modules and 12 resource routes that call `json()`.
- Modify (test mocks): every `scripts/check-*.mjs` and `scripts/preview-*.mjs` that mocks `@remix-run/*`.
- Test: `scripts/check-framework-upgrade.mjs`

**Interfaces:**
- Consumes: Task 2's `read`, `listFiles` and `routeFiles` helpers in `scripts/check-framework-upgrade.mjs`.
- Produces:
  - `json<T>(body: T, init?: number | ResponseInit)` from `app/utils/route-data.ts`. It returns React Router's `DataWithResponseInit` (`.data`, `.init`), with `.data` round-tripped through JSON.
  - `PolarisLink` from `app/components/PolarisLink.tsx`.
  - `POLARIS_URL` from `app/utils/polaris.ts`.
  - A `loadModule(file, mocks)` helper inside `scripts/check-framework-upgrade.mjs`. Tasks 4 and 5 reuse it.

- [ ] **Step 1: Write the failing tests**

Add the module loader and these tests to `scripts/check-framework-upgrade.mjs`. Put the new imports at the top, next to the existing ones.

```js
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

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

test("routes and React Router config are set up", () => {
  assert.match(read("app/routes.ts"), /from "@react-router\/fs-routes"/);
  assert.match(read("react-router.config.ts"), /ssr: true/);
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
  const external = render({
    url: "https://help.shopify.com",
    external: true,
    target: "_blank",
    rel: "noopener noreferrer",
  });
  assert.match(external, /href="https:\/\/help\.shopify\.com"/);
  assert.match(external, /target="_blank"/);
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
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test scripts/check-framework-upgrade.mjs`
Expected: the Task 2 test passes and the seven new tests FAIL. Remix imports are still present, `react-router.config.ts` doesn't exist, and so on.

- [ ] **Step 3: Run the official codemod**

Run `npx codemod remix/2/react-router/upgrade` and accept its defaults. It rewrites package names, imports, scripts, the Vite plugin and the entry files. It does NOT rewrite `json()` calls (Step 8 does that). Review `git diff --stat` afterwards. The next steps overwrite the config files it touched with exact contents, so its version of those files doesn't matter.

- [ ] **Step 4: Swap the packages to the pinned versions**

```bash
npm uninstall @remix-run/dev @remix-run/fs-routes @remix-run/node @remix-run/react @remix-run/serve @remix-run/route-config @remix-run/eslint-config @shopify/shopify-app-remix @vercel/remix
npm install --save-exact react-router@7.18.5 @react-router/node@7.18.5 @react-router/serve@7.18.5 @react-router/fs-routes@7.18.5 @shopify/shopify-app-react-router@4.0.1 @shopify/app-bridge-react@4.2.15 @shopify/shopify-app-session-storage-prisma@11.0.2
npm install --save-dev --save-exact @react-router/dev@7.18.5
npm pkg set scripts.build="prisma generate && react-router build" scripts.start="react-router-serve ./build/server/index.js" scripts.typecheck="react-router typegen && tsc --noEmit" engines.node=">=22.12"
```

The `Session` table already has `refreshToken` and `refreshTokenExpires`, so session storage 11 needs no migration. Confirm with `npx prisma validate`. Expected: "The schema … is valid".

- [ ] **Step 5: Write the build and entry files**

`react-router.config.ts`:

```ts
import type { Config } from "@react-router/dev/config";

export default { ssr: true } satisfies Config;
```

`vite.config.ts`. The `HOST` workaround and HMR settings are unchanged; only the plugin and imports change.

```ts
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the dev
// server. The CLI will eventually stop passing in HOST.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    allowedHosts: [host],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      allow: ["app", "node_modules"],
    },
  },
  plugins: [reactRouter(), tsconfigPaths()],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react", "@shopify/polaris"],
  },
}) satisfies UserConfig;
```

`app/routes.ts`:

```ts
import type { RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";

export default flatRoutes({ ignoredRouteFiles: ["**/.*"] }) satisfies RouteConfig;
```

`app/entry.server.tsx`. Task 4 replaces this with Vercel's handler.

```tsx
import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 5000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      },
    );
    // Give React time to flush the rejected boundary contents.
    setTimeout(abort, streamTimeout + 1000);
  });
}
```

`env.d.ts`:

```ts
/// <reference types="vite/client" />
```

`tsconfig.json`:

```json
{
  "include": ["env.d.ts", "**/*.ts", "**/*.tsx", ".react-router/types/**/*"],
  "compilerOptions": {
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "allowSyntheticDefaultImports": true,
    "removeComments": false,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "allowJs": true,
    "resolveJsonModule": true,
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "baseUrl": ".",
    "types": ["node", "@react-router/node", "vite/client"],
    "rootDirs": [".", "./.react-router/types"]
  }
}
```

Then:
- `git rm app/types/single-fetch.d.ts`
- Append `.react-router/` to `.gitignore`.
- In `shopify.web.toml`, set `dev = "sh scripts/prisma-migrate-deploy.sh && npm exec react-router dev"`.
- In `Dockerfile`, change `FROM node:18-alpine` to `FROM node:22-alpine`.

- [ ] **Step 6: Add the JSON helper**

Create `app/utils/route-data.ts`:

```ts
import { data } from "react-router";

type Jsonify<T> = T extends { toJSON(): infer R }
  ? R
  : T extends bigint | symbol | ((...args: never[]) => unknown)
    ? never
    : T extends readonly (infer U)[]
      ? Jsonify<U>[]
      : T extends object
        ? { [K in keyof T]: Jsonify<T[K]> }
        : T;

/**
 * Remix-style json() for screen route loaders and actions on React Router 7.
 * The body goes through JSON first, so screens receive exactly what Remix's
 * json() sent (dates as ISO strings, undefined fields dropped); then it is
 * wrapped in React Router's data() so status and headers still apply.
 * API and webhook routes return Response.json() instead. New code should
 * return plain objects or data() directly.
 */
export function json<T>(body: T, init?: number | ResponseInit) {
  const parsed = JSON.parse(JSON.stringify(body) ?? "null") as Jsonify<T>;
  return data(parsed, init);
}
```

- [ ] **Step 7: Add the Polaris link and the Polaris URL**

Create `app/utils/polaris.ts`:

```ts
/** Polaris web components 2.x, the admin's new look. AppProvider loads it. */
export const POLARIS_URL = "https://cdn.shopify.com/shopifycloud/polaris-2.js";
```

Create `app/components/PolarisLink.tsx`:

```tsx
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";

type PolarisLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  url: string;
  external?: boolean;
  children?: ReactNode;
};

/**
 * The link Polaris React renders for every `url`, so in-app links navigate
 * with React Router instead of reloading the embedded app. Polaris already
 * passes target and rel for external links; `external` itself is dropped so
 * it never reaches the DOM.
 */
export const PolarisLink = forwardRef<HTMLAnchorElement, PolarisLinkProps>(
  function PolarisLink({ url, external: _external, children, ...rest }, ref) {
    return (
      <Link {...rest} to={url} ref={ref}>
        {children}
      </Link>
    );
  },
);
```

- [ ] **Step 8: Replace every `json()` call**

```bash
node --input-type=module - <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
const screens = [
  "app/components/LegacySnapshotDashboard.tsx", "app/routes/app._index.tsx", "app/routes/app.ab-tests.$id.tsx",
  "app/routes/app.ab-tests._index.tsx", "app/routes/app.audits.$category.tsx", "app/routes/app.challenges.$id.tsx",
  "app/routes/app.challenges._index.tsx", "app/routes/app.challenges.new.tsx", "app/routes/app.challenges.profile.tsx",
  "app/routes/app.channel-snapshots.$id.tsx", "app/routes/app.channel-snapshots._index.tsx",
  "app/routes/app.customer-snapshots.$id.tsx", "app/routes/app.customer-snapshots._index.tsx",
  "app/routes/app.project.$id.tsx", "app/routes/app.store-snapshots.$id.tsx",
  "app/routes/app.store-snapshots._index.tsx", "app/routes/app.upgrade.tsx",
];
const resources = [
  "app/routes/api.billing-sync.tsx", "app/routes/api.dashboard-conversion.tsx", "app/routes/api.growth-metrics.tsx",
  "app/routes/api.growth-report.tsx", "app/routes/api.locale.tsx", "app/routes/api.project-journeys.tsx",
  "app/routes/api.project-sources.tsx", "app/routes/api.resources.$category.tsx",
  "app/routes/api.storefront-tracker-status.tsx", "app/routes/api.track.tsx",
  "app/routes/app.ab-tests.$id.report.tsx", "app/routes/app.customer-snapshots.$id_.journey.$sessionId.tsx",
];
const importRe = /import\s*(type\s+)?\{([^}]*)\}\s*from\s*"(react-router|@react-router\/node|@remix-run\/node)";?\n?/g;
function dropJsonImport(source) {
  return source.replace(importRe, (whole, typeKeyword, names, from) => {
    const all = names.split(",").map((n) => n.trim()).filter(Boolean);
    const kept = all.filter((n) => n !== "json");
    if (kept.length === all.length) return whole;
    return kept.length ? `import ${typeKeyword || ""}{ ${kept.join(", ")} } from "${from}";\n` : "";
  });
}
for (const file of screens) {
  const source = dropJsonImport(readFileSync(file, "utf8"));
  writeFileSync(file, `import { json } from "../utils/route-data";\n${source}`);
  console.log("screen json helper:", file);
}
for (const file of resources) {
  const source = dropJsonImport(readFileSync(file, "utf8")).replace(/(^|[^.\w$])json\(/gm, "$1Response.json(");
  writeFileSync(file, source);
  console.log("Response.json:", file);
}
JS
grep -rnE 'import \{[^}]*\bjson\b[^}]*\} from "(react-router|@react-router/node)"' app || echo "no json imports left"
```

Expected: the last line prints "no json imports left". None of the 12 resource routes passes a bare number as the init, so `Response.json(body, init)` behaves exactly like Remix's `json()`.

- [ ] **Step 9: Switch the app frame and the Shopify server to the new package**

Replace the Shopify import paths everywhere:

```bash
grep -rl "@shopify/shopify-app-remix" app | xargs sed -i '' \
  -e 's#@shopify/shopify-app-remix/adapters/node#@shopify/shopify-app-react-router/adapters/node#' \
  -e 's#@shopify/shopify-app-remix/server#@shopify/shopify-app-react-router/server#' \
  -e 's#@shopify/shopify-app-remix/react#@shopify/shopify-app-react-router/react#'
```

In `app/routes/app.tsx`:

- Replace the provider import with these lines:

  ```ts
  import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
  import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
  import { PolarisLink } from "../components/PolarisLink";
  import { POLARIS_URL } from "../utils/polaris";
  ```

- Replace the `return (...)` of `AppContent` with:

  ```tsx
  return (
    <ShopifyAppProvider apiKey={apiKey} polarisUrl={POLARIS_URL}>
      <PolarisAppProvider
        i18n={polarisTranslations[locale]}
        linkComponent={PolarisLink}
      >
        <BackgroundBillingSync />
        <AppBridgeNav />
        {isRouteTransition ? (
          <InstantRouteShell pathname={pendingPathname} />
        ) : (
          <Outlet />
        )}
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
  ```

- Keep `export const links` (Polaris React's stylesheet), `ErrorBoundary` and `headers` as they are.

In `app/shopify.server.ts`:

1. Check the config type: run `grep -rn "polarisUrl\|unstable_newEmbeddedAuthStrategy" node_modules/@shopify/shopify-app-react-router/dist/ts/server/ | head`.
2. If `polarisUrl` appears in the config type, add `import { POLARIS_URL } from "./utils/polaris";` and `polarisUrl: POLARIS_URL,` to the `shopifyApp({...})` options.
3. If `unstable_newEmbeddedAuthStrategy` no longer appears, delete the whole `future: { unstable_newEmbeddedAuthStrategy: true },` block (the new auth strategy is the default).
4. Leave everything else as it is, including billing.

- [ ] **Step 10: Replace the Remix ESLint config**

```bash
npm install --save-dev @typescript-eslint/parser@^8 @typescript-eslint/eslint-plugin@^8 eslint-plugin-react@^7 eslint-plugin-react-hooks@^5 eslint-plugin-jsx-a11y@^6 eslint-plugin-import@^2 eslint-import-resolver-typescript@^3
```

`.eslintrc.cjs`:

```js
/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
  env: { browser: true, node: true, es2022: true },
  plugins: ["@typescript-eslint", "react", "react-hooks", "jsx-a11y", "import"],
  extends: [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:react/jsx-runtime",
    "plugin:react-hooks/recommended",
    "plugin:jsx-a11y/recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  settings: { react: { version: "detect" }, "import/resolver": { typescript: {} } },
  globals: { shopify: "readonly" },
  rules: {
    "react/prop-types": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  },
  ignorePatterns: ["build/", ".react-router/", "node_modules/", "extensions/**/dist/"],
};
```

Run `npx eslint app --format compact | grep -c ' Error - '`. If the count is above the baseline's `eslint-errors`, find the rules that now fire and weren't firing before (`npx eslint app --format compact | grep ' Error - ' | sed -E 's/.*\(([^)]+)\)$/\1/' | sort | uniq -c`). Set each of those rules to `"warn"` in `rules`, and name them in the commit message.

- [ ] **Step 11: Update the check scripts' module mocks**

```bash
sed -i '' -e 's#"@remix-run/react"#"react-router"#g' -e 's#"@remix-run/node"#"react-router"#g' scripts/check-*.mjs scripts/preview-*.mjs
```

1. Fix the merged objects. In any mocks object that now has two `"react-router":` keys (at least `scripts/check-performance-regressions.mjs`), merge them into one object. JavaScript keeps only the last duplicate key.
2. Run `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-framework-upgrade-baseline.txt`.
3. For each regression that loads a module now importing `../utils/route-data`:
   - Add this mock to that check:

     ```js
     "../utils/route-data": {
       json: (body, init) => ({
         data: JSON.parse(JSON.stringify(body) ?? "null"),
         init: typeof init === "number" ? { status: init } : init,
       }),
     },
     ```

   - Change its assertions on that screen loader's result. Read `result.data` instead of `await response.json()`, and `result.init?.status ?? 200` instead of `response.status`.
4. Repeat until the runner reports no regressions.

- [ ] **Step 12: Run everything**

```bash
node --test scripts/check-framework-upgrade.mjs
npm run build
node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-framework-upgrade-baseline.txt
npx react-router typegen && npx tsc --noEmit 2>&1 | grep -E '^(react-router\.config\.ts|vite\.config\.ts|app/routes\.ts|app/root\.tsx|app/entry\.server\.tsx|app/routes/app\.tsx|app/shopify\.server\.ts|app/utils/route-data\.ts|app/utils/polaris\.ts|app/components/PolarisLink\.tsx)' || echo "framework files type-clean"
echo "tsc-errors after task 3: $(npx tsc --noEmit 2>&1 | grep -c 'error TS')"
```

Expected:
- All tests in `check-framework-upgrade.mjs` pass.
- The build succeeds.
- The runner reports "No regressions".
- The typecheck prints "framework files type-clean".

Write the total TypeScript error count in the commit message. It may differ from the baseline because the route types changed. It does not gate this task.

- [ ] **Step 13: Smoke test**

Run Appendix A and record the results in `.smoke/task-3.md`. Every step must match `.smoke/baseline.md`.

Also confirm in the browser console that `document.querySelector('script[src="https://cdn.shopify.com/shopifycloud/polaris-2.js"]')` is not null and `customElements.get("s-page")` is defined. Polaris web components are loaded but unused, so nothing should look different. If anything does (fonts, background, spacing), stop and report it before committing.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "Move from Remix to React Router 7 and Shopify's React Router package" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Vercel's React Router preset

**Files:**
- Modify:
  - `react-router.config.ts`
  - `app/entry.server.tsx`
  - `vercel.json`
  - `package.json`
- Test: `scripts/check-framework-upgrade.mjs`

**Interfaces:**
- Consumes: `loadModule` from Task 3.
- Produces: `entry.server.tsx` default export `handleRequest(request, responseStatusCode, responseHeaders, routerContext, loadContext?)`. It adds Shopify's document headers, then delegates to `@vercel/react-router/entry.server`.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/check-framework-upgrade.mjs`:

```js
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
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test scripts/check-framework-upgrade.mjs`
Expected: the two new tests FAIL.

- [ ] **Step 3: Install the preset**

Run `npm install --save-exact @vercel/react-router@1.3.7`.

Then check the handler's signature: `cat node_modules/@vercel/react-router/dist/entry.server.d.ts` (or the `.d.ts` next to the `entry.server` export in its `package.json`). Expected: `handleRequest(request, responseStatusCode, responseHeaders, routerContext, loadContext?, options?)`. If the order differs, match it in Step 4 and in the test above.

- [ ] **Step 4: Use the preset and Vercel's handler**

`react-router.config.ts`:

```ts
import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

export default { ssr: true, presets: [vercelPreset()] } satisfies Config;
```

`app/entry.server.tsx`:

```tsx
import type { AppLoadContext, EntryContext } from "react-router";
import { handleRequest as vercelHandleRequest } from "@vercel/react-router/entry.server";
import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 5000;

// Shopify's document headers (CSP frame-ancestors and friends) first, then
// Vercel's streaming renderer.
export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext?: AppLoadContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  return vercelHandleRequest(
    request,
    responseStatusCode,
    responseHeaders,
    routerContext,
    loadContext,
  );
}
```

- [ ] **Step 5: Confirm Vercel's framework slug, then update `vercel.json`**

```bash
mkdir -p /tmp/vercel-frameworks-check && cd /tmp/vercel-frameworks-check && npm init -y >/dev/null && npm install --silent @vercel/frameworks >/dev/null && node -e "console.log(require('@vercel/frameworks').frameworks.map(f => f.slug).filter(s => /react-router|remix/.test(s)))"; cd -
```

Expected: the output includes `react-router`. If it doesn't, stop and ask the user before changing `vercel.json`.

`vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["fra1"],
  "framework": "react-router",
  "installCommand": "npm install",
  "buildCommand": "npm run build"
}
```

- [ ] **Step 6: Run everything**

```bash
node --test scripts/check-framework-upgrade.mjs
npm run build
node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-framework-upgrade-baseline.txt
```

Expected: all tests pass, the build succeeds (the preset also writes Vercel's output), and there are no regressions.

- [ ] **Step 7: Commit**

```bash
git add react-router.config.ts app/entry.server.tsx vercel.json package.json package-lock.json scripts/check-framework-upgrade.mjs
git commit -m "Build with Vercel's React Router preset and render documents through its handler" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: React 19 (spike with a go/no-go gate)

**Files:**
- Modify: `package.json`, `package-lock.json`, and possibly `.npmrc`
- Test: `scripts/check-framework-upgrade.mjs`
- If the gate fails: `docs/superpowers/specs/2026-11-06-polaris-ui-redesign-design.md` (section 9, step 4 note)

**Interfaces:**
- Produces: either React 19 installed (plan 2 can use controlled Polaris web-component fields directly), or a recorded decision to stay on React 18 until Polaris React is removed.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/check-framework-upgrade.mjs`:

```js
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
```

- [ ] **Step 2: Run them**

Run: `node --test scripts/check-framework-upgrade.mjs`
Expected: the React version test FAILS (18.3.1), and the Polaris render test passes on React 18.

- [ ] **Step 3: Install React 19**

```bash
npm install --save-exact react@^19.2.7 react-dom@^19.2.7
npm install --save-dev --save-exact @types/react@^19 @types/react-dom@^19
```

If npm stops with `ERESOLVE` because `@shopify/polaris` declares `react ^18.0.0`:

1. Add this to `package.json`'s existing `overrides` object, then run `npm install` again:

   ```json
   "@shopify/polaris": { "react": "$react", "react-dom": "$react-dom" }
   ```

2. If it still stops, create `.npmrc` containing `legacy-peer-deps=true` (Vercel's install honours it) and run `npm install` again.

Write down which of the two was needed.

- [ ] **Step 4: Run everything**

```bash
node --test scripts/check-framework-upgrade.mjs
npm run build
node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-framework-upgrade-baseline.txt
echo "tsc-errors after react 19: $(npx tsc --noEmit 2>&1 | grep -c 'error TS')"
```

- [ ] **Step 5: Smoke test with extra overlay checks**

Run Appendix A and record the results in `.smoke/task-5.md`. Watch the browser console for errors such as "findDOMNode is not a function" or "Accessing element.ref". Make sure these all open AND close cleanly:
- the Create project modal (step 3)
- a popover: the language menu (step 2) or the A/B tests sort menu (step 6)
- the toast after creating a project (step 3)

- [ ] **Step 6: Gate decision**

**GO** requires all of:
- Step 4 is fully green.
- The smoke test matches `.smoke/baseline.md`.
- No new console errors appear.

If GO:

```bash
git add package.json package-lock.json scripts/check-framework-upgrade.mjs $(test -f .npmrc && echo .npmrc)
git commit -m "Move to React 19 alongside Polaris React" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If NO-GO:
1. Undo the install with `git checkout -- package.json package-lock.json && rm -f .npmrc && npm ci`.
2. Delete the test "React and React DOM are the same 19.x version" (keep the Polaris render test).
3. Add this line under spec section 9, step 4: `> 2026-11-06 spike: NO-GO — <what failed>. Staying on React 18 until Polaris React is removed; plan 2 uses ref-based wrappers for controlled web-component fields.`
4. Commit:

   ```bash
   git add docs/superpowers/specs/2026-11-06-polaris-ui-redesign-design.md scripts/check-framework-upgrade.mjs
   git commit -m "Record the React 19 spike result: stay on React 18 for now" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
   ```

---

### Task 6: Types for Polaris and App Bridge web components

**Files:**
- Create: `scripts/fixtures/polaris-jsx.tsx`
- Create: `scripts/fixtures/tsconfig.polaris.json`
- Modify: `tsconfig.json` (`types`), `package.json`, `package-lock.json`
- Test: `scripts/check-framework-upgrade.mjs`

**Interfaces:**
- Produces: `s-*` and `ui-*` elements type-check in TSX. Plan 2 builds on this.

- [ ] **Step 1: Write the type fixture and the failing test**

`scripts/fixtures/polaris-jsx.tsx`:

```tsx
// Type-only fixture: proves the Polaris web component types are installed.
export function PolarisTypesFixture() {
  return (
    <s-page heading="Projects">
      <s-button slot="primary-action" variant="primary">
        Create project
      </s-button>
      <s-section heading="Latest measurement">
        <s-badge tone="success">Completed</s-badge>
      </s-section>
    </s-page>
  );
}
```

`scripts/fixtures/tsconfig.polaris.json`:

```json
{
  "extends": "../../tsconfig.json",
  "include": ["polaris-jsx.tsx"]
}
```

Add to `scripts/check-framework-upgrade.mjs`, with `import { spawnSync } from "node:child_process";` at the top:

```js
test("Polaris web component elements type-check in TSX", () => {
  const run = spawnSync("npx", ["tsc", "--noEmit", "-p", "scripts/fixtures/tsconfig.polaris.json"], {
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test scripts/check-framework-upgrade.mjs`
Expected: FAIL with errors like "Property 's-page' does not exist on type 'JSX.IntrinsicElements'".

- [ ] **Step 3: Install the types**

```bash
npm install --save-dev --save-exact @shopify/polaris-types@2.0.0 @shopify/app-bridge-types@latest
```

In `tsconfig.json`, set `"types": ["node", "@react-router/node", "vite/client", "@shopify/polaris-types", "@shopify/app-bridge-types"]`.

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test scripts/check-framework-upgrade.mjs`
Expected: PASS.

If it still fails, and Task 5 ended NO-GO (React 18 types), run `npm install --save-dev --save-exact @shopify/polaris-types@1.0.1` (the version Shopify's template uses with React 18) and run the test again.

- [ ] **Step 5: Run the regression bar**

```bash
npm run build
node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-framework-upgrade-baseline.txt
```

- [ ] **Step 6: Commit**

```bash
git add scripts/fixtures tsconfig.json package.json package-lock.json scripts/check-framework-upgrade.mjs
git commit -m "Add Polaris and App Bridge web component types" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Final verification and preview deploy

**Files:**
- Modify: `docs/superpowers/plans/2026-11-06-framework-upgrade.md` (append a Results section)

- [ ] **Step 1: Run the full automated bar, including the database checks**

Start the loopback Postgres from Appendix A (setup steps 1–2 only). Then run:

```bash
node --test scripts/check-framework-upgrade.mjs
npm run build
node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-framework-upgrade-baseline.txt
export GROWTH_TEST_DATABASE_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke" JOURNEY_TEST_DATABASE_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke"
for f in check-growth-report-sections check-growth-reports check-growth-projects-db check-customer-journeys; do DATABASE_URL="$GROWTH_TEST_DATABASE_URL" DIRECT_URL="$GROWTH_TEST_DATABASE_URL" node --test "scripts/$f.mjs" && echo "PASS $f" || echo "FAIL $f"; done
```

Expected: everything passes, including the four database checks.

- [ ] **Step 2: Full smoke test**

Run Appendix A and record the results in `.smoke/final.md`. Every step must match `.smoke/baseline.md`. Repeat Task 3 Step 13's script and custom-element check.

- [ ] **Step 3: Preview deploy, only after the user says yes in chat**

Ask: "Ready to make a Vercel preview deployment of the framework upgrade (not production)?"

On yes:

```bash
npx vercel deploy --scope therhoe
```

Then check the result:
- The build log shows the React Router preset and the `fra1` region.
- `npx vercel curl --scope therhoe --deployment <preview-url> /` returns 200.
- `npx vercel curl --scope therhoe --deployment <preview-url> /app` returns a redirect or 401 to Shopify auth, not a 500.

Do not promote, and do not deploy to production.

- [ ] **Step 4: Write the results and commit**

Append a `## Results` section to this plan. It records:
- whether React 19 is GO or NO-GO
- whether the overrides or `.npmrc` were needed
- the TypeScript error counts (baseline → final)
- the preview URL
- any ESLint rules relaxed to warnings

Then commit:

```bash
git add docs/superpowers/plans/2026-11-06-framework-upgrade.md
git commit -m "Record the framework upgrade results" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Appendix A: Smoke test on the dev store

Run this against the **shep-dev** dev store with a **throwaway local database**, never the production one. The user may need to sign in or enter the store password in the browser pane. Ask them to stay nearby before starting.

**Setup**

1. Start the throwaway Postgres. The first-time lines may report "already exists"; that's fine.

   ```bash
   PGBIN=/opt/homebrew/opt/postgresql@17/bin
   PGDATA="$HOME/.cache/snapshot-smoke-pg"
   test -d "$PGDATA" || LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 "$PGBIN/initdb" -D "$PGDATA" -U growth_test --auth=trust
   LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/log" -o "-p 55443 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start
   "$PGBIN/createdb" -h 127.0.0.1 -p 55443 -U growth_test snapshot_smoke || true
   ```

2. Point both database variables at it, create the schema, and mark every migration as applied. Otherwise dev's `prisma migrate deploy` fails on a pushed schema.

   ```bash
   export DATABASE_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke" DIRECT_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke"
   node -e 'const h=new URL(process.env.DATABASE_URL).hostname; if(h!=="127.0.0.1"){console.error("NOT LOOPBACK");process.exit(1)} console.log("loopback ok")'
   npx prisma db push --skip-generate
   for m in prisma/migrations/*/; do npx prisma migrate resolve --applied "$(basename "$m")" || true; done
   ```

3. In a terminal tab where those two variables are exported, run `shopify app dev` and choose shep-dev if asked. Open the preview URL it prints in the browser pane.

**Steps** (record PASS/FAIL and notes for each)

1. **Home** (`/app`) loads. The conversion panel shows numbers or its empty state, and `/api/dashboard-conversion` returns 200.
2. **Language:** switch to Deutsch from the language menu. App text and Polaris strings change, for example pagination "Weiter". Switch back to English.
3. **Projects:** open "Create project".
   - Create a Store project "Smoke store" with a 10-visitor target. A success toast appears.
   - Create a Page project for any product.
4. **Project:** open "Smoke store", then "View results". The results sheet opens. Change Audience between All and Active, then close the sheet.
5. **Tracking:** in a new tab, open the product used in step 3 on the dev storefront, scroll and click one link. Back in the app, reload that Page project. Its session count went up.
6. **A/B tests** (`/app/ab-tests`): the page loads. Open the sort menu and close it. Open "Create A/B test" and close it.
7. **Upgrade** (`/app/upgrade`): the page loads. Click the Signal upgrade button. Shopify's plan page opens in the admin. Go back without approving anything.
8. **Throughout:** the browser console has no errors, and the network panel shows no unexpected 4xx/5xx.

**Teardown**

1. Stop `shopify app dev` (Ctrl-C), then run `shopify app dev clean`.
2. Stop Postgres with `"$PGBIN/pg_ctl" -D "$PGDATA" stop`.
3. Ask the user whether shep-dev's web pixel needs pointing back at production, as was done after the 2026-11-04 check.

---

## Results

Recorded 2026-11-06 after Task 7 and the final whole-branch review.

**React 19: GO.** React and React DOM 19.3.1 run alongside Polaris React 12.27.0. Popovers, App Bridge modals, the max results modal and the full-screen A/B modal all open and close in the smoke test with no new console errors.

**Overrides and `.npmrc`:** no `overrides` were needed. The `.npmrc` with `legacy-peer-deps=true` was already in the repo before this branch, so npm keeps a single shared React install with no changes.

**TypeScript errors:** 75 at baseline → 101 at the end. All of the framework files are type-clean. The 26 new errors are all types-only (runtime unchanged):
- 19 come from `useFetcher<typeof loader>` on a loader that returns `Response.json`, which React Router 7 types as `never` (`app.customer-snapshots.$id.tsx`).
- 3 are React 19's stricter `useRef<T>()` signature.
- The rest are route-typing differences.

All are deferred as minors.

**ESLint:** 17 errors at baseline → 0 errors and 63 warnings.
- `jsx-a11y/label-has-associated-control` is off. It crashes under the repo-wide `minimatch` 9 override.
- These 11 rules are now warnings: `no-empty`, `jsx-a11y/no-static-element-interactions`, `jsx-a11y/click-events-have-key-events`, `react/no-unknown-property`, `react/no-unescaped-entities`, `prefer-const`, `no-var`, `jsx-a11y/no-noninteractive-tabindex`, `jsx-a11y/no-noninteractive-element-interactions`, `jsx-a11y/html-has-lang`, `@typescript-eslint/no-unused-expressions`.

**Preview deployment:** https://mousewhisperer-2i8oa4gtk-therhoe.vercel.app (`dpl_GB3Fy2x8UnrsrNxpRE5UCsWUY9Ha`).
- It is a preview, not promoted. It was built with `react-router build` and Vercel's React Router preset, and every function runs in `fra1`.
- `GET /` → 200.
- `GET /app` with a curl user agent → 410. Shopify's bot filter does this, and production answers the same way.
- `GET /app` with a browser user agent → 200 with the App Bridge bounce page. Production, still on Remix, redirects to `/auth/login` here. Shopify's React Router package now renders App Bridge to retrieve a session when `shop` is missing (`validate-shop-and-host-params`).
- `POST /app/projects.data` with the deployment's own `Origin` passes React Router's CSRF check and reaches Shopify's auth. A foreign `Origin` → 400 before any action runs.

**Final review:** a fresh reviewer returned "With fixes", with no Critical issues.
- One fix is in: every route that calls `authenticate.admin`, including API routes reached by fetchers, now exports `boundary.headers`. Before this, single-fetch `.data` responses dropped the 401's re-auth headers.
- The minors are deferred: fetcher `never` types, the `useRef` types, external links now opening a new tab, `Response.json` without `charset`, and the stale README and `.eslintignore`.

**Known limits:**
- The language switch can't be tested in dev (SameSite=Lax locale cookie in a cross-site frame).
- `check-customer-journey-ui` still fails, as it did at baseline. It clicks a button that the 2026-10-23 Projects release replaced.
