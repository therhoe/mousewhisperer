# Polaris Screens, Part 2a: Navigation, Settings, Plans and Projects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the shared navigation rules and Polaris building blocks, put Projects, A/B tests, Plans and Settings in the app menu, and rebuild Settings (new), Plans (replacing Upgrade) and Projects with Polaris web components.

**Architecture:**
- Navigation rules live in one pure module, `app/utils/navigation.ts`, which tests call directly.
- A small React layer turns those rules into behaviour:
  - a Back control in the `s-page` title bar;
  - one capture-phase `shopify:navigate` listener that makes that control step back instead of pushing;
  - a ref-based helper for Polaris events.
- Settings, Plans and Projects are rewritten as `s-page` screens. Unmigrated screens keep Polaris React, side by side, as the spec allows.

**Tech Stack:** React Router 7.18.5, React 19.3.1, `@shopify/shopify-app-react-router` 4.0.1, Polaris web components 2.0 (`@shopify/polaris-types` 2.0.0, `polaris-2.js`), App Bridge (`s-app-nav`, `@shopify/app-bridge-types` 0.7.4), Prisma 6.19, `node --test` checks.

**Spec:** `docs/superpowers/specs/2026-11-06-polaris-ui-redesign-design.md`. Mockups: frames 2 (Projects), 12 (Plans) and 13 (Settings) at https://claude.ai/artifact/JHMSH51eAuJSov1LRnhiD6.

## Where this plan sits

Plan 2 from the spec (sections 4–6, and 9 steps 6–8) is too large for one plan: about 37,000 lines of UI across 48 files that use Polaris React. It is split along the spec's own migration order (section 9, step 7). Each part ships on its own and is checked on shep-dev:

| Part | Contents |
|---|---|
| **2a (this plan)** | Navigation rules and building blocks, the app menu, Settings, Plans, Projects |
| 2b | Create project page, Project page |
| 2c | Results sheet (`useSheet`), detailed reports, customer journey, redirects for retired snapshot addresses |
| 2d | A/B tests, Create A/B test, A/B test, variant sheet |
| 2e | Home (with the setup guide and Settings' "Show setup guide on Home again"), then remove Polaris React |

Plan 3 (number changes and data model) is separate and unchanged.

## Global Constraints

- **Stack:**
  - Polaris web components 2.0 for every new or changed screen (spec 5).
  - React 19.3.1, React Router 7.18.5. Do not upgrade either.
- **Navigation:**
  - Back rules 1–6 from spec 4.3:
    1. Back returns to where you came from. Opened from a bookmark or a fresh link, Back goes to the screen's parent.
    2. Pop-ups and filters never add Back steps. Full-screen sheets add one: Back closes the sheet, or steps back inside it.
    3. After creating something, Back skips the form.
    4. After deleting, you land on the list, never an error page.
    5. Upgrading returns you to the screen you started from.
    6. One header per screen, one primary button.
  - App menu (spec 4.1): App name **Snapshot** (the `rel="home"` link, goes to Home), then **Projects**, **A/B tests**, **Plans**, **Settings**.
- **Languages:** 4 languages (en, de, zh-CN, zh-TW). Every new string goes into `app/locales/catalog.ts` as `"English key": [German, Simplified Chinese, Traditional Chinese]`. `scripts/check-i18n.mjs` fails on a missing or empty translation, or on a placeholder mismatch.
- **Labels and prices:**
  - Labels say "store-level / page-level measurements" instead of "snapshots".
  - Prices and limits are unchanged (Whisper $49.99, Signal $99.99, every 30 days).
- **Mobile width:** every screen works at 375 px. Headers wrap, tables scroll sideways, and two-column layouts stack.
- **The local `.env` points at the PRODUCTION database:**
  - Never run `shopify app dev`, `npm run dev`, `npm run setup`, `prisma migrate`, `prisma db push` or a database-backed check without first exporting BOTH `DATABASE_URL` and `DIRECT_URL` to a loopback Postgres (Task 9 shows how).
  - `scripts/run-checks.mjs` already forces an unreachable database.
- **Deploys:** none without the user's explicit OK in chat. Never promote.
- **Git:**
  - Work on branch `polaris-ui-redesign` (production runs its commit 5e978d9).
  - Commit once per task. Never push without the user's OK.
  - Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; the commands pass it as a second `-m`.
- **Regression bar** at the end of every task:
  - `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt` exits 0.
  - `npm run build` succeeds.
  - `npx tsc --noEmit` reports no error in a file the task touched (the project has about 100 older errors elsewhere).

## Facts this plan relies on (checked against the installed versions)

1. **React 19.3.1 and custom elements:**
   - `onClick`, `onInput` and `onChange` work on Polaris elements. React 19 handles a custom element's `change` event, and `click`/`input` bubble to React's root listener.
   - Any other `on…` prop becomes `addEventListener(<the rest of the name>)`, case-sensitive. So `onNextPage` would listen for "NextPage", but `s-table` fires `nextpage`. Those events need a ref (`useElementEvent`, Task 2).
2. **Polaris 2 links and buttons** (`polaris-2.js`, global click listener):
   - A click on `s-link`, `s-button` or `s-clickable` with an `href` dispatches `shopify:navigate` on that element (`bubbles`, `cancelable`, `composed`). This happens only when:
     - the `href` is same-origin;
     - the element's `target` is absent, `_self` or `auto`;
     - the click was not already `preventDefault`ed.
   - `AppProvider` from `@shopify/shopify-app-react-router/react` listens on `document` and calls `navigate(href)`, which is a push.
   - External links with `target="_blank"` behave as ordinary links.
3. **`s-page` in the embedded admin:**
   - Its `heading` and slots fill the admin title bar.
   - `breadcrumb-actions` takes "a Link element with an `href`" (App Bridge types).
4. **React Router's history index:** each entry's position is kept in `history.state.idx`. It is 0 for the entry the app opened on, +1 per push and unchanged on replace.
5. **App menu:** `s-app-nav` with `s-link` children; `rel="home"` marks Home.
   - App Bridge declares `s-app-nav` on the global `JSX` namespace. React 19's TSX reads `React.JSX`, so it needs a declaration there.
   - `s-link`'s types have no `rel`, so `rel` is passed with a spread. Both were type-checked during planning.
6. **Elements:** `polaris-2.js` (919,721 bytes, fetched 2026-11-06) defines every element this plan uses:
   - `s-page`, `s-section`, `s-box`, `s-stack`, `s-grid`
   - `s-table`, `s-badge`, `s-banner`, `s-button`, `s-button-group`, `s-press-button` (`pressed`)
   - `s-select`, `s-option`, `s-search-field`
   - `s-text`, `s-paragraph`, `s-heading`, `s-divider`, `s-progress`
   - `s-unordered-list`, `s-list-item`
7. **Billing and settings data:**
   - `getBillingAccess` / `getBillingDisplayAccess` return `{ plan, planName, isFree, usage: { storeSnapshots, normalSnapshots, abTests, … }, limits: { storeSnapshots, normalSnapshots, maxSnapshotTargetVisitors, abTests } }`.
   - Store-level measurements count as `storeSnapshots`, page-level as `normalSnapshots`.

## Rulings (decisions this plan makes where the spec is silent or would not work as written)

1. **Back test (spec 4.4):** the plan uses `history.state.idx > 0` instead of `location.key !== "default"`.
   - Why: `key` stops being "default" after the first replace, so after `navigate(parent, { replace: true })` on a fresh link, a later Back would leave the app.
   - Cost if wrong: one helper.
2. **Back control (spec 4.4):** `<s-link slot="breadcrumb-actions" href={parent} data-snapshot-back="">` plus one capture-phase `shopify:navigate` listener that stops the AppProvider's push and steps back. It replaces an `onClick` handler.
   - Why: title-bar clicks arrive as `shopify:navigate` on that link (fact 2).
   - Cost if wrong: the shep-dev check in Task 9 shows it, and the fallback is an in-page back button.
3. **`returnTo` (spec 4.4):** stored in `localStorage` per shop, not in a signed cookie. Plans returns to it on the client after `/app/upgrade/return` lands on `/app/plans?billing=approved`.
   - Why: the app runs in a cross-site iframe, where cookies can be rejected. `app/utils/i18n.tsx` already falls back to `localStorage` for that reason.
   - Without storage, the merchant lands on Plans (the spec's own fallback).
   - Cost if wrong: Upgrade returns to Plans instead of the start screen.
4. **Projects columns:** in 2a the table shows Project, Scope, Status, Latest measurement, A/B tests and Updated. Sessions, conversions, conversion rate and revenue move to plan 3.
   - Why: captures store no session counters, so those columns need the per-capture totals plan 3 builds (spec 7.2 already gives plan 3 the Projects numbers).
   - Cost if wrong: Projects has no number columns until plan 3.
5. **"Create project" on Projects** keeps today's pop-up in 2a. The page (`/app/projects/new`) arrives in 2b together with the form's redesign.
6. **"Show setup guide on Home again"** moves to 2e.
   - Why: today's Home shows no setup guide (the component that did, `LegacySnapshotDashboard`, is not routed), so the control would do nothing until Home is rebuilt.
7. **Upgrade links on unmigrated screens** keep pointing at `/app/upgrade`, which now redirects to `/app/plans` with its query.
   - Each later part switches its own screens to `plansHref()`, so rule 5 (return to start) arrives screen by screen.
   - `PremiumGate`'s default link changes to `/app/plans` now.
8. **Project statuses:**
   - **Measuring:** the latest measurement's capture is running.
   - **Completed:** the latest measurement finished.
   - **Idle:** no measurement yet, or the latest is paused.
   - The three never overlap and always add up to All.

## Review Focus

1. **A bookmark or fresh link to Plans, then title-bar Back.** Expected: Back goes to Home and never leaves the app. Pinned by Task 1's `backTarget` test and Task 2's interceptor test (index 0 → replace).
2. **Several filter clicks or page changes on Projects, then Back.** Expected: Back returns to the previous screen in one step. Pinned by Task 7's test that filters use `{ replace: true }`.
3. **Search text with control characters or 300 characters.** Expected: it is cleaned and cut to 120, and nothing breaks. Pinned by Task 6's `parseProjectListFilters` test.
4. **A stale `?page=9` after a filter shrinks the list.** Expected: the last page shows, never an empty table. Pinned by Task 6's `selectProjectPage` test.
5. **A tampered `returnTo`, or blocked browser storage.** Expected: never an off-app redirect. Upgrade still opens Shopify's page, and the merchant lands on Plans. Pinned by Task 1's `safeReturnTo` tests and Task 3's `startUpgrade`/`finishUpgrade` tests.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `app/utils/navigation.ts` | create | Pure navigation rules: Back target, `returnTo` check, Plans link, list params, Back interception |
| `app/components/polaris/navigation.tsx` | create | `BackAction` (title-bar Back) and `useBackInterceptor` |
| `app/components/polaris/events.ts` | create | `listen` and `useElementEvent` for Polaris events |
| `app/types/app-bridge-jsx.d.ts` | create | Declares `s-app-nav` for React 19's JSX |
| `app/utils/plans.ts` | create | Paid plan data, `planChange`, `startUpgrade`, `finishUpgrade` (browser-safe) |
| `app/utils/plans.server.ts` | create | Shopify's managed pricing URL |
| `app/routes/app.plans.tsx` | create | Plans screen |
| `app/routes/app.upgrade.tsx` | replace | Redirect to `/app/plans`, keeping the query |
| `app/routes/app.upgrade.return.tsx` | modify | Land on `/app/plans?billing=…` |
| `app/components/PremiumGate.tsx` | modify | Default Upgrade link `/app/plans` |
| `app/utils/web-pixel.server.ts` | modify | Add read-only `getWebPixelStatus` |
| `app/routes/api.storefront-tracker-status.tsx` | modify | Also return `pixelStatus` |
| `app/components/LanguageMenu.tsx` | modify | Extract `useLanguageSwitch` |
| `app/routes/app.settings.tsx` | create | Settings screen |
| `app/routes/app.tsx` | modify | `s-app-nav` menu, Back interceptor |
| `app/utils/growth-projects.ts` | modify | List filters, project status, page selection |
| `app/utils/growth-projects.server.ts` | modify | `listGrowthProjects` filters and counts |
| `app/components/ProjectsTable.tsx` | create | Projects `s-table` |
| `app/routes/app.projects._index.tsx` | rewrite | Projects screen |
| `app/locales/catalog.ts` | modify | 49 new strings |
| `scripts/check-navigation.mjs` | create | Tests for Tasks 1–2 |
| `scripts/check-plans-settings.mjs` | create | Tests for Tasks 3–4 |
| `scripts/check-projects-list.mjs` | create | Tests for Tasks 6–7 |
| `scripts/check-projects-ui.mjs`, `scripts/check-framework-upgrade.mjs`, `scripts/check-performance-regressions.mjs`, `scripts/check-snapshot-branding.mjs`, `scripts/fixtures/*` | modify | Keep older checks true to the new code |

---

### Task 1: Navigation rules

**Files:**
- Create: `app/utils/navigation.ts`
- Test: `scripts/check-navigation.mjs`
- Create: `docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type BackTarget = { kind: "pop" } | { kind: "replace"; to: string }`
  - `backTarget(historyIndex: unknown, parentPath: string): BackTarget`
  - `safeReturnTo(value: unknown): string | null`
  - `plansHref(from?: string | null): string`
  - `listParams(current: URLSearchParams, changes: Record<string, string | null>): URLSearchParams`
  - `BACK_LINK_SELECTOR = "[data-snapshot-back]"`
  - `interceptBackNavigation(event, historyIndex: unknown): BackTarget | null`, where `event` is `{ target: unknown; stopImmediatePropagation(): void; preventDefault(): void }`

- [ ] **Step 1: Record the check baseline**

Run: `node scripts/run-checks.mjs --write docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt`
Expected: one PASS/FAIL line per check script. `check-customer-journey-ui.mjs` is a known older FAIL; every other line is PASS. The file is written.

- [ ] **Step 2: Write the failing tests**

Create `scripts/check-navigation.mjs`:

```js
// Navigation rules and Polaris helpers for the redesigned screens (plan 2a).
// Read-only: loads small modules with mocks; never touches Shopify or a database.
// Run: node --test scripts/check-navigation.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");

// Transpiles an app file to CommonJS and runs it. Specifiers in `mocks` are
// replaced at every depth; other relative imports load the same way; packages
// load for real from node_modules.
function loadModule(file, mocks = {}) {
  const filename = path.resolve(root, file);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  const load = (id) => {
    if (id in mocks) return mocks[id];
    if (!id.startsWith(".")) return require(id);
    const base = path.resolve(path.dirname(filename), id);
    const target = [`${base}.ts`, `${base}.tsx`, base].find(existsSync);
    if (!target) throw new Error(`Cannot resolve ${id} from ${file}`);
    return loadModule(path.relative(root, target), mocks);
  };
  new Function("module", "exports", "require", output)(mod, mod.exports, load);
  return mod.exports;
}

const nav = loadModule("app/utils/navigation.ts");

test("Back pops only when an earlier in-app entry exists, otherwise replaces with the parent", () => {
  for (const index of [1, 2, 40])
    assert.deepEqual(nav.backTarget(index, "/app/projects"), { kind: "pop" });
  for (const index of [0, -1, 1.5, "3", null, undefined, Number.NaN])
    assert.deepEqual(nav.backTarget(index, "/app/projects"), {
      kind: "replace",
      to: "/app/projects",
    });
});

test("returnTo keeps in-app paths and drops signed launch values", () => {
  assert.equal(nav.safeReturnTo("/app"), "/app");
  assert.equal(
    nav.safeReturnTo("/app/projects/abc?results=m1&audience=all"),
    "/app/projects/abc?results=m1&audience=all",
  );
  assert.equal(
    nav.safeReturnTo(
      "/app/settings?id_token=x&hmac=y&session=z&timestamp=1&returnTo=%2Fapp&shop=a.myshopify.com",
    ),
    "/app/settings?shop=a.myshopify.com",
  );
  assert.equal(nav.safeReturnTo("/app/projects#top"), "/app/projects");
});

test("returnTo rejects anything outside the app", () => {
  for (const value of [
    "https://evil.example/app",
    "//evil.example/app",
    "/apps/other",
    "/application",
    "/app/../admin",
    "/app/%2e%2e/admin",
    "/app\\..\\admin",
    "/app/\nx",
    "javascript:alert(1)",
    "/auth/login",
    "",
    null,
    undefined,
    42,
    {},
    `/app/${"x".repeat(2001)}`,
  ])
    assert.equal(nav.safeReturnTo(value), null, String(value));
});

test("Plans links carry a safe screen to come back to", () => {
  assert.equal(
    nav.plansHref("/app/projects?status=IDLE"),
    "/app/plans?returnTo=%2Fapp%2Fprojects%3Fstatus%3DIDLE",
  );
  assert.equal(nav.plansHref("/app/settings"), "/app/plans?returnTo=%2Fapp%2Fsettings");
  for (const value of [null, undefined, "", "https://evil.example/app", "/app/plans", "/app/plans?billing=approved"])
    assert.equal(nav.plansHref(value), "/app/plans");
});

test("list filters reset the page, page changes keep filters, and signed values are dropped", () => {
  const current = new URLSearchParams(
    "shop=a.myshopify.com&host=abc&status=IDLE&page=3&id_token=secret",
  );
  const filtered = nav.listParams(current, { scope: "PAGE" });
  assert.equal(
    filtered.toString(),
    "shop=a.myshopify.com&host=abc&status=IDLE&scope=PAGE",
  );
  const paged = nav.listParams(filtered, { page: "2" });
  assert.equal(paged.get("page"), "2");
  assert.equal(paged.get("scope"), "PAGE");
  const cleared = nav.listParams(paged, { status: null, q: "" });
  assert.equal(cleared.has("status"), false);
  assert.equal(cleared.has("q"), false);
  assert.equal(cleared.has("page"), false);
  assert.equal(current.get("page"), "3", "the current params are not changed");
});

function navigateEvent(link) {
  const calls = [];
  return {
    calls,
    event: {
      target: {
        closest: (selector) => (selector === "[data-snapshot-back]" ? link : null),
      },
      stopImmediatePropagation: () => calls.push("stop"),
      preventDefault: () => calls.push("prevent"),
    },
  };
}
const backLink = (href) => ({
  getAttribute: (name) => (name === "href" ? href : null),
});

test("only Back links are intercepted, and they pop or replace", () => {
  let e = navigateEvent(backLink("/app/projects"));
  assert.deepEqual(nav.interceptBackNavigation(e.event, 3), { kind: "pop" });
  assert.deepEqual(e.calls, ["stop", "prevent"]);
  e = navigateEvent(backLink("/app/projects"));
  assert.deepEqual(nav.interceptBackNavigation(e.event, 0), {
    kind: "replace",
    to: "/app/projects",
  });
  e = navigateEvent(null);
  assert.equal(nav.interceptBackNavigation(e.event, 3), null);
  assert.deepEqual(e.calls, []);
  e = navigateEvent(backLink("https://evil.example/app"));
  assert.equal(nav.interceptBackNavigation(e.event, 3), null);
  assert.deepEqual(e.calls, []);
  assert.equal(
    nav.interceptBackNavigation(
      { target: null, stopImmediatePropagation() {}, preventDefault() {} },
      3,
    ),
    null,
  );
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `node --test scripts/check-navigation.mjs`
Expected: FAIL with `ENOENT: no such file or directory, open '…/app/utils/navigation.ts'`.

- [ ] **Step 4: Write the module**

Create `app/utils/navigation.ts`:

```ts
// Pure navigation rules for the redesigned screens (spec sections 4.3–4.4).
// No React or browser globals here, so node --test can call every function.

export type BackTarget = { kind: "pop" } | { kind: "replace"; to: string };

/**
 * React Router keeps each in-app history entry's position in
 * `history.state.idx`: 0 for the entry the app opened on, +1 for every push,
 * unchanged on replace. A positive index means an earlier in-app entry exists,
 * so Back pops to it. Otherwise (a bookmark, a fresh link, a reload of the
 * first entry) Back replaces this entry with the screen's parent.
 */
export function backTarget(historyIndex: unknown, parentPath: string): BackTarget {
  return typeof historyIndex === "number" &&
    Number.isInteger(historyIndex) &&
    historyIndex > 0
    ? { kind: "pop" }
    : { kind: "replace", to: parentPath };
}

// Signed launch values must never be replayed, and a returnTo never nests.
const DROPPED_PARAMS = ["id_token", "hmac", "timestamp", "session", "returnTo"];

/** An in-app path (`/app` or below) with its query, or null for anything else. */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 2000) return null;
  if (!value.startsWith("/app")) return null;
  // URL parsing would quietly drop newlines and turn \ into /, so refuse both.
  if (/[\\\u0000-\u001f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, "https://snapshot.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://snapshot.invalid") return null;
  if (url.pathname !== "/app" && !url.pathname.startsWith("/app/")) return null;
  for (const key of DROPPED_PARAMS) url.searchParams.delete(key);
  const search = url.searchParams.toString();
  return search ? `${url.pathname}?${search}` : url.pathname;
}

/** Link to Plans that brings the merchant back to `from` after upgrading (rule 5). */
export function plansHref(from?: string | null): string {
  const returnTo = safeReturnTo(from);
  if (!returnTo || returnTo === "/app/plans" || returnTo.startsWith("/app/plans?"))
    return "/app/plans";
  return `/app/plans?returnTo=${encodeURIComponent(returnTo)}`;
}

const TRANSIENT_PARAMS = ["id_token", "hmac", "timestamp", "session"];

/**
 * Search params after a list filter or page change. A filter change resets the
 * page, an empty value removes its key, and signed launch values are dropped.
 * Callers apply it with `{ replace: true }`: filters never add Back steps.
 */
export function listParams(
  current: URLSearchParams,
  changes: Record<string, string | null>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const key of TRANSIENT_PARAMS) next.delete(key);
  for (const [key, value] of Object.entries(changes)) {
    if (value == null || value === "") next.delete(key);
    else next.set(key, value);
  }
  if (!("page" in changes)) next.delete("page");
  return next;
}

