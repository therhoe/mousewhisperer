# Outcome chart alignment release — 17 September 2026

## Scope and status

Deployed under the user's explicit release request: `dpl_9yNww4wSseekvGk5NwMouttZpPgh`, immutable URL `https://mousewhisperer-j0o6tf7zg-therhoe.vercel.app`. Presentation-only adjustment in `app/components/EngagementOutcomes.tsx`: bars 7px → 10px, gap 5px → 6px, radius 3px → 4px; metric headings and values both centered in their existing grid columns. Mobile label layout remains intact. No calculations, tracker, scopes, migrations or database changes.

## Pre-release evidence

- 14 outcome regression checks, targeted ESLint, production build and `git diff --check` passed in this release pass.
- Prior implementation-turn browser measurement confirmed all three heading/value center offsets were 0px and bar height was 10px. This is local actual-component evidence, not authenticated production UI acceptance.
- Rechecked production target: `therhoe/mousewhisperer` / `prj_Egn686nw4vCMpn0XY3Btoiac8Xdw`; public domain `https://mousewhisperer.vercel.app`.
- Previous Ready production deployment: `dpl_HSVTLXsnaSwXd1poVaYZkEGkah6q`, `https://mousewhisperer-nou0fjxn4-therhoe.vercel.app`.
- Working tree remains dirty; no unrelated edits reverted and no commit/push performed. Reversing only these five CSS changes in memory reproduces the exact prior released runtime fingerprint, proving no other runtime changes are included.
- New runtime fingerprint: 175 files, SHA-256 `7a20f490158babb012effb650d97528fc6bb0eec99de28823a15f2eb37e37430`, using the same sorted-path/NUL/file/NUL method and file set documented in the previous release receipt. Reconstructed previous fingerprint: `42d152d6ad85fe9c3828a02f5c6e2fd0bcf8464944b242a1c6480f627462c1bc`.
- Local built asset: `EngagementOutcomes-cQG2ogf1.js`, SHA-256 `e4f90b18950ce45e5c788fd12d5cea3308d32eb9c2b31cb5911ab965d3fa8777`.

## Release verification

- Hosted build passed. Staged with `--prod --skip-domain`; root returned 200 with Snapshot branding, chart asset matched the local SHA-256 exactly, and unauthenticated embedded route returned the expected 410 boundary.
- Explicit `vercel promote` succeeded. Production root returned 200; the public chart asset matched SHA-256 `e4f90b18950ce45e5c788fd12d5cea3308d32eb9c2b31cb5911ab965d3fa8777`; `vercel inspect mousewhisperer.vercel.app` resolved to this new Ready deployment.
- No Shopify extension publication was needed for this CSS-only change. Existing repository-wide TypeScript/dependency/CSS warnings from the previous release remain out of scope. Authenticated production UI interaction was not repeated; local browser layout evidence and public asset identity are the evidence for this narrow styling release.

Rollback target, if authorized: re-promote `dpl_HSVTLXsnaSwXd1poVaYZkEGkah6q`; no data rollback needed.
