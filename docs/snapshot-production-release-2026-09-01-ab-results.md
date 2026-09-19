# Snapshot production release — A/B results — September 1, 2026

Status: deployed to production after a staged production build and smoke verification. This was an application-server release only; no database migration, Shopify access-scope change, app configuration change, or extension release was required.

## Release identity

| Target                            | Released version                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| Vercel project                    | `therhoe/mousewhisperer`                                                            |
| Production URL                    | <https://mousewhisperer.vercel.app>                                                 |
| Deployment                        | `dpl_2iaRYYrmW84uq3d4AeQqFHwxwd9y` — Ready; created September 1, 2026, 21:40:25 UTC |
| Immutable deployment URL          | <https://mousewhisperer-guasvjbu0-therhoe.vercel.app>                               |
| Runtime/build SHA-256 fingerprint | `abd579acc017baa1003099e1d46c176dc6bceb1e690b45e8088d42c6c543bd75` — 165 files      |
| Git base                          | `35a240bd85cb0f45dcfac060cfdd6b38871d14d1`                                          |

The existing uncommitted working-tree release lineage was deployed directly. The Git commit alone does not identify the release source.

## Released behavior

- A/B result metrics and the cumulative primary-goal graph appear at the top of the report.
- Control A and Variant B tabs independently load Page Snapshot-style reports below the comparison.
- Commerce outcomes remain assignment/session-attributed, while behavioral reporting uses variant-specific visits filtered to the tested page type.
- Traffic quality, resource-aware metrics, click zones, image engagement, pages, devices, countries, and exits are available per variant.
- Reopening the report refreshes the active variant snapshot; switching tabs does not reuse the other variant's payload.

## Verification

- Six A/B attribution and UI regressions passed.
- Focused Prettier, ESLint, TypeScript, and `git diff --check` checks passed.
- The local production build passed.
- The hosted Node 24 production build reached Ready before promotion.
- On the staged deployment, the root returned 200 with Snapshot branding, `/app/ab-tests` matched the existing unauthenticated 410 response, and an unsigned orders-paid webhook returned 401.
- The staged and promoted `AbTestDetailReport` browser bundle matched the tested local file byte-for-byte: `db46de65141041770617ee7714ead7572bc9884db8a4b21fdab972cfd003b79d`.
- The custom production domain resolved to the new deployment after promotion. The production root returned 200, Snapshot branding was present, and the protected A/B route retained its baseline response.
- Bounded staged and post-promotion log checks returned no error-level or 5xx records.

Authenticated Shopify Admin UI verification was not performed in this release run because Chrome was not running and the in-app browser had no signed-in Shopify session. Real merchant data, checkout attribution, and mobile interaction remain acceptance checks.

## Rollback reference

Immediate previous Vercel deployment: `dpl_EJsK6eA7hNk1EA6C68a8pjanr4zU`, <https://mousewhisperer-c5ebrnuts-therhoe.vercel.app>.

If rollback is authorized, promote that deployment. No database or Shopify rollback is required for this server-only A/B report release.
