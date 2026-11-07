-- One converted row per order per capture. orderId leads so lookups by order use it.
-- If a concurrent build fails it leaves an INVALID index: DROP INDEX CONCURRENTLY "AbTestVisit_orderId_testId_key";
-- then `prisma migrate resolve --rolled-back` this migration and deploy again.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "AbTestVisit_orderId_testId_key" ON "AbTestVisit"("orderId", "testId");
