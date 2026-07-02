import type {
  ResourceType,
  StoreSnapshot,
  StoreSnapshotCompletionMode,
  VisitorType,
} from "@prisma/client";
import prisma from "../db.server";
import { createNotification } from "./notifications.server";

const STORE_SNAPSHOT_STATS_TTL_MS = 30_000;
const COMPLETED_STORE_SNAPSHOT_STATS_TTL_MS = 5 * 60_000;
const MIN_RECOMMENDATION_HUMANS = 5;
const NON_INTERNAL_EXIT_TYPES = [
  "window_closed",
  "back_button",
  "idle",
  "external_link",
];

type TrackedClick = {
  label?: string;
  tag?: string;
  href?: string | null;
  zone?: string;
};

type StoreSnapshotVisitInput = {
  shop: string | null;
  sessionId: string;
  pageViewId: string;
  productHandle?: string | null;
  resourceType?: string | null;
  pagePath?: string | null;
  pageUrl?: string | null;
  pageTitle?: string | null;
  isLandingPage?: boolean | null;
  pageOrder?: number | null;
  visitorType: VisitorType;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  referrer?: string | null;
  sourceCategory?: string | null;
  timeOnPage: number;
  scrollDepth: number;
  mouseMovements: number;
  keyPresses: number;
  touchEvents: number;
  hasMouseMoved: boolean;
  hasScrolled: boolean;
  hasKeyPressed: boolean;
  hasTouched: boolean;
  isWebdriver: boolean;
  suspiciousUA: boolean;
  linearMovement: boolean;
  datacenterIP: boolean;
  botScore: number;
  addedToCart?: boolean | null;
  addedToCartAt?: Date | null;
  userAgent?: string | null;
  deviceType?: string | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
  exitType?: string | null;
  exitUrl?: string | null;
  searchQuery?: string | null;
  appliedFilters?: string | null;
  sortBy?: string | null;
  filterInteractions: number;
  ctaClicks?: string | null;
  ipAddress?: string | null;
  country?: string | null;
  countryCode?: string | null;
  city?: string | null;
  region?: string | null;
  timezone?: string | null;
};

type StoreSnapshotStats = {
  visitorBreakdown: {
    total: number;
    humans: number;
    zombies: number;
    bots: number;
    pending: number;
    uniqueHumanVisitors: number;
  };
  progress: {
    mode: StoreSnapshotCompletionMode;
    label: string;
    current: number;
    target: number | null;
    percent: number;
  };
  metrics: {
    avgScrollDepth: number;
    avgTimeOnPage: number;
    searchCount: number;
    clickThroughRate: number;
    addToCartRate: number;
    conversionRate: number;
    orderCount: number;
    revenue: number;
  };
  deltas: Record<string, number | null>;
  pageAggregates: StoreSnapshotPageSummary[];
  recommendations: StoreSnapshotRecommendationSummary[];
  generatedAt: string;
};

export type StoreSnapshotPageSummary = {
  id?: string;
  pageKey: string;
  pagePath: string;
  pageTitle: string;
  pageType: ResourceType | null;
  resourceHandle: string | null;
  totalVisits: number;
  humanVisits: number;
  zombieVisits: number;
  botVisits: number;
  uniqueHumanSessions: number;
  avgTimeOnPage: number;
  avgScrollDepth: number;
  clickThroughRate: number;
  addToCartRate: number;
  conversionRate: number;
  orderCount: number;
  revenue: number;
  searchCount: number;
  exitCount: number;
  weaknessScore: number;
  opportunityScore: number;
  confidence: number;
  metrics: Record<string, unknown>;
};

export type StoreSnapshotRecommendationSummary = {
  id?: string;
  pageKey: string;
  pagePath: string;
  pageTitle: string;
  pageType: ResourceType | null;
  resourceHandle: string | null;
  recommendedType: ResourceType | null;
  priority: number;
  confidence: number;
  weaknessScore: number;
  opportunityScore: number;
  title: string;
  reason: string;
  actionLabel: string;
};

type StoreVisitRow = {
  sessionId: string;
  pagePath: string;
  pageTitle: string | null;
  resourceType: ResourceType | null;
  resourceHandle: string | null;
  isLandingPage: boolean;
  visitorType: VisitorType;
  timeOnPage: number;
  scrollDepth: number;
  addedToCart: boolean;
  converted: boolean;
  orderValue: number | null;
  ctaClicks: string | null;
  exitType: string | null;
  searchQuery: string | null;
};

export function normalizeStorePagePath(
  value: string | null | undefined,
): string {
  if (!value) return "/";

  try {
    const url = new URL(value, "https://example.com");
    const path = url.pathname || "/";
    return path.length > 1 ? path.replace(/\/+$/, "") : "/";
  } catch {
    const path = value.split("?")[0].split("#")[0] || "/";
    return path.startsWith("/")
      ? path.replace(/\/+$/, "") || "/"
      : `/${path.replace(/\/+$/, "")}`;
  }
}

