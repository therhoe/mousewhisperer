-- Additive, replay-safe. Each paid order converts at most one row per capture: the
-- checkout pixel and the orders/paid webhook (and its retries) share the numeric
-- Shopify order id. Existing rows keep NULL.
-- Adding a nullable column without a default only changes the catalog, but it needs a
-- brief exclusive lock: give up after 5s instead of queueing tracking writes behind a
-- long query (the deploy script retries). The unique indexes follow in the next four
-- migrations, built CONCURRENTLY, one per file (CONCURRENTLY cannot share a batch).
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "orderId" TEXT;
ALTER TABLE "StoreSnapshotVisit" ADD COLUMN IF NOT EXISTS "orderId" TEXT;
ALTER TABLE "AbTestVisit" ADD COLUMN IF NOT EXISTS "orderId" TEXT;
ALTER TABLE "AbTestAssignment" ADD COLUMN IF NOT EXISTS "orderId" TEXT;
COMMIT;
