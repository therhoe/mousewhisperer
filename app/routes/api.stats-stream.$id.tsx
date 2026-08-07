import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { buildClickEngagement } from "../utils/click-engagement";

const NON_INTERNAL_EXIT_TYPES = ["window_closed", "back_button", "idle", "external_link"];
const STREAM_POLL_INTERVAL_MS = 30_000;
const STATS_CACHE_TTL_MS = 30_000;
const statsCache = new Map<string, { expiresAt: number; value: Awaited<ReturnType<typeof getSnapshotStats>> }>();
const statsRefreshes = new Map<string, Promise<Awaited<ReturnType<typeof getSnapshotStats>>>>();

type TrackedClick = {
  label?: string;
  tag?: string;
  href?: string | null;
  zone?: string;
};

function percent(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function parseTrackedClicks(raw: string | null): TrackedClick[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;

    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed).flatMap(([label, count]) => {
        const clickCount = typeof count === "number" ? count : 0;
        return Array.from({ length: clickCount }, () => ({ label, tag: "button", zone: "main" }));
      });
    }
  } catch {}

  return [];
}

function isLinkClick(click: TrackedClick): boolean {
  return (click.tag || "").toLowerCase() === "a" && !!click.href;
}

function isBodyCtaClick(click: TrackedClick): boolean {
  const tag = (click.tag || "").toLowerCase();
  return (click.zone || "main") === "main" && (tag === "button" || tag === "input");
}

function isLinkOrButtonClick(click: TrackedClick): boolean {
  const tag = (click.tag || "").toLowerCase();
  return tag === "a" || tag === "button" || tag === "input";
}

function summarizeClicks(rows: Array<{ ctaClicks: string | null }>) {
  let linkClickCount = 0;
  let bodyCtaClickCount = 0;
  let anyLinkOrButtonClickCount = 0;
  let visitsWithBodyCtaClick = 0;
  let visitsWithAnyLinkOrButtonClick = 0;

  rows.forEach((row) => {
    const clicks = parseTrackedClicks(row.ctaClicks);
    const bodyClicks = clicks.filter(isBodyCtaClick).length;
    const linkOrButtonClicks = clicks.filter(isLinkOrButtonClick).length;

    linkClickCount += clicks.filter(isLinkClick).length;
    bodyCtaClickCount += bodyClicks;
    anyLinkOrButtonClickCount += linkOrButtonClicks;
    if (bodyClicks > 0) visitsWithBodyCtaClick++;
    if (linkOrButtonClicks > 0) visitsWithAnyLinkOrButtonClick++;
  });

  return {
    linkClickCount,
    bodyCtaClickCount,
    anyLinkOrButtonClickCount,
    visitsWithBodyCtaClick,
    visitsWithAnyLinkOrButtonClick,
  };
}

