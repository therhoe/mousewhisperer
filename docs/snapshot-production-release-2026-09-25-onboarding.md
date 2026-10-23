# Snapshot onboarding release — 25 September 2026

## Release

- Production: https://mousewhisperer.vercel.app
- Deployment: `dpl_4SQxRGFHfq63fCZkaLzYkTCSqtfF`
- Immutable URL: https://mousewhisperer-rkf25p44f-therhoe.vercel.app
- Vercel project: `therhoe/mousewhisperer` / `prj_Egn686nw4vCMpn0XY3Btoiac8Xdw`.
- Staged using `vercel deploy --prod --skip-domain --yes --scope therhoe`; verified before explicit `vercel promote` succeeded.

## Included

- Compact three-step onboarding: enable the saved theme tracker, choose a Store/Channel/Customer capture, and select a Page capture. Atomic paired creation, plan limits, tenant-scoped retries and trusted Shopify resource validation.
- Aligned SVG header controls, matching expand/collapse chevron, quiet tracker verification, checkmark-only tracker status, primary black theme-editor button.
- Exit setup and header restore icon with saved visibility and preserved same-page selections. Unique React keys prevent duplicated setup cards during dashboard updates.
- Both setup targets default to **100**, respecting lower plan limits. Existing captures and unrelated creation defaults are unchanged.
- No schema migration, scope change, Shopify extension/configuration publication, production data backfill, or new production test capture.
- Working-tree release; no commit, push, reset or unrelated worktree changes.

## Verification

- Setup regression checks passed, including actual-component server rendering, both 100 defaults, lower-cap defaults, creation validation, all three pair types, quota checks, retry safety and rollback.
- Performance/dashboard regressions: 16/16 passed. Dashboard graph checks, scoped ESLint, build and `git diff --check` passed.
- Authenticated Chrome development-store acceptance is documented in `snapshot-onboarding-2026-09-24.md`. Fresh load in this release specifically verified Sessions **100**, Visitors **100**, and an enabled tracker checkmark. No captures were created during this release test.
- Staged deployment was Ready. Its immutable hostname requires Vercel SSO; checks used authenticated `vercel curl`, without disabling protection. Root returned HTTP 200 with Snapshot branding; `/app` and `/api/snapshot-setup` returned the expected unauthenticated Shopify boundary, HTTP 410.
- After promotion, the public production root returned HTTP 200; `/app` and `/api/snapshot-setup` returned HTTP 410 without authentication.
- Staged and public production dashboard asset `app._index-Kum0IOPX.js` exactly matched the local validated build, SHA-256 `8e943be9ec9770f6f9933c81a0ed55b6d52449e2c8784680d4b7e56fe1b24c5f`.
- Bounded deployment error-log check before promotion returned no matching logs. This is not proof that no future errors will occur.
- Authenticated production merchant interaction was not repeated; the browser acceptance was on shep-dev's development preview. Production evidence is deployment identity, public health/authentication boundaries, and exact asset identity.
- Existing dependency audit, optional dependency-resolution, Node engine and Polaris CSS minification warnings remain. No dependency upgrades were made.

Runtime fingerprint: 179 files, SHA-256 `0ee903dfb695019a93f83c167685faaf07366f023a96216455211e861bfe35a4`. Same sorted-path/NUL/file/NUL method and file set as prior releases. Removing the four new onboarding runtime files and restoring only the dashboard source to HEAD reproduces the previous release fingerprint: 175 files, `7a20f490158babb012effb650d97528fc6bb0eec99de28823a15f2eb37e37430`. This confirms the release contains only the intended onboarding runtime changes.

## Rollback and quick merchant check

Previous production deployment: `dpl_9yNww4wSseekvGk5NwMouttZpPgh`, https://mousewhisperer-j0o6tf7zg-therhoe.vercel.app. It can be re-promoted if rollback is needed; no data rollback is required.

Refresh the dashboard, reopen setup from the checklist icon if hidden, and confirm the two targets show 100. Check collapse/expand, Exit setup and restore. Start snapshots only when real captures are intended; it creates a pair and consumes the corresponding allowance.
