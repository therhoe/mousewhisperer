-- Additive migration: existing Store and Page Snapshots are not rewritten.
BEGIN;

CREATE TYPE "ChannelSnapshotCompletionMode" AS ENUM ('HUMAN_SESSIONS', 'TOTAL_SESSIONS', 'TIME_WINDOW');

CREATE TABLE "ChannelSnapshot" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "SnapshotStatus" NOT NULL DEFAULT 'ACTIVE',
  "completionMode" "ChannelSnapshotCompletionMode" NOT NULL DEFAULT 'HUMAN_SESSIONS',
  "targetSessions" INTEGER,
  "durationDays" INTEGER,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelSnapshotSession" (
  "id" TEXT NOT NULL,
  "channelSnapshotId" TEXT NOT NULL,
  "acquisitionId" TEXT NOT NULL,
  "trackingSessionId" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'Unknown',
  "source" TEXT,
  "medium" TEXT,
  "campaign" TEXT,
  "referrer" TEXT,
  "landingPath" TEXT,
  "acquiredAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "addedToCart" BOOLEAN NOT NULL DEFAULT false,
  "checkoutStarted" BOOLEAN NOT NULL DEFAULT false,
  "checkoutStartedAt" TIMESTAMP(3),
  "converted" BOOLEAN NOT NULL DEFAULT false,
  "convertedAt" TIMESTAMP(3),
  CONSTRAINT "ChannelSnapshotSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelSnapshotVisit" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "pageViewId" TEXT NOT NULL,
  "pagePath" TEXT NOT NULL,
  "visitorType" "VisitorType" NOT NULL DEFAULT 'PENDING',
  "timeOnPage" INTEGER NOT NULL DEFAULT 0,
  "scrollDepth" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelSnapshotVisit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChannelSnapshot_shop_status_idx" ON "ChannelSnapshot"("shop", "status");
CREATE INDEX "ChannelSnapshot_shop_startedAt_idx" ON "ChannelSnapshot"("shop", "startedAt");
-- Enforce one active channel capture per shop, including concurrent start/resume requests.
CREATE UNIQUE INDEX "ChannelSnapshot_one_active_per_shop" ON "ChannelSnapshot"("shop") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "ChannelSnapshotSession_channelSnapshotId_acquisitionId_key" ON "ChannelSnapshotSession"("channelSnapshotId", "acquisitionId");
CREATE INDEX "ChannelSnapshotSession_channelSnapshotId_channel_idx" ON "ChannelSnapshotSession"("channelSnapshotId", "channel");
CREATE INDEX "ChannelSnapshotSession_trackingSessionId_lastSeenAt_idx" ON "ChannelSnapshotSession"("trackingSessionId", "lastSeenAt");
CREATE UNIQUE INDEX "ChannelSnapshotVisit_sessionId_pageViewId_key" ON "ChannelSnapshotVisit"("sessionId", "pageViewId");
CREATE INDEX "ChannelSnapshotVisit_sessionId_visitorType_idx" ON "ChannelSnapshotVisit"("sessionId", "visitorType");
ALTER TABLE "ChannelSnapshotSession" ADD CONSTRAINT "ChannelSnapshotSession_channelSnapshotId_fkey" FOREIGN KEY ("channelSnapshotId") REFERENCES "ChannelSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelSnapshotVisit" ADD CONSTRAINT "ChannelSnapshotVisit_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChannelSnapshotSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
