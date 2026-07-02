-- CreateEnum
CREATE TYPE "StoreSnapshotStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'PAUSED');

-- CreateEnum
CREATE TYPE "StoreSnapshotCompletionMode" AS ENUM ('HUMAN_VISITORS', 'TOTAL_VISITS', 'TIME_WINDOW');

-- CreateEnum
CREATE TYPE "StoreSnapshotRecommendationStatus" AS ENUM ('OPEN', 'CREATED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'STORE_SNAPSHOT_COMPLETED';

-- CreateTable
CREATE TABLE "StoreSnapshot" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT,
    "status" "StoreSnapshotStatus" NOT NULL DEFAULT 'ACTIVE',
    "completionMode" "StoreSnapshotCompletionMode" NOT NULL DEFAULT 'HUMAN_VISITORS',
    "targetHumanVisitors" INTEGER,
    "targetTotalVisits" INTEGER,
    "durationDays" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSnapshotVisit" (
    "id" TEXT NOT NULL,
    "storeSnapshotId" TEXT NOT NULL,
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

    CONSTRAINT "StoreSnapshotVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSnapshotStatsCache" (
    "id" TEXT NOT NULL,
    "storeSnapshotId" TEXT NOT NULL,
    "stats" JSONB NOT NULL,
    "recomputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSnapshotStatsCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSnapshotPageAggregate" (
    "id" TEXT NOT NULL,
    "storeSnapshotId" TEXT NOT NULL,
    "pageKey" TEXT NOT NULL,
    "pagePath" TEXT NOT NULL,
    "pageTitle" TEXT,
    "pageType" "ResourceType",
    "resourceHandle" TEXT,
    "totalVisits" INTEGER NOT NULL DEFAULT 0,
    "humanVisits" INTEGER NOT NULL DEFAULT 0,
    "zombieVisits" INTEGER NOT NULL DEFAULT 0,
    "botVisits" INTEGER NOT NULL DEFAULT 0,
    "uniqueHumanSessions" INTEGER NOT NULL DEFAULT 0,
    "avgTimeOnPage" INTEGER NOT NULL DEFAULT 0,
    "avgScrollDepth" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clickThroughRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "addToCartRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "searchCount" INTEGER NOT NULL DEFAULT 0,
    "exitCount" INTEGER NOT NULL DEFAULT 0,
    "weaknessScore" INTEGER NOT NULL DEFAULT 0,
    "opportunityScore" INTEGER NOT NULL DEFAULT 0,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "metrics" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSnapshotPageAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSnapshotRecommendation" (
    "id" TEXT NOT NULL,
    "storeSnapshotId" TEXT NOT NULL,
    "pageAggregateId" TEXT,
    "status" "StoreSnapshotRecommendationStatus" NOT NULL DEFAULT 'OPEN',
    "pageKey" TEXT NOT NULL,
    "pagePath" TEXT NOT NULL,
    "pageTitle" TEXT,
    "pageType" "ResourceType",
    "resourceHandle" TEXT,
    "recommendedType" "ResourceType",
    "priority" INTEGER NOT NULL DEFAULT 0,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "weaknessScore" INTEGER NOT NULL DEFAULT 0,
    "opportunityScore" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actionLabel" TEXT NOT NULL,
    "createdProjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSnapshotRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoreSnapshot_shop_idx" ON "StoreSnapshot"("shop");
CREATE INDEX "StoreSnapshot_shop_status_idx" ON "StoreSnapshot"("shop", "status");
CREATE INDEX "StoreSnapshot_startedAt_idx" ON "StoreSnapshot"("startedAt");
CREATE INDEX "StoreSnapshot_endsAt_idx" ON "StoreSnapshot"("endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoreSnapshotVisit_pageViewId_storeSnapshotId_key" ON "StoreSnapshotVisit"("pageViewId", "storeSnapshotId");
CREATE INDEX "StoreSnapshotVisit_storeSnapshotId_idx" ON "StoreSnapshotVisit"("storeSnapshotId");
CREATE INDEX "StoreSnapshotVisit_storeSnapshotId_visitorType_idx" ON "StoreSnapshotVisit"("storeSnapshotId", "visitorType");
CREATE INDEX "StoreSnapshotVisit_storeSnapshotId_sessionId_idx" ON "StoreSnapshotVisit"("storeSnapshotId", "sessionId");
CREATE INDEX "StoreSnapshotVisit_storeSnapshotId_pagePath_idx" ON "StoreSnapshotVisit"("storeSnapshotId", "pagePath");
CREATE INDEX "StoreSnapshotVisit_storeSnapshotId_resourceType_idx" ON "StoreSnapshotVisit"("storeSnapshotId", "resourceType");
CREATE INDEX "StoreSnapshotVisit_storeSnapshotId_startedAt_idx" ON "StoreSnapshotVisit"("storeSnapshotId", "startedAt");
CREATE INDEX "StoreSnapshotVisit_storeSnapshotId_converted_idx" ON "StoreSnapshotVisit"("storeSnapshotId", "converted");

-- CreateIndex
CREATE UNIQUE INDEX "StoreSnapshotStatsCache_storeSnapshotId_key" ON "StoreSnapshotStatsCache"("storeSnapshotId");
CREATE INDEX "StoreSnapshotStatsCache_recomputedAt_idx" ON "StoreSnapshotStatsCache"("recomputedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoreSnapshotPageAggregate_storeSnapshotId_pageKey_key" ON "StoreSnapshotPageAggregate"("storeSnapshotId", "pageKey");
CREATE INDEX "StoreSnapshotPageAggregate_storeSnapshotId_idx" ON "StoreSnapshotPageAggregate"("storeSnapshotId");
CREATE INDEX "StoreSnapshotPageAggregate_storeSnapshotId_opportunityScore_idx" ON "StoreSnapshotPageAggregate"("storeSnapshotId", "opportunityScore");
CREATE INDEX "StoreSnapshotPageAggregate_storeSnapshotId_weaknessScore_idx" ON "StoreSnapshotPageAggregate"("storeSnapshotId", "weaknessScore");
CREATE INDEX "StoreSnapshotPageAggregate_storeSnapshotId_pageType_idx" ON "StoreSnapshotPageAggregate"("storeSnapshotId", "pageType");

-- CreateIndex
CREATE INDEX "StoreSnapshotRecommendation_storeSnapshotId_idx" ON "StoreSnapshotRecommendation"("storeSnapshotId");
CREATE INDEX "StoreSnapshotRecommendation_storeSnapshotId_status_idx" ON "StoreSnapshotRecommendation"("storeSnapshotId", "status");
CREATE INDEX "StoreSnapshotRecommendation_storeSnapshotId_priority_idx" ON "StoreSnapshotRecommendation"("storeSnapshotId", "priority");
CREATE INDEX "StoreSnapshotRecommendation_pageAggregateId_idx" ON "StoreSnapshotRecommendation"("pageAggregateId");

-- AddForeignKey
ALTER TABLE "StoreSnapshotVisit" ADD CONSTRAINT "StoreSnapshotVisit_storeSnapshotId_fkey" FOREIGN KEY ("storeSnapshotId") REFERENCES "StoreSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSnapshotStatsCache" ADD CONSTRAINT "StoreSnapshotStatsCache_storeSnapshotId_fkey" FOREIGN KEY ("storeSnapshotId") REFERENCES "StoreSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSnapshotPageAggregate" ADD CONSTRAINT "StoreSnapshotPageAggregate_storeSnapshotId_fkey" FOREIGN KEY ("storeSnapshotId") REFERENCES "StoreSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSnapshotRecommendation" ADD CONSTRAINT "StoreSnapshotRecommendation_storeSnapshotId_fkey" FOREIGN KEY ("storeSnapshotId") REFERENCES "StoreSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSnapshotRecommendation" ADD CONSTRAINT "StoreSnapshotRecommendation_pageAggregateId_fkey" FOREIGN KEY ("pageAggregateId") REFERENCES "StoreSnapshotPageAggregate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
