# Dashboard and Channel Snapshots release

## Behavior

- Dashboard: Clean graph hides activity overlays, not the current/previous Shopify CVR lines or the activity lists. The rate explanation appears below the plot and legends. Dashboard content has 48px bottom padding.
- Navigation: Store Snapshots, Channel Snapshots, Page Snapshots, and A/B Tests, plus Dashboard. Page Snapshots retains Products, Collections, Homepage, Pages, and Blogs as tabs. Old audit-category URLs redirect; existing resource requests and actions remain compatible.
- Channel Snapshots are independent store-wide captures. One may run per shop, alongside existing Store/Page Snapshots and A/B Tests. Pause/resume/complete, human-session targets, total-session targets, and calendar-duration windows are supported.
- The Channel index shows an after-paint performance graph above history: human sessions by channel or human-session CVR, using the active/latest capture only. The tracking banner is removed, and attribution notes are collapsed below history. See [performance and naming refresh](snapshot-performance-refresh.md) for definitions, query reductions, and verification boundaries.
- New acquisition identity is separate from the existing seven-day tracking identity. Internal navigation preserves the arrival channel; changed external/campaign arrivals or 30 minutes of inactivity start a new acquisition. An unrecoverable arrival is Unknown, not assumed Direct.
- Real and Zombie sessions count as human. Channel CVR is converted human sessions divided by human sessions, not order count and not Shopify Analytics CVR. Repeated callbacks do not count a journey twice. Late checkout callbacks may update an already-captured session after completion.
- Paid-order failure isolation: Channel attribution is best-effort if its own handler fails. The webhook logs only the error name, continues existing Store/Page/A/B attribution, and acknowledges the delivery if that existing work succeeds. A Channel-only failure does not request a Shopify retry because replaying the legacy visit-selection writers is not order-idempotent. That Channel conversion can be missed unless the independent pixel callback succeeds; this is not guaranteed recovery. Existing authentication and legacy-writer failures keep their existing failure responses.
- Source reports group by channel/source/medium/campaign. Filters compose, pagination is ten rows, and quality/conversion cells default to counts with optional adjacent percentages. The detail table omits the Pending column and places Add to cart and Conversions before the engagement averages so those outcomes remain visible sooner.
- Channel and Page Snapshots share the existing audit-snapshot allowance. Subscription prices and Store Snapshot/A/B Test entitlements are unchanged.
- Completed Channel Snapshots appear under Measurements in the dashboard activity tabs, not as implemented optimizations.

## Local checks

```sh
node scripts/check-dashboard-graph.mjs
node scripts/channel-attribution.test.mjs
node scripts/check-channel-snapshots.mjs
node scripts/check-channel-snapshot-ui.mjs
node scripts/check-channel-overview.mjs
node scripts/check-web-pixel-setup.mjs
node --test scripts/check-paid-order-channel-isolation.mjs
node --test scripts/check-performance-regressions.mjs scripts/check-category-performance.mjs scripts/check-ab-test-activity.mjs scripts/check-background-transport.mjs scripts/check-snapshot-branding.mjs
npx prisma validate
npm run build
git diff --check
```

The standalone local QA server uses actual UI components with synthetic loaders and actions. It never connects to Shopify or the database:

```sh
node scripts/preview-snapshot-changes.mjs
```

Open `http://127.0.0.1:4181`. Check desktop/mobile layout, Clean graph, marker focus/click/keyboard dismissal, activity tabs, channel filtering, percentage toggles, pagination, and lifecycle controls. This is not authenticated merchant-store or real checkout proof.

The repository has pre-existing full-project TypeScript errors. Compare diagnostics against HEAD before attributing them to this release; do not treat a successful production build as a clean full-project typecheck.

## Release order (requires production release approval)

1. Confirm the intended database and run `npx prisma migrate status`. The connected workspace database reported all 15 migrations applied on August 26; that does not prove a different deployment target is ready. If `20260826000000_add_channel_snapshots` is pending on the release target, take the normal database backup/recovery precautions and apply it using `npx prisma migrate deploy`. It atomically adds three tables, an enum, foreign keys, and indexes; no existing snapshot rows are rewritten. The partial unique index enforces one active Channel Snapshot per shop.
2. Deploy the application server only after the migration succeeds. Billing and activity loaders query the new tables immediately.
3. Deploy the Shopify app configuration and extensions: the display name is now Snapshot, and both the theme tracker and web pixel changed. A server-only release does not update the published name or storefront tracking assets. Existing installation IDs, callback URLs, tracking keys, and paid-plan identities are intentionally unchanged.
4. No additional Shopify access scopes are introduced. Starting a Channel Snapshot verifies this app's web pixel, updating its existing endpoint with the explicit shop context when necessary. Setup failure blocks the new capture with a retryable error instead of silently missing checkout data.
5. Verify on an authorized development store: channel-only capture, external landing to internal page navigation, a second tab/source, repeated heartbeats, add-to-cart, checkout start, completed checkout plus paid-order webhook retry, pause/resume, and final completion. Confirm active Store/Page Snapshots and A/B Tests still collect independently. Verify the store's consent behavior with the actual storefront setup.
6. Verify native embedded navigation and its selected state in Shopify Admin; local component QA cannot prove App Bridge behavior.

## Recovery

If rollout must be reversed, redeploy the prior application and extension versions. Leave the additive tables intact to preserve captured data; do not drop tables or reset the database. Investigate migration or setup failures before retrying. Never insert synthetic QA sessions into a merchant store.
