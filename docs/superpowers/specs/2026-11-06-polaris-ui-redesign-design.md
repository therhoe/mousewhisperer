# Snapshot UI redesign: design

- **Date:** 2026-11-06
- **Status:** draft for review
- **Mockups:** https://claude.ai/artifact/JHMSH51eAuJSov1LRnhiD6 (private canvas, 20 frames on 4 pages; the frames and their notes are the visual reference for this spec)
- **Branch:** a new branch off `projects-ui-rework` (for example `polaris-ui-redesign`)

## 1. Why

The merchant reported three problems:

1. **The look.** The app mixes Polaris React with hand-styled screens. Since 2026-09-15 the Shopify admin has a new look, and only apps built on Polaris web components 2.0 get it. Snapshot still looks like the old admin, and several screens look like neither.
2. **Structure.** Tables are built 5 different ways, as are empty states and filters. 11 screens show two headers, and several screens have more than one main button.
3. **Back goes to the wrong place.** The audit found 17 cases. The root cause: every back control pushes a fixed URL, and sheets and pop-ups push their own `?results=1`, `?create=1` or `?journey=` entries, so Back often reopens something or skips to an unrelated page.

## 2. Decisions already made

| Decision | Choice |
|---|---|
| Which screens | Every screen, including the older reports |
| Home | Results first: what needs attention and what is running, then store numbers |
| Older reports | Live inside Projects; no separate menu items |
| Build approach | Move to Polaris web components 2.0. Upgrade Remix v2 → React Router 7 and React 18 → 19, then migrate screen by screen; old and new screens can coexist |
| Result screens | Stay full-screen sheets (App Bridge max modal), as today |
| Back inside a sheet | Back closes the sheet, or steps back inside it. A sheet has its own address, so reload reopens it |
| Which screens are sheets | Measurement results, detailed reports, customer journeys, A/B variant details |
| Missed sessions | Renamed **Weakness** (same calculation) |
| Conversion rates | Every conversion rate also shows the number of conversions and the revenue |
| Weakness list | Merchant can pick pages and create Page Projects straight from the results |
| Unchanged | Metric calculations (other than the additions above); 4 languages (en, de, zh-CN, zh-TW); A/B creation steps; prices and plan limits. Mobile width matters |

## 3. Scope

**In scope:** every screen in the page map below, the navigation model, the framework upgrade, the three number changes in section 7, and redirects for retired addresses.

**Out of scope:** tracking accuracy, theme extension and web pixel code (except the one new write in 7.2), Challenges and the pixel-art avatar (stay behind `COMMUNITY_FEATURES_ENABLED = false`), and new metrics beyond conversions and revenue.

## 4. Navigation

### 4.1 App menu

App name **Snapshot** (the `rel="home"` link, goes to Home), then **Projects**, **A/B tests**, **Plans**, **Settings**. Today's menu lacks A/B tests, Plans and Settings.

### 4.2 Screens and addresses

**Pages** (rendered in the app frame):

| # | Screen | Address | Back goes to |
|---|---|---|---|
| 1 | Home | `/app` | (top level) |
| 2 | Projects | `/app/projects` | (top level) |
| 3 | Create project | `/app/projects/new` | where you started; Projects if opened fresh |
| 4 | Project | `/app/projects/:id` | where you came from; Projects if opened fresh |
| 8 | A/B tests | `/app/ab-tests` | (top level) |
| 9 | Create A/B test | `/app/ab-tests/new` | where you started; A/B tests if opened fresh |
| 10 | A/B test | `/app/ab-tests/:id` | where you came from; A/B tests if opened fresh |
| 12 | Plans | `/app/plans` | where you came from; Home if opened fresh |
| 13 | Settings | `/app/settings` | (top level) |

