# Project report redesign — design

Date: 3 November 2026. Status: draft for review. Branch: `projects-ui-rework`.

## Goal

Make each Project results report answer one question for the merchant:

- **Store Project:** where in the store should I focus conversion work?
- **Page Project:** how well does this one page move visitors forward, and where do they go instead?

This is a reporting change only. The storefront tracker, web pixel, database schema and collection rules do not change. Every new number comes from fields already stored on each page view.

## Agreed decisions

| Topic | Decision |
| --- | --- |
| Where | The Projects results sheet (`GrowthResultsSheet` → `GrowthMeasurementResults`). Legacy Store/Channel/Customer screens are not changed. |
| Store sections | Engagement metrics → Conversion funnel → Traffic by source → Sessions by page → Journeys (only when journey tracking is on) |
| Page sections | Conversion metrics → Engagement metrics → Engagement by zone → Exit paths → Traffic by source |
| Removed | "Conversion rate over time" chart from both reports; Engagement by zone from the Store report |
| Click-through rate | Sessions that clicked from the page's main content to another store page; for collections, only clicks to a product |
| Engagement bars | One bar with three shades, on image cards only; no bars on Button, Link, Widget, Header or Footer rows |
| Sessions by page ranking | "Missed sessions" against the typical page of the same type |

## Shared rules

- "Session" means one acquisition session (`COALESCE(acquisitionId, sessionId)`), as the report already does. It is not a person.
- Every section follows the sheet's existing All/Active audience and source/medium/campaign filters. Numerators and denominators always use the same filtered cohort.
- Shares are percentages of sessions unless stated otherwise.
- A section whose data was never recorded for the measurement shows "Not recorded for this measurement", never zeros. This applies to measurements backed by imported Channel or Customer snapshots, which have no exit, device, search or click data.
- The comparison measurement (Compare with) keeps working on the top numbers only.

## Report contents

### Page Project

**1. Conversion metrics** — four tiles. The second tile depends on the page type of the Project's resource (`Project.resourceType`):

| Page type | Tiles |
| --- | --- |
| Product | Sessions · Add-to-cart rate · Converted sessions · Conversion rate (unchanged) |
| Collection, Blog, Page, Homepage | Sessions · Click-through rate · Converted sessions · Conversion rate |

**2. Engagement metrics**

- Time on page: median active time per session on this page.
- Scroll depth: average maximum scroll per page view (0–100%).
- Searches: share of sessions that searched, plus top 5 search terms.
- Device type: share of sessions by desktop / mobile / tablet, each with its conversion rate.

**3. Engagement by zone** (see "Engagement by zone changes" below).

**4. Exit paths**

- How visitors left this page, as shares of page views, grouped from the recorded `exitType`:
  - Continued to another page (`internal_link`)
  - Went to cart or checkout (`checkout`)
  - Pressed back (`back_button`)
  - Closed or switched tab (`window_closed`)
  - Went idle (`idle`)
  - Left for another site (`external_link`)
  - Unknown (no exit recorded)
- Top 5 pages they went to next: the path of `exitUrl` for `internal_link` exits, with query string and fragment removed. Private paths (`/account`, `/orders`, `/checkouts`) are shown as `/private-page`.

**5. Traffic by source** — unchanged.

### Store Project

**1. Engagement metrics**

- Time on site: median, per session, of active time summed across the session's pages.
- Pages per session: average page views per session.
- Scroll depth: average maximum scroll per page view.
- Click-through rate: share of sessions with at least one forward click anywhere in the store (rule below).
- Searches: share of sessions that searched, plus top 5 search terms.
- Device type: share of sessions by device, each with its conversion rate.
- Top exit pages: the 5 pages where the most sessions ended, each with its exit rate. Sessions that reached checkout or purchased are not counted as exits.

