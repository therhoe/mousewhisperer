# Snapshot production release — Channel table — August 28, 2026

Status: deployed to production after staged verification. This was an application-server-only presentation update; no database migration, Shopify configuration change, extension release, or Shopify app-version release was required.

## Release identity

| Target | Released version |
| --- | --- |
| Vercel project | `therhoe/mousewhisperer` |
| Production URL | <https://mousewhisperer.vercel.app> |
| Deployment | `dpl_EJsK6eA7hNk1EA6C68a8pjanr4zU` — Ready |
| Immutable deployment URL | <https://mousewhisperer-c5ebrnuts-therhoe.vercel.app> |
| Runtime/build SHA-256 fingerprint | `55379f32414ecad39004c2d6e9c05a965165ff08bd5602dadf348fcfade0baaf` — 164 files |
| Shopify version | Unchanged; no Shopify release was run for this update |

The tested working tree was deployed directly. Its Git base is `35a240bd85cb0f45dcfac060cfdd6b38871d14d1`; the release changes remain uncommitted, so that commit alone does not identify the deployed source.

## Released behavior

The Channel Snapshot detail table now:

- omits the visible Pending column;
- places Add to cart and Conversions before Avg time and Avg scroll; and
- uses a smaller minimum table width to reduce horizontal scrolling.

The underlying pending-session classification remains intact; this release changes only the report presentation.

## Verification

Before deployment, the Channel Snapshot UI regression, 37 core Channel Snapshot tests, focused ESLint, `git diff --check`, and the production build passed. Desktop, tablet, and mobile visual checks confirmed the new column order and internal table scrolling.

The Vercel build was uploaded without assigning the main production domain. On the staged deployment:

- deployment state was Ready;
- `GET /` returned 200 with Snapshot branding;
- an unauthenticated Channel detail request returned 302 to `/auth/login`;
- the published Channel-detail JavaScript asset matched the tested local asset byte-for-byte; and
- the bounded error-level and 5xx log samples both contained zero records.

After promotion, `mousewhisperer.vercel.app` resolved to `dpl_EJsK6eA7hNk1EA6C68a8pjanr4zU`. The production root returned 200, the protected Channel detail request returned 302 to `/auth/login`, the published asset still matched, and the bounded post-promotion error-level and 5xx samples both contained zero records.

These checks do not represent a new capture, test order, checkout regression, or full authenticated-browser regression. No lifecycle action or synthetic store data was created.

## Rollback reference

Immediate previous Vercel deployment: `dpl_HtnFMovh69gUv1JdfBAkhV4hpGHX`, <https://mousewhisperer-d0ot06lob-therhoe.vercel.app>.

If an authorized rollback is required, promote that Vercel deployment. Do not roll back Shopify or alter the database for this UI-only release.

Existing credential-rotation and dependency-advisory follow-ups remain documented in [the August 26 production release](snapshot-production-release-2026-08-26.md).
