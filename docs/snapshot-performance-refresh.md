# Snapshot: Channel overview, performance, and naming refresh

Local implementation and verification: August 26, 2026. Production was subsequently released with authenticated smoke checks; see [the production release record](snapshot-production-release-2026-08-26.md). Neither this document nor that smoke verification is a live-store speed benchmark.

## Requested experience

- Channel Snapshots no longer requests or displays the top storefront-tracking warning.
- Channel performance occupies the space above the history list. The attribution explanation is a collapsed **How channel traffic is measured** section below the list.
- The default chart compares human sessions by acquisition channel; the metric selector switches to conversion rate. Summary figures show human sessions, real-traffic share, and converted sessions.
- The app's visible name and Shopify display-name configuration are **Snapshot**. Existing installation/tracking identities and paid-plan names stay compatible.

## Graph definitions

The overview uses the active capture, or the most recent capture if none is active. It never sums overlapping snapshots. A session is assigned to its first captured time bucket; subsequent classification or conversion updates can update that bucket. These are Snapshot tracking metrics, not Shopify Analytics metrics.

- Human sessions: Real + Zombie acquisition sessions, not heartbeat/page-view rows.
- Real traffic: Real sessions divided by all captured sessions, including pending and bot sessions.
- Conversion rate: converted human sessions divided by human sessions. Aggregate rates are count-weighted, not an average of channel percentages. No-human buckets are gaps, not invented zero-conversion observations.
- Time: UTC; hourly for captures up to 24 hours, daily thereafter. Long captures show an explicitly labelled last-90-day window, and the summary uses that same window.
- Empty, loading, unavailable, and bot/pending-only states remain explicit. A failed refresh keeps the previously loaded graph. The plot scrolls within its card on narrow screens.

## Research and changes

Repository history was the source of truth, rather than the upstream-template README. Commit `93e2989` (July 2) introduced a lightweight app shell and after-paint data loading. Later changes reintroduced awaited billing reconciliation in `9a20a91` (August 6), and blocking conversion/activity reports in `b54eaea` (August 7). The newer Channel writer added more work to the existing request path.

| Blocking or repeated work | Change |
| --- | --- |
| Parent app loader waits for Shopify subscription reconciliation | Authenticated shell returns first; a delayed, authenticated background POST mirrors existing subscriptions. Revalidate only on an actual billing change, when navigation is idle. |
| Homepage waits for Shopify conversion analytics and CRO activity | Chart loads after paint, with a local loading/error/retry state and a lazy chart bundle. No analytics wait in the initial homepage loader. |
| Store lists/details wait for a live storefront-tracker check | Existing compact status loads independently after paint. No new Channel warning banner. |
| Page Snapshot/A/B list loader waits for performance graph | Graph-only resource requests load separately, with tenant-scoped short-lived caches and skeleton/retry states. Category changes immediately show the destination tab's pending state. |
| Parent/category pages preload many other data-heavy routes | Remove bulk preload fan-out; individual route links prefetch on user intent. |
| Repeated usage-pill counts | One tenant-scoped SQL count query, cached for display for 30 seconds. Creation/authorization guards always query fresh access; successful mutations invalidate display caches. |
| Concurrent identical cached loads duplicate database work | Same-key in-flight sharing, bounded LRU storage, expiry, and invalidation fencing prevent duplicate work or stale in-flight results repopulating a cleared cache. |
| Each Channel heartbeat recounts the whole capture target | Recount only when a write can add target eligibility; retain snapshot locking, status/deadline checks, tenant scoping, and acquisition deduplication. |

Background JSON requests use fresh App Bridge identity tokens, same-origin API paths, no redirects, abort/obsolete-response guards, and component-local failure states. Tokens are not persisted or logged. This is separate from normal Remix action/navigation handling.

