import { Prisma } from "@prisma/client";
import prisma from "../db.server";

export type DashboardResourceType =
  | "PRODUCT"
  | "COLLECTION"
  | "PAGE"
  | "BLOG"
  | "HOMEPAGE";

export type DashboardActiveAudit = {
  id: string;
  productTitle: string;
  resourceType: DashboardResourceType;
  targetVisitors: number;
  realCount: number;
  progress: number;
};

export type DashboardActivityCard = {
  id: string;
  title: string;
  href: string;
  scopeLabel: string;
  runningCount: number;
  runningLabel: string;
  kpis: Array<{
    label: string;
    value: string;
  }>;
  chart: {
    metricLabel: string;
    contextLabel: string;
    axisLabel: string;
    currentLabel: string;
    previousLabel: string;
    current: number[];
    previous: number[];
  };
  previews: Array<{
    id: string;
    title: string;
    href: string;
    progress: number;
    value: string;
    valueTone: "positive" | "negative" | "neutral";
  }>;
  emptyLabel: string;
};

type LatestSnapshotRow = {
  id: string;
  productTitle: string;
  resourceType: DashboardResourceType;
  snapshotId: string;
  snapshotNumber: number;
  snapshotName: string | null;
  snapshotStatus: string;
  targetVisitors: number;
  realCount: number;
  stats: unknown;
};

type SnapshotVisitRow = {
  snapshotId: string;
  visitorType: string;
  converted: boolean;
  exitUrl: string | null;
  scrollDepth: number;
  ctaClicks: string | null;
  startedAt: Date;
};

type FreshSnapshotAggregateRow = {
  snapshotId: string;
  totalSessions: number;
  realCount: number;
  addToCartCount: number;
  conversionCount: number;
  totalRevenue: number;
  productClickCount: number;
  searchCount: number;
  exitCount: number;
  scroll50Count: number;
  scroll100Count: number;
};

type AbAssignmentRow = {
  testId: string;
  variantId: string;
  sessionId: string;
  converted: boolean;
  addedToCart: boolean;
  orderValue: number | null;
  ctaClicks: string | null;
  scrollDepth: number;
  occurredAt: Date;
};

type AbVisitCountRow = {
  testId: string;
  variantId: string;
  realCount: number;
};

type TrendMetric =
  | "conversion"
  | "productCtr"
  | "bodyCtaCtr"
  | "anyClickCtr";

const RESOURCE_CARD_CONFIG: Array<{
  resourceType: DashboardResourceType;
  title: string;
  href: string;
  chartMetric: TrendMetric;
  chartLabel: string;
}> = [
  {
    resourceType: "PRODUCT",
    title: "Product",
    href: "/app/audits/products",
    chartMetric: "conversion",
    chartLabel: "Conversion rate",
  },
  {
    resourceType: "COLLECTION",
    title: "Collection",
    href: "/app/audits/collections",
    chartMetric: "productCtr",
    chartLabel: "Product CTR",
  },
  {
    resourceType: "PAGE",
    title: "Pages",
    href: "/app/audits/pages",
    chartMetric: "bodyCtaCtr",
    chartLabel: "CTA CTR",
  },
  {
    resourceType: "BLOG",
    title: "Blogs",
    href: "/app/audits/blogs",
    chartMetric: "anyClickCtr",
    chartLabel: "Link and button CTR",
  },
  {
    resourceType: "HOMEPAGE",
    title: "Homepage",
    href: "/app/audits/homepage",
    chartMetric: "bodyCtaCtr",
    chartLabel: "CTA CTR",
  },
];

function numberValue(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function percent(numerator: number, denominator: number): number {
  return denominator > 0
    ? Math.round((numerator / denominator) * 1000) / 10
    : 0;
}

function sumStat(rows: LatestSnapshotRow[], key: string): number {
  return rows.reduce(
    (sum, row) => sum + numberValue(statsRecord(row.stats)[key]),
    0,
  );
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000 ? 1 : 0,
  }).format(value);
}

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000 ? 1 : 0,
  }).format(value);
}

