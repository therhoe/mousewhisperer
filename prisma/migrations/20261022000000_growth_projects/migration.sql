-- Additive, replay-safe project migration. Capture records and existing report IDs stay intact.
BEGIN;
DO $$ BEGIN CREATE TYPE "GrowthProjectScope" AS ENUM ('STORE', 'PAGE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "GrowthMeasurementCompletionMode" AS ENUM ('VISITORS', 'DURATION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "Snapshot" ADD COLUMN IF NOT EXISTS "endsAt" TIMESTAMP(3);
ALTER TABLE "Snapshot" ADD COLUMN IF NOT EXISTS "usesAcquisitionSessions" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreSnapshot" ADD COLUMN IF NOT EXISTS "usesAcquisitionSessions" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "acquisitionId" TEXT;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "acquisitionSource" TEXT;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "acquisitionMedium" TEXT;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "acquisitionCampaign" TEXT;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "acquisitionStartedAt" TIMESTAMP(3);
ALTER TABLE "StoreSnapshotVisit" ADD COLUMN IF NOT EXISTS "acquisitionId" TEXT;
ALTER TABLE "StoreSnapshotVisit" ADD COLUMN IF NOT EXISTS "acquisitionSource" TEXT;
ALTER TABLE "StoreSnapshotVisit" ADD COLUMN IF NOT EXISTS "acquisitionMedium" TEXT;
ALTER TABLE "StoreSnapshotVisit" ADD COLUMN IF NOT EXISTS "acquisitionCampaign" TEXT;
ALTER TABLE "StoreSnapshotVisit" ADD COLUMN IF NOT EXISTS "acquisitionStartedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Visit_snapshotId_acquisitionId_visitorType_idx" ON "Visit"("snapshotId", "acquisitionId", "visitorType");
CREATE INDEX IF NOT EXISTS "Visit_snapshotId_sessionId_idx" ON "Visit"("snapshotId", "sessionId");
CREATE INDEX IF NOT EXISTS "StoreVisit_growth_acquisition_idx" ON "StoreSnapshotVisit"("storeSnapshotId", "acquisitionId", "visitorType");
ALTER TABLE "CustomerSnapshot" ADD COLUMN IF NOT EXISTS "captureAllSources" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerSnapshot" ALTER COLUMN "endsAt" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "GrowthProject" (
  "id" TEXT PRIMARY KEY, "shop" TEXT NOT NULL, "title" TEXT NOT NULL, "goal" TEXT NOT NULL,
  "scope" "GrowthProjectScope" NOT NULL, "resourceProjectId" TEXT,
  "defaultSource" TEXT, "defaultMedium" TEXT, "defaultCampaign" TEXT,
  "journeyTracking" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GrowthProject_resourceProjectId_fkey" FOREIGN KEY ("resourceProjectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GrowthProject_scope_check" CHECK (("scope" = 'PAGE' AND "resourceProjectId" IS NOT NULL AND NOT "journeyTracking") OR ("scope" = 'STORE' AND "resourceProjectId" IS NULL))
);
CREATE INDEX IF NOT EXISTS "GrowthProject_shop_updatedAt_idx" ON "GrowthProject"("shop", "updatedAt");
CREATE INDEX IF NOT EXISTS "GrowthProject_resourceProjectId_idx" ON "GrowthProject"("resourceProjectId");