**Sheets** (App Bridge `variant="max"` modal over a page; the view is in the page's search params):

| # | Sheet | Opened on | Search params |
|---|---|---|---|
| 5 | Results (store, collection, product, homepage, page or blog) | Project | `results=<measurementId>` |
| 6 | Detailed report (page, store, channel, customer) | inside the Results sheet | `results=<id>&view=report` |
| 7 | Customer journey | inside the Results sheet | `results=<id>&view=journey&session=<sessionId>` |
| 11 | Variant details | A/B test | `variant=<variantId>` |

Filters inside a sheet are search params too (see 4.4).

**Pop-ups** (Polaris `s-modal`, no address, no Back step): Start measurement, Log optimization, Complete measurement, Create Page Projects, delete confirmations, and every More actions menu.

**Retired addresses** redirect (with `replace`), so bookmarks keep working:

| Today | Goes to |
|---|---|
| `/app/project/:id` (classic page report) | owning Project with `?results=<measurement>&view=report`; Projects if the snapshot has no measurement |
| `/app/store-snapshots/:id`, `/app/channel-snapshots/:id`, `/app/customer-snapshots/:id` | same rule |
| `/app/customer-snapshots/:id/journey/:sessionId` | owning Project with `?results=…&view=journey&session=…` |
| `/app/page-snapshots`, `/app/page-snapshots/:category`, `/app/store-snapshots`, `/app/channel-snapshots`, `/app/customer-snapshots`, `/app/audits/:category` | `/app/projects` |
| `/app/upgrade` | `/app/plans` (query kept) |

Resource routes stay where they are: the journey export, `/api/export/:snapshotId`, `/app/ab-tests/:id/report` (the variant sheet's data source), and `/app/upgrade/return` (billing return).

### 4.3 Back rules (approved)

1. Back returns to where you came from. Opened from a bookmark or a fresh link, Back goes to the screen's parent.
2. Pop-ups and filters never add Back steps. Full-screen sheets add one: Back closes the sheet, or steps back inside it.
3. After creating something, Back skips the form.
4. After deleting, you land on the list, never an error page.
5. Upgrading returns you to the screen you started from.
6. One header per screen, one primary button.

### 4.4 How Back is built

All of this lives in one small module (for example `app/utils/navigation.ts`), with pure helpers that tests can call without a browser.

- **Page back control.** A `useBack(parentPath)` hook. If `location.key !== "default"` (an earlier in-app entry exists), it calls `navigate(-1)`. Otherwise it calls `navigate(parentPath, { replace: true })`. The page header's back control calls it instead of following a fixed link. The parent stays as the link's `href`, so opening it in a new tab still works.
- **Sheets.** A `useSheet()` hook reads and writes the sheet params.
  - Opening, and every step inside a sheet, pushes a new entry with `state.sheetDepth = previous + 1`.
  - The browser or admin Back button pops one entry. When the sheet params are gone, the modal closes.
  - The sheet's own back arrow is `navigate(-1)`.
  - ✕ (and the modal's own close, `onHide`) runs `navigate(-sheetDepth)` when the depth is known. Otherwise, such as after a reload, it runs `navigate(urlWithoutSheetParams, { replace: true })`.
  - Opening a sheet from another page works the same way. For example, Home → "View results" pushes `/app/projects/:id?results=…`: Back returns to Home, and ✕ shows the Project underneath.
- **Filters** (pages and sheets) call `setSearchParams(next, { replace: true, preventScrollReset: true })`.
- **Create.** Create forms submit with `replace`, so the new page replaces the form's entry.
- **Delete.** The action redirects to the list, and the client navigation uses `replace`.
- **Upgrade.**
  - Every Upgrade link goes to `/app/plans` inside the app.
  - Before the merchant leaves for Shopify's plan page, the action stores a validated `returnTo` (an `/app/...` path) in a short-lived signed cookie.
  - The jump to Shopify uses top-level App Bridge navigation, never `window.location` inside the iframe (that is what drops the embedded params today).
  - `/app/upgrade/return` reads `returnTo`, checks it again, and redirects there. Without it, the merchant lands on `/app/plans`.
- **Links between screens** use router links, so App Bridge keeps the embedded params.

## 5. Look and components

Polaris web components 2.0, loaded by `@shopify/shopify-app-react-router` (its AppProvider loads `polaris-2.js`), with `@shopify/polaris-types` for TypeScript.

| Pattern | Built with |
|---|---|
| Page frame and header | `s-page` (heading, one primary action, secondary actions, back control) |
| Card or section | `s-section` |
| Layout | Polaris stack, grid and box components |
| Tables | `s-table`; scrolls sideways on narrow screens |
| Status | `s-badge` |
| Messages | `s-banner` |
| Pop-ups | `s-modal` |
| Full-screen sheets | App Bridge `ui-modal variant="max"` with `ui-title-bar` |
| More actions menus | `s-popover` with buttons |
| Fields | text field, select, checkbox, choice list, date picker |
| Segmented filters (Audience, status) | `s-button-group` with pressed buttons; a select where that doesn't fit |
| Empty states | the Polaris empty-state pattern |
| Charts | Polaris has none. One small shared SVG set (line, horizontal bars, stacked bar, funnel, merged zone bar) using Polaris colour tokens, each with a "View chart data" table |

Polaris 2.0 has no tabs. The Project's tabs become stacked sections.

The mockup colours approximate the new admin. The real components set the exact styles.

## 6. Screens

Each screen keeps its current loader and data unless noted. Section 7 covers the number changes on every screen. The mockup frame number is in brackets.

1. **Home** [1]
   - Header: "Create A/B test" and primary "Create project".
   - Needs your attention: finished measurements, A/B tests with a leader, tracking problems.
   - Running now: measurements with progress, and live A/B tests with the leader so far.
   - Your store (Shopify Analytics) has a period select, metric tiles and a sessions chart. Recent projects links to Projects.
   - Language moves to Settings.
2. **Projects** [2]
   - Status filter (All, Measuring, Idle, Completed), Scope select, search and pagination.
   - The table shows each project's latest numbers.
   - "Create project" opens the Create project page instead of a pop-up.
3. **Create project** [3]
   - Same fields and rules as today's `GrowthProjectForm`, grouped into Basics, What to measure, Complete measurement by, Traffic source and Customer journeys.
   - A side panel shows plan usage (store-level and page-level) and storefront tracking status.
   - Accepts a prefilled page as `?page=<path>` (from "Create Page Project" on the store report). The server resolves the path the same way as 7.3.
   - After Create, you land on the Project, and the form's entry is replaced.
4. **Project** [4]
   - Header: badges, "Create A/B test", More actions (Edit, Delete with confirmation), primary "Start measurement".
   - Sections: Latest measurement (with "View results"), Measurements, A/B tests, Optimization log ("Log optimization" opens a pop-up).
   - A running measurement shows "Complete", with confirmation.
5. **Results sheet** [5a–5e]
   - One filter bar: Audience ("All visitors / Engaged visitors", renamed from "All / Active"), Measurement, Compare with, Source, More filters, Clear filters.
   - Store layout: Engagement metrics, Conversion funnel, Traffic by source, Sessions by page, then Customer journeys when journey tracking is on.
   - Page layout: Conversion metrics, Engagement metrics, Engagement by zone, Exit paths, Traffic by source.
   - The second conversion tile depends on page type: product pages show Add-to-cart rate; collections show Click-through rate ("Clicked through to a product"); homepage, pages and blogs show Click-through rate ("Clicked through to another page").
   - "Detailed report" (renamed from "Open classic report") opens inside the sheet.
6. **Detailed report** (in the sheet) [6a–6d]
   - **Page:** visitor quality, engagement and funnel, traffic quality by source, zones, exit paths, countries, cities, devices, top products clicked, filter usage, sort preferences, searches, recent visits (polls every 30 s while running). Export CSV/PDF; More actions → Delete measurement (asks first). Uses the Results filter bar. Removed: snapshot list, "+ New snapshot", compare mode, Danger Zone.
   - **Store:** traffic breakdown, engagement, conversions, recommendations, sessions by page, and projects created from this report. "TPV" and "RCC" are spelled out ("Total page views", "Reached checkout"). "Create Page Project" closes the sheet and opens Create project with the page chosen.
   - **Channel:** for imported channel captures. Summary, sessions by channel, traffic quality table, and "About these numbers" as a collapsible section.
   - **Customer:** for imported customer captures. Journey overview, plus a visitor journeys table that opens a journey inside the sheet.
   - All four reports are translated into the 4 languages (the classic report is English-only today).
7. **Customer journey** (in the sheet) [7]: summary, timeline, and "Export journey" in the header.
8. **A/B tests** [8]
   - Primary "Create A/B test". Status filter (All, Live, Paused, Draft, Ended; "All" is new), search, sort (Newest, Visitors, Lift, Progress).
   - One table. A draft opens its setup; any other test opens its page.
   - On the Free plan, a banner replaces the table.
9. **Create A/B test** [9]
   - The same two steps as today on one page: "What do you want to test?", then "Traffic & Goal". Save draft at any time.
   - "Create B from snapshot" is renamed "Create B from a completed measurement".
   - Launch replaces the form's entry with the test page.
10. **A/B test** [10]
    - One header with the test's name; primary Pause or Resume (Launch for a draft); More actions holds End test and Delete (asks first).
    - A banner says plainly whether there is a leader yet.
    - Then: filters, variant results, cumulative chart, visitor breakdown, top sources, variants (each opens the variant sheet), and how the test runs.
    - Pause, Resume and End keep the filters.
11. **Variant details** (sheet) [11]: summary, devices, countries, traffic by source, exit types, and engagement by zone. Data comes from `/app/ab-tests/:id/report`.
12. **Plans** [12]
    - Current-plan banner, usage, Whisper and Signal cards, and a Free row.
    - Labels say "store-level / page-level measurements" instead of "snapshots". Prices and limits are unchanged (Whisper $49.99, Signal $99.99, every 30 days).
    - Upgrade follows 4.4.
13. **Settings** (new) [13]
    - Storefront tracking: theme app embed status with "Open theme editor", and web pixel status.
    - Language select.
    - Current plan, with a link to Plans.
    - "Show setup guide on Home again".
    - Existing storage is reused for language and the setup guide.

## 7. Number changes

### 7.1 Weakness

- "Missed sessions" becomes **Weakness** everywhere it appears: the column, the Focus rows and the help text.
- The calculation is unchanged: `max(0, round(sessions × (typical key rate − page key rate)))`, with the 20-session and 3-pages-of-a-type thresholds from the 2026-11-03 spec.
- Help text: "Weakness is how many sessions a page lost against the typical page of its type."

### 7.2 Conversions and revenue beside every conversion rate

**Where.** Wherever a conversion rate appears, the conversion count and revenue sit next to it:

- Home (store tiles and Recent projects)
- Projects
- Project (latest measurement and the Measurements table)
- Results sheets: conversion tiles, devices, funnel, traffic by source, sessions by page, journeys
- Store report (sessions by page)
- Channel report
- Customer report
- A/B test variant results
- Variant sheet

**Definition.** Revenue = the sum of recorded order values for converted sessions, under the same filters as the rate. It is shown in the shop's currency.

**Sources:**

| Screen data | Revenue comes from | Already recorded? |
|---|---|---|
| Page-level measurements (`Visit`) | `Visit.orderValue` | Yes |
| Store-level measurements (`ChannelSnapshotSession`) | new `ChannelSnapshotSession.orderValue` / `currency` | **No**: new write |
| Imported channel captures | same table | No, for past sessions |
| Store snapshot report | `StoreSnapshotVisit.orderValue` / `StoreSnapshotPageAggregate.revenue` | Yes |
| A/B tests | `AbTestAssignment` / `AbTestVisit.orderValue` | Yes |
| Customer journeys | `CustomerJourneyEvent.amount` | Yes |
| Home store numbers | ShopifyQL (`read_reports` is granted): sessions, conversion rate and completed checkouts from the `sessions` dataset already queried; total sales, average order value and spend per customer from the `sales` dataset | New query (these tiles are new on Home) |

**New write.** When `/api/track` records a conversion for a channel-snapshot session, it also stores the order value and currency it already receives (the same value used for `Visit.orderValue` today).

**Missing amounts.** Sessions converted before this ships have no amount:

- A revenue figure with no recorded amounts at all shows **Not recorded**.
- A partly recorded figure shows the recorded sum, with a "Some orders have no recorded amount" hint.

### 7.3 Create Page Projects from the results

Store-layout Results sheet, Sessions by page:

- **Selecting pages.** A checkbox column (plus select-all) shows a selection bar, "N pages selected · Create N Page Projects". Each Focus row also has its own "Create project" button.
- **The pop-up** lists the chosen pages and asks how to complete (Visitor target or Duration) and the target per project. It shows plan usage ("Uses 2 of your 38 remaining page-level measurements"). If the plan doesn't have room, it says so and links to Plans (rule 5 returns here).
- **Creating.**
  - Each page becomes one Page Project, named after its page, and its first measurement ("Baseline") starts.
  - The page path is resolved to a store resource with the logic in today's `resolveFocusedSnapshotResource`, moved into a shared server utility.
  - Projects go through `createGrowthProject`.
  - The homepage needs no resource.
  - Pages that can't be resolved are reported, and the rest are still created.
- **After Create.** The sheet stays open, and the new projects are listed under "Projects created from these results". That list needs a new nullable `GrowthProject.sourceMeasurementId`.

## 8. Data model changes

- `ChannelSnapshotSession`: `orderValue Float?`, `currency String?`.
- `GrowthProject`: `sourceMeasurementId String?`, with an index.

Migrations are written and tested against a disposable loopback Postgres first, with both `DATABASE_URL` and `DIRECT_URL` overridden. The local `.env` points at the production database.

## 9. Framework upgrade

Each step is a deployable checkpoint, checked on the dev store before the next.

1. **Last Remix future flag.** Turn on `v3_singleFetch` (the only v3 flag still off) and fix loaders and actions that rely on `json()` headers or response shapes.
2. **React Router 7.**
   - Run the official Remix → React Router codemod.
   - `@remix-run/*` packages become `react-router`, `@react-router/dev`, `@react-router/node` and `@react-router/fs-routes`. `app/routes.ts` keeps `flatRoutes`, since route config is already on.
   - `json()` returns become plain objects or `data()`.
3. **Shopify and hosting packages.**
   - `@shopify/shopify-app-remix` 4.1.0 becomes `@shopify/shopify-app-react-router`, and `@shopify/app-bridge-react` is updated to match.
   - `@vercel/remix`'s `vercelPreset` becomes Vercel's React Router preset.
4. **React 19.**
   - Upgrade `react`, `react-dom` and their types.
   - Polaris React 12.27 declares `react ^18.0.0`, so an install override is needed while it coexists. A spike first confirms that unmigrated screens still render.
   - If they don't, stay on React 18 for the screen migrations, using small ref-based wrappers for controlled web-component fields, and move to React 19 after Polaris React is gone.
5. **Load Polaris web components** and add `@shopify/polaris-types`.
6. **Shared building blocks:** navigation helpers (4.4), page shell, sheet shell, metric tile, table helpers, chart set, and money formatting.
7. **Migrate screens** in this order:
   - Settings, Plans, Projects
   - Create project, Project
   - Results sheets, detailed reports, journey
   - A/B tests, Create A/B test, A/B test, variant sheet
   - Home last, so it can link to finished screens

   Retired addresses redirect as each replacement lands.
8. **Remove Polaris React:** `@shopify/polaris`, its stylesheet and its locale files.

## 10. Languages

- Every new or changed string goes into `app/locales` for de, zh-CN and zh-TW, with English as the key (the existing `useI18n` pattern).
- The four detailed reports become translatable.
- Renamed terms are updated in all four languages: Weakness, All visitors / Engaged visitors, Detailed report, store-level / page-level measurements.

## 11. Mobile

Every screen works at 375 px:

- Headers wrap.
- Tables scroll sideways.
- Two-column layouts stack.
- Charts keep their data tables.
- Sheets use the full width.

## 12. Testing

- **Pure functions** (node `--test`, transpiled like the existing `scripts/check-*.mjs`):
  - Back target choice (`key === "default"` versus not).
  - Sheet param building and parsing, and the depth arithmetic for ✕.
  - Revenue sums with full, partial and missing amounts.
  - Weakness ranking (unchanged, re-run).
  - Page-path → resource resolution.
  - The `returnTo` validator (rejects anything outside `/app`).
- **Database** (disposable Postgres): revenue aggregation for each source; bulk Page Project creation, including partial failures and plan limits.
- **Dev store** (shep-dev), a Back-navigation matrix:
  - Home → Project → Results → Detailed report → Journey → Back ×4.
  - Projects → Create → Create → Back.
  - Delete from a Project.
  - Upgrade from Create project, then return.
  - Reload on every sheet view.
  - A fresh link to a Project, then Back.
  - Filters, then Back.
  - The variant sheet, then Back and ✕.
- **Each screen at 375 px**, and in each language once.

## 13. Risks and things to confirm first

1. **App Bridge max modal and history.** Confirm on the dev store that browser and admin Back pop the app's history while a max modal is open, and that the modal closes when its params are gone. Fallback: ✕ and the in-sheet back arrow keep working even if the admin Back doesn't reach the iframe.
2. **A pop-up inside a sheet.** "Create Page Projects" opens an `s-modal` inside the max modal's frame. Confirm it renders and stacks there.
3. **Polaris React 12 under React 19.** See the step 4 spike.
4. **Package names and slots to verify against current docs before planning:**
   - Vercel's React Router preset package.
   - `@shopify/shopify-app-react-router`'s current major.
   - The `s-page` back or breadcrumb slot name.
   - Pressed-state support on `s-button-group`.
5. **ShopifyQL sales fields** for Home (total sales, average order value, spend per customer). Verify the field names against the current schema.
6. **Store-level revenue history.** Existing store-level measurements and channel captures show "Not recorded" until new conversions arrive. The merchant should know this before launch.

## 14. Rollout

This is too large for one implementation plan. It splits into three, run in order:

1. **Framework upgrade:** section 9, steps 1–5. No visible change.
2. **Navigation, building blocks and screens:** sections 4–6 and 9, steps 6–8.
3. **Number changes and data model:** sections 7 and 8. This can start after plan 1, alongside plan 2, because it touches loaders and the tracking endpoint more than screens.

Then:

- Work happens on the new branch, merged into `projects-ui-rework` after review.
- Each checkpoint in section 9 is checked on shep-dev.
- Production deploys need the merchant's approval, as before.
- Old addresses keep working through redirects.
