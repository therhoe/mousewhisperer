-- CreateEnum
CREATE TYPE "SnapshotStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'PAUSED');

-- CreateEnum
CREATE TYPE "VisitorType" AS ENUM ('PENDING', 'REAL', 'ZOMBIE', 'BOT');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "productHandle" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT,
    "targetVisitors" INTEGER NOT NULL DEFAULT 1000,
    "status" "SnapshotStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "visitorType" "VisitorType" NOT NULL DEFAULT 'PENDING',
    "sessionId" TEXT NOT NULL,
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
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "deviceType" TEXT,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_shop_idx" ON "Project"("shop");

-- CreateIndex
CREATE INDEX "Project_productId_idx" ON "Project"("productId");

-- CreateIndex
CREATE INDEX "Project_productHandle_idx" ON "Project"("productHandle");

-- CreateIndex
CREATE INDEX "Snapshot_projectId_idx" ON "Snapshot"("projectId");

-- CreateIndex
CREATE INDEX "Snapshot_status_idx" ON "Snapshot"("status");

-- CreateIndex
CREATE INDEX "Snapshot_projectId_status_idx" ON "Snapshot"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Snapshot_projectId_number_key" ON "Snapshot"("projectId", "number");

-- CreateIndex
CREATE INDEX "Visit_snapshotId_idx" ON "Visit"("snapshotId");

-- CreateIndex
CREATE INDEX "Visit_visitorType_idx" ON "Visit"("visitorType");

-- CreateIndex
CREATE INDEX "Visit_sourceCategory_idx" ON "Visit"("sourceCategory");

-- CreateIndex
CREATE INDEX "Visit_sessionId_idx" ON "Visit"("sessionId");

-- CreateIndex
CREATE INDEX "Visit_country_idx" ON "Visit"("country");

-- CreateIndex
CREATE INDEX "Visit_startedAt_idx" ON "Visit"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_sessionId_snapshotId_key" ON "Visit"("sessionId", "snapshotId");

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
