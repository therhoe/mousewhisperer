# Customer Snapshots — implementation and release checklist

Updated: 2026-09-17. **Released to production**, including the additive migration and both Shopify tracking extensions. A development-store browser journey through a simulated test-gateway purchase was verified. See [the production release receipt](snapshot-production-release-2026-09-17-customer-snapshots.md) for exact versions, evidence, boundaries, and rollback targets. Existing unrelated work in this checkout was preserved.

**Deeper QA follow-up:** [169 checks and live dev-store results](customer-snapshots-qa-2026-09-17.md) confirm core tracking, declined/successful test payments, two-ad-tab isolation, and mobile fixture pagination. Four issues were identified and subsequently [fixed and tested locally](snapshot-qa-fixes-2026-09-17.md). Those patches are not deployed; full live acceptance remains open.

## What this version does

- Adds Customer Snapshots to app navigation, with its own history and detail pages.
- Creates a capture for a source, optionally narrowed to a campaign and/or ad ID. A merchant can paste an existing tagged landing URL, generate a matching URL, and check its tags.
- Identifies arrivals from `utm_source`, optional `utm_medium`, campaign name (`utm_campaign`) or ID (`utm_id` / `campaign_id`), and `ad_id` (falling back to `utm_content`). Existing creative tags are preserved by the link builder. A click ID such as `fbclid` is not an ad ID and is not used to select a campaign.
- Records matching new sessions across storefront pages: page views, clickable elements, search/filter actions without entered values, active time, scroll depth, successful add/remove-cart events, checkout start, and completed purchase.
- Shows summary metrics, 10 sessions per page, and an on-demand timeline with 30 events per page. Includes an authenticated per-journey JSON export resource; the embedded UI download integration is corrected locally, pending deployment and authenticated retesting.
- Integrates pause/resume/complete, existing snapshot allowances, uninstall handling, store deletion, and Shopify customer privacy requests.

## Deliberate boundaries

- This is a same-browser session journey, not lifetime customer identification, cross-device attribution, a video replay, or a guarantee that every browser event is delivered.
- A session expires after 30 minutes of inactivity. Another campaign/ad arrival starts a separate acquisition; commerce requires the exact acquisition and browser IDs, not the latest session on that browser.
- One Customer Snapshot can collect at a time per store in this version. Paused captures can resume only if no other Customer Snapshot is active.
- Captures last 1–90 days. Admission stops at the session target while already admitted journeys can finish within the capture window. Completing a snapshot stops unfinished journeys. Pausing stops new page/click collection; existing checkout outcomes may still arrive within their session/capture window.
- Customer Snapshots consume the existing Page/Channel snapshot allowance. Plan visitor limits also cap admitted sessions.
- New collection depends on Shopify analytics consent, the theme app embed, and the Web Pixel. No historical journeys are backfilled.
- Query strings, fragments, account/checkout/order paths, typed form contents, and email-looking labels are excluded from journey events. Private paths are represented as `/private-page`; search/filter actions do not store entered values. Campaign tags must not contain personal data.
- Each journey caps ordinary interaction events at 5,000; the browser queue caps at 200. The UI labels timelines partial when a known cap is hit. Commerce events are retained separately from that interaction cap. Abrupt tab closure, blocked scripts, and network failures can still cause unobservable gaps.
- Pixel and paid-order webhook purchase records deduplicate by order ID. Failed customer pixel writes retry in isolation, without replaying existing Page/Store/Channel/A-B writers. Paid-order attribution is additive/best-effort so its failure cannot force replay of legacy conversion selection.
- Human summary denominators include Real + Zombie sessions, excluding Bot/Pending; journey lists still show all captured classifications.

## Main implementation locations

- `app/utils/customer-journey.ts`: URL matching, input sanitization, event normalization.
- `app/utils/customer-journey.server.ts`: capture lifecycle, event persistence/deduplication, summaries, pagination, exports.
- `app/routes/app.customer-snapshots*`: authenticated screens and resource routes.
- `app/routes/api.track.tsx`: journey batches and isolated commerce retries.
- `extensions/tracking-embed/assets/tracker.js`: consent-aware interaction journal and acquisition metadata.
- `extensions/tracking-pixel/src/index.js`: successful Shopify commerce events with stable event/order IDs.
- `prisma/migrations/20260916000000_add_customer_journeys/migration.sql`: four new tables, tenant/report indexes, one-active-capture constraint, privacy notification enum.

## Local verification

