# Projects implementation — 22 October 2026

## Delivery boundary

This is a local implementation and verification record, not a deployment record.
No hosted database migration, Shopify release, or production deployment was performed.
Authenticated development-store acceptance was resumed on 23 October. The published-product, checkout/purchase, and completion-boundary checks now pass as recorded below. This does not authorize a release or establish production acceptance.

### Development-store verification status

This section records the 22 October checkpoint. Its pending browser checks are superseded by the 23 October acceptance section below; historical evidence and limitations are retained rather than rewritten.

On 22 October, the Shopify development preview was started for `shep-dev.myshopify.com` with both database variables explicitly pointing to the isolated loopback database below. The CLI confirmed the preview ready and its app-home/app-proxy URLs point to the temporary tunnel. No production release was made, and `shopify.app.toml` was not changed.

The earlier Chrome-controlled run stopped at a blank embedded page and a paused document response. The user subsequently confirmed the Projects dashboard was visible and requested Safari for further testing. That browser-access blocker is resolved; it is retained here as test history, not as an outstanding application defect.

Authenticated Safari QA on `shep-dev.myshopify.com` verified:

- Store Project creation with a three-visitor completion target, journey tracking enabled, and initial report filters `facebook` / `paid_social` / `projects_qa`. Local database readback confirmed those defaults did not restrict collection: the store capture accepted both Direct and Facebook arrivals, and its journey companion captured all sources.
- Page Project creation with a one-day duration, no visitor target, and journey tracking disabled. The stored deadline is exactly 24 hours after its start. The selected Green Snowboard URL subsequently returned a storefront 404, so this does **not** establish successful published-product page targeting. A publication guard was then added: Safari showed no selectable Green Snowboard result, while the published Liquid product was selectable and a fresh page Project with a three-visitor target was created. Collection acceptance on that replacement page remains pending.
- The A/B quick-create shortcut created an empty Project with zero measurements and no additional captures, then saved an exact-path A/B test. The test received one local assignment/visit at `/products/green-snowboard` and is now paused. Because that target returned 404, published-product A/B behavior remains unverified.
- English, German, Simplified Chinese, and Traditional Chinese locale selections persisted in the authenticated app.
- The growth overview received real ShopifyQL results: seven sessions and a 14.29% conversion rate. AOV and observed LTV were unavailable/null because the Online Store sales query returned zero orders; no artificial zero sales values were substituted.
- Actual storefront collection reached the isolated local database: four page visits across two acquisition sessions. The Direct acquisition visited `/`; the Facebook acquisition retained its original source, medium, and campaign while visiting `/products/green-snowboard`, `/collections/all`, and `/products/the-collection-snowboard-liquid`.
- One Liquid product add-to-cart was reflected in the store visit and its journey, with exactly one `add_to_cart` journey event. There were no checkout or purchase outcomes at this check. The two journeys contained four pages and 12 events in total.
- The unfiltered All report showed two sessions and one add-to-cart (50%). Active with the Facebook filter showed zero sessions; clearing source filters while keeping Active showed one Direct session; switching back to All restored both sessions. Readback classified the Direct session as `REAL` and the Facebook session as `ZOMBIE`, consistent with those cohorts.

QA record identifiers (isolated development database only):

| Record | ID |
| --- | --- |
| Store Project | `growth_30e2d1e2c059e9a66055e7d2f126e2ae` |
| Store measurement | `growth_9daa9e8c7dadee17007297c734852ede` |
| Store capture | `growth_9daa9e8c7dadee17007297c734852ede_store` |
| Journey companion | `growth_9daa9e8c7dadee17007297c734852ede_journey` |
| Page Project | `growth_9b73671124816f665cbacf1efd2bb17b` |
| Page measurement | `growth_202c8b40fa06586d234b73485ad025c4` |
| Page capture | `growth_202c8b40fa06586d234b73485ad025c4_page` |
| A/B shortcut Project | `growth_7c8011614dc132fda0b99a4b6a5aadf5` |
| Paused A/B test | `cmvjuuci00004qlq52yrv4wss` |
| Published Liquid page Project | `growth_bf4c4429737604a79bdc3405685d567e` |
| Paused Liquid page capture | `growth_903a717f592aa560cb01781ede838199_page` |
| Paused Liquid A/B test | `cmvjve3xp003fqlq53c4s24yb` |