**2. Conversion funnel** — Sessions → Added to cart → Reached checkout → Purchased. Each step shows a count and its share of sessions. Steps are not forced to shrink: a purchase can happen without a tracked cart step (for example Buy it now), so each share is measured against sessions, never against the previous step.

**3. Traffic by source** — unchanged.

**4. Sessions by page** — see "Missed sessions ranking". Page views are grouped by path after removing a leading locale prefix (such as `/fr` or `/en-us`) and then a `/collections/<handle>` prefix that comes directly before `/products/`, so one product's URL variants share a row.

**5. Journeys** — the existing `GrowthProjectJourneys` list, only when journey tracking is on.

## Metric rules

### Click-through rate

A page view counts as a **forward click** when all of these hold:

1. Its `exitType` is `internal_link`.
2. Its `exitUrl` path is a store page other than cart or checkout. For a collection page view, the path must be a product page: `/products/<handle>` or `/collections/<handle>/products/<handle>`, optionally after a locale prefix such as `/fr` or `/en-us`.
3. The last entry in its `ctaClicks` array is not in the `header` or `footer` zone. (The tracker records navigation menus as `header`.)

A session counts as clicked through if any of its qualifying page views had a forward click.

Why `exitUrl` instead of only `ctaClicks`: when a shopper clicks a product image inside a product card, the tracker records the image (its `href` is the image URL), while `exitUrl` records the link that was followed. Using `exitUrl` counts those clicks correctly. Rule 3 uses `ctaClicks` only to drop menu and footer navigation.

### Searches

- A session searched if any of its page views has a non-empty `searchQuery`.
- Top terms are trimmed, lowercased and grouped. A term is listed only when 2 or more sessions used it, so a one-off search that contains personal data is never shown.

### Time medians

Medians use PostgreSQL `percentile_cont(0.5)`. The tracker already caps active time at 30 minutes per page view.

### Missed sessions ranking (Store)

Per page (grouped by `pagePath`):

- **Sessions:** distinct sessions that viewed the page.
- **Key rate:** add-to-cart rate for Product pages; click-through rate for Collection, Blog, Page and Homepage. Pages with no resource type (search, cart, other paths) are listed but never ranked.
- **Exit rate:** sessions whose last page view was this page ÷ sessions that viewed it. Sessions that reached checkout or purchased are not counted as exits.
- **Conversion rate:** sessions that viewed this page and purchased ÷ sessions that viewed it (same-session association, not proof of cause).

Ranking:

1. A page is eligible with at least 20 sessions.
2. The typical rate for a page type is the median key rate of its eligible pages. It needs at least 3 eligible pages of that type; otherwise pages of that type are not ranked.
3. `missed = max(0, round(sessions × (typical rate − page key rate)))`.
4. Sort by missed descending, then sessions descending. The top 3 pages with missed > 0 get a "Focus here" badge and a sentence such as "About 42 more sessions would have continued if this page matched your other collections."
5. Ineligible pages remain in the table without a badge. The table shows 10 rows per page.

Columns: Page · Type · Sessions · Key rate · Exit rate · Conversion rate · Missed sessions.

## Engagement by zone changes

`EngagementOutcomesView` is shared by three screens: the Projects results sheet, the A/B test detail report (`AbTestDetailReport.tsx`) and the classic page report (`app.project.$id.tsx`). The changes apply to all three so they stay consistent.

- The Images section moves to the top, above the donut and the Button/Link/Widget groups.
- Button, Link, Widget, Header and Footer rows lose their bars and keep their numbers (clicked sessions, added to cart, purchased).
- Each image card gets one merged bar:
  - Bar length = clicked sessions, on the shared scale across all image cards.
  - Medium shade = sessions that added to cart; darkest shade = sessions that purchased.
  - Each shade is drawn from the left edge, not stacked, so the bar stays correct when purchases exceed tracked carts.
  - One legend above the image row; the numbers stay beside or below each bar.
- Notes under the view are updated to describe the single bar.

## Implementation outline

### Report service — `app/utils/growth-report.server.ts`