CREATE TABLE IF NOT EXISTS "GrowthMeasurement" (
  "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "completionMode" "GrowthMeasurementCompletionMode" NOT NULL,
  "targetVisitors" INTEGER, "durationDays" INTEGER,
  "snapshotId" TEXT, "storeSnapshotId" TEXT, "channelSnapshotId" TEXT, "customerSnapshotId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GrowthMeasurement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "GrowthProject"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GrowthMeasurement_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GrowthMeasurement_storeSnapshotId_fkey" FOREIGN KEY ("storeSnapshotId") REFERENCES "StoreSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GrowthMeasurement_channelSnapshotId_fkey" FOREIGN KEY ("channelSnapshotId") REFERENCES "ChannelSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GrowthMeasurement_customerSnapshotId_fkey" FOREIGN KEY ("customerSnapshotId") REFERENCES "CustomerSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GrowthMeasurement_completion_check" CHECK (("completionMode" = 'VISITORS' AND "targetVisitors" > 0 AND "durationDays" IS NULL) OR ("completionMode" = 'DURATION' AND "durationDays" > 0 AND "targetVisitors" IS NULL)),
  CONSTRAINT "GrowthMeasurement_capture_check" CHECK (
    ("snapshotId" IS NOT NULL AND "storeSnapshotId" IS NULL AND "channelSnapshotId" IS NULL AND "customerSnapshotId" IS NULL) OR
    ("storeSnapshotId" IS NOT NULL AND "snapshotId" IS NULL AND "channelSnapshotId" IS NULL) OR
    ("channelSnapshotId" IS NOT NULL AND "snapshotId" IS NULL AND "storeSnapshotId" IS NULL AND "customerSnapshotId" IS NULL) OR
    ("customerSnapshotId" IS NOT NULL AND "snapshotId" IS NULL AND "storeSnapshotId" IS NULL AND "channelSnapshotId" IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthMeasurement_snapshotId_key" ON "GrowthMeasurement"("snapshotId");
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthMeasurement_storeSnapshotId_key" ON "GrowthMeasurement"("storeSnapshotId");
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthMeasurement_channelSnapshotId_key" ON "GrowthMeasurement"("channelSnapshotId");
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthMeasurement_customerSnapshotId_key" ON "GrowthMeasurement"("customerSnapshotId");
CREATE INDEX IF NOT EXISTS "GrowthMeasurement_projectId_createdAt_idx" ON "GrowthMeasurement"("projectId", "createdAt");

CREATE TABLE IF NOT EXISTS "GrowthProjectActivity" (
  "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GrowthProjectActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "GrowthProject"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "GrowthProjectActivity_projectId_createdAt_idx" ON "GrowthProjectActivity"("projectId", "createdAt");

ALTER TABLE "AbTest" ADD COLUMN IF NOT EXISTS "growthProjectId" TEXT;
ALTER TABLE "AbTest" ADD COLUMN IF NOT EXISTS "targetPagePath" TEXT;
DO $$ BEGIN ALTER TABLE "AbTest" ADD CONSTRAINT "AbTest_growthProjectId_fkey" FOREIGN KEY ("growthProjectId") REFERENCES "GrowthProject"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "AbTest_growthProjectId_idx" ON "AbTest"("growthProjectId");

-- One ongoing page Project keeps its entire sequence of measurements.
INSERT INTO "GrowthProject" ("id", "shop", "title", "goal", "scope", "resourceProjectId", "createdAt", "updatedAt")
SELECT 'gp_page_' || p.id, p.shop, p."productTitle", '', 'PAGE', p.id, p."createdAt", p."updatedAt" FROM "Project" p
WHERE NOT EXISTS (SELECT 1 FROM "GrowthProject" g WHERE g."resourceProjectId" = p.id) ON CONFLICT DO NOTHING;
INSERT INTO "GrowthMeasurement" ("id", "projectId", "name", "completionMode", "targetVisitors", "durationDays", "snapshotId", "createdAt", "updatedAt")
SELECT 'gm_page_' || s.id, 'gp_page_' || s."projectId", COALESCE(s.name, 'Measurement ' || s.number),
  CASE WHEN s."endsAt" IS NULL THEN 'VISITORS' ELSE 'DURATION' END::"GrowthMeasurementCompletionMode",
  CASE WHEN s."endsAt" IS NULL THEN GREATEST(s."targetVisitors", 1) ELSE NULL END,
  CASE WHEN s."endsAt" IS NOT NULL THEN GREATEST(1, CEIL(EXTRACT(EPOCH FROM (s."endsAt" - s."createdAt")) / 86400)::int) ELSE NULL END,
  s.id, s."createdAt", s."updatedAt" FROM "Snapshot" s
WHERE EXISTS (SELECT 1 FROM "GrowthProject" g WHERE g.id = 'gp_page_' || s."projectId") ON CONFLICT DO NOTHING;

INSERT INTO "GrowthProject" ("id", "shop", "title", "goal", "scope", "createdAt", "updatedAt")
SELECT 'gp_store_' || s.id, s.shop, COALESCE(s.name, 'Store project'), '', 'STORE', s."createdAt", s."updatedAt" FROM "StoreSnapshot" s
WHERE NOT EXISTS (SELECT 1 FROM "GrowthMeasurement" m WHERE m."storeSnapshotId" = s.id) ON CONFLICT DO NOTHING;
INSERT INTO "GrowthMeasurement" ("id", "projectId", "name", "completionMode", "targetVisitors", "durationDays", "storeSnapshotId", "createdAt", "updatedAt")
SELECT 'gm_store_' || s.id, 'gp_store_' || s.id, COALESCE(s.name, 'Imported measurement'),
  CASE WHEN s."completionMode" = 'TIME_WINDOW' THEN 'DURATION' ELSE 'VISITORS' END::"GrowthMeasurementCompletionMode",
  CASE WHEN s."completionMode" <> 'TIME_WINDOW' THEN GREATEST(COALESCE(s."targetHumanVisitors", s."targetTotalVisits", 100), 1) ELSE NULL END,
  CASE WHEN s."completionMode" = 'TIME_WINDOW' THEN GREATEST(COALESCE(s."durationDays", 7), 1) ELSE NULL END,
  s.id, s."createdAt", s."updatedAt" FROM "StoreSnapshot" s
WHERE EXISTS (SELECT 1 FROM "GrowthProject" g WHERE g.id = 'gp_store_' || s.id) ON CONFLICT DO NOTHING;

INSERT INTO "GrowthProject" ("id", "shop", "title", "goal", "scope", "createdAt", "updatedAt")
SELECT 'gp_channel_' || s.id, s.shop, s.name, '', 'STORE', s."createdAt", s."updatedAt" FROM "ChannelSnapshot" s
WHERE NOT EXISTS (SELECT 1 FROM "GrowthMeasurement" m WHERE m."channelSnapshotId" = s.id) ON CONFLICT DO NOTHING;
INSERT INTO "GrowthMeasurement" ("id", "projectId", "name", "completionMode", "targetVisitors", "durationDays", "channelSnapshotId", "createdAt", "updatedAt")
SELECT 'gm_channel_' || s.id, 'gp_channel_' || s.id, s.name,
  CASE WHEN s."completionMode" = 'TIME_WINDOW' THEN 'DURATION' ELSE 'VISITORS' END::"GrowthMeasurementCompletionMode",
  CASE WHEN s."completionMode" <> 'TIME_WINDOW' THEN GREATEST(COALESCE(s."targetSessions", 100), 1) ELSE NULL END,
  CASE WHEN s."completionMode" = 'TIME_WINDOW' THEN GREATEST(COALESCE(s."durationDays", 7), 1) ELSE NULL END,
  s.id, s."createdAt", s."updatedAt" FROM "ChannelSnapshot" s
WHERE EXISTS (SELECT 1 FROM "GrowthProject" g WHERE g.id = 'gp_channel_' || s.id) ON CONFLICT DO NOTHING;

INSERT INTO "GrowthProject" ("id", "shop", "title", "goal", "scope", "journeyTracking", "defaultSource", "defaultMedium", "defaultCampaign", "createdAt", "updatedAt")
SELECT 'gp_customer_' || s.id, s.shop, s.name, '', 'STORE', true, CASE WHEN s."captureAllSources" THEN NULL ELSE s.source END, s.medium, s.campaign, s."createdAt", s."createdAt" FROM "CustomerSnapshot" s
WHERE NOT EXISTS (SELECT 1 FROM "GrowthMeasurement" m WHERE m."customerSnapshotId" = s.id) ON CONFLICT DO NOTHING;
INSERT INTO "GrowthMeasurement" ("id", "projectId", "name", "completionMode", "targetVisitors", "durationDays", "customerSnapshotId", "createdAt", "updatedAt")
SELECT 'gm_customer_' || s.id, 'gp_customer_' || s.id, s.name,
  CASE WHEN s."endsAt" IS NULL THEN 'VISITORS' ELSE 'DURATION' END::"GrowthMeasurementCompletionMode",
  CASE WHEN s."endsAt" IS NULL THEN GREATEST(COALESCE(s."targetSessions", 100), 1) ELSE NULL END,
  CASE WHEN s."endsAt" IS NOT NULL THEN GREATEST(1, CEIL(EXTRACT(EPOCH FROM (s."endsAt" - s."startedAt")) / 86400)::int) ELSE NULL END,
  s.id, s."createdAt", s."createdAt" FROM "CustomerSnapshot" s
WHERE EXISTS (SELECT 1 FROM "GrowthProject" g WHERE g.id = 'gp_customer_' || s.id) ON CONFLICT DO NOTHING;

-- Keep tests with an explicit, same-shop source measurement; never infer ownership from a title.
UPDATE "AbTest" a SET "growthProjectId" = m."projectId"
FROM "GrowthMeasurement" m JOIN "GrowthProject" g ON g.id = m."projectId"
WHERE a."growthProjectId" IS NULL AND a.shop = g.shop AND (
  (a."sourceSnapshotKind" IN ('page', 'PAGE', 'snapshot') AND a."sourceSnapshotId" = m."snapshotId") OR
  (a."sourceSnapshotKind" IN ('store', 'STORE') AND a."sourceSnapshotId" = m."storeSnapshotId")
);
INSERT INTO "GrowthProject" ("id", "shop", "title", "goal", "scope", "createdAt", "updatedAt")
SELECT 'gp_ab_' || a.id, a.shop, a.name, '', 'STORE', a."createdAt", a."updatedAt" FROM "AbTest" a WHERE a."growthProjectId" IS NULL ON CONFLICT DO NOTHING;
UPDATE "AbTest" a SET "growthProjectId" = 'gp_ab_' || a.id
WHERE a."growthProjectId" IS NULL AND EXISTS (SELECT 1 FROM "GrowthProject" g WHERE g.id = 'gp_ab_' || a.id AND g.shop = a.shop);
COMMIT;