export const BACK_LINK_SELECTOR = "[data-snapshot-back]";

type NavigateEventLike = {
  target: unknown;
  stopImmediatePropagation(): void;
  preventDefault(): void;
};
type LinkLike = { getAttribute(name: string): string | null };

/**
 * Polaris reports a click on a Back link (in the page or in the admin title
 * bar) as a `shopify:navigate` event on that link. For Back links this stops
 * the event, so the AppProvider does not push the parent as a new entry, and
 * returns what Back should do. Every other navigation returns null untouched.
 */
export function interceptBackNavigation(
  event: NavigateEventLike,
  historyIndex: unknown,
): BackTarget | null {
  const target = event.target as { closest?: (selector: string) => LinkLike | null } | null;
  const link = typeof target?.closest === "function" ? target.closest(BACK_LINK_SELECTOR) : null;
  const parent = safeReturnTo(link?.getAttribute("href"));
  if (!parent) return null;
  event.stopImmediatePropagation();
  event.preventDefault();
  return backTarget(historyIndex, parent);
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test scripts/check-navigation.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 6: Run the regression bar**

Run: `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt && npm run build`
Expected: `No regressions against …`. The new `check-navigation.mjs` is listed PASS, and the build succeeds.

- [ ] **Step 7: Commit**

```bash
git add app/utils/navigation.ts scripts/check-navigation.mjs docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt
git commit -m "Add the navigation rules for the redesigned screens" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Back control, Back interceptor and Polaris events

**Files:**
- Create: `app/components/polaris/navigation.tsx`
- Create: `app/components/polaris/events.ts`
- Test: `scripts/check-navigation.mjs` (append)

**Interfaces:**
- Consumes: `interceptBackNavigation`, `BACK_LINK_SELECTOR` (Task 1).
- Produces:
  - `BackAction({ parentPath: string })`, which renders `<s-link slot="breadcrumb-actions" href={parentPath} data-snapshot-back="">Back</s-link>`
  - `useBackInterceptor(): void`, installed once in `app/routes/app.tsx` (Task 5)
  - `listen(target: EventTarget | null | undefined, name: string, handler: (event: Event) => void): () => void`
  - `useElementEvent(ref: RefObject<EventTarget | null>, name: string, handler: (event: Event) => void): void`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/check-navigation.mjs`:

```js
test("the Back control sits in the title bar's breadcrumb slot and links to the parent", () => {
  const { BackAction } = loadModule("app/components/polaris/navigation.tsx", {
    "react-router": { useNavigate: () => () => {} },
  });
  assert.equal(
    renderToStaticMarkup(React.createElement(BackAction, { parentPath: "/app/projects" })),
    '<s-link slot="breadcrumb-actions" href="/app/projects" data-snapshot-back="">Back</s-link>',
  );
});

test("the Back interceptor listens in the capture phase and steps back or replaces", () => {
  const listeners = [];
  const navigations = [];
  let cleanup;
  const { useBackInterceptor } = loadModule("app/components/polaris/navigation.tsx", {
    react: { ...React, useEffect: (effect) => { cleanup = effect(); } },
    "react-router": { useNavigate: () => (...args) => navigations.push(args) },
  });
  globalThis.document = {
    addEventListener: (name, handler, capture) => listeners.push({ name, handler, capture }),
    removeEventListener: (name, handler, capture) =>
      listeners.splice(
        listeners.findIndex((entry) => entry.name === name && entry.handler === handler && entry.capture === capture),
        1,
      ),
  };
  globalThis.window = { history: { state: { idx: 2 } } };
  try {
    useBackInterceptor();
    assert.equal(listeners.length, 1);
    assert.equal(listeners[0].name, "shopify:navigate");
    assert.equal(listeners[0].capture, true);
    listeners[0].handler(navigateEvent(backLink("/app")).event);
    globalThis.window.history.state = { idx: 0 };
    listeners[0].handler(navigateEvent(backLink("/app")).event);
    listeners[0].handler(navigateEvent(null).event);
    assert.deepEqual(navigations, [[-1], ["/app", { replace: true }]]);
    cleanup();
    assert.equal(listeners.length, 0);
  } finally {
    delete globalThis.document;
    delete globalThis.window;
  }
});

test("element events subscribe and unsubscribe", () => {
  const { listen } = loadModule("app/components/polaris/events.ts");
  const target = new EventTarget();
  let calls = 0;
  const stop = listen(target, "nextpage", () => calls++);
  target.dispatchEvent(new Event("nextpage"));
  stop();
  target.dispatchEvent(new Event("nextpage"));
  assert.equal(calls, 1);
  assert.doesNotThrow(() => listen(null, "nextpage", () => {})());
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test scripts/check-navigation.mjs`
Expected: the 6 Task 1 tests PASS. The 3 new tests FAIL with `ENOENT … app/components/polaris/navigation.tsx` and `… events.ts`.

- [ ] **Step 3: Write the two modules**

Create `app/components/polaris/navigation.tsx`:

```tsx
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { interceptBackNavigation } from "../../utils/navigation";
import { useI18n } from "../../utils/i18n";

/**
 * The screen's Back control, shown in the admin title bar by s-page.
 * `parentPath` is where Back goes when the screen was opened fresh; the
 * interceptor below decides between that and a real Back step.
 */
export function BackAction({ parentPath }: { parentPath: string }) {
  const { t } = useI18n();
  return (
    <s-link slot="breadcrumb-actions" href={parentPath} data-snapshot-back="">
      {t("Back")}
    </s-link>
  );
}

function historyIndex(): unknown {
  try {
    return window.history.state?.idx;
  } catch {
    return null;
  }
}

/**
 * Polaris turns a click on an in-app link into a `shopify:navigate` event and
 * the AppProvider pushes its href. For Back links this capture listener runs
 * first, stops that push and steps back instead. Install once, in the app frame.
 */
export function useBackInterceptor() {
  const navigate = useNavigate();
  useEffect(() => {
    const onNavigate = (event: Event) => {
      const target = interceptBackNavigation(event, historyIndex());
      if (!target) return;
      if (target.kind === "pop") navigate(-1);
      else navigate(target.to, { replace: true });
    };
    document.addEventListener("shopify:navigate", onNavigate, true);
    return () => document.removeEventListener("shopify:navigate", onNavigate, true);
  }, [navigate]);
}
```

Create `app/components/polaris/events.ts`:

```ts
import { useEffect, type RefObject } from "react";

/** Adds a listener and returns its cleanup. A missing target is a no-op. */
export function listen(
  target: EventTarget | null | undefined,
  name: string,
  handler: (event: Event) => void,
) {
  if (!target) return () => {};
  target.addEventListener(name, handler);
  return () => target.removeEventListener(name, handler);
}

/**
 * Subscribes to a Polaris element's own event, such as s-table's `nextpage`.
 * React 19 turns an `onNextPage` prop into a listener for "NextPage", which
 * never fires, so these events go through a ref instead.
 */
export function useElementEvent(
  ref: RefObject<EventTarget | null>,
  name: string,
  handler: (event: Event) => void,
) {
  useEffect(() => listen(ref.current, name, handler), [ref, name, handler]);
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test scripts/check-navigation.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the regression bar and type-check the new files**

Run: `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt && npm run build && npx tsc --noEmit 2>&1 | grep -E "app/(components/polaris|utils/navigation)" ; echo "tsc-grep-exit=$?"`
Expected: `No regressions…`, a successful build, and `tsc-grep-exit=1` (no type errors in these files).

- [ ] **Step 6: Commit**

```bash
git add app/components/polaris scripts/check-navigation.mjs
git commit -m "Add the Back control and the Polaris event helper" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Plans screen (replaces Upgrade)

**Files:**
- Create: `app/utils/plans.ts`, `app/utils/plans.server.ts`, `app/routes/app.plans.tsx`
- Replace: `app/routes/app.upgrade.tsx`
- Modify: `app/routes/app.upgrade.return.tsx:22,26`, `app/components/PremiumGate.tsx:53,149`, `app/locales/catalog.ts` (append), `scripts/check-snapshot-branding.mjs:90-133,187-196`
- Test: `scripts/check-plans-settings.mjs` (create)

**Interfaces:**
- Consumes: `safeReturnTo` (Task 1), `BackAction` (Task 2).
- Produces:
  - `PRICING_PLANS: readonly PricingPlan[]`
  - `planChange(current: string, target: BillingPlanCode): "upgrade" | "switch"`
  - `startUpgrade({ storage, shop, returnTo, url, open, now? }): void`
  - `finishUpgrade({ storage, shop, billing, now? }): string | null`
  - `managedPricingUrl(shop: string): string`
  - Route `/app/plans`, which reads `?returnTo=` and `?billing=approved|not-approved`

- [ ] **Step 1: Write the failing tests**

Create `scripts/check-plans-settings.mjs`:

```js
// Plans and Settings screens (plan 2a). Read-only: mocked Shopify, billing and
// storage; never touches a database.
// Run: node --test scripts/check-plans-settings.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");

function loadModule(file, mocks = {}) {
  const filename = path.resolve(root, file);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  const load = (id) => {
    if (id in mocks) return mocks[id];
    if (!id.startsWith(".")) return require(id);
    const base = path.resolve(path.dirname(filename), id);
    const target = [`${base}.ts`, `${base}.tsx`, base].find(existsSync);
    if (!target) throw new Error(`Cannot resolve ${id} from ${file}`);
    return loadModule(path.relative(root, target), mocks);
  };
  new Function("module", "exports", "require", output)(mod, mod.exports, load);
  return mod.exports;
}

const billingAccess = {
  plan: "WHISPER",
  planName: "Whisper",
  isFree: false,
  isPaid: true,
  status: "ACTIVE",
  currentPeriodEnd: null,
  usage: { storeSnapshots: 3, normalSnapshots: 12, pageSnapshots: 10, channelSnapshots: 2, customerSnapshots: 0, abTests: 2 },
  limits: { storeSnapshots: 5, normalSnapshots: 50, maxSnapshotTargetVisitors: 5000, abTests: 5 },
  canCreateStoreSnapshot: true,
  canCreateNormalSnapshot: true,
  canCreateAbTest: true,
};
const boundaryMock = { boundary: { headers: () => new Headers() } };

function plansRoute({ data, search = "" } = {}) {
  return loadModule("app/routes/app.plans.tsx", {
    "../shopify.server": {
      authenticate: { admin: async () => ({ admin: {}, session: { shop: "owner.myshopify.com" } }) },
      isShopifyBillingTestMode: () => false,
    },
    "../utils/billing.server": {
      reconcileShopBillingFromShopify: async () => null,
      getBillingAccess: async () => billingAccess,
    },
    "@shopify/shopify-app-react-router/server": boundaryMock,
    "@shopify/app-bridge-react": { useAppBridge: () => ({ toast: { show() {} } }) },
    "react-router": {
      useLoaderData: () => data,
      useSearchParams: () => [new URLSearchParams(search)],
      useNavigate: () => () => {},
    },
  });
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test("Plans keeps prices and limits and links to Shopify's managed pricing page", async () => {
  const data = await plansRoute().loader({ request: new Request("https://app.test/app/plans") });
  assert.equal(
    data.managedPricingUrl,
    "https://admin.shopify.com/store/owner/charges/mousewhisperer/pricing_plans",
  );
  assert.deepEqual(data.usage, { store: 3, page: 12, abTests: 2 });
  const plans = loadModule("app/utils/plans.ts");
  assert.deepEqual(
    plans.PRICING_PLANS.map((plan) => [plan.name, plan.price, plan.limits.storeSnapshots, plan.limits.normalSnapshots, plan.limits.abTests, plan.limits.maxSnapshotTargetVisitors]),
    [["Whisper", "$49.99", 5, 50, 5, 5000], ["Signal", "$99.99", 20, 250, 25, 25000]],
  );
});

test("Plans shows usage, both paid plans and one primary Upgrade for a Whisper shop", async () => {
  const data = await plansRoute().loader({ request: new Request("https://app.test/app/plans") });
  const html = renderToStaticMarkup(
    React.createElement(plansRoute({ data, search: "returnTo=%2Fapp%2Fprojects" }).default),
  );
  assert.match(html, /<s-page heading="Plans">/);
  assert.match(html, /<s-link slot="breadcrumb-actions" href="\/app" data-snapshot-back="">Back<\/s-link>/);
  assert.match(html, /You&#x27;re on Whisper\. Billed by Shopify every 30 days\./);
  for (const usage of ["3 of 5", "12 of 50", "2 of 5", "Up to 5,000"]) assert.ok(html.includes(usage), usage);
  for (const text of ["$49.99", "$99.99", "20 store-level measurements", "250 page-level measurements", "Up to 25,000 visitors per measurement"])
    assert.ok(html.includes(text), text);
  assert.equal((html.match(/variant="primary"/g) || []).length, 1, "one primary button per screen");
  assert.match(html, /Upgrade to Signal/);
  assert.match(html, /<s-button disabled="">Current plan<\/s-button>/);
  assert.doesNotMatch(html, /snapshots/i, "labels say measurements, not snapshots");
});

test("Upgrade remembers a safe screen, then opens Shopify's plan page at the top", () => {
  const plans = loadModule("app/utils/plans.ts");
  const storage = memoryStorage();
  const opened = [];
  plans.startUpgrade({
    storage,
    shop: "a.myshopify.com",
    returnTo: "/app/projects?status=IDLE&id_token=x",
    url: "https://admin.shopify.com/store/a/charges/mousewhisperer/pricing_plans",
    open: (...args) => opened.push(args),
    now: 1000,
  });
  assert.deepEqual(opened, [["https://admin.shopify.com/store/a/charges/mousewhisperer/pricing_plans", "_top"]]);
  assert.deepEqual(JSON.parse(storage.getItem("snapshot_plans_return:a.myshopify.com")), {
    path: "/app/projects?status=IDLE",
    at: 1000,
  });
  plans.startUpgrade({ storage, shop: "a.myshopify.com", returnTo: "https://evil.example", url: "u", open() {}, now: 2000 });
  assert.equal(storage.getItem("snapshot_plans_return:a.myshopify.com"), null);
  const blocked = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  const openedWhileBlocked = [];
  assert.doesNotThrow(() =>
    plans.startUpgrade({ storage: blocked, shop: "a.myshopify.com", returnTo: "/app", url: "u", open: (...args) => openedWhileBlocked.push(args) }),
  );
  assert.equal(openedWhileBlocked.length, 1, "storage problems never stop the upgrade");
});

test("after Shopify's plan page, approval returns once to the saved screen", () => {
  const plans = loadModule("app/utils/plans.ts");
  const shop = "a.myshopify.com";
  const key = "snapshot_plans_return:a.myshopify.com";
  const storage = memoryStorage();
  storage.setItem(key, JSON.stringify({ path: "/app/settings", at: 1000 }));
  assert.equal(plans.finishUpgrade({ storage, shop, billing: null, now: 2000 }), null);
  assert.notEqual(storage.getItem(key), null, "an ordinary visit keeps the saved screen");
  assert.equal(plans.finishUpgrade({ storage, shop, billing: "approved", now: 2000 }), "/app/settings");
  assert.equal(plans.finishUpgrade({ storage, shop, billing: "approved", now: 2000 }), null, "only once");
  storage.setItem(key, JSON.stringify({ path: "/app/settings", at: 1000 }));
  assert.equal(plans.finishUpgrade({ storage, shop, billing: "not-approved", now: 2000 }), null);
  assert.equal(storage.getItem(key), null, "a declined charge forgets the screen");
  storage.setItem(key, JSON.stringify({ path: "/app/settings", at: 1000 }));
  assert.equal(plans.finishUpgrade({ storage, shop, billing: "approved", now: 1000 + 60 * 60 * 1000 + 1 }), null, "stale");
  storage.setItem(key, JSON.stringify({ path: "https://evil.example", at: 1000 }));
  assert.equal(plans.finishUpgrade({ storage, shop, billing: "approved", now: 2000 }), null, "unsafe");
  storage.setItem(key, "not json");
  assert.equal(plans.finishUpgrade({ storage, shop, billing: "approved", now: 2000 }), null);
  assert.equal(plans.finishUpgrade({ storage: null, shop, billing: "approved" }), null);
});

test("plan buttons say upgrade for a higher plan and switch otherwise", () => {
  const plans = loadModule("app/utils/plans.ts");
  assert.equal(plans.planChange("FREE", "WHISPER"), "upgrade");
  assert.equal(plans.planChange("WHISPER", "SIGNAL"), "upgrade");
  assert.equal(plans.planChange("SIGNAL", "WHISPER"), "switch");
  assert.equal(plans.planChange("PRO", "SIGNAL"), "switch");
  assert.equal(plans.planChange("UNKNOWN", "WHISPER"), "upgrade");
});

test("the retired /app/upgrade keeps its query and billing returns land on Plans", async () => {
  const upgrade = loadModule("app/routes/app.upgrade.tsx");
  const moved = await upgrade.loader({
    request: new Request("https://app.test/app/upgrade?billing=approved&shop=a.myshopify.com"),
  });
  assert.equal(moved.status, 302);
  assert.equal(moved.headers.get("Location"), "/app/plans?billing=approved&shop=a.myshopify.com");
  for (const [subscriptions, expected] of [
    [[{ name: "Signal" }], "/app/plans?billing=approved"],
    [[], "/app/plans?billing=not-approved"],
  ]) {
    const back = loadModule("app/routes/app.upgrade.return.tsx", {
      "../shopify.server": {
        authenticate: {
          admin: async () => ({
            session: { shop: "a.myshopify.com" },
            billing: { check: async () => ({ appSubscriptions: subscriptions }) },
          }),
        },
        isShopifyBillingTestMode: () => true,
      },
      "../utils/billing.server": { syncShopBillingFromSubscription: async () => null },
      "@shopify/shopify-app-react-router/server": boundaryMock,
    });
    const response = await back.loader({ request: new Request("https://app.test/app/upgrade/return") });
    assert.equal(response.headers.get("Location"), expected);
  }
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test scripts/check-plans-settings.mjs`
Expected: FAIL. The first tests fail with `ENOENT … app/routes/app.plans.tsx` or `… app/utils/plans.ts`, and the redirect test fails because `/app/upgrade` still renders a page (`upgrade.loader` calls `authenticate`, which is not mocked).

- [ ] **Step 3: Write the plan data and pricing URL**

Create `app/utils/plans.ts`:

```ts
import {
  PLAN_LIMITS,
  SIGNAL_PLAN,
  WHISPER_PLAN,
  type BillingLimits,
  type BillingPlanCode,
} from "./billing-plans";
import { safeReturnTo } from "./navigation";

export type PricingPlan = {
  shopifyPlan: string;
  billingPlan: "WHISPER" | "SIGNAL";
  name: string;
  tagline: string;
  price: string;
  compareAt: string;
  recommended: boolean;
  limits: BillingLimits;
};

// Prices and limits are unchanged by the redesign (spec section 2).
export const PRICING_PLANS: readonly PricingPlan[] = [
  {
    shopifyPlan: WHISPER_PLAN,
    billingPlan: "WHISPER",
    name: "Whisper",
    tagline: "For stores moving from first audits into repeat page testing.",
    price: "$49.99",
    compareAt: "$79",
    recommended: false,
    limits: PLAN_LIMITS.WHISPER,
  },
  {
    shopifyPlan: SIGNAL_PLAN,
    billingPlan: "SIGNAL",
    name: "Signal",
    tagline: "For teams using Snapshot as a decision engine.",
    price: "$99.99",
    compareAt: "$149",
    recommended: true,
    limits: PLAN_LIMITS.SIGNAL,
  },
];

const PLAN_RANK: Record<BillingPlanCode, number> = {
  FREE: 0,
  WHISPER: 1,
  STARTER: 1,
  SIGNAL: 2,
  GROWTH: 3,
  PRO: 4,
};

/** "upgrade" when `target` is above the current plan, otherwise "switch". */
export function planChange(current: string, target: BillingPlanCode): "upgrade" | "switch" {
  const from = PLAN_RANK[current as BillingPlanCode] ?? 0;
  return PLAN_RANK[target] > from ? "upgrade" : "switch";
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const RETURN_KEY = "snapshot_plans_return:";
const RETURN_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Leaves for Shopify's plan page after noting the screen to come back to.
 * Runs inside the click handler, so the top-level navigation keeps the
 * merchant's click (browsers block it after an async gap).
 */
export function startUpgrade({
  storage,
  shop,
  returnTo,
  url,
  open,
  now = Date.now(),
}: {
  storage: StorageLike | null;
  shop: string;
  returnTo: string | null;
  url: string;
  open: (url: string, target: string) => unknown;
  now?: number;
}) {
  const path = safeReturnTo(returnTo);
  try {
    if (storage && path) storage.setItem(RETURN_KEY + shop, JSON.stringify({ path, at: now }));
    else storage?.removeItem(RETURN_KEY + shop);
  } catch {
    // Storage is optional: without it the merchant lands on Plans (spec 4.4).
  }
  open(url, "_top");
}

/**
 * After Shopify's plan page: the screen to return to when billing was
 * approved, otherwise null. Either outcome forgets the saved screen; an
 * ordinary visit (no `billing` param) leaves it alone.
 */
export function finishUpgrade({
  storage,
  shop,
  billing,
  now = Date.now(),
}: {
  storage: StorageLike | null;
  shop: string;
  billing: string | null;
  now?: number;
}): string | null {
  if (billing !== "approved" && billing !== "not-approved") return null;
  try {
    const raw = storage?.getItem(RETURN_KEY + shop) ?? null;
    storage?.removeItem(RETURN_KEY + shop);
    if (billing !== "approved" || !raw) return null;
    const saved = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof saved.at !== "number" || saved.at > now || now - saved.at > RETURN_MAX_AGE_MS)
      return null;
    return safeReturnTo(saved.path);
  } catch {
    return null;
  }
}
```

Create `app/utils/plans.server.ts`:

```ts
export const DEFAULT_MANAGED_PRICING_APP_HANDLE = "mousewhisperer";

/** Shopify's managed pricing page for this app, in the shop's admin. */
export function managedPricingUrl(shop: string) {
  const storeHandle = shop.replace(".myshopify.com", "");
  const appHandle =
    process.env.SHOPIFY_MANAGED_PRICING_APP_HANDLE || DEFAULT_MANAGED_PRICING_APP_HANDLE;
  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
}
```

- [ ] **Step 4: Write the Plans screen**

Create `app/routes/app.plans.tsx`:

```tsx
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, isShopifyBillingTestMode } from "../shopify.server";
import { getBillingAccess, reconcileShopBillingFromShopify } from "../utils/billing.server";
import { PLAN_LIMITS } from "../utils/billing-plans";
import {
  finishUpgrade,
  planChange,
  PRICING_PLANS,
  startUpgrade,
  type PricingPlan,
} from "../utils/plans";
import { managedPricingUrl } from "../utils/plans.server";
import { safeReturnTo } from "../utils/navigation";
import { BackAction } from "../components/polaris/navigation";
import { useI18n } from "../utils/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await reconcileShopBillingFromShopify(admin, session.shop);
  const access = await getBillingAccess(session.shop);
  return {
    shop: session.shop,
    plan: access.plan,
    planName: access.planName,
    isFree: access.isFree,
    usage: {
      store: access.usage.storeSnapshots,
      page: access.usage.normalSnapshots,
      abTests: access.usage.abTests,
    },
    limits: access.limits,
    freeLimits: PLAN_LIMITS.FREE,
    billingTestMode: isShopifyBillingTestMode(),
    managedPricingUrl: managedPricingUrl(session.shop),
  };
};

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function Plans() {
  const data = useLoaderData<typeof loader>();
  const { t, formatNumber } = useI18n();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const billing = params.get("billing");
  const returnTo = safeReturnTo(params.get("returnTo"));

  // Rule 5: after an approved upgrade, go back to the screen it started from.
  useEffect(() => {
    const back = finishUpgrade({ storage: browserStorage(), shop: data.shop, billing });
    if (!back) return;
    shopify.toast.show(t("Plan updated"));
    navigate(back, { replace: true });
  }, [billing, data.shop, navigate, shopify, t]);

  function upgrade() {
    startUpgrade({
      storage: browserStorage(),
      shop: data.shop,
      returnTo,
      url: data.managedPricingUrl,
      open: (url, target) => window.open(url, target),
    });
  }

  return (
    <s-page heading={t("Plans")}>
      <BackAction parentPath="/app" />
      <s-stack gap="base">
        {billing === "approved" && (
          <s-banner tone="success" heading={t("Billing approved")}>
            {t("Your plan is active. The new limits are available now.")}
          </s-banner>
        )}
        {billing === "not-approved" && (
          <s-banner tone="warning" heading={t("Billing was not completed")}>
            {t("Shopify did not return an active subscription. Choose a plan again when you're ready.")}
          </s-banner>
        )}
        {data.billingTestMode && (
          <s-banner tone="info" heading={t("Billing test mode is on")}>
            {t("Shopify creates test subscriptions in this environment.")}
          </s-banner>
        )}
        <s-banner tone={data.isFree ? "info" : "success"}>
          {data.isFree
            ? t("You're on the Free plan.")
            : t("You're on {plan}. Billed by Shopify every 30 days.", { plan: data.planName })}
        </s-banner>
        <s-section heading={t("Your usage")}>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
            <UsageTile label={t("Store-level measurements")} used={data.usage.store} limit={data.limits.storeSnapshots} />
            <UsageTile label={t("Page-level measurements")} used={data.usage.page} limit={data.limits.normalSnapshots} />
            <UsageTile label={t("A/B tests")} used={data.usage.abTests} limit={data.limits.abTests} />
            <s-box border="base" borderRadius="base" padding="base">
              <s-stack gap="small-200">
                <s-text color="subdued">{t("Visitor target")}</s-text>
                <s-text type="strong">
                  {t("Up to {count}", { count: formatNumber(data.limits.maxSnapshotTargetVisitors) })}
                </s-text>
                <s-text color="subdued">{t("per measurement")}</s-text>
              </s-stack>
            </s-box>
          </s-grid>
        </s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap="base">
          {PRICING_PLANS.map((plan) => (
            <PlanCard key={plan.billingPlan} plan={plan} currentPlan={data.plan} onUpgrade={upgrade} />
          ))}
        </s-grid>
        <s-section heading={t("Free")}>
          <s-paragraph>
            {t("{store} store-level and {page} page-level measurements, up to {visitors} visitors each, no A/B tests.", {
              store: formatNumber(data.freeLimits.storeSnapshots),
              page: formatNumber(data.freeLimits.normalSnapshots),
              visitors: formatNumber(data.freeLimits.maxSnapshotTargetVisitors),
            })}
          </s-paragraph>
        </s-section>
        <s-paragraph color="subdued">
          {t("Upgrade opens Shopify's plan page. When you confirm, you come back to the screen where you clicked Upgrade.")}
        </s-paragraph>
      </s-stack>
    </s-page>
  );
}

function UsageTile({ label, used, limit }: { label: string; used: number; limit: number }) {
  const { t, formatNumber } = useI18n();
  return (
    <s-box border="base" borderRadius="base" padding="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-text type="strong">
          {t("{used} of {limit}", { used: formatNumber(used), limit: formatNumber(limit) })}
        </s-text>
        <s-progress value={Math.min(used, limit)} max={Math.max(limit, 1)} accessibilityLabel={label} />
      </s-stack>
    </s-box>
  );
}

function PlanCard({
  plan,
  currentPlan,
  onUpgrade,
}: {
  plan: PricingPlan;
  currentPlan: string;
  onUpgrade: () => void;
}) {
  const { t, formatNumber } = useI18n();
  const current = currentPlan === plan.billingPlan;
  const change = planChange(currentPlan, plan.billingPlan);
  return (
    <s-section heading={plan.name}>
      <s-stack gap="base">
        {current ? (
          <s-badge tone="success">{t("Current plan")}</s-badge>
        ) : plan.recommended ? (
          <s-badge tone="info">{t("Recommended")}</s-badge>
        ) : null}
        <s-paragraph color="subdued">{t(plan.tagline)}</s-paragraph>
        <s-paragraph>
          <s-text type="strong">{plan.price}</s-text>{" "}
          <s-text color="subdued" type="redundant">{plan.compareAt}</s-text>{" "}
          <s-text color="subdued">{t("every 30 days")}</s-text>
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>{t("{count} store-level measurements", { count: formatNumber(plan.limits.storeSnapshots) })}</s-list-item>
          <s-list-item>{t("{count} page-level measurements", { count: formatNumber(plan.limits.normalSnapshots) })}</s-list-item>
          <s-list-item>{t("{count} A/B tests", { count: formatNumber(plan.limits.abTests) })}</s-list-item>
          <s-list-item>
            {t("Up to {count} visitors per measurement", { count: formatNumber(plan.limits.maxSnapshotTargetVisitors) })}
          </s-list-item>
        </s-unordered-list>
        {current ? (
          <s-button disabled>{t("Current plan")}</s-button>
        ) : (
          <s-button variant={plan.recommended ? "primary" : "secondary"} onClick={onUpgrade}>
            {change === "upgrade"
              ? t("Upgrade to {plan}", { plan: plan.name })
              : t("Switch to {plan}", { plan: plan.name })}
          </s-button>
        )}
      </s-stack>
    </s-section>
  );
}

// Single fetch applies route headers to data requests too; Shopify needs
// them so App Bridge can re-authenticate an expired session.
export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
```

- [ ] **Step 5: Retire `/app/upgrade` and point billing returns at Plans**

Replace the whole of `app/routes/app.upgrade.tsx` with:

```tsx
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

// Retired address (spec 4.2): bookmarks and older links land on Plans with
// their query (billing status, embedded params) kept.
export const loader = ({ request }: LoaderFunctionArgs) =>
  redirect(`/app/plans${new URL(request.url).search}`);
```

In `app/routes/app.upgrade.return.tsx`, change the two redirects:

```tsx
  if (!subscription) {
    return redirect("/app/plans?billing=not-approved");
  }

  await syncShopBillingFromSubscription(session.shop, subscription);
  return redirect("/app/plans?billing=approved");
```

In `app/components/PremiumGate.tsx`, change both default props, at lines 53 and 149, from `url = "/app/upgrade",` to:

```tsx
  url = "/app/plans",
```

- [ ] **Step 6: Add the Plans strings**

Append these entries to `app/locales/catalog.ts`, directly above its final `};`:

```ts
  Plans: ["Tarife", "套餐", "方案"],
  "Plan updated": ["Tarif aktualisiert", "套餐已更新", "方案已更新"],
  "Billing approved": ["Abrechnung bestätigt", "账单已批准", "帳單已核准"],
  "Your plan is active. The new limits are available now.": [
    "Ihr Tarif ist aktiv. Die neuen Limits sind ab sofort verfügbar.",
    "您的套餐已生效，新的额度现已可用。",
    "您的方案已生效，新的額度現已可用。",
  ],
  "Billing was not completed": ["Die Abrechnung wurde nicht abgeschlossen", "账单未完成", "帳單未完成"],
  "Shopify did not return an active subscription. Choose a plan again when you're ready.": [
    "Shopify hat kein aktives Abonnement zurückgegeben. Wählen Sie erneut einen Tarif, wenn Sie bereit sind.",
    "Shopify 未返回有效订阅。准备好后请重新选择套餐。",
    "Shopify 未傳回有效訂閱。準備好後請重新選擇方案。",
  ],
  "Billing test mode is on": ["Abrechnungs-Testmodus ist aktiv", "账单测试模式已开启", "帳單測試模式已開啟"],
  "Shopify creates test subscriptions in this environment.": [
    "Shopify erstellt in dieser Umgebung Testabonnements.",
    "Shopify 会在此环境中创建测试订阅。",
    "Shopify 會在此環境中建立測試訂閱。",
  ],
  "You're on the Free plan.": ["Sie nutzen den kostenlosen Tarif.", "您当前使用免费套餐。", "您目前使用免費方案。"],
  "You're on {plan}. Billed by Shopify every 30 days.": [
    "Sie nutzen {plan}. Abrechnung über Shopify alle 30 Tage.",
    "您当前使用 {plan}，由 Shopify 每 30 天计费一次。",
    "您目前使用 {plan}，由 Shopify 每 30 天計費一次。",
  ],
  "Your usage": ["Ihre Nutzung", "您的用量", "您的用量"],
  "Store-level measurements": ["Shopweite Messungen", "商店级别测量", "商店層級測量"],
  "Page-level measurements": ["Seitenmessungen", "页面级别测量", "頁面層級測量"],
  "{used} of {limit}": ["{used} von {limit}", "{used} / {limit}", "{used} / {limit}"],
  "Up to {count}": ["Bis zu {count}", "最多 {count}", "最多 {count}"],
  "per measurement": ["pro Messung", "每次测量", "每次測量"],
  "For stores moving from first audits into repeat page testing.": [
    "Für Shops, die von ersten Analysen zu regelmäßigen Seitentests übergehen.",
    "适合从初次审查转向定期页面测试的商店。",
    "適合從初次審查轉向定期頁面測試的商店。",
  ],
  "For teams using Snapshot as a decision engine.": [
    "Für Teams, die Snapshot als Entscheidungsgrundlage nutzen.",
    "适合将 Snapshot 作为决策引擎的团队。",
    "適合將 Snapshot 作為決策引擎的團隊。",
  ],
  "every 30 days": ["alle 30 Tage", "每 30 天", "每 30 天"],
  "Current plan": ["Aktueller Tarif", "当前套餐", "目前方案"],
  Recommended: ["Empfohlen", "推荐", "推薦"],
  "{count} store-level measurements": ["{count} shopweite Messungen", "{count} 次商店级别测量", "{count} 次商店層級測量"],
  "{count} page-level measurements": ["{count} Seitenmessungen", "{count} 次页面级别测量", "{count} 次頁面層級測量"],
  "{count} A/B tests": ["{count} A/B-Tests", "{count} 个 A/B 测试", "{count} 個 A/B 測試"],
  "Up to {count} visitors per measurement": [
    "Bis zu {count} Besucher pro Messung",
    "每次测量最多 {count} 位访客",
    "每次測量最多 {count} 位訪客",
  ],
  "Upgrade to {plan}": ["Auf {plan} upgraden", "升级到 {plan}", "升級至 {plan}"],
  "Switch to {plan}": ["Zu {plan} wechseln", "切换到 {plan}", "切換至 {plan}"],
  Free: ["Kostenlos", "免费", "免費"],
  "{store} store-level and {page} page-level measurements, up to {visitors} visitors each, no A/B tests.": [
    "{store} shopweite und {page} Seitenmessungen mit jeweils bis zu {visitors} Besuchern, keine A/B-Tests.",
    "{store} 次商店级别测量和 {page} 次页面级别测量，每次最多 {visitors} 位访客，不含 A/B 测试。",
    "{store} 次商店層級測量和 {page} 次頁面層級測量，每次最多 {visitors} 位訪客，不含 A/B 測試。",
  ],
  "Upgrade opens Shopify's plan page. When you confirm, you come back to the screen where you clicked Upgrade.": [
    "„Upgraden“ öffnet die Tarifseite von Shopify. Nach der Bestätigung kehren Sie zu dem Bildschirm zurück, auf dem Sie geklickt haben.",
    "升级会打开 Shopify 的套餐页面。确认后，您将返回点击升级时所在的页面。",
    "升級會開啟 Shopify 的方案頁面。確認後，您將返回點擊升級時所在的頁面。",
  ],
```

- [ ] **Step 7: Point the branding check at the new files**

In `scripts/check-snapshot-branding.mjs`, inside the test "active UI, onboarding, analytics messages, and generated reports use the new app name", replace the surface entry `"app/routes/app.upgrade.tsx",` with:

```js
    "app/utils/plans.ts",
```

In the test "paid plan names, prices, managed-pricing handle, and persisted model identities remain unchanged", replace the four lines starting `const upgrade = read("app/routes/app.upgrade.tsx");` with:

```js
  const plansData = read("app/utils/plans.ts");
  assert.ok(plansData.includes('price: "$49.99"'));
  assert.ok(plansData.includes('price: "$99.99"'));
  assert.ok(
    read("app/utils/plans.server.ts").includes('DEFAULT_MANAGED_PRICING_APP_HANDLE = "mousewhisperer"'),
  );
```

- [ ] **Step 8: Run the tests to see them pass**

Run: `node --test scripts/check-plans-settings.mjs && node --test scripts/check-snapshot-branding.mjs && node --test scripts/check-i18n.mjs`
Expected: PASS, PASS, PASS. `check-plans-settings.mjs` reports 6 tests.

- [ ] **Step 9: Run the regression bar and type-check**

Run: `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt && npm run build && npx tsc --noEmit 2>&1 | grep -E "app/(routes/app\.(plans|upgrade)|utils/plans|components/PremiumGate)" ; echo "tsc-grep-exit=$?"`
Expected: `No regressions…`, a successful build, and `tsc-grep-exit=1`. If tsc names a Polaris prop value (for example a `borderRadius` keyword), use one the error message lists, then rerun.

- [ ] **Step 10: Commit**

```bash
git add app/utils/plans.ts app/utils/plans.server.ts app/routes/app.plans.tsx app/routes/app.upgrade.tsx app/routes/app.upgrade.return.tsx app/components/PremiumGate.tsx app/locales/catalog.ts scripts/check-plans-settings.mjs scripts/check-snapshot-branding.mjs
git commit -m "Replace Upgrade with a Polaris Plans screen that returns you to where you started" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Settings screen

**Files:**
- Modify: `app/utils/web-pixel.server.ts` (add `getWebPixelStatus`), `app/routes/api.storefront-tracker-status.tsx`, `app/components/LanguageMenu.tsx`, `app/locales/catalog.ts` (append)
- Create: `app/routes/app.settings.tsx`
- Test: `scripts/check-plans-settings.mjs` (append)

**Interfaces:**
- Consumes: `plansHref` (Task 1), `PRICING_PLANS` (Task 3), `trackerEditorUrl(shop, apiKey)` (existing, `app/utils/snapshot-setup.ts`), `useBackgroundJson` (existing), `getBillingDisplayAccess` (existing).
- Produces:
  - `type WebPixelStatus = "active" | "missing" | "unknown"`
  - `getWebPixelStatus(admin): Promise<WebPixelStatus>`
  - `/api/storefront-tracker-status` returns `{ trackerStatus, pixelStatus }`
  - `useLanguageSwitch(): { locale: AppLocale; change(next: AppLocale): void }`
  - Route `/app/settings`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/check-plans-settings.mjs`:

```js
test("the pixel status only reads: active, missing or unknown", async () => {
  const pixel = loadModule("app/utils/web-pixel.server.ts");
  const queries = [];
  const admin = (payload, ok = true) => ({
    graphql: async (query) => {
      queries.push(query);
      if (payload instanceof Error) throw payload;
      return new Response(JSON.stringify(payload), { status: ok ? 200 : 500 });
    },
  });
  assert.equal(await pixel.getWebPixelStatus(admin({ data: { webPixel: { id: "gid://shopify/WebPixel/1", settings: "{}" } } })), "active");
  assert.equal(await pixel.getWebPixelStatus(admin({ data: { webPixel: null } })), "missing");
  assert.equal(await pixel.getWebPixelStatus(admin({ errors: [{ message: "denied" }] })), "unknown");
  assert.equal(await pixel.getWebPixelStatus(admin({}, false)), "unknown");
  assert.equal(await pixel.getWebPixelStatus(admin(new Error("offline"))), "unknown");
  assert.ok(queries.every((query) => /query CurrentAppWebPixel/.test(query) && !/mutation/.test(query)));
});

test("the tracking status API answers with the theme embed and the pixel together", async () => {
  const route = loadModule("app/routes/api.storefront-tracker-status.tsx", {
    "../shopify.server": { authenticate: { admin: async () => ({ admin: {}, session: { shop: "a.myshopify.com" } }) } },
    "../utils/storefront-tracker-status.server": {
      getStorefrontTrackerStatus: async () => ({ status: "active", storefrontUrl: "https://a.example", checkedAt: "2026-11-06T00:00:00.000Z", message: "" }),
    },
    "../utils/web-pixel.server": { getWebPixelStatus: async () => "missing" },
    "../utils/loader-cache.server": { cachedValue: async (_key, _ttl, load) => load() },
    "@shopify/shopify-app-react-router/server": boundaryMock,
  });
  const body = await (await route.loader({ request: new Request("https://app.test/api/storefront-tracker-status") })).json();
  assert.equal(body.trackerStatus.status, "active");
  assert.equal(body.pixelStatus, "missing");
});

function settingsRoute(tracking) {
  let loaderData;
  const route = loadModule("app/routes/app.settings.tsx", {
    "../shopify.server": { authenticate: { admin: async () => ({ session: { shop: "a.myshopify.com" } }) } },
    "../utils/billing.server": { getBillingDisplayAccess: async () => billingAccess },
    "@shopify/shopify-app-react-router/server": boundaryMock,
    "../utils/background-json": { useBackgroundJson: () => tracking },
    "../components/LanguageMenu": { useLanguageSwitch: () => ({ locale: "de", change() {} }) },
    "react-router": { useLoaderData: () => loaderData, useNavigate: () => () => {} },
  });
  return {
    async html() {
      loaderData = await route.loader({ request: new Request("https://app.test/app/settings") });
      return renderToStaticMarkup(React.createElement(route.default));
    },
  };
}

test("Settings shows tracking, language and plan, with a warning when the embed is off", async () => {
  process.env.SHOPIFY_API_KEY = "test-key";
  const html = await settingsRoute({
    data: {
      trackerStatus: { status: "missing", storefrontUrl: "https://a.example", checkedAt: "2026-11-06T00:00:00.000Z", message: "" },
      pixelStatus: "active",
    },
    loading: false,
    error: null,
    reload() {},
  }).html();
  assert.match(html, /<s-page heading="Settings">/);
  assert.doesNotMatch(html, /breadcrumb-actions/, "Settings is a top-level screen");
  assert.match(html, /Snapshot Tracker must be turned on in your theme\./);
  assert.match(html, /<s-badge tone="warning">Not active<\/s-badge>/);
  assert.match(html, /<s-badge tone="success">Active<\/s-badge>/);
  assert.match(
    html,
    /href="https:\/\/a\.myshopify\.com\/admin\/themes\/current\/editor\?context=apps&amp;activateAppId=test-key%2Ftracker" target="_blank"/,
  );
  assert.match(html, /<s-select label="Language" value="de"/);
  for (const label of ["English", "Deutsch", "简体中文", "繁體中文"]) assert.ok(html.includes(label), label);
  assert.ok(html.includes("Whisper · $49.99 every 30 days"));
  assert.ok(html.includes("3 of 5 store-level and 12 of 50 page-level measurements used · 2 of 5 A/B tests"));
  assert.match(html, /href="\/app\/plans\?returnTo=%2Fapp%2Fsettings"/);
});

test("Settings says Checking… while the status loads and offers Retry when it fails", async () => {
  const loading = await settingsRoute({ data: undefined, loading: true, error: null, reload() {} }).html();
  assert.equal((loading.match(/Checking…/g) || []).length, 2);
  assert.doesNotMatch(loading, /must be turned on/);
  const failed = await settingsRoute({ data: undefined, loading: false, error: "Tracking status is temporarily unavailable.", reload() {} }).html();
  assert.equal((failed.match(/Unavailable/g) || []).length, 2);
  assert.match(failed, />Retry<\/s-button>/);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test scripts/check-plans-settings.mjs`
Expected: the 6 Task 3 tests PASS. The new tests FAIL with `pixel.getWebPixelStatus is not a function`, `body.pixelStatus` undefined, and `ENOENT … app/routes/app.settings.tsx`.

- [ ] **Step 3: Add the read-only pixel status**

Append to `app/utils/web-pixel.server.ts`:

```ts
export type WebPixelStatus = "active" | "missing" | "unknown";

/**
 * Whether this app's web pixel exists on the shop. Read-only: it never creates
 * or updates the pixel (that happens when a measurement starts).
 */
export async function getWebPixelStatus(
  admin: ShopifyAdminClient,
): Promise<WebPixelStatus> {
  try {
    return (await currentPixel(admin)) ? "active" : "missing";
  } catch {
    return "unknown";
  }
}
```

In `app/routes/api.storefront-tracker-status.tsx`, add the import below the existing `getStorefrontTrackerStatus` import:

```tsx
import { getWebPixelStatus } from "../utils/web-pixel.server";
```

and replace the body of `loader` after `authenticate.admin` with:

```tsx
  const [trackerStatus, pixelStatus] = await Promise.all([
    cachedValue(`tracker-status:${session.shop}`, 60_000, () =>
      getStorefrontTrackerStatus(admin, session.shop),
    ),
    cachedValue(`pixel-status:${session.shop}`, 60_000, () =>
      getWebPixelStatus(admin),
    ),
  ]);
  return Response.json(
    { trackerStatus, pixelStatus },
    { headers: { "Cache-Control": "private, no-store" } },
  );
```

- [ ] **Step 4: Extract the language switch**

Replace the whole of `app/components/LanguageMenu.tsx` with:

```tsx
import { useFetcher, useLocation } from "react-router";
import type { action as localeAction } from "../routes/api.locale";
import {
  useI18n,
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  type AppLocale,
} from "../utils/i18n";

/** Switches the app language now and saves it for this store. */
export function useLanguageSwitch() {
  const { locale, setLocale } = useI18n();
  const fetcher = useFetcher<typeof localeAction>();
  const location = useLocation();
  return {
    locale,
    change(next: AppLocale) {
      if (!SUPPORTED_LOCALES.includes(next)) return;
      setLocale(next);
      fetcher.submit(
        { locale: next },
        { method: "post", action: `/api/locale${location.search}` },
      );
    },
  };
}

/** Page secondary-action group used by screens still on Polaris React. */
export function useLanguageActionGroup() {
  const { t } = useI18n();
  const { locale, change } = useLanguageSwitch();
  return {
    title: `${t("Language")}: ${LOCALE_LABELS[locale]}`,
    actions: SUPPORTED_LOCALES.map((option: AppLocale) => ({
      content: LOCALE_LABELS[option],
      active: option === locale,
      onAction: () => change(option),
    })),
  };
}
```

- [ ] **Step 5: Write the Settings screen**

Create `app/routes/app.settings.tsx`:

```tsx
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getBillingDisplayAccess } from "../utils/billing.server";
import { trackerEditorUrl } from "../utils/snapshot-setup";
import { PRICING_PLANS } from "../utils/plans";
import { plansHref } from "../utils/navigation";
import { useBackgroundJson } from "../utils/background-json";
import { useLanguageSwitch } from "../components/LanguageMenu";
import { LOCALE_LABELS, SUPPORTED_LOCALES, useI18n, type AppLocale } from "../utils/i18n";
import type { StorefrontTrackerStatus } from "../utils/storefront-tracker-status.server";
import type { WebPixelStatus } from "../utils/web-pixel.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const access = await getBillingDisplayAccess(session.shop);
  return {
    editorUrl: trackerEditorUrl(session.shop, process.env.SHOPIFY_API_KEY || ""),
    plan: {
      code: access.plan,
      name: access.planName,
      isFree: access.isFree,
      usage: {
        store: access.usage.storeSnapshots,
        page: access.usage.normalSnapshots,
        abTests: access.usage.abTests,
      },
      limits: {
        store: access.limits.storeSnapshots,
        page: access.limits.normalSnapshots,
        abTests: access.limits.abTests,
      },
    },
  };
};

type SettingsPlan = Awaited<ReturnType<typeof loader>>["plan"];
type Status = "active" | "missing" | "unknown";
type TrackingPayload = { trackerStatus: StorefrontTrackerStatus; pixelStatus: WebPixelStatus };
const STATES: readonly string[] = ["active", "missing", "unknown"];

function isTrackingPayload(value: unknown): value is TrackingPayload {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<TrackingPayload>;
  return Boolean(
    data.trackerStatus &&
      STATES.includes(data.trackerStatus.status) &&
      typeof data.trackerStatus.storefrontUrl === "string" &&
      STATES.includes(String(data.pixelStatus)),
  );
}

export default function Settings() {
  const { editorUrl, plan } = useLoaderData<typeof loader>();
  const { t } = useI18n();
  return (
    <s-page heading={t("Settings")}>
      <s-stack gap="base">
        <TrackingSection editorUrl={editorUrl} />
        <LanguageSection />
        <PlanSection plan={plan} />
      </s-stack>
    </s-page>
  );
}

const BADGES = {
  active: { label: "Active", tone: "success" },
  missing: { label: "Not active", tone: "warning" },
  unknown: { label: "Not verified", tone: "neutral" },
} as const;

function StatusBadge({ status, loading, failed }: { status?: Status; loading: boolean; failed: boolean }) {
  const { t } = useI18n();
  if (status) return <s-badge tone={BADGES[status].tone}>{t(BADGES[status].label)}</s-badge>;
  return <s-badge>{t(failed ? "Unavailable" : loading ? "Checking…" : "Not verified")}</s-badge>;
}

function TrackingSection({ editorUrl }: { editorUrl: string | null }) {
  const { t } = useI18n();
  const { data, loading, error, reload } = useBackgroundJson({
    path: "/api/storefront-tracker-status",
    isData: isTrackingPayload,
    errorMessage: "Tracking status is temporarily unavailable.",
  });
  const embed = data?.trackerStatus.status;
  const pixel = data?.pixelStatus;
  const failed = Boolean(error);
  return (
    <s-section heading={t("Storefront tracking")}>
      <s-stack gap="base">
        <s-paragraph color="subdued">
          {t("Snapshot needs both parts on to record visits, add-to-cart and checkout.")}
        </s-paragraph>
        {embed === "missing" && (
          <s-banner tone="warning">{t("Snapshot Tracker must be turned on in your theme.")}</s-banner>
        )}
        <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
          <s-stack gap="small-500">
            <s-text type="strong">{t("Snapshot Tracker")}</s-text>
            <s-text color="subdued">
              {t("Theme app embed in your live theme. Records page views, clicks and scrolling.")}
            </s-text>
          </s-stack>
          <s-stack direction="inline" gap="small" alignItems="center">
            <StatusBadge status={embed} loading={loading} failed={failed} />
            {editorUrl && (
              <s-button href={editorUrl} target="_blank">
                {t("Open theme editor")}
              </s-button>
            )}
          </s-stack>
        </s-stack>
        <s-divider />
        <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
          <s-stack gap="small-500">
            <s-text type="strong">{t("Web pixel")}</s-text>
            <s-text color="subdued">
              {t("Records add-to-cart, checkout and purchases. Turned on automatically when a measurement starts.")}
            </s-text>
          </s-stack>
          <StatusBadge status={pixel} loading={loading} failed={failed} />
        </s-stack>
        {(failed || embed === "unknown" || pixel === "unknown") && (
          <s-button variant="tertiary" onClick={() => reload()} loading={loading}>
            {t("Retry")}
          </s-button>
        )}
      </s-stack>
    </s-section>
  );
}

function LanguageSection() {
  const { t } = useI18n();
  const { locale, change } = useLanguageSwitch();
  return (
    <s-section heading={t("Language")}>
      <s-select
        label={t("Language")}
        value={locale}
        details={t("Applies to Snapshot only. Your Shopify admin language stays the same.")}
        onChange={(event) =>
          change(String((event.currentTarget as unknown as { value: string }).value) as AppLocale)
        }
      >
        {SUPPORTED_LOCALES.map((option) => (
          <s-option key={option} value={option}>
            {LOCALE_LABELS[option]}
          </s-option>
        ))}
      </s-select>
    </s-section>
  );
}

function PlanSection({ plan }: { plan: SettingsPlan }) {
  const { t, formatNumber: n } = useI18n();
  const pricing = PRICING_PLANS.find((entry) => entry.billingPlan === plan.code);
  const name = plan.isFree
    ? t("Free")
    : pricing
      ? `${plan.name} · ${t("{price} every 30 days", { price: pricing.price })}`
      : plan.name;
  return (
    <s-section heading={t("Plan")}>
      <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
        <s-stack gap="small-500">
          <s-text type="strong">{name}</s-text>
          <s-text color="subdued">
            {t(
              "{store} of {storeLimit} store-level and {page} of {pageLimit} page-level measurements used · {tests} of {testLimit} A/B tests",
              {
                store: n(plan.usage.store),
                storeLimit: n(plan.limits.store),
                page: n(plan.usage.page),
                pageLimit: n(plan.limits.page),
                tests: n(plan.usage.abTests),
                testLimit: n(plan.limits.abTests),
              },
            )}
          </s-text>
        </s-stack>
        <s-button href={plansHref("/app/settings")}>{t("View plans")}</s-button>
      </s-stack>
    </s-section>
  );
}

// Single fetch applies route headers to data requests too; Shopify needs
// them so App Bridge can re-authenticate an expired session.
export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
```

- [ ] **Step 6: Add the Settings strings**

Append to `app/locales/catalog.ts`, directly above its final `};`:

```ts
  Settings: ["Einstellungen", "设置", "設定"],
  "Storefront tracking": ["Shop-Tracking", "店面跟踪", "店面追蹤"],
  "Snapshot needs both parts on to record visits, add-to-cart and checkout.": [
    "Snapshot benötigt beide Teile, um Besuche, Warenkorb und Checkout zu erfassen.",
    "Snapshot 需要同时开启这两部分，才能记录访问、加入购物车和结账。",
    "Snapshot 需要同時開啟這兩部分，才能記錄造訪、加入購物車和結帳。",
  ],
  "Theme app embed in your live theme. Records page views, clicks and scrolling.": [
    "App-Einbettung in Ihrem Live-Theme. Erfasst Seitenaufrufe, Klicks und Scrollen.",
    "您当前主题中的应用嵌入。记录页面浏览、点击和滚动。",
    "您目前佈景主題中的應用程式嵌入。記錄頁面瀏覽、點擊和捲動。",
  ],
  "Web pixel": ["Web-Pixel", "网站像素", "網站像素"],
  "Records add-to-cart, checkout and purchases. Turned on automatically when a measurement starts.": [
    "Erfasst Warenkorb, Checkout und Käufe. Wird automatisch aktiviert, wenn eine Messung startet.",
    "记录加入购物车、结账和购买。测量开始时自动开启。",
    "記錄加入購物車、結帳和購買。測量開始時自動開啟。",
  ],
  "Not active": ["Nicht aktiv", "未启用", "未啟用"],
  "Not verified": ["Nicht bestätigt", "未验证", "未驗證"],
  "Checking…": ["Wird geprüft…", "正在检查…", "正在檢查…"],
  "Applies to Snapshot only. Your Shopify admin language stays the same.": [
    "Gilt nur für Snapshot. Die Sprache Ihres Shopify-Adminbereichs bleibt unverändert.",
    "仅适用于 Snapshot，您的 Shopify 后台语言保持不变。",
    "僅適用於 Snapshot，您的 Shopify 管理介面語言保持不變。",
  ],
  Plan: ["Tarif", "套餐", "方案"],
  "View plans": ["Tarife ansehen", "查看套餐", "查看方案"],
  "{price} every 30 days": ["{price} alle 30 Tage", "每 30 天 {price}", "每 30 天 {price}"],
  "{store} of {storeLimit} store-level and {page} of {pageLimit} page-level measurements used · {tests} of {testLimit} A/B tests": [
    "{store} von {storeLimit} shopweiten und {page} von {pageLimit} Seitenmessungen genutzt · {tests} von {testLimit} A/B-Tests",
    "已使用 {store}/{storeLimit} 次商店级别测量和 {page}/{pageLimit} 次页面级别测量 · {tests}/{testLimit} 个 A/B 测试",
    "已使用 {store}/{storeLimit} 次商店層級測量和 {page}/{pageLimit} 次頁面層級測量 · {tests}/{testLimit} 個 A/B 測試",
  ],
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `node --test scripts/check-plans-settings.mjs && node --test scripts/check-i18n.mjs`
Expected: PASS (10 tests), PASS.

- [ ] **Step 8: Run the regression bar and type-check**

Run: `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt && npm run build && npx tsc --noEmit 2>&1 | grep -E "app/(routes/(app\.settings|api\.storefront-tracker-status)|utils/web-pixel|components/LanguageMenu)" ; echo "tsc-grep-exit=$?"`
Expected: `No regressions…`, a successful build, and `tsc-grep-exit=1`. If `justifyContent="space-between"` is rejected, use the value tsc lists for spacing items apart.

- [ ] **Step 9: Commit**

```bash
git add app/utils/web-pixel.server.ts app/routes/api.storefront-tracker-status.tsx app/components/LanguageMenu.tsx app/routes/app.settings.tsx app/locales/catalog.ts scripts/check-plans-settings.mjs
git commit -m "Add the Settings screen with tracking, language and plan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: App menu

**Files:**
- Create: `app/types/app-bridge-jsx.d.ts`
- Modify: `app/routes/app.tsx`, `scripts/fixtures/polaris-jsx.tsx`, `scripts/fixtures/tsconfig.polaris.json`, `scripts/check-framework-upgrade.mjs` (test "the app frame loads Polaris 2…"), `scripts/check-performance-regressions.mjs` (test "layout authenticates…")

**Interfaces:**
- Consumes: `useBackInterceptor` (Task 2). Routes `/app/plans` (Task 3) and `/app/settings` (Task 4) exist.
- Produces: the app menu Snapshot (home), Projects, A/B tests, Plans, Settings, and one Back interceptor for the whole app.

- [ ] **Step 1: Write the failing tests**

In `scripts/fixtures/polaris-jsx.tsx`, append:

```tsx
// App Bridge's menu element and its home link (Task 5 of plan 2a).
const HOME_LINK = { rel: "home" } as const;
export function AppNavFixture() {
  return (
    <s-app-nav>
      <s-link href="/app" {...HOME_LINK}>
        Snapshot
      </s-link>
      <s-link href="/app/projects">Projects</s-link>
    </s-app-nav>
  );
}
```

In `scripts/check-framework-upgrade.mjs`, rename the test "the app frame loads Polaris 2 and keeps Polaris React translations per language" to "the app frame loads Polaris 2, keeps Polaris React translations and shows the app menu". Make three changes inside it:

1. Add this entry to the `loadModule("app/routes/app.tsx", { … })` mocks:

   ```js
       "../components/polaris/navigation": { useBackInterceptor: () => { seen.interceptor = true; } },
   ```

2. Replace the line `renderToStaticMarkup(React.createElement(mod.default));` with:

   ```js
     const html = renderToStaticMarkup(React.createElement(mod.default));
   ```

3. Add these lines after its last `assert`:

   ```js
     assert.equal(seen.interceptor, true, "the Back interceptor is installed once in the app frame");
     assert.match(
       html,
       /<s-app-nav><s-link href="\/app" rel="home">Snapshot<\/s-link><s-link href="\/app\/projects">Projects<\/s-link><s-link href="\/app\/ab-tests">A\/B tests<\/s-link><s-link href="\/app\/plans">Plans<\/s-link><s-link href="\/app\/settings">Settings<\/s-link><\/s-app-nav>/,
     );
   ```

In `scripts/check-performance-regressions.mjs`, add this entry to the mocks of the test "layout authenticates but never waits on billing, analytics, or eager page preloads":

```js
    "../components/polaris/navigation": {},
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test scripts/check-framework-upgrade.mjs`
Expected: 2 failures.
- "Polaris web component elements type-check in TSX": `TS2339: Property 's-app-nav' does not exist on type 'JSX.IntrinsicElements'`.
- "the app frame loads Polaris 2…": `seen.interceptor` undefined, or no `<s-app-nav>`.

- [ ] **Step 3: Declare `s-app-nav` for React's JSX**

Create `app/types/app-bridge-jsx.d.ts`:

```ts
import type { SAppNavAttributes } from "@shopify/app-bridge-types";
import type { ReactNode } from "react";

// App Bridge declares its elements on the global JSX namespace, but React 19's
// TSX reads React.JSX, so the app menu element is declared there too.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": SAppNavAttributes & { children?: ReactNode };
    }
  }
}
```

Replace `scripts/fixtures/tsconfig.polaris.json` with:

```json
{
  "extends": "../../tsconfig.json",
  "include": ["polaris-jsx.tsx", "../../app/types/app-bridge-jsx.d.ts"]
}
```

- [ ] **Step 4: Switch the app frame to `s-app-nav`**

In `app/routes/app.tsx`:

1. In the `react-router` import, remove `Link`, leaving:

   ```tsx
   import {
     Outlet,
     useLoaderData,
     useLocation,
     useNavigation,
     useRouteError,
   } from "react-router";
   ```

2. Delete the line `import { NavMenu } from "@shopify/app-bridge-react";`. Add this after the `BackgroundBillingSync` import:

   ```tsx
   import { useBackInterceptor } from "../components/polaris/navigation";
   ```

3. Replace `APP_NAV_ITEMS`, `getRouteTitle`, `isNavItemActive` and `AppBridgeNav` (from `const APP_NAV_ITEMS` down to the end of `function isNavItemActive`) with:

   ```tsx
   // Spec 4.1: the app name opens Home; then Projects, A/B tests, Plans, Settings.
   const APP_NAV_ITEMS = [
     { label: "Projects", to: "/app/projects" },
     { label: "A/B tests", to: "/app/ab-tests" },
     { label: "Plans", to: "/app/plans" },
     { label: "Settings", to: "/app/settings" },
   ];
   // s-link has no typed `rel`; App Bridge reads it to mark the home link.
   const HOME_LINK = { rel: "home" } as const;

   function getRouteTitle(pathname: string) {
     if (pathname === "/app") return "Dashboard";
     if (pathname.startsWith("/app/projects")) return "Projects";
     if (pathname.startsWith("/app/plans") || pathname.startsWith("/app/upgrade")) return "Plans";
     if (pathname.startsWith("/app/settings")) return "Settings";
     if (pathname.startsWith("/app/store-snapshots")) return "Store Snapshots";
     if (pathname.startsWith("/app/channel-snapshots")) return "Channel Snapshots";
     if (pathname.startsWith("/app/customer-snapshots"))
       return "Customer Snapshots";
     if (pathname.startsWith("/app/ab-tests")) return "A/B Tests";
     if (isPageSnapshotsPath(pathname)) return "Page Snapshots";
     if (pathname.includes("/challenges")) return "Challenges";
     return "Loading";
   }
   ```

   Then replace the whole `function AppBridgeNav() { … }` with:

   ```tsx
   function AppNav() {
     const { t } = useI18n();
     useBackInterceptor();
     return (
       <s-app-nav>
         <s-link href="/app" {...HOME_LINK}>
           Snapshot
         </s-link>
         {APP_NAV_ITEMS.map((item) => (
           <s-link key={item.to} href={item.to}>
             {t(item.label)}
           </s-link>
         ))}
         {COMMUNITY_FEATURES_ENABLED && (
           <s-link href="/app/challenges">{t("Challenges")}</s-link>
         )}
       </s-app-nav>
     );
   }
   ```

4. In `AppContent`, replace `<AppBridgeNav />` with `<AppNav />`.

Keep `PAGE_SNAPSHOTS_PATH` and `isPageSnapshotsPath`: `AppContent` still uses them.

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test scripts/check-framework-upgrade.mjs && node --test scripts/check-performance-regressions.mjs`
Expected: PASS, PASS.

- [ ] **Step 6: Run the regression bar and type-check**

Run: `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt && npm run build && npx tsc --noEmit 2>&1 | grep -E "app/(routes/app\.tsx|types/)" ; echo "tsc-grep-exit=$?"`
Expected: `No regressions…`, a successful build, and `tsc-grep-exit=1`.

- [ ] **Step 7: Commit**

```bash
git add app/types/app-bridge-jsx.d.ts app/routes/app.tsx scripts/fixtures scripts/check-framework-upgrade.mjs scripts/check-performance-regressions.mjs
git commit -m "Put Projects, A/B tests, Plans and Settings in the app menu" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Project list filters and counts

**Files:**
- Modify: `app/utils/growth-projects.ts` (append), `app/utils/growth-projects.server.ts:107-124` (`listGrowthProjects`)
- Test: `scripts/check-projects-list.mjs` (create)

**Interfaces:**
- Consumes: `growthMeasurementStatus` and `GROWTH_PROJECT_PAGE_SIZE` (existing).
- Produces:
  - `PROJECT_LIST_STATUSES = ["ALL", "MEASURING", "IDLE", "COMPLETED"]`
  - `type ProjectListStatus`
  - `type ProjectListFilters = { status: ProjectListStatus; scope: "ALL" | "STORE" | "PAGE"; query: string; page: number }`
  - `parseProjectListFilters(params: URLSearchParams): ProjectListFilters`
  - `projectListStatus(latest): "MEASURING" | "IDLE" | "COMPLETED"`
  - `selectProjectPage(rows, status, requestedPage, pageSize?)`
  - `listGrowthProjects(shop: string, filters?: Partial<ProjectListFilters>)`, which returns `{ projects (each with listStatus and latestMeasurement), total, page, pageCount, counts }`. Home's `listGrowthProjects(shop)` keeps working.

- [ ] **Step 1: Write the failing tests**

Create `scripts/check-projects-list.mjs`:

```js
// Projects list filters, counts and table (plan 2a). Read-only: mocked
// Prisma; never touches a database.
// Run: node --test scripts/check-projects-list.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");

function loadModule(file, mocks = {}) {
  const filename = path.resolve(root, file);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  const load = (id) => {
    if (id in mocks) return mocks[id];
    if (!id.startsWith(".")) return require(id);
    const base = path.resolve(path.dirname(filename), id);
    const target = [`${base}.ts`, `${base}.tsx`, base].find(existsSync);
    if (!target) throw new Error(`Cannot resolve ${id} from ${file}`);
    return loadModule(path.relative(root, target), mocks);
  };
  new Function("module", "exports", "require", output)(mod, mod.exports, load);
  return mod.exports;
}

const pure = loadModule("app/utils/growth-projects.ts");

test("list filters are normalised, capped and default to everything", () => {
  const parse = (query) => pure.parseProjectListFilters(new URLSearchParams(query));
  assert.deepEqual(parse(""), { status: "ALL", scope: "ALL", query: "", page: 1 });
  assert.deepEqual(parse("status=idle&scope=page&q=%20Spring%20&page=3"), {
    status: "IDLE",
    scope: "PAGE",
    query: "Spring",
    page: 3,
  });
  assert.deepEqual(parse("status=bogus&scope=x&page=-2"), { status: "ALL", scope: "ALL", query: "", page: 1 });
  assert.equal(parse(`q=${"a".repeat(300)}`).query.length, 120);
  assert.equal(parse("q=a%00b%07c").query, "abc");
  assert.equal(parse("page=2.7").page, 2);
});

test("a project is Measuring while a capture runs, Completed when its latest finished, otherwise Idle", () => {
  assert.equal(pure.projectListStatus(null), "IDLE");
  assert.equal(pure.projectListStatus(undefined), "IDLE");
  assert.equal(pure.projectListStatus({ storeSnapshot: { status: "ACTIVE" } }), "MEASURING");
  assert.equal(pure.projectListStatus({ snapshot: { status: "COMPLETED" } }), "COMPLETED");
  assert.equal(pure.projectListStatus({ channelSnapshot: { status: "PAUSED" } }), "IDLE");
  assert.equal(pure.projectListStatus({}), "COMPLETED", "no capture counts as finished, as on the Project page");
});

test("counts cover every status, the filter keeps one, and stale pages clamp", () => {
  const rows = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: `idle-${i}`, status: "IDLE" })),
    { id: "run", status: "MEASURING" },
    { id: "done", status: "COMPLETED" },
  ];
  const all = pure.selectProjectPage(rows, "ALL", 1, 10);
  assert.deepEqual(all.counts, { ALL: 14, MEASURING: 1, IDLE: 12, COMPLETED: 1 });
  assert.equal(all.rows.length, 10);
  assert.equal(all.pageCount, 2);
  const idle = pure.selectProjectPage(rows, "IDLE", 99, 10);
  assert.equal(idle.page, 2);
  assert.deepEqual(idle.rows.map((row) => row.id), ["idle-10", "idle-11"]);
  const none = pure.selectProjectPage([], "MEASURING", 3, 10);
  assert.equal(none.page, 1);
  assert.equal(none.pageCount, 1);
  assert.deepEqual(none.rows, []);
});

test("the project list filters scope and search in the database and keeps its order", async () => {
  const calls = [];
  const capture = (status) => ({ status, startedAt: new Date("2026-11-01T00:00:00Z"), endsAt: null, completedAt: null });
  const summaries = [
    { id: "p1", measurements: [{ snapshot: null, storeSnapshot: { status: "ACTIVE" }, channelSnapshot: null, customerSnapshot: null }] },
    { id: "p2", measurements: [] },
    { id: "p3", measurements: [{ snapshot: { status: "COMPLETED" }, storeSnapshot: null, channelSnapshot: null, customerSnapshot: null }] },
    { id: "p4", measurements: [{ snapshot: null, storeSnapshot: { status: "PAUSED" }, channelSnapshot: null, customerSnapshot: null }] },
  ];
  const full = [
    {
      id: "p4",
      title: "Four",
      measurements: [{
        id: "m4", name: "Baseline", snapshotId: null, storeSnapshotId: "s4", channelSnapshotId: null, customerSnapshotId: null,
        snapshot: null, storeSnapshot: capture("PAUSED"), channelSnapshot: null, customerSnapshot: null,
      }],
    },
    { id: "p2", title: "Two", measurements: [] },
  ];
  const db = {
    growthProject: {
      findMany: async (args) => {
        calls.push(args);
        return args.select ? summaries : full.filter((row) => args.where.id.in.includes(row.id));
      },
    },
  };
  const server = loadModule("app/utils/growth-projects.server.ts", {
    "../db.server": { __esModule: true, default: db },
    "./billing.server": { getBillingAccess: async () => ({}), PlanLimitError: class extends Error {} },
    "./web-pixel.server": { ensureWebPixel: async () => ({ ready: true }) },
    "./snapshot-setup.server": { resolveSetupPage: async () => ({}), savedTrackerState: async () => "active" },
    "./loader-cache.server": {
      cachedValue: async (key, _ttl, load) => (key.startsWith("growth-expiry:") ? undefined : load()),
      clearCacheKey() {},
      clearCachePrefix() {},
      loaderCacheKeys: { dashboard: () => "", billingDisplay: () => "", categoryPrefix: () => "", categoryFastPrefix: () => "" },
    },
  });
  const list = await server.listGrowthProjects("a.myshopify.com", { status: "IDLE", scope: "STORE", query: "spring", page: 1 });
  assert.deepEqual(calls[0].where, {
    shop: "a.myshopify.com",
    scope: "STORE",
    OR: [
      { title: { contains: "spring", mode: "insensitive" } },
      { goal: { contains: "spring", mode: "insensitive" } },
    ],
  });
  assert.deepEqual(calls[1].where, { shop: "a.myshopify.com", id: { in: ["p2", "p4"] } });
  assert.deepEqual(list.counts, { ALL: 4, MEASURING: 1, IDLE: 2, COMPLETED: 1 });
  assert.deepEqual(list.projects.map((row) => [row.id, row.listStatus]), [["p2", "IDLE"], ["p4", "IDLE"]]);
  assert.equal(list.projects[1].latestMeasurement.status, "PAUSED");
  assert.equal(list.page, 1);
  calls.length = 0;
  const everything = await server.listGrowthProjects("a.myshopify.com");
  assert.deepEqual(calls[0].where, { shop: "a.myshopify.com" });
  assert.equal(everything.total, 4);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test scripts/check-projects-list.mjs`
Expected: FAIL with `pure.parseProjectListFilters is not a function`, and with the database test's `calls[0].where` lacking `scope`.

- [ ] **Step 3: Add the pure list helpers**

Append to `app/utils/growth-projects.ts`:

```ts
export const PROJECT_LIST_STATUSES = ["ALL", "MEASURING", "IDLE", "COMPLETED"] as const;
export type ProjectListStatus = (typeof PROJECT_LIST_STATUSES)[number];
export type ProjectListScope = "ALL" | "STORE" | "PAGE";
export type ProjectListFilters = {
  status: ProjectListStatus;
  scope: ProjectListScope;
  query: string;
  page: number;
};

/** Reads the Projects filters from the address; anything unknown means "all". */
export function parseProjectListFilters(params: URLSearchParams): ProjectListFilters {
  const status = String(params.get("status") || "ALL").toUpperCase();
  const scope = String(params.get("scope") || "ALL").toUpperCase();
  const page = Math.floor(Number(params.get("page")));
  return {
    status: (PROJECT_LIST_STATUSES as readonly string[]).includes(status)
      ? (status as ProjectListStatus)
      : "ALL",
    scope: scope === "STORE" || scope === "PAGE" ? scope : "ALL",
    query: (params.get("q") || "").replace(/\p{Cc}/gu, "").trim().slice(0, 120),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/**
 * Measuring: the latest measurement's capture is running. Completed: it
 * finished. Idle: nothing started yet, or it is paused. Never overlapping.
 */
export function projectListStatus(
  latest: Parameters<typeof growthMeasurementStatus>[0] | null | undefined,
): Exclude<ProjectListStatus, "ALL"> {
  if (!latest) return "IDLE";
  const status = growthMeasurementStatus(latest);
  if (status === "ACTIVE") return "MEASURING";
  if (status === "COMPLETED") return "COMPLETED";
  return "IDLE";
}

/** Counts every status, keeps the chosen one, clamps the page and slices it. */
export function selectProjectPage<Row extends { status: Exclude<ProjectListStatus, "ALL"> }>(
  rows: Row[],
  status: ProjectListStatus,
  requestedPage: number,
  pageSize = GROWTH_PROJECT_PAGE_SIZE,
) {
  const counts: Record<ProjectListStatus, number> = { ALL: rows.length, MEASURING: 0, IDLE: 0, COMPLETED: 0 };
  for (const row of rows) counts[row.status] += 1;
  const matching = status === "ALL" ? rows : rows.filter((row) => row.status === status);
  const pageCount = Math.max(1, Math.ceil(matching.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(requestedPage) || 1));
  return {
    counts,
    total: matching.length,
    page,
    pageCount,
    rows: matching.slice((page - 1) * pageSize, page * pageSize),
  };
}
```

- [ ] **Step 4: Filter and count in `listGrowthProjects`**

In `app/utils/growth-projects.server.ts`, replace the import from `./growth-projects` with the one below. `GROWTH_PROJECT_PAGE_SIZE` is dropped: the old `listGrowthProjects` was its only user in this file, and `selectProjectPage` now applies it.

```ts
import {
  GrowthProjectError, growthMeasurementStatus,
  growthRequestKey, parseGrowthProjectInput, parseMeasurementInput,
  projectListStatus, selectProjectPage, type ProjectListFilters,
} from "./growth-projects";
```

Replace the whole `listGrowthProjects` function with:

```ts
const latestCaptureStatus = {
  take: 1,
  orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
  select: {
    snapshot: { select: { status: true } },
    storeSnapshot: { select: { status: true } },
    channelSnapshot: { select: { status: true } },
    customerSnapshot: { select: { status: true } },
  },
};

/**
 * One shop's projects, newest first. Scope and search filter in the database.
 * The status of each project comes from its latest measurement, so status
 * counts and the status filter are worked out on the (small) id list, and only
 * the shown page is loaded in full.
 */
export async function listGrowthProjects(shop: string, filters: Partial<ProjectListFilters> = {}) {
  await expireGrowthMeasurements(shop);
  const where: Prisma.GrowthProjectWhereInput = { shop };
  if (filters.scope === "STORE" || filters.scope === "PAGE") where.scope = filters.scope;
  const query = filters.query?.trim();
  if (query)
    where.OR = [
      { title: { contains: query, mode: "insensitive" } },
      { goal: { contains: query, mode: "insensitive" } },
    ];
  const summaries = await prisma.growthProject.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: { id: true, measurements: latestCaptureStatus },
  });
  const selection = selectProjectPage(
    summaries.map((row) => ({ id: row.id, status: projectListStatus(row.measurements[0]) })),
    filters.status ?? "ALL",
    filters.page ?? 1,
  );
  const ids = selection.rows.map((row) => row.id);
  const rows = ids.length
    ? await prisma.growthProject.findMany({
        where: { shop, id: { in: ids } },
        include: {
          resourceProject: true,
          _count: { select: { measurements: true, abTests: true } },
          measurements: { take: 1, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: captures },
        },
      })
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    projects: ids.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return [];
      const latest = row.measurements[0];
      return [{
        ...row,
        listStatus: projectListStatus(latest),
        latestMeasurement: latest ? decorateMeasurement(latest) : null,
      }];
    }),
    total: selection.total,
    page: selection.page,
    pageCount: selection.pageCount,
    counts: selection.counts,
  };
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test scripts/check-projects-list.mjs && node --test scripts/check-growth-projects.mjs`
Expected: PASS (4 tests), PASS.

- [ ] **Step 6: Run the regression bar and type-check**

Run: `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt && npm run build && npx tsc --noEmit 2>&1 | grep -E "app/utils/growth-projects" ; echo "tsc-grep-exit=$?"`
Expected: `No regressions…`, a successful build, and `tsc-grep-exit=1`.

`scripts/check-growth-projects-db.mjs` calls `listGrowthProjects(shop)` against a disposable database. It is not run here; Task 8 runs it against loopback Postgres.

- [ ] **Step 7: Commit**

```bash
git add app/utils/growth-projects.ts app/utils/growth-projects.server.ts scripts/check-projects-list.mjs
git commit -m "Filter and count projects by status, scope and search" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Projects screen

**Files:**
- Create: `app/components/ProjectsTable.tsx`
- Rewrite: `app/routes/app.projects._index.tsx`
- Modify: `app/locales/catalog.ts` (append), `scripts/check-projects-ui.mjs` (harness and the test "global quick-create opens on a new URL even when Project list is already mounted")
- Test: `scripts/check-projects-list.mjs` (append), `scripts/check-projects-ui.mjs`

**Interfaces:**
- Consumes:
  - `listParams` (Task 1) and `useElementEvent` (Task 2)
  - `parseProjectListFilters`, `PROJECT_LIST_STATUSES` and `listGrowthProjects(shop, filters)` (Task 6)
  - `GrowthProjectForm` (existing, unchanged)
- Produces:
  - `ProjectsTable({ projects: ProjectsTableRow[]; page: number; pageCount: number; onPage(page: number): void })`
  - The Projects screen. Its address keeps `status`, `scope`, `q` and `page`, all written with `{ replace: true }`.

- [ ] **Step 1: Write the failing table test**

Append to `scripts/check-projects-list.mjs`:

```js
test("the projects table shows status, scope and the latest measurement, with row links", () => {
  const { ProjectsTable } = loadModule("app/components/ProjectsTable.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ProjectsTable, {
      page: 2,
      pageCount: 3,
      onPage() {},
      projects: [
        { id: "p1", title: "Spring collection", goal: "Raise add-to-cart", scope: "STORE", updatedAt: "2026-11-05T10:00:00.000Z", listStatus: "MEASURING", latestMeasurement: { name: "Baseline" }, _count: { abTests: 2 } },
        { id: "p2", title: "Orange", goal: "", scope: "PAGE", updatedAt: "2026-10-23T10:00:00.000Z", listStatus: "IDLE", latestMeasurement: null, resourceProject: { productTitle: "Orange Snowboard" } },
      ],
    }),
  );
  assert.match(html, /<s-table paginate="" hasPreviousPage="" hasNextPage="">/);
  assert.match(html, /<s-table-row clickDelegate="project-link-p1">/);
  assert.match(html, /<s-link id="project-link-p1" href="\/app\/projects\/p1">Spring collection<\/s-link>/);
  assert.match(html, /<s-badge tone="info">Measuring<\/s-badge>/);
  assert.match(html, /<s-badge tone="neutral">Idle<\/s-badge>/);
  for (const text of ["Store-level", "Page-level", "Orange Snowboard", "Baseline", "Not started"])
    assert.ok(html.includes(text), text);
});
```

- [ ] **Step 2: Update the Projects UI harness and write the failing screen tests**

In `scripts/check-projects-ui.mjs`, make these changes:

1. After the line `const embeddedFilters = compile("app/utils/embedded-filter-params.ts");`, add:

   ```js
   const navigation = compile("app/utils/navigation.ts");
   const realJsx = require("react/jsx-runtime");
   // Records the click handlers of Polaris elements so tests can press them.
   function jsxRuntime(state) {
     const record = (type, props) => {
       if (typeof type === "string" && type.startsWith("s-") && typeof props?.onClick === "function")
         state.buttons.push({ type, slot: props.slot, label: props.children, onClick: props.onClick });
     };
     return {
       ...realJsx,
       jsx: (type, props, key) => { record(type, props); return realJsx.jsx(type, props, key); },
       jsxs: (type, props, key) => { record(type, props); return realJsx.jsxs(type, props, key); },
     };
   }
   ```

2. In `harness`, change the `useSearchParams` mock so the navigation options are kept:

   ```js
         useSearchParams: () => [
           state.params,
           (params, options) => {
             state.params = params;
             state.navigationOptions = options;
           },
         ],
   ```

3. In `harness`, change `services.listGrowthProjects` to:

   ```js
       listGrowthProjects: async (shop, filters) => {
         state.calls.push(["list", shop, filters]);
         return { projects: [], page: 1, pageCount: 1, total: 0, counts: { ALL: 0, MEASURING: 0, IDLE: 0, COMPLETED: 0 } };
       },
   ```

4. Add these entries to the `mocks` object in `harness`:

   ```js
       "react/jsx-runtime": jsxRuntime(state),
       "../utils/navigation": navigation,
       "../components/ProjectsTable": {
         ProjectsTable: (props) => {
           state.table = props;
           return React.createElement("table", { "data-page": props.page });
         },
       },
   ```

5. Replace the whole test "global quick-create opens on a new URL even when Project list is already mounted" with:

   ```js
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
   ```

- [ ] **Step 3: Run the tests to see them fail**

Run: `node --test scripts/check-projects-list.mjs; node --test scripts/check-projects-ui.mjs`
Expected:
- `check-projects-list`: the table test FAILs with `ENOENT … app/components/ProjectsTable.tsx`.
- `check-projects-ui`: the 4 new Projects tests FAIL. The page still renders the mocked Polaris `Page`, so there is no `<s-page heading="Projects">` or `filters` and no `Idle 14` button.

- [ ] **Step 4: Write the table**

Create `app/components/ProjectsTable.tsx`:

```tsx
import { useRef } from "react";
import { useI18n } from "../utils/i18n";
import { useElementEvent } from "./polaris/events";
import type { ProjectListStatus } from "../utils/growth-projects";