// Calculate stats for a snapshot using efficient database aggregations
async function getSnapshotStats(snapshotId: string) {
  // Keep stats refreshes on one DB connection so background SSE work does not
  // starve interactive page navigation on the remote connection pool.
  const [
    visitorTypeCounts,
    addToCartCount,
    conversionCount,
    realUserMetrics,
    sourceCategoryStats,
    countryCounts,
    cityCounts,
    deviceCounts,
    exitTypeCounts,
    recentVisits,
    topExitUrls,
    topSearchQueries,
    sortPreferences,
    filterUsageCount,
    productClickCount,
    productClicksBySource,
    searchBySource,
    exitBySource,
    scroll50BySource,
    scroll100BySource,
    revenueAggregate,
    searchSessionCount,
    scroll50Count,
    scroll100Count,
    nonInternalExitCount,
    bounceCandidateRows,
    ctaClickRows,
  ] = await prisma.$transaction([
    // Count by visitor type
    prisma.visit.groupBy({
      by: ["visitorType"],
      where: { snapshotId },
      _count: true,
    }),
    // Count conversions and add-to-cart
    prisma.visit.count({ where: { snapshotId, addedToCart: true } }),
    prisma.visit.count({ where: { snapshotId, converted: true } }),
    // Get average time and scroll for REAL users only
    prisma.visit.aggregate({
      where: { snapshotId, visitorType: "REAL" },
      _avg: { timeOnPage: true, scrollDepth: true },
    }),
    // Group by source category with counts
    prisma.visit.groupBy({
      by: ["sourceCategory", "visitorType"],
      where: { snapshotId },
      _count: true,
      _sum: { timeOnPage: true, scrollDepth: true },
    }),
    // Top countries
    prisma.visit.groupBy({
      by: ["country"],
      where: { snapshotId },
      _count: true,
      orderBy: { _count: { country: "desc" } },
      take: 5,
    }),
    // Top cities
    prisma.visit.groupBy({
      by: ["city", "region", "country"],
      where: { snapshotId, city: { not: null } },
      _count: true,
      orderBy: { _count: { city: "desc" } },
      take: 5,
    }),
    // Device breakdown
    prisma.visit.groupBy({
      by: ["deviceType"],
      where: { snapshotId },
      _count: true,
      orderBy: { _count: { deviceType: "desc" } },
    }),
    // Exit type breakdown
    prisma.visit.groupBy({
      by: ["exitType"],
      where: { snapshotId },
      _count: true,
      orderBy: { _count: { exitType: "desc" } },
    }),
    // Recent visits (limited to 50)
    prisma.visit.findMany({
      where: { snapshotId },
      orderBy: { startedAt: "desc" },
      take: 50,
      select: {
        id: true,
        sessionId: true,
        visitorType: true,
        source: true,
        medium: true,
        campaign: true,
        sourceCategory: true,
        timeOnPage: true,
        scrollDepth: true,
        mouseMovements: true,
        keyPresses: true,
        touchEvents: true,
        country: true,
        city: true,
        region: true,
        deviceType: true,
        botScore: true,
        addedToCart: true,
        converted: true,
        orderValue: true,
        currency: true,
        ctaClicks: true,
        startedAt: true,
        endedAt: true,
        exitType: true,
        exitUrl: true,
        searchQuery: true,
        appliedFilters: true,
        sortBy: true,
        filterInteractions: true,
      },
    }),
    // Top exit URLs
    prisma.visit.groupBy({
      by: ["exitUrl"],
      where: { snapshotId, exitUrl: { not: null } },
      _count: true,
      orderBy: { _count: { exitUrl: "desc" } },
      take: 10,
    }),
    // Top search queries
    prisma.visit.groupBy({
      by: ["searchQuery"],
      where: { snapshotId, searchQuery: { not: null } },
      _count: true,
      orderBy: { _count: { searchQuery: "desc" } },
      take: 10,
    }),
    // Sort preferences
    prisma.visit.groupBy({
      by: ["sortBy"],
      where: { snapshotId, sortBy: { not: null } },
      _count: true,
      orderBy: { _count: { sortBy: "desc" } },
    }),
    // Filter usage count
    prisma.visit.count({
      where: { snapshotId, appliedFilters: { not: null } },
    }),
    // Product clicks (exits to /products/*) for collection audits
    prisma.visit.count({
      where: { snapshotId, exitUrl: { contains: "/products/" } },
    }),
    prisma.visit.groupBy({
      by: ["sourceCategory"],
      where: { snapshotId, exitUrl: { contains: "/products/" } },
      _count: true,
    }),
    prisma.visit.groupBy({
      by: ["sourceCategory"],
      where: { snapshotId, searchQuery: { not: null } },
      _count: true,
    }),
    prisma.visit.groupBy({
      by: ["sourceCategory"],
      where: { snapshotId, exitType: { in: NON_INTERNAL_EXIT_TYPES } },
      _count: true,
    }),
    prisma.visit.groupBy({
      by: ["sourceCategory"],
      where: { snapshotId, scrollDepth: { gte: 50 } },
      _count: true,
    }),
    prisma.visit.groupBy({
      by: ["sourceCategory"],
      where: { snapshotId, scrollDepth: { gte: 100 } },
      _count: true,
    }),
    // Revenue aggregation
    prisma.visit.aggregate({
      where: { snapshotId, converted: true, orderValue: { not: null } },
      _sum: { orderValue: true },
      _count: { _all: true },
    }),
    prisma.visit.count({
      where: { snapshotId, searchQuery: { not: null } },
    }),
    prisma.visit.count({
      where: { snapshotId, scrollDepth: { gte: 50 } },
    }),
    prisma.visit.count({
      where: { snapshotId, scrollDepth: { gte: 100 } },
    }),
    prisma.visit.count({
      where: { snapshotId, exitType: { in: NON_INTERNAL_EXIT_TYPES } },
    }),
    prisma.visit.findMany({
      where: {
        snapshotId,
        scrollDepth: { lt: 50 },
        exitType: { in: NON_INTERNAL_EXIT_TYPES },
      },
      select: { sourceCategory: true, ctaClicks: true },
    }),
    prisma.visit.findMany({
      where: { snapshotId, ctaClicks: { not: null } },
      select: { sourceCategory: true, ctaClicks: true },
    }),
  ]);

  // Process visitor type counts
  let realCount = 0, zombieCount = 0, botCount = 0, totalSessions = 0;
  visitorTypeCounts.forEach((item) => {
    totalSessions += item._count;
    if (item.visitorType === "REAL") realCount = item._count;
    else if (item.visitorType === "ZOMBIE") zombieCount = item._count;
    else if (item.visitorType === "BOT") botCount = item._count;
  });

  const avgTimeOnPage = realUserMetrics._avg.timeOnPage
    ? Math.round(realUserMetrics._avg.timeOnPage / 1000)
    : 0;
  const avgScrollDepth = realUserMetrics._avg.scrollDepth
    ? Math.round(realUserMetrics._avg.scrollDepth)
    : 0;

  // Process source category stats
  const sourceMap = new Map<string, {
    sessions: number;
    real: number;
    zombie: number;
    bot: number;
    avgTime: number;
    avgScroll: number;
    atc: number;
    conversions: number;
    productClicks: number;
    searches: number;
    exits: number;
    scroll50: number;
    scroll100: number;
    linkClicks: number;
    bodyCtaVisits: number;
    anyClickVisits: number;
    bounces: number;
  }>();

  sourceCategoryStats.forEach((item) => {
    const category = item.sourceCategory || "Unknown";
    if (!sourceMap.has(category)) {
      sourceMap.set(category, {
        sessions: 0, real: 0, zombie: 0, bot: 0, avgTime: 0, avgScroll: 0, atc: 0, conversions: 0,
        productClicks: 0, searches: 0, exits: 0, scroll50: 0, scroll100: 0, linkClicks: 0, bodyCtaVisits: 0, anyClickVisits: 0, bounces: 0,
      });
    }
    const stats = sourceMap.get(category)!;
    stats.sessions += item._count;
    if (item.visitorType === "REAL") {
      stats.real += item._count;
      stats.avgTime += item._sum.timeOnPage || 0;
      stats.avgScroll += item._sum.scrollDepth || 0;
    } else if (item.visitorType === "ZOMBIE") {
      stats.zombie += item._count;
    } else if (item.visitorType === "BOT") {
      stats.bot += item._count;
    }
  });

  // Get ATC/conversion counts per source
  const atcBySource = await prisma.visit.groupBy({
    by: ["sourceCategory"],
    where: { snapshotId, addedToCart: true },
    _count: true,
  });
  const convBySource = await prisma.visit.groupBy({
    by: ["sourceCategory"],
    where: { snapshotId, converted: true },
    _count: true,
  });

  atcBySource.forEach((item) => {
    const category = item.sourceCategory || "Unknown";
    const stats = sourceMap.get(category);
    if (stats) stats.atc = item._count;
  });

  convBySource.forEach((item) => {
    const category = item.sourceCategory || "Unknown";
    const stats = sourceMap.get(category);
    if (stats) stats.conversions = item._count;
  });

  productClicksBySource.forEach((item) => {
    const category = item.sourceCategory || "Unknown";
    const stats = sourceMap.get(category);
    if (stats) stats.productClicks = item._count;
  });

  searchBySource.forEach((item) => {
    const category = item.sourceCategory || "Unknown";
    const stats = sourceMap.get(category);
    if (stats) stats.searches = item._count;
  });

  exitBySource.forEach((item) => {
    const category = item.sourceCategory || "Unknown";
    const stats = sourceMap.get(category);
    if (stats) stats.exits = item._count;
  });

  scroll50BySource.forEach((item) => {
    const category = item.sourceCategory || "Unknown";
    const stats = sourceMap.get(category);
    if (stats) stats.scroll50 = item._count;
  });

  scroll100BySource.forEach((item) => {
    const category = item.sourceCategory || "Unknown";
    const stats = sourceMap.get(category);
    if (stats) stats.scroll100 = item._count;
  });

  ctaClickRows.forEach((row) => {
    const category = row.sourceCategory || "Unknown";
    const stats = sourceMap.get(category);
    if (!stats) return;
    const clicks = parseTrackedClicks(row.ctaClicks);
    const bodyClicks = clicks.filter(isBodyCtaClick).length;
    const linkOrButtonClicks = clicks.filter(isLinkOrButtonClick).length;
    stats.linkClicks += clicks.filter(isLinkClick).length;
    if (bodyClicks > 0) stats.bodyCtaVisits++;
    if (linkOrButtonClicks > 0) stats.anyClickVisits++;
  });

  bounceCandidateRows.forEach((row) => {
    const category = row.sourceCategory || "Unknown";
    const stats = sourceMap.get(category);
    if (!stats) return;
    if (parseTrackedClicks(row.ctaClicks).filter(isLinkOrButtonClick).length === 0) {
      stats.bounces++;
    }
  });

  const sourceStats = Array.from(sourceMap.entries()).map(([category, stats]) => ({
    category,
    sessions: stats.sessions,
    real: stats.real,
    zombie: stats.zombie,
    bot: stats.bot,
    avgTime: stats.real > 0 ? Math.round(stats.avgTime / stats.real / 1000) : 0,
    avgScroll: stats.real > 0 ? Math.round(stats.avgScroll / stats.real) : 0,
    atcRate: stats.real > 0 ? Math.round((stats.atc / stats.real) * 100) : 0,
    convRate: stats.real > 0 ? Math.min(Math.round((stats.conversions / stats.real) * 100), 100) : 0,
    productClickRate: stats.real > 0 ? Math.round((stats.productClicks / stats.real) * 100) : 0,
    linkClicks: stats.linkClicks,
    searches: stats.searches,
    exitRate: percent(stats.exits, stats.sessions),
    productCtrRate: percent(stats.productClicks, stats.sessions),
    bodyCtaCtrRate: percent(stats.bodyCtaVisits, stats.sessions),
    bounceRate: percent(stats.bounces, stats.sessions),
    scroll50Rate: percent(stats.scroll50, stats.sessions),
    scroll100Rate: percent(stats.scroll100, stats.sessions),
    anyClickCtrRate: percent(stats.anyClickVisits, stats.sessions),
  })).sort((a, b) => b.sessions - a.sessions);

  // Process top countries
  const topCountries = countryCounts.map((item) => ({
    country: item.country || "Unknown",
    count: item._count,
  }));

  // Process top cities
  const topCities = cityCounts.map((item) => ({
    city: `${item.city}, ${item.region || item.country || ""}`,
    count: item._count,
  }));

  // Process device breakdown
  const deviceBreakdown = deviceCounts.map((item) => ({
    device: item.deviceType || "Unknown",
    count: item._count,
    percent: totalSessions > 0 ? Math.round((item._count / totalSessions) * 100) : 0,
  }));

  // Process exit paths
  const exitPaths = exitTypeCounts.map((item) => ({
    type: item.exitType || "unknown",
    count: item._count,
    percent: totalSessions > 0 ? Math.round((item._count / totalSessions) * 100) : 0,
    label: formatExitType(item.exitType || "unknown"),
  }));

  // Process top exit URLs
  const exitUrls = topExitUrls.map((item) => ({
    url: item.exitUrl || "",
    count: item._count,
  }));

  // Process search stats
  const searchStats = {
    topQueries: topSearchQueries.map((item) => ({
      query: item.searchQuery || "",
      count: item._count,
    })),
    sortPreferences: sortPreferences.map((item) => ({
      sort: item.sortBy || "",
      count: item._count,
    })),
    filterUsageCount,
  };

  const totalRevenue = revenueAggregate._sum.orderValue || 0;
  const ordersWithValue = revenueAggregate._count._all || 0;
  const clickSummary = summarizeClicks(ctaClickRows);
  const {
    ctaByCategory,
    categoryTotals: clickCategoryTotals,
    imageEngagement,
  } = buildClickEngagement(ctaClickRows, totalSessions);
  const bounceCount = bounceCandidateRows.filter((row) =>
    parseTrackedClicks(row.ctaClicks).filter(isLinkOrButtonClick).length === 0
  ).length;

  return {
    totalSessions,
    realCount,
    zombieCount,
    botCount,
    realPercent: totalSessions > 0 ? Math.round((realCount / totalSessions) * 100) : 0,
    zombiePercent: totalSessions > 0 ? Math.round((zombieCount / totalSessions) * 100) : 0,
    botPercent: totalSessions > 0 ? Math.round((botCount / totalSessions) * 100) : 0,
    addToCartCount,
    conversionCount,
    productClickCount,
    avgTimeOnPage,
    avgScrollDepth,
    atcPercent: totalSessions > 0 ? Math.round((addToCartCount / totalSessions) * 100) : 0,
    convPercent: totalSessions > 0 ? Math.round((conversionCount / totalSessions) * 100) : 0,
    productClickPercent: totalSessions > 0 ? Math.round((productClickCount / totalSessions) * 100) : 0,
    totalRevenue,
    revenuePerVisitor: realCount > 0 ? Math.round((totalRevenue / realCount) * 100) / 100 : 0,
    aov: ordersWithValue > 0 ? Math.round((totalRevenue / ordersWithValue) * 100) / 100 : 0,
    atcRate: realCount > 0 ? Math.round((addToCartCount / realCount) * 1000) / 10 : 0,
    convRate: realCount > 0 ? Math.min(Math.round((conversionCount / realCount) * 1000) / 10, 100) : 0,
    productCtrRate: percent(productClickCount, totalSessions),
    linkClickCount: clickSummary.linkClickCount,
    searchCount: searchSessionCount,
    exitCount: nonInternalExitCount,
    exitRate: percent(nonInternalExitCount, totalSessions),
    bodyCtaClickCount: clickSummary.bodyCtaClickCount,
    bodyCtaCtrRate: percent(clickSummary.visitsWithBodyCtaClick, totalSessions),
    anyLinkOrButtonClickCount: clickSummary.anyLinkOrButtonClickCount,
    anyClickCtrRate: percent(clickSummary.visitsWithAnyLinkOrButtonClick, totalSessions),
    bounceCount,
    bounceRate: percent(bounceCount, totalSessions),
    scroll50Count,
    scroll50Rate: percent(scroll50Count, totalSessions),
    scroll100Count,
    scroll100Rate: percent(scroll100Count, totalSessions),
    sourceStats,
    topCountries,
    topCities,
    deviceBreakdown,
    exitPaths,
    exitUrls,
    searchStats,
    ctaByCategory,
    clickCategoryTotals,
    imageEngagement,
    recentVisits,
  };
}

