-- Additive, replay-safe: "AbTestVisit"."orderId" (NULL on existing rows). The checkout pixel
-- and the orders/paid webhook share the numeric Shopify order id, so a capture keeps
-- one converted row per order. Its unique index is built CONCURRENTLY in a later
-- migration.
-- A nullable column without a default only changes the catalog, but needs a brief
-- ACCESS EXCLUSIVE lock. One table per migration, and lock_timeout gives up after 5s
-- instead of queueing every tracking write behind a long query.
-- If it times out, Prisma records this migration as failed (P3018) and every later
-- deploy, including scripts/prisma-migrate-deploy.sh's retries, stops at P3009.
-- Recovery is manual: `prisma migrate resolve --rolled-back <this migration>`, then
-- deploy again when the table is quieter.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "AbTestVisit" ADD COLUMN IF NOT EXISTS "orderId" TEXT;
COMMIT;
