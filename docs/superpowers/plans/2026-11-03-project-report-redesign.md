# Project Report Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Store Projects a "where to focus" report and Page Projects a page-type-aware report, using data the tracker already stores.

**Architecture:** One SQL query in `getGrowthMeasurementReport` gains new CTEs that compute engagement metrics, the funnel, exit paths, searches, devices and per-page rows for the same filtered cohort. A pure TypeScript function ranks pages by "missed sessions". `GrowthMeasurementResults` picks a Store or Page layout from the report, composed of four new focused section components; the shared `EngagementOutcomesView` is reworked (images first, one merged bar on image cards).

**Tech Stack:** Remix v2, React 18, Polaris v12, Prisma 6 raw SQL on PostgreSQL 17, Node 22 `node:test` scripts that transpile TS with `typescript.transpileModule`.

**Spec:** `docs/superpowers/specs/2026-11-03-project-report-redesign-design.md`

## Global Constraints

- No changes to `extensions/`, `prisma/schema.prisma` or `prisma/migrations/`. Reporting only.
- Never run any command with the database from `.env`; it is the production database. Database tests use only a disposable loopback cluster (`127.0.0.1`), and every database command sets **both** `DATABASE_URL` and `DIRECT_URL` explicitly.
- PostgreSQL 16 or later is required for `pg_input_is_valid` (production runs 17.6; local `postgresql@17` is at `/opt/homebrew/opt/postgresql@17/bin`).
- A session is `COALESCE(acquisitionId, sessionId)`. Every new number uses the same filtered cohort (All/Active, source, medium, campaign) as the existing report.
- Thresholds, copied from the spec: rank pages with ≥ 20 sessions; a type needs ≥ 3 eligible pages; top 3 pages get "Focus here"; top 5 searches, next pages and exit pages; a search term needs ≥ 2 sessions; tables show 10 rows per page.
- Every UI string is a literal first argument to `t()` and must exist in `app/locales/catalog.ts` with German, Simplified Chinese and Traditional Chinese entries. Add only the keys that `node scripts/check-i18n.mjs --list-missing` reports, using the translation table in the task.
- Use only Polaris v12 components already used in the repo (`Card`, `BlockStack`, `InlineStack`, `InlineGrid`, `Text`, `DataTable`, `Badge`, `Box`, `Pagination`, `ProgressBar`, `Banner`, `Button`). Before using a prop not shown in this plan, check its type in `node_modules/@shopify/polaris/build/ts/src/components/<Name>/<Name>.d.ts`.
- Do not create git commits until the user has approved committing. Each task's "Commit" step is where to commit once they have.

## Review Focus

1. **Locale-prefixed store URLs** (Shopify Markets, e.g. `/en-us/products/x`, `/fr/products/x`): a collection's click-through to such a product must count. Pinned in Task 2 (sessions `acq_a`, `acq_d`).
2. **Malformed or truncated `ctaClicks` JSON** (the tracker truncates at 10,000 characters): the whole report must still load, and that page view must not be dropped. Pinned in Task 2 (session `acq_d`).
3. **Filters that match no sessions**: every section must show zeros or an empty state, never `NaN`, `null` text or a crash. Pinned in Task 2 (`campaign: "nothing"`) and Task 6 (empty-report render).
4. **A search term used by only one session** (could contain a name or email): must never appear in Top searches. Pinned in Task 2 (session `acq_c`).
5. **Imported Channel/Customer-backed measurements**: new sections show "Not recorded for this measurement", not zeros. Pinned in Task 2 (channel fixture) and Task 6 (render).

---

## File map

| File | Responsibility |
| --- | --- |
| `app/utils/growth-report.ts` (modify) | Report types, exit outcome order, pure `pageKeyRate` / `rankGrowthPages` |
| `app/utils/growth-report.server.ts` (modify) | One SQL query producing all report sections |
| `app/components/EngagementOutcomes.tsx` (modify) | Images first, no row bars, merged image bar |
| `app/components/GrowthConversionFunnel.tsx` (create) | Store funnel card |
| `app/components/GrowthEngagementMetrics.tsx` (create) | Engagement metrics card (store and page variants) |
| `app/components/GrowthExitPaths.tsx` (create) | Page exit paths card |
| `app/components/GrowthSessionsByPage.tsx` (create) | Store sessions-by-page ranking table |
| `app/components/GrowthMeasurementResults.tsx` (modify) | Chooses Store or Page layout, drops the chart |
| `app/locales/catalog.ts` (modify) | New translations |
| `scripts/check-growth-report-ranking.mjs` (create) | Ranking unit tests, no database |
| `scripts/check-growth-report-sections.mjs` (create) | Real-SQL tests for the new sections |
| `scripts/check-growth-reports.mjs` (modify) | Add the new `./growth-report` mock |
| `scripts/check-engagement-outcomes.mjs` (modify) | Update view render tests |
| `scripts/check-growth-report-ui.mjs` (create) | Render tests for new components and layouts |
| `scripts/preview-project-translations.mjs` (modify) | Fixture data for visual QA |

---

### Task 1: Page ranking helpers

**Files:**
- Modify: `app/utils/growth-report.ts` (append after the existing `GrowthReport` type)
- Test: `scripts/check-growth-report-ranking.mjs` (create)

**Interfaces:**
- Consumes: nothing.
- Produces (exported from `app/utils/growth-report.ts`):
  - `type GrowthReportLayout = "store" | "page"`
  - `type GrowthPageType = "PRODUCT" | "COLLECTION" | "PAGE" | "BLOG" | "HOMEPAGE"`
  - `type GrowthEngagementSummary`, `type GrowthFunnel`, `const EXIT_OUTCOMES`, `type GrowthExitOutcome`, `type GrowthExitPaths`, `type GrowthPageRow`, `type RankedGrowthPage` (exact shapes in Step 3)
  - `PAGE_RANK_MIN_SESSIONS = 20`, `PAGE_RANK_MIN_PAGES = 3`, `PAGE_FOCUS_COUNT = 3`
  - `pageKeyRate(row: GrowthPageRow): number | null`
  - `rankGrowthPages(rows: GrowthPageRow[]): RankedGrowthPage[]`

- [ ] **Step 1: Install dependencies**

`node_modules` is not installed. Run:

```bash
npm install
```

Expected: completes and runs `prisma generate` (postinstall). No database is contacted.

- [ ] **Step 2: Write the failing test**

Create `scripts/check-growth-report-ranking.mjs`:

```js
// Database-free checks for the Store "missed sessions" ranking.
// Run: node --test scripts/check-growth-report-ranking.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const mod = { exports: {} };
runInNewContext(
  ts.transpileModule(
    readFileSync(new URL("../app/utils/growth-report.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { module: mod, exports: mod.exports, URLSearchParams },
);
const { pageKeyRate, rankGrowthPages, EXIT_OUTCOMES } = mod.exports;
// Values built inside the VM have another realm's prototypes.
const plain = (value) => JSON.parse(JSON.stringify(value));
const page = (path, type, sessions, extra = {}) => ({
  path,
  type,
  sessions,
  carts: 0,
  forwards: 0,
  conversions: 0,
  exits: 0,
  ...extra,
});

test("key rate is add-to-cart for products and click-through for other page types", () => {
  assert.equal(pageKeyRate(page("/products/a", "PRODUCT", 50, { carts: 10, forwards: 40 })), 20);
  assert.equal(pageKeyRate(page("/collections/a", "COLLECTION", 50, { carts: 10, forwards: 40 })), 80);
  assert.equal(pageKeyRate(page("/", "HOMEPAGE", 50, { forwards: 5 })), 10);
  assert.equal(pageKeyRate(page("/blogs/news/post", "BLOG", 50, { forwards: 25 })), 50);
  assert.equal(pageKeyRate(page("/search", null, 50, { forwards: 5 })), null);
  assert.equal(pageKeyRate(page("/pages/a", "PAGE", 0)), null);
});

test("missed sessions compare a page with the median rate of its type", () => {
  const ranked = rankGrowthPages([
    page("/collections/a", "COLLECTION", 100, { forwards: 40 }),
    page("/collections/b", "COLLECTION", 100, { forwards: 30 }),
    page("/collections/c", "COLLECTION", 200, { forwards: 40 }),
  ]);
  const byPath = Object.fromEntries(ranked.map((row) => [row.path, row]));
  assert.equal(byPath["/collections/c"].typicalRate, 30);
  assert.equal(byPath["/collections/c"].missed, 20);
  assert.equal(byPath["/collections/c"].focus, true);
  assert.equal(byPath["/collections/a"].missed, 0);
  assert.equal(byPath["/collections/a"].focus, false);
  assert.equal(byPath["/collections/b"].missed, 0);
  assert.equal(ranked[0].path, "/collections/c");
});

test("small pages and types with fewer than 3 eligible pages are listed but never ranked", () => {
  const ranked = rankGrowthPages([
    page("/products/a", "PRODUCT", 100, { carts: 30 }),
    page("/products/b", "PRODUCT", 100, { carts: 10 }),
    page("/products/c", "PRODUCT", 19),
    page("/blogs/news", "BLOG", 500, { forwards: 5 }),
  ]);
  assert.equal(ranked.length, 4);
  for (const row of ranked) {
    assert.equal(row.missed, null);
    assert.equal(row.typicalRate, null);
    assert.equal(row.focus, false);
  }
  assert.deepEqual(plain(ranked.map((row) => row.path)), [
    "/blogs/news",
    "/products/a",
    "/products/b",
    "/products/c",
  ]);
});

test("only the top three pages with missed sessions get a focus badge", () => {
  const ranked = rankGrowthPages(
    [10, 20, 30, 40, 50, 60].map((forwards, i) =>
      page(`/pages/p${i}`, "PAGE", 100, { forwards }),
    ),
  );
  assert.deepEqual(plain(ranked.filter((row) => row.focus).map((row) => row.path)), [
    "/pages/p0",
    "/pages/p1",
    "/pages/p2",
  ]);
  assert.deepEqual(plain(ranked.slice(0, 4).map((row) => row.missed)), [25, 15, 5, 0]);
});

test("exit and conversion rates are shares of sessions that viewed the page", () => {
  const [row] = rankGrowthPages([
    page("/products/a", "PRODUCT", 40, { exits: 10, conversions: 2 }),
  ]);
  assert.equal(row.exitRate, 25);
  assert.equal(row.conversionRate, 5);
  const [empty] = rankGrowthPages([page("/pages/empty", "PAGE", 0)]);
  assert.equal(empty.exitRate, 0);
  assert.equal(empty.conversionRate, 0);
  assert.equal(empty.keyRate, null);
});

test("exit outcomes have a fixed display order", () => {
  assert.deepEqual(plain(EXIT_OUTCOMES), [
    "internal_link",
    "checkout",
    "back_button",
    "window_closed",
    "idle",
    "external_link",
    "unknown",
  ]);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test scripts/check-growth-report-ranking.mjs`
Expected: FAIL — `pageKeyRate is not a function` (or `EXIT_OUTCOMES` undefined).

- [ ] **Step 4: Write the implementation**

Append to `app/utils/growth-report.ts` (after the `GrowthReport` type; do not change `GrowthReport` yet, Task 2 does):