function percentLabel(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

function snapshotLabel(snapshot: {
  name: string | null;
  number: number;
}): string {
  return snapshot.name?.trim() || `Snapshot ${snapshot.number}`;
}

function parseClicks(raw: string | null): Array<{
  tag?: string;
  zone?: string;
  href?: string | null;
}> {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      return Object.values(parsed).flatMap((count) =>
        Array.from(
          { length: typeof count === "number" ? count : 0 },
          () => ({ tag: "button", zone: "main" }),
        ),
      );
    }
  } catch {}

  return [];
}

function hasBodyCtaClick(raw: string | null): boolean {
  return parseClicks(raw).some((click) => {
    const tag = (click.tag || "").toLowerCase();
    return (
      (click.zone || "main").toLowerCase() === "main" &&
      (tag === "button" || tag === "input")
    );
  });
}

function hasInteractiveClick(raw: string | null): boolean {
  return parseClicks(raw).some((click) => {
    const tag = (click.tag || "").toLowerCase();
    return tag === "a" || tag === "button" || tag === "input" || tag === "img";
  });
}

function hasLinkOrButtonClick(raw: string | null): boolean {
  return parseClicks(raw).some((click) => {
    const tag = (click.tag || "").toLowerCase();
    return tag === "a" || tag === "button" || tag === "input";
  });
}

function linkClickCount(raw: string | null): number {
  return parseClicks(raw).filter(
    (click) => (click.tag || "").toLowerCase() === "a" && Boolean(click.href),
  ).length;
}