- The `raw` CTE also selects, for Visit and StoreSnapshotVisit captures: `pagePath`, `resourceType`, `startedAt` (page view), `exitType`, `exitUrl`, `deviceType`, `searchQuery`, `checkoutStarted`, plus the existing fields. Channel and Customer captures select `NULL` for these and set an availability flag.
- New CTEs compute engagement metrics, the funnel, exit paths, top searches, devices and per-page rows inside the same query, so filters and cohort stay identical.
- `ctaClicks` is JSON stored as text. The last-click zone is read in SQL with `"ctaClicks"::jsonb -> -1 ->> 'zone'`, guarded by `pg_input_is_valid("ctaClicks", 'jsonb')` so malformed legacy rows are skipped instead of failing the query. This needs PostgreSQL 16 or later; production runs 17.6.
- The missed-sessions ranking runs in TypeScript on the per-page rows. It is a small pure function in `app/utils/growth-report.ts`, so it can be tested without a database.
- The report reads the Project's scope and page type from the measurement's Project, so `getGrowthMeasurementReport` keeps its signature. All sections come from the same query; per-page rows are capped at the 500 pages with the most sessions.

### Types — `app/utils/growth-report.ts`

`GrowthReport` gains optional fields: `pageType`, `engagementSummary`, `funnel`, `exitPaths`, `pages`, each with an `available` flag where data can be missing. Existing fields stay, so the A/B and legacy callers are unaffected. `series` is still returned for now but no longer shown.

### UI — `app/components/`

- `GrowthMeasurementResults.tsx` chooses a Store or Page layout from the Project scope, and drops the conversion-rate chart.
- New focused components:
  - `GrowthEngagementMetrics.tsx`
  - `GrowthConversionFunnel.tsx`
  - `GrowthExitPaths.tsx`
  - `GrowthSessionsByPage.tsx`
- `EngagementOutcomes.tsx`: reordered sections, bars removed from rows, merged bar on image cards.
- All new strings go through `useI18n` and get German, Simplified Chinese and Traditional Chinese entries in `app/locales/catalog.ts`.

## Testing

- **Pure functions** (no database): missed-sessions ranking, including thresholds, fewer than 3 pages of a type, ties, and zero or negative gaps.
- **Click-through rule** (real SQL, because it runs in the report query): image-in-card clicks, locale-prefixed product paths, header/footer exclusion and malformed `ctaClicks`.
- **Real SQL** (`scripts/check-growth-reports.mjs` and `scripts/check-growth-report-sections.mjs`, disposable loopback database only): funnel counts, medians, search grouping and the 2-session threshold, device conversion rates, exit grouping, private-path masking, All/Active and source filters applied to every new section, Channel/Customer measurements returning "not recorded".
- **UI** (`scripts/check-projects-ui.mjs` and the preview fixture): Store and Page layouts, page-type tile switch, merged bar rendering with purchases greater than carts, 390px mobile width without horizontal overflow.
- **i18n**: `node scripts/check-i18n.mjs` passes for all four locales.
- Existing A/B detail and classic report checks still pass with the shared engagement view.

## Out of scope

- Tracker, pixel or schema changes.
- The legacy Store, Channel and Customer snapshot screens.
- Statistical significance or confidence intervals.
- Removing `series` and the dashboard growth chart.
- The security fixes found on 2 November 2026; they are planned separately.

## Risks

- **Large stores:** per-page grouping over all store page views runs on every report open. If it is slow on real data, cache the report per measurement and filter set for 60 seconds using the existing `loader-cache.server.ts` pattern.
- **Last exit wins:** `exitType` reflects the last link clicked on a page view. A shopper who clicks a product, comes back with the browser Back button and leaves is recorded by their last action. This is consistent with the existing exit data.
- **Small samples:** the missed-sessions estimate assumes a page could match its type's typical rate. The 20-session and 3-page thresholds limit, but do not remove, noise.