async function refreshCachedSnapshotStats(snapshotId: string) {
  const existing = statsRefreshes.get(snapshotId);
  if (existing) return existing;

  const refresh = getSnapshotStats(snapshotId)
    .then(async (value) => {
      statsCache.set(snapshotId, { value, expiresAt: Date.now() + STATS_CACHE_TTL_MS });
      try {
        await prisma.snapshotStatsCache.upsert({
          where: { snapshotId },
          create: {
            snapshotId,
            stats: JSON.parse(JSON.stringify(value)),
            recomputedAt: new Date(),
          },
          update: {
            stats: JSON.parse(JSON.stringify(value)),
            recomputedAt: new Date(),
          },
        });
      } catch (error) {
        console.warn("[MW Perf] SSE stats cache write skipped:", error);
      }
      return value;
    })
    .finally(() => {
      statsRefreshes.delete(snapshotId);
    });

  statsRefreshes.set(snapshotId, refresh);
  return refresh;
}

async function getCachedSnapshotStats(
  snapshotId: string,
  persistedStats?: { stats: unknown; recomputedAt: Date } | null,
) {
  const cached = statsCache.get(snapshotId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  if (persistedStats?.stats) {
    const value = persistedStats.stats as Awaited<ReturnType<typeof getSnapshotStats>>;
    statsCache.set(snapshotId, { value, expiresAt: Date.now() + STATS_CACHE_TTL_MS });
    if (persistedStats.recomputedAt.getTime() <= Date.now() - STATS_CACHE_TTL_MS) {
      void refreshCachedSnapshotStats(snapshotId).catch((error) => {
        console.warn("[MW Perf] SSE stats refresh skipped:", error);
      });
    }
    return value;
  }

  return refreshCachedSnapshotStats(snapshotId);
}

function formatExitType(type: string): string {
  const labels: Record<string, string> = {
    window_closed: "Closed Tab",
    back_button: "Back Button",
    idle: "Idle (2+ min)",
    internal_link: "Internal Link",
    external_link: "External Link",
    checkout: "Checkout/Cart",
    unknown: "Unknown",
  };
  return labels[type] || type;
}

export async function loader({ params }: LoaderFunctionArgs) {
  const snapshotId = params.id;

  if (!snapshotId) {
    return new Response("Snapshot ID required", { status: 400 });
  }

  // Check if snapshot exists and is active
  const snapshot = await prisma.snapshot.findUnique({
    where: { id: snapshotId },
    select: { id: true, status: true },
  });

  if (!snapshot) {
    return new Response("Snapshot not found", { status: 404 });
  }

  // Only stream for active snapshots
  if (snapshot.status !== "ACTIVE") {
    return new Response("Snapshot is not active", { status: 400 });
  }

  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const closeStream = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (interval) clearInterval(interval);
    if (!closed) {
      closed = true;
      controller.close();
    }
  };

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`: connected\n\n`));

      interval = setInterval(async () => {
        try {
          // Check if snapshot is still active
          const currentSnapshot = await prisma.snapshot.findUnique({
            where: { id: snapshotId },
            select: {
              status: true,
              statsCache: {
                select: {
                  stats: true,
                  recomputedAt: true,
                },
              },
            },
          });

          if (!currentSnapshot || currentSnapshot.status !== "ACTIVE") {
            closeStream(controller);
            return;
          }

          const stats = await getCachedSnapshotStats(snapshotId, currentSnapshot.statsCache);
          if (stats) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
          }
        } catch (error) {
          console.error("SSE error:", error);
          closeStream(controller);
        }
      }, STREAM_POLL_INTERVAL_MS);
    },
    cancel() {
      if (interval) clearInterval(interval);
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
}
