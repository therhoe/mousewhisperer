CREATE TYPE "BillingPlan" AS ENUM ('FREE', 'STARTER', 'GROWTH', 'PRO');

CREATE TABLE "ShopBilling" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "plan" "BillingPlan" NOT NULL DEFAULT 'FREE',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "shopifySubscriptionId" TEXT,
  "currentPeriodEnd" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShopBilling_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopBilling_shop_key" ON "ShopBilling"("shop");
CREATE INDEX "ShopBilling_plan_idx" ON "ShopBilling"("plan");
CREATE INDEX "ShopBilling_status_idx" ON "ShopBilling"("status");