export type ProjectsTableRow = {
  id: string;
  title: string;
  goal: string;
  scope: string;
  updatedAt: Date | string;
  listStatus: Exclude<ProjectListStatus, "ALL">;
  resourceProject?: { productTitle?: string | null } | null;
  latestMeasurement?: { name: string } | null;
  _count?: { abTests?: number };
};

const STATUS_BADGES = {
  MEASURING: { label: "Measuring", tone: "info" },
  IDLE: { label: "Idle", tone: "neutral" },
  COMPLETED: { label: "Completed", tone: "success" },
} as const;

export function ProjectsTable({
  projects,
  page,
  pageCount,
  onPage,
}: {
  projects: ProjectsTableRow[];
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  const { t, formatDate, formatNumber } = useI18n();
  const table = useRef<HTMLElement>(null);
  useElementEvent(table, "nextpage", () => onPage(page + 1));
  useElementEvent(table, "previouspage", () => onPage(page - 1));
  return (
    <s-table ref={table} paginate={pageCount > 1} hasPreviousPage={page > 1} hasNextPage={page < pageCount}>
      <s-table-header-row>
        <s-table-header listSlot="primary">{t("Project")}</s-table-header>
        <s-table-header>{t("Scope")}</s-table-header>
        <s-table-header listSlot="secondary">{t("Status")}</s-table-header>
        <s-table-header>{t("Latest measurement")}</s-table-header>
        <s-table-header format="numeric">{t("A/B tests")}</s-table-header>
        <s-table-header>{t("Updated")}</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {projects.map((project) => {
          const status = STATUS_BADGES[project.listStatus];
          return (
            <s-table-row key={project.id} clickDelegate={`project-link-${project.id}`}>
              <s-table-cell>
                <s-stack gap="small-500">
                  <s-link id={`project-link-${project.id}`} href={`/app/projects/${project.id}`}>
                    {project.title}
                  </s-link>
                  <s-text color="subdued">
                    {project.resourceProject?.productTitle || project.goal || t("Imported project")}
                  </s-text>
                </s-stack>
              </s-table-cell>
              <s-table-cell>
                <s-badge>{t(project.scope === "PAGE" ? "Page-level" : "Store-level")}</s-badge>
              </s-table-cell>
              <s-table-cell>
                <s-badge tone={status.tone}>{t(status.label)}</s-badge>
              </s-table-cell>
              <s-table-cell>
                {project.latestMeasurement ? (
                  project.latestMeasurement.name
                ) : (
                  <s-text color="subdued">{t("Not started")}</s-text>
                )}
              </s-table-cell>
              <s-table-cell>{formatNumber(project._count?.abTests ?? 0)}</s-table-cell>
              <s-table-cell>{formatDate(project.updatedAt, { dateStyle: "medium" })}</s-table-cell>
            </s-table-row>
          );
        })}
      </s-table-body>
    </s-table>
  );
}
```

- [ ] **Step 5: Rewrite the Projects screen**

Replace the whole of `app/routes/app.projects._index.tsx` with:

```tsx
import { json } from "../utils/route-data";
import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect, useState } from "react";
import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import {
  createGrowthProject,
  listGrowthProjects,
} from "../utils/growth-projects.server";
import {
  GrowthProjectError,
  parseProjectListFilters,
  PROJECT_LIST_STATUSES,
  type ProjectListStatus,
} from "../utils/growth-projects";
import { isPlanLimitError } from "../utils/billing.server";
import { GrowthProjectForm } from "../components/GrowthProjectForm";
import { ProjectsTable } from "../components/ProjectsTable";
import { listParams } from "../utils/navigation";
import { useI18n } from "../utils/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const filters = parseProjectListFilters(new URL(request.url).searchParams);
  const list = await listGrowthProjects(session.shop, filters);
  return json(
    { ...list, filters, shop: session.shop },
    { headers: { "Cache-Control": "private, no-store" } },
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  try {
    if (form.get("intent") !== "create-project")
      throw new GrowthProjectError("Invalid action.");
    const continueToAbTest = form.get("next") === "ab-test";
    const created = await createGrowthProject(session.shop, admin, form, {
      startMeasurement: !continueToAbTest,
    });
    return redirect(
      continueToAbTest
        ? `/app/ab-tests?create=1&projectId=${encodeURIComponent(created.projectId)}`
        : `/app/projects/${created.projectId}`,
    );
  } catch (error) {
    if (error instanceof GrowthProjectError || isPlanLimitError(error))
      return json(
        {
          error: error.message,
          errorKey:
            error instanceof GrowthProjectError
              ? error.translationKey
              : error.message,
          errorValues:
            error instanceof GrowthProjectError ? error.translationValues : {},
        },
        { status: error.status },
      );
    console.error(
      "Project creation failed",
      error instanceof Error ? error.name : "unknown",
    );
    return json(
      { error: "Project could not be created. Please retry." },
      { status: 503 },
    );
  }
};