```ts
export type GrowthReportLayout = "store" | "page";
export type GrowthPageType =
  | "PRODUCT"
  | "COLLECTION"
  | "PAGE"
  | "BLOG"
  | "HOMEPAGE";
export type GrowthEngagementSummary = {
  available: boolean;
  timeMedianSeconds: number;
  pagesPerSession: number;
  averageScroll: number;
  clickThroughRate: number;
  searchRate: number;
  topSearches: Array<{ term: string; sessions: number }>;
  devices: Array<{
    device: string;
    sessions: number;
    share: number;
    conversionRate: number;
  }>;
};
export type GrowthFunnel = {
  sessions: number;
  addedToCart: number;
  checkoutStarted: number;
  purchased: number;
};
// Tracker exit types in display order; "unknown" collects page views with none.
export const EXIT_OUTCOMES = [
  "internal_link",
  "checkout",
  "back_button",
  "window_closed",
  "idle",
  "external_link",
  "unknown",
] as const;
export type GrowthExitOutcome = (typeof EXIT_OUTCOMES)[number];
export type GrowthExitPaths = {
  available: boolean;
  outcomes: Array<{ type: GrowthExitOutcome; pageViews: number; share: number }>;
  nextPages: Array<{ path: string; pageViews: number }>;
  exitPages: Array<{
    path: string;
    exits: number;
    sessions: number;
    exitRate: number;
  }>;
};
export type GrowthPageRow = {
  path: string;
  type: string | null;
  sessions: number;
  carts: number;
  forwards: number;
  conversions: number;
  exits: number;
};
export type RankedGrowthPage = GrowthPageRow & {
  keyRate: number | null;
  exitRate: number;
  conversionRate: number;
  typicalRate: number | null;
  missed: number | null;
  focus: boolean;
};

export const PAGE_RANK_MIN_SESSIONS = 20;
export const PAGE_RANK_MIN_PAGES = 3;
export const PAGE_FOCUS_COUNT = 3;
const CLICK_THROUGH_TYPES = new Set(["COLLECTION", "PAGE", "BLOG", "HOMEPAGE"]);
const share = (part: number, whole: number) => (whole ? (100 * part) / whole : 0);

// Products move forward by adding to cart; every other page type by a click-through.
export function pageKeyRate(row: GrowthPageRow): number | null {
  if (!row.sessions) return null;
  if (row.type === "PRODUCT") return share(row.carts, row.sessions);
  if (row.type && CLICK_THROUGH_TYPES.has(row.type))
    return share(row.forwards, row.sessions);
  return null;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Missed sessions: how many more sessions would have moved forward if the page
// matched the typical (median) page of its type in this measurement.
export function rankGrowthPages(rows: GrowthPageRow[]): RankedGrowthPage[] {
  const eligible = new Map<string, number[]>();
  for (const row of rows) {
    const keyRate = pageKeyRate(row);
    if (keyRate === null || !row.type || row.sessions < PAGE_RANK_MIN_SESSIONS)
      continue;
    eligible.set(row.type, [...(eligible.get(row.type) || []), keyRate]);
  }
  const typical = new Map<string, number>();
  for (const [type, rates] of eligible)
    if (rates.length >= PAGE_RANK_MIN_PAGES) typical.set(type, median(rates));
  const ranked: RankedGrowthPage[] = rows.map((row) => {
    const keyRate = pageKeyRate(row);
    const typicalRate =
      row.type && row.sessions >= PAGE_RANK_MIN_SESSIONS
        ? (typical.get(row.type) ?? null)
        : null;
    const comparable = keyRate !== null && typicalRate !== null;
    return {
      ...row,
      keyRate,
      exitRate: share(row.exits, row.sessions),
      conversionRate: share(row.conversions, row.sessions),
      typicalRate: comparable ? typicalRate : null,
      missed: comparable
        ? Math.max(0, Math.round((row.sessions * (typicalRate - keyRate)) / 100))
        : null,
      focus: false,
    };
  });
  ranked.sort(
    (a, b) =>
      (b.missed ?? -1) - (a.missed ?? -1) ||
      b.sessions - a.sessions ||
      a.path.localeCompare(b.path),
  );
  let focused = 0;
  for (const row of ranked) {
    if (focused === PAGE_FOCUS_COUNT) break;
    if ((row.missed ?? 0) > 0) {
      row.focus = true;
      focused += 1;
    }
  }
  return ranked;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test scripts/check-growth-report-ranking.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit** (only once the user has approved commits)

```bash
git add app/utils/growth-report.ts scripts/check-growth-report-ranking.mjs
git commit -m "Add missed-sessions ranking for Store Project pages"
```

---

### Task 2: Report service sections

**Files:**
- Modify: `app/utils/growth-report.ts` (the `GrowthReport` type)
- Modify: `app/utils/growth-report.server.ts` (whole file)
- Modify: `scripts/check-growth-reports.mjs:42-47` (add one mock)
- Modify: `docs/superpowers/specs/2026-11-03-project-report-redesign-design.md` (Testing section, one bullet)
- Test: `scripts/check-growth-report-sections.mjs` (create)

**Interfaces:**
- Consumes: everything Task 1 exports from `app/utils/growth-report.ts`.
- Produces: `getGrowthMeasurementReport(shop, projectId, measurementId, filters): Promise<GrowthReport>` (same signature) whose `GrowthReport` now also has:
  - `layout: GrowthReportLayout` — from the Project's scope
  - `pageType: GrowthPageType | null` — the Page Project's resource type, `null` for Store
  - `funnel: GrowthFunnel`
  - `engagementSummary: GrowthEngagementSummary`
  - `exitPaths: GrowthExitPaths` — `outcomes` always has all 7 `EXIT_OUTCOMES` in order (zeros included)
  - `pages: RankedGrowthPage[]` — Store layout only; `[]` otherwise

- [ ] **Step 1: Start a disposable PostgreSQL cluster**

Pick an empty temp directory outside the repo (for example your scratchpad directory) and use its absolute path wherever `<PGDIR>` appears. Then run:

```bash
/opt/homebrew/opt/postgresql@17/bin/initdb -D <PGDIR>/data -U growth_test --auth=trust
```

```bash
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D <PGDIR>/data -l <PGDIR>/server.log -o "-p 55443 -c listen_addresses=127.0.0.1 -k <PGDIR>" start
```

```bash
/opt/homebrew/opt/postgresql@17/bin/createdb -h 127.0.0.1 -p 55443 -U growth_test growth_report_test
```

```bash
DATABASE_URL='postgresql://growth_test@127.0.0.1:55443/growth_report_test' DIRECT_URL='postgresql://growth_test@127.0.0.1:55443/growth_report_test' npx prisma db push --skip-generate
```

Expected: the last command ends with "Your database is now in sync with your Prisma schema". (`db push` is used because the historical migration chain cannot bootstrap an empty database; see `docs/projects-implementation-2026-10-22.md`.)

- [ ] **Step 2: Write the failing test**

Create `scripts/check-growth-report-sections.mjs`:

```js
// Real SQL checks for the redesigned Project report sections.
// Disposable loopback database only:
// GROWTH_TEST_DATABASE_URL='postgresql://growth_test@127.0.0.1:55443/growth_report_test' node scripts/check-growth-report-sections.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { PrismaClient } from "@prisma/client";
import ts from "typescript";
const require = createRequire(import.meta.url);
const url = process.env.GROWTH_TEST_DATABASE_URL;
assert.ok(
  url && ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
  "Explicit disposable local DB required",
);
const db = new PrismaClient({ datasources: { db: { url } } });
const shop = `report-sections-${randomUUID()}.myshopify.com`;
function compile(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(
    readFileSync(new URL(`../app/utils/${file}.ts`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    },
  ).outputText;
  runInNewContext(code, {
    module,
    exports: module.exports,
    URL,
    URLSearchParams,
    Date,
    console,
    require: (key) => (key in mocks ? mocks[key] : require(key)),
  });
  return module.exports;
}
const reportPure = compile("growth-report");
const service = compile("growth-report.server", {
  "../db.server": db,
  "./growth-projects": compile("growth-projects"),
  "./click-engagement": compile("click-engagement"),
  "./growth-report": reportPure,
});
const plain = (value) => JSON.parse(JSON.stringify(value));
const all = { audience: "all", source: "", medium: "", campaign: "" };
const t0 = new Date("2026-10-22T10:00:00Z");
const later = (minutes) => new Date(t0.getTime() + minutes * 60_000);
const click = (zone) => JSON.stringify([{ label: "Card", tag: "a", zone }]);
const report = (projectId, measurementId, filters = all) =>
  service.getGrowthMeasurementReport(shop, projectId, measurementId, filters);
try {
  // Store Project: five sessions across collection, product, page and homepage.
  const storeProject = await db.growthProject.create({
    data: { shop, title: "Store", goal: "Find focus pages", scope: "STORE" },
  });
  const store = await db.storeSnapshot.create({
    data: {
      shop,
      name: "Store fixture",
      completionMode: "TIME_WINDOW",
      durationDays: 7,
      endsAt: new Date("2026-12-31"),
      usesAcquisitionSessions: true,
    },
  });
  const storeMeasurement = await db.growthMeasurement.create({
    data: {
      projectId: storeProject.id,
      name: "Store baseline",
      completionMode: "DURATION",
      durationDays: 7,
      storeSnapshotId: store.id,
    },
  });
  const view = (pageViewId, acquisitionId, visitorType, pagePath, resourceType, extra = {}) => ({
    storeSnapshotId: store.id,
    sessionId: `browser-${acquisitionId}`,
    pageViewId,
    pagePath,
    resourceType,
    visitorType,
    acquisitionId,
    acquisitionSource: "facebook",
    acquisitionStartedAt: t0,
    startedAt: t0,
    timeOnPage: 0,
    scrollDepth: 50,
    ...extra,
  });
  await db.storeSnapshotVisit.createMany({
    data: [
      // Image inside a product card: ctaClicks holds the image, exitUrl the product (locale-prefixed).
      view("a1", "acq_a", "REAL", "/collections/shoes", "COLLECTION", {
        exitType: "internal_link",
        exitUrl: "https://shop.example/en-us/products/red-shoe?variant=1",
        ctaClicks: JSON.stringify([
          { label: "Red shoe", tag: "img", href: "https://cdn.shopify.com/red.jpg", zone: "main" },
        ]),
        deviceType: "desktop",
        searchQuery: "Red Shoes ",
        timeOnPage: 30000,
      }),
      view("a2", "acq_a", "REAL", "/products/red-shoe", "PRODUCT", {
        startedAt: later(1),
        addedToCart: true,
        checkoutStarted: true,
        converted: true,
        exitType: "checkout",
        deviceType: "desktop",
        timeOnPage: 60000,
        scrollDepth: 100,
      }),
      // Collection to a content page is not a product click-through.
      view("b1", "acq_b", "REAL", "/collections/shoes", "COLLECTION", {
        exitType: "internal_link",
        exitUrl: "https://shop.example/pages/about",
        ctaClicks: click("main"),
        deviceType: "mobile",
        searchQuery: "red shoes",
        timeOnPage: 20000,
      }),
      // Menu navigation does not count; a one-session search term is never listed.
      view("c1", "acq_c", "ZOMBIE", "/collections/shoes", "COLLECTION", {
        exitType: "internal_link",
        exitUrl: "https://shop.example/products/blue",
        ctaClicks: click("header"),
        deviceType: "mobile",
        searchQuery: "john@example.com",
        timeOnPage: 4000,
      }),
      // Truncated click JSON must not break the report or drop the click-through.
      view("d1", "acq_d", "REAL", "/pages/about", "PAGE", {
        exitType: "internal_link",
        exitUrl: "https://shop.example/fr/products/x",
        ctaClicks: '[{"label":"Broken"',
        deviceType: "tablet",
        timeOnPage: 30000,
      }),
      view("e1", "acq_e", "BOT", "/", "HOMEPAGE", {
        exitType: "window_closed",
        deviceType: "desktop",
      }),
    ],
  });

  const storeReport = await report(storeProject.id, storeMeasurement.id);
  assert.equal(storeReport.layout, "store");
  assert.equal(storeReport.pageType, null);
  assert.deepEqual(plain(storeReport.funnel), {
    sessions: 5,
    addedToCart: 1,
    checkoutStarted: 1,
    purchased: 1,
  });
  const summary = storeReport.engagementSummary;
  assert.equal(summary.available, true);
  assert.equal(
    summary.clickThroughRate,
    40,
    "Image-in-card, locale-prefixed and malformed-JSON page views count; menu clicks and collection-to-page do not",
  );
  assert.equal(summary.searchRate, 60);
  assert.deepEqual(plain(summary.topSearches), [{ term: "red shoes", sessions: 2 }]);
  assert.equal(summary.timeMedianSeconds, 20);
  assert.equal(summary.pagesPerSession, 1.2);
  assert.deepEqual(
    plain(summary.devices).map((row) => [row.device, row.sessions, row.conversionRate]),
    [
      ["desktop", 2, 50],
      ["mobile", 2, 0],
      ["tablet", 1, 0],
    ],
  );
  const shoes = storeReport.pages.find((row) => row.path === "/collections/shoes");
  assert.deepEqual(
    [shoes.type, shoes.sessions, shoes.forwards, shoes.exits],
    ["COLLECTION", 3, 1, 2],
  );
  const product = storeReport.pages.find((row) => row.path === "/products/red-shoe");
  assert.deepEqual(
    [product.sessions, product.carts, product.conversions, product.exits],
    [1, 1, 1, 1],
  );
  assert.equal(storeReport.exitPaths.exitPages[0].path, "/collections/shoes");
  assert.equal(Math.round(storeReport.exitPaths.exitPages[0].exitRate), 67);

  const active = await report(storeProject.id, storeMeasurement.id, {
    ...all,
    audience: "active",
  });
  assert.equal(active.funnel.sessions, 3);
  assert.equal(Math.round(active.engagementSummary.clickThroughRate), 67);
  assert.equal(active.pages.find((row) => row.path === "/collections/shoes").sessions, 2);

  const none = await report(storeProject.id, storeMeasurement.id, {
    ...all,
    campaign: "nothing",
  });
  assert.equal(none.funnel.sessions, 0);
  assert.equal(none.engagementSummary.timeMedianSeconds, 0);
  assert.equal(none.engagementSummary.clickThroughRate, 0);
  assert.equal(none.engagementSummary.pagesPerSession, 0);
  assert.deepEqual(plain(none.pages), []);
  assert.equal(none.exitPaths.outcomes.length, 7);
  assert.ok(none.exitPaths.outcomes.every((row) => row.pageViews === 0 && row.share === 0));

  // Page Project on a collection: only clicks to a product count.
  const resource = await db.project.create({
    data: {
      shop,
      resourceType: "COLLECTION",
      productId: "gid://shopify/Collection/1",
      productTitle: "Shoes",
      productHandle: "shoes",
    },
  });
  const pageProject = await db.growthProject.create({
    data: { shop, title: "Shoes", goal: "More product clicks", scope: "PAGE", resourceProjectId: resource.id },
  });
  const snapshot = await db.snapshot.create({
    data: { projectId: resource.id, number: 1, usesAcquisitionSessions: true },
  });
  const pageMeasurement = await db.growthMeasurement.create({
    data: {
      projectId: pageProject.id,
      name: "Page baseline",
      completionMode: "VISITORS",
      targetVisitors: 100,
      snapshotId: snapshot.id,
    },
  });
  const visit = (pageViewId, acquisitionId, extra = {}) => ({
    snapshotId: snapshot.id,
    sessionId: `browser-${acquisitionId}`,
    pageViewId,
    acquisitionId,
    acquisitionSource: "google",
    acquisitionStartedAt: t0,
    startedAt: t0,
    visitorType: "REAL",
    ...extra,
  });
  await db.visit.createMany({
    data: [
      visit("p1", "acq_p1", {
        exitType: "internal_link",
        exitUrl: "https://shop.example/products/a?x=1#top",
        ctaClicks: click("main"),
      }),
      visit("p2", "acq_p2", {
        exitType: "internal_link",
        exitUrl: "https://shop.example/account/orders/123",
        ctaClicks: click("main"),
      }),
      visit("p3", "acq_p3", { exitType: "back_button" }),
      visit("p4", "acq_p4"),
    ],
  });
  const pageReport = await report(pageProject.id, pageMeasurement.id);
  assert.equal(pageReport.layout, "page");
  assert.equal(pageReport.pageType, "COLLECTION");
  assert.equal(pageReport.engagementSummary.clickThroughRate, 25);
  assert.deepEqual(
    plain(pageReport.exitPaths.outcomes)
      .filter((row) => row.pageViews)
      .map((row) => [row.type, row.pageViews]),
    [
      ["internal_link", 2],
      ["back_button", 1],
      ["unknown", 1],
    ],
  );
  assert.deepEqual(
    plain(pageReport.exitPaths.nextPages).map((row) => row.path).sort(),
    ["/private-page", "/products/a"],
    "Query strings are removed and account paths are masked",
  );
  assert.deepEqual(plain(pageReport.pages), []);

  // Imported Channel measurement: no page-level data was ever recorded.
  const channel = await db.channelSnapshot.create({ data: { shop, name: "Imported" } });
  await db.channelSnapshotSession.create({
    data: {
      channelSnapshotId: channel.id,
      acquisitionId: "acq_channel",
      trackingSessionId: "browser-channel",
      source: "facebook",
      addedToCart: true,
      checkoutStarted: true,
    },
  });
  const channelProject = await db.growthProject.create({
    data: { shop, title: "Imported", goal: "", scope: "STORE" },
  });
  const channelMeasurement = await db.growthMeasurement.create({
    data: {
      projectId: channelProject.id,
      name: "Imported",
      completionMode: "VISITORS",
      targetVisitors: 100,
      channelSnapshotId: channel.id,
    },
  });
  const imported = await report(channelProject.id, channelMeasurement.id);
  assert.equal(imported.engagementSummary.available, false);
  assert.equal(imported.exitPaths.available, false);
  assert.deepEqual(plain(imported.funnel), {
    sessions: 1,
    addedToCart: 1,
    checkoutStarted: 1,
    purchased: 0,
  });
  assert.deepEqual(plain(imported.pages), []);
  console.log(
    "PASS: funnel, click-through rule, searches, devices, medians, exit paths, page rows, cohorts, empty filters and imported measurements",
  );
} finally {
  await db.growthProject.deleteMany({ where: { shop } });
  await db.project.deleteMany({ where: { shop } });
  await db.storeSnapshot.deleteMany({ where: { shop } });
  await db.channelSnapshot.deleteMany({ where: { shop } });
  await db.$disconnect();
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `GROWTH_TEST_DATABASE_URL='postgresql://growth_test@127.0.0.1:55443/growth_report_test' node scripts/check-growth-report-sections.mjs`
Expected: FAIL — `AssertionError` on `storeReport.layout` (`undefined !== "store"`).

- [ ] **Step 4: Extend the `GrowthReport` type**

In `app/utils/growth-report.ts`, add these fields to the end of the existing `GrowthReport` type (after `engagementUnavailable: boolean;`):

```ts
  layout: GrowthReportLayout;
  pageType: GrowthPageType | null;
  funnel: GrowthFunnel;
  engagementSummary: GrowthEngagementSummary;
  exitPaths: GrowthExitPaths;
  pages: RankedGrowthPage[];
```

- [ ] **Step 5: Replace the report service**

Replace the whole of `app/utils/growth-report.server.ts` with:

```ts
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { GrowthProjectError } from "./growth-projects";
import { buildEngagementOutcomes } from "./click-engagement";
import { EXIT_OUTCOMES, rankGrowthPages } from "./growth-report";
import type {
  GrowthEngagementSummary,
  GrowthExitPaths,
  GrowthPageRow,
  GrowthPageType,
  GrowthReport,
  GrowthReportFilters,
} from "./growth-report";
// Shopify Markets paths can carry a locale prefix such as /fr or /en-us.
const PRODUCT_PATH = "^(/[a-z]{2}(-[a-z]{2})?)?/products/";
const PRIVATE_PATH = "/(account|accounts|checkouts|orders)(/|$)";
type ClickRow = {
  sessionId: string;
  ctaClicks: string | null;
  addedToCart: boolean;
  converted: boolean;
};
type QueryReport = Omit<
  GrowthReport,
  | "layout"
  | "pageType"
  | "funnel"
  | "engagementSummary"
  | "exitPaths"
  | "pages"
  | "engagement"
  | "engagementUnavailable"
> & {
  clickRows: ClickRow[];
  checkoutStarted: number;
  timeMedian: number;
  pagesPerSession: number;
  viewScroll: number;
  clickThroughRate: number;
  searchRate: number;
  devices: GrowthEngagementSummary["devices"];
  searches: GrowthEngagementSummary["topSearches"];
  exits: Array<{ type: string; pageViews: number; share: number }>;
  nextPages: GrowthExitPaths["nextPages"];
  exitPages: GrowthExitPaths["exitPages"];
  pageRows: GrowthPageRow[];
};
export async function getGrowthMeasurementReport(
  shop: string,
  projectId: string,
  measurementId: string,
  filters: GrowthReportFilters,
): Promise<GrowthReport> {
  const capture = await prisma.growthMeasurement.findFirst({
    where: { id: measurementId, projectId, project: { shop } },
    include: {
      project: {
        select: {
          scope: true,
          resourceProject: { select: { resourceType: true } },
        },
      },
    },
  });
  if (!capture) throw new GrowthProjectError("Measurement not found.", 404);
  const layout = capture.project.scope === "STORE" ? "store" : "page";
  const pageType = (capture.project.resourceProject?.resourceType ??
    null) as GrowthPageType | null;
  // Imported Channel/Customer captures never recorded exits, devices, searches or clicks.
  const detailed = Boolean(capture.snapshotId || capture.storeSnapshotId);
  let rows: Prisma.Sql;
  if (capture.snapshotId || capture.storeSnapshotId) {
    const table = capture.snapshotId
      ? Prisma.sql`"Visit"`
      : Prisma.sql`"StoreSnapshotVisit"`;
    const constraint = capture.snapshotId
      ? Prisma.sql`"snapshotId" = ${capture.snapshotId}`
      : Prisma.sql`"storeSnapshotId" = ${capture.storeSnapshotId}`;
    // Page captures only record the Project's own page, so its type is the Project's.
    const path = capture.snapshotId ? Prisma.sql`NULL::text` : Prisma.sql`"pagePath"`;
    const type = capture.snapshotId
      ? Prisma.sql`CAST(${pageType} AS text)`
      : Prisma.sql`"resourceType"::text`;
    rows = Prisma.sql`SELECT COALESCE("acquisitionId", "sessionId") AS id, COALESCE("acquisitionStartedAt", "startedAt") AS "startedAt", "startedAt" AS "viewedAt", "visitorType"::text AS kind,
      CASE WHEN "acquisitionId" IS NOT NULL THEN "acquisitionSource" ELSE source END AS source,
      CASE WHEN "acquisitionId" IS NOT NULL THEN "acquisitionMedium" ELSE medium END AS medium,
      CASE WHEN "acquisitionId" IS NOT NULL THEN "acquisitionCampaign" ELSE campaign END AS campaign,
      "addedToCart", "checkoutStarted" AS checkout, converted, 1 AS views, "timeOnPage"::float AS time, "scrollDepth"::float AS scroll, "ctaClicks",
      ${path} AS path, ${type} AS "type", "exitType", "exitUrl", "deviceType" AS device, "searchQuery" AS search
      FROM ${table} WHERE ${constraint}`;
  } else if (capture.channelSnapshotId) {
    rows = Prisma.sql`SELECT s.id, s."startedAt", COALESCE(v."startedAt", s."startedAt") AS "viewedAt", COALESCE(v."visitorType"::text, 'PENDING') AS kind, s.source, s.medium, s.campaign,
      s."addedToCart", s."checkoutStarted" AS checkout, s.converted, CASE WHEN v.id IS NULL THEN 0 ELSE 1 END AS views,
      COALESCE(v."timeOnPage",0)::float AS time, COALESCE(v."scrollDepth",0)::float AS scroll, NULL::text AS "ctaClicks",
      NULL::text AS path, NULL::text AS "type", NULL::text AS "exitType", NULL::text AS "exitUrl", NULL::text AS device, NULL::text AS search
      FROM "ChannelSnapshotSession" s LEFT JOIN "ChannelSnapshotVisit" v ON v."sessionId" = s.id WHERE s."channelSnapshotId" = ${capture.channelSnapshotId}`;
  } else if (capture.customerSnapshotId) {
    rows = Prisma.sql`SELECT s.id, s."startedAt", COALESCE(p."startedAt", s."startedAt") AS "viewedAt", s."visitorType"::text AS kind, s.source, s.medium, s.campaign,
      s."addedToCart", s."checkoutStarted" AS checkout, s.converted, CASE WHEN p.id IS NULL THEN 0 ELSE 1 END AS views,
      COALESCE(p."timeOnPage",0)::float AS time, COALESCE(p."scrollDepth",0)::float AS scroll, NULL::text AS "ctaClicks",
      NULL::text AS path, NULL::text AS "type", NULL::text AS "exitType", NULL::text AS "exitUrl", NULL::text AS device, NULL::text AS search
      FROM "CustomerJourneySession" s LEFT JOIN "CustomerJourneyPage" p ON p."sessionId" = s.id WHERE s."snapshotId" = ${capture.customerSnapshotId}`;
  } else throw new GrowthProjectError("Measurement data is unavailable.", 404);
  // Group before filtering so the numerator and denominator share an audience.
  // This is read-only reporting; filters never change capture or attribution.
  const cohort = Prisma.sql`${filters.audience === "active" ? Prisma.sql`kind = 'REAL'` : Prisma.sql`TRUE`}
    AND (${filters.source} = '' OR lower(source) = lower(${filters.source}))
    AND (${filters.medium} = '' OR lower(medium) = lower(${filters.medium}))
    AND (${filters.campaign} = '' OR lower(campaign) = lower(${filters.campaign}))`;
  const results = await prisma.$queryRaw<Array<{ report: QueryReport }>>(Prisma.sql`
    WITH raw AS (${rows}), parsed AS (
      -- exitUrl is set by the tracker for link clicks; the cart/checkout links are typed "checkout".
      SELECT raw.*,
        CASE WHEN "exitType" = 'internal_link' THEN regexp_replace(regexp_replace("exitUrl", '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]*', ''), '[?#].*$', '') END AS "exitPath",
        -- Nested CASE: the jsonb cast must only run on valid JSON (truncated payloads exist).
        CASE WHEN pg_input_is_valid("ctaClicks", 'jsonb') THEN
          CASE WHEN jsonb_typeof("ctaClicks"::jsonb) = 'array' THEN lower("ctaClicks"::jsonb -> -1 ->> 'zone') END
        END AS "lastZone"
      FROM raw
    ), marked AS (
      -- A forward click left from the main content to another store page; collections only to a product.
      SELECT parsed.*, COALESCE(
        "exitPath" LIKE '/%'
        AND ("type" IS DISTINCT FROM 'COLLECTION' OR "exitPath" ~* ${PRODUCT_PATH})
        AND COALESCE("lastZone", '') NOT IN ('header', 'footer'), false) AS forward
      FROM parsed
    ), sessions AS (
      SELECT id, MIN("startedAt") AS started,
        CASE WHEN bool_or(kind = 'REAL') THEN 'REAL' WHEN bool_or(kind = 'ZOMBIE') THEN 'ZOMBIE' WHEN bool_or(kind = 'BOT') THEN 'BOT' ELSE 'PENDING' END AS kind,
        COALESCE((array_agg(source ORDER BY "startedAt"))[1], 'unknown') AS source,
        COALESCE((array_agg(medium ORDER BY "startedAt"))[1], '') AS medium,
        COALESCE((array_agg(campaign ORDER BY "startedAt"))[1], '') AS campaign,
        bool_or("addedToCart") AS cart, bool_or(checkout) AS checkout, bool_or(converted) AS converted,
        SUM(views) AS views, SUM(time) AS time, AVG(scroll) AS scroll, bool_or(forward) AS forward,
        bool_or(COALESCE(btrim(search), '') <> '') AS searched,
        COALESCE((array_agg(device ORDER BY "viewedAt") FILTER (WHERE device IS NOT NULL))[1], 'unknown') AS device,
        (array_agg(path ORDER BY "viewedAt" DESC) FILTER (WHERE path IS NOT NULL))[1] AS "exitPage"
      FROM marked GROUP BY id
    ), filtered AS (SELECT * FROM sessions WHERE ${cohort}),
    views AS (
      SELECT marked.*, filtered.converted AS "sessionConverted", filtered."exitPage"
      FROM marked JOIN filtered USING (id)
    ),
    daily AS (SELECT to_char(started,'YYYY-MM-DD') AS date, count(*) AS sessions,
      count(*) FILTER (WHERE converted) AS conversions, 100.0 * count(*) FILTER (WHERE converted) / NULLIF(count(*),0) AS "conversionRate"
      FROM filtered GROUP BY date ORDER BY date),
    channels AS (SELECT source, medium, campaign, count(*) AS sessions, count(*) FILTER (WHERE cart) AS "addedToCart", count(*) FILTER (WHERE converted) AS conversions,
      100.0 * count(*) FILTER (WHERE converted) / NULLIF(count(*),0) AS "conversionRate" FROM filtered GROUP BY source,medium,campaign ORDER BY count(*) DESC,source,medium,campaign),
    devices AS (SELECT device, count(*) AS sessions, 100.0 * count(*) / NULLIF((SELECT count(*) FROM filtered), 0) AS share,
      COALESCE(100.0 * count(*) FILTER (WHERE converted) / NULLIF(count(*), 0), 0) AS "conversionRate"
      FROM filtered GROUP BY device ORDER BY count(*) DESC, device),
    -- A term is listed only once two sessions used it, so one-off personal searches never show.
    searches AS (SELECT left(lower(btrim(search)), 100) AS term, count(DISTINCT id) AS sessions FROM views
      WHERE COALESCE(btrim(search), '') <> '' GROUP BY 1 HAVING count(DISTINCT id) >= 2
      ORDER BY count(DISTINCT id) DESC, 1 LIMIT 5),
    exits AS (SELECT CASE WHEN "exitType" IN ('internal_link','checkout','back_button','window_closed','idle','external_link') THEN "exitType" ELSE 'unknown' END AS "type",
      count(*) AS "pageViews", 100.0 * count(*) / NULLIF((SELECT count(*) FROM views), 0) AS share FROM views GROUP BY 1),
    next_pages AS (SELECT CASE WHEN "exitPath" ~* ${PRIVATE_PATH} THEN '/private-page' ELSE left("exitPath", 600) END AS path,
      count(*) AS "pageViews" FROM views WHERE "exitPath" LIKE '/%' GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 5),
    page_rows AS (SELECT path, (array_agg("type") FILTER (WHERE "type" IS NOT NULL))[1] AS "type",
      count(DISTINCT id) AS sessions,
      count(DISTINCT id) FILTER (WHERE "addedToCart") AS carts,
      count(DISTINCT id) FILTER (WHERE forward) AS forwards,
      count(DISTINCT id) FILTER (WHERE "sessionConverted") AS conversions,
      count(DISTINCT id) FILTER (WHERE "exitPage" = path) AS exits
      FROM views WHERE path IS NOT NULL GROUP BY path ORDER BY count(DISTINCT id) DESC, path LIMIT 500),
    exit_pages AS (SELECT path, exits, sessions, 100.0 * exits / NULLIF(sessions, 0) AS "exitRate"
      FROM page_rows WHERE exits > 0 ORDER BY exits DESC, path LIMIT 5)
    SELECT json_build_object('sessions',count(*),'addedToCart',count(*) FILTER (WHERE cart),'conversions',count(*) FILTER (WHERE converted),
      'conversionRate',COALESCE(100.0 * count(*) FILTER (WHERE converted)/NULLIF(count(*),0),0),
      'atcRate',COALESCE(100.0 * count(*) FILTER (WHERE cart)/NULLIF(count(*),0),0),
      'pageViews',COALESCE(sum(views),0),'averageTime',COALESCE(avg(time)/1000,0),'averageScroll',COALESCE(avg(scroll),0),
      'checkoutStarted',count(*) FILTER (WHERE checkout),
      'timeMedian',COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY time) / 1000,0),
      'pagesPerSession',COALESCE(avg(views),0),
      'viewScroll',COALESCE((SELECT avg(scroll) FROM views),0),
      'clickThroughRate',COALESCE(100.0 * count(*) FILTER (WHERE forward)/NULLIF(count(*),0),0),
      'searchRate',COALESCE(100.0 * count(*) FILTER (WHERE searched)/NULLIF(count(*),0),0),
      'series',COALESCE((SELECT json_agg(daily) FROM daily),'[]'::json),
      'channels',COALESCE((SELECT json_agg(channels) FROM channels),'[]'::json),
      'sources',COALESCE((SELECT json_agg(source) FROM (SELECT DISTINCT source FROM sessions ORDER BY source) options),'[]'::json),
      'devices',COALESCE((SELECT json_agg(devices) FROM devices),'[]'::json),
      'searches',COALESCE((SELECT json_agg(searches) FROM searches),'[]'::json),
      'exits',COALESCE((SELECT json_agg(exits) FROM exits),'[]'::json),
      'nextPages',COALESCE((SELECT json_agg(next_pages) FROM next_pages),'[]'::json),
      'exitPages',COALESCE((SELECT json_agg(exit_pages) FROM exit_pages),'[]'::json),
      'pageRows',COALESCE((SELECT json_agg(page_rows) FROM page_rows),'[]'::json),
      'clickRows',COALESCE((SELECT json_agg(clicks) FROM (
        SELECT raw.id AS "sessionId", raw."ctaClicks", filtered.cart AS "addedToCart", filtered.converted FROM raw JOIN filtered USING(id)
        WHERE raw."ctaClicks" IS NOT NULL AND raw."ctaClicks" NOT IN ('[]','{}','') LIMIT 20001
      ) clicks),'[]'::json)) AS report FROM filtered
  `);
  const {
    clickRows,
    checkoutStarted,
    timeMedian,
    pagesPerSession,
    viewScroll,
    clickThroughRate,
    searchRate,
    devices,
    searches,
    exits,
    nextPages,
    exitPages,
    pageRows,
    ...report
  } = results[0].report;
  return {
    ...report,
    layout,
    pageType,
    funnel: {
      sessions: report.sessions,
      addedToCart: report.addedToCart,
      checkoutStarted,
      purchased: report.conversions,
    },
    engagementSummary: {
      available: detailed,
      timeMedianSeconds: timeMedian,
      pagesPerSession,
      averageScroll: viewScroll,
      clickThroughRate,
      searchRate,
      topSearches: searches,
      devices: detailed ? devices : [],
    },
    exitPaths: {
      available: detailed,
      outcomes: EXIT_OUTCOMES.map((type) => {
        const row = exits.find((exit) => exit.type === type);
        return { type, pageViews: row?.pageViews ?? 0, share: row?.share ?? 0 };
      }),
      nextPages,
      exitPages,
    },
    pages: layout === "store" && detailed ? rankGrowthPages(pageRows) : [],
    // Do not show sampled engagement totals as complete; summaries above are always full-cohort.
    engagement:
      clickRows.length > 20000 ? null : buildEngagementOutcomes(clickRows),
    engagementUnavailable: clickRows.length > 20000,
  };
}
```

