import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useSearchParams, useRouteError, isRouteErrorResponse, Link } from "@remix-run/react";
import { useState, useEffect, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  IndexTable,
  Box,
  Divider,
  Button,
  ButtonGroup,
  ProgressBar,
  Select,
  TextField,
  Modal,
  FormLayout,
  Banner,
  Thumbnail,
  Checkbox,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { generateCSV, generatePDF } from "../utils/export.server";

// Map grouped source filter to actual sourceCategory values
const SOURCE_FILTER_MAP: Record<string, string[]> = {
  paid: ["Paid Search", "Paid Social"],
  organic: ["Organic Search", "Organic Social"],
  direct: ["Direct", "Internal"],
  referral: ["Referral"],
  email: ["Email"],
};

// Calculate stats using efficient database aggregations
async function getSnapshotStatsFromDB(snapshotId: string, dateFilter: { startedAt?: { gte?: Date; lte?: Date } }, sourceFilter?: string[]) {
  const whereClause: any = {
    snapshotId,
    ...(dateFilter.startedAt ? dateFilter : {}),
    ...(sourceFilter ? { sourceCategory: { in: sourceFilter } } : {}),
  };

  // Run all queries in parallel for maximum efficiency
  const [
    visitorTypeCounts,
    atcCount,
    convCount,
    realUserMetrics,
    sourceCategoryStats,
    countryCounts,
    cityCounts,
    deviceCounts,
    exitTypeCounts,
    recentVisits,
    topExitUrls,
    atcBySource,
    convBySource,
    topSearchQueries,
    sortPreferences,
    filterUsageCount,
    productClickCount,
    productClicksBySource,
    revenueAggregate,
    ctaClickRows,
  ] = await Promise.all([
    // Count by visitor type
    prisma.visit.groupBy({
      by: ["visitorType"],
      where: whereClause,
      _count: true,
    }),
    // Count add-to-cart
    prisma.visit.count({ where: { ...whereClause, addedToCart: true } }),
    // Count conversions
    prisma.visit.count({ where: { ...whereClause, converted: true } }),
    // Get average time and scroll for REAL users only
    prisma.visit.aggregate({
      where: { ...whereClause, visitorType: "REAL" },
      _avg: { timeOnPage: true, scrollDepth: true },
    }),
    // Group by source category with counts and sums
    prisma.visit.groupBy({
      by: ["sourceCategory", "visitorType"],
      where: whereClause,
      _count: true,
      _sum: { timeOnPage: true, scrollDepth: true },
    }),
    // Top countries
    prisma.visit.groupBy({
      by: ["country"],
      where: whereClause,
      _count: true,
      orderBy: { _count: { country: "desc" } },
      take: 5,
    }),
    // Top cities
    prisma.visit.groupBy({
      by: ["city", "region", "country"],
      where: { ...whereClause, city: { not: null } },
      _count: true,
      orderBy: { _count: { city: "desc" } },
      take: 5,
    }),
    // Device breakdown
    prisma.visit.groupBy({
      by: ["deviceType"],
      where: whereClause,
      _count: true,
      orderBy: { _count: { deviceType: "desc" } },
    }),
    // Exit type breakdown
    prisma.visit.groupBy({
      by: ["exitType"],
      where: whereClause,
      _count: true,
      orderBy: { _count: { exitType: "desc" } },
    }),
    // Recent visits (limited to 20 when filtered, 50 otherwise)
    prisma.visit.findMany({
      where: whereClause,
      orderBy: { startedAt: "desc" },
      take: sourceFilter ? 20 : 50,
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
    // Top exit URLs (for link-based exits)
    prisma.visit.groupBy({
      by: ["exitUrl"],
      where: { ...whereClause, exitUrl: { not: null } },
      _count: true,
      orderBy: { _count: { exitUrl: "desc" } },
      take: 10,
    }),
    // ATC by source
    prisma.visit.groupBy({
      by: ["sourceCategory"],
      where: { ...whereClause, addedToCart: true },
      _count: true,
    }),
    // Conversions by source
    prisma.visit.groupBy({
      by: ["sourceCategory"],
      where: { ...whereClause, converted: true },
      _count: true,
    }),
    // Top search queries
    prisma.visit.groupBy({
      by: ["searchQuery"],
      where: { ...whereClause, searchQuery: { not: null } },
      _count: true,
      orderBy: { _count: { searchQuery: "desc" } },
      take: 10,
    }),
    // Sort preferences
    prisma.visit.groupBy({
      by: ["sortBy"],
      where: { ...whereClause, sortBy: { not: null } },
      _count: true,
      orderBy: { _count: { sortBy: "desc" } },
    }),
    // Filter usage count
    prisma.visit.count({
      where: { ...whereClause, appliedFilters: { not: null } },
    }),
    // Product clicks (exits to /products/*) for collection audits
    prisma.visit.count({
      where: { ...whereClause, exitUrl: { contains: "/products/" } },
    }),
    // Product clicks by source (for collection source table)
    prisma.visit.groupBy({
      by: ["sourceCategory"],
      where: { ...whereClause, exitUrl: { contains: "/products/" } },
      _count: true,
    }),
    // Revenue aggregation
    prisma.visit.aggregate({
      where: { ...whereClause, converted: true, orderValue: { not: null } },
      _sum: { orderValue: true },
      _count: { _all: true },
    }),
    // CTA clicks — fetch raw JSON from visits that have CTA data
    prisma.visit.findMany({
      where: { ...whereClause, ctaClicks: { not: null } },
      select: { ctaClicks: true },
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

  const addToCartCount = atcCount;
  const conversionCount = convCount;

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
  }>();

  sourceCategoryStats.forEach((item) => {
    const category = item.sourceCategory || "Unknown";
    if (!sourceMap.has(category)) {
      sourceMap.set(category, {
        sessions: 0, real: 0, zombie: 0, bot: 0, avgTime: 0, avgScroll: 0, atc: 0, conversions: 0, productClicks: 0,
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

  // Aggregate CTA clicks across all visits (handles both old map and new array formats)
  const ctaMap = new Map<string, number>();
  ctaClickRows.forEach((row: { ctaClicks: string | null }) => {
    if (!row.ctaClicks) return;
    try {
      const clicks = JSON.parse(row.ctaClicks);
      if (Array.isArray(clicks)) {
        // New format: [{label, tag, href, time}, ...]
        clicks.forEach((c: any) => {
          if (c.label) ctaMap.set(c.label, (ctaMap.get(c.label) || 0) + 1);
        });
      } else {
        // Old format: {label: count}
        Object.entries(clicks).forEach(([label, count]) => {
          ctaMap.set(label, (ctaMap.get(label) || 0) + (count as number));
        });
      }
    } catch {}
  });
  const ctaStats = Array.from(ctaMap.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

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
    sourceStats,
    topCountries,
    topCities,
    deviceBreakdown,
    recentVisits,
    exitPaths,
    exitUrls,
    searchStats,
    ctaStats,
  };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const projectId = params.id;
  const url = new URL(request.url);

  try {
  // Get snapshot ID from URL or use active/latest
  const snapshotIdParam = url.searchParams.get("snapshot");
  const compareMode = url.searchParams.get("compare") === "true";
  const compareIdsParam = url.searchParams.get("compareIds");

  // Parse source filter from URL
  const sourceParam = url.searchParams.get("source");
  const sourceCategories = sourceParam && sourceParam !== "all" ? SOURCE_FILTER_MAP[sourceParam] || undefined : undefined;

  // Parse date range from URL params
  const startDateParam = url.searchParams.get("startDate");
  const endDateParam = url.searchParams.get("endDate");

  // Build date filter
  const dateFilter: { startedAt?: { gte?: Date; lte?: Date } } = {};
  if (startDateParam) {
    dateFilter.startedAt = { ...dateFilter.startedAt, gte: new Date(startDateParam) };
  }
  if (endDateParam) {
    const endDate = new Date(endDateParam);
    endDate.setHours(23, 59, 59, 999);
    dateFilter.startedAt = { ...dateFilter.startedAt, lte: endDate };
  }

  // Get project and snapshot metadata (without visits - much faster)
  const project = await prisma.project.findFirst({
    where: { id: projectId, shop },
    include: {
      snapshots: {
        orderBy: { number: "desc" },
        select: {
          id: true,
          number: true,
          name: true,
          status: true,
          targetVisitors: true,
          createdAt: true,
          completedAt: true,
          _count: {
            select: { visits: { where: { visitorType: "REAL" } } },
          },
        },
      },
    },
  });

  if (!project) {
    throw new Response("Project not found", { status: 404 });
  }

  // Find active or specified snapshot
  let selectedSnapshotMeta = snapshotIdParam
    ? project.snapshots.find((s) => s.id === snapshotIdParam)
    : project.snapshots.find((s) => s.status === "ACTIVE") || project.snapshots[0];

  if (!selectedSnapshotMeta && project.snapshots.length > 0) {
    selectedSnapshotMeta = project.snapshots[0];
  }

  // Calculate comparison data if in compare mode
  let comparisonData: Array<{
    id: string;
    name: string;
    number: number;
    createdAt: string;
    completedAt: string | null;
    status: string;
    stats: Awaited<ReturnType<typeof getSnapshotStatsFromDB>>;
  }> = [];

  if (compareMode && compareIdsParam) {
    const compareIds = compareIdsParam.split(",");
    const validSnapshots = compareIds
      .map((id) => ({ id, meta: project.snapshots.find((s) => s.id === id) }))
      .filter((s) => s.meta);

    // Run all comparison stats in parallel (pool size now supports this)
    const comparisonStats = await Promise.all(
      validSnapshots.map(({ id }) => getSnapshotStatsFromDB(id, dateFilter, sourceCategories))
    );

    validSnapshots.forEach(({ id, meta }, i) => {
      comparisonData.push({
        id,
        name: meta!.name || `Snapshot ${meta!.number}`,
        number: meta!.number,
        createdAt: meta!.createdAt.toISOString(),
        completedAt: meta!.completedAt?.toISOString() ?? null,
        status: meta!.status,
        stats: {
          ...comparisonStats[i],
          recentVisits: [], // Strip for comparison (not used, reduces payload)
        },
      });
    });
  }

  // Calculate stats using efficient database aggregations (skip in compare mode - not used)
  let stats = null;
  if (selectedSnapshotMeta && !compareMode) {
    stats = await getSnapshotStatsFromDB(selectedSnapshotMeta.id, dateFilter, sourceCategories);
  }

  // For collection audits, enrich exit URLs with product data
  let topProductsClicked: Array<{
    handle: string;
    title: string;
    imageUrl: string | null;
    imageAlt: string | null;
    count: number;
  }> = [];

  if (project.resourceType === "COLLECTION" && stats && stats.exitUrls.length > 0) {
    const handleMap = new Map<string, number>();
    stats.exitUrls.forEach((item: { url: string; count: number }) => {
      const match = item.url.match(/\/products\/([^/?#]+)/);
      if (match) {
        const handle = decodeURIComponent(match[1]);
        handleMap.set(handle, (handleMap.get(handle) || 0) + item.count);
      }
    });

    const uniqueProducts = Array.from(handleMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    if (uniqueProducts.length > 0) {
      const aliasedQueries = uniqueProducts
        .map(([handle], i) =>
          `p${i}: productByHandle(handle: "${handle}") { title featuredImage { url altText } }`
        )
        .join("\n        ");

      try {
        const response = await admin.graphql(`{\n        ${aliasedQueries}\n      }`);
        const responseJson = await response.json();
        const data = responseJson.data;

        topProductsClicked = uniqueProducts.map(([handle, count], i) => {
          const product = data?.[`p${i}`];
          return {
            handle,
            title: product?.title || handle.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
            imageUrl: product?.featuredImage?.url || null,
            imageAlt: product?.featuredImage?.altText || null,
            count,
          };
        });
      } catch (error) {
        console.error("Failed to fetch product data:", error);
        topProductsClicked = uniqueProducts.map(([handle, count]) => ({
          handle,
          title: handle.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
          imageUrl: null,
          imageAlt: null,
          count,
        }));
      }
    }
  }

  // Compute lightweight snapshot trends for the graph (revenue, ATC%, conv% across snapshots)
  // Use up to the last 6 snapshots, ordered oldest to newest
  const trendSnapshots = [...project.snapshots].reverse().slice(-6);
  const snapshotTrends: Array<{
    name: string;
    number: number;
    revenuePerVisitor: number;
    aov: number;
    atcRate: number;
    convRate: number;
  }> = [];

  if (!compareMode && trendSnapshots.length > 0) {
    const srcFilter = sourceCategories ? { sourceCategory: { in: sourceCategories } } : {};
    // Run all snapshot trend queries in parallel (2 queries per snapshot instead of 4)
    const trendResults = await Promise.all(
      trendSnapshots.map(async (snap) => {
        const [counts, revAgg] = await Promise.all([
          prisma.visit.groupBy({
            by: ["visitorType"],
            where: { snapshotId: snap.id, ...srcFilter },
            _count: true,
          }),
          prisma.visit.aggregate({
            where: { snapshotId: snap.id, ...srcFilter },
            _sum: { orderValue: true },
            _count: { _all: true },
          }),
        ]);
        return { snap, counts, revAgg };
      })
    );

    // Also get ATC/conv counts for all trend snapshots in parallel
    const trendConvResults = await Promise.all(
      trendSnapshots.map(async (snap) => {
        const [atcCount, convCount] = await Promise.all([
          prisma.visit.count({ where: { snapshotId: snap.id, addedToCart: true, ...srcFilter } }),
          prisma.visit.count({ where: { snapshotId: snap.id, converted: true, ...srcFilter } }),
        ]);
        return { atcCount, convCount };
      })
    );

    trendResults.forEach(({ snap, counts, revAgg }, i) => {
      const realCount = counts.find(c => c.visitorType === "REAL")?._count || 0;
      const rev = revAgg._sum.orderValue || 0;
      const convWithValue = revAgg._count._all || 0;
      const { atcCount, convCount } = trendConvResults[i];
      snapshotTrends.push({
        name: snap.name || `Snapshot ${snap.number}`,
        number: snap.number,
        revenuePerVisitor: realCount > 0 ? Math.round((rev / realCount) * 100) / 100 : 0,
        aov: convWithValue > 0 ? Math.round((rev / convWithValue) * 100) / 100 : 0,
        atcRate: realCount > 0 ? Math.round((atcCount / realCount) * 1000) / 10 : 0,
        convRate: realCount > 0 ? Math.round((convCount / realCount) * 1000) / 10 : 0,
      });
    });
  }

  return json({
    project: {
      id: project.id,
      productTitle: project.productTitle,
      productHandle: project.productHandle,
      resourceType: project.resourceType,
      createdAt: project.createdAt,
    },
    snapshots: project.snapshots.map((s) => ({
      id: s.id,
      number: s.number,
      name: s.name,
      status: s.status,
      targetVisitors: s.targetVisitors,
      realCount: s._count.visits,
      createdAt: s.createdAt,
      completedAt: s.completedAt,
    })),
    selectedSnapshot: selectedSnapshotMeta ? {
      id: selectedSnapshotMeta.id,
      number: selectedSnapshotMeta.number,
      name: selectedSnapshotMeta.name,
      status: selectedSnapshotMeta.status,
      targetVisitors: selectedSnapshotMeta.targetVisitors,
      realCount: selectedSnapshotMeta._count.visits,
      createdAt: selectedSnapshotMeta.createdAt,
      completedAt: selectedSnapshotMeta.completedAt,
    } : null,
    stats,
    comparisonData,
    compareMode,
    dateFilter: {
      startDate: startDateParam,
      endDate: endDateParam,
    },
    sourceFilter: sourceParam || "all",
    snapshotTrends,
    topProductsClicked,
  });

  } catch (err) {
    console.error("[MW Loader] Project page loader error:", err);
    throw new Response(
      err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err),
      { status: 500 }
    );
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const projectId = params.id;
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "pause-snapshot") {
    const snapshotId = formData.get("snapshotId") as string;
    await prisma.snapshot.update({
      where: { id: snapshotId },
      data: { status: "PAUSED" },
    });
    return json({ success: true });
  }

  if (actionType === "resume-snapshot") {
    const snapshotId = formData.get("snapshotId") as string;
    // Check if there's already an active snapshot
    const activeSnapshot = await prisma.snapshot.findFirst({
      where: { projectId, status: "ACTIVE" },
    });
    if (activeSnapshot) {
      return json({ error: "Another snapshot is already active" }, { status: 400 });
    }
    await prisma.snapshot.update({
      where: { id: snapshotId },
      data: { status: "ACTIVE" },
    });
    return json({ success: true });
  }

  if (actionType === "create-snapshot") {
    const snapshotName = formData.get("snapshotName") as string | null;
    const targetVisitors = parseInt(formData.get("targetVisitors") as string) || 1000;

    // Check if there's already an active snapshot
    const activeSnapshot = await prisma.snapshot.findFirst({
      where: { projectId, status: "ACTIVE" },
    });
    if (activeSnapshot) {
      return json({ error: "Another snapshot is already active. Pause or complete it first." }, { status: 400 });
    }

    // Get next snapshot number
    const lastSnapshot = await prisma.snapshot.findFirst({
      where: { projectId },
      orderBy: { number: "desc" },
    });

    await prisma.snapshot.create({
      data: {
        projectId: projectId!,
        number: (lastSnapshot?.number || 0) + 1,
        name: snapshotName || null,
        targetVisitors,
        status: "ACTIVE",
      },
    });

    return json({ success: true });
  }

  if (actionType === "edit-snapshot") {
    const snapshotId = formData.get("snapshotId") as string;
    const snapshotName = formData.get("snapshotName") as string | null;
    const targetVisitors = parseInt(formData.get("targetVisitors") as string);

    // Get current snapshot to validate
    const snapshot = await prisma.snapshot.findUnique({
      where: { id: snapshotId },
      include: { _count: { select: { visits: { where: { visitorType: "REAL" } } } } },
    });

    if (!snapshot) {
      return json({ error: "Snapshot not found" }, { status: 404 });
    }

    // Can't lower target below current real count
    if (targetVisitors < snapshot._count.visits) {
      return json({ error: `Target cannot be lower than current real users (${snapshot._count.visits})` }, { status: 400 });
    }

    // Check if we should complete the snapshot
    const shouldComplete = targetVisitors <= snapshot._count.visits;

    await prisma.snapshot.update({
      where: { id: snapshotId },
      data: {
        name: snapshotName || null,
        targetVisitors,
        ...(shouldComplete && { status: "COMPLETED", completedAt: new Date() }),
      },
    });

    return json({ success: true });
  }

  if (actionType === "delete-snapshot") {
    const snapshotId = formData.get("snapshotId") as string;
    await prisma.snapshot.delete({ where: { id: snapshotId } });
    return json({ success: true });
  }

  if (actionType === "delete-project") {
    await prisma.project.delete({ where: { id: projectId } });
    return json({ success: true, redirect: "/app" });
  }

  if (actionType === "export-csv" || actionType === "export-pdf") {
    const snapshotId = formData.get("snapshotId") as string;
    const snapshot = await prisma.snapshot.findUnique({
      where: { id: snapshotId },
      include: {
        visits: true,
        project: true,
      },
    });

    if (!snapshot) {
      return json({ error: "Snapshot not found" }, { status: 404 });
    }

    const snapshotInfo = {
      name: snapshot.name || `Snapshot ${snapshot.number}`,
      number: snapshot.number,
      targetVisitors: snapshot.targetVisitors,
    };

    if (actionType === "export-csv") {
      const csv = generateCSV(snapshot.visits, snapshot.project, snapshotInfo);
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${snapshot.project.productHandle}-snapshot-${snapshot.number}-report.csv"`,
        },
      });
    }

    if (actionType === "export-pdf") {
      const visits = snapshot.visits;
      const totalSessions = visits.length;
      const realUsers = visits.filter((v) => v.visitorType === "REAL");
      const zombies = visits.filter((v) => v.visitorType === "ZOMBIE");
      const bots = visits.filter((v) => v.visitorType === "BOT");
      const addToCartCount = visits.filter((v) => v.addedToCart).length;
      const conversionCount = visits.filter((v) => v.converted).length;

      const stats = {
        totalSessions,
        realCount: realUsers.length,
        zombieCount: zombies.length,
        botCount: bots.length,
        realPercent: totalSessions > 0 ? Math.round((realUsers.length / totalSessions) * 100) : 0,
        zombiePercent: totalSessions > 0 ? Math.round((zombies.length / totalSessions) * 100) : 0,
        botPercent: totalSessions > 0 ? Math.round((bots.length / totalSessions) * 100) : 0,
        addToCartCount,
        conversionCount,
        avgTimeOnPage: realUsers.length > 0
          ? Math.round(realUsers.reduce((sum, v) => sum + v.timeOnPage, 0) / realUsers.length / 1000)
          : 0,
        avgScrollDepth: realUsers.length > 0
          ? Math.round(realUsers.reduce((sum, v) => sum + v.scrollDepth, 0) / realUsers.length)
          : 0,
      };

      const sourceCategories = new Map<string, any>();
      visits.forEach((visit) => {
        const category = visit.sourceCategory || "Unknown";
        if (!sourceCategories.has(category)) {
          sourceCategories.set(category, { sessions: 0, real: 0, zombie: 0, bot: 0, avgTime: 0, avgScroll: 0, atc: 0, conversions: 0 });
        }
        const s = sourceCategories.get(category)!;
        s.sessions++;
        if (visit.visitorType === "REAL") {
          s.real++;
          // Only count time/scroll for real users
          s.avgTime += visit.timeOnPage;
          s.avgScroll += visit.scrollDepth;
        } else if (visit.visitorType === "ZOMBIE") {
          s.zombie++;
        } else if (visit.visitorType === "BOT") {
          s.bot++;
        }
        if (visit.addedToCart) s.atc++;
        if (visit.converted) s.conversions++;
      });

      const sourceStats = Array.from(sourceCategories.entries()).map(([category, s]) => ({
        category,
        sessions: s.sessions,
        real: s.real,
        zombie: s.zombie,
        bot: s.bot,
        // Divide by real users count, not total sessions
        avgTime: s.real > 0 ? Math.round(s.avgTime / s.real / 1000) : 0,
        avgScroll: s.real > 0 ? Math.round(s.avgScroll / s.real) : 0,
        atcRate: s.real > 0 ? Math.round((s.atc / s.real) * 100) : 0,
        convRate: s.real > 0 ? Math.min(Math.round((s.conversions / s.real) * 100), 100) : 0,
      })).sort((a, b) => b.sessions - a.sessions);

      const pdf = await generatePDF(snapshot.project, stats, sourceStats, snapshotInfo);
      return new Response(Buffer.from(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${snapshot.project.productHandle}-snapshot-${snapshot.number}-report.pdf"`,
        },
      });
    }
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
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

function getSourceIcon(category: string): string {
  const icons: Record<string, string> = {
    "Direct": "\u{1F310}",        // globe
    "Internal": "\u{1F3E0}",      // house
    "Paid Search": "\u{1F4B0}",   // money bag
    "Paid Social": "\u{1F4B3}",   // credit card
    "Organic Search": "\u{1F50D}", // magnifying glass
    "Organic Social": "\u{1F4F1}", // mobile phone
    "Referral": "\u{1F517}",      // link
    "Email": "\u{2709}\uFE0F",    // envelope
    "Unknown": "\u{2753}",        // question mark
  };
  return icons[category] || "\u{1F310}";
}

function getDeviceIcon(device: string): string {
  const icons: Record<string, string> = {
    "desktop": "\u{1F5A5}\uFE0F",  // desktop monitor
    "mobile": "\u{1F4F1}",         // mobile phone
    "tablet": "\u{1F4BB}",         // laptop (closest to tablet)
  };
  return icons[(device || "").toLowerCase()] || "\u{2753}";
}

function StatCard({ title, value, subtitle, tone }: {
  title: string;
  value: string | number;
  subtitle?: string;
  tone?: "success" | "warning" | "critical";
}) {
  return (
    <Box padding="400" background="bg-surface-secondary" borderRadius="200">
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {title}
        </Text>
        <InlineStack gap="200" align="start" blockAlign="center">
          <Text as="p" variant="headingLg">
            {value}
          </Text>
          {subtitle && (
            <Badge tone={tone}>{subtitle}</Badge>
          )}
        </InlineStack>
      </BlockStack>
    </Box>
  );
}

function ConversionFunnel({ stats, isCollection = false }: { stats: any; isCollection?: boolean }) {
  const stages: Array<{
    label: string;
    value: number;
    percent: number;
    badgeTone?: "success" | "warning" | "critical" | "attention" | "info";
    progressTone?: "success" | "critical" | "highlight" | "primary";
  }> = [
    { label: "All Sessions", value: stats.totalSessions, percent: 100, progressTone: "primary" },
    { label: "Real Users", value: stats.realCount, percent: stats.realPercent, badgeTone: "info", progressTone: "highlight" },
    { label: isCollection ? "Quick Add" : "Added to Cart", value: stats.addToCartCount, percent: stats.atcPercent || 0, badgeTone: "warning", progressTone: "highlight" },
    { label: isCollection ? "Product" : "Conversions", value: isCollection ? stats.productClickCount : stats.conversionCount, percent: isCollection ? (stats.productClickPercent || 0) : (stats.convPercent || 0), badgeTone: "success", progressTone: "success" },
  ];

  return (
    <BlockStack gap="300">
      {stages.map((stage) => (
        <Box key={stage.label} paddingBlockEnd="200">
          <BlockStack gap="100">
            <InlineStack align="space-between">
              <Text as="span" variant="bodyMd">{stage.label}</Text>
              <InlineStack gap="200">
                <Text as="span" variant="bodyMd" fontWeight="semibold">{stage.value}</Text>
                <Badge tone={stage.badgeTone}>{`${stage.percent}%`}</Badge>
              </InlineStack>
            </InlineStack>
            <ProgressBar progress={stage.percent} size="small" tone={stage.progressTone} />
          </BlockStack>
        </Box>
      ))}
    </BlockStack>
  );
}

// --- Comparison helpers ---

type MetricConfig = {
  id: string;
  label: string;
  group: "traffic" | "quality" | "engagement" | "conversion";
  getValue: (stats: any, isCollection: boolean) => number;
  format: (value: number) => string;
  isPercentage: boolean;
  higherIsBetter: boolean;
  tone?: "success" | "caution" | "critical";
};

const COMPARISON_METRICS: MetricConfig[] = [
  // Traffic
  { id: "totalSessions", label: "Total Sessions", group: "traffic", getValue: (s) => s.totalSessions, format: (v) => String(v), isPercentage: false, higherIsBetter: true },
  { id: "realCount", label: "Real Users", group: "traffic", getValue: (s) => s.realCount, format: (v) => String(v), isPercentage: false, higherIsBetter: true, tone: "success" },
  { id: "zombieCount", label: "Zombies", group: "traffic", getValue: (s) => s.zombieCount, format: (v) => String(v), isPercentage: false, higherIsBetter: false, tone: "caution" },
  { id: "botCount", label: "Bots", group: "traffic", getValue: (s) => s.botCount, format: (v) => String(v), isPercentage: false, higherIsBetter: false, tone: "critical" },
  // Quality
  { id: "realPercent", label: "Real %", group: "quality", getValue: (s) => s.realPercent, format: (v) => `${v}%`, isPercentage: true, higherIsBetter: true, tone: "success" },
  { id: "zombiePercent", label: "Zombie %", group: "quality", getValue: (s) => s.zombiePercent, format: (v) => `${v}%`, isPercentage: true, higherIsBetter: false, tone: "caution" },
  { id: "botPercent", label: "Bot %", group: "quality", getValue: (s) => s.botPercent, format: (v) => `${v}%`, isPercentage: true, higherIsBetter: false, tone: "critical" },
  // Engagement
  { id: "avgTime", label: "Avg Time", group: "engagement", getValue: (s) => s.avgTimeOnPage, format: (v) => formatTime(v), isPercentage: false, higherIsBetter: true },
  { id: "avgScroll", label: "Avg Scroll", group: "engagement", getValue: (s) => s.avgScrollDepth, format: (v) => `${v}%`, isPercentage: true, higherIsBetter: true },
  // Conversion
  { id: "atcCount", label: "ATC_LABEL", group: "conversion", getValue: (s) => s.addToCartCount, format: (v) => String(v), isPercentage: false, higherIsBetter: true },
  { id: "atcPercent", label: "ATC_LABEL Rate", group: "conversion", getValue: (s) => s.atcPercent, format: (v) => `${v}%`, isPercentage: true, higherIsBetter: true },
  { id: "convCount", label: "CONV_LABEL", group: "conversion", getValue: (s, isCol) => isCol ? s.productClickCount : s.conversionCount, format: (v) => String(v), isPercentage: false, higherIsBetter: true },
  { id: "convPercent", label: "CONV_LABEL Rate", group: "conversion", getValue: (s, isCol) => isCol ? (s.productClickPercent || 0) : (s.convPercent || 0), format: (v) => `${v}%`, isPercentage: true, higherIsBetter: true },
];

const METRIC_GROUPS: Array<{ key: string; label: string }> = [
  { key: "traffic", label: "Traffic" },
  { key: "quality", label: "Quality" },
  { key: "engagement", label: "Engagement" },
  { key: "conversion", label: "Conversion" },
];

function getMetricLabel(metric: MetricConfig, atcLabel: string, convLabel: string): string {
  return metric.label.replace("ATC_LABEL", atcLabel).replace("CONV_LABEL", convLabel);
}

function computeDelta(first: number, last: number, isPercentage: boolean): {
  raw: number;
  formatted: string;
  direction: "up" | "down" | "flat";
} {
  const diff = last - first;
  if (diff === 0) return { raw: 0, formatted: "0", direction: "flat" };
  const direction: "up" | "down" = diff > 0 ? "up" : "down";
  if (isPercentage) {
    const sign = diff > 0 ? "+" : "";
    return { raw: diff, formatted: `${sign}${diff}pp`, direction };
  }
  const pctChange = first > 0 ? Math.round((diff / first) * 100) : (diff > 0 ? 100 : -100);
  const sign = diff > 0 ? "+" : "";
  return { raw: diff, formatted: `${sign}${diff} (${sign}${pctChange}%)`, direction };
}

function getDeltaTone(direction: "up" | "down" | "flat", higherIsBetter: boolean): "success" | "critical" | "subdued" {
  if (direction === "flat") return "subdued";
  const isImprovement = (direction === "up" && higherIsBetter) || (direction === "down" && !higherIsBetter);
  return isImprovement ? "success" : "critical";
}

function getDeltaArrow(direction: "up" | "down" | "flat"): string {
  if (direction === "up") return "\u25B2";
  if (direction === "down") return "\u25BC";
  return "\u2014";
}

function findWinnerIndex(values: number[], higherIsBetter: boolean): number {
  if (values.length === 0) return -1;
  let bestIdx = 0;
  for (let i = 1; i < values.length; i++) {
    if (higherIsBetter ? values[i] > values[bestIdx] : values[i] < values[bestIdx]) {
      bestIdx = i;
    }
  }
  return values.every((v) => v === values[0]) ? -1 : bestIdx;
}

function generateVerdict(
  data: Array<{ name: string; stats: any }>,
  isCollection: boolean,
): { text: string; tone: "success" | "warning" | "critical" | "info" } {
  if (data.length < 2) return { text: "Select at least two snapshots to compare.", tone: "info" };
  const first = data[0];
  const last = data[data.length - 1];

  const realDelta = last.stats.realPercent - first.stats.realPercent;
  const botDelta = last.stats.botPercent - first.stats.botPercent;
  const atcDelta = last.stats.atcPercent - first.stats.atcPercent;
  const convDelta = isCollection
    ? (last.stats.productClickPercent || 0) - (first.stats.productClickPercent || 0)
    : last.stats.convPercent - first.stats.convPercent;

  const improvements: string[] = [];
  const regressions: string[] = [];

  if (realDelta > 0) improvements.push(`real user rate +${realDelta}pp`);
  else if (realDelta < 0) regressions.push(`real user rate ${realDelta}pp`);
  if (botDelta < 0) improvements.push(`bot traffic ${botDelta}pp`);
  else if (botDelta > 0) regressions.push(`bot traffic +${botDelta}pp`);
  if (atcDelta > 0) improvements.push(`${isCollection ? "quick add" : "ATC"} rate +${atcDelta}pp`);
  else if (atcDelta < 0) regressions.push(`${isCollection ? "quick add" : "ATC"} rate ${atcDelta}pp`);
  if (convDelta > 0) improvements.push(`${isCollection ? "product click" : "conversion"} rate +${convDelta}pp`);
  else if (convDelta < 0) regressions.push(`${isCollection ? "product click" : "conversion"} rate ${convDelta}pp`);

  let text = `${last.name} vs ${first.name}: `;
  if (improvements.length > 0 && regressions.length === 0) {
    text += `Improved ${improvements.join(", ")}`;
    return { text, tone: "success" };
  } else if (regressions.length > 0 && improvements.length === 0) {
    text += `Regressed \u2014 ${regressions.join(", ")}`;
    return { text, tone: "critical" };
  } else if (improvements.length > 0 && regressions.length > 0) {
    text += `Improved ${improvements.join(", ")}. But ${regressions.join(", ")}`;
    return { text, tone: "warning" };
  }
  text += "No significant changes detected.";
  return { text, tone: "info" };
}

function formatSnapshotDateRange(createdAt: string, completedAt: string | null, status: string): string {
  const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const start = fmt(createdAt);
  if (completedAt) return `${start} \u2013 ${fmt(completedAt)}`;
  return status === "ACTIVE" ? `${start} \u2013 Now` : start;
}

function getProgressTone(metric: MetricConfig): "success" | "critical" | "highlight" | "primary" {
  if (metric.tone === "success") return "success";
  if (metric.tone === "critical") return "critical";
  return "highlight";
}

const DATE_PRESETS = [
  { label: "All Time", value: "all" },
  { label: "Today", value: "today" },
  { label: "Last 7 Days", value: "7days" },
  { label: "Last 30 Days", value: "30days" },
  { label: "Custom", value: "custom" },
];

export default function ProjectDetails() {
  const { project, snapshots, selectedSnapshot, stats, comparisonData, compareMode, dateFilter, sourceFilter: activeSource, snapshotTrends, topProductsClicked } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isLoading = navigation.state !== "idle";

  const isCollection = project.resourceType === "COLLECTION";
  const atcLabel = isCollection ? "Quick Add" : "Add to Cart";
  const convLabel = isCollection ? "Product" : "Conversions";

  // Date filter state
  const [datePreset, setDatePreset] = useState(() => {
    if (!dateFilter.startDate && !dateFilter.endDate) return "all";
    return "custom";
  });
  const [startDate, setStartDate] = useState(dateFilter.startDate || "");
  const [endDate, setEndDate] = useState(dateFilter.endDate || "");

  // Modal states
  const [isNewSnapshotModalOpen, setIsNewSnapshotModalOpen] = useState(false);
  const [isEditSnapshotModalOpen, setIsEditSnapshotModalOpen] = useState(false);
  const [snapshotName, setSnapshotName] = useState("");
  const [targetVisitors, setTargetVisitors] = useState("1000");

  // Compare mode state
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);


  // Real-time stats state
  const [liveStats, setLiveStats] = useState(stats);
  const [isLive, setIsLive] = useState(false);

  // Source filter (clicking Traffic by Source rows filters Recent Visits)
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [expandedVisits, setExpandedVisits] = useState<Set<string>>(new Set());

  // SSE connection for real-time updates
  useEffect(() => {
    if (!selectedSnapshot || selectedSnapshot.status !== "ACTIVE") return;

    const eventSource = new EventSource(`/api/stats-stream/${selectedSnapshot.id}`);

    eventSource.onopen = () => setIsLive(true);

    eventSource.onmessage = (event) => {
      try {
        const newStats = JSON.parse(event.data);
        setLiveStats(newStats);
      } catch (e) {
        console.error("Failed to parse SSE data:", e);
      }
    };

    eventSource.onerror = () => {
      setIsLive(false);
      eventSource.close();
    };

    return () => {
      eventSource.close();
      setIsLive(false);
    };
  }, [selectedSnapshot?.id, selectedSnapshot?.status]);

  const displayStats = selectedSnapshot?.status === "ACTIVE" && isLive ? liveStats : stats;

  const handleDatePresetChange = useCallback((value: string) => {
    setDatePreset(value);

    const today = new Date();
    let newStartDate = "";
    let newEndDate = today.toISOString().split("T")[0];

    switch (value) {
      case "all":
        newStartDate = "";
        newEndDate = "";
        break;
      case "today":
        newStartDate = newEndDate;
        break;
      case "7days":
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        newStartDate = weekAgo.toISOString().split("T")[0];
        break;
      case "30days":
        const monthAgo = new Date(today);
        monthAgo.setDate(monthAgo.getDate() - 30);
        newStartDate = monthAgo.toISOString().split("T")[0];
        break;
      case "custom":
        return;
    }

    setStartDate(newStartDate);
    setEndDate(newEndDate);

    const params = new URLSearchParams(searchParams);
    if (newStartDate) {
      params.set("startDate", newStartDate);
    } else {
      params.delete("startDate");
    }
    if (newEndDate && value !== "all") {
      params.set("endDate", newEndDate);
    } else {
      params.delete("endDate");
    }
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const applyCustomDateFilter = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    if (startDate) {
      params.set("startDate", startDate);
    } else {
      params.delete("startDate");
    }
    if (endDate) {
      params.set("endDate", endDate);
    } else {
      params.delete("endDate");
    }
    setSearchParams(params);
  }, [startDate, endDate, searchParams, setSearchParams]);

  const handleSourceFilter = useCallback((source: string) => {
    const params = new URLSearchParams(searchParams);
    if (source === "all") {
      params.delete("source");
    } else {
      params.set("source", source);
    }
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const handleSnapshotSelect = useCallback((snapshotId: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("snapshot", snapshotId);
    params.delete("compare");
    params.delete("compareIds");
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const handleToggleCompare = useCallback((snapshotId: string) => {
    setSelectedForCompare((prev) => {
      if (prev.includes(snapshotId)) {
        return prev.filter((id) => id !== snapshotId);
      }
      if (prev.length >= 4) return prev;
      return [...prev, snapshotId];
    });
  }, []);

  const enterCompareMode = useCallback(() => {
    if (selectedForCompare.length < 2) return;
    // Sort by createdAt ascending (oldest first)
    const sorted = [...selectedForCompare].sort((a, b) => {
      const snapA = snapshots.find((s) => s.id === a);
      const snapB = snapshots.find((s) => s.id === b);
      return new Date(snapA?.createdAt || 0).getTime() - new Date(snapB?.createdAt || 0).getTime();
    });
    const params = new URLSearchParams(searchParams);
    params.set("compare", "true");
    params.set("compareIds", sorted.join(","));
    setSearchParams(params);
    setIsCompareModalOpen(false);
    setSelectedForCompare([]);
  }, [selectedForCompare, snapshots, searchParams, setSearchParams]);

  const exitCompareMode = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.delete("compare");
    params.delete("compareIds");
    setSearchParams(params);
    setSelectedForCompare([]);
    setIsCompareModalOpen(false);
  }, [searchParams, setSearchParams]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return (
          <InlineStack gap="200">
            <Badge tone="success">Active</Badge>
            {isLive && <Badge tone="info">Live</Badge>}
          </InlineStack>
        );
      case "COMPLETED":
        return <Badge tone="info">Completed</Badge>;
      case "PAUSED":
        return <Badge tone="warning">Paused</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const handleAction = (action: string, extra?: Record<string, string>) => {
    const formData = new FormData();
    formData.append("action", action);
    if (selectedSnapshot) {
      formData.append("snapshotId", selectedSnapshot.id);
    }
    if (extra) {
      Object.entries(extra).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }
    submit(formData, { method: "POST" });
  };

  const handleExport = useCallback(async (format: "csv" | "pdf") => {
    if (!selectedSnapshot) return;

    try {
      const response = await fetch(`/api/export/${selectedSnapshot.id}?format=${format}`);
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Export failed:", errorText);
        return;
      }

      // Get the blob and create download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report-snapshot-${selectedSnapshot.number}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export error:", error);
    }
  }, [selectedSnapshot]);

  const handleCreateSnapshot = useCallback(() => {
    const formData = new FormData();
    formData.append("action", "create-snapshot");
    formData.append("snapshotName", snapshotName);
    formData.append("targetVisitors", targetVisitors);
    submit(formData, { method: "POST" });
    setIsNewSnapshotModalOpen(false);
    setSnapshotName("");
    setTargetVisitors("1000");
  }, [snapshotName, targetVisitors, submit]);

  const handleEditSnapshot = useCallback(() => {
    if (!selectedSnapshot) return;
    const formData = new FormData();
    formData.append("action", "edit-snapshot");
    formData.append("snapshotId", selectedSnapshot.id);
    formData.append("snapshotName", snapshotName);
    formData.append("targetVisitors", targetVisitors);
    submit(formData, { method: "POST" });
    setIsEditSnapshotModalOpen(false);
  }, [selectedSnapshot, snapshotName, targetVisitors, submit]);

  const openEditModal = useCallback(() => {
    if (!selectedSnapshot) return;
    setSnapshotName(selectedSnapshot.name || "");
    setTargetVisitors(String(selectedSnapshot.targetVisitors));
    setIsEditSnapshotModalOpen(true);
  }, [selectedSnapshot]);

  const openNewSnapshotModal = useCallback(() => {
    const lastTarget = snapshots[0]?.targetVisitors || 1000;
    setSnapshotName("");
    setTargetVisitors(String(lastTarget));
    setIsNewSnapshotModalOpen(true);
  }, [snapshots]);

  const hasActiveSnapshot = snapshots.some((s) => s.status === "ACTIVE");

  const sourceStats = displayStats?.sourceStats || [];
  const topCountries = displayStats?.topCountries || [];
  const filteredRecentVisits = sourceFilter
    ? (displayStats?.recentVisits || []).filter((v: any) => (v.sourceCategory || "Unknown") === sourceFilter)
    : (displayStats?.recentVisits || []);

  const rowMarkup = sourceStats.map((source: any, index: number) => (
    <IndexTable.Row
      id={source.category}
      key={source.category}
      position={index}
      onClick={() => setSourceFilter(sourceFilter === source.category ? null : source.category)}
      selected={sourceFilter === source.category}
    >
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="semibold" as="span">
          {getSourceIcon(source.category)} {source.category}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{source.sessions}</IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" tone="success">{source.real}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" tone="caution">{source.zombie}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" tone="critical">{source.bot}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{formatTime(source.avgTime)}</IndexTable.Cell>
      <IndexTable.Cell>{source.avgScroll}%</IndexTable.Cell>
      <IndexTable.Cell>{source.atcRate}%</IndexTable.Cell>
      <IndexTable.Cell>{isCollection ? source.productClickRate : source.convRate}%</IndexTable.Cell>
    </IndexTable.Row>
  ));

  // No snapshots view
  if (snapshots.length === 0) {
    return (
      <Page
        fullWidth
        backAction={{ content: "Dashboard", url: "/app" }}
        title={project.productTitle}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" align="center">
                <Text as="h2" variant="headingMd">No Snapshots Yet</Text>
                <Text as="p" tone="subdued">Create a snapshot to start tracking visitors for this product.</Text>
                <Button variant="primary" onClick={openNewSnapshotModal}>Create Snapshot</Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Modal
          open={isNewSnapshotModalOpen}
          onClose={() => setIsNewSnapshotModalOpen(false)}
          title="Create New Snapshot"
          primaryAction={{
            content: "Create",
            onAction: handleCreateSnapshot,
            loading: isLoading,
          }}
          secondaryActions={[{ content: "Cancel", onAction: () => setIsNewSnapshotModalOpen(false) }]}
        >
          <Modal.Section>
            <FormLayout>
              <TextField
                label="Snapshot Name"
                value={snapshotName}
                onChange={setSnapshotName}
                placeholder="e.g., Baseline, After Redesign"
                helpText="Optional label for this measurement period"
                autoComplete="off"
              />
              <TextField
                label="Target Visitors"
                type="number"
                value={targetVisitors}
                onChange={setTargetVisitors}
                min={100}
                helpText="Number of real visitors to collect before completing"
                autoComplete="off"
              />
            </FormLayout>
          </Modal.Section>
        </Modal>
      </Page>
    );
  }

  // Compare mode view
  if (compareMode && comparisonData.length >= 2) {
    console.log("[MW Compare] Rendering comparison view with", comparisonData.length, "snapshots");
    let verdict: { text: string; tone: "success" | "warning" | "critical" | "info" };
    try {
      verdict = generateVerdict(comparisonData, isCollection);
    } catch (err) {
      console.error("[MW Compare] generateVerdict error:", err);
      verdict = { text: "Error computing verdict", tone: "info" };
    }
    const hasDelta = comparisonData.length === 2;
    const totalCols = 1 + comparisonData.length + (hasDelta ? 1 : 0);

    // Collect all source categories across snapshots
    const allSources = Array.from(
      new Set(comparisonData.flatMap((s) => (s.stats.sourceStats || []).map((src: any) => src.category)))
    ).sort();

    const cellStyle = { padding: "10px 16px", borderBottom: "1px solid var(--p-color-border-subdued)" };
    const headerCellStyle = { ...cellStyle, textAlign: "left" as const };

    return (
      <Page
        fullWidth
        backAction={{ content: "Dashboard", url: "/app" }}
        title={project.productTitle}
        subtitle="Snapshot Comparison"
        primaryAction={{ content: "Exit Compare", onAction: exitCompareMode }}
      >
        <Layout>
          {/* Section 1: Summary Verdict */}
          <Layout.Section>
            <Banner title="Comparison Summary" tone={verdict.tone}>
              <p>{verdict.text}</p>
            </Banner>
          </Layout.Section>

          {/* Section 2: Grouped Metric Comparison Table */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Metrics Comparison</Text>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid var(--p-color-border-subdued)" }}>
                        <th style={{ ...headerCellStyle, minWidth: 140 }}>
                          <Text as="span" variant="bodySm" fontWeight="semibold">Metric</Text>
                        </th>
                        {comparisonData.map((s) => (
                          <th key={s.id} style={{ ...headerCellStyle, minWidth: 120 }}>
                            <BlockStack gap="050">
                              <Text as="span" variant="bodySm" fontWeight="semibold">{s.name}</Text>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {formatSnapshotDateRange(s.createdAt, s.completedAt, s.status)}
                              </Text>
                            </BlockStack>
                          </th>
                        ))}
                        {hasDelta && (
                          <th style={{ ...headerCellStyle, minWidth: 120 }}>
                            <Text as="span" variant="bodySm" fontWeight="semibold">Change</Text>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {METRIC_GROUPS.map((group) => {
                        const metricsInGroup = COMPARISON_METRICS.filter((m) => m.group === group.key);
                        return [
                          <tr key={`group-${group.key}`}>
                            <td colSpan={totalCols} style={{
                              padding: "8px 16px",
                              backgroundColor: "var(--p-color-bg-surface-secondary)",
                              borderBottom: "1px solid var(--p-color-border-subdued)",
                            }}>
                              <Text as="span" variant="bodyMd" fontWeight="bold">{group.label}</Text>
                            </td>
                          </tr>,
                          ...metricsInGroup.map((metric) => {
                            const values = comparisonData.map((s) => metric.getValue(s.stats, isCollection));
                            const winnerIdx = findWinnerIndex(values, metric.higherIsBetter);
                            const label = getMetricLabel(metric, atcLabel, convLabel);
                            const delta = hasDelta ? computeDelta(values[0], values[1], metric.isPercentage) : null;
                            const deltaTone = delta ? getDeltaTone(delta.direction, metric.higherIsBetter) : "subdued";

                            return (
                              <tr key={metric.id}>
                                <td style={cellStyle}>
                                  <Text as="span" fontWeight="semibold">{label}</Text>
                                </td>
                                {comparisonData.map((s, idx) => {
                                  const value = values[idx];
                                  const isWinner = idx === winnerIdx;
                                  return (
                                    <td key={s.id} style={{
                                      ...cellStyle,
                                      backgroundColor: isWinner ? "var(--p-color-bg-surface-success)" : "transparent",
                                    }}>
                                      <BlockStack gap="100">
                                        <Text as="span" fontWeight={isWinner ? "bold" : "regular"} tone={metric.tone}>
                                          {metric.format(value)}
                                        </Text>
                                        {metric.isPercentage && (
                                          <div style={{ maxWidth: 80 }}>
                                            <ProgressBar progress={Math.min(value, 100)} size="small" tone={getProgressTone(metric)} />
                                          </div>
                                        )}
                                      </BlockStack>
                                    </td>
                                  );
                                })}
                                {hasDelta && delta && (
                                  <td style={cellStyle}>
                                    <Text as="span" tone={deltaTone}>
                                      {getDeltaArrow(delta.direction)} {delta.formatted}
                                    </Text>
                                  </td>
                                )}
                              </tr>
                            );
                          }),
                        ];
                      })}
                    </tbody>
                  </table>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Section 3: Side-by-Side Conversion Funnels */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Conversion Funnels</Text>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${comparisonData.length}, 1fr)`,
                  gap: 16,
                }}>
                  {comparisonData.map((s) => (
                    <Box key={s.id} padding="400" background="bg-surface-secondary" borderRadius="200">
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">{s.name}</Text>
                        <ConversionFunnel stats={s.stats} isCollection={isCollection} />
                      </BlockStack>
                    </Box>
                  ))}
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Section 4: Source Quality Comparison */}
          {allSources.length > 0 && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Source Quality Comparison</Text>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid var(--p-color-border-subdued)" }}>
                          <th style={{ ...headerCellStyle, minWidth: 140 }}>
                            <Text as="span" variant="bodySm" fontWeight="semibold">Source</Text>
                          </th>
                          {comparisonData.map((s) => (
                            <th key={s.id} style={headerCellStyle}>
                              <Text as="span" variant="bodySm" fontWeight="semibold">{s.name} Real %</Text>
                            </th>
                          ))}
                          {hasDelta && (
                            <th style={headerCellStyle}>
                              <Text as="span" variant="bodySm" fontWeight="semibold">Change</Text>
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {allSources.map((source) => {
                          const values = comparisonData.map((s) => {
                            const found = (s.stats.sourceStats || []).find((src: any) => src.category === source);
                            return found && found.sessions > 0 ? Math.round((found.real / found.sessions) * 100) : 0;
                          });
                          const winnerIdx = findWinnerIndex(values, true);
                          const delta = hasDelta ? computeDelta(values[0], values[1], true) : null;
                          const deltaTone = delta ? getDeltaTone(delta.direction, true) : "subdued";

                          return (
                            <tr key={source}>
                              <td style={cellStyle}>
                                <Text as="span" fontWeight="semibold">
                                  {getSourceIcon(source)} {source}
                                </Text>
                              </td>
                              {values.map((val, i) => (
                                <td key={comparisonData[i].id} style={{
                                  ...cellStyle,
                                  backgroundColor: i === winnerIdx ? "var(--p-color-bg-surface-success)" : "transparent",
                                }}>
                                  <InlineStack gap="200" blockAlign="center">
                                    <Text as="span" fontWeight={i === winnerIdx ? "bold" : "regular"}>{val}%</Text>
                                    <div style={{ width: 60 }}>
                                      <ProgressBar progress={Math.min(val, 100)} size="small" tone="success" />
                                    </div>
                                  </InlineStack>
                                </td>
                              ))}
                              {hasDelta && delta && (
                                <td style={cellStyle}>
                                  <Text as="span" tone={deltaTone}>
                                    {getDeltaArrow(delta.direction)} {delta.formatted}
                                  </Text>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* Section 5a: Geographic Comparison */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Geographic Comparison</Text>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${comparisonData.length}, 1fr)`,
                  gap: 16,
                }}>
                  {comparisonData.map((s) => (
                    <Box key={s.id} padding="300" background="bg-surface-secondary" borderRadius="200">
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">{s.name}</Text>
                        <Divider />
                        {(!s.stats.topCountries || s.stats.topCountries.length === 0) ? (
                          <Text as="p" tone="subdued">No geo data</Text>
                        ) : (
                          s.stats.topCountries.map((item: any) => (
                            <InlineStack key={item.country} align="space-between">
                              <Text as="span">{item.country}</Text>
                              <Badge>{String(item.count)}</Badge>
                            </InlineStack>
                          ))
                        )}
                      </BlockStack>
                    </Box>
                  ))}
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Section 5b: Device Comparison */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Device Comparison</Text>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${comparisonData.length}, 1fr)`,
                  gap: 16,
                }}>
                  {comparisonData.map((s) => (
                    <Box key={s.id} padding="300" background="bg-surface-secondary" borderRadius="200">
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">{s.name}</Text>
                        <Divider />
                        {(!s.stats.deviceBreakdown || s.stats.deviceBreakdown.length === 0) ? (
                          <Text as="p" tone="subdued">No device data</Text>
                        ) : (
                          s.stats.deviceBreakdown.map((item: any) => (
                            <InlineStack key={item.device} align="space-between">
                              <Text as="span">{getDeviceIcon(item.device)} {item.device}</Text>
                              <Badge>{`${item.percent}%`}</Badge>
                            </InlineStack>
                          ))
                        )}
                      </BlockStack>
                    </Box>
                  ))}
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const snapshotSelectOptions = snapshots.map((s) => {
    const statusLabel = s.status === "ACTIVE" ? "Active" : s.status === "COMPLETED" ? "Done" : "Paused";
    return {
      label: `${s.name || `Snapshot ${s.number}`} (${statusLabel})`,
      value: s.id,
    };
  });

  return (
    <Page
      fullWidth
      backAction={{ content: "Dashboard", url: "/app" }}
      title={project.productTitle}
      titleMetadata={selectedSnapshot && getStatusBadge(selectedSnapshot.status)}
      subtitle={selectedSnapshot ? `${selectedSnapshot.realCount}/${selectedSnapshot.targetVisitors} real visitors` : ""}
      primaryAction={
        selectedSnapshot?.status === "ACTIVE"
          ? { content: "Pause", onAction: () => handleAction("pause-snapshot"), loading: isLoading }
          : selectedSnapshot?.status === "PAUSED" && !hasActiveSnapshot
          ? { content: "Resume", onAction: () => handleAction("resume-snapshot"), loading: isLoading }
          : undefined
      }
      actionGroups={selectedSnapshot ? [{
        title: "More actions",
        actions: [
          { content: "Edit", onAction: openEditModal },
          { content: "Export CSV", onAction: () => handleExport("csv") },
          { content: "Export PDF", onAction: () => handleExport("pdf") },
          { content: "Delete Snapshot", destructive: true, onAction: () => handleAction("delete-snapshot") },
        ],
      }] : []}
    >
      <Layout>
        {/* Snapshot Selector */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Snapshots</Text>
                <InlineStack gap="200">
                  {snapshots.length > 1 && (
                    <Button onClick={() => setIsCompareModalOpen(true)}>Compare</Button>
                  )}
                  <Button variant="primary" onClick={openNewSnapshotModal} disabled={hasActiveSnapshot}>
                    + New Snapshot
                  </Button>
                </InlineStack>
              </InlineStack>
              {hasActiveSnapshot && snapshots.length > 0 && snapshots[0].status !== "ACTIVE" && (
                <Banner tone="warning">
                  Another snapshot is currently active. Complete or pause it to create a new one.
                </Banner>
              )}
              <Select
                label="Select snapshot"
                labelHidden
                options={snapshotSelectOptions}
                value={selectedSnapshot?.id || ""}
                onChange={handleSnapshotSelect}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Top progress bar */}
        {isLoading && (
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, height: 3, zIndex: 200,
            background: "var(--p-color-bg-surface-secondary)",
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              background: "var(--p-color-bg-fill-brand)",
              animation: "mw-progress 1.5s ease-in-out infinite",
              transformOrigin: "left",
            }} />
            <style>{`
              @keyframes mw-progress {
                0% { transform: translateX(-100%) scaleX(0.3); }
                50% { transform: translateX(30%) scaleX(0.5); }
                100% { transform: translateX(100%) scaleX(0.3); }
              }
            `}</style>
          </div>
        )}

        {/* Source Filter Buttons */}
        <Layout.Section>
          <InlineStack gap="200" wrap>
            {[
              { label: "All Traffic", value: "all" },
              { label: "Paid", value: "paid" },
              { label: "Organic", value: "organic" },
              { label: "Direct", value: "direct" },
              { label: "Referral", value: "referral" },
              { label: "Email", value: "email" },
            ].map((filter) => (
              <Button
                key={filter.value}
                pressed={activeSource === filter.value}
                onClick={() => handleSourceFilter(filter.value)}
              >
                {filter.label}
              </Button>
            ))}
          </InlineStack>
        </Layout.Section>

        {/* Engaged Visitors / Bot Traffic + Trend Graph + Revenue Cards */}
        {selectedSnapshot && displayStats && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                {/* Engaged Visitors & Bot Traffic summary */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div style={{ padding: "16px 20px", border: "1px solid var(--p-color-border-subdued)", borderRadius: 8 }}>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" tone="subdued">Engaged Visitors</Text>
                      <Text as="span" variant="headingLg">{displayStats.realCount + displayStats.zombieCount}</Text>
                    </BlockStack>
                  </div>
                  <div style={{ padding: "16px 20px", border: "1px solid var(--p-color-border-subdued)", borderRadius: 8 }}>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" tone="subdued">Bot Traffic</Text>
                      <Text as="span" variant="headingLg">{displayStats.botCount}</Text>
                    </BlockStack>
                  </div>
                </div>

                {/* Multi-metric trend chart across snapshots */}
                {snapshotTrends && snapshotTrends.length > 0 && (() => {
                  const metrics = [
                    { key: "revenuePerVisitor" as const, label: "RPV", color: "#2C6ECB", format: (v: number) => `$${v.toFixed(2)}` },
                    { key: "aov" as const, label: "AOV", color: "#8B5CF6", format: (v: number) => `$${v.toFixed(2)}` },
                    { key: "atcRate" as const, label: "ATC %", color: "#059669", format: (v: number) => `${v}%` },
                    { key: "convRate" as const, label: "Conv %", color: "#D97706", format: (v: number) => `${v}%` },
                  ];
                  const chartHeight = 140;
                  return (
                    <BlockStack gap="200">
                      {/* Legend */}
                      <InlineStack gap="400">
                        {metrics.map((m) => (
                          <InlineStack key={m.key} gap="100" blockAlign="center">
                            <div style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: m.color }} />
                            <Text as="span" variant="bodySm" tone="subdued">{m.label}</Text>
                          </InlineStack>
                        ))}
                      </InlineStack>
                      {/* Chart area */}
                      <div style={{ position: "relative", height: chartHeight + 30, border: "1px solid var(--p-color-border-subdued)", borderRadius: 8, padding: "12px 16px" }}>
                        {snapshotTrends.length >= 2 ? (
                          <svg width="100%" height={chartHeight} viewBox={`0 0 ${snapshotTrends.length * 100} ${chartHeight}`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
                            {metrics.map((m) => {
                              const values = snapshotTrends.map((t) => t[m.key]);
                              const maxVal = Math.max(...values, 0.01);
                              const points = values.map((v, i) => {
                                const x = (i / (snapshotTrends.length - 1)) * (snapshotTrends.length * 100 - 20) + 10;
                                const y = chartHeight - (v / maxVal) * (chartHeight - 20) - 10;
                                return `${x},${y}`;
                              }).join(" ");
                              return (
                                <g key={m.key}>
                                  <polyline points={points} fill="none" stroke={m.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  {values.map((v, i) => {
                                    const x = (i / (snapshotTrends.length - 1)) * (snapshotTrends.length * 100 - 20) + 10;
                                    const y = chartHeight - (v / maxVal) * (chartHeight - 20) - 10;
                                    return <circle key={i} cx={x} cy={y} r="3" fill={m.color} />;
                                  })}
                                </g>
                              );
                            })}
                          </svg>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
                            <Text as="p" tone="subdued">More snapshots needed for trend chart</Text>
                          </div>
                        )}
                        {/* X-axis labels */}
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                          {snapshotTrends.map((t, i) => (
                            <Text key={i} as="span" variant="bodySm" tone="subdued">{t.name}</Text>
                          ))}
                        </div>
                      </div>
                    </BlockStack>
                  );
                })()}

                {/* Revenue & conversion stat cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
                  <StatCard title="Revenue per Visitor" value={`$${displayStats.revenuePerVisitor.toFixed(2)}`} />
                  <StatCard title="AOV" value={`$${displayStats.aov.toFixed(2)}`} />
                  <StatCard title="Add-to-Cart Rate" value={`${displayStats.atcRate}%`} />
                  <StatCard title="Conversion Rate" value={`${displayStats.convRate}%`} />
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {selectedSnapshot && displayStats && (
          <>
            {/* Stats Overview */}
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Overall Totals</Text>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16 }}>
                    <StatCard
                      title="Real Users"
                      value={displayStats.realCount}
                      subtitle={`${displayStats.realPercent}%`}
                      tone="success"
                    />
                    <StatCard
                      title="Bots"
                      value={displayStats.botCount}
                      subtitle={`${displayStats.botPercent}%`}
                      tone="critical"
                    />
                    <StatCard title="Avg Time" value={formatTime(displayStats.avgTimeOnPage)} />
                    <StatCard title="Avg Scroll" value={`${displayStats.avgScrollDepth}%`} />
                    <StatCard title={atcLabel} value={displayStats.addToCartCount} />
                    <StatCard title={convLabel} value={isCollection ? displayStats.productClickCount : displayStats.conversionCount} />
                  </div>
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Conversion Funnel */}
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Conversion Funnel</Text>
                  <ConversionFunnel stats={displayStats} isCollection={isCollection} />
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Top Countries / Cities / Devices — uniform height row */}
            <Layout.Section>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, alignItems: "stretch" }}>
              {/* Top Countries */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Top Countries</Text>
                  {topCountries.length === 0 ? (
                    <Text as="p" tone="subdued">No geo data available yet</Text>
                  ) : (
                    <BlockStack gap="200">
                      {topCountries.map((item: any) => (
                        <InlineStack key={item.country} align="space-between">
                          <Text as="span">{item.country}</Text>
                          <Badge>{String(item.count)}</Badge>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              {/* Top Cities */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Top Cities</Text>
                  {(displayStats?.topCities || []).length === 0 ? (
                    <Text as="p" tone="subdued">No city data available yet</Text>
                  ) : (
                    <BlockStack gap="200">
                      {(displayStats?.topCities || []).map((item: any) => (
                        <InlineStack key={item.city} align="space-between">
                          <Text as="span">{item.city}</Text>
                          <Badge>{String(item.count)}</Badge>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              {/* Devices — Donut Chart */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Devices</Text>
                  {(displayStats?.deviceBreakdown || []).length === 0 ? (
                    <Text as="p" tone="subdued">No device data available yet</Text>
                  ) : (() => {
                    const devices = displayStats?.deviceBreakdown || [];
                    const colors: Record<string, string> = { mobile: "#2C6ECB", desktop: "#8B5CF6", tablet: "#059669" };
                    const radius = 40;
                    const circumference = 2 * Math.PI * radius;
                    let offset = 0;
                    return (
                      <BlockStack gap="300" inlineAlign="center">
                        <svg width="120" height="120" viewBox="0 0 120 120">
                          {devices.map((item: any) => {
                            const dashLength = (item.percent / 100) * circumference;
                            const dashGap = circumference - dashLength;
                            const currentOffset = offset;
                            offset += dashLength;
                            return (
                              <circle
                                key={item.device}
                                cx="60" cy="60" r={radius}
                                fill="none"
                                stroke={colors[item.device?.toLowerCase()] || "#94A3B8"}
                                strokeWidth="16"
                                strokeDasharray={`${dashLength} ${dashGap}`}
                                strokeDashoffset={-currentOffset}
                                transform="rotate(-90 60 60)"
                              />
                            );
                          })}
                        </svg>
                        <BlockStack gap="200">
                          {devices.map((item: any) => (
                            <InlineStack key={item.device} align="space-between" blockAlign="center">
                              <InlineStack gap="200" blockAlign="center">
                                <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: colors[item.device?.toLowerCase()] || "#94A3B8" }} />
                                <Text as="span">{item.device}</Text>
                              </InlineStack>
                              <Badge>{`${item.percent}%`}</Badge>
                            </InlineStack>
                          ))}
                        </BlockStack>
                      </BlockStack>
                    );
                  })()}
                </BlockStack>
              </Card>
            </div>
            </Layout.Section>

            {/* Exit Paths */}
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Exit Paths</Text>
                  {(displayStats?.exitPaths || []).length === 0 ? (
                    <Text as="p" tone="subdued">No exit data available yet</Text>
                  ) : (
                    <BlockStack gap="200">
                      {(displayStats?.exitPaths || []).map((item: any) => (
                        <InlineStack key={item.type} align="space-between">
                          <Text as="span">{item.label}</Text>
                          <InlineStack gap="100">
                            <Text as="span" tone="subdued">{item.count}</Text>
                            <Badge tone={item.type === "checkout" ? "success" : undefined}>
                              {`${item.percent}%`}
                            </Badge>
                          </InlineStack>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Top Products Clicked (Collection audits only) */}
            {isCollection && (topProductsClicked || []).length > 0 && (
              <Layout.Section>
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">Top Products Clicked</Text>
                    <BlockStack gap="300">
                      {(topProductsClicked || []).map((product: any, index: number) => (
                        <InlineStack key={product.handle} align="space-between" blockAlign="center">
                          <InlineStack gap="300" blockAlign="center">
                            <Text as="span" variant="bodySm" tone="subdued">
                              {index + 1}.
                            </Text>
                            <Thumbnail
                              source={product.imageUrl || ImageIcon}
                              alt={product.imageAlt || product.title}
                              size="small"
                            />
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {product.title}
                            </Text>
                          </InlineStack>
                          <Badge>{String(product.count)}</Badge>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  </BlockStack>
                </Card>
              </Layout.Section>
            )}

            {/* CTA Clicks + Visit Journeys are rendered together below */}

            {/* Search & Filters */}
            {((displayStats?.searchStats?.topQueries || []).length > 0 ||
              (displayStats?.searchStats?.sortPreferences || []).length > 0 ||
              (displayStats?.searchStats?.filterUsageCount || 0) > 0) && (
            <Layout.Section>
              <div style={{ display: "flex", gap: 16 }}>
                {(displayStats?.searchStats?.filterUsageCount || 0) > 0 && (
                  <div style={{ flex: 1 }}>
                    <Card>
                      <BlockStack gap="300">
                        <Text as="h2" variant="headingMd">Filter Usage</Text>
                        <InlineStack align="space-between">
                          <Text as="span">Visits using filters</Text>
                          <Badge>{String(displayStats.searchStats.filterUsageCount)}</Badge>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  </div>
                )}
                {(displayStats?.searchStats?.topQueries || []).length > 0 && (
                  <div style={{ flex: 1 }}>
                    <Card>
                      <BlockStack gap="300">
                        <Text as="h2" variant="headingMd">Top Search Queries</Text>
                        <BlockStack gap="200">
                          {(displayStats?.searchStats?.topQueries || []).map((item: any) => (
                            <InlineStack key={item.query} align="space-between">
                              <Text as="span" variant="bodySm" truncate>"{item.query}"</Text>
                              <Badge>{String(item.count)}</Badge>
                            </InlineStack>
                          ))}
                        </BlockStack>
                      </BlockStack>
                    </Card>
                  </div>
                )}
                {(displayStats?.searchStats?.sortPreferences || []).length > 0 && (
                  <div style={{ flex: 1 }}>
                    <Card>
                      <BlockStack gap="300">
                        <Text as="h2" variant="headingMd">Sort Preferences</Text>
                        <BlockStack gap="200">
                          {(displayStats?.searchStats?.sortPreferences || []).map((item: any) => (
                            <InlineStack key={item.sort} align="space-between">
                              <Text as="span" variant="bodySm">{item.sort.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}</Text>
                              <Badge>{String(item.count)}</Badge>
                            </InlineStack>
                          ))}
                        </BlockStack>
                      </BlockStack>
                    </Card>
                  </div>
                )}
              </div>
            </Layout.Section>
            )}

            {/* Traffic by Source Table */}
            <Layout.Section>
              <Card padding="0">
                <Box padding="400">
                  <Text as="h2" variant="headingMd">Traffic Quality by Source</Text>
                </Box>
                <IndexTable
                  resourceName={{ singular: "source", plural: "sources" }}
                  itemCount={sourceStats.length}
                  headings={[
                    { title: "Source" },
                    { title: "Sessions" },
                    { title: "Real" },
                    { title: "Zombie" },
                    { title: "Bot" },
                    { title: "Avg Time" },
                    { title: "Avg Scroll" },
                    { title: isCollection ? "QA %" : "ATC %" },
                    { title: isCollection ? "Prod %" : "Conv %" },
                  ]}
                  selectable={false}
                >
                  {rowMarkup}
                </IndexTable>
              </Card>
            </Layout.Section>

            {/* Source filter indicator */}
            {sourceFilter && (
              <Layout.Section>
                <Banner tone="info" onDismiss={() => setSourceFilter(null)}>
                  <p>Showing visits from <strong>{sourceFilter}</strong></p>
                </Banner>
              </Layout.Section>
            )}

            {/* CTA Clicks + Visit Journeys side by side */}
            <Layout.Section>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16, alignItems: "start" }}>
                {/* CTA Clicks — left column */}
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">CTA Clicks</Text>
                    {(displayStats?.ctaStats || []).length === 0 ? (
                      <Text as="p" tone="subdued">No CTA data yet</Text>
                    ) : (
                      <BlockStack gap="200">
                        {(displayStats?.ctaStats || []).map((item: any) => (
                          <InlineStack key={item.label} align="space-between">
                            <Text as="span" variant="bodySm">{item.label}</Text>
                            <Badge>{String(item.count)}</Badge>
                          </InlineStack>
                        ))}
                      </BlockStack>
                    )}
                  </BlockStack>
                </Card>

                {/* Visit Journeys — right column */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingMd">Visit Journeys</Text>
                      <Text as="span" variant="bodySm" tone="subdued">{filteredRecentVisits.length} visits</Text>
                    </InlineStack>
                  <BlockStack gap="300">
                    {filteredRecentVisits.slice(0, 10).map((visit: any) => {
                      const isExpanded = expandedVisits.has(visit.id);
                      const isPaid = (visit.sourceCategory || "").includes("Paid");
                      const clickCount = (() => {
                        if (!visit.ctaClicks) return 0;
                        try {
                          const parsed = JSON.parse(visit.ctaClicks);
                          return Array.isArray(parsed) ? parsed.length : Object.values(parsed).reduce((a: number, b: any) => a + (b as number), 0);
                        } catch { return 0; }
                      })();
                      const ctaEntries: any[] = (() => {
                        if (!visit.ctaClicks) return [];
                        try {
                          const parsed = JSON.parse(visit.ctaClicks);
                          if (Array.isArray(parsed)) return parsed;
                          return Object.entries(parsed).map(([label, count]) => ({ label, tag: "button", href: null, time: 0, count }));
                        } catch { return []; }
                      })();

                      return (
                        <div
                          key={visit.id}
                          style={{
                            border: "1px solid var(--p-color-border-subdued)",
                            borderRadius: 8,
                            overflow: "hidden",
                          }}
                        >
                          {/* Card header — clickable */}
                          <div
                            onClick={() => setExpandedVisits(prev => {
                              const next = new Set(prev);
                              next.has(visit.id) ? next.delete(visit.id) : next.add(visit.id);
                              return next;
                            })}
                            style={{
                              padding: "12px 16px",
                              cursor: "pointer",
                              backgroundColor: isExpanded ? "var(--p-color-bg-surface-secondary)" : "transparent",
                            }}
                          >
                            <InlineStack align="space-between" blockAlign="center">
                              <InlineStack gap="200" blockAlign="center" wrap>
                                <Text as="span" variant="bodyMd" fontWeight="bold">
                                  {visit.source || visit.sourceCategory || "Direct"}
                                </Text>
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {visit.deviceType || "unknown"} · {clickCount} click{clickCount !== 1 ? "s" : ""}
                                  {visit.exitType ? ` · Exit: ${formatExitType(visit.exitType)}` : ""}
                                </Text>
                              </InlineStack>
                              <InlineStack gap="200" blockAlign="center">
                                {isPaid && <Badge tone="info">Paid</Badge>}
                                {visit.addedToCart && <Badge tone="success">ATC</Badge>}
                                {visit.converted && (
                                  <Badge tone="success">
                                    {visit.orderValue ? `Converted $${visit.orderValue.toFixed(2)}` : "Converted"}
                                  </Badge>
                                )}
                                <Text as="span" variant="bodySm" tone="subdued">{isExpanded ? "▲" : "▼"}</Text>
                              </InlineStack>
                            </InlineStack>
                          </div>

                          {/* Expanded click journey */}
                          {isExpanded && (
                            <div style={{ padding: "0 16px 16px", borderTop: "1px solid var(--p-color-border-subdued)" }}>
                              <BlockStack gap="200">
                                {/* PAGE entry */}
                                <div style={{ paddingTop: 12 }}>
                                  <InlineStack gap="200" blockAlign="start">
                                    <Badge tone="info">PAGE</Badge>
                                    <BlockStack gap="100">
                                      <Text as="span" variant="bodySm">/products/{visit.source ? `...` : ""}{visit.sourceCategory ? "" : ""}</Text>
                                      <InlineStack gap="100" wrap>
                                        {visit.source && (
                                          <span style={{ fontSize: 11, padding: "2px 6px", backgroundColor: "var(--p-color-bg-surface-secondary)", borderRadius: 4 }}>
                                            source: {visit.source}
                                          </span>
                                        )}
                                        {visit.medium && (
                                          <span style={{ fontSize: 11, padding: "2px 6px", backgroundColor: "var(--p-color-bg-surface-secondary)", borderRadius: 4 }}>
                                            medium: {visit.medium}
                                          </span>
                                        )}
                                        {visit.campaign && (
                                          <span style={{ fontSize: 11, padding: "2px 6px", backgroundColor: "var(--p-color-bg-surface-secondary)", borderRadius: 4 }}>
                                            campaign: {visit.campaign}
                                          </span>
                                        )}
                                      </InlineStack>
                                    </BlockStack>
                                  </InlineStack>
                                </div>

                                {/* CTA click entries */}
                                {ctaEntries.map((cta: any, i: number) => (
                                  <div key={i} style={{ paddingLeft: 8, borderLeft: "2px solid var(--p-color-border-subdued)" }}>
                                    <InlineStack gap="200" blockAlign="center">
                                      <Badge tone="attention">CLICK</Badge>
                                      <Text as="span" variant="bodySm">
                                        {"<"}{cta.tag}{">"} {cta.label}
                                        {cta.href ? ` → ${(() => { try { return new URL(cta.href).pathname; } catch { return cta.href; } })()}` : ""}
                                      </Text>
                                    </InlineStack>
                                  </div>
                                ))}

                                {/* EXIT entry */}
                                {visit.exitType && (
                                  <div style={{ paddingLeft: 8, borderLeft: "2px solid var(--p-color-border-subdued)" }}>
                                    <InlineStack gap="200" blockAlign="center">
                                      <Badge tone="critical">EXIT</Badge>
                                      <Text as="span" variant="bodySm">
                                        {formatExitType(visit.exitType)}
                                        {visit.exitUrl ? `: ${(() => { try { return new URL(visit.exitUrl).pathname; } catch { return visit.exitUrl; } })()}` : ""}
                                      </Text>
                                    </InlineStack>
                                  </div>
                                )}
                              </BlockStack>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </BlockStack>
                </BlockStack>
              </Card>
              </div>
            </Layout.Section>

            {/* Detailed Visits Table */}
            <Layout.Section>
              <Card padding="0">
                <Box padding="400">
                  <Text as="h2" variant="headingMd">
                    Recent Visits {sourceFilter ? `\u2014 ${sourceFilter}` : "(Last 50)"}
                  </Text>
                </Box>
                <div style={{ overflowX: "auto" }}>
                  <IndexTable
                    resourceName={{ singular: "visit", plural: "visits" }}
                    itemCount={filteredRecentVisits.length}
                    headings={[
                      { title: "Type" },
                      { title: "Source" },
                      { title: "UTM" },
                      { title: "" },
                      { title: "Duration" },
                      { title: "Scroll" },
                      { title: isCollection ? "QA" : "ATC" },
                      { title: "Exit" },
                    ]}
                    selectable={false}
                  >
                    {filteredRecentVisits.map((visit: any, index: number) => (
                      <IndexTable.Row id={visit.id} key={visit.id} position={index}>
                        <IndexTable.Cell>
                          <Badge
                            tone={visit.visitorType === "REAL" ? "success" : visit.visitorType === "ZOMBIE" ? "warning" : "critical"}
                          >
                            {visit.visitorType}
                          </Badge>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm" fontWeight="semibold">
                            {getSourceIcon(visit.sourceCategory || "Direct")} {visit.sourceCategory || "Direct"}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="050">
                            {visit.source && (
                              <Text as="span" variant="bodySm" tone="subdued">
                                {visit.source}{visit.medium ? ` / ${visit.medium}` : ""}
                              </Text>
                            )}
                            {visit.campaign && (
                              <Text as="span" variant="bodySm" tone="subdued">
                                {visit.campaign}
                              </Text>
                            )}
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm">{getDeviceIcon(visit.deviceType || "")}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm">{formatTime(Math.round(visit.timeOnPage / 1000))}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm">{visit.scrollDepth}%</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          {visit.addedToCart ? <Badge tone="success">Yes</Badge> : <Text as="span" tone="subdued">-</Text>}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="050">
                            <Text as="span" variant="bodySm">{formatExitType(visit.exitType || "unknown")}</Text>
                            {visit.exitUrl && (
                              <Text as="span" variant="bodySm" tone="subdued" truncate>
                                {(() => {
                                  try { return new URL(visit.exitUrl).pathname; } catch { return visit.exitUrl; }
                                })()}
                              </Text>
                            )}
                          </BlockStack>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                </div>
              </Card>
            </Layout.Section>
          </>
        )}

        {/* Delete Project */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Danger Zone</Text>
              <Text as="p" tone="subdued">Deleting this project will remove all snapshots and visit data.</Text>
              <Button tone="critical" onClick={() => handleAction("delete-project")}>Delete Project</Button>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* New Snapshot Modal */}
      <Modal
        open={isNewSnapshotModalOpen}
        onClose={() => setIsNewSnapshotModalOpen(false)}
        title="Create New Snapshot"
        primaryAction={{
          content: "Create",
          onAction: handleCreateSnapshot,
          loading: isLoading,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setIsNewSnapshotModalOpen(false) }]}
      >
        <Modal.Section>
          <Banner tone="info">This snapshot will start fresh from 0 visitors.</Banner>
          <br />
          <FormLayout>
            <TextField
              label="Snapshot Name"
              value={snapshotName}
              onChange={setSnapshotName}
              placeholder="e.g., After Redesign"
              helpText="Optional label for this measurement period"
              autoComplete="off"
            />
            <TextField
              label="Target Visitors"
              type="number"
              value={targetVisitors}
              onChange={setTargetVisitors}
              min={100}
              helpText="Number of real visitors to collect before completing"
              autoComplete="off"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>

      {/* Edit Snapshot Modal */}
      <Modal
        open={isEditSnapshotModalOpen}
        onClose={() => setIsEditSnapshotModalOpen(false)}
        title="Edit Snapshot"
        primaryAction={{
          content: "Save",
          onAction: handleEditSnapshot,
          loading: isLoading,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setIsEditSnapshotModalOpen(false) }]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Snapshot Name"
              value={snapshotName}
              onChange={setSnapshotName}
              placeholder="e.g., After Redesign"
              autoComplete="off"
            />
            <TextField
              label="Target Visitors"
              type="number"
              value={targetVisitors}
              onChange={setTargetVisitors}
              min={selectedSnapshot?.realCount || 100}
              helpText={`Cannot be lower than current real users (${selectedSnapshot?.realCount || 0})`}
              autoComplete="off"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>

      {/* Compare Snapshots Modal */}
      <Modal
        open={isCompareModalOpen}
        onClose={() => { setIsCompareModalOpen(false); setSelectedForCompare([]); }}
        title="Compare Snapshots"
        primaryAction={{
          content: `Compare (${selectedForCompare.length})`,
          onAction: enterCompareMode,
          disabled: selectedForCompare.length < 2,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => { setIsCompareModalOpen(false); setSelectedForCompare([]); } }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p" tone="subdued">Select 2 to 4 snapshots to compare. They will be ordered from oldest to newest.</Text>
            <BlockStack gap="300">
              {[...snapshots].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).map((snapshot) => {
                const isSelected = selectedForCompare.includes(snapshot.id);
                const isDisabled = !isSelected && selectedForCompare.length >= 4;
                const statusTone = snapshot.status === "ACTIVE" ? "success" : snapshot.status === "COMPLETED" ? "info" : "warning";
                const statusLabel = snapshot.status === "ACTIVE" ? "Active" : snapshot.status === "COMPLETED" ? "Completed" : "Paused";
                const dateStr = new Date(snapshot.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                return (
                  <div
                    key={snapshot.id}
                    onClick={() => !isDisabled && handleToggleCompare(snapshot.id)}
                    style={{
                      padding: "12px 16px",
                      borderRadius: 8,
                      border: isSelected ? "2px solid var(--p-color-border-interactive)" : "1px solid var(--p-color-border-subdued)",
                      backgroundColor: isSelected ? "var(--p-color-bg-surface-selected)" : isDisabled ? "var(--p-color-bg-surface-disabled)" : "var(--p-color-bg-surface)",
                      cursor: isDisabled ? "not-allowed" : "pointer",
                      opacity: isDisabled ? 0.5 : 1,
                    }}
                  >
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="300" blockAlign="center">
                        <Checkbox
                          label=""
                          labelHidden
                          checked={isSelected}
                          disabled={isDisabled}
                          onChange={() => handleToggleCompare(snapshot.id)}
                        />
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {snapshot.name || `Snapshot ${snapshot.number}`}
                            </Text>
                            <Badge tone={statusTone}>{statusLabel}</Badge>
                          </InlineStack>
                          <Text as="span" variant="bodySm" tone="subdued">
                            Created {dateStr}
                          </Text>
                        </BlockStack>
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {snapshot.realCount} real visitors
                      </Text>
                    </InlineStack>
                  </div>
                );
              })}
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  let message = "Unknown error";
  let details = "";

  if (isRouteErrorResponse(error)) {
    message = `${error.status}: ${typeof error.data === "string" ? error.data : JSON.stringify(error.data)}`;
    details = typeof error.data === "string" ? error.data : "";
  } else if (error instanceof Error) {
    message = error.message;
    details = error.stack || "";
  } else {
    message = String(error);
  }

  // Log full error for Vercel runtime logs
  console.error("[MW ErrorBoundary] Project page error:", error);

  return (
    <Page title="Something went wrong">
      <Layout>
        <Layout.Section>
          <Banner title="Error loading project page" tone="critical">
            <p>{message}</p>
          </Banner>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="p">This error has been logged. Try reloading or go back to the dashboard.</Text>
              {details && (
                <div style={{ background: "#f4f4f4", padding: 12, borderRadius: 6, fontFamily: "monospace", fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto" }}>
                  {details}
                </div>
              )}
              <Link to="/app">Back to Dashboard</Link>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
