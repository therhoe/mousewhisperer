CREATE TABLE "OptimizationEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "status" TEXT NOT NULL DEFAULT 'IMPLEMENTED',
    "scope" TEXT NOT NULL DEFAULT 'STORE',
    "pagePath" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "implementedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "shopifyAnnotationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OptimizationEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OptimizationEvent_shop_implementedAt_idx"
    ON "OptimizationEvent"("shop", "implementedAt");
CREATE INDEX "OptimizationEvent_shop_status_idx"
    ON "OptimizationEvent"("shop", "status");
CREATE INDEX "OptimizationEvent_shop_sourceType_idx"
    ON "OptimizationEvent"("shop", "sourceType");
