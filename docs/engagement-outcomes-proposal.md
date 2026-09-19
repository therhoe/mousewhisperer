# Engagement outcomes — approved implementation

Approved on 17 September 2026. Implemented for Page Snapshot reports and isolated A/B variant snapshot reports; deployment is tracked in `snapshot-production-release-2026-09-17-engagement-outcomes.md`. The first release uses **same-session association**, as stated before implementation. It does not claim after-click sequencing.

## Intent and proposed UI

Keep Engagement by Zone's click distribution, category groups, labels and raw click totals. Add an optional **Show outcomes** toggle that reveals three thin, aligned bars per element with numeric columns:

- Clicked sessions: distinct tracked sessions that clicked that element.
- Added to cart: those same sessions with a recorded successful cart addition.
- Purchased: those same sessions with a recorded purchase.

Use one shared absolute session-count scale across all rows/categories, preserving the earlier cross-category comparison decision. Bars are parallel, not stacked: these groups overlap and must not be added together. A purchase need not imply a tracked add-to-cart, for example with accelerated checkout or incomplete delivery. The donut remains raw click distribution and is labelled separately.

Example preview only: **Play video — 32 clicks / 24 clicked sessions / 8 added to cart (33.3%) / 3 purchased (12.5%)**. Percentages divide by 24, not 32 clicks, all store sessions, or eight cart sessions. Repeat clicks count once toward the element's clicked-session cohort. An Add to cart button click is not itself a successful cart event.

The generated image is an illustrative design preview, not measured store data or an implemented screen. It was created using the built-in image-generation tool and the supplied Engagement by Zone screenshot as a layout/style reference.

## Implementation and limitations

- Page visits and A/B assignment/visit records already contain click payloads, session identifiers, and cart/conversion flags; some also have outcome timestamps. The current tracker records per-page click elapsed time and caps the legacy click array at 50 entries per visit.
- `app/utils/click-engagement.ts` now builds deduplicated element outcome cohorts. Both Page query paths select session and commerce fields, retain source/date/capture boundaries, and invalidate pre-feature stats caches. Page outcomes include Real and Zombie sessions; A/B outcomes retain the report's Real-only audience.
- A/B behavior must join to commerce by the exact test/variant/session identity; never blend control and variant or borrow another capture's outcomes. Tenant, capture, visitor-quality and date filters must remain consistent.
- The **same-session association** view uses existing records and does not change the tracker, scopes or schema. Legacy session identity is not guaranteed to mean the new Customer Snapshot's 30-minute acquisition session; the UI explicitly says recorded session IDs, not cross-device people.
- A strict **purchased after clicking** view requires reliable click/outcome timing across the relevant records, with a defined window. Older object-style click payloads lack event timing. Do not silently label old aggregate data as an after-click funnel; use an unavailable/coverage state where the needed evidence is absent. Tracker changes may be needed for uniform forward-looking chronology.
- Missing tracking is not proof of no outcome. Keep coverage limitations visible; don't promise every customer/action is captured or sum element cohorts into unique store purchasers.

## Verification

The existing click-only view remains the default. Buttons/links/widgets/header/footer paginate five elements at a time; image cards scroll horizontally after widgets. Missing identity or commerce linkage is shown as unavailable. No cross-capture or cross-variant outcomes are borrowed.

Fourteen new regression tests cover deduplication, legacy/malformed payloads, missing data, canonical images, element identity, shared scale, rates, pagination, query fields and cache invalidation. The broader suite totals 184 passing database-free checks. Actual-component in-app browser QA verified toggle on/off, page 2 navigation, the 24/8/3 example, and a 390px layout with no document overflow (only the image strip scrolls).
