# Snapshot production release — August 26, 2026

Status: application server and Shopify configuration/extensions released after explicit production approval. This records deployment and signed-in smoke verification, not a full real-checkout regression or a before/after speed benchmark.

## Release identity

| Target | Released version |
| --- | --- |
| Vercel project | `therhoe/mousewhisperer` |
| Production URL | <https://mousewhisperer.vercel.app> |
| Deployment | `dpl_HtnFMovh69gUv1JdfBAkhV4hpGHX` — Ready; created August 26, 2026, 17:22:16 UTC |
| Immutable deployment URL | <https://mousewhisperer-d0ot06lob-therhoe.vercel.app> |
| Shopify app | Snapshot, app ID `307730874369`, organization `129538921` |
| Shopify active version | `snapshot-20260826` |
| Shopify version details | <https://dev.shopify.com/dashboard/129538921/apps/307730874369/versions/1104534700033> |

The tested working tree was deployed directly. No Git commit or push was made. Its base commit is `35a240bd85cb0f45dcfac060cfdd6b38871d14d1`; that commit alone does **not** identify this release's source.

Runtime/build SHA-256 fingerprint: `e682df76c3b874cb5c8fa7a0c7cc232d9eac229e5f9e2b1cd306156ce6ee2e31` (164 files). The fingerprint covers sorted runtime files under `app/`, `extensions/`, `prisma/`, and `public/`, plus Shopify configuration, package files, Vercel/Vite/TypeScript configuration, `.npmrc`, and `.vercelignore`; each path and file body is separated by a NUL byte. It is also recorded in Vercel deployment metadata. Documentation and test scripts are outside this fingerprint.

## Deployment sequence and checks

1. Confirmed the linked Vercel project, Shopify app, production app URL, client ID, scopes, and exact deployment database without changing them.
2. Pulled production environment variables into a private temporary directory for a read-only database check. All **15 migrations were already applied**. No migration or schema write was required during this deployment.
3. Ran the Channel/acquisition/pixel regressions, performance/cache/background transport/category/A/B/branding checks, standalone UI/chart checks, focused ESLint, Prisma validation, and `git diff --check`. Added and passed 12 paid-order Channel-failure-isolation tests. The existing full-project TypeScript baseline remains 128 diagnostics; this is not a clean full-project typecheck.
4. Local production build passed. Shopify validated and built the theme and web-pixel extensions, then created the version without releasing it.
5. Added and checked `.vercelignore`: local credentials, `.shopify`, `.vercel`, development fixtures, caches, generated builds, and developer folders are excluded. Vercel does not inherit `.gitignore`. The local lockfile is included in this upload; no dependency declaration was changed.
6. Built the server against production settings with main-domain promotion withheld. Hosted build passed, and the five checks below passed against that deployment.
7. Promoted the tested server. Inspecting `mousewhisperer.vercel.app` resolved to the new deployment ID. Released Shopify version `snapshot-20260826`; version listing confirmed it active and the app name Snapshot.
8. Restored this app's active version on `shep-dev.myshopify.com` using the scoped development-preview cleanup. Other apps' previews were left alone. The preview can be restarted with the usual Shopify development command.
9. Removed the temporary production-environment file and its private directory after verification.

### HTTP and published-asset checks

Requests used no app authorization, cookies, or Shopify identity query parameters and did not follow redirects. The unsigned webhook check was rejected before business writes.

| Check | Observed |
| --- | --- |
| `GET /` | 200; Snapshot branding present |
| `GET /app/channel-snapshots` | 302 to `/auth/login` |
| `GET /api/dashboard-conversion?period=month` | 302 to `/auth/login` |
| `GET /api/storefront-tracker-status` | 302 to `/auth/login` |
| Unsigned `POST /webhooks/orders/paid`, body `{}` | 401 Unauthorized |

After promotion, the public production root returned 200 with Snapshot branding and no Mouse Whisperer branding. Four published client assets matched the tested local build byte-for-byte: the app shell, Channel index, Page Snapshot category, and conversion chart bundles. The post-release ten-minute log sample returned no error-level records and no 5xx records; this is a bounded observation, not a guarantee of future error-free operation.