async function hydrateFreshStats(
  rows: LatestSnapshotRow[],
): Promise<LatestSnapshotRow[]> {
  const snapshotIds = rows.map((row) => row.snapshotId);
  if (!snapshotIds.length) return rows;

  const [aggregateRows, clickRows] = await Promise.all([
    prisma.$queryRaw<FreshSnapshotAggregateRow[]>(Prisma.sql`
      SELECT
        v."snapshotId",
        COUNT(*)::int AS "totalSessions",
        COUNT(*) FILTER (WHERE v."visitorType" = 'REAL')::int AS "realCount",
        COUNT(*) FILTER (
          WHERE v."addedToCart" = true
        )::int AS "addToCartCount",
        COUNT(*) FILTER (
          WHERE v.converted = true
        )::int AS "conversionCount",
        COALESCE(SUM(v."orderValue") FILTER (
          WHERE v.converted = true
        ), 0)::float8 AS "totalRevenue",
        COUNT(*) FILTER (
          WHERE v."exitUrl" LIKE '%/products/%'
        )::int AS "productClickCount",
        COUNT(*) FILTER (
          WHERE v."searchQuery" IS NOT NULL
        )::int AS "searchCount",
        COUNT(*) FILTER (
          WHERE v."exitType" IN ('window_closed', 'back_button', 'idle', 'external_link')
        )::int AS "exitCount",
        COUNT(*) FILTER (WHERE v."scrollDepth" >= 50)::int AS "scroll50Count",
        COUNT(*) FILTER (WHERE v."scrollDepth" >= 100)::int AS "scroll100Count"
      FROM "Visit" v
      WHERE v."snapshotId" IN (${Prisma.join(snapshotIds)})
      GROUP BY v."snapshotId"
    `),
    prisma.visit.findMany({
      where: {
        snapshotId: { in: snapshotIds },
        OR: [
          { ctaClicks: { not: null } },
          {
            scrollDepth: { lt: 50 },
            exitType: {
              in: ["window_closed", "back_button", "idle", "external_link"],
            },
          },
        ],
      },
      select: {
        snapshotId: true,
        ctaClicks: true,
        scrollDepth: true,
        exitType: true,
      },
    }),
  ]);

  const aggregateBySnapshot = new Map(
    aggregateRows.map((row) => [row.snapshotId, row]),
  );
  const clicksBySnapshot = new Map<string, typeof clickRows>();
  for (const clickRow of clickRows) {
    const snapshotClicks = clicksBySnapshot.get(clickRow.snapshotId) || [];
    snapshotClicks.push(clickRow);
    clicksBySnapshot.set(clickRow.snapshotId, snapshotClicks);
  }

  return rows.map((row) => {
    const aggregate = aggregateBySnapshot.get(row.snapshotId);
    const relevantClicks = clicksBySnapshot.get(row.snapshotId) || [];
    const totalSessions = numberValue(aggregate?.totalSessions);
    const realCount = numberValue(aggregate?.realCount);
    const bodyCtaVisits = relevantClicks.filter((clickRow) =>
      hasBodyCtaClick(clickRow.ctaClicks),
    ).length;
    const anyClickVisits = relevantClicks.filter((clickRow) =>
      hasLinkOrButtonClick(clickRow.ctaClicks),
    ).length;
    const links = relevantClicks.reduce(
      (sum, clickRow) => sum + linkClickCount(clickRow.ctaClicks),
      0,
    );
    const bounces = relevantClicks.filter(
      (clickRow) =>
        clickRow.scrollDepth < 50 &&
        ["window_closed", "back_button", "idle", "external_link"].includes(
          clickRow.exitType || "",
        ) &&
        !hasLinkOrButtonClick(clickRow.ctaClicks),
    ).length;
    const addToCartCount = numberValue(aggregate?.addToCartCount);
    const conversionCount = numberValue(aggregate?.conversionCount);
    const productClickCount = numberValue(aggregate?.productClickCount);
    const exitCount = numberValue(aggregate?.exitCount);
    const scroll50Count = numberValue(aggregate?.scroll50Count);
    const scroll100Count = numberValue(aggregate?.scroll100Count);

    return {
      ...row,
      realCount,
      stats: {
        ...statsRecord(row.stats),
        totalSessions,
        realCount,
        addToCartCount,
        conversionCount,
        totalRevenue: numberValue(aggregate?.totalRevenue),
        productClickCount,
        productCtrRate: percent(productClickCount, totalSessions),
        searchCount: numberValue(aggregate?.searchCount),
        exitCount,
        exitRate: percent(exitCount, totalSessions),
        scroll50Count,
        scroll50Rate: percent(scroll50Count, totalSessions),
        scroll100Count,
        scroll100Rate: percent(scroll100Count, totalSessions),
        linkClickCount: links,
        bodyCtaVisitCount: bodyCtaVisits,
        bodyCtaCtrRate: percent(bodyCtaVisits, totalSessions),
        anyClickVisitCount: anyClickVisits,
        anyClickCtrRate: percent(anyClickVisits, totalSessions),
        bounceCount: bounces,
        bounceRate: percent(bounces, totalSessions),
        atcRate: percent(addToCartCount, realCount),
        convRate: Math.min(percent(conversionCount, realCount), 100),
      },
    };
  });
}

function progressTrend(
  rows: SnapshotVisitRow[],
  metric: TrendMetric,
  pointCount = 7,
): number[] {
  const ordered = [...rows].sort(
    (left, right) => left.startedAt.getTime() - right.startedAt.getTime(),
  );
  if (!ordered.length) return [];

  const points: number[] = [];
  for (let point = 1; point <= pointCount; point += 1) {
    const cutoff = Math.max(1, Math.ceil((ordered.length * point) / pointCount));
    const sample = ordered.slice(0, cutoff);

    if (metric === "conversion") {
      const realVisitors = sample.filter((row) => row.visitorType === "REAL");
      points.push(
        Math.min(
          percent(
            sample.filter((row) => row.converted).length,
            realVisitors.length,
          ),
          100,
        ),
      );
      continue;
    }

    if (metric === "productCtr") {
      points.push(
        percent(
          sample.filter((row) => row.exitUrl?.includes("/products/")).length,
          sample.length,
        ),
      );
      continue;
    }

    if (metric === "bodyCtaCtr") {
      points.push(
        percent(
          sample.filter((row) => hasBodyCtaClick(row.ctaClicks)).length,
          sample.length,
        ),
      );
      continue;
    }

    points.push(
      percent(
        sample.filter((row) => hasLinkOrButtonClick(row.ctaClicks)).length,
        sample.length,
      ),
    );
  }

  return points;
}