The loading/prefetch approach follows [Remix's intent-prefetch behavior](https://v2.remix.run/docs/components/link/) and [pending UI guidance](https://v2.remix.run/docs/discussion/pending-ui/). Real embedded performance must still be checked in Shopify Admin; [Shopify's performance guidance](https://shopify.dev/docs/apps/build/performance/admin-installation-oauth) distinguishes embedded measurements from standalone lab tests.

### Deterministic query-count checks

These are instrumented mock/ORM-method counts, **not measured production latency or database query-plan benchmarks**:

| Scenario | Before | After |
| --- | ---: | ---: |
| Ten sequential no-active-capture lookups | 20 database calls | 10 |
| Eight concurrent same-shop active lookups | 8 lookup queries | 1 |
| Ten repeated same-acquisition/page heartbeats, including active lookup | 90 ORM calls | 70 |
| Whole-capture target counts during those ten heartbeats | 20 | 1 |

The Channel graph aggregates in SQL and returns bounded channel/time-bucket rows instead of raw visits. Detailed Store/A/B report cold loads still perform their existing report work; this release does not claim every route has zero remaining latency. Caches are process-local, so separate server instances can each have a cold read.

## Naming compatibility

Renamed UI, document titles, onboarding/approval messages, report attribution, Shopify app display name, and theme/pixel display labels. Preserved `mw_*` cookies/cart attributes/storage keys, extension handles/IDs, Shopify client ID, current callback/proxy/hosting URLs, persisted models, legacy template identifiers, and subscription plans/prices. Tracker detection recognizes both old and new embed labels.

Shopify's published app name and extension labels require the normal configuration/extension release; changing the local configuration does not rename the installed live app by itself. No new access scopes or additional migration are introduced by this refresh.

## Verification and release gates

- [x] Channel lifecycle/strict target/concurrency/tenant tests; acquisition and checkout attribution regressions; web-pixel setup regressions.
- [x] Channel overview/UI, billing/cache/performance, category/A/B graph splitting, controlled background transport, dashboard graph, and branding checks.
- [x] Focused lint and production build. Full TypeScript comparison: current 128 diagnostics, virtual HEAD 128; zero introduced diagnostics (same dependencies and generated Prisma types).
- [x] Local component preview: desktop/mobile Channel graph, metric switch, keyboard inspection, zero-data/error/refresh states, deferred dashboard loading, explanation below graph, and immediate category-tab pending feedback. Synthetic data only; no merchant-store writes.
- [x] Connected database migration status checked read-only: 15 migrations present and schema up to date. No migration was applied during this refresh.
- [x] Release application plus Shopify configuration/extensions after approval. Exact production database rechecked: all 15 migrations already applied. Server and Shopify release IDs are in the production release record.
- [x] Verify authenticated embedded navigation and background-loaded overview data on the authorized development store, with the iframe confirmed on the production host. Dashboard, Channel, Page category switching, A/B, and Store views passed smoke checks.
- [ ] Verify billing reconciliation with an actual subscription-state change; no purchase or subscription change was made during release verification.
- [ ] Compare cold/warm navigation and Shopify embedded Web Vitals before/after deployment; use the homepage `Server-Timing` auth/shell and conversion-report timings to isolate remaining waits.

Useful repeatable checks:

```sh
node --test scripts/check-performance-regressions.mjs scripts/check-category-performance.mjs scripts/check-ab-test-activity.mjs scripts/check-background-transport.mjs
node --test scripts/check-channel-snapshots.mjs scripts/channel-attribution.test.mjs scripts/check-web-pixel-setup.mjs scripts/check-snapshot-branding.mjs
node scripts/check-channel-overview.mjs
node scripts/check-channel-snapshot-ui.mjs
node scripts/check-dashboard-graph.mjs
npm run build
git diff --check
```

For the DB-free visual fixture, run `node scripts/preview-snapshot-changes.mjs` and open `http://127.0.0.1:4181`. The fixture is loopback-only and never loads merchant credentials or connects to Shopify/the database. See [the Channel Snapshots release checklist](channel-snapshots-release.md) for full rollout, checkout/consent, and recovery requirements.
