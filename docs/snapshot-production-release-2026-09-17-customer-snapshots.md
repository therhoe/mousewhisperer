# Customer Snapshots — production release, 17 September 2026

## Release status

Released to the existing Snapshot production app. The additive migration, Vercel application, theme embed, and Web Pixel are live. Authenticated acceptance in `shep-dev.myshopify.com` recorded a real browser journey through a **simulated Shopify test-gateway order**, not a real-money purchase.

Existing unrelated working-tree changes were preserved. This was a working-tree deployment, not a clean-commit release; no commit or push was made. Git base: `35a240bd85cb0f45dcfac060cfdd6b38871d14d1`.

**Post-release deeper QA:** [17 September QA report](customer-snapshots-qa-2026-09-17.md) records 169 passing automated checks, a successful simulated gift-card purchase, and live two-ad-tab isolation. It also identifies a Customer Snapshot export UI defect and three pre-existing Store Snapshot reporting defects. They were subsequently [fixed and tested](snapshot-qa-fixes-2026-09-17.md), then [deployed with Engagement outcomes](snapshot-production-release-2026-09-17-engagement-outcomes.md). This receipt describes the original customer release; the linked receipt identifies its replacement runtime and acceptance limits.

## Exact release targets

| Component | Released version |
| --- | --- |
| Vercel project | `therhoe/mousewhisperer` / `prj_Egn686nw4vCMpn0XY3Btoiac8Xdw` |
| Production domain | `https://mousewhisperer.vercel.app` |
| Promoted deployment | `dpl_2dfKTaBHTv9GBHGLVfPzaeo4eoYe` |
| Immutable deployment | `https://mousewhisperer-3nk4w8c4t-therhoe.vercel.app` |
| Shopify application | Snapshot / client ID `be249e7dc1288f980804d0bf5e40cde0` |
| Shopify release | `snapshot-customers-20260917` |
| Shopify version ID | `gid://shopify/Version/1131903090689` |
| Migration | `20260916000000_add_customer_journeys` |
| Migration completed | `2026-09-16T23:27:05.632Z` |

Shopify release: <https://dev.shopify.com/dashboard/129538921/apps/307730874369/versions/1131903090689>.

No new access scopes were introduced. Existing app configuration was retained.

## Database safety

- Verified the Vercel production environment points to the expected Supabase PostgreSQL database and the expected app URL/client ID. Environment values and credentials are not included here.
- Reconciled all 15 previously applied migration checksums, including the historical rolled-back/reapplied migration entry. Only the Customer Snapshots migration was pending.
- Took and validated a custom-format public-schema backup before migration (14,409,756 bytes). It includes production data and credentials and must remain private.
- Durable backup: `/Users/nobrainer/.snapshot-release-backups/2026-09-17/pre-customer-public.dump`; directory permissions `0700`, backup `0600`, outside the repository/deployment tree.
- Applied the additive migration before promoting the application. No reset, migration replay, or table deletion was used. Four new tables were initially empty.

## Release verification

- Reran 126 database-free journey/channel/isolation/background/performance/pixel checks: all passed. The earlier implementation verification additionally passed 12 isolated PostgreSQL checks and desktop/mobile actual-component fixture checks; these are separate from live acceptance.
- Local production build, hosted Vercel build, and Shopify extension build passed. `git diff --check` passed.
- Staged Vercel with `--prod --skip-domain`; checked the deployment using authenticated `vercel curl`, then explicitly promoted it. Vercel SSO responses were not counted as application success.
- Production root returned 200 with Snapshot branding. Unauthenticated embedded app route returned the expected Shopify 410 boundary; unsigned orders-paid webhook returned 401.
- Authenticated app navigation, Customer Snapshots creation/detail routes, lazy journey timeline, and conversion summary loaded successfully in Chrome.
- Confirmed Shopify version active and the dev store's existing enabled theme embed (`test-data`, theme `132337467486`). No theme settings or other apps' development previews were changed.
- The dev storefront loaded the new versioned tracker CDN asset. It is byte-identical to the local tracker, SHA-256 `b58043750ad21e1933aca8239d232d220d695016c11e2b39647f124933dcb6e4`.
- The deployed Customer Snapshot index asset was byte-identical to the local build, SHA-256 `b86e39852f2ffc499ce3746791c1ed9844bb49ccfb32f35e4e4627bd150a15b3`.
- Bounded post-release Vercel error-level and HTTP 5xx queries returned no matching logs. This is a bounded check, not a guarantee of zero future errors.

