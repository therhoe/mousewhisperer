# Snapshot QA fixes — 17 September 2026

## Status

The four issues from [deeper QA](customer-snapshots-qa-2026-09-17.md) are corrected and **deployed** with [Engagement outcomes](snapshot-production-release-2026-09-17-engagement-outcomes.md), deployment `dpl_HSVTLXsnaSwXd1poVaYZkEGkah6q`. The original local verification below remains distinct from hosted acceptance. No production data was rewritten, no historical purchase backfill was attempted, and no migration, scope change, or tracker release was required by these fixes. Existing unrelated working-tree changes were preserved.

## Changes

1. **Journey export:** replaced resource-route navigation with a same-origin authenticated fetch using a fresh App Bridge ID token, validated the returned journey identity and JSON shape, and downloaded a temporary JSON blob. Redirects are rejected, tokens stay in headers, the modal stays open, and failures show a retryable message. Requests cancel on unmount and have a 30-second timeout; blob URLs are released after download dispatch.
2. **Tracking status:** password/challenge/non-storefront pages now return Unknown/Not verified, not Missing/Not active. A successful HTTP response alone is no longer enough to declare the embed absent. Verified Shopify storefront HTML still reports active/missing according to tracker detection.
3. **Visitor quality:** Store Snapshot session classes are mutually exclusive, following the existing best-observed-page precedence `REAL > ZOMBIE > PENDING > BOT`. Whole-session metrics include all pages of a Real session, so an idle landing page does not hide that session's purchase. This preserves the Store Snapshot's existing Real-session denominator; it does not change it to the Customer Snapshot's Real-plus-Zombie denominator. Page-level quality measures remain page-level.
4. **Long-running Store Snapshots:** purchase and checkout attribution now apply the 30-day lookback to visit time, not capture creation time. Old active captures can receive outcomes from recent visits. Invalid event dates are rejected; paused/cross-shop/future/stale visits remain excluded. Completed captures can still receive delayed outcomes for eligible visits, preserving existing delayed-attribution semantics.

Store stats caches are versioned: old overlapping results are recomputed on their next normal read. Comparisons do not mix new stats with old-version previous-capture caches; a previous capture's delta becomes available after that cache is recomputed. This avoids recursively rebuilding the store's entire history during one page load.

## Verification

- **170 database-free checks passed**: the prior 157-check broader suite plus 13 new regression tests in `scripts/check-qa-fixes.mjs`. New tests execute actual status, export and Store Snapshot functions with explicit boundary mocks; they are not a replacement for authenticated deployment acceptance.
- Production build passed (`npm run build`). Existing Polaris CSS minifier warning remains.
- Targeted ESLint passed for the four changed runtime files. `git diff --check` passed.
- Repository-wide TypeScript still fails in existing unrelated routes/components/preview files; the changed runtime files reported no diagnostics.
- Actual Customer Snapshot route component tested in Chrome via synthetic loopback fixtures on ports 4184 and 4185. Export saved `customer-journey-visitor-0.json`; parsed file contents matched the selected fixture journey, and the report URL/modal stayed in place.
- A deliberate fixture 503 displayed “Could not download this journey. Please try again.” Retrying removed the error, retained the modal, and saved the expected `customer-journey-visitor-1.json` with matching contents.
- Browser download-event observation did not detect these blob downloads, but the files were independently verified on disk. Download success is based on the saved file plus unchanged report UI, not the event observer.
- No new real-database tests or live Shopify-authenticated acceptance were run for these patches. The preceding QA's 12 PostgreSQL tests are separate historical evidence, not part of this 170-test total.

## Remaining authenticated acceptance

The application is deployed under release approval. Reopen the retained completed QA capture and export its journey inside Shopify. Verify a password-protected dev store shows Not verified rather than Not active, the old Store Snapshot breakdown sums to its total, and a newly authorized test checkout/purchase is attributed to a long-running capture. Browser connection limitations prevented repeating those live interactions in the deployment pass. Old missed purchases will not automatically appear: any historical repair needs a separate bounded plan.

The engagement-outcome chart was subsequently approved, implemented and deployed; see [its metric definitions and implementation](engagement-outcomes-proposal.md).