const STATUS_LABELS: Record<ProjectListStatus, string> = {
  ALL: "All",
  MEASURING: "Measuring",
  IDLE: "Idle",
  COMPLETED: "Completed",
};
const valueOf = (event: { currentTarget: unknown }) =>
  String((event.currentTarget as { value?: unknown } | null)?.value ?? "");

export default function Projects() {
  const data = useLoaderData<typeof loader>();
  const { t, formatNumber } = useI18n();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get("create") === "1");
  const requestedCreate = params.get("create");
  useEffect(() => {
    if (requestedCreate === "1") setOpen(true);
  }, [requestedCreate]);
  const [query, setQuery] = useState(data.filters.query);
  useEffect(() => {
    setQuery(data.filters.query);
  }, [data.filters.query]);

  // Filters and pages never add Back steps (rule 2).
  function update(changes: Record<string, string | null>) {
    setParams(listParams(params, changes), { replace: true, preventScrollReset: true });
  }
  useEffect(() => {
    const next = query.trim();
    if (next === data.filters.query) return;
    const timer = setTimeout(() => update({ q: next || null }), 300);
    return () => clearTimeout(timer);
  }, [query, data.filters.query]);

  function close() {
    setOpen(false);
    const next = new URLSearchParams(params);
    next.delete("create");
    next.delete("next");
    setParams(next, { replace: true });
  }
  function clearFilters() {
    setQuery("");
    update({ status: null, scope: null, q: null });
  }

  const filtered =
    data.filters.status !== "ALL" || data.filters.scope !== "ALL" || data.filters.query !== "";
  return (
    <s-page heading={t("Projects")}>
      <s-button slot="secondary-actions" href="/app/ab-tests?create=1">
        {t("Create A/B test")}
      </s-button>
      <s-button slot="primary-action" variant="primary" onClick={() => setOpen(true)}>
        {t("Create project")}
      </s-button>
      {data.counts.ALL === 0 && !filtered ? (
        <s-section>
          <s-stack gap="base" alignItems="center" padding="large">
            <s-heading>{t("Start your first project")}</s-heading>
            <s-paragraph>
              {t("A project tracks one goal. Measure a page or your whole store, test ideas and see what moved the numbers.")}
            </s-paragraph>
            <s-button variant="secondary" onClick={() => setOpen(true)}>
              {t("Create project")}
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section padding="none" accessibilityLabel={t("Projects")}>
          <s-box padding="base">
            <s-stack direction="inline" gap="base" alignItems="end">
              <s-button-group gap="none" accessibilityLabel={t("Status")}>
                {PROJECT_LIST_STATUSES.map((status) => (
                  <s-press-button
                    key={status}
                    pressed={data.filters.status === status}
                    onClick={() => update({ status: status === "ALL" ? null : status })}
                  >
                    {`${t(STATUS_LABELS[status])} ${formatNumber(data.counts[status])}`}
                  </s-press-button>
                ))}
              </s-button-group>
              <s-select
                label={t("Scope")}
                value={data.filters.scope}
                onChange={(event) => {
                  const value = valueOf(event);
                  update({ scope: value === "ALL" ? null : value });
                }}
              >
                <s-option value="ALL">{t("Store and page")}</s-option>
                <s-option value="STORE">{t("Store-level")}</s-option>
                <s-option value="PAGE">{t("Page-level")}</s-option>
              </s-select>
              <s-search-field
                label={t("Search projects")}
                labelAccessibilityVisibility="exclusive"
                placeholder={t("Search projects")}
                value={query}
                onInput={(event) => setQuery(valueOf(event))}
              />
            </s-stack>
          </s-box>
          {data.projects.length ? (
            <ProjectsTable
              projects={data.projects}
              page={data.page}
              pageCount={data.pageCount}
              onPage={(page) => update({ page: page > 1 ? String(page) : null })}
            />
          ) : (
            <s-box padding="large">
              <s-stack gap="base" alignItems="center">
                <s-paragraph>{t("No projects match these filters.")}</s-paragraph>
                <s-button onClick={clearFilters}>{t("Clear filters")}</s-button>
              </s-stack>
            </s-box>
          )}
        </s-section>
      )}
      {open && (
        <GrowthProjectForm
          open
          onClose={close}
          shop={data.shop}
          next={params.get("next") || undefined}
        />
      )}
    </s-page>
  );
}

