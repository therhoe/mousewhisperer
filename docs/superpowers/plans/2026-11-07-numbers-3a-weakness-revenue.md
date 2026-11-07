# Numbers, Part 3a: Weakness, Conversions and Revenue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename "Missed sessions" to **Weakness**, and show conversions and revenue (in the shop's currency) next to every conversion rate in the measurement Results sheet and in the Project page's latest-measurement summary.

**Architecture:**
- Two small pure modules carry the rules, and DB-free tests call them directly:
  - `app/utils/revenue.ts` decides what a revenue figure shows (zero, a sum, a partly recorded sum, or "Not recorded") and formats money.
  - `app/utils/shop-currency.server.ts` reads `shop { currencyCode }` once per shop (cached 300 s). Project growth metrics reuse it.
- The report query (`getGrowthMeasurementReport`) sums order amounts **per session first**, counting only amounts in the shop's currency. Then it gives every aggregate (totals, funnel, traffic by source, devices, sessions by page) a revenue sum and two counts: priced and unpriced converted sessions.
- The Results sheet components and `LatestSummary` render those numbers through the shared helper. Weakness is a rename of the field, the column, the help text and the Focus rows. The calculation is unchanged.

**Tech Stack:** React Router 7.18.5, React 19, Polaris React 12.27.0 for these screens (unchanged in 3a), Prisma 6.19 raw SQL on PostgreSQL, `node --test` check scripts transpiled with `typescript`.

**Spec:** `docs/superpowers/specs/2026-11-06-polaris-ui-redesign-design.md`, sections 7.1 (Weakness) and 7.2 (Conversions and revenue beside every conversion rate). Plan 2a (`docs/superpowers/plans/2026-11-06-polaris-screens-2a.md`) supplies the regression baseline and the loopback/shep-dev procedures.

## Where this plan sits

Plan 3 from the spec (sections 7 and 8) is split. Each part ships on its own and is checked on shep-dev:

| Part | Contents |
|---|---|
| **3a (this plan)** | Weakness rename (7.1). Conversions and revenue (7.2) in the measurement Results sheet: page-layout conversion tiles, conversion funnel, traffic by source, devices, Sessions by page. Also the Project page's latest-measurement summary, which reads the same report. |
| 3b | Create Page Projects from the results (7.3), with `GrowthProject.sourceMeasurementId` (section 8) |

Other screens in spec 7.2's list get their conversions and revenue when parts 2b–2e rebuild them:
- Home (store tiles with the ShopifyQL `sales` query, and Recent projects).
- The Projects list and the Project page's Measurements table.
- A/B tests and the variant sheet.
- The legacy channel, customer and store reports.

3a adds no `ChannelSnapshotSession` columns and no new tracking write (Ruling 2). So section 8's `ChannelSnapshotSession.orderValue` / `currency` is dropped, not deferred.

## Global Constraints

- **Weakness (spec 7.1, binding):**
  - "Missed sessions" becomes **Weakness** everywhere it appears: the column, the Focus rows and the help text.
  - The calculation is unchanged: `max(0, round(sessions × (typical key rate − page key rate)))`, with the 20-session and 3-pages-of-a-type thresholds from the 2026-11-03 spec.
  - Help text: "Weakness is how many sessions a page lost against the typical page of its type."
- **Revenue (spec 7.2, binding):**
  - **Definition.** Revenue = the sum of recorded order values for converted sessions, under the same filters as the rate. It is shown in the shop's currency.
  - A revenue figure with no recorded amounts at all shows **Not recorded**.
  - A partly recorded figure shows the recorded sum, with a "Some orders have no recorded amount" hint.
- **Stack:**
  - Polaris React 12 stays on these screens; part 2c rebuilds the Results sheet with web components.
  - React 19 and React Router 7.18.5. Do not upgrade either.
  - No Prisma schema change and no migration in 3a.
- **Languages:** 4 languages (en, de, zh-CN, zh-TW). Every new string goes into `app/locales/catalog.ts` as `"English key": [German, Simplified Chinese, Traditional Chinese]`. `scripts/check-i18n.mjs` fails on a missing or empty translation, and on placeholders that differ as a multiset (a key with `{count}` twice needs `{count}` twice in every translation).
- **Mobile width:** every changed table keeps scrolling sideways at 375 px (Polaris `DataTable` already does), and tile grids wrap.
- **The local `.env` points at the PRODUCTION database:**
  - Never run `shopify app dev`, `npm run dev`, `npm run setup`, any `prisma` command or a database-backed check without first exporting BOTH `DATABASE_URL` and `DIRECT_URL` to the loopback Postgres and passing the loopback check below.
  - `scripts/run-checks.mjs` already forces an unreachable database.
- **Loopback database** (copied from plan 2a, Task 9, Setup steps 1–2; the steps are chained with `&&` so nothing runs after a failed loopback check):
  1. Start the throwaway Postgres. The first-time lines may report "already exists"; that's fine.

     ```bash
     PGBIN=/opt/homebrew/opt/postgresql@17/bin
     PGDATA="$HOME/.cache/snapshot-smoke-pg"
     test -d "$PGDATA" || LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 "$PGBIN/initdb" -D "$PGDATA" -U growth_test --auth=trust
     LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/log" -o "-p 55443 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start
     "$PGBIN/createdb" -h 127.0.0.1 -p 55443 -U growth_test snapshot_smoke || true
     ```

  2. Point both database variables at it, check that they are loopback, create the schema and mark every migration as applied:

     ```bash
     export DATABASE_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke" DIRECT_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke"
     node -e 'const h=new URL(process.env.DATABASE_URL).hostname; if(h!=="127.0.0.1"){console.error("NOT LOOPBACK");process.exit(1)} console.log("loopback ok")' \
       && npx prisma db push --skip-generate \
       && for m in prisma/migrations/*/; do npx prisma migrate resolve --applied "$(basename "$m")" || true; done
     ```

  3. **Every database-backed check** runs with `DATABASE_URL`, `DIRECT_URL`, `GROWTH_TEST_DATABASE_URL` and `JOURNEY_TEST_DATABASE_URL` all set to `postgresql://growth_test@127.0.0.1:55443/snapshot_smoke`, after the loopback check:

     ```bash
     export DATABASE_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke" DIRECT_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke" \
       && node -e 'const h=new URL(process.env.DATABASE_URL).hostname; if(h!=="127.0.0.1"){console.error("NOT LOOPBACK");process.exit(1)} console.log("loopback ok")' \
       && export GROWTH_TEST_DATABASE_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke" JOURNEY_TEST_DATABASE_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke"
     ```

  4. Stop it with `"$PGBIN/pg_ctl" -D "$PGDATA" stop` when you are done.
- **Deploys:** none without the user's explicit OK in chat. Never promote.
- **Git:**
  - Work on branch `polaris-ui-redesign` (production runs its commit 7e57303).
  - Commit once per task. Never push without the user's OK.
  - Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; the commands pass it as a second `-m`.
