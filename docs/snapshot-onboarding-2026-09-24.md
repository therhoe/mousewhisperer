# Snapshot setup guide — 24 September 2026

## Implemented locally / available in the development preview

- Compact V3 setup card at the top of the dashboard; tracker first, readiness badge, explanation tooltip, collapse control, and one primary **Start snapshots** action.
- Theme-editor deep link uses the app client ID and `tracker` block handle. Shopify activates the preview; the merchant must save. Clicking the link alone never completes the step.
- Activation checks run after rendering and on return/focus. App Bridge is preferred; a read-only published-theme settings check supports older clients. Starting snapshots verifies the saved theme again server-side.
- Store, Channel, or Customer snapshot plus a selected Page snapshot are created atomically. Product/Collection use Shopify's resource picker; Page/Blog use the existing resource endpoint; Homepage is built in.
- Customer selection accepts a tagged campaign link, imports allowlisted attribution values, verifies the store domain, strips arbitrary URL parameters, and runs until its target or seven days.
- Plan limits count both snapshots. Existing active snapshots are not silently reused. Retries use tenant-scoped deterministic IDs; errors preserve the form. Successful creation hides the guide on the next visit; the header setup icon restores it.
- No schema migration, new scopes, production deployment, or production data edits.

## Research

- [Theme app extension deep links](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration): `context=apps&activateAppId={client_id}/tracker`; merchant Save required.
- [App Bridge extension status](https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/app-api): published-theme activation, with no additional scopes.
- Saved theme block UUID differs from the CLI local `uid`. Verified published UUID: `019b7bbb-e14f-701e-9c00-6be4ba8c522a`.

## Verified

- `npm run build` passed (existing Polaris CSS minification warning).
- Scoped ESLint passed. Full repository TypeScript still reports existing errors outside the changed files; no errors matched the setup files or dashboard.
- `node scripts/check-snapshot-setup.mjs`: deep links, tracker states, trusted resource resolution, campaign validation, all three creation paths, allowances, replay protection, pixel failure, active conflicts, transaction rollback.
- `node scripts/check-performance-regressions.mjs`: 15/15 pass; the dashboard shell still makes no blocking Shopify analytics requests.
- `node scripts/check-dashboard-graph.mjs`: passed.
- `npx dotenv -- node scripts/check-snapshot-setup.mjs --dev-store`: read-only acceptance on **shep-dev**, confirmed a development store, tracker enabled in published `test-data` theme, and real Product/Collection/Page/Blog lookup using the app's January 2026 API version.
- Isolated real-component browser fixture: compact desktop layout, 390px layout without horizontal overflow, picker/3-of-3 readiness, customer fields, success links, preserved form on quota error, tracker-off disabled CTA, collapse. This fixture simulates Shopify responses; it creates no snapshots.

## Authenticated Chrome acceptance — completed after merchant sign-in

- Loaded the real embedded dashboard in **shep-dev**, expanded the guide, and confirmed tracker status changed to Enabled.
- Clicked the theme-editor link. Shopify opened active theme `test-data` (`132337467486`), filtered to Snapshot, expanded Snapshot Tracker, and showed it enabled. Save was disabled because this store already had the embed saved. We did not disable it to manufacture a test; off-to-on Save remains unexercised in this already-enabled store.
- The first real creation attempt exposed Prisma `P2010`: `pg_advisory_xact_lock` returns PostgreSQL `void`, which `$queryRaw` cannot deserialize. Fixed to `$executeRaw`. The failed request created no pair, preserved form selections, and left usage at 12/50. Added a real PostgreSQL lock smoke check to `--dev-store`.
- Created Channel + Green Snowboard snapshots, each target 25. The success card appeared and usage became 14/50.
- Found that ordinary anchor success links lost embedded navigation and reached login. Replaced them with Remix `Link` navigation; updated the isolated fixture.
- Created Customer + Orange Snowboard snapshots, each target 25, using `utm_source=onboarding_qa&utm_campaign=2026-09-24`. Usage became 16/50. The repaired success link opened the Customer report without another login. Its source, campaign, 25-session target and seven-day end date were correct.
- Opened both Page reports and the Channel report; targets were 25, status was Active, and analytics loaded normally.
- Paused all four new QA captures through the app after verification; records are retained, not deleted. Existing active captures were not paused or edited.
- Build, scoped ESLint, setup checks, real dev-store API/lock checks, dashboard graph and performance regressions passed again after fixes.

Retained QA pair IDs:

| Pair | Snapshot ID (shared across its two model tables) | Page project |
| --- | --- | --- |
| Channel + Green Snowboard | `setup_6581b5fc023a5b4baf930e86a579ef6b` | `cmug3snqx000pql8o0f2xj51h` |
| Customer + Orange Snowboard | `setup_795cdea02e51a66b5d81152fc8aa976b` | `cmug3vnsa000rql8oacqg5r3g` |

Store-pair creation is covered by automated tests, not newly exercised in the merchant browser because the store already has a running Store snapshot. No production deployment occurred.

Development CLI was started with `npx shopify app dev --store shep-dev.myshopify.com`. Its preview is scoped to shep-dev and temporarily routes that store's app/proxy to the local tunnel while running. Restart the CLI if the tunnel expires. The CLI reported taking over the store's previous development preview; it did not publish a production app version.

Local fixture: `node scripts/preview-snapshot-setup.mjs` at `http://127.0.0.1:4188` (simulated only).

## Setup polish — 25 September 2026

- Info, exit and collapse controls use centered SVG icons. Expand/collapse rotates the same chevron; all three centers were measured equal in the embedded Chrome preview.
- Removed the tracker status badge, visible checking text and manual check-again action. The task checkmark remains the status indicator. Verification runs quietly when shown and when returning from the theme editor, not on collapse/expand; saved theme verification on Start remains unchanged.
- Open theme editor is now a primary black button-link, without an underline, opening the same deep link in a new tab.
- Exit setup hides the whole card and persists the existing shop-scoped preference. The checklist icon immediately left of usage restores it. Hiding keeps the component mounted so same-page form selections survive. Failed preference writes report an error and roll back the optimistic visibility change.
- Fixed duplicate sibling React keys between setup and the conversion panel, discovered during live acceptance. Each now has its own shop-scoped key; repeated updates show exactly one guide.
- Authenticated shep-dev Chrome checks: enabled checkmark, silent collapse/expand, primary button styling, exit/restore, preserved Channel/150-session selections, hide surviving reload, restore surviving reload, and restore icon aligned with usage. Isolated tracker-off fixture keeps Start disabled even with the other two steps filled.
- Added real-component server-render checks and tenant-scoped dismiss/restore/cache-invalidation/error regression coverage. No new snapshots, schema changes, scopes, theme saves, or production release were made for this polish.

## Default targets — 25 September 2026

- Setup sessions/visitors now both default to **100**, still capped by a lower plan limit. This changes new setup forms only; existing snapshots and other creation forms are unchanged.
- Regression tests render both input defaults at 100, and both at 50 when the plan cap is 50. A fresh authenticated shep-dev dashboard load showed Sessions 100 and Visitors 100, with the tracker checkmark enabled.
- Production release evidence is recorded separately in `snapshot-production-release-2026-09-25-onboarding.md`.
