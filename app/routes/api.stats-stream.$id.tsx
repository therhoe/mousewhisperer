import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

// Calculate stats for a snapshot using efficient database aggregations
async function getSnapshotStats(snapshotId: string) {
  // Use parallel queries for efficiency
  const [
    visitorTypeCounts,
    conversionCounts,
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
  ] = await Promise.all([
    // Count by visitor type
    prisma.visit.groupBy({
      by: ["visitorType"],
      where: { snapshotId },
      _count: true,
    }),
    // Count conversions and add-to-cart
    prisma.visit.aggregate({
      where: { snapshotId },
      _count: { _all: true },
      _sum: { addedToCart: false, converted: false },
    }).then(async () => {
      // Prisma doesn't support _sum on boolean, so use count
      const [atc, conv] = await Promise.all([
        prisma.visit.count({ where: { snapshotId, addedToCart: true } }),
        prisma.visit.count({ where: { snapshotId, converted: true } }),
      ]);
      return { addToCartCount: atc, conversionCount: conv };
    }),
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
  ]);

  // Process visitor type counts
  let realCount = 0, zombieCount = 0, botCount = 0, totalSessions = 0;
  visitorTypeCounts.forEach((item) => {
    totalSessions += item._count;
    if (item.visitorType === "REAL") realCount = item._count;
    else if (item.visitorType === "ZOMBIE") zombieCount = item._count;
    else if (item.visitorType === "BOT") botCount = item._count;
  });

  const { addToCartCount, conversionCount } = conversionCounts;

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
  }>();

  sourceCategoryStats.forEach((item) => {
    const category = item.sourceCategory || "Unknown";
    if (!sourceMap.has(category)) {
      sourceMap.set(category, {
        sessions: 0, real: 0, zombie: 0, bot: 0, avgTime: 0, avgScroll: 0, atc: 0, conversions: 0,
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

  const sourceStats = Array.from(sourceMap.entries()).map(([category, stats]) => ({
    category,
    sessions: stats.sessions,
    real: stats.real,
    zombie: stats.zombie,
    bot: stats.bot,
    avgTime: stats.real > 0 ? Math.round(stats.avgTime / stats.real / 1000) : 0,
    avgScroll: stats.real > 0 ? Math.round(stats.avgScroll / stats.real) : 0,
    atcRate: stats.real > 0 ? Math.round((stats.atc / stats.real) * 100) : 0,
    convRate: stats.real > 0 ? Math.round((stats.conversions / stats.real) * 100) : 0,
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
    sourceStats,
    topCountries,
    topCities,
    deviceBreakdown,
    exitPaths,
    exitUrls,
    searchStats,
    recentVisits,
  };
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
  const snapshot = await prisma.snapshot.findFirst({
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

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial stats
      const initialStats = await getSnapshotStats(snapshotId);
      if (initialStats) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialStats)}\n\n`));
      }

      // Set up polling interval (every 5 seconds)
      const interval = setInterval(async () => {
        try {
          // Check if snapshot is still active
          const currentSnapshot = await prisma.snapshot.findFirst({
            where: { id: snapshotId },
            select: { status: true },
          });

          if (!currentSnapshot || currentSnapshot.status !== "ACTIVE") {
            clearInterval(interval);
            controller.close();
            return;
          }

          const stats = await getSnapshotStats(snapshotId);
          if (stats) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
          }
        } catch (error) {
          console.error("SSE error:", error);
          clearInterval(interval);
          controller.close();
        }
      }, 5000);
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
