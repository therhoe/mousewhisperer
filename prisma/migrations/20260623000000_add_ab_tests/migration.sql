-- CreateEnum
CREATE TYPE "AbTestStatus" AS ENUM ('DRAFT', 'LIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "AbTestType" AS ENUM ('TEMPLATE');

-- CreateEnum
CREATE TYPE "AbTestGoal" AS ENUM ('ADD_TO_CART', 'CONVERSION', 'REVENUE', 'CLICK_THROUGH', 'ENGAGEMENT');

-- CreateEnum
CREATE TYPE "AbTestPageType" AS ENUM ('PRODUCT', 'COLLECTION', 'PAGE', 'BLOG', 'HOMEPAGE', 'CART');

-- CreateEnum
CREATE TYPE "AbTestVariantKey" AS ENUM ('A', 'B');

-- CreateTable
CREATE TABLE "AbTest" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AbTestStatus" NOT NULL DEFAULT 'DRAFT',
    "testType" "AbTestType" NOT NULL DEFAULT 'TEMPLATE',
    "targetPageType" "AbTestPageType" NOT NULL,
    "goal" "AbTestGoal" NOT NULL DEFAULT 'CONVERSION',
    "themeId" TEXT,
    "themeName" TEXT,
    "themeRole" TEXT,
    "trafficSplit" INTEGER NOT NULL DEFAULT 50,
    "notes" TEXT,
    "launchedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbTestVariant" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "key" "AbTestVariantKey" NOT NULL,
    "name" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "templateSuffix" TEXT,
    "templateFileName" TEXT,
    "previewUrl" TEXT,
    "isControl" BOOLEAN NOT NULL DEFAULT false,
    "trafficPercent" INTEGER NOT NULL DEFAULT 50,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbTestVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbTestAssignment" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "pageViewId" TEXT,
    "pagePath" TEXT,
    "pageUrl" TEXT,
    "pageTitle" TEXT,
    "resourceType" "ResourceType",
    "resourceHandle" TEXT,
    "visitorType" "VisitorType" NOT NULL DEFAULT 'PENDING',
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "referrer" TEXT,
    "sourceCategory" TEXT,
    "timeOnPage" INTEGER NOT NULL DEFAULT 0,
    "scrollDepth" INTEGER NOT NULL DEFAULT 0,
    "addedToCart" BOOLEAN NOT NULL DEFAULT false,
    "addedToCartAt" TIMESTAMP(3),
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "convertedAt" TIMESTAMP(3),
    "orderValue" DOUBLE PRECISION,
    "currency" TEXT,
    "ctaClicks" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbTestAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AbTest_shop_idx" ON "AbTest"("shop");

-- CreateIndex
CREATE INDEX "AbTest_shop_status_idx" ON "AbTest"("shop", "status");

-- CreateIndex
CREATE INDEX "AbTest_shop_targetPageType_idx" ON "AbTest"("shop", "targetPageType");

-- CreateIndex
CREATE INDEX "AbTest_createdAt_idx" ON "AbTest"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AbTestVariant_testId_key_key" ON "AbTestVariant"("testId", "key");

-- CreateIndex
CREATE INDEX "AbTestVariant_testId_idx" ON "AbTestVariant"("testId");

-- CreateIndex
CREATE INDEX "AbTestVariant_testId_sortOrder_idx" ON "AbTestVariant"("testId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "AbTestAssignment_testId_sessionId_key" ON "AbTestAssignment"("testId", "sessionId");

-- CreateIndex
CREATE INDEX "AbTestAssignment_shop_idx" ON "AbTestAssignment"("shop");

-- CreateIndex
CREATE INDEX "AbTestAssignment_testId_idx" ON "AbTestAssignment"("testId");

-- CreateIndex
CREATE INDEX "AbTestAssignment_variantId_idx" ON "AbTestAssignment"("variantId");

-- CreateIndex
CREATE INDEX "AbTestAssignment_sessionId_idx" ON "AbTestAssignment"("sessionId");

-- CreateIndex
CREATE INDEX "AbTestAssignment_testId_variantId_idx" ON "AbTestAssignment"("testId", "variantId");

-- CreateIndex
CREATE INDEX "AbTestAssignment_testId_visitorType_idx" ON "AbTestAssignment"("testId", "visitorType");

-- CreateIndex
CREATE INDEX "AbTestAssignment_testId_converted_idx" ON "AbTestAssignment"("testId", "converted");

-- CreateIndex
CREATE INDEX "AbTestAssignment_assignedAt_idx" ON "AbTestAssignment"("assignedAt");

-- AddForeignKey
ALTER TABLE "AbTestVariant" ADD CONSTRAINT "AbTestVariant_testId_fkey" FOREIGN KEY ("testId") REFERENCES "AbTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbTestAssignment" ADD CONSTRAINT "AbTestAssignment_testId_fkey" FOREIGN KEY ("testId") REFERENCES "AbTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbTestAssignment" ADD CONSTRAINT "AbTestAssignment_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "AbTestVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
