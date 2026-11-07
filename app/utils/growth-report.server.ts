import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { GrowthProjectError } from "./growth-projects";
import { buildEngagementOutcomes } from "./click-engagement";
import { cachedValue, loaderCacheKeys } from "./loader-cache.server";
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
// Sessions by page groups those URL variants of one page under the plain path.
const LOCALE_PREFIX = "^/[a-z]{2}(-[a-z]{2})?(?=/)";
const COLLECTION_PREFIX = "^/collections/[^/]+(?=/products/)";
const REPORT_CACHE_MS = 60_000;
type ClickRow = {
  sessionId: string;
  ctaClicks: string | null;
  addedToCart: boolean;
  converted: boolean;
};
type QueryReport = Omit<
  GrowthReport,
  | "currency"
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
function findCapture(shop: string, projectId: string, measurementId: string) {
  return prisma.growthMeasurement.findFirst({
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
}
type Capture = NonNullable<Awaited<ReturnType<typeof findCapture>>>;
export async function getGrowthMeasurementReport(
  shop: string,
  projectId: string,
  measurementId: string,
  filters: GrowthReportFilters,
  // The shop's currency (getShopCurrency). Null sums nothing: revenue is "Not recorded".
  currency: string | null = null,
): Promise<GrowthReport> {
  // The shop-scoped lookup runs on every call; only the report query is cached.
  const capture = await findCapture(shop, projectId, measurementId);
  if (!capture) throw new GrowthProjectError("Measurement not found.", 404);
  return cachedValue(
    loaderCacheKeys.growthReport(shop, projectId, measurementId, filters, currency),
    REPORT_CACHE_MS,
    () => loadReport(capture, filters, currency),
  );
}
async function loadReport(
  capture: Capture,
  filters: GrowthReportFilters,
  shopCurrency: string | null,
): Promise<GrowthReport> {
  const layout = capture.project.scope === "STORE" ? "store" : "page";
  const store = layout === "store";
  const pageType = (capture.project.resourceProject?.resourceType ??
    null) as GrowthPageType | null;
  // Imported Channel/Customer captures never recorded exits, devices, searches or clicks.
  const detailed = Boolean(capture.snapshotId || capture.storeSnapshotId);
  // Revenue (spec 7.2) counts an order only with an amount in the shop's currency.
  // Any other order of a converted session (no amount, another currency, or no
  // currency at all) is "unpriced"; the screens show those as not recorded.
  const inShopCurrency = (amount: Prisma.Sql, code: Prisma.Sql) =>
    Prisma.sql`COALESCE(${amount} IS NOT NULL AND ${code} = ${shopCurrency}, false)`;
  // Session ids (and grouped page paths below) use byte order ("C"): groups are identical
  // and the large sorts are several times faster than with the database's locale.
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
    // Attribution writes each order to one page view of the session.
    const priced = inShopCurrency(Prisma.sql`"orderValue"`, Prisma.sql`currency`);
    rows = Prisma.sql`SELECT COALESCE("acquisitionId", "sessionId") COLLATE "C" AS id, COALESCE("acquisitionStartedAt", "startedAt") AS "startedAt", "startedAt" AS "viewedAt", "visitorType"::text AS kind,
      CASE WHEN "acquisitionId" IS NOT NULL THEN "acquisitionSource" ELSE source END AS source,
      CASE WHEN "acquisitionId" IS NOT NULL THEN "acquisitionMedium" ELSE medium END AS medium,
      CASE WHEN "acquisitionId" IS NOT NULL THEN "acquisitionCampaign" ELSE campaign END AS campaign,
      "addedToCart", "checkoutStarted" AS checkout, converted, 1 AS views, "timeOnPage"::float AS time, "scrollDepth"::float AS scroll, "ctaClicks",
      ${path} AS path, ${type} AS "type", "exitType", "exitUrl", "deviceType" AS device, "searchQuery" AS search,
      CASE WHEN converted AND ${priced} THEN "orderValue" END AS "orderAmount",
      (converted AND NOT ${priced}) AS "orderUnpriced", "convertedAt"
      FROM ${table} WHERE ${constraint}`;
  } else if (capture.channelSnapshotId) {
    // Imported channel captures never recorded order amounts.
    rows = Prisma.sql`SELECT s.id COLLATE "C" AS id, s."startedAt", COALESCE(v."startedAt", s."startedAt") AS "viewedAt", COALESCE(v."visitorType"::text, 'PENDING') AS kind, s.source, s.medium, s.campaign,
      s."addedToCart", s."checkoutStarted" AS checkout, s.converted, CASE WHEN v.id IS NULL THEN 0 ELSE 1 END AS views,
      COALESCE(v."timeOnPage",0)::float AS time, COALESCE(v."scrollDepth",0)::float AS scroll, NULL::text AS "ctaClicks",
      NULL::text AS path, NULL::text AS "type", NULL::text AS "exitType", NULL::text AS "exitUrl", NULL::text AS device, NULL::text AS search,
      NULL::float8 AS "orderAmount", s.converted AS "orderUnpriced", NULL::timestamp AS "convertedAt"
      FROM "ChannelSnapshotSession" s LEFT JOIN "ChannelSnapshotVisit" v ON v."sessionId" = s.id WHERE s."channelSnapshotId" = ${capture.channelSnapshotId}`;
  } else if (capture.customerSnapshotId) {
    // Amounts sit on the session's conversion events. Only the session's first row
    // carries them, so a session that viewed several pages counts its orders once.
    const priced = inShopCurrency(Prisma.sql`e.amount`, Prisma.sql`e.currency`);
    rows = Prisma.sql`SELECT s.id COLLATE "C" AS id, s."startedAt", COALESCE(p."startedAt", s."startedAt") AS "viewedAt", s."visitorType"::text AS kind, s.source, s.medium, s.campaign,
      s."addedToCart", s."checkoutStarted" AS checkout, s.converted, CASE WHEN p.id IS NULL THEN 0 ELSE 1 END AS views,
      COALESCE(p."timeOnPage",0)::float AS time, COALESCE(p."scrollDepth",0)::float AS scroll, NULL::text AS "ctaClicks",
      NULL::text AS path, NULL::text AS "type", NULL::text AS "exitType", NULL::text AS "exitUrl", NULL::text AS device, NULL::text AS search,
      CASE WHEN row_number() OVER (PARTITION BY s.id ORDER BY p."startedAt", p.id) = 1 THEN o.amount END AS "orderAmount",
      COALESCE(o.unpriced, false) AS "orderUnpriced", NULL::timestamp AS "convertedAt"
      FROM "CustomerJourneySession" s LEFT JOIN "CustomerJourneyPage" p ON p."sessionId" = s.id
      LEFT JOIN LATERAL (
        SELECT SUM(e.amount) FILTER (WHERE ${priced}) AS amount, bool_or(NOT ${priced}) AS unpriced
        FROM "CustomerJourneyEvent" e WHERE e."sessionId" = s.id AND e.type = 'conversion'
      ) o ON s.converted
      WHERE s."snapshotId" = ${capture.customerSnapshotId}`;
  } else throw new GrowthProjectError("Measurement data is unavailable.", 404);
  // Group before filtering so the numerator and denominator share an audience.
  // This is read-only reporting; filters never change capture or attribution.
  const cohort = Prisma.sql`${filters.audience === "active" ? Prisma.sql`kind = 'REAL'` : Prisma.sql`TRUE`}
    AND (${filters.source} = '' OR lower(source) = lower(${filters.source}))
    AND (${filters.medium} = '' OR lower(medium) = lower(${filters.medium}))
    AND (${filters.campaign} = '' OR lower(campaign) = lower(${filters.campaign}))`;
  // Revenue for a set of sessions with converted/revenue/priced/unpriced columns:
  // summed per converted session, under the same filters as the rate beside it.
  const revenueColumns = Prisma.sql`COALESCE(SUM(revenue) FILTER (WHERE converted), 0)::float8 AS revenue,
      count(*) FILTER (WHERE converted AND priced) AS "pricedConversions",
      count(*) FILTER (WHERE converted AND unpriced) AS "unpricedConversions"`;
  // Each layout builds only the sections it shows: Store has per-page rows and exit
  // pages; Page has next pages and Engagement by zone (click rows).
  const layoutSections = store
    ? Prisma.sql`, page_sessions AS (
      -- One row per page and session, so each count below is a plain count. A converted
      -- session brings its whole revenue to every page it viewed, like its conversion.
      SELECT page AS path, id, max("type") AS "type", bool_or("addedToCart") AS cart, bool_or(forward) AS forward,
        bool_or("sessionConverted") AS converted, bool_or("exitPage" = page) AS exited,
        max("sessionRevenue") AS revenue, bool_or("sessionPriced") AS priced, bool_or("sessionUnpriced") AS unpriced
      FROM views WHERE page IS NOT NULL GROUP BY page, id
    ), page_rows AS (SELECT path, CASE WHEN path = '/private-page' THEN NULL ELSE max("type") END AS "type", count(*) AS sessions,
      count(*) FILTER (WHERE cart) AS carts, count(*) FILTER (WHERE forward) AS forwards,
      count(*) FILTER (WHERE converted) AS conversions, count(*) FILTER (WHERE exited) AS exits,
      ${revenueColumns}
      FROM page_sessions GROUP BY path ORDER BY count(*) DESC, path LIMIT 500),
    exit_pages AS (SELECT path, exits, sessions, 100.0 * exits / NULLIF(sessions, 0) AS "exitRate"
      FROM page_rows WHERE exits > 0 ORDER BY exits DESC, path LIMIT 5)`
    : Prisma.sql`, next_pages AS (SELECT CASE WHEN "exitPath" ~* ${PRIVATE_PATH} THEN '/private-page' ELSE left("exitPath", 600) END AS path,
      count(*) AS "pageViews" FROM views WHERE "exitPath" LIKE '/%' GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 5)`;
  const layoutJson = store
    ? Prisma.sql`'nextPages','[]'::json,
      'exitPages',COALESCE((SELECT json_agg(exit_pages) FROM exit_pages),'[]'::json),
      'pageRows',COALESCE((SELECT json_agg(page_rows) FROM page_rows),'[]'::json),
      'clickRows','[]'::json`
    : Prisma.sql`'nextPages',COALESCE((SELECT json_agg(next_pages) FROM next_pages),'[]'::json),
      'exitPages','[]'::json,
      'pageRows','[]'::json,
      'clickRows',COALESCE((SELECT json_agg(clicks) FROM (
        SELECT raw.id AS "sessionId", raw."ctaClicks", filtered.cart AS "addedToCart", filtered.converted FROM raw JOIN filtered USING(id)
        WHERE raw."ctaClicks" IS NOT NULL AND raw."ctaClicks" NOT IN ('[]','{}','') LIMIT 20001
      ) clicks),'[]'::json)`;
  // Revenue per session (columns revenue, priced, unpriced).
  const sessionRevenue = detailed
    ? // The checkout pixel and the orders/paid webhook (and its retries) each attribute
      // the same order to a page view of the session, and neither carries the order id
      // here. Converted rows of one session within 10 minutes of the previous one are
      // therefore one order, counted at its largest shop-currency amount; it is unpriced
      // only when none of its rows is priced (a Markets order may arrive once in the
      // presentment currency and once in the shop currency). A row without a conversion
      // time is its own order.
      Prisma.sql`converted_rows AS (
      SELECT id, "convertedAt", "orderAmount",
        lag("convertedAt") OVER w AS previous, row_number() OVER w AS n
      FROM marked WHERE converted
      WINDOW w AS (PARTITION BY id ORDER BY "convertedAt", "viewedAt")
    ), order_rows AS (
      SELECT id, "orderAmount", SUM(CASE WHEN "convertedAt" IS NULL OR previous IS NULL
          OR "convertedAt" - previous > interval '10 minutes' THEN 1 ELSE 0 END)
          OVER (PARTITION BY id ORDER BY n ROWS UNBOUNDED PRECEDING) AS "order"
      FROM converted_rows
    ), orders AS (
      SELECT id, max("orderAmount") AS amount FROM order_rows GROUP BY id, "order"
    ), session_revenue AS (
      SELECT id, SUM(amount)::float8 AS revenue, bool_or(amount IS NOT NULL) AS priced,
        bool_or(amount IS NULL) AS unpriced
      FROM orders GROUP BY id
    )`
    : // Channel captures have no amounts; customer captures already carry each
      // session's orders once, on its first row.
      Prisma.sql`session_revenue AS (
      SELECT id, SUM("orderAmount")::float8 AS revenue, bool_or("orderAmount" IS NOT NULL) AS priced,
        bool_or("orderUnpriced") AS unpriced
      FROM marked GROUP BY id
    )`;
  const results = await prisma.$queryRaw<Array<{ report: QueryReport }>>(Prisma.sql`
    WITH raw AS (${rows}), marked AS (
      -- Carry only the columns later steps read; ctaClicks and exitUrl stop here.
      SELECT id, "startedAt", "viewedAt", kind, source, medium, campaign, "addedToCart", checkout, converted,
        views, time, scroll, device, search, "exitType", "exitPath", "orderAmount", "orderUnpriced", "convertedAt",
        -- Account and order links carry personal tokens, so they share one row (without a type).
        CASE WHEN page ~* ${PRIVATE_PATH} THEN '/private-page' ELSE page END COLLATE "C" AS page, "type",
        -- A forward click left from the main content to another store page; collections only to a product.
        COALESCE(
          "exitPath" LIKE '/%'
          AND ("type" IS DISTINCT FROM 'COLLECTION' OR "exitPath" ~* ${PRODUCT_PATH})
          AND COALESCE("lastZone", '') NOT IN ('header', 'footer'), false) AS forward
      FROM (
        SELECT id, "startedAt", "viewedAt", kind, source, medium, campaign, "addedToCart", checkout, converted,
          views, time, scroll, device, search, "exitType", "type", "orderAmount", "orderUnpriced", "convertedAt",
          -- Only paths that can carry a locale or collection prefix run the regular expressions.
          CASE WHEN path LIKE '/__/%' OR path LIKE '/__-__/%' OR path ILIKE '/collections/%/products/%'
            THEN regexp_replace(regexp_replace(path, ${LOCALE_PREFIX}, '', 'i'), ${COLLECTION_PREFIX}, '', 'i')
            ELSE path
          END AS page,
          -- exitUrl is set by the tracker for link clicks; the cart/checkout links are typed "checkout".
          CASE WHEN "exitType" = 'internal_link' THEN regexp_replace(regexp_replace("exitUrl", '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]*', ''), '[?#].*$', '') END AS "exitPath",
          -- Only link exits need the last click's zone. Nested CASE: the jsonb cast must
          -- only run on valid JSON (truncated payloads exist). -> -1 is NULL for non-arrays.
          CASE WHEN "exitType" = 'internal_link' THEN
            CASE WHEN pg_input_is_valid("ctaClicks", 'jsonb') THEN lower("ctaClicks"::jsonb -> -1 ->> 'zone') END
          END AS "lastZone"
        FROM raw
        -- OFFSET 0 keeps PostgreSQL from inlining this step, which would re-run the
        -- regular expressions above once per reference below.
        OFFSET 0
      ) parsed
    ), ${sessionRevenue}, session_rows AS (
      SELECT id, MIN("startedAt") AS started,
        CASE WHEN bool_or(kind = 'REAL') THEN 'REAL' WHEN bool_or(kind = 'ZOMBIE') THEN 'ZOMBIE' WHEN bool_or(kind = 'BOT') THEN 'BOT' ELSE 'PENDING' END AS kind,
        COALESCE((array_agg(source ORDER BY "startedAt"))[1], 'unknown') AS source,
        COALESCE((array_agg(medium ORDER BY "startedAt"))[1], '') AS medium,
        COALESCE((array_agg(campaign ORDER BY "startedAt"))[1], '') AS campaign,
        bool_or("addedToCart") AS cart, bool_or(checkout) AS checkout, bool_or(converted) AS converted,
        SUM(views) AS views, SUM(time) AS time, AVG(scroll) AS scroll, bool_or(forward) AS forward,
        bool_or(COALESCE(btrim(search), '') <> '') AS searched,
        COALESCE((array_agg(device ORDER BY "viewedAt") FILTER (WHERE device IS NOT NULL))[1], 'unknown') AS device,
        -- Shoppers who reached checkout or bought did not exit. An add-to-cart that never
        -- reached checkout (also typed "checkout" by the tracker) still exits from that page.
        CASE WHEN bool_or(checkout) OR bool_or(converted) THEN NULL
          ELSE (array_agg(page ORDER BY "viewedAt" DESC) FILTER (WHERE page IS NOT NULL))[1]
        END AS "exitPage"
      FROM marked GROUP BY id
    ), sessions AS (
      -- Revenue per session first: a session with two orders sums both, and is still
      -- one conversion.
      SELECT session_rows.*, COALESCE(r.revenue, 0)::float8 AS revenue,
        COALESCE(r.priced, false) AS priced, COALESCE(r.unpriced, false) AS unpriced
      FROM session_rows LEFT JOIN session_revenue r USING (id)
    ), filtered AS (SELECT * FROM sessions WHERE ${cohort}),
    views AS (
      SELECT id, marked.search, marked."exitType", marked."exitPath", marked.page, marked."type",
        marked."addedToCart", marked.forward, marked.scroll, filtered.converted AS "sessionConverted", filtered."exitPage",
        filtered.revenue AS "sessionRevenue", filtered.priced AS "sessionPriced", filtered.unpriced AS "sessionUnpriced"
      FROM marked JOIN filtered USING (id)
    ),
    daily AS (SELECT to_char(started,'YYYY-MM-DD') AS date, count(*) AS sessions,
      count(*) FILTER (WHERE converted) AS conversions, 100.0 * count(*) FILTER (WHERE converted) / NULLIF(count(*),0) AS "conversionRate"
      FROM filtered GROUP BY date ORDER BY date),
    channels AS (SELECT source, medium, campaign, count(*) AS sessions, count(*) FILTER (WHERE cart) AS "addedToCart", count(*) FILTER (WHERE converted) AS conversions,
      100.0 * count(*) FILTER (WHERE converted) / NULLIF(count(*),0) AS "conversionRate", ${revenueColumns}
      FROM filtered GROUP BY source,medium,campaign ORDER BY count(*) DESC,source,medium,campaign),
    devices AS (SELECT device, count(*) AS sessions, 100.0 * count(*) / NULLIF((SELECT count(*) FROM filtered), 0) AS share,
      count(*) FILTER (WHERE converted) AS conversions,
      COALESCE(100.0 * count(*) FILTER (WHERE converted) / NULLIF(count(*), 0), 0) AS "conversionRate", ${revenueColumns}
      FROM filtered GROUP BY device ORDER BY count(*) DESC, device),
    -- A term is listed only once two sessions used it, so one-off personal searches never show.
    searches AS (SELECT left(lower(btrim(search)), 100) AS term, count(DISTINCT id) AS sessions FROM views
      WHERE COALESCE(btrim(search), '') <> '' GROUP BY 1 HAVING count(DISTINCT id) >= 2
      ORDER BY count(DISTINCT id) DESC, 1 LIMIT 5),
    exits AS (SELECT CASE WHEN "exitType" IN ('internal_link','checkout','back_button','window_closed','idle','external_link') THEN "exitType" ELSE 'unknown' END AS "type",
      count(*) AS "pageViews", 100.0 * count(*) / NULLIF((SELECT count(*) FROM views), 0) AS share FROM views GROUP BY 1)
    ${layoutSections}
    SELECT json_build_object('sessions',count(*),'addedToCart',count(*) FILTER (WHERE cart),'conversions',count(*) FILTER (WHERE converted),
      'conversionRate',COALESCE(100.0 * count(*) FILTER (WHERE converted)/NULLIF(count(*),0),0),
      'revenue',COALESCE(SUM(revenue) FILTER (WHERE converted),0)::float8,
      'pricedConversions',count(*) FILTER (WHERE converted AND priced),
      'unpricedConversions',count(*) FILTER (WHERE converted AND unpriced),
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
      ${layoutJson}) AS report FROM filtered
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
    currency: shopCurrency,
    layout,
    pageType,
    funnel: {
      sessions: report.sessions,
      addedToCart: report.addedToCart,
      checkoutStarted,
      purchased: report.conversions,
      revenue: report.revenue,
      pricedConversions: report.pricedConversions,
      unpricedConversions: report.unpricedConversions,
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
    pages: store && detailed ? rankGrowthPages(pageRows) : [],
    // Store reports never show Engagement by zone, so no click rows are read for them.
    // Do not show sampled engagement totals as complete; summaries above are always full-cohort.
    engagement:
      store || clickRows.length > 20000 ? null : buildEngagementOutcomes(clickRows),
    engagementUnavailable: !store && clickRows.length > 20000,
  };
}