- **Regression bar** at the end of every task:
  - `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt` exits 0. The four database checks are FAIL in that baseline because run-checks has no database, so they never count as regressions there.
  - The task's database-backed checks pass on loopback (Loopback database, step 3).
  - `npm run build` succeeds.
  - `npx tsc --noEmit` reports no error in a file the task touched (the project has about 100 older errors elsewhere; plan 2a's Ruling P3 applies: only lines a task changed count).

## Facts this plan relies on (checked against the code at 7e57303)

1. **Weakness computation:**
   - `rankGrowthPages` is at `app/utils/growth-report.ts:154-199`. The field is `missed` (type at line 125, computed at 178-180, used for sorting at 186 and for focus at 193).
   - The thresholds are `PAGE_RANK_MIN_SESSIONS = 20`, `PAGE_RANK_MIN_PAGES = 3` and `PAGE_FOCUS_COUNT = 3` (lines 129-131).
   - The formula is `Math.max(0, Math.round((row.sessions * (typicalRate - keyRate)) / 100))`; rates are percentages. This is spec 7.1's formula.
2. **Sessions by page** (`app/components/GrowthSessionsByPage.tsx`):
   - The card heading "Sessions by page" is at line 72. Line 116 is the "Missed sessions" column heading.
   - The four Focus sentences are at 44-65 and use `row.missed`. The key-rate help text is at 75-77.
   - The catalog has "Missed sessions" at `app/locales/catalog.ts:1850` and the four Focus sentences at 1801-1820.
   - Nothing else uses those five keys.
3. **The report** (`app/utils/growth-report.server.ts`):
   - `getGrowthMeasurementReport` (68-82) runs a shop-scoped lookup, then a 60 s cached `loadReport` (83-301). `loadReport` is one raw SQL CTE query: `raw → marked → sessions → filtered → views`, then `daily`, `channels`, `devices`, `searches` and `exits`. Store layouts also build `page_sessions`, `page_rows` and `exit_pages`; page layouts build `next_pages`.
   - The session id is `COALESCE("acquisitionId", "sessionId")` for `Visit` (page captures) and `StoreSnapshotVisit` (store captures), at line 108. It is `s.id` for imported `ChannelSnapshotSession` and `CustomerJourneySession` captures (lines 115-126).
   - Rates are `count(*) FILTER (WHERE converted) / count(*)` over sessions.
   - A page row's conversions count the sessions that viewed the page and whose session converted (`views."sessionConverted"`, lines 137-145).
   - Devices rows carry no conversion count today (line 221-223). `GrowthReport` has no currency.
4. **Where amounts are recorded:**
   - `Visit.orderValue Float?` and `currency String?` (`prisma/schema.prisma:862-863`). `StoreSnapshotVisit.orderValue` and `currency` (489-490).
   - `ChannelSnapshotSession` has no amount columns (215-242).
   - `CustomerJourneyEvent.amount Float?` and `currency String?` (334-335), on events of `type = 'conversion'` among others.
5. **How orders are attributed:**
   - Store captures: `attributeStoreSnapshotOrder` (`app/utils/store-snapshot.server.ts:589-662`) writes the whole order total to ONE unconverted visit per snapshot. A second order in the same session converts a second visit, so one session can carry two amounts.
   - Page captures (`app/routes/api.track.tsx:902-990`): `Visit.orderValue` is `perProductRevenue`, the order total split evenly across the order's distinct products. Each order converts one unconverted visit of the session.
   - Both paths store `currency` only when the pixel sent one, so an amount without a currency can exist.
   - Customer captures (`app/utils/customer-journey.server.ts:594-617`) store `amount` (≥ 0 or null) and `currency` (three capital letters or null) on the event.
6. **Shop currency today** (`app/utils/growth-metrics.server.ts:80-91`):
   - `query ProjectGrowthCurrency { shop { currencyCode } }` runs inside the `growth-sales:<shop>:<range>` cache (300 s).
   - It runs only when `read_reports` is granted, so it is not a standalone lookup yet.
   - `cachedValue` (`app/utils/loader-cache.server.ts:37-73`) never caches a rejection.
7. **API and client:**
   - `app/routes/api.growth-report.tsx` authenticates (`authenticate.admin` returns `session` and `admin`), checks Project ownership, then loads the report and the optional comparison with identical filters.
   - `GrowthMeasurementResults` and `LatestSummary` fetch it with `useBackgroundJson`.
8. **Formatting:**
   - `useI18n().formatNumber(value, options)` is `new Intl.NumberFormat(locale, options).format(value)` (`app/utils/i18n.tsx:24-25`).
   - `scripts/check-i18n.mjs:141-168` collects the literal first argument of every call to an identifier named `t`, including calls inside template literals.
9. **UI places:**
   - `GrowthMeasurementResults.tsx`: page-layout tiles 116-170, traffic by source 182-245, children 285-322.
   - `GrowthEngagementMetrics.tsx`: devices table 118-141.
   - `GrowthConversionFunnel.tsx`: four tiles.
   - `app/routes/app.projects.$id.tsx`: `LatestSummary` 164-210.
   - `GrowthResultsSheet.tsx` only mounts `GrowthMeasurementResults` and needs no change.
10. **Checks:**
    - DB-free: `scripts/check-growth-report-ranking.mjs` asserts `.missed`; `scripts/check-growth-report-ui.mjs` renders the sections with a `ranked()` fixture (line 311); `scripts/check-growth-metrics.mjs`; and `scripts/check-projects-ui.mjs`, which tests the report API at 561-596 and the Project route harness at 231-422.
    - Database-backed: `scripts/check-growth-report-sections.mjs` and `scripts/check-growth-reports.mjs`, through `GROWTH_TEST_DATABASE_URL`.
11. **The legacy store snapshot report** (`app/routes/app.store-snapshots.$id.tsx:79, 1004-1029`) already shows an unrelated 0–100 "Weakness" score (`weaknessScore`), in untranslated English.

## Rulings (decisions this plan makes where the spec is silent or would not work as written)

1. **Split:** see "Where this plan sits".
   - 3a covers 7.1 plus 7.2 in the Results sheet (page-layout conversion tiles, funnel, traffic by source, devices, Sessions by page) and the Project page's latest-measurement summary.
   - Other screens get their numbers in 2b–2e; Create Page Projects is 3b.
2. **No new `ChannelSnapshotSession` write.** Spec 7.2's source table says store-level measurements read `ChannelSnapshotSession`, but they read `StoreSnapshotVisit`, which already has `orderValue` and `currency`. Page measurements read `Visit`, which has them too.
   - `ChannelSnapshotSession` is used only by imported legacy channel captures. They show "Not recorded" for revenue whenever they have conversions.
   - Imported customer captures read `CustomerJourneyEvent.amount` and `currency` from `conversion` events.
   - Cost if wrong: imported channel captures never show revenue (spec 13.6 already expects this).
3. **Currency:**
   - Revenue is shown in the shop's currency, `shop { currencyCode }`, read by a shared `getShopCurrency(admin, shop)` cached 300 s and reused by `getGrowthMetrics`.
   - Only amounts whose currency equals the shop currency are summed. A conversion with a missing amount, or an amount in another currency, counts as not recorded.
4. **Missing amounts:** one pure helper, `revenueState`, decides:
   - no conversions → the zero amount;
   - no conversion with a recorded amount → "Not recorded";
   - some recorded → the recorded sum with the hint "Some orders have no recorded amount".
5. **Per-page revenue:** the query sums revenue per session first, by the session id the report already uses (`COALESCE("acquisitionId","sessionId")`). Each page row then gets the summed revenue of the converted sessions that viewed it.
   - This mirrors how page conversions count "sessions that viewed the page and converted".
   - Page revenues can overlap across pages, like page conversions. The Sessions by page help text says so.
6. **Weakness rename:**
   - The column, the help text and the Focus rows are renamed, and `RankedGrowthPage.missed` becomes `weakness`. The calculation is unchanged.
   - The old catalog key "Missed sessions" is removed, and so are the four old Focus sentences, which the new Focus wording replaces.
   - The legacy store snapshot report's unrelated 0–100 "Weakness" score (`weaknessScore`) stays until 2c retires that screen.
7. **Money format:** one shared formatter, `formatMoney(amount, currency, formatNumber)` = `formatNumber(amount, { style: "currency", currency })`, so it uses the app locale from `useI18n()`. `revenueText` uses it everywhere this plan shows revenue.
8. **An amount without a currency counts as not recorded.** Fact 5 shows such rows exist. Guessing the shop currency for them could mix currencies.
   - Cost if wrong: some older orders show as not recorded.
9. **No shop currency (Shopify did not answer):**
   - `getShopCurrency` returns null and does not cache the failure.
   - The report sums nothing, and every revenue figure shows "Not recorded", including the zero case, because no currency can be formatted.
   - The report cache key includes the currency, so a later answer is not hidden by a cached null result.
10. **Where the hint goes:**
    - Tiles show it as the tile caption.
    - Table cells with a partly recorded figure end in `*`, and one line under the table reads `* Some orders have no recorded amount`. The asterisk stays outside the translation.
11. **Layout of the new numbers:**
    - The revenue column sits right after the conversion rate it belongs to.
    - Where only a rate was shown, a conversion count is added: devices, Sessions by page, and the Project summary.
    - The funnel gets a fifth tile, **Revenue**.
    - With a comparison, the Revenue tile's caption is "{value} in {name}", with no delta (the existing Sessions/Converted sessions pattern).
12. **Customer captures:** only `conversion` events count. A session's summed amounts sit on its first page row, so joining several pages never multiplies them.
13. **Not in 3a:** the customer journeys list in the Results sheet shows no conversion rate, so it gets no revenue. The daily series is not drawn in the Results sheet.

## Review Focus

1. **Mixed currencies:** the shop is in EUR and one order was paid in USD. Expected: only EUR amounts are summed, the USD order counts as not recorded, and the figure carries the hint. Reading the same measurement for a USD shop sums only the USD order. Pinned by Task 4's EUR/USD/no-currency report assertions and Task 1's `revenueState` partial test.
2. **Partial amounts:** some converted sessions have an amount and some don't. Expected: the recorded sum with "Some orders have no recorded amount" (tile caption, or `*` plus a footnote in tables), never "Not recorded" and never a silently complete-looking sum. Pinned by Task 1's `revenueText` tests and Task 6's tile, funnel, traffic, devices and pages tests.
3. **A session converting twice:** a store session whose two orders were attributed to two different page views. Expected: one conversion, and revenue equal to both orders (50 = 30 + 20). Every page the session viewed gets 50, not 30 or 20. Pinned by Task 4's `acq_r1` and `boot` fixtures.
4. **A page with 0 conversions:** expected the zero amount (for example €0.00), not "Not recorded" and not NaN. Pinned by Task 1's zero test, Task 4's `/pages/about` row and Task 6's sessions-by-page and funnel tests.
5. **A report with no detailed data** (an imported channel capture with a conversion, or no shop currency). Expected: revenue shows "Not recorded", and nothing crashes or shows NaN. Pinned by Task 4's imported-channel and null-currency assertions, and Task 6's "Not recorded" tile test.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `app/utils/revenue.ts` | create | `RevenueCounts`, `revenueState`, `formatMoney`, `revenueText`, `revenueCell`, `PARTIAL_REVENUE_MARK` |
| `app/utils/shop-currency.server.ts` | create | `getShopCurrency(admin, shop)`, cached 300 s per shop |
| `app/utils/growth-metrics.server.ts` | modify | Use `getShopCurrency` instead of its inline query |
| `app/utils/growth-report.ts` | modify | `missed` → `weakness`; revenue fields and `currency` on the report types |
| `app/utils/growth-report.server.ts` | modify | Per-session revenue in the report query; `currency` argument |
| `app/utils/loader-cache.server.ts` | modify | Report cache key includes the currency |
| `app/routes/api.growth-report.tsx` | modify | Read the shop currency and pass it to both reports |
| `app/components/GrowthSessionsByPage.tsx` | modify | Weakness column, help and Focus rows; Conversions and Revenue columns |
| `app/components/GrowthConversionFunnel.tsx` | modify | Revenue tile |
| `app/components/GrowthEngagementMetrics.tsx` | modify | Devices: Conversions and Revenue columns |
| `app/components/GrowthMeasurementResults.tsx` | modify | Revenue tile, traffic Revenue column, currency to children |
| `app/routes/app.projects.$id.tsx` | modify | `LatestSummary`: Conversions and Revenue tiles |
| `app/locales/catalog.ts` | modify | 8 new strings, 5 removed |
| `scripts/check-revenue.mjs` | create | Tests for Tasks 1–2 |
| `scripts/check-growth-metrics.mjs` | modify | Load the shared currency lookup |
| `scripts/check-growth-report-ranking.mjs`, `scripts/check-growth-report-ui.mjs` | modify | Weakness and revenue UI tests |
| `scripts/check-growth-report-sections.mjs`, `scripts/check-growth-reports.mjs` | modify | Revenue SQL tests (loopback Postgres) |
| `scripts/check-projects-ui.mjs` | modify | Report API currency test, `LatestSummary` test |

---

### Task 1: Revenue rules and money format

**Files:**
- Create: `app/utils/revenue.ts`
- Modify: `app/locales/catalog.ts` (append one entry)
- Test: `scripts/check-revenue.mjs` (create)

**Interfaces:**
- Consumes: `TranslationValues` from `app/utils/i18n-core.ts` (type only).
- Produces:
  - `type RevenueCounts = { revenue: number; pricedConversions: number; unpricedConversions: number }`
  - `type RevenueState = { kind: "amount"; amount: number; partial: boolean } | { kind: "notRecorded" }`
  - `type MoneyFormatters = { t(source: string, values?: TranslationValues): string; formatNumber(value: number, options?: Intl.NumberFormatOptions): string }`
  - `type RevenueText = { value: string; partial: boolean; hint: string | null }`
  - `revenueState(conversions: number, counts: Partial<RevenueCounts> | null | undefined): RevenueState`
  - `formatMoney(amount: number, currency: string, formatNumber: MoneyFormatters["formatNumber"]): string`
  - `revenueText(conversions: number, counts: Partial<RevenueCounts> | null | undefined, currency: string | null | undefined, formatters: MoneyFormatters): RevenueText`
  - `revenueCell(text: RevenueText): string`
  - `PARTIAL_REVENUE_MARK = "*"`

- [ ] **Step 1: Write the failing tests**

Create `scripts/check-revenue.mjs`:

```js
// Revenue rules, money format and the shop currency lookup (plan 3a).
// Read-only: loads small modules with mocks; never touches Shopify or a database.
// Run: node --test scripts/check-revenue.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
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

const revenue = loadModule("app/utils/revenue.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));
const t = (key, vars = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
const formatters = (locale) => ({
  t,
  formatNumber: (value, options) => new Intl.NumberFormat(locale, options).format(value),
});
const counts = (sum, priced, unpriced) => ({
  revenue: sum,
  pricedConversions: priced,
  unpricedConversions: unpriced,
});

test("no conversions show the zero amount, never Not recorded", () => {
  assert.deepEqual(plain(revenue.revenueState(0, counts(0, 0, 0))), {
    kind: "amount",
    amount: 0,
    partial: false,
  });
  assert.deepEqual(plain(revenue.revenueText(0, counts(0, 0, 0), "EUR", formatters("en"))), {
    value: "€0.00",
    partial: false,
    hint: null,
  });
});

test("conversions without any recorded amount show Not recorded", () => {
  assert.deepEqual(plain(revenue.revenueState(3, counts(0, 0, 3))), { kind: "notRecorded" });
  // A converted session with no order row at all is neither priced nor unpriced.
  assert.deepEqual(plain(revenue.revenueState(2, counts(0, 0, 0))), { kind: "notRecorded" });
  assert.deepEqual(plain(revenue.revenueText(3, counts(0, 0, 3), "EUR", formatters("en"))), {
    value: "Not recorded",
    partial: false,
    hint: null,
  });
});

test("partly recorded revenue shows the recorded sum with the hint", () => {
  // Mixed currencies: the other-currency orders are unpriced, so the EUR sum is partial.
  assert.deepEqual(plain(revenue.revenueState(5, counts(90, 2, 3))), {
    kind: "amount",
    amount: 90,
    partial: true,
  });
  // One session bought twice, one order without an amount: priced and unpriced at once.
  assert.deepEqual(plain(revenue.revenueState(1, counts(50, 1, 1))), {
    kind: "amount",
    amount: 50,
    partial: true,
  });
  // A converted session that is neither priced nor unpriced still makes the figure partial.
  assert.equal(revenue.revenueState(3, counts(40, 2, 0)).partial, true);
  const text = revenue.revenueText(5, counts(90, 2, 3), "EUR", formatters("en"));
  assert.deepEqual(plain(text), {
    value: "€90.00",
    partial: true,
    hint: "Some orders have no recorded amount",
  });
  assert.equal(revenue.revenueCell(text), "€90.00*");
  assert.equal(revenue.PARTIAL_REVENUE_MARK, "*");
});

test("fully recorded revenue has no hint and no mark", () => {
  const text = revenue.revenueText(2, counts(42, 2, 0), "EUR", formatters("en"));
  assert.deepEqual(plain(text), { value: "€42.00", partial: false, hint: null });
  assert.equal(revenue.revenueCell(text), "€42.00");
});

test("money uses the shop currency in the app's language", () => {
  assert.equal(revenue.formatMoney(1234.5, "EUR", formatters("de").formatNumber), "1.234,50 €");
  assert.equal(revenue.formatMoney(1234.5, "USD", formatters("en").formatNumber), "$1,234.50");
  assert.equal(revenue.formatMoney(1234.5, "JPY", formatters("en").formatNumber), "¥1,235");
});

test("without a shop currency revenue shows Not recorded", () => {
  assert.equal(revenue.revenueText(2, counts(42, 2, 0), null, formatters("en")).value, "Not recorded");
  assert.equal(revenue.revenueText(0, counts(0, 0, 0), undefined, formatters("en")).value, "Not recorded");
});

test("missing or broken counts never produce NaN", () => {
  for (const value of [undefined, null, {}, counts(Number.NaN, Number.NaN, Number.NaN)])
    assert.equal(revenue.revenueText(2, value, "EUR", formatters("en")).value, "Not recorded");
  assert.equal(revenue.revenueText(Number.NaN, counts(10, 1, 0), "EUR", formatters("en")).value, "€0.00");
  assert.equal(revenue.revenueText(1, counts(Number.NaN, 1, 0), "EUR", formatters("en")).value, "€0.00");
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test scripts/check-revenue.mjs`
Expected: FAIL. `loadModule` throws `ENOENT … app/utils/revenue.ts`.

- [ ] **Step 3: Write the module**

Create `app/utils/revenue.ts`:

```ts
import type { TranslationValues } from "./i18n-core";

/** Revenue for one set of sessions, as the report query returns it (spec 7.2). */
export type RevenueCounts = {
  /** Sum of order amounts recorded in the shop's currency, over converted sessions. */
  revenue: number;
  /** Converted sessions with at least one order amount in the shop's currency. */
  pricedConversions: number;
  /** Converted sessions with an order that has no amount, or one in another currency. */
  unpricedConversions: number;
};

export type RevenueState =
  | { kind: "amount"; amount: number; partial: boolean }
  | { kind: "notRecorded" };

export type MoneyFormatters = {
  t: (source: string, values?: TranslationValues) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
};

export type RevenueText = { value: string; partial: boolean; hint: string | null };

/** Ends a partly recorded figure in a table cell; one line under the table explains it. */
export const PARTIAL_REVENUE_MARK = "*";

const positive = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

/**
 * Spec 7.2, missing amounts:
 * - no conversions show the zero amount;
 * - conversions without any recorded amount show "Not recorded";
 * - some missing amounts show the recorded sum, flagged as partial.
 */
export function revenueState(
  conversions: number,
  counts: Partial<RevenueCounts> | null | undefined,
): RevenueState {
  const total = positive(conversions);
  if (!total) return { kind: "amount", amount: 0, partial: false };
  const priced = positive(counts?.pricedConversions);
  if (!priced) return { kind: "notRecorded" };
  const amount = Number(counts?.revenue);
  return {
    kind: "amount",
    amount: Number.isFinite(amount) ? amount : 0,
    partial: positive(counts?.unpricedConversions) > 0 || priced < total,
  };
}

/** The one money format: the shop's currency in the app's language. */
export function formatMoney(
  amount: number,
  currency: string,
  formatNumber: MoneyFormatters["formatNumber"],
): string {
  return formatNumber(amount, { style: "currency", currency });
}

/**
 * Revenue as shown beside a conversion rate. Without a shop currency nothing was
 * summed and nothing can be formatted, so it shows "Not recorded".
 */
export function revenueText(
  conversions: number,
  counts: Partial<RevenueCounts> | null | undefined,
  currency: string | null | undefined,
  { t, formatNumber }: MoneyFormatters,
): RevenueText {
  const state = revenueState(conversions, counts);
  if (state.kind === "notRecorded" || !currency)
    return { value: t("Not recorded"), partial: false, hint: null };
  return {
    value: formatMoney(state.amount, currency, formatNumber),
    partial: state.partial,
    hint: state.partial ? t("Some orders have no recorded amount") : null,
  };
}

/** A table cell: the figure, ending in the partial mark when partly recorded. */
export function revenueCell(text: RevenueText): string {
  return text.partial ? `${text.value}${PARTIAL_REVENUE_MARK}` : text.value;
}
```

- [ ] **Step 4: Add the hint string**

Append this entry to `app/locales/catalog.ts`, directly above its final `};`:

```ts
  "Some orders have no recorded amount": [
    "Für einige Bestellungen ist kein Betrag erfasst",
    "部分订单未记录金额",
    "部分訂單未記錄金額",
  ],
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test scripts/check-revenue.mjs && node --test scripts/check-i18n.mjs`
Expected: PASS (7 tests), PASS.

- [ ] **Step 6: Run the regression bar and type-check**

Run: `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt && npm run build && npx tsc --noEmit 2>&1 | grep -E "app/utils/revenue" ; echo "tsc-grep-exit=$?"`
Expected: `No regressions against …` (the new `check-revenue.mjs` is listed PASS), a successful build, and `tsc-grep-exit=1`. No database-backed check is affected by this task.

- [ ] **Step 7: Commit**

```bash
git add app/utils/revenue.ts app/locales/catalog.ts scripts/check-revenue.mjs
git commit -m "Add the revenue rules and the shared money format" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shared shop currency lookup

**Files:**
- Create: `app/utils/shop-currency.server.ts`
- Modify: `app/utils/growth-metrics.server.ts:1-3` (import), `:80-95` (use it)
- Test: `scripts/check-revenue.mjs` (append), `scripts/check-growth-metrics.mjs:1-38` (load the new module)

**Interfaces:**
- Consumes: `cachedValue` from `app/utils/loader-cache.server.ts`.
- Produces: `getShopCurrency(admin: { graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<Response> }, shop: string): Promise<string | null>`. It is cached 300 s per shop under the key `shop-currency:<shop>`; failures are not cached; it never throws.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/check-revenue.mjs`:

```js
// Each call answers with the next item: a JSON body, or a function that throws.
const adminAnswering = (answers) => {
  const calls = [];
  return {
    calls,
    graphql: async (query) => {
      calls.push(query);
      const next = answers.shift();
      return typeof next === "function" ? next() : Response.json(next);
    },
  };
};

test("the shop currency is read once per shop and then cached", async () => {
  // A fresh load also loads a fresh loader cache.
  const { getShopCurrency } = loadModule("app/utils/shop-currency.server.ts");
  const admin = adminAnswering([
    { data: { shop: { currencyCode: "EUR" } } },
    { data: { shop: { currencyCode: "CHF" } } },
  ]);
  assert.equal(await getShopCurrency(admin, "a.myshopify.com"), "EUR");
  assert.equal(await getShopCurrency(admin, "a.myshopify.com"), "EUR");
  assert.equal(admin.calls.length, 1);
  assert.match(admin.calls[0], /shop \{ currencyCode \}/);
  assert.equal(await getShopCurrency(admin, "b.myshopify.com"), "CHF");
  assert.equal(admin.calls.length, 2);
});

test("an unanswered or malformed currency is null and is asked again next time", async () => {
  const { getShopCurrency } = loadModule("app/utils/shop-currency.server.ts");
  const admin = adminAnswering([
    { errors: [{ message: "Throttled" }] },
    { data: { shop: { currencyCode: "eur" } } },
    () => {
      throw new Error("network down");
    },
    { data: { shop: { currencyCode: "EUR" } } },
  ]);
  assert.equal(await getShopCurrency(admin, "a.myshopify.com"), null);
  assert.equal(await getShopCurrency(admin, "a.myshopify.com"), null);
  assert.equal(await getShopCurrency(admin, "a.myshopify.com"), null);
  assert.equal(await getShopCurrency(admin, "a.myshopify.com"), "EUR");
  assert.equal(admin.calls.length, 4);
});
```

In `scripts/check-growth-metrics.mjs`, replace lines 1–38 (from `import assert from "node:assert/strict";` through `const { analyticsRows, analyticsNumber, getGrowthMetrics } = module.exports;`) with:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const progress = {
  rangeStart: "2026-10-01",
  rangeEnd: "2026-10-22",
  status: "ready",
  currentSessions: 1000,
  currentRate: 2,
};
// Transpiles one app/utils file and runs it; `resolve` answers its imports.
function compile(file, resolve) {
  const module = { exports: {} };
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL(`../app/utils/${file}`, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    { module, exports: module.exports, require: resolve },
  );
  return module.exports;
}
const passThroughCache = { cachedValue: (_key, _ttl, load) => load() };
const shopCurrency = compile("shop-currency.server.ts", (id) => {
  if (id === "./loader-cache.server") return passThroughCache;
  throw new Error(id);
});
const { analyticsRows, analyticsNumber, getGrowthMetrics } = compile(
  "growth-metrics.server.ts",
  (id) => {
    if (id === "./loader-cache.server") return passThroughCache;
    if (id === "./shopify-analytics.server")
      return { getShopifyConversionProgress: async () => progress };
    if (id === "./shop-currency.server") return shopCurrency;
    throw new Error(id);
  },
);
```

The rest of the file stays. Its admin double still answers `ProjectGrowthCurrency` with EUR, and `result.sales.currency` must still be `"EUR"`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test scripts/check-revenue.mjs; node --test scripts/check-growth-metrics.mjs`
Expected: both FAIL with `ENOENT … app/utils/shop-currency.server.ts`.

- [ ] **Step 3: Write the shared lookup**

Create `app/utils/shop-currency.server.ts`:

```ts
import { cachedValue } from "./loader-cache.server";

type Admin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const SHOP_CURRENCY_TTL_MS = 300_000;
const CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * The shop's currency (Admin GraphQL `shop.currencyCode`), cached for 5 minutes
 * per shop. Revenue is summed and shown in it (spec 7.2). Returns null when
 * Shopify does not answer with a currency code; a failure is not cached, so
 * the next request asks again.
 */
export async function getShopCurrency(
  admin: Admin,
  shop: string,
): Promise<string | null> {
  try {
    return await cachedValue(
      `shop-currency:${shop}`,
      SHOP_CURRENCY_TTL_MS,
      async () => {
        const response = await admin.graphql(
          `query ProjectGrowthCurrency { shop { currencyCode } }`,
        );
        const payload = await response.json();
        const code = payload?.data?.shop?.currencyCode;
        if (typeof code !== "string" || !CURRENCY_CODE.test(code))
          throw new Error("Shop currency unavailable");
        return code;
      },
    );
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Reuse it in growth metrics**

In `app/utils/growth-metrics.server.ts`, add after line 2 (`import { getShopifyConversionProgress } from "./shopify-analytics.server";`):

```ts
import { getShopCurrency } from "./shop-currency.server";
```

Then replace:

```ts
        const [totals, series, currencyResponse] = await Promise.all([
          salesQuery(input.admin, `${base}\n${range}`),
          salesQuery(
            input.admin,
            `${base}\nTIMESERIES day\n${range}\nORDER BY day ASC`,
          ),
          input.admin.graphql(
            `query ProjectGrowthCurrency { shop { currencyCode } }`,
          ),
        ]);
        const currencyPayload = await currencyResponse.json();
        const currency = currencyPayload.data?.shop?.currencyCode || null;
```

with:

```ts
        const [totals, series, currency] = await Promise.all([
          salesQuery(input.admin, `${base}\n${range}`),
          salesQuery(
            input.admin,
            `${base}\nTIMESERIES day\n${range}\nORDER BY day ASC`,
          ),
          getShopCurrency(input.admin, input.shop),
        ]);
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test scripts/check-revenue.mjs && node --test scripts/check-growth-metrics.mjs`
Expected: PASS (9 tests), PASS.

- [ ] **Step 6: Run the regression bar and type-check**

Run: `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt && npm run build && npx tsc --noEmit 2>&1 | grep -E "app/utils/(shop-currency|growth-metrics)" ; echo "tsc-grep-exit=$?"`
Expected: `No regressions…`, a successful build, and `tsc-grep-exit=1`. No database-backed check is affected.

- [ ] **Step 7: Commit**

```bash
git add app/utils/shop-currency.server.ts app/utils/growth-metrics.server.ts scripts/check-revenue.mjs scripts/check-growth-metrics.mjs
git commit -m "Share one cached shop currency lookup" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Weakness

**Files:**
- Modify: `app/utils/growth-report.ts:120-127, 152-153, 178-197`
- Modify: `app/components/GrowthSessionsByPage.tsx` (rewrite)
- Modify: `app/locales/catalog.ts` (remove 5 entries, append 6)
- Test: `scripts/check-growth-report-ranking.mjs`, `scripts/check-growth-report-ui.mjs:311-343`

**Interfaces:**
- Consumes: nothing new.
- Produces: `RankedGrowthPage.weakness: number | null` (replaces `missed`). `GrowthSessionsByPage({ pages, available })` is unchanged until Task 6.

- [ ] **Step 1: Write the failing tests**

In `scripts/check-growth-report-ranking.mjs`:
- Replace line 1 with `// Database-free checks for the Store "Weakness" ranking.`
- Replace every `.missed` with `.weakness`: lines 53, 55, 57, 70 and 93 (`row.missed` → `row.weakness`).
- Rename two tests:
  - `"missed sessions compare a page with the median rate of its type"` → `"weakness compares a page with the median rate of its type"`.
  - `"only the top three pages with missed sessions get a focus badge"` → `"only the top three pages with a weakness get a focus badge"`.
- Append:

```js
test("ranked rows carry weakness and no longer carry missed", () => {
  const [row] = rankGrowthPages([
    page("/pages/a", "PAGE", 100, { forwards: 10 }),
    page("/pages/b", "PAGE", 100, { forwards: 30 }),
    page("/pages/c", "PAGE", 100, { forwards: 50 }),
  ]);
  assert.equal(row.path, "/pages/a");
  assert.equal(row.weakness, 20, "max(0, round(100 × (30 − 10) / 100))");
  assert.equal("missed" in row, false);
});
```

In `scripts/check-growth-report-ui.mjs`, replace the `ranked` fixture and the first sessions-by-page test (lines 311–343) with:

```js
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
  weakness: null,
  focus: false,
  ...extra,
});

test("sessions by page explains each focus page by its weakness and badges it", () => {
  const { GrowthSessionsByPage } = load("app/components/GrowthSessionsByPage.tsx", common);
  const html = render(GrowthSessionsByPage, {
    available: true,
    pages: [
      ranked("/collections/autumn", "COLLECTION", 420, { keyRate: 20, typicalRate: 31, weakness: 46, focus: true }),
      ranked("/products/sample", "PRODUCT", 300, { keyRate: 16, typicalRate: 19, weakness: 9, focus: true }),
      ranked("/search", null, 40),
    ],
  });
  assert.match(
    html,
    /Weakness 46: about 46 fewer sessions continued from here than from your typical collection\./,
  );
  assert.match(
    html,
    /Weakness 9: about 9 fewer sessions added to cart here than on your typical product page\./,
  );
  assert.equal((html.match(/<mark>Focus here<\/mark>/g) || []).length, 4, "Two sentences and two table rows");
  assert.match(html, /Other/);
  assert.match(html, /—/, "Unranked pages show a dash for weakness");
  assert.match(html, /<th>Weakness<\/th>/);
  assert.match(html, /Weakness is how many sessions a page lost against the typical page of its type\./);
  assert.doesNotMatch(html, /Missed sessions|more sessions would have/);
});

test("blog and other page types get their own weakness sentence", () => {
  const { GrowthSessionsByPage } = load("app/components/GrowthSessionsByPage.tsx", common);
  const html = render(GrowthSessionsByPage, {
    available: true,
    pages: [
      ranked("/blogs/news/a", "BLOG", 100, { weakness: 12, focus: true }),
      ranked("/pages/about", "PAGE", 100, { weakness: 5, focus: true }),
    ],
  });
  assert.match(html, /Weakness 12: about 12 fewer sessions continued from here than from your typical blog post\./);
  assert.match(html, /Weakness 5: about 5 fewer sessions continued from here than from your typical page of this type\./);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test scripts/check-growth-report-ranking.mjs; node --test scripts/check-growth-report-ui.mjs`
Expected: both FAIL. The ranking checks get `undefined` for `.weakness`; the UI checks find no `Weakness` text.

- [ ] **Step 3: Rename the field**

In `app/utils/growth-report.ts`, replace:

```ts
  typicalRate: number | null;
  missed: number | null;
  focus: boolean;
```

with:

```ts
  typicalRate: number | null;
  weakness: number | null;
  focus: boolean;
```

Replace:

```ts
// Missed sessions: how many more sessions would have moved forward if the page
// matched the typical (median) page of its type in this measurement.
```

with:

```ts
// Weakness (spec 7.1): how many sessions a page lost against the typical (median)
// page of its type in this measurement. Formerly "missed sessions"; same calculation.
```

Replace:

```ts
      missed: comparable
        ? Math.max(0, Math.round((row.sessions * (typicalRate - keyRate)) / 100))
        : null,
```

with:

```ts
      weakness: comparable
        ? Math.max(0, Math.round((row.sessions * (typicalRate - keyRate)) / 100))
        : null,
```

Replace:

```ts
      (b.missed ?? -1) - (a.missed ?? -1) ||
```

with:

```ts
      (b.weakness ?? -1) - (a.weakness ?? -1) ||
```

Replace:

```ts
    if ((row.missed ?? 0) > 0) {
```

with:

```ts
    if ((row.weakness ?? 0) > 0) {
```

- [ ] **Step 4: Rename the column, help text and Focus rows**

Replace the whole of `app/components/GrowthSessionsByPage.tsx` with:

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
    value === null
      ? "—"
      : `${formatNumber(value, { maximumFractionDigits: 1 })}%`;
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
  // A Focus row names the page's Weakness, then what it means for that page type.
  const reason = (row: RankedGrowthPage) => {
    const count = formatNumber(row.weakness ?? 0);
    if (row.type === "PRODUCT")
      return t(
        "Weakness {count}: about {count} fewer sessions added to cart here than on your typical product page.",
        { count },
      );
    if (row.type === "COLLECTION")
      return t(
        "Weakness {count}: about {count} fewer sessions continued from here than from your typical collection.",
        { count },
      );
    if (row.type === "BLOG")
      return t(
        "Weakness {count}: about {count} fewer sessions continued from here than from your typical blog post.",
        { count },
      );
    return t(
      "Weakness {count}: about {count} fewer sessions continued from here than from your typical page of this type.",
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
              "Weakness is how many sessions a page lost against the typical page of its type.",
            )}
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
            t("Weakness"),
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
              row.weakness === null ? "—" : formatNumber(row.weakness),
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

- [ ] **Step 5: Swap the strings**

In `app/locales/catalog.ts`, delete these five entries (lines 1801–1820 and 1850 at 7e57303):

```ts
  "About {count} more sessions would have added to cart if this page matched your other products.": [
    "Etwa {count} weitere Sitzungen hätten etwas in den Warenkorb gelegt, wenn diese Seite Ihren anderen Produkten entspräche.",
    "如果此页面达到您其他产品页的水平，大约还会多 {count} 个会话加购。",
    "如果此頁面達到您其他商品頁的水準，大約還會多 {count} 個工作階段加入購物車。",
  ],
  "About {count} more sessions would have continued if this page matched your other blog posts.": [
    "Etwa {count} weitere Sitzungen wären weitergegangen, wenn diese Seite Ihren anderen Blogbeiträgen entspräche.",
    "如果此页面达到您其他博客文章的水平，大约还会多 {count} 个会话继续浏览。",
    "如果此頁面達到您其他部落格文章的水準，大約還會多 {count} 個工作階段繼續瀏覽。",
  ],
  "About {count} more sessions would have continued if this page matched your other collections.": [
    "Etwa {count} weitere Sitzungen wären weitergegangen, wenn diese Seite Ihren anderen Kollektionen entspräche.",
    "如果此页面达到您其他系列页的水平，大约还会多 {count} 个会话继续浏览。",
    "如果此頁面達到您其他系列頁的水準，大約還會多 {count} 個工作階段繼續瀏覽。",
  ],
  "About {count} more sessions would have continued if this page matched your other pages.": [
    "Etwa {count} weitere Sitzungen wären weitergegangen, wenn diese Seite Ihren anderen Seiten entspräche.",
    "如果此页面达到您其他页面的水平，大约还会多 {count} 个会话继续浏览。",
    "如果此頁面達到您其他頁面的水準，大約還會多 {count} 個工作階段繼續瀏覽。",
  ],
```

```ts
  "Missed sessions": ["Verpasste Sitzungen", "错失的会话", "錯失的工作階段"],
```

Append these entries directly above the final `};`:

```ts
  Weakness: ["Schwäche", "薄弱度", "薄弱度"],
  "Weakness is how many sessions a page lost against the typical page of its type.": [
    "Schwäche gibt an, wie viele Sitzungen eine Seite im Vergleich zur typischen Seite ihres Typs verloren hat.",
    "薄弱度表示一个页面相比同类型的典型页面损失了多少会话。",
    "薄弱度表示一個頁面相比同類型的典型頁面損失了多少工作階段。",
  ],
  "Weakness {count}: about {count} fewer sessions added to cart here than on your typical product page.": [
    "Schwäche {count}: Etwa {count} Sitzungen weniger haben hier etwas in den Warenkorb gelegt als auf Ihrer typischen Produktseite.",
    "薄弱度 {count}：此页面加购的会话比您的典型产品页少约 {count} 个。",
    "薄弱度 {count}：此頁面加入購物車的工作階段比您的典型商品頁少約 {count} 個。",
  ],
  "Weakness {count}: about {count} fewer sessions continued from here than from your typical collection.": [
    "Schwäche {count}: Etwa {count} Sitzungen weniger sind von hier weitergegangen als von Ihrer typischen Kollektion.",
    "薄弱度 {count}：从此页面继续浏览的会话比您的典型系列页少约 {count} 个。",
    "薄弱度 {count}：從此頁面繼續瀏覽的工作階段比您的典型系列頁少約 {count} 個。",
  ],
  "Weakness {count}: about {count} fewer sessions continued from here than from your typical blog post.": [
    "Schwäche {count}: Etwa {count} Sitzungen weniger sind von hier weitergegangen als von Ihrem typischen Blogbeitrag.",
    "薄弱度 {count}：从此页面继续浏览的会话比您的典型博客文章少约 {count} 个。",
    "薄弱度 {count}：從此頁面繼續瀏覽的工作階段比您的典型部落格文章少約 {count} 個。",
  ],
  "Weakness {count}: about {count} fewer sessions continued from here than from your typical page of this type.": [
    "Schwäche {count}: Etwa {count} Sitzungen weniger sind von hier weitergegangen als von Ihrer typischen Seite dieses Typs.",
    "薄弱度 {count}：从此页面继续浏览的会话比您同类型的典型页面少约 {count} 个。",
    "薄弱度 {count}：從此頁面繼續瀏覽的工作階段比您同類型的典型頁面少約 {count} 個。",
  ],
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `node --test scripts/check-growth-report-ranking.mjs && node --test scripts/check-growth-report-ui.mjs && node --test scripts/check-i18n.mjs && ! grep -rn "Missed sessions\|\.missed\b" app scripts`
Expected: PASS, PASS, PASS, and the grep prints nothing (exit 0 after `!`).

- [ ] **Step 7: Run the regression bar and type-check**

Run: `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt && npm run build && npx tsc --noEmit 2>&1 | grep -E "app/(utils/growth-report\.ts|components/GrowthSessionsByPage)" ; echo "tsc-grep-exit=$?"`
Expected: `No regressions…`, a successful build, and `tsc-grep-exit=1`.

Database-backed checks: `check-growth-report-sections.mjs` reads `pages[].sessions/forwards/exits` only, never `.missed`, so this task does not change it. Task 4 runs it on loopback.

- [ ] **Step 8: Commit**

```bash
git add app/utils/growth-report.ts app/components/GrowthSessionsByPage.tsx app/locales/catalog.ts scripts/check-growth-report-ranking.mjs scripts/check-growth-report-ui.mjs
git commit -m "Rename missed sessions to Weakness" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Revenue in the report query

**Files:**
- Modify: `app/utils/growth-report.ts` (report types)
- Modify: `app/utils/growth-report.server.ts` (rewrite)
- Modify: `app/utils/loader-cache.server.ts:21-32` (report cache key)
- Test: `scripts/check-growth-report-sections.mjs`, `scripts/check-growth-reports.mjs` (loopback Postgres)

**Interfaces:**
- Consumes: `RevenueCounts` (Task 1, type only).
- Produces:
  - `getGrowthMeasurementReport(shop, projectId, measurementId, filters, currency: string | null = null): Promise<GrowthReport>`.
  - `GrowthReport` gains `currency: string | null` and `revenue`, `pricedConversions`, `unpricedConversions` (totals).
  - `GrowthReport["channels"][number]`, `GrowthFunnel` and `GrowthPageRow` (so `RankedGrowthPage`) gain the three `RevenueCounts` fields.
  - `GrowthEngagementSummary["devices"][number]` gains `conversions: number` and the three fields.
  - `loaderCacheKeys.growthReport(shop, projectId, measurementId, filters, currency?: string | null)`.

- [ ] **Step 1: Write the failing SQL tests**

In `scripts/check-growth-report-sections.mjs`:

Replace line 55–56:

```js
const report = (projectId, measurementId, filters = all) =>
  service.getGrowthMeasurementReport(shop, projectId, measurementId, filters);
```

with:

```js
const report = (projectId, measurementId, filters = all, currency = null) =>
  service.getGrowthMeasurementReport(shop, projectId, measurementId, filters, currency);
```

Replace the first funnel assertion (lines 176–181):

```js
  assert.deepEqual(plain(storeReport.funnel), {
    sessions: 6,
    addedToCart: 2,
    checkoutStarted: 1,
    purchased: 1,
  });
```

with:

```js
  assert.deepEqual(plain(storeReport.funnel), {
    sessions: 6,
    addedToCart: 2,
    checkoutStarted: 1,
    purchased: 1,
    // No shop currency was passed, so the one order counts as unpriced.
    revenue: 0,
    pricedConversions: 0,
    unpricedConversions: 1,
  });
```

Replace the imported funnel assertion (lines 366–371):

```js
  assert.deepEqual(plain(imported.funnel), {
    sessions: 1,
    addedToCart: 1,
    checkoutStarted: 1,
    purchased: 0,
  });
```

with:

```js
  assert.deepEqual(plain(imported.funnel), {
    sessions: 1,
    addedToCart: 1,
    checkoutStarted: 1,
    purchased: 0,
    revenue: 0,
    pricedConversions: 0,
    unpricedConversions: 0,
  });
```

Insert directly before the final `console.log(` of the `try` block:

```js
  // ── Revenue (spec 7.2): summed per session in the shop's currency, then given to
  // every page the converted session viewed.
  const revenueProject = await db.growthProject.create({
    data: { shop, title: "Revenue", goal: "Sum orders", scope: "STORE" },
  });
  const revenueStore = await db.storeSnapshot.create({
    data: {
      shop,
      name: "Revenue fixture",
      completionMode: "TIME_WINDOW",
      durationDays: 7,
      endsAt: new Date("2026-12-31"),
      usesAcquisitionSessions: true,
    },
  });
  const revenueMeasurement = await db.growthMeasurement.create({
    data: {
      projectId: revenueProject.id,
      name: "Revenue baseline",
      completionMode: "DURATION",
      durationDays: 7,
      storeSnapshotId: revenueStore.id,
    },
  });
  const order = (orderValue, currency) => ({ converted: true, convertedAt: later(5), orderValue, currency });
  const sale = (pageViewId, acquisitionId, pagePath, resourceType, extra = {}) => ({
    storeSnapshotId: revenueStore.id,
    sessionId: `browser-${acquisitionId}`,
    pageViewId,
    pagePath,
    resourceType,
    visitorType: "REAL",
    acquisitionId,
    acquisitionSource: "facebook",
    acquisitionStartedAt: t0,
    startedAt: t0,
    deviceType: "mobile",
    ...extra,
  });
  await db.storeSnapshotVisit.createMany({
    data: [
      // r1 bought twice: attribution wrote each order to a different page view of the session.
      sale("r1a", "acq_r1", "/collections/shoes", "COLLECTION", { deviceType: "desktop", ...order(30, "EUR") }),
      sale("r1b", "acq_r1", "/products/blue", "PRODUCT", { deviceType: "desktop", startedAt: later(1), ...order(20, "EUR") }),
      // r2 viewed two pages and bought once: its order counts on both pages.
      sale("r2a", "acq_r2", "/collections/shoes", "COLLECTION", { deviceType: "desktop", acquisitionSource: "google", ...order(40, "EUR") }),
      sale("r2b", "acq_r2", "/products/red", "PRODUCT", { deviceType: "desktop", acquisitionSource: "google", startedAt: later(1) }),
      // r3 paid in another currency; r4 has no amount; r6 has an amount but no currency.
      sale("r3", "acq_r3", "/products/red", "PRODUCT", order(25, "USD")),
      sale("r4", "acq_r4", "/products/red", "PRODUCT", order(null, null)),
      // r5 never bought.
      sale("r5", "acq_r5", "/pages/about", "PAGE"),
      sale("r6", "acq_r6", "/products/green", "PRODUCT", order(10, null)),
    ],
  });
  const eur = await report(revenueProject.id, revenueMeasurement.id, all, "EUR");
  assert.equal(eur.currency, "EUR");
  assert.deepEqual(
    [eur.sessions, eur.conversions, eur.revenue, eur.pricedConversions, eur.unpricedConversions],
    [6, 5, 90, 2, 3],
    "Only EUR amounts are summed; USD, a missing amount and a missing currency are unpriced",
  );
  assert.deepEqual(
    [eur.funnel.purchased, eur.funnel.revenue, eur.funnel.pricedConversions, eur.funnel.unpricedConversions],
    [5, 90, 2, 3],
  );
  const pageRevenue = (path) => {
    const row = eur.pages.find((item) => item.path === path);
    return [row.sessions, row.conversions, row.revenue, row.pricedConversions, row.unpricedConversions];
  };
  assert.deepEqual(pageRevenue("/collections/shoes"), [2, 2, 90, 2, 0], "r1's two orders and r2's order");
  assert.deepEqual(pageRevenue("/products/blue"), [1, 1, 50, 1, 0], "A session that bought twice brings both orders");
  assert.deepEqual(pageRevenue("/products/red"), [3, 3, 40, 1, 2], "r2 viewed it and bought; r3 and r4 are unpriced");
  assert.deepEqual(pageRevenue("/pages/about"), [1, 0, 0, 0, 0], "A page without conversions has zero revenue");
  assert.deepEqual(pageRevenue("/products/green"), [1, 1, 0, 0, 1], "An amount without a currency is not recorded");
  assert.deepEqual(
    plain(eur.channels).map((row) => [row.source, row.conversions, row.revenue, row.pricedConversions, row.unpricedConversions]),
    [
      ["facebook", 4, 50, 1, 3],
      ["google", 1, 40, 1, 0],
    ],
  );
  assert.deepEqual(
    plain(eur.engagementSummary.devices).map((row) => [
      row.device,
      row.sessions,
      row.conversions,
      row.revenue,
      row.pricedConversions,
      row.unpricedConversions,
    ]),
    [
      ["mobile", 4, 3, 0, 0, 3],
      ["desktop", 2, 2, 90, 2, 0],
    ],
  );
  const usd = await report(revenueProject.id, revenueMeasurement.id, all, "USD");
  assert.deepEqual(
    [usd.currency, usd.revenue, usd.pricedConversions, usd.unpricedConversions],
    ["USD", 25, 1, 4],
    "The shop currency decides which amounts count",
  );
  const unknown = await report(revenueProject.id, revenueMeasurement.id);
  assert.deepEqual(
    [unknown.currency, unknown.revenue, unknown.pricedConversions, unknown.unpricedConversions],
    [null, 0, 0, 5],
    "Without a shop currency nothing is summed",
  );
  const googleOnly = await report(revenueProject.id, revenueMeasurement.id, { ...all, source: "google" }, "EUR");
  assert.deepEqual(
    [googleOnly.conversions, googleOnly.revenue, googleOnly.pricedConversions],
    [1, 40, 1],
    "Revenue follows the same filters as the rate",
  );

  // Page capture (Visit): the same session bought twice from two loads of the page.
  const bootResource = await db.project.create({
    data: {
      shop,
      resourceType: "PRODUCT",
      productId: "gid://shopify/Product/9",
      productTitle: "Boot",
      productHandle: "boot",
    },
  });
  const bootProject = await db.growthProject.create({
    data: { shop, title: "Boot", goal: "Sell boots", scope: "PAGE", resourceProjectId: bootResource.id },
  });
  const bootSnapshot = await db.snapshot.create({
    data: { projectId: bootResource.id, number: 1, usesAcquisitionSessions: true },
  });
  const bootMeasurement = await db.growthMeasurement.create({
    data: {
      projectId: bootProject.id,
      name: "Boot baseline",
      completionMode: "VISITORS",
      targetVisitors: 100,
      snapshotId: bootSnapshot.id,
    },
  });
  const boot = (pageViewId, acquisitionId, extra = {}) => ({
    snapshotId: bootSnapshot.id,
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
      boot("b1", "acq_b1", order(30, "EUR")),
      boot("b2", "acq_b1", { startedAt: later(2), ...order(12, "EUR") }),
      boot("b3", "acq_b2", order(null, null)),
      boot("b4", "acq_b3"),
    ],
  });
  const bootReport = await report(bootProject.id, bootMeasurement.id, all, "EUR");
  assert.deepEqual(
    [bootReport.sessions, bootReport.conversions, bootReport.revenue, bootReport.pricedConversions, bootReport.unpricedConversions],
    [3, 2, 42, 1, 1],
    "Page captures sum a session's orders once per session",
  );
  assert.deepEqual(plain(bootReport.pages), []);

  // Imported channel capture: amounts were never recorded.
  const soldChannel = await db.channelSnapshot.create({ data: { shop, name: "Imported sale" } });
  await db.channelSnapshotSession.create({
    data: {
      channelSnapshotId: soldChannel.id,
      acquisitionId: "acq_sold",
      trackingSessionId: "browser-sold",
      source: "facebook",
      converted: true,
    },
  });
  const soldProject = await db.growthProject.create({
    data: { shop, title: "Imported sale", goal: "", scope: "STORE" },
  });
  const soldMeasurement = await db.growthMeasurement.create({
    data: {
      projectId: soldProject.id,
      name: "Imported sale",
      completionMode: "VISITORS",
      targetVisitors: 100,
      channelSnapshotId: soldChannel.id,
    },
  });
  const sold = await report(soldProject.id, soldMeasurement.id, all, "EUR");
  assert.deepEqual(
    [sold.conversions, sold.revenue, sold.pricedConversions, sold.unpricedConversions],
    [1, 0, 0, 1],
    "Imported channel captures show Not recorded",
  );

  // Imported customer capture: amounts sit on conversion events; pages must not multiply them.
  const journeys = await db.customerSnapshot.create({
    data: { shop, name: "Imported journeys", source: "facebook", destinationUrl: "https://shop.example/" },
  });
  const journey = (acquisitionId, converted) =>
    db.customerJourneySession.create({
      data: {
        snapshotId: journeys.id,
        acquisitionId,
        trackingSessionId: `browser-${acquisitionId}`,
        source: "facebook",
        landingPath: "/",
        startedAt: t0,
        lastSeenAt: later(5),
        visitorType: "REAL",
        converted,
      },
    });
  const j1 = await journey("acq_j1", true);
  const j2 = await journey("acq_j2", true);
  await journey("acq_j3", false);
  await db.customerJourneyPage.createMany({
    data: [
      { sessionId: j1.id, pageViewId: "j1a", pagePath: "/", startedAt: t0 },
      { sessionId: j1.id, pageViewId: "j1b", pagePath: "/products/boot", startedAt: later(1) },
    ],
  });
  await db.customerJourneyEvent.createMany({
    data: [
      { sessionId: j1.id, eventKey: "order-1", type: "conversion", occurredAt: later(3), orderId: "1", amount: 40, currency: "EUR" },
      { sessionId: j2.id, eventKey: "order-2", type: "conversion", occurredAt: later(3), orderId: "2", amount: 15, currency: "USD" },
      // Other events never carry revenue, even with an amount.
      { sessionId: j1.id, eventKey: "cart-1", type: "add_to_cart", occurredAt: later(2), amount: 99, currency: "EUR" },
    ],
  });
  const journeyProject = await db.growthProject.create({
    data: { shop, title: "Imported journeys", goal: "", scope: "STORE" },
  });
  const journeyMeasurement = await db.growthMeasurement.create({
    data: {
      projectId: journeyProject.id,
      name: "Imported journeys",
      completionMode: "VISITORS",
      targetVisitors: 100,
      customerSnapshotId: journeys.id,
    },
  });
  const journeyReport = await report(journeyProject.id, journeyMeasurement.id, all, "EUR");
  assert.deepEqual(
    [journeyReport.sessions, journeyReport.conversions, journeyReport.revenue, journeyReport.pricedConversions, journeyReport.unpricedConversions],
    [3, 2, 40, 1, 1],
    "A two-page journey counts its order once; the USD order is unpriced",
  );
```

Replace the final `console.log(` message string with:

```js
    "PASS: funnel, click-through rule, searches, devices, medians, exit paths, page rows (buyers, private paths, URL variants), layout-only sections, cohorts, empty filters, imported measurements, and per-session revenue for store, page, channel and customer captures in the shop currency",
```

In the `finally` block, add after `await db.channelSnapshot.deleteMany({ where: { shop } });`:

```js
  await db.customerSnapshot.deleteMany({ where: { shop } });
```

In `scripts/check-growth-reports.mjs`, insert after `assert.equal(report.conversionRate, 25);`:

```js
  const priced = await service(db).getGrowthMeasurementReport(
    shop,
    project.id,
    measurement.id,
    all,
    "EUR",
  );
  assert.deepEqual(
    [priced.currency, priced.conversions, priced.revenue, priced.pricedConversions, priced.unpricedConversions],
    ["EUR", 1, 0, 0, 1],
    "A conversion without an amount is counted, but not summed",
  );
```

Insert after `assert.equal(queries, 2, "Each filter set has its own cache entry");`:

```js
  await cached.getGrowthMeasurementReport(shop, project.id, measurement.id, all, "EUR");
  assert.equal(queries, 3, "Each shop currency has its own cache entry");
```

- [ ] **Step 2: Run the tests to see them fail**

Start the loopback Postgres if it is not running (Global Constraints → Loopback database, steps 1–2). Then run:

```bash
export DATABASE_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke" DIRECT_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke" \
  && node -e 'const h=new URL(process.env.DATABASE_URL).hostname; if(h!=="127.0.0.1"){console.error("NOT LOOPBACK");process.exit(1)} console.log("loopback ok")' \
  && export GROWTH_TEST_DATABASE_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke" JOURNEY_TEST_DATABASE_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke" \
  && { node --test scripts/check-growth-report-sections.mjs; node --test scripts/check-growth-reports.mjs; }
```

Expected: `loopback ok`, then both FAIL. The funnel `deepEqual` lacks `revenue`, and `priced.currency` is `undefined`.

- [ ] **Step 3: Add the revenue fields to the report types**

In `app/utils/growth-report.ts`, replace line 1:

```ts
import type { EngagementOutcomes } from "./click-engagement";
```

with:

```ts
import type { EngagementOutcomes } from "./click-engagement";
import type { RevenueCounts } from "./revenue";
```

Replace:

```ts
export type GrowthReport = {
  sessions: number;
```

with:

```ts
// Every figure set that carries a conversion rate also carries RevenueCounts (spec 7.2).
export type GrowthReport = RevenueCounts & {
  /** The shop's currency, or null when Shopify did not answer. Revenue is in it. */
  currency: string | null;
  sessions: number;
```

Replace:

```ts
  channels: Array<{
    source: string;
    medium: string;
    campaign: string;
    sessions: number;
    addedToCart: number;
    conversions: number;
    conversionRate: number;
  }>;
```

with:

```ts
  channels: Array<
    RevenueCounts & {
      source: string;
      medium: string;
      campaign: string;
      sessions: number;
      addedToCart: number;
      conversions: number;
      conversionRate: number;
    }
  >;
```

Replace:

```ts
  devices: Array<{
    device: string;
    sessions: number;
    share: number;
    conversionRate: number;
  }>;
};
export type GrowthFunnel = {
  sessions: number;
```

with:

```ts
  devices: Array<
    RevenueCounts & {
      device: string;
      sessions: number;
      share: number;
      conversions: number;
      conversionRate: number;
    }
  >;
};
export type GrowthFunnel = RevenueCounts & {
  sessions: number;
```

Replace:

```ts
export type GrowthPageRow = {
  path: string;
```

with:

```ts
// A page's conversions and revenue count every converted session that viewed it,
// so they overlap across pages.
export type GrowthPageRow = RevenueCounts & {
  path: string;
```

- [ ] **Step 4: Key the report cache by currency**

In `app/utils/loader-cache.server.ts`, replace:

```ts
  growthReport: (
    shop: string,
    projectId: string,
    measurementId: string,
    filters: GrowthReportFilters,
  ) =>
    `growth-report:${shop}:${projectId}:${measurementId}:${JSON.stringify([
      filters.audience,
      filters.source,
      filters.medium,
      filters.campaign,
    ])}`,
```

with:

```ts
  growthReport: (
    shop: string,
    projectId: string,
    measurementId: string,
    filters: GrowthReportFilters,
    currency: string | null = null,
  ) =>
    `growth-report:${shop}:${projectId}:${measurementId}:${JSON.stringify([
      filters.audience,
      filters.source,
      filters.medium,
      filters.campaign,
      currency,
    ])}`,
```

- [ ] **Step 5: Sum revenue per session in the query**

Replace the whole of `app/utils/growth-report.server.ts` with:

```ts
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { GrowthProjectError } from "./growth-projects";
import { buildEngagementOutcomes } from "./click-engagement";
import { cachedValue, loaderCacheKeys } from "./loader-cache.server";
import { EXIT_OUTCOMES, rankGrowthPages } from "./growth-report";
import type {
  GrowthEngagementSummary,
  GrowthExitPaths,
  GrowthPageRow,
  GrowthPageType,
  GrowthReport,
  GrowthReportFilters,
} from "./growth-report";
// Shopify Markets paths can carry a locale prefix such as /fr or /en-us, and themes
// that use `product.url | within: collection` link to /collections/<handle>/products/<handle>.
const PRODUCT_PATH = "^(/[a-z]{2}(-[a-z]{2})?)?(/collections/[^/]+)?/products/";
const PRIVATE_PATH = "/(account|accounts|checkouts|orders)(/|$)";
// Sessions by page groups those URL variants of one page under the plain path.
const LOCALE_PREFIX = "^/[a-z]{2}(-[a-z]{2})?(?=/)";
const COLLECTION_PREFIX = "^/collections/[^/]+(?=/products/)";
const REPORT_CACHE_MS = 60_000;
type ClickRow = {
  sessionId: string;
  ctaClicks: string | null;
  addedToCart: boolean;
  converted: boolean;
};
type QueryReport = Omit<
  GrowthReport,
  | "currency"
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
function findCapture(shop: string, projectId: string, measurementId: string) {
  return prisma.growthMeasurement.findFirst({
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
}
type Capture = NonNullable<Awaited<ReturnType<typeof findCapture>>>;
export async function getGrowthMeasurementReport(
  shop: string,
  projectId: string,
  measurementId: string,
  filters: GrowthReportFilters,
  // The shop's currency (getShopCurrency). Null sums nothing: revenue is "Not recorded".
  currency: string | null = null,
): Promise<GrowthReport> {
  // The shop-scoped lookup runs on every call; only the report query is cached.
  const capture = await findCapture(shop, projectId, measurementId);
  if (!capture) throw new GrowthProjectError("Measurement not found.", 404);
  return cachedValue(
    loaderCacheKeys.growthReport(shop, projectId, measurementId, filters, currency),
    REPORT_CACHE_MS,
    () => loadReport(capture, filters, currency),
  );
}
async function loadReport(
  capture: Capture,
  filters: GrowthReportFilters,
  shopCurrency: string | null,
): Promise<GrowthReport> {
  const layout = capture.project.scope === "STORE" ? "store" : "page";
  const store = layout === "store";
  const pageType = (capture.project.resourceProject?.resourceType ??
    null) as GrowthPageType | null;
  // Imported Channel/Customer captures never recorded exits, devices, searches or clicks.
  const detailed = Boolean(capture.snapshotId || capture.storeSnapshotId);
  // Revenue (spec 7.2) counts an order only with an amount in the shop's currency.
  // Any other order of a converted session (no amount, another currency, or no
  // currency at all) is "unpriced"; the screens show those as not recorded.
  const inShopCurrency = (amount: Prisma.Sql, code: Prisma.Sql) =>
    Prisma.sql`COALESCE(${amount} IS NOT NULL AND ${code} = ${shopCurrency}, false)`;
  // Session ids (and grouped page paths below) use byte order ("C"): groups are identical
  // and the large sorts are several times faster than with the database's locale.
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
    // Attribution writes each order to one page view of the session.
    const priced = inShopCurrency(Prisma.sql`"orderValue"`, Prisma.sql`currency`);
    rows = Prisma.sql`SELECT COALESCE("acquisitionId", "sessionId") COLLATE "C" AS id, COALESCE("acquisitionStartedAt", "startedAt") AS "startedAt", "startedAt" AS "viewedAt", "visitorType"::text AS kind,
      CASE WHEN "acquisitionId" IS NOT NULL THEN "acquisitionSource" ELSE source END AS source,
      CASE WHEN "acquisitionId" IS NOT NULL THEN "acquisitionMedium" ELSE medium END AS medium,
      CASE WHEN "acquisitionId" IS NOT NULL THEN "acquisitionCampaign" ELSE campaign END AS campaign,
      "addedToCart", "checkoutStarted" AS checkout, converted, 1 AS views, "timeOnPage"::float AS time, "scrollDepth"::float AS scroll, "ctaClicks",
      ${path} AS path, ${type} AS "type", "exitType", "exitUrl", "deviceType" AS device, "searchQuery" AS search,
      CASE WHEN converted AND ${priced} THEN "orderValue" END AS "orderAmount",
      (converted AND NOT ${priced}) AS "orderUnpriced"
      FROM ${table} WHERE ${constraint}`;
  } else if (capture.channelSnapshotId) {
    // Imported channel captures never recorded order amounts.
    rows = Prisma.sql`SELECT s.id COLLATE "C" AS id, s."startedAt", COALESCE(v."startedAt", s."startedAt") AS "viewedAt", COALESCE(v."visitorType"::text, 'PENDING') AS kind, s.source, s.medium, s.campaign,
      s."addedToCart", s."checkoutStarted" AS checkout, s.converted, CASE WHEN v.id IS NULL THEN 0 ELSE 1 END AS views,
      COALESCE(v."timeOnPage",0)::float AS time, COALESCE(v."scrollDepth",0)::float AS scroll, NULL::text AS "ctaClicks",
      NULL::text AS path, NULL::text AS "type", NULL::text AS "exitType", NULL::text AS "exitUrl", NULL::text AS device, NULL::text AS search,
      NULL::float8 AS "orderAmount", s.converted AS "orderUnpriced"
      FROM "ChannelSnapshotSession" s LEFT JOIN "ChannelSnapshotVisit" v ON v."sessionId" = s.id WHERE s."channelSnapshotId" = ${capture.channelSnapshotId}`;
  } else if (capture.customerSnapshotId) {
    // Amounts sit on the session's conversion events. Only the session's first row
    // carries them, so a session that viewed several pages counts its orders once.
    const priced = inShopCurrency(Prisma.sql`e.amount`, Prisma.sql`e.currency`);
    rows = Prisma.sql`SELECT s.id COLLATE "C" AS id, s."startedAt", COALESCE(p."startedAt", s."startedAt") AS "viewedAt", s."visitorType"::text AS kind, s.source, s.medium, s.campaign,
      s."addedToCart", s."checkoutStarted" AS checkout, s.converted, CASE WHEN p.id IS NULL THEN 0 ELSE 1 END AS views,
      COALESCE(p."timeOnPage",0)::float AS time, COALESCE(p."scrollDepth",0)::float AS scroll, NULL::text AS "ctaClicks",
      NULL::text AS path, NULL::text AS "type", NULL::text AS "exitType", NULL::text AS "exitUrl", NULL::text AS device, NULL::text AS search,
      CASE WHEN row_number() OVER (PARTITION BY s.id ORDER BY p."startedAt", p.id) = 1 THEN o.amount END AS "orderAmount",
      COALESCE(o.unpriced, false) AS "orderUnpriced"
      FROM "CustomerJourneySession" s LEFT JOIN "CustomerJourneyPage" p ON p."sessionId" = s.id
      LEFT JOIN LATERAL (
        SELECT SUM(e.amount) FILTER (WHERE ${priced}) AS amount, bool_or(NOT ${priced}) AS unpriced
        FROM "CustomerJourneyEvent" e WHERE e."sessionId" = s.id AND e.type = 'conversion'
      ) o ON s.converted
      WHERE s."snapshotId" = ${capture.customerSnapshotId}`;
  } else throw new GrowthProjectError("Measurement data is unavailable.", 404);
  // Group before filtering so the numerator and denominator share an audience.
  // This is read-only reporting; filters never change capture or attribution.
  const cohort = Prisma.sql`${filters.audience === "active" ? Prisma.sql`kind = 'REAL'` : Prisma.sql`TRUE`}
    AND (${filters.source} = '' OR lower(source) = lower(${filters.source}))
    AND (${filters.medium} = '' OR lower(medium) = lower(${filters.medium}))
    AND (${filters.campaign} = '' OR lower(campaign) = lower(${filters.campaign}))`;
  // Revenue for a set of sessions with converted/revenue/priced/unpriced columns:
  // summed per converted session, under the same filters as the rate beside it.
  const revenueColumns = Prisma.sql`COALESCE(SUM(revenue) FILTER (WHERE converted), 0)::float8 AS revenue,
      count(*) FILTER (WHERE converted AND priced) AS "pricedConversions",
      count(*) FILTER (WHERE converted AND unpriced) AS "unpricedConversions"`;
  // Each layout builds only the sections it shows: Store has per-page rows and exit
  // pages; Page has next pages and Engagement by zone (click rows).
  const layoutSections = store
    ? Prisma.sql`, page_sessions AS (
      -- One row per page and session, so each count below is a plain count. A converted
      -- session brings its whole revenue to every page it viewed, like its conversion.
      SELECT page AS path, id, max("type") AS "type", bool_or("addedToCart") AS cart, bool_or(forward) AS forward,
        bool_or("sessionConverted") AS converted, bool_or("exitPage" = page) AS exited,
        max("sessionRevenue") AS revenue, bool_or("sessionPriced") AS priced, bool_or("sessionUnpriced") AS unpriced
      FROM views WHERE page IS NOT NULL GROUP BY page, id
    ), page_rows AS (SELECT path, CASE WHEN path = '/private-page' THEN NULL ELSE max("type") END AS "type", count(*) AS sessions,
      count(*) FILTER (WHERE cart) AS carts, count(*) FILTER (WHERE forward) AS forwards,
      count(*) FILTER (WHERE converted) AS conversions, count(*) FILTER (WHERE exited) AS exits,
      ${revenueColumns}
      FROM page_sessions GROUP BY path ORDER BY count(*) DESC, path LIMIT 500),
    exit_pages AS (SELECT path, exits, sessions, 100.0 * exits / NULLIF(sessions, 0) AS "exitRate"
      FROM page_rows WHERE exits > 0 ORDER BY exits DESC, path LIMIT 5)`
    : Prisma.sql`, next_pages AS (SELECT CASE WHEN "exitPath" ~* ${PRIVATE_PATH} THEN '/private-page' ELSE left("exitPath", 600) END AS path,
      count(*) AS "pageViews" FROM views WHERE "exitPath" LIKE '/%' GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 5)`;
  const layoutJson = store
    ? Prisma.sql`'nextPages','[]'::json,
      'exitPages',COALESCE((SELECT json_agg(exit_pages) FROM exit_pages),'[]'::json),
      'pageRows',COALESCE((SELECT json_agg(page_rows) FROM page_rows),'[]'::json),
      'clickRows','[]'::json`
    : Prisma.sql`'nextPages',COALESCE((SELECT json_agg(next_pages) FROM next_pages),'[]'::json),
      'exitPages','[]'::json,
      'pageRows','[]'::json,
      'clickRows',COALESCE((SELECT json_agg(clicks) FROM (
        SELECT raw.id AS "sessionId", raw."ctaClicks", filtered.cart AS "addedToCart", filtered.converted FROM raw JOIN filtered USING(id)
        WHERE raw."ctaClicks" IS NOT NULL AND raw."ctaClicks" NOT IN ('[]','{}','') LIMIT 20001
      ) clicks),'[]'::json)`;
  const results = await prisma.$queryRaw<Array<{ report: QueryReport }>>(Prisma.sql`
    WITH raw AS (${rows}), marked AS (
      -- Carry only the columns later steps read; ctaClicks and exitUrl stop here.
      SELECT id, "startedAt", "viewedAt", kind, source, medium, campaign, "addedToCart", checkout, converted,
        views, time, scroll, device, search, "exitType", "exitPath", "orderAmount", "orderUnpriced",
        -- Account and order links carry personal tokens, so they share one row (without a type).
        CASE WHEN page ~* ${PRIVATE_PATH} THEN '/private-page' ELSE page END COLLATE "C" AS page, "type",
        -- A forward click left from the main content to another store page; collections only to a product.
        COALESCE(
          "exitPath" LIKE '/%'
          AND ("type" IS DISTINCT FROM 'COLLECTION' OR "exitPath" ~* ${PRODUCT_PATH})
          AND COALESCE("lastZone", '') NOT IN ('header', 'footer'), false) AS forward
      FROM (
        SELECT id, "startedAt", "viewedAt", kind, source, medium, campaign, "addedToCart", checkout, converted,
          views, time, scroll, device, search, "exitType", "type", "orderAmount", "orderUnpriced",
          -- Only paths that can carry a locale or collection prefix run the regular expressions.
          CASE WHEN path LIKE '/__/%' OR path LIKE '/__-__/%' OR path ILIKE '/collections/%/products/%'
            THEN regexp_replace(regexp_replace(path, ${LOCALE_PREFIX}, '', 'i'), ${COLLECTION_PREFIX}, '', 'i')
            ELSE path
          END AS page,
          -- exitUrl is set by the tracker for link clicks; the cart/checkout links are typed "checkout".
          CASE WHEN "exitType" = 'internal_link' THEN regexp_replace(regexp_replace("exitUrl", '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]*', ''), '[?#].*$', '') END AS "exitPath",
          -- Only link exits need the last click's zone. Nested CASE: the jsonb cast must
          -- only run on valid JSON (truncated payloads exist). -> -1 is NULL for non-arrays.
          CASE WHEN "exitType" = 'internal_link' THEN
            CASE WHEN pg_input_is_valid("ctaClicks", 'jsonb') THEN lower("ctaClicks"::jsonb -> -1 ->> 'zone') END
          END AS "lastZone"
        FROM raw
        -- OFFSET 0 keeps PostgreSQL from inlining this step, which would re-run the
        -- regular expressions above once per reference below.
        OFFSET 0
      ) parsed
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
        -- Shoppers who reached checkout or bought did not exit. An add-to-cart that never
        -- reached checkout (also typed "checkout" by the tracker) still exits from that page.
        CASE WHEN bool_or(checkout) OR bool_or(converted) THEN NULL
          ELSE (array_agg(page ORDER BY "viewedAt" DESC) FILTER (WHERE page IS NOT NULL))[1]
        END AS "exitPage",
        -- Revenue per session first: a session with two orders sums both, and is still
        -- one conversion.
        COALESCE(SUM("orderAmount"), 0)::float8 AS revenue,
        bool_or("orderAmount" IS NOT NULL) AS priced,
        bool_or("orderUnpriced") AS unpriced
      FROM marked GROUP BY id
    ), filtered AS (SELECT * FROM sessions WHERE ${cohort}),
    views AS (
      SELECT id, marked.search, marked."exitType", marked."exitPath", marked.page, marked."type",
        marked."addedToCart", marked.forward, marked.scroll, filtered.converted AS "sessionConverted", filtered."exitPage",
        filtered.revenue AS "sessionRevenue", filtered.priced AS "sessionPriced", filtered.unpriced AS "sessionUnpriced"
      FROM marked JOIN filtered USING (id)
    ),
    daily AS (SELECT to_char(started,'YYYY-MM-DD') AS date, count(*) AS sessions,
      count(*) FILTER (WHERE converted) AS conversions, 100.0 * count(*) FILTER (WHERE converted) / NULLIF(count(*),0) AS "conversionRate"
      FROM filtered GROUP BY date ORDER BY date),
    channels AS (SELECT source, medium, campaign, count(*) AS sessions, count(*) FILTER (WHERE cart) AS "addedToCart", count(*) FILTER (WHERE converted) AS conversions,
      100.0 * count(*) FILTER (WHERE converted) / NULLIF(count(*),0) AS "conversionRate", ${revenueColumns}
      FROM filtered GROUP BY source,medium,campaign ORDER BY count(*) DESC,source,medium,campaign),
    devices AS (SELECT device, count(*) AS sessions, 100.0 * count(*) / NULLIF((SELECT count(*) FROM filtered), 0) AS share,
      count(*) FILTER (WHERE converted) AS conversions,
      COALESCE(100.0 * count(*) FILTER (WHERE converted) / NULLIF(count(*), 0), 0) AS "conversionRate", ${revenueColumns}
      FROM filtered GROUP BY device ORDER BY count(*) DESC, device),
    -- A term is listed only once two sessions used it, so one-off personal searches never show.
    searches AS (SELECT left(lower(btrim(search)), 100) AS term, count(DISTINCT id) AS sessions FROM views
      WHERE COALESCE(btrim(search), '') <> '' GROUP BY 1 HAVING count(DISTINCT id) >= 2
      ORDER BY count(DISTINCT id) DESC, 1 LIMIT 5),
    exits AS (SELECT CASE WHEN "exitType" IN ('internal_link','checkout','back_button','window_closed','idle','external_link') THEN "exitType" ELSE 'unknown' END AS "type",
      count(*) AS "pageViews", 100.0 * count(*) / NULLIF((SELECT count(*) FROM views), 0) AS share FROM views GROUP BY 1)
    ${layoutSections}
    SELECT json_build_object('sessions',count(*),'addedToCart',count(*) FILTER (WHERE cart),'conversions',count(*) FILTER (WHERE converted),
      'conversionRate',COALESCE(100.0 * count(*) FILTER (WHERE converted)/NULLIF(count(*),0),0),
      'revenue',COALESCE(SUM(revenue) FILTER (WHERE converted),0)::float8,
      'pricedConversions',count(*) FILTER (WHERE converted AND priced),
      'unpricedConversions',count(*) FILTER (WHERE converted AND unpriced),
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
      ${layoutJson}) AS report FROM filtered
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
    currency: shopCurrency,
    layout,
    pageType,
    funnel: {
      sessions: report.sessions,
      addedToCart: report.addedToCart,
      checkoutStarted,
      purchased: report.conversions,
      revenue: report.revenue,
      pricedConversions: report.pricedConversions,
      unpricedConversions: report.unpricedConversions,
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
    pages: store && detailed ? rankGrowthPages(pageRows) : [],
    // Store reports never show Engagement by zone, so no click rows are read for them.
    // Do not show sampled engagement totals as complete; summaries above are always full-cohort.
    engagement:
      store || clickRows.length > 20000 ? null : buildEngagementOutcomes(clickRows),
    engagementUnavailable: !store && clickRows.length > 20000,
  };
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run the same chained command as Step 2.
Expected: `loopback ok`, then two PASS lines. `check-growth-report-sections.mjs` prints the new PASS message.

- [ ] **Step 7: Run the regression bar and type-check**

Run: `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt && npm run build && npx tsc --noEmit 2>&1 | grep -E "app/utils/(growth-report|loader-cache)" ; echo "tsc-grep-exit=$?"`
Expected: `No regressions…`, a successful build, and `tsc-grep-exit=1`. The database-backed checks ran in Step 6.

- [ ] **Step 8: Commit**

```bash
git add app/utils/growth-report.ts app/utils/growth-report.server.ts app/utils/loader-cache.server.ts scripts/check-growth-report-sections.mjs scripts/check-growth-reports.mjs
git commit -m "Sum revenue per session in the shop currency for every report section" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The report API reads the shop currency

**Files:**
- Modify: `app/routes/api.growth-report.tsx` (rewrite)
- Test: `scripts/check-projects-ui.mjs:561-596` (replace one test)

**Interfaces:**
- Consumes:
  - `getShopCurrency(admin, shop)` (Task 2).
  - `getGrowthMeasurementReport(…, currency)` (Task 4).
- Produces: `/api/growth-report` responses whose `report.currency` and `comparison.currency` hold the shop currency.

- [ ] **Step 1: Write the failing test**

In `scripts/check-projects-ui.mjs`, replace the whole test `"before/after report API authorizes the Project and passes identical filters to both tenant-scoped measurements"` (lines 561–596) with:

```js
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
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test scripts/check-projects-ui.mjs`
Expected: FAIL in the report API test. No currency call is recorded and `call[5]` is `undefined`.

- [ ] **Step 3: Pass the shop currency**

Replace the whole of `app/routes/api.growth-report.tsx` with:

```tsx
import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getGrowthMeasurementReport } from "../utils/growth-report.server";
import { growthReportFilters } from "../utils/growth-report";
import { GrowthProjectError } from "../utils/growth-projects";
import { getShopCurrency } from "../utils/shop-currency.server";
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const project = await prisma.growthProject.findFirst({
    where: { id: params.get("projectId") || "", shop: session.shop },
  });
  if (!project) throw new Response("Not found", { status: 404 });
  try {
    const filters = growthReportFilters(params, project);
    // Revenue is summed and shown in the shop's currency (cached 5 minutes; null
    // when Shopify does not answer, which shows revenue as "Not recorded").
    const currency = await getShopCurrency(admin, session.shop);
    const [report, comparison] = await Promise.all([
      getGrowthMeasurementReport(
        session.shop,
        project.id,
        params.get("measurement") || "",
        filters,
        currency,
      ),
      params.get("compare")
        ? getGrowthMeasurementReport(
            session.shop,
            project.id,
            params.get("compare")!,
            filters,
            currency,
          )
        : Promise.resolve(null),
    ]);
    return Response.json(
      { report, comparison },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof GrowthProjectError)
      throw new Response(error.message, { status: error.status });
    throw error;
  }
};