export function normalizeStorePageKey(path: string) {
  return normalizeStorePagePath(path).toLowerCase();
}

export function normalizeResourceType(
  value: string | null | undefined,
): ResourceType | null {
  const normalized = (value || "").toUpperCase();
  if (
    ["PRODUCT", "COLLECTION", "PAGE", "BLOG", "HOMEPAGE"].includes(normalized)
  ) {
    return normalized as ResourceType;
  }
  return null;
}

export function inferResourceTypeFromPath(path: string): ResourceType | null {
  const normalized = normalizeStorePagePath(path);
  if (normalized === "/") return "HOMEPAGE";
  if (normalized.startsWith("/products/")) return "PRODUCT";
  if (normalized.startsWith("/collections/")) return "COLLECTION";
  if (normalized.startsWith("/pages/")) return "PAGE";
  if (normalized.startsWith("/blogs/")) return "BLOG";
  return null;
}

export function inferResourceHandleFromPath(
  path: string,
  resourceType: ResourceType | null,
) {
  const normalized = normalizeStorePagePath(path);
  if (resourceType === "HOMEPAGE") return "__homepage__";

  const matchers: Partial<Record<ResourceType, RegExp>> = {
    PRODUCT: /^\/products\/([^/?#]+)/,
    COLLECTION: /^\/collections\/([^/?#]+)/,
    PAGE: /^\/pages\/([^/?#]+)/,
    BLOG: /^\/blogs\/(.+)$/,
  };
  const matcher = resourceType ? matchers[resourceType] : null;
  const match = matcher ? normalized.match(matcher) : null;
  return match ? decodeURIComponent(match[1]) : null;
}

export async function createStoreSnapshot({
  shop,
  name,
  completionMode,
  targetHumanVisitors,
  targetTotalVisits,
  durationDays,
}: {
  shop: string;
  name?: string | null;
  completionMode: StoreSnapshotCompletionMode;
  targetHumanVisitors?: number | null;
  targetTotalVisits?: number | null;
  durationDays?: number | null;
}) {
  const activeSnapshot = await prisma.storeSnapshot.findFirst({
    where: { shop, status: "ACTIVE" },
    orderBy: { startedAt: "desc" },
  });

  if (activeSnapshot) {
    return activeSnapshot;
  }

  const now = new Date();
  const safeDurationDays =
    completionMode === "TIME_WINDOW"
      ? Math.min(Math.max(Number(durationDays || 7), 1), 90)
      : null;
  const endsAt =
    safeDurationDays != null
      ? new Date(now.getTime() + safeDurationDays * 24 * 60 * 60 * 1000)
      : null;

  return prisma.storeSnapshot.create({
    data: {
      shop,
      name: name?.trim() || null,
      completionMode,
      targetHumanVisitors:
        completionMode === "HUMAN_VISITORS"
          ? Math.min(Math.max(Number(targetHumanVisitors || 1000), 25), 100000)
          : null,
      targetTotalVisits:
        completionMode === "TOTAL_VISITS"
          ? Math.min(Math.max(Number(targetTotalVisits || 2500), 25), 250000)
          : null,
      durationDays: safeDurationDays,
      endsAt,
    },
  });
}

export async function trackStoreSnapshotVisit(input: StoreSnapshotVisitInput) {
  if (!input.shop || !input.sessionId || !input.pageViewId) return;

  const activeSnapshots = await prisma.storeSnapshot.findMany({
    where: { shop: input.shop, status: "ACTIVE" },
    orderBy: { startedAt: "desc" },
  });

  if (activeSnapshots.length === 0) return;

  const visitStartedAt = input.startedAt || new Date();
  const pagePath = normalizeStorePagePath(input.pagePath || input.pageUrl);
  const resourceType =
    normalizeResourceType(input.resourceType) ||
    inferResourceTypeFromPath(pagePath);
  const resourceHandle = input.productHandle
    ? decodeURIComponent(input.productHandle)
    : inferResourceHandleFromPath(pagePath, resourceType);
  const isLandingPage = Boolean(input.isLandingPage || input.pageOrder === 1);

  for (const snapshot of activeSnapshots) {
    if (visitStartedAt.getTime() < snapshot.startedAt.getTime()) {
      continue;
    }

    const completed = await completeStoreSnapshotIfReady(snapshot);
    if (completed) continue;

    await prisma.storeSnapshotVisit.upsert({
      where: {
        pageViewId_storeSnapshotId: {
          pageViewId: input.pageViewId,
          storeSnapshotId: snapshot.id,
        },
      },
      create: {
        storeSnapshotId: snapshot.id,
        sessionId: input.sessionId,
        pageViewId: input.pageViewId,
        pagePath,
        pageUrl: input.pageUrl || pagePath,
        pageTitle: input.pageTitle || null,
        resourceType,
        resourceHandle,
        isLandingPage,
        pageOrder: input.pageOrder ?? null,
        visitorType: input.visitorType,
        source: input.source || null,
        medium: input.medium || null,
        campaign: input.campaign || null,
        referrer: input.referrer || null,
        sourceCategory: input.sourceCategory || null,
        timeOnPage: input.timeOnPage,
        scrollDepth: input.scrollDepth,
        mouseMovements: input.mouseMovements,
        keyPresses: input.keyPresses,
        touchEvents: input.touchEvents,
        hasMouseMoved: input.hasMouseMoved,
        hasScrolled: input.hasScrolled,
        hasKeyPressed: input.hasKeyPressed,
        hasTouched: input.hasTouched,
        isWebdriver: input.isWebdriver,
        suspiciousUA: input.suspiciousUA,
        linearMovement: input.linearMovement,
        datacenterIP: input.datacenterIP,
        botScore: input.botScore,
        addedToCart: Boolean(input.addedToCart),
        addedToCartAt: input.addedToCartAt || null,
        userAgent: input.userAgent || null,
        deviceType: input.deviceType || null,
        startedAt: visitStartedAt,
        endedAt: input.endedAt || null,
        exitType: input.exitType || null,
        exitUrl: input.exitUrl || null,
        searchQuery: input.searchQuery || null,
        appliedFilters: input.appliedFilters || null,
        sortBy: input.sortBy || null,
        filterInteractions: input.filterInteractions,
        ctaClicks: input.ctaClicks || null,
        ipAddress: input.ipAddress || null,
        country: input.country || null,
        countryCode: input.countryCode || null,
        city: input.city || null,
        region: input.region || null,
        timezone: input.timezone || null,
      },
      update: {
        pagePath,
        pageUrl: input.pageUrl || pagePath,
        pageTitle: input.pageTitle || undefined,
        resourceType,
        resourceHandle,
        ...(isLandingPage ? { isLandingPage: true } : {}),
        pageOrder: input.pageOrder ?? undefined,
        visitorType: input.visitorType,
        source: input.source || undefined,
        medium: input.medium || undefined,
        campaign: input.campaign || undefined,
        referrer: input.referrer || undefined,
        sourceCategory: input.sourceCategory || undefined,
        timeOnPage: input.timeOnPage,
        scrollDepth: input.scrollDepth,
        mouseMovements: input.mouseMovements,
        keyPresses: input.keyPresses,
        touchEvents: input.touchEvents,
        hasMouseMoved: input.hasMouseMoved,
        hasScrolled: input.hasScrolled,
        hasKeyPressed: input.hasKeyPressed,
        hasTouched: input.hasTouched,
        linearMovement: input.linearMovement,
        datacenterIP: input.datacenterIP,
        botScore: input.botScore,
        ...(input.addedToCart
          ? {
              addedToCart: true,
              addedToCartAt: input.addedToCartAt || undefined,
            }
          : {}),
        endedAt: input.endedAt || null,
        exitType: input.exitType || null,
        exitUrl: input.exitUrl || null,
        searchQuery: input.searchQuery || undefined,
        appliedFilters: input.appliedFilters || undefined,
        sortBy: input.sortBy || undefined,
        filterInteractions: input.filterInteractions,
        ctaClicks: input.ctaClicks || undefined,
        country: input.country || undefined,
        countryCode: input.countryCode || undefined,
        city: input.city || undefined,
        region: input.region || undefined,
        timezone: input.timezone || undefined,
      },
    });

    await clearStoreSnapshotStatsCache(snapshot.id);
    await completeStoreSnapshotIfReady({ ...snapshot, status: "ACTIVE" });
  }
}

export async function updateStoreSnapshotAddToCart({
  sessionId,
  productHandle,
  timestamp,
}: {
  sessionId: string;
  productHandle?: string | null;
  timestamp: number | string | Date;
}) {
  const decodedHandle = productHandle
    ? decodeURIComponent(productHandle)
    : null;
  const visit = await prisma.storeSnapshotVisit.findFirst({
    where: {
      sessionId,
      storeSnapshot: { status: "ACTIVE" },
      ...(decodedHandle
        ? { resourceType: "PRODUCT", resourceHandle: decodedHandle }
        : {}),
    },
    orderBy: { startedAt: "desc" },
  });

  if (!visit) return false;

  await prisma.storeSnapshotVisit.update({
    where: { id: visit.id },
    data: {
      addedToCart: true,
      addedToCartAt: new Date(timestamp),
    },
  });
  await clearStoreSnapshotStatsCache(visit.storeSnapshotId);
  return true;
}

export async function updateStoreSnapshotConversion({
  shop,
  sessionId,
  timestamp,
  totalPrice,
  currency,
}: {
  shop?: string | null;
  sessionId: string;
  timestamp: number | string | Date;
  totalPrice?: string | number | null;
  currency?: string | null;
}) {
  return attributeStoreSnapshotOrder({
    shop,
    sessionId,
    timestamp,
    totalPrice,
    currency,
  });
}

export async function attributeStoreSnapshotOrder({
  shop,
  sessionId,
  timestamp,
  totalPrice,
  currency,
}: {
  shop?: string | null;
  sessionId: string;
  timestamp: number | string | Date;
  totalPrice?: string | number | null;
  currency?: string | null;
}) {
  if (!sessionId) return 0;

  const orderDate = new Date(timestamp);
  const thirtyDaysBeforeOrder = new Date(orderDate);
  thirtyDaysBeforeOrder.setDate(thirtyDaysBeforeOrder.getDate() - 30);

  const visits = await prisma.storeSnapshotVisit.findMany({
    where: {
      sessionId,
      converted: false,
      startedAt: { lte: orderDate },
      storeSnapshot: {
        ...(shop ? { shop } : {}),
        status: { in: ["ACTIVE", "COMPLETED"] },
        startedAt: { gte: thirtyDaysBeforeOrder, lte: orderDate },
      },
    },
    orderBy: [
      { storeSnapshotId: "asc" },
      { isLandingPage: "desc" },
      { pageOrder: "asc" },
      { startedAt: "asc" },
    ],
  });

  const updatedSnapshotIds = new Set<string>();
  let updated = 0;

  for (const visit of visits) {
    if (updatedSnapshotIds.has(visit.storeSnapshotId)) continue;

    await prisma.storeSnapshotVisit.update({
      where: { id: visit.id },
      data: {
        converted: true,
        convertedAt: orderDate,
        ...(totalPrice != null && totalPrice !== ""
          ? {
              orderValue:
                typeof totalPrice === "number"
                  ? totalPrice
                  : parseFloat(totalPrice),
            }
          : {}),
        ...(currency ? { currency } : {}),
      },
    });
    updatedSnapshotIds.add(visit.storeSnapshotId);
    await clearStoreSnapshotStatsCache(visit.storeSnapshotId);
    updated++;
  }

  return updated;
}

export async function completeStoreSnapshotIfReady(snapshot: StoreSnapshot) {
  if (snapshot.status !== "ACTIVE") return false;

  let shouldComplete = false;
  if (snapshot.completionMode === "TIME_WINDOW") {
    shouldComplete = Boolean(
      snapshot.endsAt && snapshot.endsAt.getTime() <= Date.now(),
    );
  } else if (
    snapshot.completionMode === "TOTAL_VISITS" &&
    snapshot.targetTotalVisits
  ) {
    const count = await prisma.storeSnapshotVisit.count({
      where: { storeSnapshotId: snapshot.id },
    });
    shouldComplete = count >= snapshot.targetTotalVisits;
  } else if (
    snapshot.completionMode === "HUMAN_VISITORS" &&
    snapshot.targetHumanVisitors
  ) {
    const count = await countUniqueHumanSessions(snapshot.id);
    shouldComplete = count >= snapshot.targetHumanVisitors;
  }

  if (!shouldComplete) return false;

  await prisma.storeSnapshot.update({
    where: { id: snapshot.id },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  await clearStoreSnapshotStatsCache(snapshot.id);

  await createNotification({
    shop: snapshot.shop,
    type: "STORE_SNAPSHOT_COMPLETED",
    title: "Store snapshot completed",
    message: `"${snapshot.name || "Store snapshot"}" is ready with page recommendations`,
    linkUrl: `/app/store-snapshots/${snapshot.id}`,
    referenceId: snapshot.id,
  });

  return true;
}

export async function getStoreSnapshotStats(
  storeSnapshotId: string,
  { force = false } = {},
) {
  const snapshot = await prisma.storeSnapshot.findUnique({
    where: { id: storeSnapshotId },
    include: { statsCache: true },
  });
  if (!snapshot) return null;

  const ttl =
    snapshot.status === "COMPLETED"
      ? COMPLETED_STORE_SNAPSHOT_STATS_TTL_MS
      : STORE_SNAPSHOT_STATS_TTL_MS;
  if (
    !force &&
    snapshot.statsCache &&
    snapshot.statsCache.recomputedAt.getTime() > Date.now() - ttl
  ) {
    return snapshot.statsCache.stats as StoreSnapshotStats;
  }

  const stats = await computeStoreSnapshotStats(snapshot);
  await prisma.storeSnapshotStatsCache.upsert({
    where: { storeSnapshotId },
    create: { storeSnapshotId, stats: stats as any },
    update: { stats: stats as any, recomputedAt: new Date() },
  });
  await persistStoreSnapshotAggregates(
    storeSnapshotId,
    stats.pageAggregates,
    stats.recommendations,
  );
  return stats;
}

async function computeStoreSnapshotStats(
  snapshot: StoreSnapshot,
): Promise<StoreSnapshotStats> {
  const rows = await prisma.storeSnapshotVisit.findMany({
    where: { storeSnapshotId: snapshot.id },
    select: {
      sessionId: true,
      pagePath: true,
      pageTitle: true,
      resourceType: true,
      resourceHandle: true,
      isLandingPage: true,
      visitorType: true,
      timeOnPage: true,
      scrollDepth: true,
      addedToCart: true,
      converted: true,
      orderValue: true,
      ctaClicks: true,
      exitType: true,
      searchQuery: true,
    },
  });

  const humans = rows.filter((row) => row.visitorType === "REAL");
  const zombies = rows.filter((row) => row.visitorType === "ZOMBIE");
  const bots = rows.filter((row) => row.visitorType === "BOT");
  const pending = rows.filter((row) => row.visitorType === "PENDING");
  const uniqueHumanVisitors = new Set(humans.map((row) => row.sessionId)).size;
  const clicks = humans.map((row) => parseTrackedClicks(row.ctaClicks));
  const visitsWithAnyClick = clicks.filter((rowClicks) =>
    rowClicks.some(isLinkOrButtonClick),
  ).length;
  const searchCount = humans.filter((row) => row.searchQuery).length;
  const orderCount = humans.filter((row) => row.converted).length;
  const revenue = humans.reduce(
    (sum, row) => sum + Number(row.orderValue || 0),
    0,
  );

  const metrics = {
    avgScrollDepth: average(humans.map((row) => row.scrollDepth)),
    avgTimeOnPage: Math.round(
      average(humans.map((row) => row.timeOnPage)) / 1000,
    ),
    searchCount,
    clickThroughRate: percent(visitsWithAnyClick, humans.length),
    addToCartRate: percent(
      humans.filter((row) => row.addedToCart).length,
      humans.length,
    ),
    conversionRate: percent(orderCount, humans.length),
    orderCount,
    revenue,
  };
  const pageAggregates = buildPageAggregates(rows);
  const recommendations = buildRecommendations(pageAggregates);
  const previousStats = await getPreviousStoreSnapshotCachedStats(snapshot);

  return {
    visitorBreakdown: {
      total: rows.length,
      humans: humans.length,
      zombies: zombies.length,
      bots: bots.length,
      pending: pending.length,
      uniqueHumanVisitors,
    },
    progress: getProgress(snapshot, rows.length, uniqueHumanVisitors),
    metrics,
    deltas: {
      avgScrollDepth: previousStats
        ? metrics.avgScrollDepth - previousStats.metrics.avgScrollDepth
        : null,
      avgTimeOnPage: previousStats
        ? metrics.avgTimeOnPage - previousStats.metrics.avgTimeOnPage
        : null,
      searchCount: previousStats
        ? metrics.searchCount - previousStats.metrics.searchCount
        : null,
      clickThroughRate: previousStats
        ? metrics.clickThroughRate - previousStats.metrics.clickThroughRate
        : null,
      addToCartRate: previousStats
        ? metrics.addToCartRate - previousStats.metrics.addToCartRate
        : null,
      conversionRate: previousStats
        ? metrics.conversionRate - previousStats.metrics.conversionRate
        : null,
      orderCount: previousStats
        ? metrics.orderCount - previousStats.metrics.orderCount
        : null,
      revenue: previousStats
        ? metrics.revenue - previousStats.metrics.revenue
        : null,
    },
    pageAggregates,
    recommendations,
    generatedAt: new Date().toISOString(),
  };
}

function buildPageAggregates(
  rows: StoreVisitRow[],
): StoreSnapshotPageSummary[] {
  const pageMap = new Map<string, StoreVisitRow[]>();
  for (const row of rows) {
    const key = normalizeStorePageKey(row.pagePath);
    const list = pageMap.get(key) || [];
    list.push(row);
    pageMap.set(key, list);
  }

  return Array.from(pageMap.entries())
    .map(([pageKey, pageRows]) => {
      const sample = pageRows[0];
      const humans = pageRows.filter((row) => row.visitorType === "REAL");
      const zombies = pageRows.filter((row) => row.visitorType === "ZOMBIE");
      const bots = pageRows.filter((row) => row.visitorType === "BOT");
      const uniqueHumanSessions = new Set(humans.map((row) => row.sessionId))
        .size;
      const clickRows = humans.map((row) => parseTrackedClicks(row.ctaClicks));
      const visitsWithAnyClick = clickRows.filter((clicks) =>
        clicks.some(isLinkOrButtonClick),
      ).length;
      const exits = humans.filter(
        (row) => row.exitType && NON_INTERNAL_EXIT_TYPES.includes(row.exitType),
      ).length;
      const orderCount = humans.filter((row) => row.converted).length;
      const revenue = humans.reduce(
        (sum, row) => sum + Number(row.orderValue || 0),
        0,
      );
      const pageType =
        sample.resourceType || inferResourceTypeFromPath(sample.pagePath);
      const aggregate = {
        pageKey,
        pagePath: sample.pagePath,
        pageTitle: sample.pageTitle || titleFromPath(sample.pagePath),
        pageType,
        resourceHandle:
          sample.resourceHandle ||
          inferResourceHandleFromPath(sample.pagePath, pageType),
        totalVisits: pageRows.length,
        humanVisits: humans.length,
        zombieVisits: zombies.length,
        botVisits: bots.length,
        uniqueHumanSessions,
        avgTimeOnPage: Math.round(
          average(humans.map((row) => row.timeOnPage)) / 1000,
        ),
        avgScrollDepth: average(humans.map((row) => row.scrollDepth)),
        clickThroughRate: percent(visitsWithAnyClick, humans.length),
        addToCartRate: percent(
          humans.filter((row) => row.addedToCart).length,
          humans.length,
        ),
        conversionRate: percent(orderCount, humans.length),
        orderCount,
        revenue,
        searchCount: humans.filter((row) => row.searchQuery).length,
        exitCount: exits,
        weaknessScore: 0,
        opportunityScore: 0,
        confidence: confidenceFromSample(uniqueHumanSessions),
        metrics: {},
      };
      const scored = scorePageAggregate(aggregate);
      return {
        ...scored,
        metrics: {
          exitRate: percent(exits, humans.length),
          zombieRate: percent(zombies.length, pageRows.length),
          botRate: percent(bots.length, pageRows.length),
        },
      };
    })
    .sort((a, b) => {
      const scoreDiff =
        b.opportunityScore +
        b.weaknessScore -
        (a.opportunityScore + a.weaknessScore);
      if (scoreDiff !== 0) return scoreDiff;
      return b.humanVisits - a.humanVisits;
    });
}

function buildRecommendations(pageAggregates: StoreSnapshotPageSummary[]) {
  return pageAggregates
    .filter((page) => page.humanVisits >= MIN_RECOMMENDATION_HUMANS)
    .map((page) => recommendationForPage(page))
    .filter(Boolean)
    .sort((a, b) => b!.priority - a!.priority)
    .slice(0, 8) as StoreSnapshotRecommendationSummary[];
}

function recommendationForPage(
  page: StoreSnapshotPageSummary,
): StoreSnapshotRecommendationSummary | null {
  const exitRate = Number((page.metrics as any).exitRate || 0);
  const title = page.pageTitle || page.pagePath;
  const actionLabel = `Run ${labelForResourceType(page.pageType).toLowerCase()} snapshot`;

  if (page.pageType === "PRODUCT") {
    if (page.addToCartRate < 8 || page.conversionRate < 2) {
      return {
        ...recommendationBase(page, actionLabel),
        title: `Audit product page: ${title}`,
        reason: `${page.humanVisits} human visits with ${formatPercent(page.addToCartRate)} ATC and ${formatPercent(page.conversionRate)} CVR. This product has enough traffic to diagnose product-page friction.`,
      };
    }
  }

  if (page.pageType === "COLLECTION") {
    if (
      page.clickThroughRate < 18 ||
      page.searchCount > page.humanVisits * 0.15
    ) {
      return {
        ...recommendationBase(page, actionLabel),
        title: `Audit collection path: ${title}`,
        reason: `${page.humanVisits} human visits with ${formatPercent(page.clickThroughRate)} click-through. Collection traffic may need sorting, filtering, or product-card improvements.`,
      };
    }
  }

  if (
    page.pageType === "HOMEPAGE" ||
    page.pageType === "PAGE" ||
    page.pageType === "BLOG"
  ) {
    if (
      page.clickThroughRate < 15 ||
      page.avgScrollDepth < 45 ||
      exitRate > 45
    ) {
      return {
        ...recommendationBase(page, actionLabel),
        title: `Audit content path: ${title}`,
        reason: `${page.humanVisits} human visits with ${formatPercent(page.clickThroughRate)} CTR, ${formatPercent(page.avgScrollDepth)} scroll depth, and ${formatPercent(exitRate)} exit rate. This page may need clearer next actions.`,
      };
    }
  }

  if (page.weaknessScore >= 55 && page.opportunityScore >= 35) {
    return {
      ...recommendationBase(page, actionLabel),
      title: `Investigate ${title}`,
      reason: `${page.humanVisits} human visits show weak engagement compared with its traffic level. A focused snapshot can identify the page-specific issue.`,
    };
  }

  return null;
}

function recommendationBase(
  page: StoreSnapshotPageSummary,
  actionLabel: string,
) {
  return {
    pageKey: page.pageKey,
    pagePath: page.pagePath,
    pageTitle: page.pageTitle,
    pageType: page.pageType,
    resourceHandle: page.resourceHandle,
    recommendedType: page.pageType,
    priority: Math.min(
      100,
      Math.round((page.opportunityScore + page.weaknessScore) / 2),
    ),
    confidence: page.confidence,
    weaknessScore: page.weaknessScore,
    opportunityScore: page.opportunityScore,
    actionLabel,
  };
}

function scorePageAggregate<T extends StoreSnapshotPageSummary>(page: T): T {
  const exitRate = Number((page.metrics as any)?.exitRate || 0);
  const zombieRate = percent(page.zombieVisits, page.totalVisits);
  const botRate = percent(page.botVisits, page.totalVisits);
  let weaknessScore = 0;

  weaknessScore += scoreBelow(page.avgScrollDepth, 60, 24);
  weaknessScore += scoreBelow(page.clickThroughRate, 25, 24);
  weaknessScore += scoreAbove(exitRate, 35, 16);
  weaknessScore += scoreAbove(zombieRate, 20, 16);
  weaknessScore += scoreAbove(botRate, 10, 12);

  if (page.pageType === "PRODUCT") {
    weaknessScore += scoreBelow(page.addToCartRate, 10, 18);
    weaknessScore += scoreBelow(page.conversionRate, 2.5, 14);
  } else if (page.pageType === "COLLECTION") {
    weaknessScore += scoreBelow(page.clickThroughRate, 20, 20);
    weaknessScore += scoreAbove(
      percent(page.searchCount, page.humanVisits),
      20,
      10,
    );
  } else {
    weaknessScore += scoreBelow(page.clickThroughRate, 18, 18);
  }

  const trafficScore = Math.min(60, page.uniqueHumanSessions * 3);
  const revenueScore = Math.min(25, page.revenue / 40);
  const intentScore = Math.min(
    15,
    page.searchCount * 2 +
      page.orderCount * 5 +
      (page.addToCartRate > 0 ? 5 : 0),
  );

  return {
    ...page,
    weaknessScore: Math.min(100, Math.round(weaknessScore)),
    opportunityScore: Math.min(
      100,
      Math.round(trafficScore + revenueScore + intentScore),
    ),
    confidence: confidenceFromSample(page.uniqueHumanSessions),
  };
}

async function persistStoreSnapshotAggregates(
  storeSnapshotId: string,
  pageAggregates: StoreSnapshotPageSummary[],
  recommendations: StoreSnapshotRecommendationSummary[],
) {
  await prisma.storeSnapshotRecommendation.deleteMany({
    where: { storeSnapshotId, status: "OPEN" },
  });
  await prisma.storeSnapshotPageAggregate.deleteMany({
    where: { storeSnapshotId },
  });

  const aggregateIdByKey = new Map<string, string>();
  for (const page of pageAggregates.slice(0, 100)) {
    const aggregate = await prisma.storeSnapshotPageAggregate.create({
      data: {
        storeSnapshotId,
        pageKey: page.pageKey,
        pagePath: page.pagePath,
        pageTitle: page.pageTitle,
        pageType: page.pageType,
        resourceHandle: page.resourceHandle,
        totalVisits: page.totalVisits,
        humanVisits: page.humanVisits,
        zombieVisits: page.zombieVisits,
        botVisits: page.botVisits,
        uniqueHumanSessions: page.uniqueHumanSessions,
        avgTimeOnPage: page.avgTimeOnPage,
        avgScrollDepth: page.avgScrollDepth,
        clickThroughRate: page.clickThroughRate,
        addToCartRate: page.addToCartRate,
        conversionRate: page.conversionRate,
        orderCount: page.orderCount,
        revenue: page.revenue,
        searchCount: page.searchCount,
        exitCount: page.exitCount,
        weaknessScore: page.weaknessScore,
        opportunityScore: page.opportunityScore,
        confidence: page.confidence,
        metrics: page.metrics as any,
      },
    });
    aggregateIdByKey.set(page.pageKey, aggregate.id);
    page.id = aggregate.id;
  }

  for (const recommendation of recommendations) {
    const aggregateId = aggregateIdByKey.get(recommendation.pageKey);
    const created = await prisma.storeSnapshotRecommendation.create({
      data: {
        storeSnapshotId,
        pageAggregateId: aggregateId,
        pageKey: recommendation.pageKey,
        pagePath: recommendation.pagePath,
        pageTitle: recommendation.pageTitle,
        pageType: recommendation.pageType,
        resourceHandle: recommendation.resourceHandle,
        recommendedType: recommendation.recommendedType,
        priority: recommendation.priority,
        confidence: recommendation.confidence,
        weaknessScore: recommendation.weaknessScore,
        opportunityScore: recommendation.opportunityScore,
        title: recommendation.title,
        reason: recommendation.reason,
        actionLabel: recommendation.actionLabel,
      },
    });
    recommendation.id = created.id;
  }
}

async function getPreviousStoreSnapshotCachedStats(snapshot: StoreSnapshot) {
  const previous = await prisma.storeSnapshot.findFirst({
    where: {
      shop: snapshot.shop,
      status: "COMPLETED",
      id: { not: snapshot.id },
      completedAt: snapshot.completedAt
        ? { lt: snapshot.completedAt }
        : { not: null },
      statsCache: { isNot: null },
    },
    orderBy: { completedAt: "desc" },
    include: { statsCache: true },
  });

  return previous?.statsCache?.stats as StoreSnapshotStats | undefined;
}

async function countUniqueHumanSessions(storeSnapshotId: string) {
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(DISTINCT "sessionId")::int AS count
    FROM "StoreSnapshotVisit"
    WHERE "storeSnapshotId" = ${storeSnapshotId}
      AND "visitorType" = 'REAL'::"VisitorType"
  `;
  return Number(rows[0]?.count || 0);
}

function getProgress(
  snapshot: StoreSnapshot,
  totalVisits: number,
  uniqueHumanVisitors: number,
) {
  if (snapshot.completionMode === "TOTAL_VISITS") {
    const target = snapshot.targetTotalVisits || null;
    return {
      mode: snapshot.completionMode,
      label: target
        ? `${target.toLocaleString()} visit snapshot`
        : "Total visit snapshot",
      current: totalVisits,
      target,
      percent: target ? percent(totalVisits, target) : 0,
    };
  }

  if (snapshot.completionMode === "TIME_WINDOW") {
    const totalMs = snapshot.endsAt
      ? snapshot.endsAt.getTime() - snapshot.startedAt.getTime()
      : 0;
    const elapsedMs = Date.now() - snapshot.startedAt.getTime();
    return {
      mode: snapshot.completionMode,
      label: `${snapshot.durationDays || 7}-day store snapshot`,
      current: Math.max(0, Math.min(totalMs, elapsedMs)),
      target: totalMs || null,
      percent: totalMs > 0 ? percent(elapsedMs, totalMs) : 0,
    };
  }

  const target = snapshot.targetHumanVisitors || null;
  return {
    mode: snapshot.completionMode,
    label: target
      ? `${target.toLocaleString()} unique human visitor snapshot`
      : "Unique human visitor snapshot",
    current: uniqueHumanVisitors,
    target,
    percent: target ? percent(uniqueHumanVisitors, target) : 0,
  };
}

async function clearStoreSnapshotStatsCache(storeSnapshotId: string) {
  await prisma.storeSnapshotStatsCache
    .deleteMany({ where: { storeSnapshotId } })
    .catch(() => {});
}

function parseTrackedClicks(raw: string | null): TrackedClick[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;

    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed).flatMap(([label, count]) => {
        const clickCount = typeof count === "number" ? count : 0;
        return Array.from({ length: clickCount }, () => ({
          label,
          tag: "button",
          zone: "main",
        }));
      });
    }
  } catch {}

  return [];
}

function isLinkOrButtonClick(click: TrackedClick): boolean {
  const tag = (click.tag || "").toLowerCase();
  return tag === "a" || tag === "button" || tag === "input";
}

function percent(numerator: number, denominator: number): number {
  return denominator > 0
    ? Math.round((numerator / denominator) * 1000) / 10
    : 0;
}

function average(values: number[]) {
  const realValues = values.filter((value) => Number.isFinite(value));
  if (realValues.length === 0) return 0;
  return (
    Math.round(
      (realValues.reduce((sum, value) => sum + value, 0) / realValues.length) *
        10,
    ) / 10
  );
}

function scoreBelow(value: number, target: number, maxScore: number) {
  if (value >= target) return 0;
  return ((target - value) / target) * maxScore;
}

function scoreAbove(value: number, target: number, maxScore: number) {
  if (value <= target) return 0;
  return Math.min(
    maxScore,
    ((value - target) / Math.max(target, 1)) * maxScore,
  );
}

function confidenceFromSample(uniqueHumanSessions: number) {
  return Math.min(100, Math.round((uniqueHumanSessions / 30) * 100));
}

function titleFromPath(path: string) {
  const normalized = normalizeStorePagePath(path);
  if (normalized === "/") return "Homepage";
  const segment = normalized.split("/").filter(Boolean).pop() || normalized;
  return decodeURIComponent(segment)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function labelForResourceType(resourceType: ResourceType | null) {
  if (resourceType === "PRODUCT") return "Product";
  if (resourceType === "COLLECTION") return "Collection";
  if (resourceType === "HOMEPAGE") return "Homepage";
  if (resourceType === "BLOG") return "Blog";
  if (resourceType === "PAGE") return "Page";
  return "Page";
}

function formatPercent(value: number) {
  return `${Number(value || 0)
    .toFixed(1)
    .replace(/\.0$/, "")}%`;
}
