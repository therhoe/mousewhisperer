# Customer Snapshots — deeper QA, 17 September 2026

## Outcome

**Subsequent fix pass:** all four findings below are now corrected and tested locally; they have not been redeployed. See [the fix receipt](snapshot-qa-fixes-2026-09-17.md). The findings and production observations below describe the earlier deployed version.

**Primary tracking passed, but full acceptance is not clean.** The broader QA pass found one Customer Snapshot export UI defect and three pre-existing Store Snapshot reporting defects. Fix and retest these before treating the feature/reporting stack as fully accepted.

This pass made no runtime code changes, deployment, scope changes, or production migration. It preserved the existing dirty working tree. The production targets remain Vercel `dpl_2dfKTaBHTv9GBHGLVfPzaeo4eoYe` and Shopify `snapshot-customers-20260917`. Release details and rollback targets are in [the release receipt](snapshot-production-release-2026-09-17-customer-snapshots.md).

## Automated checks — 169 passed

- **157 database-free checks** passed. Coverage includes attribution/source matching, actual tracker execution in a harness, consent withdrawal and queue clearing, URL privacy filtering, separate ad tabs, inactivity expiry, storage failures, isolated retries, channel/paid-order isolation, A/B report isolation, graph/report structure, background transport, performance guards, branding, and pixel setup. Some tests use mocks or source assertions; these are not all browser acceptance tests.
- **12 PostgreSQL tests** passed against a new disposable loopback-only database. Coverage includes tenant isolation, exact campaign/ad matching, concurrent target admission, duplicate events, lifecycle/window bounds, early cart events, pagination, authenticated-export data selection, privacy cascades, event caps, and the one-active-capture constraint.
- Only the additive Customer Snapshots migration was applied to that disposable database, with prerequisite existing enum types seeded. The shared/production database was not migrated or seeded during QA. The disposable PostgreSQL server was stopped afterward.
- `git diff --check` passed. A bounded Vercel error-level log query for the latest 30 minutes returned no matching logs; this is not a guarantee of zero errors.

Commands used:

```sh
node --test scripts/channel-attribution.test.mjs scripts/check-ab-test-detail-report.mjs scripts/check-ab-test-activity.mjs scripts/check-background-transport.mjs scripts/check-category-performance.mjs scripts/check-channel-overview.mjs scripts/check-channel-snapshots.mjs scripts/check-customer-tracking-isolation.mjs scripts/check-dashboard-graph.mjs scripts/check-paid-order-channel-isolation.mjs scripts/check-performance-regressions.mjs scripts/check-snapshot-branding.mjs scripts/check-web-pixel-setup.mjs

# Newly created disposable database only; server stopped after the tests.
JOURNEY_TEST_DATABASE_URL=postgresql://journey_test@127.0.0.1:55441/journey_deep_qa node --test scripts/check-customer-journeys.mjs
```

## Authenticated development-store checks

Used the deployed production app with **development store `shep-dev.myshopify.com` only**. No real-money purchase, merchant-store order, fulfilment, live ad, theme change, or payment-setting change was made.