// Fetchers reach this route as a single-fetch .data request; Shopify needs
// these headers there so App Bridge can re-authenticate an expired session.
export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
```

- [ ] **Step 4: Run the test to see it pass**

Run: `node --test scripts/check-projects-ui.mjs`
Expected: PASS.

- [ ] **Step 5: Run the regression bar and type-check**

Run: `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt && npm run build && npx tsc --noEmit 2>&1 | grep -E "app/routes/api\.growth-report" ; echo "tsc-grep-exit=$?"`
Expected: `No regressions…`, a successful build, and `tsc-grep-exit=1`. If tsc rejects `admin` as `getShopCurrency`'s argument, widen that parameter's type to `Pick<AdminApiContext, "graphql">` from `@shopify/shopify-app-react-router/server` and rerun. No database-backed check is affected.

- [ ] **Step 6: Commit**

```bash
git add app/routes/api.growth-report.tsx scripts/check-projects-ui.mjs
git commit -m "Report revenue in the shop currency" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Conversions and revenue in the Results sheet

**Files:**
- Modify: `app/components/GrowthConversionFunnel.tsx` (rewrite)
- Modify: `app/components/GrowthEngagementMetrics.tsx:8-24, 118-141`
- Modify: `app/components/GrowthSessionsByPage.tsx` (rewrite)
- Modify: `app/components/GrowthMeasurementResults.tsx:23, 105-107, 116-170, 189-220, 285-310`
- Modify: `app/locales/catalog.ts` (append one entry)
- Test: `scripts/check-growth-report-ui.mjs`