The replacement A/B test was saved and launched for the exact Liquid product path using an existing variant template; no external theme template was created or changed. It had no new collection evidence before browser testing was interrupted. A narrowly scoped cleanup in the isolated development database paused both QA A/B tests and both QA page captures; the store capture and journey companion are completed. No QA records were deleted, and no production state was changed.

The production bundle and 63 focused checks passed for the initial Safari QA revision; build output is `/tmp/snapshot-projects-build-safari-20261022.txt`. After the publication guard, the build passed (`/tmp/snapshot-projects-build-final-20261022.txt`), along with 69 frontend checks and 497 locale checks. The earlier landing-copy revision also passed its bundle build, 87 focused checks, and seven branding checks. Full development-store QA is **not complete**: the fresh published-product Page/A/B collection and exact targeting, a Safari retest of the completion-boundary correction below, and browser checkout/purchase remain pending. The additive migration is unchanged, and production remains untouched. There has been no commit, push, production database migration, or production deployment for this change.

### Completion-boundary regression found and corrected locally

A subsequent real Safari arrival tagged `google` / `cpc` / `projects_qa_second` reached the three-human-acquisition target. Read-only local verification showed five store page visits across exactly three acquisitions, with the store and journey captures both completed at `2026-10-22T18:20:47.826Z`. However, only the Direct and Facebook journey sessions existed: the engagement request closed the companion before the independent Google journey batch arrived. The later Contact navigation was not admitted after completion. This was a real QA defect, not a passing journey-completion result. The original QA rows were preserved without a corrective data backfill.

The local backend correction now:

- Admits each new parent-recorded page to its journey companion inside the same store-first transaction, before completion. It copies only actual recorded acquisition/page/classification data and creates no synthetic journey events.
- Serializes active Project journey admission with the parent and requires its matching admitted page. An early batch remains unacknowledged for the existing tracker queue to retry; once a capture closes, excluded acquisitions are acknowledged and discarded rather than retried indefinitely. Early successful commerce is retained in provisional zero-page sessions, hidden from the Project journey list until parent admission.
- Accepts delayed actual events only for the exact admitted shop, acquisition, browser, and page, with event timestamps at or before the completion/deadline cutoff and within the existing 30-minute delivery window. It does not reopen collection, add post-cutoff pages, extend engagement metrics, or admit extra acquisitions. The effective duration deadline works even before a management expiry sweep runs.
- Preserves immutable acquisition campaign attribution, fills an absent ad ID only from an actual matching batch, and synchronizes page classification from recorded evidence before completion. Default `PENDING` values do not override actual `BOT` or `REAL` evidence.

Final sequential checks on the isolated actual-schema rehearsal database passed: the expanded Growth Projects PostgreSQL suite; all 12 legacy customer-journey tests; and the real-SQL reporting suite. Coverage includes six simultaneous arrivals capped at three, the final admitted journey, an actual journey transaction blocked on the parent lock during completion, inclusive cutoff timestamps, delayed duration batches before and after expiry, new-acquisition/page and tenant rejection, quick commerce before a heartbeat, tracker acknowledgement/queue retention, and `PENDING` → `REAL` / `BOT` transitions. Scoped ESLint for the changed backend, journey API, and regression script reported no errors or warnings. Independent source review found no remaining completion-boundary blocker. These are local regression results, not a successful Safari retest of the corrected behavior.

The final frozen-source bundle build passed; output is `/tmp/snapshot-projects-build-final-checkpoint-20261022.txt`. The combined frontend regression run passed all 74 tests, including five new transport tests executing the actual tracking route and storefront journey queue. They verify retry after rejected batches, acknowledgement-only removal, preservation of new in-flight events, failure/beacon retention, and intentional clearing on consent withdrawal. Localization checks passed for four locales, 497 translated messages, and 387 UI keys. `git diff --check` passed. Browser actions remain paused pending uninterrupted Safari access; no final browser completion, published-product A/B collection, or purchase acceptance is claimed.

```sh
GROWTH_TEST_DATABASE_URL='postgresql://growth_test@127.0.0.1:55442/growth_projects_deployed_schema_20261022' node scripts/check-growth-projects-db.mjs
JOURNEY_TEST_DATABASE_URL='postgresql://growth_test@127.0.0.1:55442/growth_projects_deployed_schema_20261022' node --test scripts/check-customer-journeys.mjs
GROWTH_TEST_DATABASE_URL='postgresql://growth_test@127.0.0.1:55442/growth_projects_deployed_schema_20261022' node scripts/check-growth-reports.mjs
```

## QA environment recovery — 23 October 2026

