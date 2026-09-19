BEGIN;
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PRIVACY_REQUEST';
CREATE TABLE "CustomerSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY, "shop" TEXT NOT NULL, "name" TEXT NOT NULL,
  "status" "SnapshotStatus" NOT NULL DEFAULT 'ACTIVE',
  "source" TEXT NOT NULL, "medium" TEXT, "campaign" TEXT, "adId" TEXT,
  "destinationUrl" TEXT NOT NULL, "targetSessions" INTEGER,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3) NOT NULL, "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "CustomerJourneySession" (
  "id" TEXT NOT NULL PRIMARY KEY, "snapshotId" TEXT NOT NULL, "acquisitionId" TEXT NOT NULL,
  "trackingSessionId" TEXT NOT NULL, "source" TEXT NOT NULL, "medium" TEXT, "campaign" TEXT, "adId" TEXT,
  "landingPath" TEXT NOT NULL, "startedAt" TIMESTAMP(3) NOT NULL, "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "visitorType" "VisitorType" NOT NULL DEFAULT 'PENDING',
  "addedToCart" BOOLEAN NOT NULL DEFAULT false, "checkoutStarted" BOOLEAN NOT NULL DEFAULT false,
  "converted" BOOLEAN NOT NULL DEFAULT false, "truncated" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "CustomerJourneySession_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "CustomerSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "CustomerJourneyPage" (
  "id" TEXT NOT NULL PRIMARY KEY, "sessionId" TEXT NOT NULL, "pageViewId" TEXT NOT NULL,
  "pagePath" TEXT NOT NULL, "startedAt" TIMESTAMP(3) NOT NULL,
  "timeOnPage" INTEGER NOT NULL DEFAULT 0, "scrollDepth" INTEGER NOT NULL DEFAULT 0,
  "visitorType" "VisitorType" NOT NULL DEFAULT 'PENDING',
  CONSTRAINT "CustomerJourneyPage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CustomerJourneySession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "CustomerJourneyEvent" (
  "id" TEXT NOT NULL PRIMARY KEY, "sessionId" TEXT NOT NULL, "eventKey" TEXT NOT NULL,
  "type" TEXT NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL,
  "pagePath" TEXT, "label" TEXT, "targetPath" TEXT, "orderId" TEXT,
  "amount" DOUBLE PRECISION, "currency" TEXT,
  CONSTRAINT "CustomerJourneyEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CustomerJourneySession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CustomerSnapshot_shop_status_endsAt_idx" ON "CustomerSnapshot"("shop", "status", "endsAt");
CREATE INDEX "CustomerSnapshot_shop_startedAt_idx" ON "CustomerSnapshot"("shop", "startedAt");
CREATE UNIQUE INDEX "CustomerSnapshot_one_active_per_shop" ON "CustomerSnapshot"("shop") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "CustomerJourneySession_snapshotId_acquisitionId_key" ON "CustomerJourneySession"("snapshotId", "acquisitionId");
CREATE INDEX "CustomerJourneySession_snapshotId_startedAt_id_idx" ON "CustomerJourneySession"("snapshotId", "startedAt", "id");
CREATE INDEX "CustomerJourneySession_trackingSessionId_acquisitionId_idx" ON "CustomerJourneySession"("trackingSessionId", "acquisitionId");
CREATE UNIQUE INDEX "CustomerJourneyPage_sessionId_pageViewId_key" ON "CustomerJourneyPage"("sessionId", "pageViewId");
CREATE UNIQUE INDEX "CustomerJourneyEvent_sessionId_eventKey_key" ON "CustomerJourneyEvent"("sessionId", "eventKey");
CREATE INDEX "CustomerJourneyEvent_sessionId_occurredAt_id_idx" ON "CustomerJourneyEvent"("sessionId", "occurredAt", "id");
CREATE INDEX "CustomerJourneyEvent_orderId_idx" ON "CustomerJourneyEvent"("orderId");
COMMIT;