- Capture: `Deep QA · Customer journeys · 2026-09-17`
- Capture ID: `cmu4rfmbx003ol504tzs88xtl`
- Source `facebook`, medium `paid_social`, campaign `snapshot_deep_qa_20260917`; campaign-only matching admits separately tagged ads `deep_a` and `deep_b`.
- One-day window, six-session target. This consumes one additional dev-store snapshot allowance. The labelled data and simulated order are retained for review.
- Completed through the UI at **2026-09-17T00:12:48.337Z**. UI and read-only database verification confirm `COMPLETED`; collection is stopped.
- [Open the retained QA capture](https://admin.shopify.com/store/shep-dev/apps/mousewhisperer/app/customer-snapshots/cmu4rfmbx003ol504tzs88xtl).

### Separate tabs and purchase attribution

Opened `deep_a` on the gift-card page and `deep_b` on a generated regular-product page in separate Chrome tabs. After opening B, completed A's commerce flow. A retained its acquisition; B did not inherit A's cart, checkout, or purchase flags.

1. A added a USD 10 gift card and reached checkout.
2. A deliberately declined simulated payment through Shopify's **Test Payment Gateway**. The error was visible and database checks showed no conversion.
3. A retried with the gateway's approved test number and reached order confirmation. No real payment was made.
4. B later added and removed its own regular product. The cart was visibly empty afterward and its timeline includes `cart_removed`.
5. B navigated internally, returned, and reloaded. The capture still contained two distinct journeys with the correct ad IDs.

Final persisted results:

| Journey | Ad | Pages / events | Cart | Checkout | Purchase |
| --- | --- | --- | --- | --- | --- |
| `cmu4rg0sv003bji04m0dg75a5` | `deep_a` | 1 / 7 | Yes | Yes | Yes |
| `cmu4rggdq003kji0407raqts3` | `deep_b` | 3 / 11 | Yes | No | No |

Both classified Real. Report and database agree: **2 human sessions, 2 added to cart, 1 checkout, 1 purchase, 50% conversion**. One purchase event was observed for order **`7279733637214`**, confirmation **`JIR67HI45`**, USD 10, recorded at `2026-09-16T23:59:35.059Z`. This verifies the combined end-to-end outcome, not independent delivery of both pixel and webhook transports.

Checks of these journeys found none of the synthetic checkout contact/address/expiry values and no raw private checkout/account/order paths in event fields. This is a scoped sample check, not exhaustive security certification.

The earlier gift-card redirect problem **did not reproduce**: this gift-card checkout succeeded. Its original cause remains unknown; no fix was made or proven for that earlier attempt.

### Existing reports

- A/B list and detail loaded. Switching Control A / Variant B showed distinct existing data; the count/percentage toggle worked. Existing tests were not edited, paused, or completed.
- Channel Snapshot overview/history loaded. There was no active Channel Snapshot, so simultaneous new Channel collection was not verified live in this pass; automated isolation coverage passed.
- Product/Page Snapshot reporting showed the gift-card purchase: active snapshot 5 had 7/10 sessions, 14.3% CVR and USD 10 revenue. This is positive live evidence of Page and Customer purchase collection coexisting.
- Store Snapshot pages loaded, but the reporting issues below prevent a clean cross-feature acceptance result.

### Mobile layout and pagination

Inspected the actual Customer Snapshot React components through the existing localhost fixture with **synthetic data**, in Chrome at **390 × 844**. Summary cards wrapped cleanly; document width matched the viewport; table scrolling stayed contained. The session list paginated at 10 rows. A 35-event journey showed 30 then 5 events, with Next disabled on the final page. The modal footer and pagination were visually usable. The viewport override was reset and temporary test tabs were closed.

This was responsive-browser fixture QA, not a physical iPhone/Safari test or authenticated mobile-Shopify acceptance.

## Confirmed issues — not fixed in this QA pass

### 1. Customer Snapshot export navigates to a blank app page

**New feature defect; medium priority.** In the authenticated app, opening the purchased journey and clicking **Export journey** reproducibly navigates the embedded app to the export route and clears the report body. No download event was observed during a 12-second observation window on the second attempt. The expected `customer-journey.json` was not present in the normal Downloads location checked.

- UI source: `app/routes/app.customer-snapshots.$id.tsx:477–482`.
- Resource route: `app/routes/app.customer-snapshots.$id_.journey.$sessionId.export.tsx`.
- The rendered anchor had a relative `href`, no `target`, and no `download` attribute, despite the action specifying `external: true`.
- Installed Shopify AppProvider uses `RemixPolarisLink`, which wraps the Remix client-side Link. This supports the diagnosis that the resource route is being treated as app navigation. The exact browser/network download path still needs a focused fix/retest; the observed blank-page failure is confirmed.

**Recommended fix:** use an authenticated download path that does not turn the resource route into SPA navigation; preserve the report and show actionable download errors. Test the real embedded flow, not only the export data function or fixture link.

### 2. Store tracking status falsely says Not active on a password-protected store

**Pre-existing defect; medium priority.** The dev store records live events and has an enabled embed, but Store Snapshot screens show tracking as Not active. The public server check receives HTTP 200 after redirecting to `/password`, does not find tracker strings there, and labels the embed missing.

- Source: `app/utils/storefront-tracker-status.server.ts:52–59` and `:85–117`.
- Read-only fetch confirmed final URL `https://shep-dev.myshopify.com/password`, password-page content, and no tracker marker.
- Relevant logic also exists in the base commit, rather than being introduced by Customer Snapshots.

**Recommended fix:** distinguish password/challenge pages from verified storefront pages and report Not verified when the embed cannot be assessed; use an appropriate authenticated embed-status signal where available.

### 3. Store visitor quality counts overlap

**Pre-existing analytics defect; high priority.** The active July Store Snapshot displayed two total visitors, one Real (50%), and two Zombies (100%). Read-only data checks confirmed the same session can have a Real page and a Zombie page and is counted in both classes.

- Store Snapshot: `cmrcc37sx001iqlyyre4josgb`.
- Source: `app/utils/store-snapshot.server.ts:727–737`.
- The code filters page visits by classification first and then counts distinct session IDs independently in each category. The relevant logic is also present in the base commit.

**Recommended fix:** aggregate each visitor/session into one well-defined quality classification before calculating mutually exclusive counts/percentages; add a regression with mixed-quality pages in one session.

### 4. Store Snapshots older than 30 days miss fresh purchases

**Pre-existing analytics defect; high priority.** The July Store Snapshot remains active and collected fresh QA visits, but shows zero purchases/revenue while Customer Snapshots and the Gift Card Page Snapshot recorded the USD 10 test purchase. Matching recent Store Snapshot visit rows remained unconverted.

- The active capture began `2026-07-08T17:10:32.769Z`.
- Source: `attributeStoreSnapshotOrder`, `app/utils/store-snapshot.server.ts:566–579`.
- Its query requires the **snapshot's start date** to fall within 30 days before the order, excluding long-running active captures even when their visits are new. Both existing purchase paths use this function. The same guard is present in the base commit.

**Recommended fix:** define attribution eligibility using visit timing and the capture lifecycle, not merely capture creation age. Add active-long-running and completed-window regression cases. Historical repair, if desired, needs its own scoped plan; do not silently rewrite merchant reporting data.

## Acceptance boundaries and cleanup

- Live consent withdrawal UI was not exercised on this theme; consent transitions, expiry, caps, destructive privacy operations, and cross-tenant guards were tested in harnesses/disposable PostgreSQL instead. Do not claim those were all proven in live Chrome.
- No physical-device, cross-browser, every-merchant-theme, load-test, or dependency-security clearance was established. Existing unrelated TypeScript/dependency follow-ups remain.
- The QA capture is completed and retained; no pre-existing captures were changed. Test order/results are preserved, and no refunds/deletions were performed.
- Disposable PostgreSQL was stopped. The temporary production environment copy was removed after verification; the existing private pre-release backup remains untouched.
- No fixes or redeployment were made during this pass. Next recommended work is the four fixes above, regression coverage, and authenticated retesting before the next feature.