The previous temporary PostgreSQL directory and running preview were no longer available. A fresh isolated cluster was created at `/Users/nobrainer/.codex/tmp/snapshot-projects-qa-20261023.umKBwP/data`, bound to `127.0.0.1:55442`. The empty `growth_projects_dev_preview` database was initialized from the current Prisma schema; all 17 repository migrations were then recorded as applied solely to align this disposable fixture's history with that schema. Migration status is up to date and schema comparison reports no differences. This is **not** another migration execution rehearsal and does not replace the actual-deployed-schema rehearsal documented below. No remote records or authentication tokens were copied; the restored fixture has zero Projects and zero Shopify sessions.

Initially, native control still exposed a small tilted background window and did not reliably navigate to the intended development tab. The user then freed Safari, resolving foreground access for the test below.

Initial preview startup attempts failed with a QUIC timeout, including a retry setting only `TUNNEL_TRANSPORT_PROTOCOL=http2`. Both failed CLI processes exited. An explicit HTTP/2, IPv4 cloudflared process pointing to `http://localhost:61443` then succeeded; the Shopify CLI was restarted with the supported custom tunnel URL. The proxy listens on IPv6 loopback, so `localhost`, not `127.0.0.1`, was required for that hop. The final development endpoint was `https://translation-returns-pty-trial.trycloudflare.com`. The generated dev manifest's app URL, app proxy, and order webhook, plus a read-only Web Pixel settings query, all confirmed this endpoint. Both actual CLI and Vite child environments were checked for the isolated database overrides and test billing. No production configuration was changed. Earlier failed-start logs remain in the recovery directory.

### Real Safari acceptance — 23 October 2026

Fresh Shopify authentication populated the isolated runtime; no existing production tokens or merchant rows were imported. Two new QA Projects were created through the embedded UI:

- Store Project `growth_9bd580b62940ff6c612d8fd408f44f52`, measurement `growth_94832cf74edf733de412e43cdd86ad0f`, target three human acquisition sessions, journey tracking on, initial source filter `facebook`.
- Page Project `growth_4a1b3c4e9872dcaa6978c7cb3346bf42`, measurement `growth_5326c683d2644975caf6b4b365c3b8c4`, target three human acquisition sessions, published Liquid product, no journey companion.
- A/B test `cmvl3rbru0003qlp6b8esshdq` belongs to the Page Project, targeting exactly `/products/the-collection-snowboard-liquid`, 50/50, conversion goal. It uses the default product template and an existing variant template; no theme template was created or published.

Verified through Safari interaction and read-only local database/report-service checks:

- The published Liquid product rendered and assigned this browser to Variant B. Assignment remained stable across repeat views and campaign arrivals. One browser is one A/B assignment; three acquisitions are three measurement sessions. This is not a two-browser A/B allocation test or evidence of statistical lift.
- A tagged Facebook arrival recorded add-to-cart and checkout-start, then completed one simulated purchase using the store's already-active **Test Payment Gateway**, dummy card `1`, and synthetic contact details. No real payment was made. Pixel and `orders/paid` webhook delivery produced exactly one journey conversion event and one A/B conversion, with raw revenue USD 749.95. The UI rounds the displayed revenue to $750.
- Post-checkout Home and Contact visits stayed in the original Facebook journey. Page capture and A/B visits remained restricted to the exact Liquid product path; off-target pages did not leak into them.
- Google and Bing tagged arrivals were collected despite the Store Project's saved Facebook default filter. At the third acquisition, the store capture and companion both completed at `2026-10-23T15:13:50.695Z`, with exactly three journeys. The final Bing page and its real pre-cutoff events were retained. The Page capture completed at `2026-10-23T15:13:50.509Z`.
- A fourth LinkedIn-tagged arrival was excluded from both completed measurements and the companion. Final Store totals: three sessions, seven page views; final Page totals: three sessions, five target-page views. Journey page counts were Facebook four, Google two, Bing one.
- Actual report services returned All: 1 conversion / 3 sessions = 33.33%; Facebook: 1/1 = 100%; Google: 0/1; Active: 0/1. Google was classified `REAL`; Facebook and Bing `ZOMBIE`. Active consistently excludes the latter, including the low-engagement purchase session; commerce alone does not override the existing engagement classification. This is a metric-definition caveat, not a hidden discrepancy.
- The embedded Page Project displayed the three-source results and 33.33% CVR, then Active displayed only Google with zero outcomes. Store Project initially displayed Facebook alone with its purchase and four-page journey. A/B detail and Variant B snapshot displayed one assignment, one add-to-cart, one purchase, and matching revenue; Control A remained empty as expected for this single-browser run.
- The temporary A/B test was paused through its UI after collection. Both measurements and the journey capture are completed. QA records and the simulated order were retained; no production data was changed.