- Final automated result: **138 passing checks** (12 real-database tests, 81 journey/channel/attribution/isolation tests, and 45 shared performance/background/pixel-setup tests), plus the desktop/mobile browser checks below.
- New additive migration applied successfully on disposable PostgreSQL at loopback, seeded with the existing enum types. Real database tests cover source matching, tenant isolation, concurrent admission, duplicates, cap behavior, session/window boundaries, early commerce, export, and privacy deletion cascades.
- Tracker/pixel tests exercise consent withdrawal, private-path handling, two ads/tabs, exact commerce attribution, and safe retry isolation. Existing channel and paid-order attribution regressions also pass.
- Production build passes. Targeted ESLint passes. Repository-wide TypeScript still fails in existing unrelated components/routes/preview files; it reports no errors in the new Customer Snapshot files or modified tracking/billing/webhook files.
- Actual React route components were rendered with **synthetic local data**, then checked in headless Chrome at 1440px and 390px. Checks cover form validation, tagged-link import/checking, creation navigation, 10-row pagination, lazy timeline pagination, pause/resume, no browser exceptions, and no horizontal viewport overflow. Screenshots were visually reviewed.
- These local checks alone were not authenticated Shopify acceptance or live tracking proof. Subsequent production release and development-store acceptance are documented in the release receipt above.
- Attempting the repository's entire historical migration chain on an empty database hits the pre-existing `20260526000000_add_homepage_audit` dependency on a missing `ResourceType` enum. This was not repaired or bypassed on a shared database. The new additive migration was validated independently.

Commands:

```sh
# Only against an explicitly disposable, migrated loopback database:
JOURNEY_TEST_DATABASE_URL='postgresql://journey_test@127.0.0.1:55439/journey_migration' node --test scripts/check-customer-journeys.mjs

node --test scripts/channel-attribution.test.mjs scripts/check-channel-snapshots.mjs scripts/check-paid-order-channel-isolation.mjs scripts/check-customer-tracking-isolation.mjs
node --test scripts/check-background-transport.mjs scripts/check-performance-regressions.mjs scripts/check-web-pixel-setup.mjs
npm run build

# Synthetic UI fixture; no Shopify credentials, orders, or merchant data:
node scripts/preview-customer-journeys.mjs
node scripts/check-customer-journey-ui.mjs
```

## Release sequence — completed under the subsequent deployment approval

1. Inspect the exact target database and migration history, and take the normal backup. Apply the additive Customer Snapshot migration **before deploying the new server**: billing now queries `CustomerSnapshot` on existing app pages too. Do not reset or replay existing migrations.
2. Generate Prisma and stage the Vercel application build; verify auth boundaries, migration compatibility, route assets, and logs before promoting.
3. Release both Shopify tracking extensions (theme embed and Web Pixel). This is not a server-only release. Keep the existing live app configuration/scopes; no additional scopes are introduced by this implementation.
4. Verify the live theme app embed and installed pixel. Test in the development store first. “Check link tags” verifies URL matching only; it does not prove the live extensions are installed or that consented events arrived.
5. Confirm a real consented journey and purchase path before claiming full acceptance. Do not manufacture sessions or orders in a merchant's production data without authorization.

Rollback: retain the additive tables and captured data. Revert the application and extensions to their known-good versions; do not drop the new tables as an automatic rollback step. The previous server may safely ignore the additive schema.

## Acceptance checklist

1. Start a Customer Snapshot with source `facebook`, campaign `snapshot_test`, and an exact ad ID. Put its generated URL in a test ad/destination or open that URL in a fresh test browser session.
2. With analytics consent denied, confirm no journey collection. Grant consent; navigate collection → product → another page, click a link, search/filter, and return. Refresh the report and verify one ordered journey with source/ad and page engagement.
3. Add/remove an item, start checkout, and complete an authorized test order. Verify cart/checkout/purchase events and one converted session; replay/delivery from pixel plus webhook must not double-count the purchase.
4. Repeat with the wrong source/ad: it must not enter this capture. Open two differently tagged ads in separate tabs and verify one tab cannot take the other tab's acquisition.
5. Exercise pagination, pause/resume, session target, complete, and 30-minute expiry. Existing timelines remain readable; completed captures cannot restart.
6. Open a timeline and export it. Attempt another store's snapshot/session identifier: no data should be returned. Check Shopify privacy request notifications/exports and deletion using a test shop/order fixture, not merchant data.
7. Confirm existing Page, Store, Channel, A/B reports and checkout attribution still work. Check server errors and mobile layout.

Privacy workflow reference: [Shopify mandatory privacy webhooks](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance). Matching customer data requests notify the merchant with authenticated journey export links; the implementation does not send a customer email automatically.