- [ ] **Step 6: Add the new mock to the existing report test**

`growth-report.server.ts` now imports values from `./growth-report`. In `scripts/check-growth-reports.mjs`, change the `service` helper (lines 42-47) to:

```js
const service = (client) =>
  compile("growth-report.server", {
    "../db.server": client,
    "./growth-projects": pure,
    "./click-engagement": clicks,
    "./growth-report": filters,
  });
```

- [ ] **Step 7: Run both database tests to verify they pass**

Run: `GROWTH_TEST_DATABASE_URL='postgresql://growth_test@127.0.0.1:55443/growth_report_test' node scripts/check-growth-report-sections.mjs`
Expected: `PASS: funnel, click-through rule, ...`

Run: `GROWTH_TEST_DATABASE_URL='postgresql://growth_test@127.0.0.1:55443/growth_report_test' node scripts/check-growth-reports.mjs`
Expected: `PASS: real PostgreSQL report cohorts, ...` (the existing behaviour is unchanged).

- [ ] **Step 8: Align the spec's testing note**

The click-through rule lives in SQL, so it is tested against real SQL, not as a pure function. In the spec's **Testing** section, replace the first bullet with:

```markdown
- **Pure functions** (no database): missed-sessions ranking, including thresholds, fewer than 3 pages of a type, ties, and zero or negative gaps.
- **Click-through rule** (real SQL, because it runs in the report query): image-in-card clicks, locale-prefixed product paths, header/footer exclusion and malformed `ctaClicks`.
```