Screenshots are retained in `/Users/nobrainer/.codex/tmp/snapshot-projects-qa-20261023.umKBwP/`: `test-order-confirmed.png`, `ab-test-order-report.png`, and `converted-journey.png`. The journey UI displayed the real sequence of product view, cart click, add-to-cart, checkout start, one purchase, Home, and Contact.

An intermittent embedded login redirect was observed when applying A/B filters after leaving the report idle during checkout. A top-level reload restored the session and immediate filtering passed. Follow-up navigation-context hardening and its verification are recorded separately; the purchase/cutoff evidence above is unaffected.

### Filter-navigation hardening

GET filter submissions replaced the launch query, and an internally navigated A/B detail could already have no `shop` or `host`. The authenticated app layout now supplies public embedded context derived from `session.shop`; A/B and Project filters use that retained parent data even on a query-free route. Only `shop`, `host`, `embedded`, and `locale` are carried over. Expired `id_token`, signatures, timestamps, and launch session values are not copied. Every loader still authenticates normally; this is navigation recovery, not an authentication bypass. Automatic bearer loss during the original idle failure was not directly proven.

After the change, the production bundle compiled successfully. The final combined run passed all 44 checks across embedded context, Projects, A/B, journey transport, published products, growth metrics, and chart rendering. Scoped ESLint and `git diff --check` passed; four-locale checks verified 497 translated messages and 387 UI keys. Existing build warnings about Polaris CSS/import attributes and mixed dynamic/static imports remain non-fatal.

A Safari top-level reload followed by internal navigation to a query-free Page Project and applying Facebook returned the expected one session/one conversion without a login redirect. The A/B report was then reached through the Project's test list, again with no launch query. After a short background-tab idle interval (roughly two minutes), applying its filters succeeded: the report remained visible with one session, no login page, correct shop/host/embedded context, and no reused `id_token`. A native-control interruption required a fresh UI-state read and retry of that click. This is a successful bounded idle-navigation retest, not proof of every long-idle or network-expiry condition.

## Product structure

- Dashboard: one growth overview (Traffic, Conversion rate, AOV, observed LTV), followed by recent Projects.
- Projects are ongoing containers for a goal, store/page scope, measurements, A/B tests, and explicitly logged optimizations.
- A measurement ends by duration **or** a visitor target, never both. The default target is 100 human acquisition sessions, not page views or unique people.
- Source, medium, and campaign are saved initial **report** filters. They do not restrict new data collection or A/B enrollment.
- Journey capture is available only for store-level Projects. It retains the existing extra capture allowance and is stopped with its parent measurement.
- A/B tests are created within Projects. The dashboard shortcut can select an existing Project or create an empty Project before configuring a test.
- New page-targeted tests use an exact storefront path. Existing template-wide tests retain their targeting.
- All includes every recorded session; Active includes engaged `REAL` sessions only, excluding bot, zombie, and unclassified sessions. Rates and outcomes use the same selected cohort.

## Data compatibility

`20261022000000_growth_projects` is additive. It creates the Project/measurement/activity layer and links existing capture records without changing their IDs or deleting history. Explicit same-shop snapshot links determine ownership of existing A/B tests; otherwise a dedicated Project is created. Backfill is replay-safe.

New page/store measurements persist acquisition IDs and immutable arrival source metadata. Multiple arrivals in the same browser are separate sessions. Historical records retain their original identifiers and attribution limits; the new UI discloses this rather than reconstructing unavailable history.

Native Project summaries, source breakdowns, engagement outcomes, and journey lists share report filters. Legacy detail URLs remain accessible and explicitly retain their old reporting definitions. Large engagement payloads are not silently sampled: the view asks for narrower filters while summary totals still include the entire cohort.

Project-linked legacy reports cannot be individually deleted through the old UI. Shop redaction removes Project links before capture records, tenant-scoped and transactionally; uninstall pauses capture while preserving history.

## Metrics and localization

The homepage fetches Shopify analytics after the navigation shell loads. It does not block the homepage loader on ShopifyQL or source enumeration. Missing sales metrics show unavailable state, not invented zero values.

