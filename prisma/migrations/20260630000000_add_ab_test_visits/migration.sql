-- CreateTable
CREATE TABLE "AbTestVisit" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "shop" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "pageViewId" TEXT NOT NULL,
    "pagePath" TEXT NOT NULL,
    "pageUrl" TEXT,
    "pageTitle" TEXT,
    "resourceType" "ResourceType",
    "resourceHandle" TEXT,
    "isLandingPage" BOOLEAN NOT NULL DEFAULT false,
    "pageOrder" INTEGER,
    "visitorType" "VisitorType" NOT NULL DEFAULT 'PENDING',
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "referrer" TEXT,
    "sourceCategory" TEXT,
    "timeOnPage" INTEGER NOT NULL DEFAULT 0,
    "scrollDepth" INTEGER NOT NULL DEFAULT 0,
    "mouseMovements" INTEGER NOT NULL DEFAULT 0,
    "keyPresses" INTEGER NOT NULL DEFAULT 0,
    "touchEvents" INTEGER NOT NULL DEFAULT 0,
    "ipAddress" TEXT,
    "country" TEXT,
    "countryCode" TEXT,
    "city" TEXT,
    "region" TEXT,
    "timezone" TEXT,
    "hasMouseMoved" BOOLEAN NOT NULL DEFAULT false,
    "hasScrolled" BOOLEAN NOT NULL DEFAULT false,
    "hasKeyPressed" BOOLEAN NOT NULL DEFAULT false,
    "hasTouched" BOOLEAN NOT NULL DEFAULT false,
    "isWebdriver" BOOLEAN NOT NULL DEFAULT false,
    "suspiciousUA" BOOLEAN NOT NULL DEFAULT false,
    "linearMovement" BOOLEAN NOT NULL DEFAULT false,
    "datacenterIP" BOOLEAN NOT NULL DEFAULT false,
    "botScore" INTEGER NOT NULL DEFAULT 0,
    "addedToCart" BOOLEAN NOT NULL DEFAULT false,
    "addedToCartAt" TIMESTAMP(3),
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "convertedAt" TIMESTAMP(3),
    "orderValue" DOUBLE PRECISION,
    "currency" TEXT,
    "ctaClicks" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "exitType" TEXT,
    "exitUrl" TEXT,
    "searchQuery" TEXT,
    "appliedFilters" TEXT,
    "sortBy" TEXT,
    "filterInteractions" INTEGER NOT NULL DEFAULT 0,
    "userAgent" TEXT,
    "deviceType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbTestVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AbTestVisit_testId_pageViewId_key" ON "AbTestVisit"("testId", "pageViewId");
CREATE INDEX "AbTestVisit_shop_idx" ON "AbTestVisit"("shop");
CREATE INDEX "AbTestVisit_testId_idx" ON "AbTestVisit"("testId");
CREATE INDEX "AbTestVisit_variantId_idx" ON "AbTestVisit"("variantId");
CREATE INDEX "AbTestVisit_assignmentId_idx" ON "AbTestVisit"("assignmentId");
CREATE INDEX "AbTestVisit_sessionId_idx" ON "AbTestVisit"("sessionId");
CREATE INDEX "AbTestVisit_testId_variantId_idx" ON "AbTestVisit"("testId", "variantId");
CREATE INDEX "AbTestVisit_testId_visitorType_idx" ON "AbTestVisit"("testId", "visitorType");
CREATE INDEX "AbTestVisit_testId_sessionId_idx" ON "AbTestVisit"("testId", "sessionId");
CREATE INDEX "AbTestVisit_testId_pagePath_idx" ON "AbTestVisit"("testId", "pagePath");
CREATE INDEX "AbTestVisit_testId_resourceType_idx" ON "AbTestVisit"("testId", "resourceType");
CREATE INDEX "AbTestVisit_testId_startedAt_idx" ON "AbTestVisit"("testId", "startedAt");
CREATE INDEX "AbTestVisit_testId_converted_idx" ON "AbTestVisit"("testId", "converted");

-- AddForeignKey
ALTER TABLE "AbTestVisit" ADD CONSTRAINT "AbTestVisit_testId_fkey" FOREIGN KEY ("testId") REFERENCES "AbTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AbTestVisit" ADD CONSTRAINT "AbTestVisit_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "AbTestVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AbTestVisit" ADD CONSTRAINT "AbTestVisit_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "AbTestAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