// Single fetch applies route headers to data requests too; Shopify needs
// them so App Bridge can re-authenticate an expired session.
export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
```

- [ ] **Step 6: Add the Projects strings**

Append to `app/locales/catalog.ts`, directly above its final `};`:

```ts
  Measuring: ["Messung läuft", "测量中", "測量中"],
  Idle: ["Inaktiv", "空闲", "閒置"],
  "Store and page": ["Shop und Seite", "商店和页面", "商店和頁面"],
  "Search projects": ["Projekte durchsuchen", "搜索项目", "搜尋專案"],
  "No projects match these filters.": [
    "Keine Projekte entsprechen diesen Filtern.",
    "没有符合这些筛选条件的项目。",
    "沒有符合這些篩選條件的專案。",
  ],
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `node --test scripts/check-projects-list.mjs && node --test scripts/check-projects-ui.mjs && node --test scripts/check-i18n.mjs`
Expected: PASS (5 tests), PASS, PASS.

- [ ] **Step 8: Run the regression bar and type-check**

Run: `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt && npm run build && npx tsc --noEmit 2>&1 | grep -E "app/(routes/app\.projects\._index|components/ProjectsTable)" ; echo "tsc-grep-exit=$?"`
Expected: `No regressions…`, a successful build, and `tsc-grep-exit=1`. If tsc rejects a Polaris prop value, such as `listSlot` or `alignItems="end"`, use one of the values it lists.

