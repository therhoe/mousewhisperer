-- One converted row per order per capture; orderId leads so lookups by order use it.
-- CONCURRENTLY keeps "Visit" readable and writable during the build, and cannot share
-- a batch, so this file holds only this statement.
-- If the build fails, Prisma records this migration as failed (P3018) and every later
-- deploy, including scripts/prisma-migrate-deploy.sh's retries, stops at P3009.
-- Postgres keeps an INVALID index that IF NOT EXISTS would then skip. Recovery is manual:
-- DROP INDEX CONCURRENTLY "Visit_orderId_snapshotId_key"; then
-- `prisma migrate resolve --rolled-back <this migration>`, and deploy again.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Visit_orderId_snapshotId_key" ON "Visit"("orderId", "snapshotId");
