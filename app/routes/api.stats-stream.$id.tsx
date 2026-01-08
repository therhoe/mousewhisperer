import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

// Calculate stats for a snapshot
async function getSnapshotStats(snapshotId: string) {
  const snapshot = await prisma.snapshot.findFirst({
    where: { id: snapshotId },
    include: {
      visits: true,
    },
  });

  if (!snapshot) {
    return null;
  }

  const visits = snapshot.visits;
  const totalSessions = visits.length;
  const realUsers = visits.filter((v) => v.visitorType === "REAL");
  const zombies = visits.filter((v) => v.visitorType === "ZOMBIE");
  const bots = visits.filter((v) => v.visitorType === "BOT");

  const realCount = realUsers.length;
  const zombieCount = zombies.length;
  const botCount = bots.length;

  const addToCartCount = visits.filter((v) => v.addedToCart).length;
  const conversionCount = visits.filter((v) => v.converted).length;

  const avgTimeOnPage = realUsers.length > 0
    ? Math.round(realUsers.reduce((sum, v) => sum + v.timeOnPage, 0) / realUsers.length / 1000)
    : 0;
  const avgScrollDepth = realUsers.length > 0
    ? Math.round(realUsers.reduce((sum, v) => sum + v.scrollDepth, 0) / realUsers.length)
    : 0;

  // Group by source category for sourceStats
  const sourceCategories = new Map<string, {
    sessions: number;
    real: number;
    zombie: number;
    bot: number;
    avgTime: number;
    avgScroll: number;
    atc: number;
    conversions: number;
  }>();

  visits.forEach((visit) => {
    const category = visit.sourceCategory || "Unknown";
    if (!sourceCategories.has(category)) {
      sourceCategories.set(category, {
        sessions: 0, real: 0, zombie: 0, bot: 0, avgTime: 0, avgScroll: 0, atc: 0, conversions: 0,
      });
    }

    const stats = sourceCategories.get(category)!;
    stats.sessions++;
    if (visit.visitorType === "REAL") stats.real++;
    else if (visit.visitorType === "ZOMBIE") stats.zombie++;
    else if (visit.visitorType === "BOT") stats.bot++;
    if (visit.addedToCart) stats.atc++;
    if (visit.converted) stats.conversions++;
    stats.avgTime += visit.timeOnPage;
    stats.avgScroll += visit.scrollDepth;
  });

  const sourceStats = Array.from(sourceCategories.entries()).map(([category, stats]) => ({
    category,
    sessions: stats.sessions,
    real: stats.real,
    zombie: stats.zombie,
    bot: stats.bot,
    avgTime: stats.sessions > 0 ? Math.round(stats.avgTime / stats.sessions / 1000) : 0,
    avgScroll: stats.sessions > 0 ? Math.round(stats.avgScroll / stats.sessions) : 0,
    atcRate: stats.real > 0 ? Math.round((stats.atc / stats.real) * 100) : 0,
    convRate: stats.real > 0 ? Math.round((stats.conversions / stats.real) * 100) : 0,
  })).sort((a, b) => b.sessions - a.sessions);

  // Calculate geo stats
  const countryStats = new Map<string, number>();
  visits.forEach((visit) => {
    const country = visit.country || "Unknown";
    countryStats.set(country, (countryStats.get(country) || 0) + 1);
  });
  const topCountries = Array.from(countryStats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([country, count]) => ({ country, count }));

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
    avgTimeOnPage,
    avgScrollDepth,
    atcPercent: totalSessions > 0 ? Math.round((addToCartCount / totalSessions) * 100) : 0,
    convPercent: totalSessions > 0 ? Math.round((conversionCount / totalSessions) * 100) : 0,
    sourceStats,
    topCountries,
  };
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