function resourceKpis(
  resourceType: DashboardResourceType,
  rows: LatestSnapshotRow[],
) {
  const totalSessions = sumStat(rows, "totalSessions");
  const realVisitors = sumStat(rows, "realCount");

  if (resourceType === "PRODUCT") {
    return [
      {
        label: "CVR",
        value: percentLabel(
          Math.min(
            percent(sumStat(rows, "conversionCount"), realVisitors),
            100,
          ),
        ),
      },
      {
        label: "Add to cart",
        value: percentLabel(
          percent(sumStat(rows, "addToCartCount"), realVisitors),
        ),
      },
      { label: "Revenue", value: currency(sumStat(rows, "totalRevenue")) },
    ];
  }

  if (resourceType === "COLLECTION") {
    return [
      {
        label: "Link clicks",
        value: compactNumber(sumStat(rows, "linkClickCount")),
      },
      { label: "Searches", value: compactNumber(sumStat(rows, "searchCount")) },
      {
        label: "Exit rate",
        value: percentLabel(
          percent(sumStat(rows, "exitCount"), totalSessions),
        ),
      },
    ];
  }

  if (resourceType === "BLOG") {
    return [
      {
        label: "Bounce",
        value: percentLabel(
          percent(sumStat(rows, "bounceCount"), totalSessions),
        ),
      },
      {
        label: "50% scroll",
        value: percentLabel(
          percent(sumStat(rows, "scroll50Count"), totalSessions),
        ),
      },
      {
        label: "100% scroll",
        value: percentLabel(
          percent(sumStat(rows, "scroll100Count"), totalSessions),
        ),
      },
    ];
  }

  return [
    {
      label: "Link clicks",
      value: compactNumber(sumStat(rows, "linkClickCount")),
    },
    {
      label: "Searches",
      value: compactNumber(sumStat(rows, "searchCount")),
    },
    {
      label: "Exit rate",
      value: percentLabel(
        percent(sumStat(rows, "exitCount"), totalSessions),
      ),
    },
  ];
}

function primaryAuditValue(
  resourceType: DashboardResourceType,
  row: LatestSnapshotRow,
): string {
  const stats = statsRecord(row.stats);
  if (resourceType === "PRODUCT") {
    return `${percentLabel(numberValue(stats.convRate))} CVR`;
  }
  if (resourceType === "COLLECTION") {
    return `${percentLabel(numberValue(stats.productCtrRate))} CTR`;
  }
  if (resourceType === "BLOG") {
    return `${percentLabel(numberValue(stats.scroll50Rate))} scroll`;
  }
  return `${percentLabel(numberValue(stats.bodyCtaCtrRate))} CTR`;
}

function abGoalLabel(goal: string): string {
  if (goal === "REVENUE") return "Revenue per visitor";
  if (goal === "ADD_TO_CART") return "Add-to-cart rate";
  if (goal === "CLICK_THROUGH") return "Clickthrough rate";
  if (goal === "ENGAGEMENT") return "Scroll depth";
  return "Conversion rate";
}

function abMetric(rows: AbAssignmentRow[], goal: string): number {
  if (!rows.length) return 0;
  const visitors = new Set(rows.map((row) => row.sessionId)).size;
  if (goal === "REVENUE") {
    return visitors
      ? rows.reduce((sum, row) => sum + numberValue(row.orderValue), 0) /
          visitors
      : 0;
  }
  if (goal === "ADD_TO_CART") {
    return percent(rows.filter((row) => row.addedToCart).length, visitors);
  }
  if (goal === "CLICK_THROUGH") {
    const clickingVisitors = new Set(
      rows
        .filter((row) => hasInteractiveClick(row.ctaClicks))
        .map((row) => row.sessionId),
    ).size;
    return percent(clickingVisitors, visitors);
  }
  if (goal === "ENGAGEMENT") {
    return rows.reduce((sum, row) => sum + row.scrollDepth, 0) / rows.length;
  }
  return percent(rows.filter((row) => row.converted).length, visitors);
}