- [ ] **Step 9: Commit** (only once the user has approved commits)

```bash
git add app/utils/growth-report.ts app/utils/growth-report.server.ts scripts/check-growth-reports.mjs scripts/check-growth-report-sections.mjs docs/superpowers/specs/2026-11-03-project-report-redesign-design.md
git commit -m "Compute engagement, funnel, exit and page sections in the Project report"
```

---

### Task 3: Engagement by zone — images first, one merged bar

**Files:**
- Modify: `app/components/EngagementOutcomes.tsx`
- Modify: `app/locales/catalog.ts` (replace one entry)
- Test: `scripts/check-engagement-outcomes.mjs` (modify two tests, add one)

**Interfaces:**
- Consumes: `EngagementOutcomes`, `EngagementOutcomeItem` from `app/utils/click-engagement.ts` (unchanged).
- Produces: `EngagementOutcomesView({ data, totals, audience })` — same props; markup changes only. Image cards render `<div class="eo-bar">` with three `<span>` layers whose `data-layer` is `clicked`, `cart`, `purchased`.

- [ ] **Step 1: Update the tests first**

In `scripts/check-engagement-outcomes.mjs`, replace the test `"rendered outcome percentages use clicked sessions, not raw clicks or carts"` with:

```js
test("rendered outcome percentages use clicked sessions, and rows have no bars", () => {
  const data = buildEngagementOutcomes(
    Array.from({ length: 24 }, (_, i) =>
      row(String(i), "Play video", {
        ctaClicks: clicks("Play video", i < 8 ? 2 : 1),
        addedToCart: i < 8,
        converted: i < 3,
      }),
    ),
  );
  const html = renderToStaticMarkup(
    React.createElement(EngagementOutcomesView, {
      data,
      totals: { Button: 32 },
    }),
  );
  assert.match(html, /8 \(33\.3%\)/);
  assert.match(html, /3 \(12\.5%\)/);
  assert.match(html, /not proof of sequence or causation/);
  assert.doesNotMatch(html, /class="eo-bar"/, "Button rows show numbers only");
  assert.doesNotMatch(html, /class="eo-track"/);
});
```

Then add after it:

```js
test("image cards come first with one merged bar that stays correct when purchases exceed carts", () => {
  const image = (id, extra) =>
    row(id, null, {
      ctaClicks: JSON.stringify([
        { label: "Hero", tag: "img", href: "https://cdn.shopify.com/hero.jpg" },
      ]),
      ...extra,
    });
  const data = buildEngagementOutcomes([
    image("a", { addedToCart: true, converted: true }),
    image("b", { addedToCart: true, converted: true }),
    image("c", { converted: true }),
    image("d"),
    row("e", "Size guide"),
  ]);
  const html = renderToStaticMarkup(
    React.createElement(EngagementOutcomesView, {
      data,
      totals: { Image: 4, Button: 1 },
    }),
  );
  assert.ok(
    html.indexOf('aria-label="Image engagement outcomes"') <
      html.indexOf('aria-label="Button engagement outcomes"'),
    "Images render above the button, link and widget groups",
  );
  assert.match(html, /data-layer="clicked" style="width:100%/);
  assert.match(html, /data-layer="cart" style="width:50%/);
  assert.match(html, /data-layer="purchased" style="width:75%/);
  assert.equal((html.match(/class="eo-bar"/g) || []).length, 1, "Only the image card has a bar");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/check-engagement-outcomes.mjs`
Expected: FAIL in both new tests (`class="eo-track"` still present; `data-layer` missing).

- [ ] **Step 3: Rework the component**

In `app/components/EngagementOutcomes.tsx`:

1. Replace `const series = ["#3989ff", "#eea12b", "#15996f"];` and the whole `Metrics` function (lines 16-69) with:

```tsx
// One hue, three shades: clicked (lightest) → added to cart → purchased (darkest).
const shades = { clicked: "#bcd4ff", cart: "#5b8ff9", purchased: "#1d4fb8" };
function Numbers({ item }: { item: EngagementOutcomeItem }) {
  const { t, formatNumber } = useI18n();
  const number = (value: number | null) =>
    value === null ? t("Unavailable") : formatNumber(value);
  const outcome = (value: number | null, total: number | null) =>
    value === null || total === null
      ? t("Unavailable")
      : `${number(value)} (${formatNumber(total ? value / total : 0, { style: "percent", maximumFractionDigits: 1 })})`;
  return (
    <>
      <div
        className="eo-number"
        aria-label={`${t("Clicked sessions")}: ${number(item.sessions)}`}
      >
        <span className="eo-mobile-label">{t("Clicked sessions")}</span>
        {number(item.sessions)}
      </div>
      <div
        className="eo-number"
        aria-label={`${t("Added to cart")}: ${outcome(item.carts, item.sessions)}`}
      >
        <span className="eo-mobile-label">{t("Added to cart")}</span>
        {outcome(item.carts, item.sessions)}
      </div>
      <div
        className="eo-number"
        aria-label={`${t("Purchased")}: ${outcome(item.purchases, item.sessions)}`}
      >
        <span className="eo-mobile-label">{t("Purchased")}</span>
        {outcome(item.purchases, item.sessions)}
      </div>
    </>
  );
}
// Each layer starts at the left edge rather than stacking, because a purchase can
// be recorded without a tracked cart step (purchases may exceed carts).
function MergedBar({
  item,
  maximum,
}: {
  item: EngagementOutcomeItem;
  maximum: number;
}) {
  const width = (value: number | null) =>
    `${value === null ? 0 : (value / maximum) * 100}%`;
  return (
    <div className="eo-bar" aria-hidden="true">
      <span
        data-layer="clicked"
        style={{ width: width(item.sessions), background: shades.clicked }}
      />
      <span
        data-layer="cart"
        style={{ width: width(item.carts), background: shades.cart }}
      />
      <span
        data-layer="purchased"
        style={{ width: width(item.purchases), background: shades.purchased }}
      />
    </div>
  );
}
```

2. In `Group`: drop the `maximum` prop (remove it from the parameter list and its type), delete the empty `<span />` in the `eo-head` row, and replace `<Metrics item={item} maximum={maximum} />` with `<Numbers item={item} />`.

3. In `ImageCard`, replace the `eo-image-metrics` block with:

```tsx
      <MergedBar item={item} maximum={maximum} />
      <div className="eo-image-metrics">
        <Numbers item={item} />
      </div>
```

4. In `EngagementOutcomesView`, after `const images = ...`, add:

```tsx
  const imageMax = Math.max(
    1,
    ...(images?.items.map((item) => item.sessions ?? 0) || []),
  );
```

5. In the `<style>` block: replace the `.eo-row` rule with
`.eo-row { display:grid; grid-template-columns:minmax(140px,1.6fr) repeat(3,minmax(84px,.55fr)); gap:12px; align-items:center; padding:12px 0; border-bottom:1px solid var(--p-color-border-secondary,#eee); }`,
replace `.eo-head>span:nth-child(n+3)` with `.eo-head>span:nth-child(n+2)`,
delete the `.eo-bars`, `.eo-track` and `.eo-track>div` rules, add
`.eo-bar { position:relative; height:12px; border-radius:4px; background:var(--p-color-bg-surface-secondary,#eee); overflow:hidden; }`
and
`.eo-bar>span { position:absolute; left:0; top:0; bottom:0; border-radius:4px; }`,
and in the `max-width:700px` media query replace `.eo-label,.eo-bars {grid-column:1/-1;}` with `.eo-label {grid-column:1/-1;}`.

6. Move the whole `{images && (<section ...>...</section>)}` block so it renders directly after `<style>`, before the `eo-key` legend, and pass `maximum={imageMax}` to each `ImageCard` (instead of `data.maxSessions`). Move the `eo-key` legend inside that image section, directly under its `<h3>`, and change its dots to the shades:

```tsx
          <div className="eo-key">
            {(
              [
                ["Clicked sessions", shades.clicked],
                ["Added to cart", shades.cart],
                ["Purchased", shades.purchased],
              ] as const
            ).map(([label, color]) => (
              <span key={label}>
                <i className="eo-dot" style={{ background: color }} />
                {t(label)}
              </span>
            ))}
          </div>
```

Note: `t(label)` keeps working at runtime because these three keys already exist in the catalog; the i18n checker ignores non-literal arguments.

7. Remove `maximum={data.maxSessions}` from both `<Group ... />` usages.

8. Replace the first note's key with the new wording:

```tsx
        {t(
          "{audience} only. Percentages are among sessions that clicked that element; repeat clicks count once. On image cards, bar length shows clicked sessions on one shared scale, and the darker shades show sessions that added to cart and purchased. Outcomes can overlap across elements—do not add them together.",
          { audience: t(audience) },
        )}
```

- [ ] **Step 4: Replace the catalog entry**

In `app/locales/catalog.ts`, replace the entry whose key starts with `"{audience} only. Percentages are among sessions that clicked that element; repeat clicks count once. All bars share one session-count scale.` with:

```ts
  "{audience} only. Percentages are among sessions that clicked that element; repeat clicks count once. On image cards, bar length shows clicked sessions on one shared scale, and the darker shades show sessions that added to cart and purchased. Outcomes can overlap across elements—do not add them together.":
    [
      "Nur {audience}. Prozentsätze beziehen sich auf Sitzungen mit Klick auf dieses Element; wiederholte Klicks zählen einmal. Bei Bildkarten zeigt die Balkenlänge die klickenden Sitzungen auf einer gemeinsamen Skala; die dunkleren Töne zeigen Sitzungen mit Warenkorb und Kauf. Ergebnisse können sich zwischen Elementen überschneiden und dürfen nicht addiert werden.",
      "仅包含{audience}。百分比以点击该元素的会话为基数，重复点击仅计一次。在图片卡片上，条形长度表示点击会话数（使用同一刻度），较深的颜色表示加购和购买的会话。不同元素的结果可能重叠，请勿相加。",
      "僅包含{audience}。百分比以點擊該元素的工作階段為基數，重複點擊僅計一次。在圖片卡片上，長條長度代表點擊工作階段數（使用同一刻度），較深的顏色代表加入購物車與購買的工作階段。不同元素的結果可能重疊，請勿相加。",
    ],
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test scripts/check-engagement-outcomes.mjs`
Expected: PASS, all tests.

Run: `node scripts/check-i18n.mjs`
Expected: `i18n checks passed: ...`

- [ ] **Step 6: Commit** (only once the user has approved commits)

```bash
git add app/components/EngagementOutcomes.tsx app/locales/catalog.ts scripts/check-engagement-outcomes.mjs
git commit -m "Show images first in Engagement by zone with one merged outcome bar"
```

---

### Task 4: Funnel and engagement metrics cards

**Files:**
- Create: `app/components/GrowthConversionFunnel.tsx`
- Create: `app/components/GrowthEngagementMetrics.tsx`
- Modify: `app/locales/catalog.ts` (add entries)
- Test: `scripts/check-growth-report-ui.mjs` (create)

**Interfaces:**
- Consumes: `GrowthFunnel`, `GrowthEngagementSummary`, `GrowthExitPaths`, `GrowthReportLayout` types (Task 1); `MetricTile({ label, value, caption })` from `app/components/GrowthOverviewCard.tsx`; `useI18n()` → `{ t(source, values?), formatNumber(value, options?) }`.
- Produces:
  - `GrowthConversionFunnel({ funnel, before, comparisonName }: { funnel: GrowthFunnel; before?: GrowthFunnel | null; comparisonName?: string })`
  - `GrowthEngagementMetrics({ summary, layout, exitPages }: { summary: GrowthEngagementSummary; layout: GrowthReportLayout; exitPages: GrowthExitPaths["exitPages"] })`

- [ ] **Step 1: Write the failing test**

Create `scripts/check-growth-report-ui.mjs`:

```js
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
        el("thead", null, el("tr", null, headings.map((h, i) => el("th", { key: i }, h)))),
        el(
          "tbody",
          null,
          rows.map((row, i) =>
            el("tr", { key: i }, row.map((cell, j) => el("td", { key: j }, cell))),
          ),
        ),
      ),
    Badge: ({ children }) => el("mark", null, children),
    ProgressBar: ({ progress }) => el("progress", { value: progress, max: 100 }),
    Pagination: ({ label }) => el("nav", null, label),
    Button: ({ children }) => el("button", null, children),
  },
  { get: (target, name) => target[name] || simple("div") },
);
const tile = {
  MetricTile: ({ label, value, caption }) =>
    el("div", { "data-tile": label }, `${label}=${value}`, caption ? ` [${caption}]` : ""),
};
function load(file, mocks = {}) {
  const mod = { exports: {} };
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
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
    { device: "mobile", sessions: 880, share: 65.7, conversionRate: 2.4 },
    { device: "desktop", sessions: 410, share: 30.6, conversionRate: 4.9 },
  ],
};

test("funnel shows each step as a share of all sessions", () => {
  const { GrowthConversionFunnel } = load("app/components/GrowthConversionFunnel.tsx", common);
  const html = render(GrowthConversionFunnel, {
    funnel: { sessions: 200, addedToCart: 40, checkoutStarted: 10, purchased: 12 },
  });
  assert.match(html, /Sessions=200/);
  assert.match(html, /Added to cart=40 \[20% of sessions\]/);
  assert.match(html, /Reached checkout=10 \[5% of sessions\]/);
  assert.match(html, /Purchased=12 \[6% of sessions\]/, "Purchases may exceed checkouts");
});

test("funnel compares each step with the comparison measurement in points", () => {
  const { GrowthConversionFunnel } = load("app/components/GrowthConversionFunnel.tsx", common);
  const html = render(GrowthConversionFunnel, {
    funnel: { sessions: 200, addedToCart: 40, checkoutStarted: 10, purchased: 12 },
    before: { sessions: 100, addedToCart: 10, checkoutStarted: 5, purchased: 3 },
    comparisonName: "Baseline",
  });
  assert.match(html, /Sessions=200 \[100 in Baseline\]/);
  assert.match(html, /Added to cart=40 \[\+10 pts\]/);
  assert.match(html, /Compared with Baseline using the same filters/);
});

test("funnel with no sessions shows zero shares, not NaN", () => {
  const { GrowthConversionFunnel } = load("app/components/GrowthConversionFunnel.tsx", common);
  const html = render(GrowthConversionFunnel, {
    funnel: { sessions: 0, addedToCart: 0, checkoutStarted: 0, purchased: 0 },
  });
  assert.doesNotMatch(html, /NaN/);
  assert.match(html, /Added to cart=0 \[0% of sessions\]/);
});

test("store engagement metrics show time on site, pages per session, click-through, searches, devices and exit pages", () => {
  const { GrowthEngagementMetrics } = load("app/components/GrowthEngagementMetrics.tsx", common);
  const html = render(GrowthEngagementMetrics, {
    summary,
    layout: "store",
    exitPages: [{ path: "/collections/autumn", exits: 160, sessions: 420, exitRate: 38.1 }],
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
  const { GrowthEngagementMetrics } = load("app/components/GrowthEngagementMetrics.tsx", common);
  const html = render(GrowthEngagementMetrics, { summary, layout: "page", exitPages: [] });
  assert.match(html, /Time on page=1m 14s/);
  assert.doesNotMatch(html, /Pages per session/);
  assert.doesNotMatch(html, /Click-through rate/);
  assert.doesNotMatch(html, /Top exit pages/);
});

test("engagement metrics say not recorded for imported measurements", () => {
  const { GrowthEngagementMetrics } = load("app/components/GrowthEngagementMetrics.tsx", common);
  const html = render(GrowthEngagementMetrics, {
    summary: { ...summary, available: false },
    layout: "store",
    exitPages: [],
  });
  assert.match(html, /Not recorded for this measurement/);
  assert.doesNotMatch(html, /Time on site=/);
});

test("short times show seconds only, and an empty search list explains why", () => {
  const { GrowthEngagementMetrics } = load("app/components/GrowthEngagementMetrics.tsx", common);
  const html = render(GrowthEngagementMetrics, {
    summary: { ...summary, timeMedianSeconds: 9.6, topSearches: [], devices: [] },
    layout: "page",
    exitPages: [],
  });
  assert.match(html, /Time on page=10s/);
  assert.match(html, /No search term was used by two or more sessions yet\./);
  assert.match(html, /No sessions match these filters\./);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/check-growth-report-ui.mjs`
Expected: FAIL — `ENOENT ... GrowthConversionFunnel.tsx`.

- [ ] **Step 3: Create the funnel card**

Create `app/components/GrowthConversionFunnel.tsx`:

```tsx
import { BlockStack, Card, InlineGrid, Text } from "@shopify/polaris";
import { useI18n } from "../utils/i18n";
import { MetricTile } from "./GrowthOverviewCard";
import type { GrowthFunnel } from "../utils/growth-report";

// Every step is a share of all sessions, never of the previous step: a purchase can
// be recorded without a tracked cart or checkout step.
export function GrowthConversionFunnel({
  funnel,
  before,
  comparisonName,
}: {
  funnel: GrowthFunnel;
  before?: GrowthFunnel | null;
  comparisonName?: string;
}) {
  const { t, formatNumber } = useI18n();
  const share = (value: number, sessions: number) =>
    sessions ? (100 * value) / sessions : 0;
  const percent = (value: number) =>
    `${formatNumber(value, { maximumFractionDigits: 2 })}%`;
  const name = comparisonName || t("comparison");
  const steps = [
    { key: "sessions", label: t("Sessions") },
    { key: "addedToCart", label: t("Added to cart") },
    { key: "checkoutStarted", label: t("Reached checkout") },
    { key: "purchased", label: t("Purchased") },
  ] as const;
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t("Conversion funnel")}
        </Text>
        <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
          {steps.map(({ key, label }) => {
            const current = share(funnel[key], funnel.sessions);
            let caption: string | undefined;
            if (key === "sessions")
              caption = before
                ? t("{value} in {name}", {
                    value: formatNumber(before.sessions),
                    name,
                  })
                : undefined;
            else
              caption = before
                ? t("{change} pts", {
                    change: formatNumber(
                      current - share(before[key], before.sessions),
                      { signDisplay: "exceptZero", maximumFractionDigits: 2 },
                    ),
                  })
                : t("{share} of sessions", { share: percent(current) });
            return (
              <MetricTile
                key={key}
                label={label}
                value={formatNumber(funnel[key])}
                caption={caption}
              />
            );
          })}
        </InlineGrid>
        <Text as="p" variant="bodySm" tone="subdued">
          {before
            ? t(
                "Compared with {name} using the same filters. A before/after change suggests, but does not prove, that your change caused it. Use an A/B test for proof.",
                { name },
              )
            : t(
                "Each step is a share of all sessions. A purchase can be recorded without a tracked cart step, so a later step can be larger than an earlier one.",
              )}
        </Text>
      </BlockStack>
    </Card>
  );
}
```

- [ ] **Step 4: Create the engagement metrics card**

Create `app/components/GrowthEngagementMetrics.tsx`:

```tsx
import { BlockStack, Card, DataTable, InlineGrid, Text } from "@shopify/polaris";
import { useI18n } from "../utils/i18n";
import { MetricTile } from "./GrowthOverviewCard";
import type {
  GrowthEngagementSummary,
  GrowthExitPaths,
  GrowthReportLayout,
} from "../utils/growth-report";

export function GrowthEngagementMetrics({
  summary,
  layout,
  exitPages,
}: {
  summary: GrowthEngagementSummary;
  layout: GrowthReportLayout;
  exitPages: GrowthExitPaths["exitPages"];
}) {
  const { t, formatNumber } = useI18n();
  const store = layout === "store";
  const percent = (value: number) =>
    `${formatNumber(value, { maximumFractionDigits: 1 })}%`;
  const duration = (seconds: number) => {
    const whole = Math.round(seconds);
    const minutes = Math.floor(whole / 60);
    return minutes
      ? t("{minutes}m {seconds}s", {
          minutes: formatNumber(minutes),
          seconds: formatNumber(whole % 60),
        })
      : t("{seconds}s", { seconds: formatNumber(whole) });
  };
  const device = (value: string) =>
    value === "desktop"
      ? t("Desktop")
      : value === "mobile"
        ? t("Mobile")
        : value === "tablet"
          ? t("Tablet")
          : t("Unknown device");
  const heading = (
    <Text as="h2" variant="headingMd">
      {t("Engagement metrics")}
    </Text>
  );
  if (!summary.available)
    return (
      <Card>
        <BlockStack gap="200">
          {heading}
          <Text as="p" tone="subdued">
            {t("Not recorded for this measurement")}
          </Text>
        </BlockStack>
      </Card>
    );
  return (
    <Card>
      <BlockStack gap="500">
        {heading}
        <InlineGrid columns={{ xs: 2, md: store ? 5 : 3 }} gap="300">
          <MetricTile
            label={store ? t("Time on site") : t("Time on page")}
            value={duration(summary.timeMedianSeconds)}
            caption={t("Typical (median) per session")}
          />
          {store && (
            <MetricTile
              label={t("Pages per session")}
              value={formatNumber(summary.pagesPerSession, {
                maximumFractionDigits: 1,
              })}
            />
          )}
          <MetricTile
            label={t("Scroll depth")}
            value={percent(summary.averageScroll)}
            caption={t("Average per page view")}
          />
          {store && (
            <MetricTile
              label={t("Click-through rate")}
              value={percent(summary.clickThroughRate)}
              caption={t("Clicked from the page to another store page")}
            />
          )}
          <MetricTile
            label={t("Sessions that searched")}
            value={percent(summary.searchRate)}
          />
        </InlineGrid>
        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              {t("Top searches")}
            </Text>
            {summary.topSearches.length ? (
              <DataTable
                columnContentTypes={["text", "numeric"]}
                headings={[t("Search term"), t("Sessions")]}
                rows={summary.topSearches.map((row) => [
                  row.term,
                  formatNumber(row.sessions),
                ])}
              />
            ) : (
              <Text as="p" tone="subdued">
                {t("No search term was used by two or more sessions yet.")}
              </Text>
            )}
          </BlockStack>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              {t("Devices")}
            </Text>
            {summary.devices.length ? (
              <DataTable
                columnContentTypes={["text", "numeric", "numeric"]}
                headings={[t("Device"), t("Share of sessions"), t("Conversion rate")]}
                rows={summary.devices.map((row) => [
                  device(row.device),
                  percent(row.share),
                  percent(row.conversionRate),
                ])}
              />
            ) : (
              <Text as="p" tone="subdued">
                {t("No sessions match these filters.")}
              </Text>
            )}
          </BlockStack>
        </InlineGrid>
        {store && (
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              {t("Top exit pages")}
            </Text>
            {exitPages.length ? (
              <DataTable
                columnContentTypes={["text", "numeric", "numeric"]}
                headings={[t("Page"), t("Exits"), t("Exit rate")]}
                rows={exitPages.map((row) => [
                  row.path,
                  formatNumber(row.exits),
                  percent(row.exitRate),
                ])}
              />
            ) : (
              <Text as="p" tone="subdued">
                {t("No exits recorded yet.")}
              </Text>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
```

- [ ] **Step 5: Add translations**

Run: `node scripts/check-i18n.mjs --list-missing`
Add every listed key to `app/locales/catalog.ts` (before the closing `};`) using this table. Add only keys the command lists; some may already exist.

| English key | German | Simplified Chinese | Traditional Chinese |
| --- | --- | --- | --- |
| `Conversion funnel` | `Conversion-Trichter` | `转化漏斗` | `轉換漏斗` |
| `Reached checkout` | `Kasse erreicht` | `进入结账` | `進入結帳` |
| `{share} of sessions` | `{share} der Sitzungen` | `占会话的 {share}` | `佔工作階段的 {share}` |
| `Each step is a share of all sessions. A purchase can be recorded without a tracked cart step, so a later step can be larger than an earlier one.` | `Jeder Schritt ist ein Anteil aller Sitzungen. Ein Kauf kann ohne erfassten Warenkorbschritt erfasst werden, daher kann ein späterer Schritt größer sein als ein früherer.` | `每个步骤都占全部会话的比例。购买可能在没有记录加购步骤的情况下被记录，因此后面的步骤可能大于前面的步骤。` | `每個步驟都是全部工作階段的比例。購買可能在沒有記錄加入購物車步驟的情況下被記錄，因此後面的步驟可能大於前面的步驟。` |
| `Engagement metrics` | `Interaktionskennzahlen` | `互动指标` | `互動指標` |
| `Time on site` | `Zeit im Shop` | `站内停留时间` | `站內停留時間` |
| `Time on page` | `Zeit auf der Seite` | `页面停留时间` | `頁面停留時間` |
| `Typical (median) per session` | `Typisch (Median) pro Sitzung` | `每个会话的典型值（中位数）` | `每個工作階段的典型值（中位數）` |
| `Pages per session` | `Seiten pro Sitzung` | `每个会话的页面数` | `每個工作階段的頁面數` |
| `Average per page view` | `Durchschnitt pro Seitenaufruf` | `每次页面浏览的平均值` | `每次頁面瀏覽的平均值` |
| `Click-through rate` | `Klickrate` | `点击率` | `點閱率` |
| `Clicked from the page to another store page` | `Von der Seite zu einer anderen Shopseite geklickt` | `从该页面点击进入店铺其他页面` | `從該頁面點擊進入商店其他頁面` |
| `Sessions that searched` | `Sitzungen mit Suche` | `进行搜索的会话` | `進行搜尋的工作階段` |
| `Top searches` | `Häufigste Suchen` | `热门搜索` | `熱門搜尋` |
| `Search term` | `Suchbegriff` | `搜索词` | `搜尋字詞` |
| `No search term was used by two or more sessions yet.` | `Noch kein Suchbegriff wurde von zwei oder mehr Sitzungen verwendet.` | `尚无被两个或更多会话使用的搜索词。` | `尚無被兩個或更多工作階段使用的搜尋字詞。` |
| `Device` | `Gerät` | `设备` | `裝置` |
| `Share of sessions` | `Anteil der Sitzungen` | `会话占比` | `工作階段佔比` |
| `Desktop` | `Desktop` | `桌面设备` | `桌上型裝置` |
| `Mobile` | `Mobil` | `移动设备` | `行動裝置` |
| `Tablet` | `Tablet` | `平板电脑` | `平板電腦` |
| `Unknown device` | `Unbekanntes Gerät` | `未知设备` | `未知裝置` |
| `Top exit pages` | `Häufigste Ausstiegsseiten` | `主要退出页面` | `主要離開頁面` |
| `Exits` | `Ausstiege` | `退出次数` | `離開次數` |
| `Exit rate` | `Ausstiegsrate` | `退出率` | `離開率` |
| `No exits recorded yet.` | `Noch keine Ausstiege erfasst.` | `尚未记录退出。` | `尚未記錄離開。` |
| `Not recorded for this measurement` | `Für diese Messung nicht erfasst` | `此测量未记录` | `此測量未記錄` |
| `{minutes}m {seconds}s` | `{minutes} Min. {seconds} Sek.` | `{minutes} 分 {seconds} 秒` | `{minutes} 分 {seconds} 秒` |
| `{seconds}s` | `{seconds} Sek.` | `{seconds} 秒` | `{seconds} 秒` |

Format each as `"Key": ["German", "Simplified", "Traditional"],` (keys that are valid identifiers, like `Exits`, may be unquoted to match Prettier).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test scripts/check-growth-report-ui.mjs`
Expected: PASS, 7 tests.

Run: `node scripts/check-i18n.mjs`
Expected: `i18n checks passed: ...`

- [ ] **Step 7: Commit** (only once the user has approved commits)

```bash
git add app/components/GrowthConversionFunnel.tsx app/components/GrowthEngagementMetrics.tsx app/locales/catalog.ts scripts/check-growth-report-ui.mjs
git commit -m "Add conversion funnel and engagement metrics cards for Project reports"
```

---

### Task 5: Exit paths and sessions-by-page cards

**Files:**
- Create: `app/components/GrowthExitPaths.tsx`
- Create: `app/components/GrowthSessionsByPage.tsx`
- Modify: `app/locales/catalog.ts` (add entries)
- Test: `scripts/check-growth-report-ui.mjs` (append tests)

**Interfaces:**
- Consumes: `GrowthExitPaths`, `GrowthExitOutcome`, `RankedGrowthPage` (Task 1).
- Produces:
  - `GrowthExitPaths({ exitPaths }: { exitPaths: GrowthExitPaths })` — exported as `GrowthExitPathsCard` to avoid clashing with the type name.
  - `GrowthSessionsByPage({ pages, available }: { pages: RankedGrowthPage[]; available: boolean })`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/check-growth-report-ui.mjs`:

```js
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
  missed: null,
  focus: false,
  ...extra,
});

test("sessions by page explains each focus page in a sentence and badges it", () => {
  const { GrowthSessionsByPage } = load("app/components/GrowthSessionsByPage.tsx", common);
  const html = render(GrowthSessionsByPage, {
    available: true,
    pages: [
      ranked("/collections/autumn", "COLLECTION", 420, { keyRate: 20, typicalRate: 31, missed: 46, focus: true }),
      ranked("/products/sample", "PRODUCT", 300, { keyRate: 16, typicalRate: 19, missed: 9, focus: true }),
      ranked("/search", null, 40),
    ],
  });
  assert.match(html, /About 46 more sessions would have continued if this page matched your other collections\./);
  assert.match(html, /About 9 more sessions would have added to cart if this page matched your other products\./);
  assert.equal((html.match(/<mark>Focus here<\/mark>/g) || []).length, 4, "Two sentences and two table rows");
  assert.match(html, /Other/);
  assert.match(html, /—/, "Unranked pages show a dash for missed sessions");
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/check-growth-report-ui.mjs`
Expected: FAIL — `ENOENT ... GrowthExitPaths.tsx`.

- [ ] **Step 3: Create the exit paths card**

Create `app/components/GrowthExitPaths.tsx`:

```tsx
import {
  BlockStack,
  Card,
  DataTable,
  InlineGrid,
  InlineStack,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import { useI18n } from "../utils/i18n";
import type {
  GrowthExitOutcome,
  GrowthExitPaths,
} from "../utils/growth-report";

export function GrowthExitPathsCard({ exitPaths }: { exitPaths: GrowthExitPaths }) {
  const { t, formatNumber } = useI18n();
  const labels: Record<GrowthExitOutcome, string> = {
    internal_link: t("Continued to another page"),
    checkout: t("Went to cart or checkout"),
    back_button: t("Pressed back"),
    window_closed: t("Closed or switched tab"),
    idle: t("Went idle"),
    external_link: t("Left for another site"),
    unknown: t("Unknown"),
  };
  const percent = (value: number) =>
    `${formatNumber(value, { maximumFractionDigits: 1 })}%`;
  const outcomes = exitPaths.outcomes.filter((row) => row.pageViews > 0);
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t("Exit paths")}
        </Text>
        {!exitPaths.available ? (
          <Text as="p" tone="subdued">
            {t("Not recorded for this measurement")}
          </Text>
        ) : (
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="500">
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {t("How visitors left this page")}
              </Text>
              {outcomes.length ? (
                outcomes.map((row) => (
                  <BlockStack key={row.type} gap="100">
                    <InlineStack align="space-between" gap="200">
                      <Text as="span" variant="bodySm">
                        {labels[row.type]}
                      </Text>
                      <Text as="span" variant="bodySm" numeric>
                        {`${percent(row.share)} · ${formatNumber(row.pageViews)}`}
                      </Text>
                    </InlineStack>
                    <ProgressBar progress={row.share} size="small" />
                  </BlockStack>
                ))
              ) : (
                <Text as="p" tone="subdued">
                  {t("No sessions match these filters.")}
                </Text>
              )}
            </BlockStack>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {t("Pages visitors went to next")}
              </Text>
              {exitPaths.nextPages.length ? (
                <DataTable
                  columnContentTypes={["text", "numeric"]}
                  headings={[t("Page"), t("Page views")]}
                  rows={exitPaths.nextPages.map((row) => [
                    row.path,
                    formatNumber(row.pageViews),
                  ])}
                />
              ) : (
                <Text as="p" tone="subdued">
                  {t("No visitor continued to another page yet.")}
                </Text>
              )}
            </BlockStack>
          </InlineGrid>
        )}
      </BlockStack>
    </Card>
  );
}
```

- [ ] **Step 4: Create the sessions-by-page card**

Create `app/components/GrowthSessionsByPage.tsx`:

```tsx
import { useState } from "react";
import {
  Badge,
  BlockStack,
  Box,
  Card,
  DataTable,
  InlineStack,
  Pagination,
  Text,
} from "@shopify/polaris";
import { useI18n } from "../utils/i18n";
import type { RankedGrowthPage } from "../utils/growth-report";

const PAGE_SIZE = 10;

export function GrowthSessionsByPage({
  pages,
  available,
}: {
  pages: RankedGrowthPage[];
  available: boolean;
}) {
  const { t, formatNumber } = useI18n();
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(pages.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const percent = (value: number | null) =>
    value === null ? "—" : `${formatNumber(value, { maximumFractionDigits: 1 })}%`;
  const typeLabel = (type: string | null) =>
    type === "PRODUCT"
      ? t("Product")
      : type === "COLLECTION"
        ? t("Collection")
        : type === "BLOG"
          ? t("Blog")
          : type === "PAGE"
            ? t("Page")
            : type === "HOMEPAGE"
              ? t("Homepage")
              : t("Other");
  const reason = (row: RankedGrowthPage) => {
    const count = formatNumber(row.missed ?? 0);
    if (row.type === "PRODUCT")
      return t(
        "About {count} more sessions would have added to cart if this page matched your other products.",
        { count },
      );
    if (row.type === "COLLECTION")
      return t(
        "About {count} more sessions would have continued if this page matched your other collections.",
        { count },
      );
    if (row.type === "BLOG")
      return t(
        "About {count} more sessions would have continued if this page matched your other blog posts.",
        { count },
      );
    return t(
      "About {count} more sessions would have continued if this page matched your other pages.",
      { count },
    );
  };
  const focus = pages.filter((row) => row.focus);
  return (
    <Card padding="0">
      <Box padding="400" paddingBlockEnd="200">
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            {t("Sessions by page")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t(
              "Key rate is the add-to-cart rate for products and the click-through rate for other pages. A page needs 20 sessions, and 3 pages of the same type, to be ranked.",
            )}
          </Text>
          {focus.map((row) => (
            <InlineStack key={row.path} gap="200" blockAlign="center">
              <Badge tone="attention">{t("Focus here")}</Badge>
              <Text as="span" fontWeight="semibold">
                {row.path}
              </Text>
              <Text as="span" variant="bodySm">
                {reason(row)}
              </Text>
            </InlineStack>
          ))}
        </BlockStack>
      </Box>
      {!available ? (
        <Box padding="400">
          <Text as="p" tone="subdued">
            {t("Not recorded for this measurement")}
          </Text>
        </Box>
      ) : pages.length ? (
        <DataTable
          columnContentTypes={[
            "text",
            "text",
            "numeric",
            "numeric",
            "numeric",
            "numeric",
            "numeric",
          ]}
          headings={[
            t("Page"),
            t("Type"),
            t("Sessions"),
            t("Key rate"),
            t("Exit rate"),
            t("Conversion rate"),
            t("Missed sessions"),
          ]}
          rows={pages
            .slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
            .map((row) => [
              row.focus ? (
                <InlineStack gap="100" blockAlign="center" wrap={false}>
                  <Badge tone="attention">{t("Focus here")}</Badge>
                  <span>{row.path}</span>
                </InlineStack>
              ) : (
                row.path
              ),
              typeLabel(row.type),
              formatNumber(row.sessions),
              percent(row.keyRate),
              percent(row.exitRate),
              percent(row.conversionRate),
              row.missed === null ? "—" : formatNumber(row.missed),
            ])}
        />
      ) : (
        <Box padding="400">
          <Text as="p" tone="subdued">
            {t("No sessions match these filters.")}
          </Text>
        </Box>
      )}
      {pageCount > 1 && (
        <Box padding="300">
          <InlineStack align="center">
            <Pagination
              hasPrevious={current > 0}
              onPrevious={() => setPage(current - 1)}
              hasNext={current + 1 < pageCount}
              onNext={() => setPage(current + 1)}
              label={t("Page {page} of {pages}", {
                page: formatNumber(current + 1),
                pages: formatNumber(pageCount),
              })}
            />
          </InlineStack>
        </Box>
      )}
    </Card>
  );
}
```

- [ ] **Step 5: Add translations**

Run: `node scripts/check-i18n.mjs --list-missing` and add each listed key from this table (only listed keys):