Runtime fingerprint: 173 files; SHA-256 `22c13f485e1ef4d97cbad026cf9f5bb1e3e0bb6a466f970f808c9874598da8c4`. Covers sorted paths/content under app, extensions, prisma, public (excluding dependency/dist trees), plus build/package/Shopify/Vercel configuration. Documentation changes after deployment do not alter this fingerprint.

## Authenticated development-store acceptance

Created through the production app UI, against the confirmed **development store only**:

- Capture: `Release QA · Customer journey · 2026-09-17`
- Capture ID: `cmu4qh3hy0004ji04u6pefrjg`
- Journey ID: `cmu4qhjs8000iji0470spvx3x`
- Source `facebook`, medium `paid_social`, campaign `snapshot_release_20260917`, ad `qa_20260917`.
- One-day window, five-session target. This consumes one dev-store snapshot allowance; the labelled capture/data are retained for review.

Actual observed sequence: tagged collection arrival → changed sort order → clicked product → add to cart → subsequent product → add to cart → checkout → test-gateway order confirmation. The same journey retained its source/campaign/ad throughout internal navigation.

UI and read-only database verification agreed: **one human session, five pages, 22 events, one session added to cart, one started checkout, one purchased**. Timeline includes active time/scroll, page views, link clicks, filter change, successful cart events, checkout, and purchase. No checkout contact/address/card contents appeared in the journey.

- Test order ID: `7279713189982`; confirmation `MY78EZE5E`.
- Recorded purchase: `2026-09-16T23:38:18.000Z`, USD 949.95, using Shopify's **Test Payment Gateway**, test number `1`, synthetic contact/address details. No real payment, fulfilment, or merchant-store order was performed.
- Purchase event key: `order:7279713189982`; one purchase event was observed. This proves the end-to-end outcome, not independent delivery of both pixel and webhook paths; retry/deduplication coverage also exists in automated tests.
- Pause and resume were verified through live controls. A subsequent arrival using `ad_id=qa_wrong_ad` and another page navigation did not enter the capture or alter the recorded journey: the database still showed one session, five pages, 22 events, and one purchase event. The QA capture was then completed through the UI to stop further collection; results were retained.

An earlier Gift Card checkout attempt returned to the storefront homepage with an empty cart. The root cause was not established. A subsequent normal generated product completed checkout successfully. The later deeper QA pass separately completed a simulated gift-card purchase; the earlier redirect did not reproduce and should not be described as fixed.

## Boundaries and remaining coverage

- This release verifies the primary live dev-store flow, not every merchant theme/browser or every privacy/consent scenario in production. Consent withdrawal, multi-tab isolation, caps, pagination, expiry, and privacy deletion are covered by automated/local tests; destructive privacy tests were not run against merchant data.
- Existing repository-wide TypeScript failures outside the Customer Snapshots changes remain; the release build passes. Existing dependency/security follow-ups were not silently changed by this deployment.
- Customer Snapshots is same-browser session tracking, not lifetime identity, cross-device attribution, or video replay. Consent/script blocking and interrupted delivery can create gaps.

## Rollback

Coordinate both application and Shopify extension rollback if needed; do not automatically remove the additive schema or captured journeys.

- Previous Vercel: `dpl_2iaRYYrmW84uq3d4AeQqFHwxwd9y` / `https://mousewhisperer-guasvjbu0-therhoe.vercel.app`.
- Previous Shopify: `snapshot-20260826` / version `1104534700033`.
- Re-promote the previous Vercel deployment and release the previous Shopify version only under explicit rollback authority. Preserve this release's database tables/data and the private backup.
