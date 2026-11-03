import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { GrowthProjectError } from "./growth-projects";
import { buildEngagementOutcomes } from "./click-engagement";
import { EXIT_OUTCOMES, rankGrowthPages } from "./growth-report";
import type {
  GrowthEngagementSummary,
  GrowthExitPaths,
  GrowthPageRow,
  GrowthPageType,
  GrowthReport,
  GrowthReportFilters,
} from "./growth-report";
// Shopify Markets paths can carry a locale prefix such as /fr or /en-us, and themes
// that use `product.url | within: collection` link to /collections/<handle>/products/<handle>.
const PRODUCT_PATH = "^(/[a-z]{2}(-[a-z]{2})?)?(/collections/[^/]+)?/products/";
const PRIVATE_PATH = "/(account|accounts|checkouts|orders)(/|$)";
type ClickRow = {
  sessionId: string;
  ctaClicks: string | null;
  addedToCart: boolean;
  converted: boolean;
};
type QueryReport = Omit<
  GrowthReport,
  | "layout"
  | "pageType"
  | "funnel"
  | "engagementSummary"
  | "exitPaths"
  | "pages"
  | "engagement"
  | "engagementUnavailable"
> & {
  clickRows: ClickRow[];
  checkoutStarted: number;
  timeMedian: number;
  pagesPerSession: number;
  viewScroll: number;
  clickThroughRate: number;
  searchRate: number;
  devices: GrowthEngagementSummary["devices"];
  searches: GrowthEngagementSummary["topSearches"];
  exits: Array<{ type: string; pageViews: number; share: number }>;
  nextPages: GrowthExitPaths["nextPages"];
  exitPages: GrowthExitPaths["exitPages"];
  pageRows: GrowthPageRow[];
};
export async function getGrowthMeasurementReport(
  shop: string,
  projectId: string,
  measurementId: string,
  filters: GrowthReportFilters,
): Promise<GrowthReport> {
  const capture = await prisma.growthMeasurement.findFirst({
    where: { id: measurementId, projectId, project: { shop } },
    include: {
      project: {
        select: {
          scope: true,
          resourceProject: { select: { resourceType: true } },
        },
      },
    },
  });
  if (!capture) throw new GrowthProjectError("Measurement not found.", 404);
  const layout = capture.project.scope === "STORE" ? "store" : "page";
  const pageType = (capture.project.resourceProject?.resourceType ??
    null) as GrowthPageType | null;
  // Imported Channel/Customer captures never recorded exits, devices, searches or clicks.
  const detailed = Boolean(capture.snapshotId || capture.storeSnapshotId);
  let rows: Prisma.Sql;
  if (capture.snapshotId || capture.storeSnapshotId) {
    const table = capture.snapshotId
      ? Prisma.sql`"Visit"`
      : Prisma.sql`"StoreSnapshotVisit"`;
    const constraint = capture.snapshotId
      ? Prisma.sql`"snapshotId" = ${capture.snapshotId}`
      : Prisma.sql`"storeSnapshotId" = ${capture.storeSnapshotId}`;
    // Page captures only record the Project's own page, so its type is the Project's.
    const path = capture.snapshotId ? Prisma.sql`NULL::text` : Prisma.sql`"pagePath"`;
    const type = capture.snapshotId
      ? Prisma.sql`CAST(${pageType} AS text)`
      : Prisma.sql`"resourceType"::text`;
    rows = Prisma.sql`SELECT COALESCE("acquisitionId", "sessionId") AS id, COALESCE("acquisitionStartedAt", "startedAt") AS "startedAt", "startedAt" AS "viewedAt", "visitorType"::text AS kind,
      CASE WHEN "acquisitionId" IS NOT NULL THEN "acquisitionSource" ELSE source END AS source,
      CASE WHEN "acquisitionId" IS NOT NULL THEN "acquisitionMedium" ELSE medium END AS medium,
      CASE WHEN "acquisitionId" IS NOT NULL THEN "acquisitionCampaign" ELSE campaign END AS campaign,
      "addedToCart", "checkoutStarted" AS checkout, converted, 1 AS views, "timeOnPage"::float AS time, "scrollDepth"::float AS scroll, "ctaClicks",
      ${path} AS path, ${type} AS "type", "exitType", "exitUrl", "deviceType" AS device, "searchQuery" AS search
      FROM ${table} WHERE ${constraint}`;
  } else if (capture.channelSnapshotId) {
    rows = Prisma.sql`SELECT s.id, s."startedAt", COALESCE(v."startedAt", s."startedAt") AS "viewedAt", COALESCE(v."visitorType"::text, 'PENDING') AS kind, s.source, s.medium, s.campaign,
      s."addedToCart", s."checkoutStarted" AS checkout, s.converted, CASE WHEN v.id IS NULL THEN 0 ELSE 1 END AS views,
      COALESCE(v."timeOnPage",0)::float AS time, COALESCE(v."scrollDepth",0)::float AS scroll, NULL::text AS "ctaClicks",
      NULL::text AS path, NULL::text AS "type", NULL::text AS "exitType", NULL::text AS "exitUrl", NULL::text AS device, NULL::text AS search
      FROM "ChannelSnapshotSession" s LEFT JOIN "ChannelSnapshotVisit" v ON v."sessionId" = s.id WHERE s."channelSnapshotId" = ${capture.channelSnapshotId}`;
  } else if (capture.customerSnapshotId) {
    rows = Prisma.sql`SELECT s.id, s."startedAt", COALESCE(p."startedAt", s."startedAt") AS "viewedAt", s."visitorType"::text AS kind, s.source, s.medium, s.campaign,
      s."addedToCart", s."checkoutStarted" AS checkout, s.converted, CASE WHEN p.id IS NULL THEN 0 ELSE 1 END AS views,
      COALESCE(p."timeOnPage",0)::float AS time, COALESCE(p."scrollDepth",0)::float AS scroll, NULL::text AS "ctaClicks",
      NULL::text AS path, NULL::text AS "type", NULL::text AS "exitType", NULL::text AS "exitUrl", NULL::text AS device, NULL::text AS search
      FROM "CustomerJourneySession" s LEFT JOIN "CustomerJourneyPage" p ON p."sessionId" = s.id WHERE s."snapshotId" = ${capture.customerSnapshotId}`;
  } else throw new GrowthProjectError("Measurement data is unavailable.", 404);
  // Group before filtering so the numerator and denominator share an audience.
  // This is read-only reporting; filters never change capture or attribution.
  const cohort = Prisma.sql`${filters.audience === "active" ? Prisma.sql`kind = 'REAL'` : Prisma.sql`TRUE`}
    AND (${filters.source} = '' OR lower(source) = lower(${filters.source}))
    AND (${filters.medium} = '' OR lower(medium) = lower(${filters.medium}))
    AND (${filters.campaign} = '' OR lower(campaign) = lower(${filters.campaign}))`;
  const results = await prisma.$queryRaw<Array<{ report: QueryReport }>>(Prisma.sql`
    WITH raw AS (${rows}), parsed AS (
      -- exitUrl is set by the tracker for link clicks; the cart/checkout links are typed "checkout".
      SELECT raw.*,
        CASE WHEN "exitType" = 'internal_link' THEN regexp_replace(regexp_replace("exitUrl", '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]*', ''), '[?#].*$', '') END AS "exitPath",
        -- Nested CASE: the jsonb cast must only run on valid JSON (truncated payloads exist).
        CASE WHEN pg_input_is_valid("ctaClicks", 'jsonb') THEN
          CASE WHEN jsonb_typeof("ctaClicks"::jsonb) = 'array' THEN lower("ctaClicks"::jsonb -> -1 ->> 'zone') END
        END AS "lastZone"
      FROM raw
    ), marked AS (
      -- A forward click left from the main content to another store page; collections only to a product.
      SELECT parsed.*, COALESCE(
        "exitPath" LIKE '/%'
        AND ("type" IS DISTINCT FROM 'COLLECTION' OR "exitPath" ~* ${PRODUCT_PATH})
        AND COALESCE("lastZone", '') NOT IN ('header', 'footer'), false) AS forward
      FROM parsed
    ), sessions AS (
      SELECT id, MIN("startedAt") AS started,
        CASE WHEN bool_or(kind = 'REAL') THEN 'REAL' WHEN bool_or(kind = 'ZOMBIE') THEN 'ZOMBIE' WHEN bool_or(kind = 'BOT') THEN 'BOT' ELSE 'PENDING' END AS kind,
        COALESCE((array_agg(source ORDER BY "startedAt"))[1], 'unknown') AS source,
        COALESCE((array_agg(medium ORDER BY "startedAt"))[1], '') AS medium,
        COALESCE((array_agg(campaign ORDER BY "startedAt"))[1], '') AS campaign,
        bool_or("addedToCart") AS cart, bool_or(checkout) AS checkout, bool_or(converted) AS converted,
        SUM(views) AS views, SUM(time) AS time, AVG(scroll) AS scroll, bool_or(forward) AS forward,
        bool_or(COALESCE(btrim(search), '') <> '') AS searched,
        COALESCE((array_agg(device ORDER BY "viewedAt") FILTER (WHERE device IS NOT NULL))[1], 'unknown') AS device,
        (array_agg(path ORDER BY "viewedAt" DESC) FILTER (WHERE path IS NOT NULL))[1] AS "exitPage"
      FROM marked GROUP BY id
    ), filtered AS (SELECT * FROM sessions WHERE ${cohort}),
    views AS (
      SELECT marked.*, filtered.converted AS "sessionConverted", filtered."exitPage"
      FROM marked JOIN filtered USING (id)
    ),
    daily AS (SELECT to_char(started,'YYYY-MM-DD') AS date, count(*) AS sessions,
      count(*) FILTER (WHERE converted) AS conversions, 100.0 * count(*) FILTER (WHERE converted) / NULLIF(count(*),0) AS "conversionRate"
      FROM filtered GROUP BY date ORDER BY date),
    channels AS (SELECT source, medium, campaign, count(*) AS sessions, count(*) FILTER (WHERE cart) AS "addedToCart", count(*) FILTER (WHERE converted) AS conversions,
      100.0 * count(*) FILTER (WHERE converted) / NULLIF(count(*),0) AS "conversionRate" FROM filtered GROUP BY source,medium,campaign ORDER BY count(*) DESC,source,medium,campaign),
    devices AS (SELECT device, count(*) AS sessions, 100.0 * count(*) / NULLIF((SELECT count(*) FROM filtered), 0) AS share,
      COALESCE(100.0 * count(*) FILTER (WHERE converted) / NULLIF(count(*), 0), 0) AS "conversionRate"
      FROM filtered GROUP BY device ORDER BY count(*) DESC, device),
    -- A term is listed only once two sessions used it, so one-off personal searches never show.
    searches AS (SELECT left(lower(btrim(search)), 100) AS term, count(DISTINCT id) AS sessions FROM views
      WHERE COALESCE(btrim(search), '') <> '' GROUP BY 1 HAVING count(DISTINCT id) >= 2
      ORDER BY count(DISTINCT id) DESC, 1 LIMIT 5),
    exits AS (SELECT CASE WHEN "exitType" IN ('internal_link','checkout','back_button','window_closed','idle','external_link') THEN "exitType" ELSE 'unknown' END AS "type",
      count(*) AS "pageViews", 100.0 * count(*) / NULLIF((SELECT count(*) FROM views), 0) AS share FROM views GROUP BY 1),
    next_pages AS (SELECT CASE WHEN "exitPath" ~* ${PRIVATE_PATH} THEN '/private-page' ELSE left("exitPath", 600) END AS path,
      count(*) AS "pageViews" FROM views WHERE "exitPath" LIKE '/%' GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 5),
    page_rows AS (SELECT path, (array_agg("type") FILTER (WHERE "type" IS NOT NULL))[1] AS "type",
      count(DISTINCT id) AS sessions,
      count(DISTINCT id) FILTER (WHERE "addedToCart") AS carts,
      count(DISTINCT id) FILTER (WHERE forward) AS forwards,
      count(DISTINCT id) FILTER (WHERE "sessionConverted") AS conversions,
      count(DISTINCT id) FILTER (WHERE "exitPage" = path) AS exits
      FROM views WHERE path IS NOT NULL GROUP BY path ORDER BY count(DISTINCT id) DESC, path LIMIT 500),
    exit_pages AS (SELECT path, exits, sessions, 100.0 * exits / NULLIF(sessions, 0) AS "exitRate"
      FROM page_rows WHERE exits > 0 ORDER BY exits DESC, path LIMIT 5)
    SELECT json_build_object('sessions',count(*),'addedToCart',count(*) FILTER (WHERE cart),'conversions',count(*) FILTER (WHERE converted),
      'conversionRate',COALESCE(100.0 * count(*) FILTER (WHERE converted)/NULLIF(count(*),0),0),
      'atcRate',COALESCE(100.0 * count(*) FILTER (WHERE cart)/NULLIF(count(*),0),0),
      'pageViews',COALESCE(sum(views),0),'averageTime',COALESCE(avg(time)/1000,0),'averageScroll',COALESCE(avg(scroll),0),
      'checkoutStarted',count(*) FILTER (WHERE checkout),
      'timeMedian',COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY time) / 1000,0),
      'pagesPerSession',COALESCE(avg(views),0),
      'viewScroll',COALESCE((SELECT avg(scroll) FROM views),0),
      'clickThroughRate',COALESCE(100.0 * count(*) FILTER (WHERE forward)/NULLIF(count(*),0),0),
      'searchRate',COALESCE(100.0 * count(*) FILTER (WHERE searched)/NULLIF(count(*),0),0),
      'series',COALESCE((SELECT json_agg(daily) FROM daily),'[]'::json),
      'channels',COALESCE((SELECT json_agg(channels) FROM channels),'[]'::json),
      'sources',COALESCE((SELECT json_agg(source) FROM (SELECT DISTINCT source FROM sessions ORDER BY source) options),'[]'::json),
      'devices',COALESCE((SELECT json_agg(devices) FROM devices),'[]'::json),
      'searches',COALESCE((SELECT json_agg(searches) FROM searches),'[]'::json),
      'exits',COALESCE((SELECT json_agg(exits) FROM exits),'[]'::json),
      'nextPages',COALESCE((SELECT json_agg(next_pages) FROM next_pages),'[]'::json),
      'exitPages',COALESCE((SELECT json_agg(exit_pages) FROM exit_pages),'[]'::json),
      'pageRows',COALESCE((SELECT json_agg(page_rows) FROM page_rows),'[]'::json),
      'clickRows',COALESCE((SELECT json_agg(clicks) FROM (
        SELECT raw.id AS "sessionId", raw."ctaClicks", filtered.cart AS "addedToCart", filtered.converted FROM raw JOIN filtered USING(id)
        WHERE raw."ctaClicks" IS NOT NULL AND raw."ctaClicks" NOT IN ('[]','{}','') LIMIT 20001
      ) clicks),'[]'::json)) AS report FROM filtered
  `);
  const {
    clickRows,
    checkoutStarted,
    timeMedian,
    pagesPerSession,
    viewScroll,
    clickThroughRate,
    searchRate,
    devices,
    searches,
    exits,
    nextPages,
    exitPages,
    pageRows,
    ...report
  } = results[0].report;
  return {
    ...report,
    layout,
    pageType,
    funnel: {
      sessions: report.sessions,
      addedToCart: report.addedToCart,
      checkoutStarted,
      purchased: report.conversions,
    },
    engagementSummary: {
      available: detailed,
      timeMedianSeconds: timeMedian,
      pagesPerSession,
      averageScroll: viewScroll,
      clickThroughRate,
      searchRate,
      topSearches: searches,
      devices: detailed ? devices : [],
    },
    exitPaths: {
      available: detailed,
      outcomes: EXIT_OUTCOMES.map((type) => {
        const row = exits.find((exit) => exit.type === type);
        return { type, pageViews: row?.pageViews ?? 0, share: row?.share ?? 0 };
      }),
      nextPages,
      exitPages,
    },
    pages: layout === "store" && detailed ? rankGrowthPages(pageRows) : [],
    // Do not show sampled engagement totals as complete; summaries above are always full-cohort.
    engagement:
      clickRows.length > 20000 ? null : buildEngagementOutcomes(clickRows),
    engagementUnavailable: clickRows.length > 20000,
  };
}
