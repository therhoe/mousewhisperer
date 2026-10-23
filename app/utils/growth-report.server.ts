import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { GrowthProjectError } from "./growth-projects";
import { buildEngagementOutcomes } from "./click-engagement";
import type { GrowthReport, GrowthReportFilters } from "./growth-report";
export async function getGrowthMeasurementReport(
  shop: string,
  projectId: string,
  measurementId: string,
  filters: GrowthReportFilters,
): Promise<GrowthReport> {
  const capture = await prisma.growthMeasurement.findFirst({
    where: { id: measurementId, projectId, project: { shop } },
  });
  if (!capture) throw new GrowthProjectError("Measurement not found.", 404);
  let rows: Prisma.Sql;
  if (capture.snapshotId || capture.storeSnapshotId) {
    const table = capture.snapshotId
      ? Prisma.sql`"Visit"`
      : Prisma.sql`"StoreSnapshotVisit"`;
    const constraint = capture.snapshotId
      ? Prisma.sql`"snapshotId" = ${capture.snapshotId}`
      : Prisma.sql`"storeSnapshotId" = ${capture.storeSnapshotId}`;
    rows = Prisma.sql`SELECT COALESCE("acquisitionId", "sessionId") AS id, COALESCE("acquisitionStartedAt", "startedAt") AS "startedAt", "visitorType"::text AS kind,
      CASE WHEN "acquisitionId" IS NOT NULL THEN "acquisitionSource" ELSE source END AS source,
      CASE WHEN "acquisitionId" IS NOT NULL THEN "acquisitionMedium" ELSE medium END AS medium,
      CASE WHEN "acquisitionId" IS NOT NULL THEN "acquisitionCampaign" ELSE campaign END AS campaign,
      "addedToCart", converted, 1 AS views, "timeOnPage"::float AS time, "scrollDepth"::float AS scroll, "ctaClicks" FROM ${table} WHERE ${constraint}`;
  } else if (capture.channelSnapshotId) {
    rows = Prisma.sql`SELECT s.id, s."startedAt", COALESCE(v."visitorType"::text, 'PENDING') AS kind, s.source, s.medium, s.campaign,
      s."addedToCart", s.converted, CASE WHEN v.id IS NULL THEN 0 ELSE 1 END AS views,
      COALESCE(v."timeOnPage",0)::float AS time, COALESCE(v."scrollDepth",0)::float AS scroll, NULL::text AS "ctaClicks"
      FROM "ChannelSnapshotSession" s LEFT JOIN "ChannelSnapshotVisit" v ON v."sessionId" = s.id WHERE s."channelSnapshotId" = ${capture.channelSnapshotId}`;
  } else if (capture.customerSnapshotId) {
    rows = Prisma.sql`SELECT s.id, s."startedAt", s."visitorType"::text AS kind, s.source, s.medium, s.campaign,
      s."addedToCart", s.converted, CASE WHEN p.id IS NULL THEN 0 ELSE 1 END AS views,
      COALESCE(p."timeOnPage",0)::float AS time, COALESCE(p."scrollDepth",0)::float AS scroll, NULL::text AS "ctaClicks"
      FROM "CustomerJourneySession" s LEFT JOIN "CustomerJourneyPage" p ON p."sessionId" = s.id WHERE s."snapshotId" = ${capture.customerSnapshotId}`;
  } else throw new GrowthProjectError("Measurement data is unavailable.", 404);
  // Group before filtering so the numerator and denominator share an audience.
  // This is read-only reporting; filters never change capture or attribution.
  const cohort = Prisma.sql`${filters.audience === "active" ? Prisma.sql`kind = 'REAL'` : Prisma.sql`TRUE`}
    AND (${filters.source} = '' OR lower(source) = lower(${filters.source}))
    AND (${filters.medium} = '' OR lower(medium) = lower(${filters.medium}))
    AND (${filters.campaign} = '' OR lower(campaign) = lower(${filters.campaign}))`;
  type ClickRow = {
    sessionId: string;
    ctaClicks: string | null;
    addedToCart: boolean;
    converted: boolean;
  };
  const results = await prisma.$queryRaw<
    Array<{ report: GrowthReport & { clickRows: ClickRow[] } }>
  >(Prisma.sql`
    WITH raw AS (${rows}), sessions AS (
      SELECT id, MIN("startedAt") AS started,
        CASE WHEN bool_or(kind = 'REAL') THEN 'REAL' WHEN bool_or(kind = 'ZOMBIE') THEN 'ZOMBIE' WHEN bool_or(kind = 'BOT') THEN 'BOT' ELSE 'PENDING' END AS kind,
        COALESCE((array_agg(source ORDER BY "startedAt"))[1], 'unknown') AS source,
        COALESCE((array_agg(medium ORDER BY "startedAt"))[1], '') AS medium,
        COALESCE((array_agg(campaign ORDER BY "startedAt"))[1], '') AS campaign,
        bool_or("addedToCart") AS cart, bool_or(converted) AS converted, SUM(views) AS views, SUM(time) AS time, AVG(scroll) AS scroll
      FROM raw GROUP BY id
    ), filtered AS (SELECT * FROM sessions WHERE ${cohort}),
    daily AS (SELECT to_char(started,'YYYY-MM-DD') AS date, count(*) AS sessions,
      count(*) FILTER (WHERE converted) AS conversions, 100.0 * count(*) FILTER (WHERE converted) / NULLIF(count(*),0) AS "conversionRate"
      FROM filtered GROUP BY date ORDER BY date),
    channels AS (SELECT source, medium, campaign, count(*) AS sessions, count(*) FILTER (WHERE cart) AS "addedToCart", count(*) FILTER (WHERE converted) AS conversions,
      100.0 * count(*) FILTER (WHERE converted) / NULLIF(count(*),0) AS "conversionRate" FROM filtered GROUP BY source,medium,campaign ORDER BY count(*) DESC,source,medium,campaign)
    SELECT json_build_object('sessions',count(*),'addedToCart',count(*) FILTER (WHERE cart),'conversions',count(*) FILTER (WHERE converted),
      'conversionRate',COALESCE(100.0 * count(*) FILTER (WHERE converted)/NULLIF(count(*),0),0),
      'atcRate',COALESCE(100.0 * count(*) FILTER (WHERE cart)/NULLIF(count(*),0),0),
      'pageViews',COALESCE(sum(views),0),'averageTime',COALESCE(avg(time)/1000,0),'averageScroll',COALESCE(avg(scroll),0),
      'series',COALESCE((SELECT json_agg(daily) FROM daily),'[]'::json),
      'channels',COALESCE((SELECT json_agg(channels) FROM channels),'[]'::json),
      'sources',COALESCE((SELECT json_agg(source) FROM (SELECT DISTINCT source FROM sessions ORDER BY source) options),'[]'::json),
      'clickRows',COALESCE((SELECT json_agg(clicks) FROM (
        SELECT raw.id AS "sessionId", raw."ctaClicks", filtered.cart AS "addedToCart", filtered.converted FROM raw JOIN filtered USING(id)
        WHERE raw."ctaClicks" IS NOT NULL AND raw."ctaClicks" NOT IN ('[]','{}','') LIMIT 20001
      ) clicks),'[]'::json)) AS report FROM filtered
  `);
  const { clickRows, ...report } = results[0].report;
  // Do not show sampled engagement totals as complete; summaries above are always full-cohort.
  return {
    ...report,
    engagement:
      clickRows.length > 20000 ? null : buildEngagementOutcomes(clickRows),
    engagementUnavailable: clickRows.length > 20000,
  };
}