### Authenticated production UI verification

Chrome's signed-in `shep-dev` session was reloaded after removing this app's preview. The visible iframe source was confirmed as `https://mousewhisperer.vercel.app/app`; verification was not against a local development tunnel.

- Shopify navigation and breadcrumbs show **Snapshot**. Existing installation handle and hosting URL remain unchanged.
- Dashboard loads Shopify conversion data, keeps the explanation below the plot, and separates Optimizations, Experiments, and Measurements. Turning on Clean graph removes the activity markers/overlays while retaining the current/previous series and activity lists.
- Channel Snapshots loads its performance card above history, with no top tracking-warning or attribution-information card. The metric selector switches from Human sessions to Conversion rate. Its existing completed capture has no sessions, so the explicit empty state is shown rather than fabricated chart observations. The attribution explanation is collapsed below history.
- Page Snapshots loads Products with its performance graph. Switching to Collections immediately shows the destination tab and loading state, then the collection-specific result; the product graph does not remain in the pending collection view.
- A/B Tests loads its performance graph and existing live test.
- Store Snapshots loads its existing active capture/history and independently resolved tracking status.

No new captures, optimizations, test orders, synthetic visits, subscription purchases, or lifecycle changes were created for these checks. The development store reports its rich storefront-tracking embed as **Not active**; this deployment did not enable or alter a merchant theme. Actual consent, storefront collection, checkout, delayed webhook/pixel attribution, and performance benchmarking remain separate acceptance checks.

## Important outstanding security work

### Credential rotation

A Shopify diagnostic command unexpectedly included local environment credentials in its output. No credential values are reproduced here. The user was notified during the release, subsequent diagnostics used field allowlists, the upload explicitly excludes credential files, and the temporary production-environment file was removed.

**The exposed database password still needs coordinated rotation**, including all dependent deployment and local configurations. It was not silently changed during deployment. An old Vercel OIDC token was also present in that diagnostic output; review its expiry and revoke it if still valid. Deleting the temporary file is not credential rotation.

### Existing dependency advisories

The hosted install reported dependency advisories. No package declaration changed in this feature release, but an old deployed transitive-version baseline cannot be established from Git because `package-lock.json` is currently ignored.

The local/runtime dependency `@remix-run/server-runtime@2.17.2` is affected by the maintainer's [unbounded manifest-expansion denial-of-service advisory](https://github.com/remix-run/react-router/security/advisories/GHSA-8x6r-g9mw-2r78). The application has lazy route discovery enabled; the framework processes this endpoint before application route authentication. This code/configuration also exists in the repository's base revision. No exploit was attempted.

Urgent follow-up: update the coherent Remix 2.x package set so server-runtime resolves to at least **2.17.5**, rerun Shopify authentication/navigation/webhook regressions, review the other runtime advisories, and adopt a tracked lockfile with reproducible installs. Do not treat the successful build as a security clearance or run a blanket forced dependency upgrade.

## Known attribution limitation

The added paid-order guard isolates Channel-only errors so existing Store/Page/A/B processing continues. It acknowledges the webhook if that existing processing succeeds. A failed Channel conversion update can therefore be missed unless its independent pixel callback succeeds; recovery is not guaranteed. This avoids requesting a webhook replay through existing legacy writers that are not order-idempotent. See [the Channel release checklist](channel-snapshots-release.md) for the full behavior and remaining checkout/consent tests.

## Rollback reference

Previous Vercel deployment: `dpl_5sAZx6FN8E11RqPwyHuaaCz53Nep`, <https://mousewhisperer-2ijd3c59a-therhoe.vercel.app>.

Previous Shopify active version: `mouse-whisperer-40`.

If an authorized rollback is required, coordinate the previous server and Shopify version. Leave the additive Channel tables intact to preserve data; do not reset or drop the database. A rollback was not performed during this release.