LTV uses Shopify's `amount_spent_per_customer`: observed all-time spend for the customers in the selected result cohort, not predicted lifetime value. The UI explains that distinction. AOV uses `average_order_value` for Online Store sales. Definitions: [Shopify sales schema](https://shopify.dev/docs/api/shopifyql/latest/schemas/sales_revenue/sales).

English, German, Simplified Chinese, and Traditional Chinese cover the new Project workflow, shared engagement view, and A/B interface. Merchant-entered titles, goals, source names, and campaigns remain unchanged. Locale selection is persisted per shop; number/date formatting and Polaris controls follow the selected locale. Unrelated legacy reports, billing, and community pages are not fully translated by this change.

## Verification and release checks

Local checks cover:

- Creation validation, exactly one completion rule, request idempotency, quota handling, repeat measurements, and same-shop ownership.
- A/B exact-path assignment, Project linkage, immutable arrival attribution, shared report filters, and quick-create navigation.
- Real PostgreSQL fixtures for backfill/replay, acquisitions versus browser IDs, All/Active denominators, UTC dates, journeys, privacy cleanup, and tenant isolation.
- Four-locale dictionary coverage and real-component browser fixtures with simulated data. These are UI checks, not evidence of authenticated Shopify integration.
- Existing onboarding, graph, performance, background transport, A/B, and engagement regression scripts.
- Production bundle compilation and scoped lint/type-error review.

Four-locale desktop screens and the 390px mobile overflow correction were visually checked. Final responsive chart visual QA passed on October 22, 2026 using the local simulated-data fixture (`localhost:4190`), not Shopify store data. German, Simplified Chinese, and Traditional Chinese were inspected in a 390px-wide viewport: the SVG rendered at 358×270px with a matching viewBox and readable 11px axis/12px date labels. Desktop English was inspected at 918×270px. Evidence: `/tmp/snapshot-projects-i18n-kqrnZ3/de-mobile-chart-final.png`, `/tmp/snapshot-projects-i18n-kqrnZ3/zh-CN-mobile-chart-final.png`, `/tmp/snapshot-projects-i18n-kqrnZ3/zh-TW-mobile-chart-final.png`, and `/tmp/snapshot-projects-i18n-kqrnZ3/en-desktop-chart-final.png`. The isolated QA tab and fixture server were closed afterward; no Shopify or database writes were made. This verifies rendering and readability, not live analytics collection or data accuracy.

Representative commands (the database command requires a disposable loopback PostgreSQL fixture, never production):

```sh
npm run build
node scripts/check-growth-projects.mjs
node scripts/check-growth-metrics.mjs
node scripts/check-i18n.mjs
node --test scripts/check-growth-chart.mjs scripts/check-projects-ui.mjs scripts/check-project-ab-tests.mjs
GROWTH_TEST_DATABASE_URL='postgresql://growth_test@127.0.0.1:55442/growth_projects_schema_test' node scripts/check-growth-projects-db.mjs
GROWTH_TEST_DATABASE_URL='postgresql://growth_test@127.0.0.1:55442/growth_projects_schema_test' node scripts/check-growth-reports.mjs
```

The temporary PostgreSQL fixture server was stopped after the initial checks, then restarted for the actual-schema rehearsal and authenticated development-store QA below. It is bound only to `127.0.0.1:55442`; its files are retained at `/tmp/growth-projects-pg.pPESC7/data`.

The repository has existing whole-project TypeScript errors outside the new Project modules; those are not hidden or treated as a passing global type check. The existing pinned dependency tree also reports npm audit findings; dependency upgrades were not part of this implementation.

The historical migration chain cannot bootstrap an entirely empty database because an earlier migration references `ResourceType` before it exists. Initial verification used a prior-HEAD schema fixture; the subsequent actual-deployed-schema rehearsal below also passed. Do not rewrite the production migration history to mask the separate empty-database bootstrap issue.

## Actual deployed-schema migration rehearsal — 22 October 2026

Remote access was read-only: the metadata query ran in `BEGIN READ ONLY` and confirmed `transaction_read_only = on`. The connected PostgreSQL 17.6 database contained 32 public tables, no `GrowthProject` table, and a migration ledger whose latest successful entry was `20260916000000_add_customer_journeys`. All 16 successful historical migration checksums matched the repository. A rolled-back historical attempt was not copied as an applied migration.