function abRowsForGoal(
  assignments: AbAssignmentRow[],
  visits: AbAssignmentRow[],
  goal: string,
): AbAssignmentRow[] {
  if (goal === "CLICK_THROUGH" || goal === "ENGAGEMENT") {
    return visits.length ? visits : assignments;
  }
  return assignments.length ? assignments : visits;
}

function abDeltaLabel(value: number, goal: string): string {
  const sign = value > 0 ? "+" : "";
  if (goal === "REVENUE") {
    return `${sign}${currency(value)}`;
  }
  return `${sign}${value.toFixed(1)} pts`;
}

function abProgressTrend(
  rows: AbAssignmentRow[],
  goal: string,
  pointCount = 7,
): number[] {
  const ordered = [...rows].sort(
    (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
  );
  if (!ordered.length) return [];

  return Array.from({ length: pointCount }, (_, index) => {
    const cutoff = Math.max(
      1,
      Math.ceil((ordered.length * (index + 1)) / pointCount),
    );
    return abMetric(ordered.slice(0, cutoff), goal);
  });
}

async function buildAbTestCard(shop: string): Promise<DashboardActivityCard> {
  const liveTests = await prisma.abTest.findMany({
    where: { shop, status: "LIVE" },
    orderBy: [{ launchedAt: "desc" }, { createdAt: "desc" }],
    include: {
      variants: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, key: true },
      },
    },
  });

  const liveIds = liveTests.map((test) => test.id);
  const previewTests = liveTests.slice(0, 3);
  const previewIds = previewTests.map((test) => test.id);
  const [visitorGroups, visitGroups, rawAssignments, rawVisits] =
    await Promise.all([
    liveIds.length
      ? prisma.abTestAssignment.groupBy({
          by: ["testId", "variantId"],
          where: {
            shop,
            visitorType: "REAL",
            testId: { in: liveIds },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    liveIds.length
      ? prisma.$queryRaw<AbVisitCountRow[]>(Prisma.sql`
          SELECT
            v."testId",
            v."variantId",
            COUNT(DISTINCT v."sessionId")::int AS "realCount"
          FROM "AbTestVisit" v
          WHERE v.shop = ${shop}
            AND v."visitorType" = 'REAL'
            AND v."testId" IN (${Prisma.join(liveIds)})
          GROUP BY v."testId", v."variantId"
        `)
      : Promise.resolve([]),
    previewIds.length
      ? prisma.abTestAssignment.findMany({
          where: {
            shop,
            visitorType: "REAL",
            testId: { in: previewIds },
          },
          orderBy: { assignedAt: "asc" },
          select: {
            testId: true,
            variantId: true,
            sessionId: true,
            converted: true,
            addedToCart: true,
            orderValue: true,
            ctaClicks: true,
            scrollDepth: true,
            assignedAt: true,
          },
        })
      : Promise.resolve([]),
    previewIds.length
      ? prisma.abTestVisit.findMany({
          where: {
            shop,
            visitorType: "REAL",
            testId: { in: previewIds },
          },
          orderBy: { startedAt: "asc" },
          select: {
            testId: true,
            variantId: true,
            sessionId: true,
            converted: true,
            addedToCart: true,
            orderValue: true,
            ctaClicks: true,
            scrollDepth: true,
            startedAt: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const assignments: AbAssignmentRow[] = rawAssignments.map((row) => ({
    testId: row.testId,
    variantId: row.variantId,
    sessionId: row.sessionId,
    converted: row.converted,
    addedToCart: row.addedToCart,
    orderValue: row.orderValue,
    ctaClicks: row.ctaClicks,
    scrollDepth: row.scrollDepth,
    occurredAt: row.assignedAt,
  }));
  const visits: AbAssignmentRow[] = rawVisits.map((row) => ({
    testId: row.testId,
    variantId: row.variantId,
    sessionId: row.sessionId,
    converted: row.converted,
    addedToCart: row.addedToCart,
    orderValue: row.orderValue,
    ctaClicks: row.ctaClicks,
    scrollDepth: row.scrollDepth,
    occurredAt: row.startedAt,
  }));

  const visitorCount = (testId: string, variantId: string): number => {
    const assignmentCount =
      visitorGroups.find(
        (group) => group.testId === testId && group.variantId === variantId,
      )?._count._all || 0;
    if (assignmentCount > 0) return assignmentCount;
    return numberValue(
      visitGroups.find(
        (group) => group.testId === testId && group.variantId === variantId,
      )?.realCount,
    );
  };

  const totalVisitors = liveTests.reduce(
    (sum, test) =>
      sum +
      test.variants.reduce(
        (testSum, variant) => testSum + visitorCount(test.id, variant.id),
        0,
      ),
    0,
  );
  const readyTests = liveTests.filter((test) => {
    const counts = test.variants.map((variant) =>
      visitorCount(test.id, variant.id),
    );
    return (
      counts.reduce((sum, count) => sum + count, 0) >= 100 &&
      counts.length >= 2 &&
      counts.every((count) => count >= 20)
    );
  }).length;

  const previews = previewTests.map((test) => {
    const control = test.variants.find((variant) => variant.key === "A");
    const variant = test.variants.find((item) => item.key === "B");
    const testAssignments = assignments.filter((row) => row.testId === test.id);
    const testVisits = visits.filter((row) => row.testId === test.id);
    const controlRows = abRowsForGoal(
      testAssignments.filter((row) => row.variantId === control?.id),
      testVisits.filter((row) => row.variantId === control?.id),
      test.goal,
    );
    const variantRows = abRowsForGoal(
      testAssignments.filter((row) => row.variantId === variant?.id),
      testVisits.filter((row) => row.variantId === variant?.id),
      test.goal,
    );
    const controlValue = abMetric(
      controlRows,
      test.goal,
    );
    const variantValue = abMetric(
      variantRows,
      test.goal,
    );
    const delta = variantValue - controlValue;
    const testVisitors = test.variants.reduce(
      (sum, item) => sum + visitorCount(test.id, item.id),
      0,
    );

    return {
      id: test.id,
      title: test.name,
      href: "/app/ab-tests",
      progress: Math.min(100, testVisitors),
      value: abDeltaLabel(delta, test.goal),
      valueTone:
        delta > 0
          ? ("positive" as const)
          : delta < 0
            ? ("negative" as const)
            : ("neutral" as const),
    };
  });
  const featured = previewTests[0];
  const featuredAssignments = featured
    ? assignments.filter((row) => row.testId === featured.id)
    : [];
  const featuredVisits = featured
    ? visits.filter((row) => row.testId === featured.id)
    : [];
  const control = featured?.variants.find((variant) => variant.key === "A");
  const variant = featured?.variants.find((item) => item.key === "B");
  const featuredControlRows = featured
    ? abRowsForGoal(
        featuredAssignments.filter((row) => row.variantId === control?.id),
        featuredVisits.filter((row) => row.variantId === control?.id),
        featured.goal,
      )
    : [];
  const featuredVariantRows = featured
    ? abRowsForGoal(
        featuredAssignments.filter((row) => row.variantId === variant?.id),
        featuredVisits.filter((row) => row.variantId === variant?.id),
        featured.goal,
      )
    : [];

  return {
    id: "ab-tests",
    title: "A/B Tests",
    href: "/app/ab-tests",
    scopeLabel: "Across all live tests",
    runningCount: liveTests.length,
    runningLabel: liveTests.length === 1 ? "live test" : "live tests",
    kpis: [
      { label: "Real visitors", value: compactNumber(totalVisitors) },
      { label: "Tests ready", value: compactNumber(readyTests) },
      {
        label: "Variants",
        value: compactNumber(
          liveTests.reduce((sum, test) => sum + test.variants.length, 0),
        ),
      },
    ],
    chart: {
      metricLabel: featured ? abGoalLabel(featured.goal) : "Primary goal",
      contextLabel: featured?.name || "Start a live test to compare variants",
      axisLabel: "Variant progress",
      currentLabel: "Variant B",
      previousLabel: "Control A",
      current: featured
        ? abProgressTrend(
            featuredVariantRows,
            featured.goal,
          )
        : [],
      previous: featured
        ? abProgressTrend(
            featuredControlRows,
            featured.goal,
          )
        : [],
    },
    previews,
    emptyLabel: "No live A/B tests",
  };
}

export async function getDashboardAbTestActivity(
  shop: string,
): Promise<DashboardActivityCard> {
  return buildAbTestCard(shop);
}

async function buildResourceCards(
  latestRows: LatestSnapshotRow[],
): Promise<DashboardActivityCard[]> {
  const representatives = RESOURCE_CARD_CONFIG.map((config) => {
    const rows = latestRows.filter(
      (row) => row.resourceType === config.resourceType,
    );
    return rows.find((row) => row.snapshotStatus === "ACTIVE") || rows[0];
  }).filter((row): row is LatestSnapshotRow => Boolean(row));

  const projectIds = representatives.map((row) => row.id);
  const comparisonSnapshots = projectIds.length
    ? await prisma.snapshot.findMany({
        where: { projectId: { in: projectIds } },
        orderBy: { number: "desc" },
        select: {
          id: true,
          projectId: true,
          number: true,
          name: true,
        },
      })
    : [];
  const snapshotsByProject = new Map<
    string,
    Array<(typeof comparisonSnapshots)[number]>
  >();

  for (const snapshot of comparisonSnapshots) {
    const snapshots = snapshotsByProject.get(snapshot.projectId) || [];
    if (snapshots.length < 2) snapshots.push(snapshot);
    snapshotsByProject.set(snapshot.projectId, snapshots);
  }

  const comparisonIds = Array.from(snapshotsByProject.values())
    .flat()
    .map((snapshot) => snapshot.id);
  const trendRows = comparisonIds.length
    ? await prisma.visit.findMany({
        where: { snapshotId: { in: comparisonIds } },
        orderBy: { startedAt: "asc" },
        select: {
          snapshotId: true,
          visitorType: true,
          converted: true,
          exitUrl: true,
          scrollDepth: true,
          ctaClicks: true,
          startedAt: true,
        },
      })
    : [];

  return RESOURCE_CARD_CONFIG.map((config) => {
    const rows = latestRows.filter(
      (row) => row.resourceType === config.resourceType,
    );
    const activeRows = rows.filter((row) => row.snapshotStatus === "ACTIVE");
    const representative =
      activeRows[0] ||
      representatives.find((row) => row.resourceType === config.resourceType);
    const snapshots = representative
      ? snapshotsByProject.get(representative.id) || []
      : [];
    const currentSnapshot = snapshots[0];
    const previousSnapshot = snapshots[1];

    return {
      id: config.resourceType.toLowerCase(),
      title: config.title,
      href: config.href,
      scopeLabel: "Across latest snapshots",
      runningCount: activeRows.length,
      runningLabel: activeRows.length === 1 ? "active audit" : "active audits",
      kpis: resourceKpis(config.resourceType, rows),
      chart: {
        metricLabel: config.chartLabel,
        contextLabel: representative
          ? `${representative.productTitle} · ${
              currentSnapshot ? snapshotLabel(currentSnapshot) : "Latest snapshot"
            }${
              previousSnapshot
                ? ` vs ${snapshotLabel(previousSnapshot)}`
                : ""
            }`
          : "No snapshot data yet",
        axisLabel: "Snapshot progress",
        currentLabel: "Latest",
        previousLabel: "Previous",
        current: currentSnapshot
          ? progressTrend(
              trendRows.filter(
                (row) => row.snapshotId === currentSnapshot.id,
              ),
              config.chartMetric,
            )
          : [],
        previous: previousSnapshot
          ? progressTrend(
              trendRows.filter(
                (row) => row.snapshotId === previousSnapshot.id,
              ),
              config.chartMetric,
            )
          : [],
      },
      previews: activeRows.slice(0, 3).map((row) => ({
        id: row.id,
        title: row.productTitle,
        href: `/app/project/${row.id}`,
        progress: Math.min(
          100,
          Math.round((row.realCount / Math.max(row.targetVisitors, 1)) * 100),
        ),
        value: primaryAuditValue(config.resourceType, row),
        valueTone: "neutral" as const,
      })),
      emptyLabel: "No active audits",
    };
  });
}

export async function getDashboardActivity(shop: string): Promise<{
  activeAudits: DashboardActiveAudit[];
  cards: DashboardActivityCard[];
}> {
  const latestRows = await prisma.$queryRaw<LatestSnapshotRow[]>`
    SELECT
      p.id,
      p."productTitle",
      p."resourceType"::text AS "resourceType",
      latest_snapshot.id AS "snapshotId",
      latest_snapshot.number AS "snapshotNumber",
      latest_snapshot.name AS "snapshotName",
      latest_snapshot.status::text AS "snapshotStatus",
      latest_snapshot."targetVisitors",
      COALESCE((stats_cache.stats->>'realCount')::int, 0)::int AS "realCount",
      stats_cache.stats
    FROM "Project" p
    JOIN LATERAL (
      SELECT s.*
      FROM "Snapshot" s
      WHERE s."projectId" = p.id
      ORDER BY s.number DESC
      LIMIT 1
    ) latest_snapshot ON TRUE
    LEFT JOIN "SnapshotStatsCache" stats_cache
      ON stats_cache."snapshotId" = latest_snapshot.id
    WHERE p.shop = ${shop}
    ORDER BY
      CASE WHEN latest_snapshot.status = 'ACTIVE' THEN 0 ELSE 1 END,
      latest_snapshot."createdAt" DESC
  `;

  const [freshRows, abTestCard] = await Promise.all([
    hydrateFreshStats(latestRows),
    buildAbTestCard(shop),
  ]);
  const activeAudits = freshRows
    .filter((row) => row.snapshotStatus === "ACTIVE")
    .map((row) => ({
      id: row.id,
      productTitle: row.productTitle,
      resourceType: row.resourceType,
      realCount: numberValue(row.realCount),
      targetVisitors: row.targetVisitors,
      progress: Math.min(
        100,
        Math.round(
          (numberValue(row.realCount) / Math.max(row.targetVisitors, 1)) * 100,
        ),
      ),
    }));

  const resourceCards = await buildResourceCards(freshRows);

  return {
    activeAudits,
    cards: [abTestCard, ...resourceCards],
  };
}

export async function getDashboardResourceActivity(
  shop: string,
  resourceType: DashboardResourceType,
): Promise<DashboardActivityCard> {
  const latestRows = await prisma.$queryRaw<LatestSnapshotRow[]>(Prisma.sql`
    SELECT
      p.id,
      p."productTitle",
      p."resourceType"::text AS "resourceType",
      latest_snapshot.id AS "snapshotId",
      latest_snapshot.number AS "snapshotNumber",
      latest_snapshot.name AS "snapshotName",
      latest_snapshot.status::text AS "snapshotStatus",
      latest_snapshot."targetVisitors",
      COALESCE((stats_cache.stats->>'realCount')::int, 0)::int AS "realCount",
      stats_cache.stats
    FROM "Project" p
    JOIN LATERAL (
      SELECT s.*
      FROM "Snapshot" s
      WHERE s."projectId" = p.id
      ORDER BY s.number DESC
      LIMIT 1
    ) latest_snapshot ON TRUE
    LEFT JOIN "SnapshotStatsCache" stats_cache
      ON stats_cache."snapshotId" = latest_snapshot.id
    WHERE p.shop = ${shop}
      AND p."resourceType" = ${resourceType}::"ResourceType"
    ORDER BY
      CASE WHEN latest_snapshot.status = 'ACTIVE' THEN 0 ELSE 1 END,
      latest_snapshot."createdAt" DESC
  `);

  const freshRows = await hydrateFreshStats(latestRows);
  const cards = await buildResourceCards(freshRows);
  const card = cards.find(
    (candidate) => candidate.id === resourceType.toLowerCase(),
  );

  if (!card) {
    throw new Error(`Missing dashboard activity configuration for ${resourceType}`);
  }

  return card;
}
