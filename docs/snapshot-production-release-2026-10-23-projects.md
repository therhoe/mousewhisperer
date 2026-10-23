# Snapshot Projects release — 23 October 2026

## Released

- Production: https://mousewhisperer.vercel.app
- Deployment: `dpl_FdPkHUGNougQDFT2RYnMsAjPtmCz`
- Immutable deployment: https://mousewhisperer-mu13pdazp-therhoe.vercel.app
- Vercel project: `therhoe/mousewhisperer`, `prj_Egn686nw4vCMpn0XY3Btoiac8Xdw`.
- Staged with `vercel deploy --prod --skip-domain --yes --scope therhoe`; hosted build reached Ready, migration and staged checks passed, then explicit `vercel promote` succeeded.
- Fresh inspection of the main production domain resolved to the new deployment. Six public production bundles exactly matched the validated local build.
- Working-tree release from main at `a37f96d`; no commit, push, reset or unrelated source changes. Existing uncommitted implementation files remain intact.

## Included

- Projects replace separate snapshot navigation, with Store/Page scope, a goal, repeat measurements and A/B tests inside Projects. The quick-create A/B shortcut remains.
- Project creation selects exactly one completion rule: duration or visitor target. Source/medium/campaign set initial report filters rather than limiting new measurement collection. Journey tracking is available for Store-level Projects.
- Dashboard growth overview includes Traffic, Conversion Rate, AOV and observed customer value, alongside recent Projects. Unavailable Shopify metrics are not fabricated.
- All/Active audience and acquisition-source report filters, with explicit historical measurement definitions.
- English, German, Simplified Chinese and Traditional Chinese for the new Project workflow and shared/A-B interfaces. Unrelated legacy pages are not fully translated by this release.
- Completion-boundary/journey admission fixes and authenticated embedded-filter navigation fix validated during isolated development-store QA.
- No Shopify extension, access-scope or app-configuration publication was necessary. The active Shopify version remains `snapshot-customers-20260917`; storefront tracker bytes are unchanged.

## Backup and migration

Fresh production variables were pulled from the verified Vercel project into a private directory outside the repository. The app origin, client ID and database identity were validated without exposing credentials. The default repository `.env` is production-shared and was not used for disposable QA.

Private release recovery/evidence directory:
`/Users/nobrainer/.snapshot-release-backups/2026-10-23-projects.LaXYVy`

- Pre-migration PostgreSQL public-schema/data custom archive: `pre-projects-public.dump`, 20,968,895 bytes, 259 archive entries.
- Archive SHA-256: `96900ea0dc827d07ccdef2ed230e0001eec2665a53352bbb76a37f47e7b836d3`.
- Both archive listing and full decompression passed. This validates archive readability; it is not a separate full recovery rehearsal.
- Exact release source saved privately as `validated-runtime-source.tar.gz`.
- Additive migration `20261022000000_growth_projects` applied successfully before main-domain promotion.
- All 17 successful migration checksums match the repository, no pending or unresolved failed migrations; Prisma schema diff reports **No difference detected**.
- Final runtime fingerprint: 212 files, SHA-256 `bd62161491cc7b6769c8c286cff4b6b9052902b897c292a02b7b8ea518400f06`, unchanged through cutover. Sorted relative path/NUL/file bytes/NUL hashing; paths retained privately in `runtime-fingerprint.json`.

## Existing production data preserved

Before/after production checks ran in read-only transactions, including an independent configuration and ownership audit after cutover.

| Existing record type | Preserved |
| --- | ---: |
| Page resources | 16 |
| Page snapshots | 40 |
| Store snapshots | 10 |
| Channel snapshots | 6 |
| Customer snapshots | 5 |
| A/B tests | 14 |
| A/B variants | 28 |

The migration produced 51 Projects and 61 linked measurements. There were zero missing original IDs, unmapped captures/tests, incorrect Project scope/resource owners or cross-store links. A/B targets and variants, capture settings, statuses and completion rules were unchanged. Stable configuration SHA-256 remained `5f80c8791dace33a4e905f9d3e89cc5469f22df7c5aba230d9a3c5adc76de2e5`.

Existing Page/Store measurements retain their old session semantics. Existing Customer source/medium/campaign constraints remain unchanged; the new collect-all/report-filter behavior is not retroactively imposed. No legacy data was deleted or reconstructed.

## Runtime verification

- Hosted production build passed. Prior local build, scoped lint, four-locale dictionary coverage, 44 relevant embedded-filter/Project/A-B regressions and isolated database/browser QA are recorded in `projects-implementation-2026-10-22.md`.
- Both staged and public production root returned HTTP 200 with Snapshot branding.
- Unauthenticated `/app`, `/app/projects`, `/api/growth-report`, `/api/growth-metrics` and `/api/project-journeys` returned the expected Shopify authentication boundary (410), not a server error.
- Unsigned `POST /webhooks/orders/paid` returned 401; no order was inserted by this rejection check.
- Exact bundle matches: dashboard, Project list/detail, app shell, A/B detail and i18n.
- Bounded deployment error-log and 5xx-log queries returned no matching entries during release checks. This is not a guarantee against future errors.
- Authenticated Safari smoke used **shep-dev connected to the production host**, not the isolated tunnel: the growth dashboard and imported Projects list rendered; Orange Snowboard opened with its preserved Setup baseline measurement; All → Active loaded correctly; Measurements showed the original paused status and 25-visitor target. Returned Safari to Dashboard afterward.
- No new production capture, A/B test, checkout or order was created during this release smoke. Existing merchant-store purchase behavior was not re-exercised. Earlier synthetic checkout/webhook/journey acceptance was on the isolated development runtime and is documented separately.
- Native Safari screenshot output was a reduced/distorted window capture, so screenshot pixel fidelity is not counted as release proof. The signed-in content and navigation check used fresh accessibility state, with sensitive URL query data redacted in private evidence.

## Development preview cleanup

- Stopped the exact Snapshot development CLI, Vite child and cloudflared processes used for isolated QA.
- `shopify app dev clean --store shep-dev.myshopify.com` restored this app's active version on that dev store. Other apps' previews were untouched.
- Read this app's existing shep-dev web pixel, restored its `apiEndpoint` from the temporary tunnel to `https://mousewhisperer.vercel.app/api/track?shop=shep-dev.myshopify.com`, preserved unrelated settings and verified the readback.
- Isolated QA database/files retained for investigation. Previous QA captures were completed and the QA A/B test paused.

## Rollback and remaining caveats

Previous live deployment: `dpl_4SQxRGFHfq63fCZkaLzYkTCSqtfF`, https://mousewhisperer-rkf25p44f-therhoe.vercel.app.

If necessary, re-promote that deployment for a code rollback. **Keep the additive schema and all capture data**; do not drop Project tables or restore the old database over new traffic. The private backup is a recovery artifact, not an automatic rollback action. If old code creates captures during rollback, reconcile their Project mappings before a later re-promotion.

Existing whole-project TypeScript errors outside the new modules and dependency/Node-engine/Polaris/optional-module build warnings remain. Hosted install reported 128 npm audit findings (5 low, 25 moderate, 91 high, 7 critical) in the unchanged dependency tree; this release is not a dependency-security clearance. No automatic dependency upgrade or credential rotation was performed.

Merchant spot-check: refresh Snapshot, open an existing imported Project and its measurement history, check All/Active and source filters, then check the A/B shortcut and language selector. Starting a new measurement creates a real capture and consumes the corresponding allowance.
