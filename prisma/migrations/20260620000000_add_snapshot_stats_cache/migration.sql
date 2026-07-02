CREATE TABLE "SnapshotStatsCache" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "stats" JSONB NOT NULL,
    "recomputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SnapshotStatsCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SnapshotStatsCache_snapshotId_key" ON "SnapshotStatsCache"("snapshotId");
CREATE INDEX "SnapshotStatsCache_recomputedAt_idx" ON "SnapshotStatsCache"("recomputedAt");

ALTER TABLE "SnapshotStatsCache"
ADD CONSTRAINT "SnapshotStatsCache_snapshotId_fkey"
FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
