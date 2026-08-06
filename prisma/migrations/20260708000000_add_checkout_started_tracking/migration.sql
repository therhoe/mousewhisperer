-- Add first-class checkout-start tracking for snapshot and A/B funnel metrics.
ALTER TABLE "StoreSnapshotVisit"
ADD COLUMN "checkoutStarted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "checkoutStartedAt" TIMESTAMP(3);

ALTER TABLE "AbTestVisit"
ADD COLUMN "checkoutStarted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "checkoutStartedAt" TIMESTAMP(3);

ALTER TABLE "AbTestAssignment"
ADD COLUMN "checkoutStarted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "checkoutStartedAt" TIMESTAMP(3);

ALTER TABLE "Visit"
ADD COLUMN "checkoutStarted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "checkoutStartedAt" TIMESTAMP(3);

CREATE INDEX "StoreSnapshotVisit_storeSnapshotId_checkoutStarted_idx"
ON "StoreSnapshotVisit"("storeSnapshotId", "checkoutStarted");

CREATE INDEX "AbTestVisit_testId_checkoutStarted_idx"
ON "AbTestVisit"("testId", "checkoutStarted");

CREATE INDEX "AbTestAssignment_testId_checkoutStarted_idx"
ON "AbTestAssignment"("testId", "checkoutStarted");

CREATE INDEX "Visit_snapshotId_checkoutStarted_idx"
ON "Visit"("snapshotId", "checkoutStarted");