- [ ] **Step 9: Commit**

```bash
git add app/components/ProjectsTable.tsx app/routes/app.projects._index.tsx app/locales/catalog.ts scripts/check-projects-list.mjs scripts/check-projects-ui.mjs
git commit -m "Rebuild Projects with Polaris web components, filters and search" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Whole-branch checks

**Files:** none changed, unless a check fails.

- [ ] **Step 1: Run every database-free check**

Run: `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt`
Expected: `No regressions against …`. The three new check files are PASS.

- [ ] **Step 2: Run the database checks against loopback Postgres**

Start the throwaway Postgres and point both variables at it (Task 9, Setup steps 1–2), then run:

```bash
export GROWTH_TEST_DATABASE_URL="$DATABASE_URL" JOURNEY_TEST_DATABASE_URL="$DATABASE_URL"
for f in check-growth-projects-db check-growth-report-sections check-growth-reports check-customer-journeys; do node --test "scripts/$f.mjs" > "/tmp/2a-$f.log" 2>&1 && echo "PASS $f" || echo "FAIL $f"; done
```

Expected: four PASS lines. `check-growth-projects-db` covers `listGrowthProjects(shop)` against real Postgres.

- [ ] **Step 3: Build, lint and type-check**

Run: `npm run build && npx eslint app/utils/navigation.ts app/utils/plans.ts app/utils/plans.server.ts app/components/polaris app/components/ProjectsTable.tsx app/components/LanguageMenu.tsx app/routes/app.plans.tsx app/routes/app.settings.tsx app/routes/app.projects._index.tsx app/routes/app.tsx app/routes/app.upgrade.tsx && npx tsc --noEmit 2>&1 | grep -cE "error TS"`
Expected:
- The build succeeds.
- ESLint reports 0 errors (warnings are fine).
- The `error TS` count is at most the 101 recorded in plan 1's Results. None of the errors is in a file this plan created.

- [ ] **Step 4: Fix anything that failed**

For any failure, use superpowers:systematic-debugging. Commit each fix with its own message and the co-author line.

---

### Task 9: Check on shep-dev

Run on the dev store with the throwaway database. **Never** with the local `.env` as it stands.

**Setup**

1. Start the throwaway Postgres. The first-time lines may report "already exists"; that's fine.

   ```bash
   PGBIN=/opt/homebrew/opt/postgresql@17/bin
   PGDATA="$HOME/.cache/snapshot-smoke-pg"
   test -d "$PGDATA" || LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 "$PGBIN/initdb" -D "$PGDATA" -U growth_test --auth=trust
   LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/log" -o "-p 55443 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start
   "$PGBIN/createdb" -h 127.0.0.1 -p 55443 -U growth_test snapshot_smoke || true
   ```

2. Point both database variables at it, create the schema, and mark every migration as applied:

   ```bash
   export DATABASE_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke" DIRECT_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke"
   node -e 'const h=new URL(process.env.DATABASE_URL).hostname; if(h!=="127.0.0.1"){console.error("NOT LOOPBACK");process.exit(1)} console.log("loopback ok")'
   npx prisma db push --skip-generate
   for m in prisma/migrations/*/; do npx prisma migrate resolve --applied "$(basename "$m")" || true; done
   ```

3. In a terminal tab where those two variables are exported, run `shopify app dev` and choose shep-dev if asked. Open the app in shep-dev's admin.

**Steps** (record PASS/FAIL and notes for each, in `.smoke/2a.md`, which is not committed)

1. **Menu:** the app menu lists Projects, A/B tests, Plans and Settings. Clicking "Snapshot" opens Home, and each item opens its screen.
2. **Settings:**
   - The two tracking rows show badges.
   - "Open theme editor" opens the theme editor in a new tab.
   - Switch the language to Deutsch: Settings and the menu change. Switch back to English.
3. **Settings → View plans → title-bar Back:** returns to Settings in one step. Browser Back from Settings then goes to the screen before it.
4. **Fresh Plans:** open the admin address `…/apps/<app handle>/app/plans` in a new tab. Title-bar Back goes to Home, and the app stays open.
5. **Upgrade:**
   - From Settings → View plans, click "Upgrade to Signal". Shopify's plan page opens in the admin, at the top level.
   - **Decline** (go back without approving). Expected: you are back on Plans with no billing banner. Backing out of managed pricing never reaches `/app/upgrade/return`, so "Billing was not completed" does not appear here. Approve a test charge only if the user says so in chat: an approval changes shep-dev's real app subscription.
   - If approved, expected: you land back on Settings with a "Plan updated" toast. This depends on the managed-pricing welcome link (Partner Dashboard) pointing at `/app/upgrade/return`; if you land on Home instead, record it.
   - **Menu push check:** open Settings from the menu, then Plans from the menu, then use title-bar Back. Expected: Back returns to Settings, which proves menu clicks push in-app instead of reloading the app.
6. **Projects filters:**
   - Click Idle, then Measuring, then change Scope, then type a search. The list and the counts follow each change.
   - Browser Back once: it returns to the screen before Projects, not to an earlier filter.
   - If more than 10 projects exist, the table's next and previous page controls work and add no Back steps.
   - Click the status that is already selected: it stays highlighted. Click two statuses quickly: exactly one ends up highlighted, the last one clicked.
   - Change Scope, then press Clear filters straight away: Scope shows "Store and page".
7. **Projects create:** "Create project" opens today's pop-up, and creating a project lands on its page. `?create=1` in the address also opens it.
8. **375 px:**
   - Set the browser pane to 375 px wide, then look at Settings, Plans and Projects.
   - Expected: headers wrap, the table scrolls sideways, the plan cards stack, and nothing is cut off.
   - Also check Projects at 375 px in German: the status buttons ("Messung läuft" is the longest) fit or wrap cleanly. If they overflow, record it: spec 5 allows a select there instead.
   - Reset the width afterwards.
9. **Deutsch pass:** with Deutsch on, look at Settings, Plans and Projects. No English is left in the new text, apart from plan names, prices and "Snapshot".
10. **Throughout:** no console errors, and no unexpected 4xx/5xx in the network log.

**Teardown**

1. Stop `shopify app dev` (Ctrl-C), then run `shopify app dev clean`.
2. Point shep-dev's web pixel back at production. A dev run leaves it on the dead tunnel.

   ```bash
   shopify app execute --store shep-dev.myshopify.com --version 2026-01 -q '{ webPixel { id settings } }'
   ```

   If `apiEndpoint` is not `https://mousewhisperer.vercel.app/api/track?shop=shep-dev.myshopify.com`, update it. Use the `id` printed above:

   ```bash
   VARS=$(node -e 'console.log(JSON.stringify({ id: process.argv[1], webPixel: { settings: JSON.stringify({ apiEndpoint: "https://mousewhisperer.vercel.app/api/track?shop=shep-dev.myshopify.com" }) } }))' "<the id printed above>")
   shopify app execute --store shep-dev.myshopify.com --version 2026-01 -q 'mutation($id: ID!, $webPixel: WebPixelInput!) { webPixelUpdate(id: $id, webPixel: $webPixel) { webPixel { id settings } userErrors { field message } } }' -v "$VARS"
   ```

   Then rerun the first command to confirm.
3. Stop Postgres with `"$PGBIN/pg_ctl" -D "$PGDATA" stop`.

---

## Results

Executed 2026-11-06 to 2026-11-07, subagent-driven: one implementer and one reviewer per task, then a final whole-branch review. Branch `polaris-ui-redesign`, 12 commits on top of 5e978d9. Not pushed or deployed.

**Commits**

- 1a76fc6 Add the navigation rules for the redesigned screens
- 22538a1 Add the Back control and the Polaris event helper
- 10ef08d Replace Upgrade with a Polaris Plans screen that returns you to where you started
- 5f1db67 Add the Settings screen with tracking, language and plan
- 45b6eae Put Projects, A/B tests, Plans and Settings in the app menu
- 2cc93b3 Filter and count projects by status, scope and search
- e405009 Rebuild Projects with Polaris web components, filters and search
- 327f397 Keep Projects filters from being undone by a pending search
- fbef2bd Satisfy the control-character lint rule in safeReturnTo
- fd269d6 Keep Projects filter controls showing the applied filter
- cae73ff Let Retry recheck tracking status after an unknown result
- 29e696e Put the Projects status buttons in the button group's slot

**Reviews**

- Tasks 1–6 were approved first time.
- Task 7 needed fix round 1 (the search debounce could undo filters, and arriving results overwrote typing) and fix round 2 (the status buttons need `slot="secondary-actions"`, found on shep-dev).
- The final review said "With fixes". One fix wave covered the ESLint control-character error, the status/scope controls drifting from the applied filter, explaining comments on two exhaustive-deps omissions, a test-fake guard, and not caching "unknown" tracking status. The re-review was clean.

**Checks (Task 8)**

- run-checks: no regressions.
- The 4 database checks pass on loopback Postgres.
- The build passes.
- tsc: 100 errors (was 101); none on lines this plan changed.
- ESLint: 0 errors in app code.

**shep-dev (Task 9)**

- Pass: menu; Settings (tracking badges, live language switch); title-bar Back pops; fresh Plans → Back replaces with Home; menu clicks push.
- Pass: Upgrade opens Shopify's plan page at the top level, and declining returns to Plans with no banner.
- Pass: Projects status/scope/search filters replace history entries; quick double-click and clicking the active status work; the create pop-up opens.
- Pass: German text; no console errors.
- Partial: checked at about 673 px wide, not exactly 375 px.
- Not run: the approval path, which needs the user's OK.
- Note: Shopify's managed-pricing page lists Standard/Starter/Growth/Scale, not Whisper/Signal. This is Partner Dashboard config and was already the case.

**Rulings made during execution**

- Ruling P1: T6 may leave the old Projects route passing a page number into listGrowthProjects' new filters param until T7 rewrites it — T7 follows immediately and nothing deploys in between; the old screen would only lose paging transiently — cost if wrong: none outside this branch's interim commits.
- Ruling P2: keep a per-file loadModule helper in each new check script — every existing scripts/check-*.mjs carries its own compile helper and run-checks.mjs runs each file standalone; a shared helper module would be a new pattern — cost if wrong: three copies of a 20-line helper to consolidate later.
- Ruling P3: the "no tsc error in a touched file" bar counts only errors on lines a task changed or introduced; older errors elsewhere in a touched file (PremiumGate.tsx:163) stay — the plan's intent is no new type errors, and the pre-existing count is tracked in Task 8 — cost if wrong: one older error left in PremiumGate.tsx.
- Task 7: Ruling: fix both, deviating from the plan's debounce code — spec rule 2 (filters add no Back steps) and filters that actually apply are binding; the plan's code was wrong — cost if wrong: a slightly larger Projects route.
- Final: Ruling: title-bar Back relay, s-app-nav active state and window.open(_top) are runtime behaviours — verified on shep-dev in Task 9 — cost if wrong: Back or Upgrade misbehave in the live admin until fixed.
- Final: Ruling: keep the webPixel-query-returns-null assumption (already relied on by ensureWebPixel) — shep-dev has a pixel so Task 9 cannot show the no-pixel case — cost if wrong: Settings shows "Not verified" with Retry for shops that have never started a measurement.
- Final: Ruling: the managed-pricing welcome link (Partner Dashboard config) is assumed to point at /app/upgrade/return; flag it to the user — cost if wrong: approved upgrades land on Home instead of returning to the start screen.
- Final: Ruling: status filter width at 375 px in German is checked in Task 9 step 8; if it overflows, switch to a select there (spec 5 allows "a select where that doesn't fit") — cost if wrong: a cramped filter on phones.
- Final: Ruling: accept Prisma contains handling of % and _, the 120-char cut splitting a surrogate pair, the "Back" breadcrumb label, close() keeping launch params (unchanged behaviour), deploy skew on isTrackingPayload (Vercel serves one deployment per request), and the embedded-only interceptor — each is low impact or pre-existing — cost if wrong: small cosmetic or edge-case issues.
- Final: Ruling: plan Rulings 3–7 and P1–P3 and the Task 7 fix ruling stand as the reviewer confirmed.
- Final: Ruling: fix Task 9 step 5's "Decline" expectation in the plan (backing out of managed pricing never reaches /app/upgrade/return, so Plans shows no banner) and add the reviewer's extra Task 9 checks — plan text, not code — cost if wrong: none.

**Deferred minors**

- Task 1: minor (deferred): check-navigation.mjs imports React/renderToStaticMarkup unused until Task 2 (plan scaffolding).
- Task 1: minor (deferred): navigation.ts DROPPED_PARAMS and TRANSIENT_PARAMS repeat four names; could share one constant.
- Task 1: minor (deferred): safeReturnTo re-encodes the query via searchParams.toString() (space → +); harmless same-origin.
- Task 2: minor (deferred): useElementEvent resubscribes every render when handlers are inline; reads ref.current only when the effect runs (fine for ProjectsTable, where ref and element mount together).
- Task 2: minor (deferred): check-navigation fake removeEventListener splices index -1 if nothing matches; useElementEvent itself untested (thin wrapper over tested listen).
- Task 3: minor (deferred): Plans route's effect (toast + navigate replace) and Upgrade click wiring untested beyond the pure startUpgrade/finishUpgrade helpers (SSR runs no effects).
- Task 3: minor (deferred): a stale /app/plans?billing=approved bookmark within an hour of an unfinished upgrade redirects to the saved screen (harmless).
- Task 3: minor (deferred): branding check's "Snapshot" surface on plans.ts relies on the Signal tagline only.
- Task 4: minor (deferred): pixel-status cache stores "unknown" for 60s, so Retry can't refresh a transient failure (and embed status stays "missing" up to 60s after turning it on); fix later by not caching "unknown" or adding a fresh bypass.
- Task 4: minor (deferred): app.settings.tsx Status type and STATES repeat WebPixelStatus literals.
- Task 4: minor (deferred): Settings language change path (s-select onChange → change()) untested; check on shep-dev.
- Task 5: minor (deferred): check-framework-upgrade keeps a dead @shopify/app-bridge-react NavMenu mock.
- Task 6: minor (deferred): listGrowthProjects trims but does not cap filters.query (cap lives in parseProjectListFilters; the route always parses first).
- Task 6: minor (deferred): listStatus is recomputed from the second query, so a capture changing state between the two queries could show a badge that differs from the filter (narrow race).
- Task 6: minor (deferred): no DB-level test for status filter combined with a stale page (pure clamp test covers it).
- Task 7: minor (deferred): A→B→A navigation can leave stale entries in the `pending` ref, so a later external Back to B may not resync the search field (rare, no data harm); harness never models a cancelled navigation.
- Task 7: minor (deferred): close() now also passes preventScrollReset (benign).
- Task 7: minor (deferred): no test for the Scope select onChange or the table's nextpage/previouspage wiring; embedded-context test never asserts host survives; harness state.buttons accumulates and find() returns the oldest closure.
- Final: minor (deferred): no loading cue on the projects table during same-path filter/page navigation (pass loading from useNavigation).
- Final: minor (deferred): Home now runs the full project status scan for 5 rows; add a light path if project counts grow.
- Final: minor (deferred): /api/storefront-tracker-status now waits on the pixel lookup too (cached 60 s).
- Final: minor (deferred): Projects search matches title and goal but not the product name shown in the row.