**Interfaces:**
- Consumes:
  - `revenueText`, `revenueCell` and `PARTIAL_REVENUE_MARK` (Task 1).
  - `GrowthReport.currency` and the `RevenueCounts` fields (Task 4).
- Produces:
  - `GrowthConversionFunnel({ funnel, before?, comparisonName?, currency: string | null })`.
  - `GrowthEngagementMetrics({ summary, layout, exitPages, currency: string | null })`.
  - `GrowthSessionsByPage({ pages, available, currency: string | null })`.

- [ ] **Step 1: Write the failing tests**

In `scripts/check-growth-report-ui.mjs`:

Replace lines 93–97 (`const common = { … };`) with:

```js
const common = {
  "@shopify/polaris": polaris,
  "../utils/i18n": i18n,
  "../utils/revenue": load("app/utils/revenue.ts"),
  "./GrowthOverviewCard": tile,
};
```

Replace the `devices` array in the `summary` fixture (lines 108–111) with:

```js
  devices: [
    { device: "mobile", sessions: 880, share: 65.7, conversions: 21, conversionRate: 2.4, revenue: 1050, pricedConversions: 20, unpricedConversions: 1 },
    { device: "desktop", sessions: 410, share: 30.6, conversions: 20, conversionRate: 4.9, revenue: 1200, pricedConversions: 20, unpricedConversions: 0 },
  ],
```