Only the public schema and successful migration-ledger metadata were copied. No merchant capture rows, customer data, Shopify sessions, access tokens, or billing rows were imported. The schema-only dump is `/tmp/growth-projects-pg.pPESC7/deployed-public-schema-20261022.sql` (67,854 bytes). The destination is the isolated local PostgreSQL 17.7 cluster, not a hosted staging or production database.

Two distinct local databases were restored from that schema:

- `growth_projects_deployed_schema_20261022`: migration rehearsal, seeded only with synthetic legacy records for two fictitious shops.
- `growth_projects_dev_preview`: clean development runtime database; initially empty application tables, including `Session`. It can obtain fresh development-store sessions through Shopify's normal authentication flow.

Normal `prisma migrate deploy` applied only `20261022000000_growth_projects` to each database and recorded its successful migration-ledger entry. A repeated deploy against `growth_projects_dev_preview` reported **No pending migrations to apply**. No migration was applied to a shared remote database.

The rehearsal verified:

- Six Projects and six measurements were backfilled from the synthetic legacy fixtures; the two page captures for one page remained together in one ongoing Project.
- All original fixture rows remained: two legacy page Projects, three page Snapshots, one Store Snapshot, one Channel Snapshot, one Customer Snapshot, and three A/B tests.
- Same-shop A/B source links were preserved. A synthetic A/B source pointer belonging to a different shop received its own same-shop Project; there were zero cross-tenant Project owners.
- Replaying the migration SQL did not change any fixture row. The before/after fingerprint across legacy and new Project tables was `22d5013cad3fc46cd995163351f594d172d6e00b0f637e5182d6435a25a3812d`.
- The full backend PostgreSQL regression and real-SQL reporting regression passed on the actual-schema clone, covering lifecycle, idempotency, tracker gating, acquisition-based targets, concurrent admission, heartbeat recount avoidance, commerce, journeys, privacy cleanup, report filters, ownership, and UTC dates.
- `prisma migrate diff` from the migrated actual-schema clone to `prisma/schema.prisma` returned **This is an empty migration**. The output is retained at `/tmp/growth-projects-pg.pPESC7/deployed-schema-diff-20261022.sql`.

Exact regression commands for this rehearsal:

```sh
GROWTH_TEST_DATABASE_URL='postgresql://growth_test@127.0.0.1:55442/growth_projects_deployed_schema_20261022' node scripts/check-growth-projects-db.mjs
GROWTH_TEST_DATABASE_URL='postgresql://growth_test@127.0.0.1:55442/growth_projects_deployed_schema_20261022' node scripts/check-growth-reports.mjs
```

## Development runtime database safety

Local `.env` database endpoint, user, and database fingerprints match the cached `.vercel/.env.production.local` configuration associated with `mousewhisperer.vercel.app`. Therefore, the default local environment must be treated as production-shared, not safe staging. Vercel lists separate Preview database variables, but their underlying database identity was not verified; their existence alone does not establish isolation.

`shopify.web.toml` runs `scripts/prisma-migrate-deploy.sh` before starting Remix. Every development CLI process and inherited child must explicitly override **both** database variables with the isolated target:

```sh
export DATABASE_URL='postgresql://growth_test@127.0.0.1:55442/growth_projects_dev_preview'
export DIRECT_URL='postgresql://growth_test@127.0.0.1:55442/growth_projects_dev_preview'
```

These values identify a local disposable database, not hosted credentials. The replacement cluster remains running with the QA captures completed and the QA A/B test paused. The schema rehearsal is complete. Fresh development-store authentication and the scoped creation, collection, attribution, metrics, locale, filtering, published-product targeting, completion-boundary, and simulated checkout/purchase checks above passed against an isolated runtime; no merchant rows or credentials were imported from the schema source. This does not establish production behavior, multi-browser A/B distribution, or statistical significance.

Before production: obtain explicit deployment/migration authorization, take the normal database backup, apply the additive migration before serving the new code, and complete the development-store acceptance checks. The actual-deployed-schema rehearsal above satisfies the schema compatibility gate, not production deployment or live-data correctness. A code rollback must retain the additive tables and historical capture data; do not drop them as a rollback shortcut.

## Production release — 23 October 2026

The user subsequently authorized deployment. The backed-up additive migration and staged web release passed, then production was promoted and checked in authenticated Safari. All 61 legacy captures and 14 A/B tests were preserved and mapped without changing their configuration/status. See `snapshot-production-release-2026-10-23-projects.md` for deployment identity, backup, post-cutover audit, runtime checks, preview cleanup and rollback instructions. Earlier statements above about production being untouched describe the pre-release QA phase.
