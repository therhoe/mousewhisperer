ALTER TABLE "AbTest"
  ADD COLUMN "sourceSnapshotId" TEXT,
  ADD COLUMN "sourceSnapshotKind" TEXT,
  ADD COLUMN "generationPlan" JSONB;

ALTER TABLE "AbTestVariant"
  ADD COLUMN "generationMode" TEXT,
  ADD COLUMN "sourceSnapshotId" TEXT,
  ADD COLUMN "sourceSnapshotKind" TEXT,
  ADD COLUMN "generationPlan" JSONB;

CREATE INDEX "AbTest_sourceSnapshotId_idx" ON "AbTest"("sourceSnapshotId");