In the `ranked` fixture, add these three lines before `focus: false,`:

```js
  revenue: 0,
  pricedConversions: 0,
  unpricedConversions: 0,
```

In `resultsWith`, replace:

```js
  const section = (name) => (props) =>
    el("section", { "data-section": name, "data-layout": props.layout || "" });
```

with:

```js
  const section = (name) => (props) =>
    el("section", {
      "data-section": name,
      "data-layout": props.layout || "",
      "data-currency": props.currency ?? "",
    });
```

In `baseReport`, replace:

```js
  sessions: 100,
  addedToCart: 20,
  conversions: 4,
```

with:

```js
  currency: "EUR",
  revenue: 180,
  pricedConversions: 4,
  unpricedConversions: 0,
  sessions: 100,
  addedToCart: 20,
  conversions: 4,
```

Then replace its `channels` and `funnel` lines with:

```js
  channels: [
    { source: "facebook", medium: "paid", campaign: "", sessions: 100, addedToCart: 20, conversions: 4, conversionRate: 4, revenue: 180, pricedConversions: 4, unpricedConversions: 0 },
  ],
```

```js
  funnel: { sessions: 100, addedToCart: 20, checkoutStarted: 8, purchased: 4, revenue: 180, pricedConversions: 4, unpricedConversions: 0 },
```

