-- One converted row per order per capture. orderId leads so lookups by order use it.
-- If a concurrent build fails it leaves an INVALID index: DROP INDEX CONCURRENTLY "Visit_orderId_snapshotId_key";
-- then `prisma migrate resolve --rolled-back` this migration and deploy again.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Visit_orderId_snapshotId_key" ON "Visit"("orderId", "snapshotId");