| English key | German | Simplified Chinese | Traditional Chinese |
| --- | --- | --- | --- |
| `Exit paths` | `Ausstiegswege` | `退出路径` | `離開路徑` |
| `How visitors left this page` | `Wie Besucher diese Seite verlassen haben` | `访客如何离开此页面` | `訪客如何離開此頁面` |
| `Continued to another page` | `Zu einer anderen Seite weitergegangen` | `继续前往其他页面` | `繼續前往其他頁面` |
| `Went to cart or checkout` | `Zum Warenkorb oder zur Kasse gegangen` | `前往购物车或结账` | `前往購物車或結帳` |
| `Pressed back` | `Zurück gedrückt` | `点击了返回` | `按了返回` |
| `Closed or switched tab` | `Tab geschlossen oder gewechselt` | `关闭或切换了标签页` | `關閉或切換了分頁` |
| `Went idle` | `Inaktiv geworden` | `进入闲置` | `進入閒置` |
| `Left for another site` | `Zu einer anderen Website gewechselt` | `前往其他网站` | `前往其他網站` |
| `Unknown` | `Unbekannt` | `未知` | `未知` |
| `Pages visitors went to next` | `Seiten, die Besucher als Nächstes aufgerufen haben` | `访客接下来前往的页面` | `訪客接下來前往的頁面` |
| `No visitor continued to another page yet.` | `Noch kein Besucher ist zu einer anderen Seite weitergegangen.` | `尚无访客继续前往其他页面。` | `尚無訪客繼續前往其他頁面。` |
| `Sessions by page` | `Sitzungen nach Seite` | `按页面统计的会话` | `依頁面統計的工作階段` |
| `Key rate is the add-to-cart rate for products and the click-through rate for other pages. A page needs 20 sessions, and 3 pages of the same type, to be ranked.` | `Die Kennrate ist bei Produkten die Warenkorbrate und bei anderen Seiten die Klickrate. Eine Seite braucht 20 Sitzungen und 3 Seiten desselben Typs, um bewertet zu werden.` | `关键比率：产品页为加购率，其他页面为点击率。页面需有 20 个会话，且同类型页面至少 3 个，才会参与排名。` | `關鍵比率：商品頁為加入購物車率，其他頁面為點閱率。頁面需有 20 個工作階段，且同類型頁面至少 3 個，才會參與排名。` |
| `Focus here` | `Hier ansetzen` | `重点关注` | `重點關注` |
| `Type` | `Typ` | `类型` | `類型` |
| `Key rate` | `Kennrate` | `关键比率` | `關鍵比率` |
| `Missed sessions` | `Verpasste Sitzungen` | `错失的会话` | `錯失的工作階段` |
| `Blog` | `Blog` | `博客` | `部落格` |
| `Other` | `Sonstige` | `其他` | `其他` |
| `About {count} more sessions would have added to cart if this page matched your other products.` | `Etwa {count} weitere Sitzungen hätten etwas in den Warenkorb gelegt, wenn diese Seite Ihren anderen Produkten entspräche.` | `如果此页面达到您其他产品页的水平，大约还会多 {count} 个会话加购。` | `如果此頁面達到您其他商品頁的水準，大約還會多 {count} 個工作階段加入購物車。` |
| `About {count} more sessions would have continued if this page matched your other collections.` | `Etwa {count} weitere Sitzungen wären weitergegangen, wenn diese Seite Ihren anderen Kollektionen entspräche.` | `如果此页面达到您其他系列页的水平，大约还会多 {count} 个会话继续浏览。` | `如果此頁面達到您其他系列頁的水準，大約還會多 {count} 個工作階段繼續瀏覽。` |
| `About {count} more sessions would have continued if this page matched your other blog posts.` | `Etwa {count} weitere Sitzungen wären weitergegangen, wenn diese Seite Ihren anderen Blogbeiträgen entspräche.` | `如果此页面达到您其他博客文章的水平，大约还会多 {count} 个会话继续浏览。` | `如果此頁面達到您其他部落格文章的水準，大約還會多 {count} 個工作階段繼續瀏覽。` |
| `About {count} more sessions would have continued if this page matched your other pages.` | `Etwa {count} weitere Sitzungen wären weitergegangen, wenn diese Seite Ihren anderen Seiten entspräche.` | `如果此页面达到您其他页面的水平，大约还会多 {count} 个会话继续浏览。` | `如果此頁面達到您其他頁面的水準，大約還會多 {count} 個工作階段繼續瀏覽。` |

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test scripts/check-growth-report-ui.mjs`
Expected: PASS, 12 tests.

Run: `node scripts/check-i18n.mjs`
Expected: `i18n checks passed: ...`

- [ ] **Step 7: Commit** (only once the user has approved commits)

```bash
git add app/components/GrowthExitPaths.tsx app/components/GrowthSessionsByPage.tsx app/locales/catalog.ts scripts/check-growth-report-ui.mjs
git commit -m "Add exit paths and sessions-by-page cards for Project reports"
```

---

### Task 6: Store and Page layouts in the results sheet

**Files:**
- Modify: `app/components/GrowthMeasurementResults.tsx` (lines 1-265, the rendered layout)
- Modify: `app/locales/catalog.ts` (add entries)
- Modify: `scripts/preview-project-translations.mjs` (fixture report)
- Test: `scripts/check-growth-report-ui.mjs` (append tests)

**Interfaces:**
- Consumes: `GrowthReport` with Task 2 fields; the four cards from Tasks 4-5; `EngagementOutcomesView` (Task 3).
- Produces: `GrowthMeasurementResults` with unchanged props. Section order:
  - Store: Engagement metrics → Conversion funnel → Traffic by source → Sessions by page
  - Page: Conversion metrics → Engagement metrics → Engagement by zone → Exit paths → Traffic by source

- [ ] **Step 1: Write the failing tests**

Append to `scripts/check-growth-report-ui.mjs`:

```js
function resultsWith(report, comparison = null) {
  const section = (name) => (props) =>
    el("section", { "data-section": name, "data-layout": props.layout || "" });
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
    { source: "facebook", medium: "paid", campaign: "", sessions: 100, addedToCart: 20, conversions: 4, conversionRate: 4 },
  ],
  sources: ["facebook"],
  engagement: { version: 1, maxSessions: 1, groups: [{ category: "Button", items: [] }] },
  engagementUnavailable: false,
  funnel: { sessions: 100, addedToCart: 20, checkoutStarted: 8, purchased: 4 },
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/check-growth-report-ui.mjs`
Expected: FAIL — the store test sees `["conversion", "traffic", ...]` and "Conversion rate over time" is still present.

- [ ] **Step 3: Rebuild `GrowthMeasurementResults.tsx`**

Make these changes to `app/components/GrowthMeasurementResults.tsx`:

1. Imports: replace `import { GrowthLineChart, MetricTile } from "./GrowthOverviewCard";` with `import { MetricTile } from "./GrowthOverviewCard";` and add:

```tsx
import { GrowthConversionFunnel } from "./GrowthConversionFunnel";
import { GrowthEngagementMetrics } from "./GrowthEngagementMetrics";
import { GrowthExitPathsCard } from "./GrowthExitPaths";
import { GrowthSessionsByPage } from "./GrowthSessionsByPage";
```

2. Replace everything from `return (` after the `if (!report)` block (line 101) to the end of the component with:

```tsx
  const clickThrough = report.pageType !== null && report.pageType !== "PRODUCT";
  const summary = report.engagementSummary;
  const conversionMetrics = (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t("Conversion metrics")}
        </Text>
        <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
          <MetricTile
            label={t("Sessions")}
            value={count(report.sessions)}
            caption={versus(count(before?.sessions || 0))}
          />
          {clickThrough ? (
            <MetricTile
              label={t("Click-through rate")}
              value={
                summary.available
                  ? percent(summary.clickThroughRate)
                  : t("Not recorded")
              }
              caption={
                before && summary.available
                  ? points(
                      summary.clickThroughRate,
                      before.engagementSummary.clickThroughRate,
                    )
                  : report.pageType === "COLLECTION"
                    ? t("Clicked through to a product")
                    : t("Clicked through to another page")
              }
            />
          ) : (
            <MetricTile
              label={t("Add-to-cart rate")}
              value={percent(report.atcRate)}
              caption={
                before
                  ? points(report.atcRate, before.atcRate)
                  : t("{count} added to cart", {
                      count: count(report.addedToCart),
                    })
              }
            />
          )}
          <MetricTile
            label={t("Converted sessions")}
            value={count(report.conversions)}
            caption={versus(count(before?.conversions || 0))}
          />
          <MetricTile
            label={t("Conversion rate")}
            value={percent(report.conversionRate)}
            caption={
              before
                ? points(report.conversionRate, before.conversionRate)
                : undefined
            }
          />
        </InlineGrid>
        {before && (
          <Text as="p" variant="bodySm" tone="subdued">
            {t(
              "Compared with {name} using the same filters. A before/after change suggests, but does not prove, that your change caused it. Use an A/B test for proof.",
              { name: comparisonName || t("comparison") },
            )}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
  const trafficBySource = (
    <Card padding="0">
      <Box padding="400" paddingBlockEnd="0">
        <Text as="h2" variant="headingMd">
          {t("Traffic by source")}
        </Text>
      </Box>
      {report.channels.length ? (
        <DataTable
          columnContentTypes={[
            "text",
            "text",
            "text",
            "numeric",
            "numeric",
            "numeric",
            "numeric",
          ]}
          headings={[
            t("Source"),
            t("Medium"),
            t("Campaign"),
            t("Sessions"),
            t("Added to cart"),
            t("Conversions"),
            t("Conversion rate"),
          ]}
          rows={report.channels
            .slice(page * CHANNEL_PAGE_SIZE, (page + 1) * CHANNEL_PAGE_SIZE)
            .map((row) => [
              row.source,
              row.medium || "—",
              row.campaign || "—",
              count(row.sessions),
              count(row.addedToCart),
              count(row.conversions),
              percent(row.conversionRate),
            ])}
        />
      ) : (
        <Box padding="400">
          <Text as="p" tone="subdued">
            {t("No sessions match these filters.")}
          </Text>
        </Box>
      )}
      {pages > 1 && (
        <Box padding="300">
          <InlineStack align="center">
            <Pagination
              hasPrevious={page > 0}
              onPrevious={() => setChannelPage(page - 1)}
              hasNext={page + 1 < pages}
              onNext={() => setChannelPage(page + 1)}
              label={t("Page {page} of {pages}", {
                page: count(page + 1),
                pages: count(pages),
              })}
            />
          </InlineStack>
        </Box>
      )}
    </Card>
  );
  const zones = report.engagement && report.engagement.groups.length > 0 && (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          {t("Engagement by zone")}
        </Text>
        <EngagementOutcomesView
          data={report.engagement}
          audience={t(
            filters.audience === "active"
              ? "Active sessions"
              : "All recorded sessions",
          )}
          totals={Object.fromEntries(
            report.engagement.groups.map((group) => [
              group.category,
              group.items.reduce((sum, item) => sum + item.clicks, 0),
            ]),
          )}
        />
      </BlockStack>
    </Card>
  );
  return (
    <BlockStack gap="400">
      {error && <Banner tone="warning">{error}</Banner>}
      <InlineStack align="end">
        <Button variant="tertiary" onClick={reload} loading={loading}>
          {t("Refresh")}
        </Button>
      </InlineStack>
      {report.layout === "store" ? (
        <>
          <GrowthEngagementMetrics
            summary={summary}
            layout="store"
            exitPages={report.exitPaths.exitPages}
          />
          <GrowthConversionFunnel
            funnel={report.funnel}
            before={before?.funnel}
            comparisonName={comparisonName}
          />
          {trafficBySource}
          <GrowthSessionsByPage
            pages={report.pages}
            available={report.exitPaths.available}
          />
        </>
      ) : (
        <>
          {conversionMetrics}
          <GrowthEngagementMetrics summary={summary} layout="page" exitPages={[]} />
          {zones}
          {report.engagementUnavailable && (
            <Banner tone="info">
              {t(
                "There is too much engagement data to show at once. Pick a source to narrow it down.",
              )}
            </Banner>
          )}
          <GrowthExitPathsCard exitPaths={report.exitPaths} />
          {trafficBySource}
        </>
      )}
    </BlockStack>
  );
}
```

The Traffic by source and Engagement by zone card bodies are the existing ones, moved into constants; the conversion-rate chart card (old lines 156-170) and the old Summary card are removed. The `pages`, `page`, `setChannelPage`, `count`, `percent`, `versus` and `points` helpers declared above the `if (!report)` block stay as they are.

- [ ] **Step 4: Add translations**

Run: `node scripts/check-i18n.mjs --list-missing` and add each listed key:

| English key | German | Simplified Chinese | Traditional Chinese |
| --- | --- | --- | --- |
| `Conversion metrics` | `Conversion-Kennzahlen` | `转化指标` | `轉換指標` |
| `Not recorded` | `Nicht erfasst` | `未记录` | `未記錄` |
| `Clicked through to a product` | `Zu einem Produkt geklickt` | `点击进入商品` | `點擊進入商品` |
| `Clicked through to another page` | `Zu einer anderen Seite geklickt` | `点击进入其他页面` | `點擊進入其他頁面` |

- [ ] **Step 5: Update the visual QA fixture**

In `scripts/preview-project-translations.mjs`, replace the single line that starts with `          const report={sessions:1340,` with:

```js
          const params=new URLSearchParams(location.search);const layout=params.get('layout')==='page'?'page':'store';const pageType=layout==='page'?(params.get('pageType')||'COLLECTION'):null;
          const imageEngagement={version:1,maxSessions:130,groups:[{category:'Image',items:[{key:'hero',label:'Hero image',imageUrl:null,clicks:90,sessions:80,carts:20,purchases:26},{key:'detail',label:'Detail shot',imageUrl:null,clicks:40,sessions:36,carts:9,purchases:3}]},...engagement.groups]};
          const pages=[['/collections/autumn','COLLECTION',420,0,84,9,160,true,46],['/collections/sale','COLLECTION',380,0,118,14,120,true,12],['/products/merchant-sample-product','PRODUCT',300,48,0,21,90,true,9],['/','HOMEPAGE',600,0,240,30,180,false,null],['/search',null,40,0,10,1,30,false,null]].map(([path,type,sessions,carts,forwards,conversions,exits,focus,missed])=>({path,type,sessions,carts,forwards,conversions,exits,keyRate:type==='PRODUCT'?100*carts/sessions:type?100*forwards/sessions:null,exitRate:100*exits/sessions,conversionRate:100*conversions/sessions,typicalRate:missed===null?null:31,missed,focus}));
          const report={layout,pageType,sessions:1340,addedToCart:210,conversions:43,atcRate:15.67,conversionRate:3.21,pageViews:3120,averageTime:48,averageScroll:61,series,channels:[{source:'facebook',medium:'paid_social',campaign:'Autumn campaign',sessions:690,addedToCart:120,conversions:28,conversionRate:4.06},{source:'google',medium:'organic',campaign:'',sessions:650,addedToCart:90,conversions:15,conversionRate:2.31}],sources:['facebook','google'],engagement:imageEngagement,engagementUnavailable:false,funnel:{sessions:1340,addedToCart:210,checkoutStarted:96,purchased:43},engagementSummary:{available:true,timeMedianSeconds:74,pagesPerSession:2.3,averageScroll:61.4,clickThroughRate:38.2,searchRate:12.5,topSearches:[{term:'winter boots',sessions:41},{term:'gift card',sessions:12}],devices:[{device:'mobile',sessions:880,share:65.7,conversionRate:2.4},{device:'desktop',sessions:410,share:30.6,conversionRate:4.9},{device:'tablet',sessions:50,share:3.7,conversionRate:2}]},exitPaths:{available:true,outcomes:[{type:'internal_link',pageViews:520,share:41.6},{type:'checkout',pageViews:110,share:8.8},{type:'back_button',pageViews:200,share:16},{type:'window_closed',pageViews:330,share:26.4},{type:'idle',pageViews:50,share:4},{type:'external_link',pageViews:10,share:0.8},{type:'unknown',pageViews:30,share:2.4}],nextPages:[{path:'/products/merchant-sample-product',pageViews:210},{path:'/collections/sale',pageViews:90},{path:'/private-page',pageViews:12}],exitPages:[{path:'/',exits:180,sessions:600,exitRate:30},{path:'/collections/autumn',exits:160,sessions:420,exitRate:38.1}]},pages};
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test scripts/check-growth-report-ui.mjs scripts/check-projects-ui.mjs`
Expected: PASS, all tests in both files.

Run: `node scripts/check-i18n.mjs`
Expected: `i18n checks passed: ...`

- [ ] **Step 7: Commit** (only once the user has approved commits)

```bash
git add app/components/GrowthMeasurementResults.tsx app/locales/catalog.ts scripts/check-growth-report-ui.mjs scripts/preview-project-translations.mjs
git commit -m "Show Store and Page layouts in Project results"
```

---

### Task 7: Full verification

**Files:** none changed unless a check fails.

**Interfaces:** none.

- [ ] **Step 1: Run every affected check**

```bash
node --test scripts/check-growth-report-ranking.mjs scripts/check-engagement-outcomes.mjs scripts/check-growth-report-ui.mjs scripts/check-projects-ui.mjs scripts/check-project-ab-tests.mjs scripts/check-ab-test-detail-report.mjs
```

```bash
node scripts/check-i18n.mjs
```

```bash
GROWTH_TEST_DATABASE_URL='postgresql://growth_test@127.0.0.1:55443/growth_report_test' node scripts/check-growth-report-sections.mjs
```

```bash
GROWTH_TEST_DATABASE_URL='postgresql://growth_test@127.0.0.1:55443/growth_report_test' node scripts/check-growth-reports.mjs
```

Expected: every command passes. If a pre-existing check fails, compare against `git stash` of this work before attributing it to this change.

- [ ] **Step 2: Build and lint**

```bash
npm run build
```

```bash
npx eslint app/utils/growth-report.ts app/utils/growth-report.server.ts app/components/EngagementOutcomes.tsx app/components/GrowthConversionFunnel.tsx app/components/GrowthEngagementMetrics.tsx app/components/GrowthExitPaths.tsx app/components/GrowthSessionsByPage.tsx app/components/GrowthMeasurementResults.tsx
```

```bash
git diff --check
```

Expected: build succeeds (existing Polaris CSS and import-attribute warnings are known and non-fatal); ESLint reports no errors; `git diff --check` prints nothing.

- [ ] **Step 3: Visual check at desktop and 390px**

Start the fixture (simulated data only; no Shopify or database):

```bash
node scripts/preview-project-translations.mjs
```

Open these in the browser pane, at desktop width and at 390px width (`resize_window` with width 390), and confirm the section order, the merged image bars, the "Focus here" rows, and no horizontal page overflow:

- `http://127.0.0.1:4190/?layout=store`
- `http://127.0.0.1:4190/?layout=page&pageType=COLLECTION`
- `http://127.0.0.1:4190/?layout=page&pageType=PRODUCT`
- `http://127.0.0.1:4190/?layout=store&locale=de`

Overflow check in the browser console: `document.documentElement.scrollWidth <= window.innerWidth` must be `true`. Reset the viewport to desktop afterwards.

- [ ] **Step 4: Stop the disposable database**

```bash
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D <PGDIR>/data stop
```

- [ ] **Step 5: Report**

Tell the user what passed, anything that failed or was skipped, and that no production database, Shopify store or deployment was touched.