Append these tests at the end of the file:

```js
test("funnel shows revenue for purchases, with the hint, Not recorded, zero and the comparison", () => {
  const { GrowthConversionFunnel } = load("app/components/GrowthConversionFunnel.tsx", common);
  const funnel = {
    sessions: 200,
    addedToCart: 40,
    checkoutStarted: 10,
    purchased: 12,
    revenue: 480.5,
    pricedConversions: 12,
    unpricedConversions: 0,
  };
  assert.match(render(GrowthConversionFunnel, { funnel, currency: "EUR" }), /Revenue=€480\.50</);
  assert.match(
    render(GrowthConversionFunnel, { funnel: { ...funnel, pricedConversions: 10, unpricedConversions: 2 }, currency: "EUR" }),
    /Revenue=€480\.50 \[Some orders have no recorded amount\]/,
  );
  assert.match(
    render(GrowthConversionFunnel, { funnel: { ...funnel, revenue: 0, pricedConversions: 0, unpricedConversions: 12 }, currency: "EUR" }),
    /Revenue=Not recorded/,
  );
  assert.match(
    render(GrowthConversionFunnel, { funnel: { ...funnel, purchased: 0, revenue: 0, pricedConversions: 0 }, currency: "EUR" }),
    /Revenue=€0\.00</,
  );
  assert.match(
    render(GrowthConversionFunnel, { funnel, currency: "EUR", before: { ...funnel, revenue: 100 }, comparisonName: "Baseline" }),
    /Revenue=€480\.50 \[€100\.00 in Baseline\]/,
  );
});

test("devices show conversions and revenue beside the conversion rate and explain the mark", () => {
  const { GrowthEngagementMetrics } = load("app/components/GrowthEngagementMetrics.tsx", common);
  const html = render(GrowthEngagementMetrics, { summary, layout: "store", exitPages: [], currency: "EUR" });
  assert.match(html, /<th>Share of sessions<\/th><th>Conversions<\/th><th>Conversion rate<\/th><th>Revenue<\/th>/);
  assert.match(html, /<td>21<\/td><td>2\.4%<\/td><td>€1,050\.00\*<\/td>/);
  assert.match(html, /<td>20<\/td><td>4\.9%<\/td><td>€1,200\.00<\/td>/);
  assert.match(html, /\* Some orders have no recorded amount/);
});

test("sessions by page shows conversions and revenue per page, marking partly recorded rows", () => {
  const { GrowthSessionsByPage } = load("app/components/GrowthSessionsByPage.tsx", common);
  const html = render(GrowthSessionsByPage, {
    available: true,
    currency: "EUR",
    pages: [
      ranked("/collections/shoes", "COLLECTION", 2, { conversions: 2, conversionRate: 100, revenue: 90, pricedConversions: 2 }),
      ranked("/products/red", "PRODUCT", 3, { conversions: 3, conversionRate: 100, revenue: 40, pricedConversions: 1, unpricedConversions: 2 }),
      ranked("/pages/about", "PAGE", 1),
      ranked("/products/green", "PRODUCT", 1, { conversions: 1, conversionRate: 100, unpricedConversions: 1 }),
    ],
  });
  assert.match(html, /<th>Conversions<\/th><th>Conversion rate<\/th><th>Revenue<\/th><th>Weakness<\/th>/);
  assert.match(html, /<td>€90\.00<\/td>/);
  assert.match(html, /<td>€40\.00\*<\/td>/);
  assert.match(html, /<td>€0\.00<\/td>/, "A page without conversions has zero revenue");
  assert.match(html, /<td>Not recorded<\/td>/);
  assert.match(html, /\* Some orders have no recorded amount/);
  assert.match(html, /so one order can count on several pages\./);
});

test("sessions by page has no footnote when every amount was recorded", () => {
  const { GrowthSessionsByPage } = load("app/components/GrowthSessionsByPage.tsx", common);
  const html = render(GrowthSessionsByPage, {
    available: true,
    currency: "EUR",
    pages: [ranked("/collections/shoes", "COLLECTION", 2, { conversions: 2, revenue: 90, pricedConversions: 2 })],
  });
  assert.doesNotMatch(html, /Some orders have no recorded amount/);
});

test("page tiles show conversions, the conversion rate and revenue in the shop currency", () => {
  const html = render(resultsWith({ ...baseReport, layout: "page", pageType: "PRODUCT" }), props);
  assert.match(html, /Converted sessions=4/);
  assert.match(html, /Conversion rate=4%/);
  assert.match(html, /Revenue=€180\.00</);
});

test("the revenue tile hints at partial amounts and says Not recorded when none were recorded", () => {
  const partial = render(
    resultsWith({ ...baseReport, layout: "page", pageType: "PRODUCT", revenue: 150, pricedConversions: 3, unpricedConversions: 1 }),
    props,
  );
  assert.match(partial, /Revenue=€150\.00 \[Some orders have no recorded amount\]/);
  const imported = render(
    resultsWith({ ...baseReport, layout: "page", pageType: "PRODUCT", revenue: 0, pricedConversions: 0, unpricedConversions: 4 }),
    props,
  );
  assert.match(imported, /Revenue=Not recorded/);
  assert.doesNotMatch(imported, /NaN/);
});

test("the revenue tile names the comparison's revenue", () => {
  const current = { ...baseReport, layout: "page", pageType: "PRODUCT" };
  const html = render(resultsWith(current, { ...current, revenue: 100 }), {
    ...props,
    comparisonId: "c",
    comparisonName: "Baseline",
  });
  assert.match(html, /Revenue=€180\.00 \[€100\.00 in Baseline\]/);
});

test("traffic by source shows revenue next to the conversion rate and marks partly recorded rows", () => {
  const html = render(
    resultsWith({
      ...baseReport,
      layout: "store",
      pageType: null,
      channels: [
        baseReport.channels[0],
        { source: "google", medium: "", campaign: "", sessions: 20, addedToCart: 4, conversions: 2, conversionRate: 10, revenue: 30, pricedConversions: 1, unpricedConversions: 1 },
      ],
    }),
    props,
  );
  assert.match(html, /<th>Conversion rate<\/th><th>Revenue<\/th>/);
  assert.match(html, /<td>4%<\/td><td>€180\.00<\/td>/);
  assert.match(html, /<td>10%<\/td><td>€30\.00\*<\/td>/);
  assert.match(html, /\* Some orders have no recorded amount/);
});

test("the store layout hands the shop currency to the engagement, funnel and pages cards", () => {
  const html = render(resultsWith({ ...baseReport, layout: "store", pageType: null }), props);
  assert.equal((html.match(/data-currency="EUR"/g) || []).length, 3);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test scripts/check-growth-report-ui.mjs`
Expected: FAIL. The new tests find no `Revenue` tile, column or `data-currency`.

- [ ] **Step 3: Add the Revenue tile to the funnel**

Replace the whole of `app/components/GrowthConversionFunnel.tsx` with:

