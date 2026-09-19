# Engagement outcomes and QA fixes — 17 September 2026

## Status

Released to production: `dpl_HSVTLXsnaSwXd1poVaYZkEGkah6q`, immutable URL `https://mousewhisperer-nou0fjxn4-therhoe.vercel.app`. Staged with `--prod --skip-domain`, checked, then explicitly promoted with `vercel promote`. No migration or Shopify extension/configuration publication was performed.

## Scope

- Optional Show outcomes in Page Snapshot Engagement by Zone and each isolated A/B variant snapshot: unique clicked sessions, successful cart sessions, purchased sessions, per-element percentages and parallel bars on one shared count scale. Default click view retained; groups paginate five rows; images scroll horizontally.
- All four fixes in `snapshot-qa-fixes-2026-09-17.md`: authenticated journey export; honest password-store tracking status; mutually exclusive Store quality; visit-time-based eligibility for long-running Store checkout/purchase attribution.
- No historical data backfill, migration, scope change or new Shopify extension release. Shopify `snapshot-customers-20260917` remains active, independently checked before staging. Theme tracker SHA-256 remains `b58043750ad21e1933aca8239d232d220d695016c11e2b39647f124933dcb6e4`.
- Existing dirty work preserved. Working-tree deployment, no commit/push. Base `35a240bd85cb0f45dcfac060cfdd6b38871d14d1`.

## Verification before deployment

- 184 database-free regression checks passed; targeted runtime ESLint passed; production build and `git diff --check` passed.
- Existing repository-wide TypeScript failures remain (Prisma groupBy typing, PremiumGate, Store route and preview files). No diagnostics in the new outcome utility/component or the A/B service/report; Page route diagnostics are in pre-existing aggregate code.
- Actual shared component tested in the in-app browser using synthetic data: on/off toggle, pagination, correct 32 clicks / 24 sessions / 8 carts (33.3%) / 3 purchases (12.5%), image cards. At 390px viewport, page and document widths both 390px; image strip alone scrolls. Temporary viewport reset.
- Chrome extension was unavailable during this pass. Local browser evidence is not live Shopify acceptance. Prior local export download/retry tests are documented separately in the QA fix report.

## Hosted and real-data verification

- Hosted Vercel build passed. Staged root: HTTP 200 with Snapshot branding; unauthenticated embedded route: expected 410 authentication boundary; unsigned orders-paid webhook: 401. No authentication bypass was added.
- Staged JavaScript was byte-identical to the final local build: `EngagementOutcomes-YQjZTqEM.js`, SHA-256 `0fd46d695960e341ea2fd4eb306c316fc1a24fc250c316698aabf8c12dc25100`; Page route `app.project._id-GUu4XISf.js`, SHA-256 `564ca8dc8a830c8508cf19725f68766108a56363e67f48872720aa7be3cb8f79`.
- After promotion, the public production root returned HTTP 200 with Snapshot branding; the public outcome asset matched that same SHA-256. `vercel inspect mousewhisperer.vercel.app` resolved to the new Ready deployment.
- Before promotion, a bounded deployment error-log query returned no matching logs. This is not a guarantee of absence of future errors.
- Production database check ran inside a PostgreSQL **read-only transaction**, restricted to retained `shep-dev.myshopify.com` QA captures. Gift Card snapshot 5 supplied 10 human visit rows; the new outcome builder produced three Button elements with valid cohort bounds. Existing click-bearing cohorts had cart outcomes but no purchases; no other session's purchase was borrowed to inflate them.
- Retained completed Customer capture `cmu4rfmbx003ol504tzs88xtl` still has 2 sessions, 2 carts and 1 purchase. Existing Store capture `cmrcc37sx001iqlyyre4josgb` produces an exclusive 2-session classification (1 Real, 1 Zombie). This is a read-only calculation, not proof the deployed UI cache has already refreshed.
- Existing Customer migration remains applied. No database data was rewritten. Temporary production environment file and read-only helper were removed from their private temporary directory after the check.
- Native Chrome fallback could locate/reload the retained Shopify tab but did not expose reliable rendered page content. **Live Shopify toggle/export acceptance and a new long-running-capture checkout are not verified in this pass.** No new test order or capture was created.
- Existing build warnings remain: Polaris CSS minification, optional dependency resolution and npm audit findings. No broad dependency upgrades were made in this scoped release.

Runtime fingerprint: 175 files, SHA-256 `42d152d6ad85fe9c3828a02f5c6e2fd0bcf8464944b242a1c6480f627462c1bc`. Sorted relative paths plus NUL, file bytes plus NUL, over app/extensions/prisma/public (excluding node_modules, dist, _dev), and package.json/package-lock.json/vite.config.ts/tsconfig.json/shopify.app.toml/shopify.web.toml/vercel.json/.vercelignore/Dockerfile. Docs/scripts are outside this runtime fingerprint.

## Release targets and rollback

- Vercel project `therhoe/mousewhisperer`, ID `prj_Egn686nw4vCMpn0XY3Btoiac8Xdw`.
- Production domain `https://mousewhisperer.vercel.app`.
- Previous deployment `dpl_2dfKTaBHTv9GBHGLVfPzaeo4eoYe`, `https://mousewhisperer-3nk4w8c4t-therhoe.vercel.app`.
- Rollback, if authorized, can re-promote that previous application deployment without changing Shopify extensions or removing database data.

## Interpretation

Outcomes are associated with the same recorded session within the report, not proof they followed or were caused by a click. Purchases need not have recorded cart events. Element cohorts overlap and must not be summed as unique store customers. Old missed purchases are not automatically backfilled.