```tsx
import { BlockStack, Card, InlineGrid, Text } from "@shopify/polaris";
import { useI18n } from "../utils/i18n";
import { revenueText } from "../utils/revenue";
import { MetricTile } from "./GrowthOverviewCard";
import type { GrowthFunnel } from "../utils/growth-report";

// Every step is a share of all sessions, never of the previous step: a purchase can
// be recorded without a tracked cart or checkout step.
export function GrowthConversionFunnel({
  funnel,
  before,
  comparisonName,
  currency,
}: {
  funnel: GrowthFunnel;
  before?: GrowthFunnel | null;
  comparisonName?: string;
  currency: string | null;
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
  // Revenue of the purchases, in the shop's currency (spec 7.2).
  const revenue = revenueText(funnel.purchased, funnel, currency, {
    t,
    formatNumber,
  });
  const beforeRevenue = before
    ? revenueText(before.purchased, before, currency, { t, formatNumber })
    : null;
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t("Conversion funnel")}
        </Text>
        <InlineGrid columns={{ xs: 2, md: 5 }} gap="300">
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
            else {
              const shareText = percent(current);
              caption =
                before && before.sessions > 0
                  ? t("{share} of sessions · {change} pts", {
                      share: shareText,
                      change: formatNumber(
                        current - share(before[key], before.sessions),
                        { signDisplay: "exceptZero", maximumFractionDigits: 2 },
                      ),
                    })
                  : t("{share} of sessions", { share: shareText });
            }
            return (
              <MetricTile
                key={key}
                label={label}
                value={formatNumber(funnel[key])}
                caption={caption}
              />
            );
          })}
          <MetricTile
            label={t("Revenue")}
            value={revenue.value}
            caption={
              revenue.hint ??
              (beforeRevenue
                ? t("{value} in {name}", { value: beforeRevenue.value, name })
                : undefined)
            }
          />
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

- [ ] **Step 4: Add Conversions and Revenue to devices**

In `app/components/GrowthEngagementMetrics.tsx`, replace:

```tsx
import { useI18n } from "../utils/i18n";
import { MetricTile } from "./GrowthOverviewCard";
```

with:

```tsx
import { useI18n } from "../utils/i18n";
import {
  PARTIAL_REVENUE_MARK,
  revenueCell,
  revenueText,
} from "../utils/revenue";
import { MetricTile } from "./GrowthOverviewCard";
```

Replace:

```tsx
export function GrowthEngagementMetrics({
  summary,
  layout,
  exitPages,
}: {
  summary: GrowthEngagementSummary;
  layout: GrowthReportLayout;
  exitPages: GrowthExitPaths["exitPages"];
}) {
```

with:

```tsx
export function GrowthEngagementMetrics({
  summary,
  layout,
  exitPages,
  currency,
}: {
  summary: GrowthEngagementSummary;
  layout: GrowthReportLayout;
  exitPages: GrowthExitPaths["exitPages"];
  currency: string | null;
}) {
```

Replace:

```tsx
            {summary.devices.length ? (
              <DataTable
                columnContentTypes={["text", "numeric", "numeric"]}
                headings={[
                  t("Device"),
                  t("Share of sessions"),
                  t("Conversion rate"),
                ]}
                rows={summary.devices.map((row) => [
                  device(row.device),
                  percent(row.share),
                  percent(row.conversionRate),
                ])}
              />
            ) : (
```

with:

```tsx
            {summary.devices.length ? (
              <>
                <DataTable
                  columnContentTypes={[
                    "text",
                    "numeric",
                    "numeric",
                    "numeric",
                    "numeric",
                  ]}
                  headings={[
                    t("Device"),
                    t("Share of sessions"),
                    t("Conversions"),
                    t("Conversion rate"),
                    t("Revenue"),
                  ]}
                  rows={summary.devices.map((row, index) => [
                    device(row.device),
                    percent(row.share),
                    formatNumber(row.conversions),
                    percent(row.conversionRate),
                    revenueCell(deviceRevenue[index]),
                  ])}
                />
                {deviceRevenue.some((text) => text.partial) && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {`${PARTIAL_REVENUE_MARK} ${t("Some orders have no recorded amount")}`}
                  </Text>
                )}
              </>
            ) : (
```

Then replace:

```tsx
  return (
    <Card>
      <BlockStack gap="500">
        {heading}
```

with:

```tsx
  // Revenue per device, in the shop's currency (spec 7.2).
  const deviceRevenue = summary.devices.map((row) =>
    revenueText(row.conversions, row, currency, { t, formatNumber }),
  );
  return (
    <Card>
      <BlockStack gap="500">
        {heading}
```

- [ ] **Step 5: Add Conversions and Revenue to Sessions by page**

Replace the whole of `app/components/GrowthSessionsByPage.tsx` with:

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
import {
  PARTIAL_REVENUE_MARK,
  revenueCell,
  revenueText,
} from "../utils/revenue";
import type { RankedGrowthPage } from "../utils/growth-report";

const PAGE_SIZE = 10;

export function GrowthSessionsByPage({
  pages,
  available,
  currency,
}: {
  pages: RankedGrowthPage[];
  available: boolean;
  currency: string | null;
}) {
  const { t, formatNumber } = useI18n();
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(pages.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = pages.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  // A page's revenue is that of the converted sessions that viewed it (spec 7.2).
  const revenue = visible.map((row) =>
    revenueText(row.conversions, row, currency, { t, formatNumber }),
  );
  const percent = (value: number | null) =>
    value === null
      ? "—"
      : `${formatNumber(value, { maximumFractionDigits: 1 })}%`;
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
  // A Focus row names the page's Weakness, then what it means for that page type.
  const reason = (row: RankedGrowthPage) => {
    const count = formatNumber(row.weakness ?? 0);
    if (row.type === "PRODUCT")
      return t(
        "Weakness {count}: about {count} fewer sessions added to cart here than on your typical product page.",
        { count },
      );
    if (row.type === "COLLECTION")
      return t(
        "Weakness {count}: about {count} fewer sessions continued from here than from your typical collection.",
        { count },
      );
    if (row.type === "BLOG")
      return t(
        "Weakness {count}: about {count} fewer sessions continued from here than from your typical blog post.",
        { count },
      );
    return t(
      "Weakness {count}: about {count} fewer sessions continued from here than from your typical page of this type.",
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
              "Weakness is how many sessions a page lost against the typical page of its type.",
            )}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t(
              "Key rate is the add-to-cart rate for products and the click-through rate for other pages. A page needs 20 sessions, and 3 pages of the same type, to be ranked.",
            )}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t(
              "Conversions and revenue count every converted session that viewed the page, so one order can count on several pages.",
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
        <>
          <DataTable
            columnContentTypes={[
              "text",
              "text",
              "numeric",
              "numeric",
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
              t("Conversions"),
              t("Conversion rate"),
              t("Revenue"),
              t("Weakness"),
            ]}
            rows={visible.map((row, index) => [
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
              formatNumber(row.conversions),
              percent(row.conversionRate),
              revenueCell(revenue[index]),
              row.weakness === null ? "—" : formatNumber(row.weakness),
            ])}
          />
          {revenue.some((text) => text.partial) && (
            <Box padding="400" paddingBlockStart="0">
              <Text as="p" variant="bodySm" tone="subdued">
                {`${PARTIAL_REVENUE_MARK} ${t("Some orders have no recorded amount")}`}
              </Text>
            </Box>
          )}
        </>
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

- [ ] **Step 6: Add the Revenue tile, the traffic column and the currency hand-off**

In `app/components/GrowthMeasurementResults.tsx`, replace:

```tsx
import { EngagementOutcomesView } from "./EngagementOutcomes";
```

with:

```tsx
import { EngagementOutcomesView } from "./EngagementOutcomes";
import {
  PARTIAL_REVENUE_MARK,
  revenueCell,
  revenueText,
} from "../utils/revenue";
```

Replace:

```tsx
  const clickThrough =
    report.pageType !== null && report.pageType !== "PRODUCT";
  const summary = report.engagementSummary;
```

with:

```tsx
  const clickThrough =
    report.pageType !== null && report.pageType !== "PRODUCT";
  const summary = report.engagementSummary;
  // Revenue sits beside every conversion rate (spec 7.2), in the shop's currency.
  const money = { t, formatNumber };
  const revenue = revenueText(report.conversions, report, report.currency, money);
  const beforeRevenue = before
    ? revenueText(before.conversions, before, report.currency, money)
    : null;
  const channelRows = report.channels.slice(
    page * CHANNEL_PAGE_SIZE,
    (page + 1) * CHANNEL_PAGE_SIZE,
  );
  const channelRevenue = channelRows.map((row) =>
    revenueText(row.conversions, row, report.currency, money),
  );
```

Replace:

```tsx
        <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
```

with:

```tsx
        <InlineGrid columns={{ xs: 2, md: 5 }} gap="300">
```

Replace:

```tsx
          <MetricTile
            label={t("Conversion rate")}
            value={percent(report.conversionRate)}
            caption={
              compared
                ? points(report.conversionRate, before.conversionRate)
                : undefined
            }
          />
        </InlineGrid>
```

with:

```tsx
          <MetricTile
            label={t("Conversion rate")}
            value={percent(report.conversionRate)}
            caption={
              compared
                ? points(report.conversionRate, before.conversionRate)
                : undefined
            }
          />
          <MetricTile
            label={t("Revenue")}
            value={revenue.value}
            caption={
              revenue.hint ??
              (beforeRevenue ? versus(beforeRevenue.value) : undefined)
            }
          />
        </InlineGrid>
```

Replace:

```tsx
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
```

with:

```tsx
      {report.channels.length ? (
        <>
          <DataTable
            columnContentTypes={[
              "text",
              "text",
              "text",
              "numeric",
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
              t("Revenue"),
            ]}
            rows={channelRows.map((row, index) => [
              row.source,
              row.medium || "—",
              row.campaign || "—",
              count(row.sessions),
              count(row.addedToCart),
              count(row.conversions),
              percent(row.conversionRate),
              revenueCell(channelRevenue[index]),
            ])}
          />
          {channelRevenue.some((text) => text.partial) && (
            <Box padding="400" paddingBlockStart="0">
              <Text as="p" variant="bodySm" tone="subdued">
                {`${PARTIAL_REVENUE_MARK} ${t("Some orders have no recorded amount")}`}
              </Text>
            </Box>
          )}
        </>
      ) : (
```

Replace:

```tsx
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
```

with:

```tsx
          <GrowthEngagementMetrics
            summary={summary}
            layout="store"
            exitPages={report.exitPaths.exitPages}
            currency={report.currency}
          />
          <GrowthConversionFunnel
            funnel={report.funnel}
            before={before?.funnel}
            comparisonName={comparisonName}
            currency={report.currency}
          />
          {trafficBySource}
          <GrowthSessionsByPage
            pages={report.pages}
            available={report.exitPaths.available}
            currency={report.currency}
          />
```

Replace:

```tsx
          <GrowthEngagementMetrics
            summary={summary}
            layout="page"
            exitPages={[]}
          />
```

with:

```tsx
          <GrowthEngagementMetrics
            summary={summary}
            layout="page"
            exitPages={[]}
            currency={report.currency}
          />
```

- [ ] **Step 7: Add the overlap string**

Append this entry to `app/locales/catalog.ts`, directly above its final `};`:

```ts
  "Conversions and revenue count every converted session that viewed the page, so one order can count on several pages.": [
    "Conversions und Umsatz zählen jede Sitzung mit Kauf, die die Seite aufgerufen hat. Eine Bestellung kann daher auf mehreren Seiten zählen.",
    "转化和收入统计浏览过该页面的每个已转化会话，因此一笔订单可能计入多个页面。",
    "轉換和營收統計瀏覽過該頁面的每個已轉換工作階段，因此一筆訂單可能計入多個頁面。",
  ],
```

- [ ] **Step 8: Run the tests to see them pass**

Run: `node --test scripts/check-growth-report-ui.mjs && node --test scripts/check-i18n.mjs`
Expected: PASS (every earlier test plus the 9 new ones), PASS.

- [ ] **Step 9: Run the regression bar and type-check**

Run: `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt && npm run build && npx tsc --noEmit 2>&1 | grep -E "app/components/Growth(ConversionFunnel|EngagementMetrics|SessionsByPage|MeasurementResults)" ; echo "tsc-grep-exit=$?"`
Expected: `No regressions…`, a successful build, and `tsc-grep-exit=1`. The SQL is unchanged in this task, so it needs no database-backed check.

- [ ] **Step 10: Commit**

```bash
git add app/components/GrowthConversionFunnel.tsx app/components/GrowthEngagementMetrics.tsx app/components/GrowthSessionsByPage.tsx app/components/GrowthMeasurementResults.tsx app/locales/catalog.ts scripts/check-growth-report-ui.mjs
git commit -m "Show conversions and revenue next to every conversion rate in the results" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Conversions and revenue in the Project's latest measurement

**Files:**
- Modify: `app/routes/app.projects.$id.tsx:49` (import), `:164-210` (`LatestSummary`)
- Test: `scripts/check-projects-ui.mjs` (harness mocks and one new test)

**Interfaces:**
- Consumes: `revenueText` (Task 1); `GrowthReport.currency` and its `RevenueCounts` fields (Task 4), delivered by `/api/growth-report` (Task 5).
- Produces: nothing new for other tasks.

- [ ] **Step 1: Write the failing test**

In `scripts/check-projects-ui.mjs`:

After `const navigation = compile("app/utils/navigation.ts");` add:

```js
const revenuePure = compile("app/utils/revenue.ts");
```

In the harness mocks, add after `"../utils/growth-report": reportPure,` (the one inside `harness`, around line 304):

```js
    "../utils/revenue": revenuePure,
```

Replace the harness mock:

```js
    "../components/GrowthOverviewCard": {
      MetricTile: ({ label, value }) => React.createElement("div", null, label, value),
    },
```

with:

```js
    "../components/GrowthOverviewCard": {
      MetricTile: ({ label, value, caption }) =>
        React.createElement("div", { "data-tile": label }, `${label}=${value}${caption ? ` [${caption}]` : ""}`),
    },
```

Replace:

```js
    "../utils/background-json": {
      useBackgroundJson: () => ({ data: undefined, loading: true, error: null, reload() {} }),
    },
```

with:

```js
    "../utils/background-json": {
      useBackgroundJson: () => state.background ?? { data: undefined, loading: true, error: null, reload() {} },
    },
```

Append this test at the end of the file:

```js
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
```

(The harness's `formatNumber` is `String`, so money renders as the bare number here; Task 1 tests the real format.)

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test scripts/check-projects-ui.mjs`
Expected: FAIL in the new test: no `Conversions=` or `Revenue=` tile.

- [ ] **Step 3: Add the two tiles**

In `app/routes/app.projects.$id.tsx`, replace:

```tsx
import { useI18n } from "../utils/i18n";
```

with:

```tsx
import { useI18n } from "../utils/i18n";
import { revenueText } from "../utils/revenue";
```

Replace:

```tsx
  const percent = (number: number) =>
    `${formatNumber(number, { maximumFractionDigits: 2 })}%`;
  return (
    <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
      <MetricTile
        label={t("Sessions")}
        value={value((item) => formatNumber(item.sessions))}
      />
      <MetricTile
        label={t("Add-to-cart rate")}
        value={value((item) => percent(item.atcRate))}
      />
      <MetricTile
        label={t("Conversion rate")}
        value={value((item) => percent(item.conversionRate))}
      />
    </InlineGrid>
  );
```

with:

```tsx
  const percent = (number: number) =>
    `${formatNumber(number, { maximumFractionDigits: 2 })}%`;
  // Conversions and revenue sit beside the conversion rate (spec 7.2).
  const revenue = report
    ? revenueText(report.conversions, report, report.currency, {
        t,
        formatNumber,
      })
    : null;
  return (
    <InlineGrid columns={{ xs: 2, sm: 3, md: 5 }} gap="300">
      <MetricTile
        label={t("Sessions")}
        value={value((item) => formatNumber(item.sessions))}
      />
      <MetricTile
        label={t("Add-to-cart rate")}
        value={value((item) => percent(item.atcRate))}
      />
      <MetricTile
        label={t("Conversions")}
        value={value((item) => formatNumber(item.conversions))}
      />
      <MetricTile
        label={t("Conversion rate")}
        value={value((item) => percent(item.conversionRate))}
      />
      <MetricTile
        label={t("Revenue")}
        value={revenue ? revenue.value : value(() => "")}
        caption={revenue?.hint ?? undefined}
      />
    </InlineGrid>
  );
```

- [ ] **Step 4: Run the test to see it pass**

Run: `node --test scripts/check-projects-ui.mjs && node --test scripts/check-i18n.mjs`
Expected: PASS, PASS.

- [ ] **Step 5: Run the regression bar and type-check**

Run: `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt && npm run build && npx tsc --noEmit 2>&1 | grep -E "app/routes/app\.projects\.\\\$id" ; echo "tsc-grep-exit=$?"`
Expected: `No regressions…`, a successful build, and `tsc-grep-exit=1`. No database-backed check is affected.

- [ ] **Step 6: Commit**

```bash
git add 'app/routes/app.projects.$id.tsx' scripts/check-projects-ui.mjs
git commit -m "Show conversions and revenue in the Project's latest measurement" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Whole-branch checks

**Files:** none changed, unless a check fails.

- [ ] **Step 1: Run every database-free check**

Run: `node scripts/run-checks.mjs --compare docs/superpowers/plans/2026-11-06-polaris-screens-2a-baseline.txt`
Expected: `No regressions against …`. `check-revenue.mjs` is listed PASS.

- [ ] **Step 2: Run the database checks against loopback Postgres**

Start the loopback Postgres (Global Constraints → Loopback database, steps 1–2), then run:

```bash
export DATABASE_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke" DIRECT_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke" \
  && node -e 'const h=new URL(process.env.DATABASE_URL).hostname; if(h!=="127.0.0.1"){console.error("NOT LOOPBACK");process.exit(1)} console.log("loopback ok")' \
  && export GROWTH_TEST_DATABASE_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke" JOURNEY_TEST_DATABASE_URL="postgresql://growth_test@127.0.0.1:55443/snapshot_smoke" \
  && for f in check-growth-projects-db check-growth-report-sections check-growth-reports check-customer-journeys; do node --test "scripts/$f.mjs" > "/tmp/3a-$f.log" 2>&1 && echo "PASS $f" || echo "FAIL $f"; done
```

Expected: `loopback ok`, then four PASS lines.

- [ ] **Step 3: Build, lint and type-check**

Run: `npm run build && npx eslint app/utils/revenue.ts app/utils/shop-currency.server.ts app/utils/growth-metrics.server.ts app/utils/growth-report.ts app/utils/growth-report.server.ts app/utils/loader-cache.server.ts app/routes/api.growth-report.tsx 'app/routes/app.projects.$id.tsx' app/components/GrowthConversionFunnel.tsx app/components/GrowthEngagementMetrics.tsx app/components/GrowthSessionsByPage.tsx app/components/GrowthMeasurementResults.tsx && npx tsc --noEmit 2>&1 | grep -cE "error TS"`
Expected:
- The build succeeds.
- ESLint reports 0 errors (warnings are fine).
- The `error TS` count is at most the 100 recorded in plan 2a's Results, and none of them is on a line this plan changed.

- [ ] **Step 4: Fix anything that failed**

For any failure, use superpowers:systematic-debugging. Commit each fix with its own message and the co-author line.

---

### Task 9: Check on shep-dev

Run on the dev store with the throwaway database. **Never** with the local `.env` as it stands.

**Setup**

1. Start the throwaway Postgres and create the schema: Global Constraints → Loopback database, steps 1–2. The variables `DATABASE_URL` and `DIRECT_URL` stay exported in this terminal tab.
2. Read shep-dev's currency:

   ```bash
   shopify app execute --store shep-dev.myshopify.com --version 2026-01 -q '{ shop { currencyCode } }'
   ```

   Record the code (for example `EUR`) as `<shop currency>`.
3. Seed three measurements. Create `.smoke/seed-3a.mjs` (`.smoke/` is git-ignored):

   ```js
   // Seeds three measurements on shep-dev for the plan 3a check. Loopback database only.
   // Run once: node .smoke/seed-3a.mjs <shop currency>
   import assert from "node:assert/strict";
   import { PrismaClient } from "@prisma/client";

   const url = process.env.DATABASE_URL;
   assert.equal(url && new URL(url).hostname, "127.0.0.1", "DATABASE_URL must point at the loopback Postgres");
   const currency = process.argv[2] || "";
   assert.match(currency, /^[A-Z]{3}$/, "Pass the shop currency, for example EUR");
   const other = currency === "USD" ? "EUR" : "USD";
   const shop = "shep-dev.myshopify.com";
   const db = new PrismaClient({ datasources: { db: { url } } });
   const start = new Date(Date.now() - 9 * 86_400_000);
   const at = (minutes) => new Date(start.getTime() + minutes * 60_000);
   const ended = at(7 * 1440);
   const main = JSON.stringify([{ label: "Card", tag: "a", zone: "main" }]);
   const storeVisit = (id, pageViewId, pagePath, resourceType, minute, fields = {}) => ({
     sessionId: `${id}-browser`,
     pageViewId,
     pagePath,
     resourceType,
     visitorType: "REAL",
     acquisitionId: id,
     acquisitionSource: "facebook",
     acquisitionStartedAt: at(minute),
     startedAt: at(minute),
     timeOnPage: 20000,
     scrollDepth: 60,
     deviceType: "mobile",
     ...fields,
   });
   async function storeProject(title, visits) {
     const project = await db.growthProject.create({ data: { shop, title, goal: "Plan 3a check", scope: "STORE" } });
     const capture = await db.storeSnapshot.create({
       data: { shop, name: title, status: "COMPLETED", completionMode: "TIME_WINDOW", durationDays: 7, startedAt: start, endsAt: ended, completedAt: ended, usesAcquisitionSessions: true },
     });
     await db.growthMeasurement.create({
       data: { projectId: project.id, name: "Baseline", completionMode: "DURATION", durationDays: 7, storeSnapshotId: capture.id },
     });
     await db.storeSnapshotVisit.createMany({ data: visits.map((visit) => ({ ...visit, storeSnapshotId: capture.id })) });
     return project.id;
   }
   try {
     // Four collections, 30 sessions each; click-through rates 60/50/40/20 % give
     // Weakness 8 (sample-3) and 2 (sample-2). Every fourth forwarded session buys;
     // half of those orders are in the shop currency, half in another currency.
     const forwards = [18, 15, 12, 6];
     const visits = [];
     for (const [c, forwarded] of forwards.entries())
       for (let k = 0; k < 30; k += 1) {
         const id = `seed3a-c${c}-${k}`;
         const minute = c * 300 + k * 7;
         const fields = { acquisitionSource: k % 2 ? "facebook" : "google", deviceType: k % 3 ? "mobile" : "desktop" };
         const product = `/products/sample-${k % 3}`;
         const forward = k < forwarded;
         visits.push(storeVisit(id, `${id}-a`, `/collections/sample-${c}`, "COLLECTION", minute, {
           ...fields,
           ...(forward ? { exitType: "internal_link", exitUrl: `https://${shop}${product}`, ctaClicks: main } : { exitType: "back_button" }),
         }));
         if (!forward) continue;
         const bought = k % 4 === 0;
         visits.push(storeVisit(id, `${id}-b`, product, "PRODUCT", minute + 1, {
           ...fields,
           addedToCart: k % 2 === 0,
           ...(bought
             ? {
                 checkoutStarted: true,
                 converted: true,
                 convertedAt: at(minute + 5),
                 ...(k % 8 === 0 ? { orderValue: 40 + c * 5, currency } : { orderValue: 30, currency: other }),
               }
             : {}),
         }));
       }
     const storeId = await storeProject("3a Store revenue", visits);

     // Orders without amounts only: revenue is Not recorded.
     const bare = Array.from({ length: 25 }, (_, k) =>
       storeVisit(`seed3a-bare-${k}`, `seed3a-bare-${k}-a`, "/", "HOMEPAGE", k * 13,
         k % 5 === 0 ? { converted: true, convertedAt: at(k * 13 + 5) } : {}),
     );
     const bareId = await storeProject("3a No amounts", bare);

     // A page measurement with every amount in the shop currency.
     const resource = await db.project.create({
       data: { shop, resourceType: "PRODUCT", productId: "gid://shopify/Product/3000000001", productTitle: "Plan 3a sample product", productHandle: "plan-3a-sample" },
     });
     const pageProject = await db.growthProject.create({
       data: { shop, title: "3a Page revenue", goal: "Plan 3a check", scope: "PAGE", resourceProjectId: resource.id },
     });
     const snapshot = await db.snapshot.create({
       data: { projectId: resource.id, number: 1, status: "COMPLETED", completedAt: ended, usesAcquisitionSessions: true },
     });
     await db.growthMeasurement.create({
       data: { projectId: pageProject.id, name: "Baseline", completionMode: "VISITORS", targetVisitors: 40, snapshotId: snapshot.id },
     });
     await db.visit.createMany({
       data: Array.from({ length: 40 }, (_, k) => ({
         snapshotId: snapshot.id,
         sessionId: `seed3a-page-${k}-browser`,
         pageViewId: `seed3a-page-${k}`,
         acquisitionId: `seed3a-page-${k}`,
         acquisitionSource: k % 2 ? "facebook" : "google",
         acquisitionStartedAt: at(k * 11),
         startedAt: at(k * 11),
         visitorType: "REAL",
         deviceType: k % 3 ? "mobile" : "desktop",
         timeOnPage: 25000,
         scrollDepth: 70,
         addedToCart: k % 3 === 0,
         ...(k % 5 === 0
           ? { checkoutStarted: true, converted: true, convertedAt: at(k * 11 + 5), orderValue: 35 + k, currency }
           : {}),
       })),
     });
     console.log(JSON.stringify({ store: storeId, noAmounts: bareId, page: pageProject.id }, null, 2));
   } finally {
     await db.$disconnect();
   }
   ```

   Run it once in the same terminal tab: `node .smoke/seed-3a.mjs <shop currency>`.
   Expected: three project ids.
4. In that tab, with `DATABASE_URL` and `DIRECT_URL` still exported, run `shopify app dev` and choose shep-dev if asked. Open the app in shep-dev's admin.
5. Check the web pixel: `shopify app execute --store shep-dev.myshopify.com --version 2026-01 -q '{ webPixel { id settings } }'`. Record the `apiEndpoint`; the dev run points it at the tunnel, and Teardown step 2 points it back.

**Steps** (record PASS/FAIL and notes for each in `.smoke/3a.md`, which is not committed)

1. **Store measurement: Weakness.** Open Projects → "3a Store revenue" → View results. In Sessions by page:
   - The last column is **Weakness**, and "Missed sessions" appears nowhere.
   - The help text reads "Weakness is how many sessions a page lost against the typical page of its type."
   - Focus rows read "Weakness 8: about 8 fewer sessions continued from here than from your typical collection." for `/collections/sample-3`, and "Weakness 2: …" for `/collections/sample-2`.
   - Products show "—".
2. **Store measurement: revenue.** Expected totals: 14 purchases and 365.00 in the shop currency, partly recorded (6 orders are in another currency).
   - Funnel: Purchased 14, and a Revenue tile with the shop's 365.00 and the caption "Some orders have no recorded amount".
   - Traffic by source: a Revenue column right after Conversion rate. Rows end in `*`, and the line "* Some orders have no recorded amount" sits under the table.
   - Devices: Conversions and Revenue columns.
   - Sessions by page: Conversions, Conversion rate, Revenue, then Weakness. `/collections/sample-0` shows 5 conversions; the help text explains that one order can count on several pages.
3. **Filters:** pick Source = google. Every revenue figure and conversion count drops together with the sessions, and Back leaves the sheet in one step (2a behaviour).
4. **Page measurement:** open "3a Page revenue" → View results.
   - The conversion tiles show Converted sessions 8, Conversion rate 20%, and Revenue 420.00 in the shop currency, with no hint.
   - Traffic by source shows the Revenue column, with no `*`.
5. **Not recorded:** open "3a No amounts" → View results.
   - The funnel's Revenue tile, the traffic rows, the devices rows and the `/` row in Sessions by page show **Not recorded**.
   - Its Project page summary also shows Revenue "Not recorded".
6. **Project page summary:** on each of the three Projects, the latest-measurement summary shows Sessions, Add-to-cart rate, Conversions, Conversion rate and Revenue. The store project shows the hint caption.
7. **A real measurement (optional):** if shep-dev has a live measurement with test orders, its revenue is in the shop currency, and orders without an amount produce the hint.
8. **375 px:** set the browser pane to 375 px. The Results sheet tables scroll sideways, the tiles wrap, and nothing is cut off. Reset the width afterwards.
9. **Deutsch pass:** switch Settings → Language to Deutsch and repeat steps 1, 2 and 5 briefly.
   - Expected text: "Schwäche", "Schwäche gibt an, wie viele Sitzungen …", "Umsatz", "Conversions", "Nicht erfasst" and "Für einige Bestellungen ist kein Betrag erfasst".
   - Money uses German format (for example `365,00 €`).
   - No English is left in the changed cards, apart from page paths. Switch back to English.
10. **Throughout:** no console errors, and no unexpected 4xx/5xx in the network log (`/api/growth-report` answers 200).

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
3. Stop Postgres with `"$PGBIN/pg_ctl" -D "$PGDATA" stop`. The seeded rows live only in the throwaway database.

---

## Results

Executed subagent-driven on 2026-11-07 on `polaris-ui-redesign`, commits `7bfc8da..da0097d` (7 task commits plus 2 final-review fixes). Not pushed, not deployed.

**Checks.**
- `run-checks --compare` reported no regressions, and `check-revenue` passes.
- The 4 database checks pass on loopback Postgres.
- The build passes, and ESLint finds 0 problems in the changed files.
- tsc still reports 100 errors, none of them in files this plan changed.

**Final whole-branch review (opus): "With fixes"**
- **Critical, fixed in `02015a1`:** every paid order is attributed twice, once by the `checkout_completed` pixel and once by the `orders/paid` webhook. Neither path dedupes by order id, so summing revenue per session doubled it.
- **Important, fixed in `da0097d`:** a partly recorded comparison figure looked complete.
- A scoped re-review found both fixes addressed and no new breakage.

**shep-dev check (Task 9)** ran with the throwaway database, currency USD.
- **Pass:** Weakness column, help text and Focus rows; store revenue ($365.00 with the hint; `*` and footnote in traffic, devices and pages); page revenue ($420.00, no hint); "Not recorded" everywhere for the no-amount measurement; Project summaries; the German pass.
- **Real test order** on the live store measurement: 1 conversion at $749.95, counted once. Only the pixel delivery reached the dev server. No `orders/paid` webhook for this order showed up in the dev log or in production. The production webhooks logged at that time belonged to another store. So the double delivery was not reproduced live; the database fixtures cover it.
- **Not verified live:** the Source filter (the dropdown inside the results sheet takes no automated input; the database tests cover filtered revenue) and 375 px (Chrome would not resize).
- **Visual note:** "Not recorded" wraps onto two lines in the Project summary's Revenue tile.
- **Teardown:** the pixel points back at production, `shopify app dev clean` was run, and Postgres is stopped.

**Environment notes.**
- `shopify app execute` (CLI 3.94.3) now fails with "you don't have access to this dev store", although `shopify app dev` works. The dev server's GraphiQL proxy (`http://localhost:3457/graphiql/graphql.json?key=…&api_version=2026-01`) worked for reading the currency and resetting the pixel.
- Worktrees under `.claude/worktrees/` break `shopify app dev`. For one run, a temporary `web_directories = ["**"]` in `shopify.app.toml` skips hidden folders. It was removed afterwards and never committed.

**Rulings.**
- P1: plan rulings 1–13 stand. Store measurements read `StoreSnapshotVisit`, not a new `ChannelSnapshotSession` write. Cost if wrong: imported channel captures never show revenue.
- P2: the plan file was committed at the end. Cost: none.
- Task 3: the brief's negative grep hits its own `doesNotMatch` assertion, which was kept. Cost: none.
- Task 6: a partial current figure's hint replaces the "{value} in {name}" comparison caption on Revenue tiles. Cost: the comparison figure is hidden only when the current revenue is partial.
- Final: dedupe happens in the report SQL. Converted rows of a session within 10 minutes of each other count as one order; the largest shop-currency amount is used; a row without `convertedAt` is its own order. Cost: two real orders within 10 minutes in one session count as one. The writer-side fix (an order id on visit rows, with a migration) is commit `97b20f3` on `NBL/pensive-pike-e775f4`, which is not merged.

**Deferred minors.**
- T1: a non-finite revenue with priced>0 shows the zero amount (the query never returns NaN).
- T2: the `Admin` type is duplicated. `getGrowthMetrics` returns `sales.currency: null` when the lookup fails, which the UI already handles.
- T3: the Focus sentence repeats the number. No UI test covers weakness 0.
- T4: no fixtures for a priced plus an unpriced order in one session, or for a converted customer session without an event. The customer-capture LATERAL may run per page row. The aggregates are repeated in `json_build_object`.
- T5: no route test for a null currency. The currency lookup runs before the reports instead of alongside them.
- T6: the page-layout currency hand-off is untested. No component render with `currency: null`. The comparison is formatted in `report.currency`. The `{ t, formatNumber }` literal is repeated.
- T7: the LatestSummary test lacks 0-conversion and null-currency cases. Long amounts may be tight at 375 px.
- Final: the hint wording is inaccurate for other-currency orders. The `value(() => "")` placeholder. The overlap help line shows when the data is unavailable. Within 10 minutes, a priced and an unpriced order merge into one priced order.
