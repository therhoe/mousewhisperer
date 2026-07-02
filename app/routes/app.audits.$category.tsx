import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import type { Prisma, ResourceType } from "@prisma/client";
import { json } from "@remix-run/node";
import {
  useFetcher,
  useLoaderData,
  Link,
  PrefetchPageLinks,
  useSubmit,
  useNavigation,
} from "@remix-run/react";
import { useState, useCallback, useEffect, useRef } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Modal,
  TextField,
  FormLayout,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureWebPixel } from "../utils/web-pixel.server";
import {
  cachedValue,
  clearCacheKey,
  loaderCacheKeys,
} from "../utils/loader-cache.server";

const CATEGORY_CONFIG: Record<
  string,
  { label: string; resourceType: ResourceType; singular: string }
> = {
  products: { label: "Products", resourceType: "PRODUCT", singular: "product" },
  collections: {
    label: "Collections",
    resourceType: "COLLECTION",
    singular: "collection",
  },
  homepage: {
    label: "Homepage",
    resourceType: "HOMEPAGE",
    singular: "homepage",
  },
  pages: { label: "Pages", resourceType: "PAGE", singular: "page" },
  blogs: { label: "Blogs", resourceType: "BLOG", singular: "blog" },
};

const HOMEPAGE_RESOURCE = {
  id: "gid://shopify/Homepage/__homepage__",
  title: "Homepage",
  handle: "__homepage__",
};

const NON_INTERNAL_EXIT_TYPES = [
  "window_closed",
  "back_button",
  "idle",
  "external_link",
];
const CATEGORY_CACHE_TTL_MS = 5 * 60_000;
const DETAIL_PREFETCH_LIMIT = 16;

type TrackedClick = {
  label?: string;
  tag?: string;
  href?: string | null;
  zone?: string;
};

type AuditMetric = {
  sessions: number;
  real: number;
  atc: number;
  conv: number;
  revenue: number;
  productClicks: number;
  linkClicks: number;
  searches: number;
  exits: number;
  scroll50: number;
  scroll100: number;
  bodyCtaVisits: number;
  anyClickVisits: number;
  bounces: number;
};

type CategoryMetricDef = {
  key: string;
  label: string;
  baselineLabel: string;
  format: (value: number) => string;
  higherIsBetter?: boolean;
  hideInRows?: boolean;
};

type CategoryAuditRow = {
  id: string;
  productTitle: string;
  snapshotId: string | null;
  snapshotName: string | null;
  snapshotNumber: number | null;
  snapshotStatus: string | null;
  targetVisitors: number | null;
  snapshotCount: number;
  sessions: number;
  real: number;
  atc: number;
  conv: number;
  revenue: number;
  productClicks: number;
  searches: number;
  exits: number;
  scroll50: number;
  scroll100: number;
};

type FastCategoryAuditRow = {
  id: string;
  productTitle: string;
  snapshotId: string | null;
  snapshotName: string | null;
  snapshotNumber: number | null;
  snapshotStatus: string | null;
  targetVisitors: number | null;
  snapshotCount: number;
  realCount: number;
  stats: Prisma.JsonValue | null;
};

type InteractionRow = {
  snapshotId: string;
  ctaClicks: string | null;
  scrollDepth: number;
  exitType: string | null;
};

type CategorySummary = {
  audits: Array<{
    id: string;
    productTitle: string;
    snapshotName: string;
    snapshotCount: number;
    status: string;
    realCount: number;
    targetVisitors: number;
    metricValues: Record<string, number>;
  }>;
  baseline: {
    metricValues: Record<string, number>;
    count: number;
  };
};

type CategoryLoaderData = CategorySummary & {
  category: string;
  config: (typeof CATEGORY_CONFIG)[string];
  summaryPending?: boolean;
};

function emptyAuditMetric(): AuditMetric {
  return {
    sessions: 0,
    real: 0,
    atc: 0,
    conv: 0,
    revenue: 0,
    productClicks: 0,
    linkClicks: 0,
    searches: 0,
    exits: 0,
    scroll50: 0,
    scroll100: 0,
    bodyCtaVisits: 0,
    anyClickVisits: 0,
    bounces: 0,
  };
}

function percent(numerator: number, denominator: number): number {
  return denominator > 0
    ? Math.round((numerator / denominator) * 1000) / 10
    : 0;
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatPercent(value: number): string {
  return `${Number(value || 0)
    .toFixed(1)
    .replace(/\.0$/, "")}%`;
}

function formatMoney(value: number): string {
  return `$${Math.round(value || 0).toLocaleString()}`;
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

function isLinkClick(click: TrackedClick): boolean {
  return (click.tag || "").toLowerCase() === "a" && !!click.href;
}

function isBodyCtaClick(click: TrackedClick): boolean {
  const tag = (click.tag || "").toLowerCase();
  return (
    (click.zone || "main") === "main" && (tag === "button" || tag === "input")
  );
}

function isLinkOrButtonClick(click: TrackedClick): boolean {
  const tag = (click.tag || "").toLowerCase();
  return tag === "a" || tag === "button" || tag === "input";
}

function getCategoryMetricDefs(
  resourceType: ResourceType,
): CategoryMetricDef[] {
  if (resourceType === "COLLECTION") {
    return [
      {
        key: "linkClicks",
        label: "Links",
        baselineLabel: "Avg link clicks",
        format: formatCount,
      },
      {
        key: "searches",
        label: "Searches",
        baselineLabel: "Avg searches",
        format: formatCount,
      },
      {
        key: "exitRate",
        label: "Exit rate",
        baselineLabel: "Avg exit rate",
        format: formatPercent,
        higherIsBetter: false,
      },
      {
        key: "productCtrRate",
        label: "Product CTR",
        baselineLabel: "Avg product CTR",
        format: formatPercent,
      },
    ];
  }

  if (resourceType === "PAGE" || resourceType === "HOMEPAGE") {
    return [
      {
        key: "linkClicks",
        label: "Links",
        baselineLabel: "Avg link clicks",
        format: formatCount,
      },
      {
        key: "searches",
        label: "Searches",
        baselineLabel: "Avg searches",
        format: formatCount,
      },
      {
        key: "exitRate",
        label: "Exit rate",
        baselineLabel: "Avg exit rate",
        format: formatPercent,
        higherIsBetter: false,
      },
      {
        key: "bodyCtaCtrRate",
        label: "CTA CTR",
        baselineLabel: "Avg CTA CTR",
        format: formatPercent,
      },
    ];
  }

  if (resourceType === "BLOG") {
    return [
      {
        key: "bounceRate",
        label: "Bounce",
        baselineLabel: "Avg bounce",
        format: formatPercent,
        higherIsBetter: false,
      },
      {
        key: "scroll50Rate",
        label: "50% scroll",
        baselineLabel: "Avg 50% scroll",
        format: formatPercent,
      },
      {
        key: "scroll100Rate",
        label: "100% scroll",
        baselineLabel: "Avg 100% scroll",
        format: formatPercent,
      },
      {
        key: "anyClickCtrRate",
        label: "CTR",
        baselineLabel: "Avg link/button CTR",
        format: formatPercent,
      },
    ];
  }

  return [
    {
      key: "atcRate",
      label: "ATC",
      baselineLabel: "Avg ATC",
      format: formatPercent,
    },
    {
      key: "cvrRate",
      label: "CVR",
      baselineLabel: "Avg CVR",
      format: formatPercent,
    },
    {
      key: "revenue",
      label: "REV",
      baselineLabel: "Avg revenue",
      format: formatMoney,
    },
    {
      key: "totalRevenue",
      label: "Total REV",
      baselineLabel: "Total revenue",
      format: formatMoney,
      hideInRows: true,
    },
  ];
}

function clearCategoryCaches(shop: string, category: string) {
  clearCacheKey(loaderCacheKeys.category(shop, category));
  clearCacheKey(loaderCacheKeys.categoryFast(shop, category));
  clearCacheKey(loaderCacheKeys.dashboard(shop));
}

function getMetricValuesFromSnapshotStats(
  resourceType: ResourceType,
  rawStats: Prisma.JsonValue | null,
) {
  const stats =
    rawStats && typeof rawStats === "object" && !Array.isArray(rawStats)
      ? (rawStats as Record<string, unknown>)
      : null;

  const numberValue = (key: string) => {
    const value = stats?.[key];
    return typeof value === "number" ? value : 0;
  };

  if (resourceType === "COLLECTION") {
    return {
      atcRate: 0,
      cvrRate: 0,
      revenue: 0,
      totalRevenue: 0,
      linkClicks: numberValue("linkClickCount"),
      searches: numberValue("searchCount"),
      exitRate: numberValue("exitRate"),
      productCtrRate: numberValue("productCtrRate"),
      bodyCtaCtrRate: 0,
      bounceRate: 0,
      scroll50Rate: 0,
      scroll100Rate: 0,
      anyClickCtrRate: 0,
    };
  }

  if (resourceType === "PAGE" || resourceType === "HOMEPAGE") {
    return {
      atcRate: 0,
      cvrRate: 0,
      revenue: 0,
      totalRevenue: 0,
      linkClicks: numberValue("linkClickCount"),
      searches: numberValue("searchCount"),
      exitRate: numberValue("exitRate"),
      productCtrRate: 0,
      bodyCtaCtrRate: numberValue("bodyCtaCtrRate"),
      bounceRate: 0,
      scroll50Rate: 0,
      scroll100Rate: 0,
      anyClickCtrRate: 0,
    };
  }

  if (resourceType === "BLOG") {
    return {
      atcRate: 0,
      cvrRate: 0,
      revenue: 0,
      totalRevenue: 0,
      linkClicks: 0,
      searches: 0,
      exitRate: 0,
      productCtrRate: 0,
      bodyCtaCtrRate: 0,
      bounceRate: numberValue("bounceRate"),
      scroll50Rate: numberValue("scroll50Rate"),
      scroll100Rate: numberValue("scroll100Rate"),
      anyClickCtrRate: numberValue("anyClickCtrRate"),
    };
  }

  return {
    atcRate: numberValue("atcRate"),
    cvrRate: numberValue("convRate"),
    revenue: numberValue("totalRevenue"),
    totalRevenue: numberValue("totalRevenue"),
    linkClicks: 0,
    searches: 0,
    exitRate: 0,
    productCtrRate: 0,
    bodyCtaCtrRate: 0,
    bounceRate: 0,
    scroll50Rate: 0,
    scroll100Rate: 0,
    anyClickCtrRate: 0,
  };
}

async function getFastCategorySummary(
  shop: string,
  category: string,
  config: { resourceType: ResourceType },
): Promise<CategorySummary> {
  return cachedValue(
    loaderCacheKeys.categoryFast(shop, category),
    CATEGORY_CACHE_TTL_MS,
    async () => {
      const auditRows = await prisma.$queryRaw<FastCategoryAuditRow[]>`
      SELECT
        p.id,
        p."productTitle",
        latest.id AS "snapshotId",
        latest.name AS "snapshotName",
        latest.number AS "snapshotNumber",
        latest.status::text AS "snapshotStatus",
        latest."targetVisitors",
        (
          SELECT COUNT(*)::int
          FROM "Snapshot" sc
          WHERE sc."projectId" = p.id
        ) AS "snapshotCount",
        COALESCE((stats_cache.stats->>'realCount')::int, 0)::int AS "realCount",
        jsonb_strip_nulls(jsonb_build_object(
          'atcRate', stats_cache.stats->'atcRate',
          'convRate', stats_cache.stats->'convRate',
          'totalRevenue', stats_cache.stats->'totalRevenue',
          'linkClickCount', stats_cache.stats->'linkClickCount',
          'searchCount', stats_cache.stats->'searchCount',
          'exitRate', stats_cache.stats->'exitRate',
          'productCtrRate', stats_cache.stats->'productCtrRate',
          'bodyCtaCtrRate', stats_cache.stats->'bodyCtaCtrRate',
          'bounceRate', stats_cache.stats->'bounceRate',
          'scroll50Rate', stats_cache.stats->'scroll50Rate',
          'scroll100Rate', stats_cache.stats->'scroll100Rate',
          'anyClickCtrRate', stats_cache.stats->'anyClickCtrRate'
        )) AS stats
      FROM "Project" p
      LEFT JOIN LATERAL (
        SELECT s.*
        FROM "Snapshot" s
        WHERE s."projectId" = p.id
        ORDER BY s.number DESC
        LIMIT 1
      ) latest ON true
      LEFT JOIN "SnapshotStatsCache" stats_cache
        ON stats_cache."snapshotId" = latest.id
      WHERE p.shop = ${shop}
        AND p."resourceType" = ${config.resourceType}::"ResourceType"
      ORDER BY p."createdAt" DESC
    `;

      const audits = auditRows.map((project) => ({
        id: project.id,
        productTitle: project.productTitle,
        snapshotName:
          project.snapshotName || `Snapshot ${project.snapshotNumber || 1}`,
        snapshotCount: project.snapshotCount,
        status: project.snapshotStatus || "NO_SNAPSHOT",
        realCount: Number(project.realCount || 0),
        targetVisitors: project.targetVisitors || 1000,
        metricValues: getMetricValuesFromSnapshotStats(
          config.resourceType,
          project.stats,
        ),
      }));

      const metricDefs = getCategoryMetricDefs(config.resourceType);
      const baselineMetricValues = metricDefs.reduce<Record<string, number>>(
        (acc, def) => {
          if (def.key === "totalRevenue") {
            acc[def.key] = audits.reduce(
              (sum, audit) => sum + (audit.metricValues.revenue || 0),
              0,
            );
            return acc;
          }

          const values = audits.map(
            (audit) =>
              (audit.metricValues as Record<string, number>)[def.key] || 0,
          );
          const nonZeroValues = values.filter((value) => value > 0);
          acc[def.key] = nonZeroValues.length
            ? Math.round(
                (nonZeroValues.reduce((sum, value) => sum + value, 0) /
                  nonZeroValues.length) *
                  10,
              ) / 10
            : 0;
          return acc;
        },
        {},
      );

      return {
        audits,
        baseline: {
          metricValues: baselineMetricValues,
          count: audits.length,
        },
      };
    },
  );
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const startedAt = Date.now();
  const { session } = await authenticate.admin(request);
  const authMs = Date.now() - startedAt;
  const shop = session.shop;
  const category = params.category || "products";
  const config = CATEGORY_CONFIG[category];

  if (!config) {
    throw new Response("Invalid category", { status: 404 });
  }

  const summaryRequested =
    new URL(request.url).searchParams.get("_summary") === "1";

  if (!summaryRequested) {
    const { audits, baseline } = await getFastCategorySummary(
      shop,
      category,
      config,
    );
    if (process.env.NODE_ENV === "development") {
      console.info("[MW Perf] category loader", {
        authMs,
        category,
        durationMs: Date.now() - startedAt,
        summaryRequested,
      });
    }
    return json({ category, config, audits, baseline, summaryPending: true });
  }

  const { audits, baseline } = await cachedValue<CategorySummary>(
    loaderCacheKeys.category(shop, category),
    CATEGORY_CACHE_TTL_MS,
    async () => {
      const auditRows = await prisma.$queryRaw<CategoryAuditRow[]>`
    SELECT
      p.id,
      p."productTitle",
      latest.id AS "snapshotId",
      latest.name AS "snapshotName",
      latest.number AS "snapshotNumber",
      latest.status::text AS "snapshotStatus",
      latest."targetVisitors",
      (
        SELECT COUNT(*)::int
        FROM "Snapshot" sc
        WHERE sc."projectId" = p.id
      ) AS "snapshotCount",
      COALESCE(metrics.sessions, 0)::int AS sessions,
      COALESCE(metrics.real, 0)::int AS real,
      COALESCE(metrics.atc, 0)::int AS atc,
      COALESCE(metrics.conv, 0)::int AS conv,
      COALESCE(metrics.revenue, 0)::float8 AS revenue,
      COALESCE(metrics."productClicks", 0)::int AS "productClicks",
      COALESCE(metrics.searches, 0)::int AS searches,
      COALESCE(metrics.exits, 0)::int AS exits,
      COALESCE(metrics.scroll50, 0)::int AS scroll50,
      COALESCE(metrics.scroll100, 0)::int AS scroll100
    FROM "Project" p
    LEFT JOIN LATERAL (
      SELECT s.*
      FROM "Snapshot" s
      WHERE s."projectId" = p.id
      ORDER BY s.number DESC
      LIMIT 1
    ) latest ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS sessions,
        COUNT(*) FILTER (WHERE v."visitorType" = 'REAL')::int AS real,
        COUNT(*) FILTER (WHERE v."addedToCart" = true)::int AS atc,
        COUNT(*) FILTER (WHERE v.converted = true)::int AS conv,
        COALESCE(SUM(v."orderValue") FILTER (WHERE v.converted = true AND v."orderValue" IS NOT NULL), 0)::float8 AS revenue,
        COUNT(*) FILTER (WHERE v."exitUrl" LIKE '%/products/%')::int AS "productClicks",
        COUNT(*) FILTER (WHERE v."searchQuery" IS NOT NULL)::int AS searches,
        COUNT(*) FILTER (WHERE v."exitType" IN ('window_closed', 'back_button', 'idle', 'external_link'))::int AS exits,
        COUNT(*) FILTER (WHERE v."scrollDepth" >= 50)::int AS scroll50,
        COUNT(*) FILTER (WHERE v."scrollDepth" >= 100)::int AS scroll100
      FROM "Visit" v
      WHERE latest.id IS NOT NULL AND v."snapshotId" = latest.id
    ) metrics ON true
    WHERE p.shop = ${shop}
      AND p."resourceType" = ${config.resourceType}::"ResourceType"
    ORDER BY p."createdAt" DESC
  `;

      const snapshotIds = auditRows
        .map((row) => row.snapshotId)
        .filter(Boolean) as string[];
      const needsInteractionMetrics = config.resourceType !== "PRODUCT";
      const interactionRows: InteractionRow[] =
        snapshotIds.length > 0 && needsInteractionMetrics
          ? await prisma.visit.findMany({
              where: {
                snapshotId: { in: snapshotIds },
                OR: [
                  { ctaClicks: { not: null } },
                  {
                    scrollDepth: { lt: 50 },
                    exitType: { in: NON_INTERNAL_EXIT_TYPES },
                  },
                ],
              },
              select: {
                snapshotId: true,
                ctaClicks: true,
                scrollDepth: true,
                exitType: true,
              },
            })
          : [];

      const metricsMap = new Map<string, AuditMetric>();
      const getMetric = (snapshotId: string) => {
        let metric = metricsMap.get(snapshotId);
        if (!metric) {
          metric = emptyAuditMetric();
          metricsMap.set(snapshotId, metric);
        }
        return metric;
      };

      for (const row of auditRows) {
        if (!row.snapshotId) continue;
        const m = getMetric(row.snapshotId);
        m.sessions = Number(row.sessions || 0);
        m.real = Number(row.real || 0);
        m.atc = Number(row.atc || 0);
        m.conv = Number(row.conv || 0);
        m.revenue = Number(row.revenue || 0);
        m.productClicks = Number(row.productClicks || 0);
        m.searches = Number(row.searches || 0);
        m.exits = Number(row.exits || 0);
        m.scroll50 = Number(row.scroll50 || 0);
        m.scroll100 = Number(row.scroll100 || 0);
      }

      for (const row of interactionRows) {
        if (!row.ctaClicks) continue;
        const clicks = parseTrackedClicks(row.ctaClicks);
        const bodyClicks = clicks.filter(isBodyCtaClick).length;
        const linkOrButtonClicks = clicks.filter(isLinkOrButtonClick).length;
        const m = getMetric(row.snapshotId);
        m.linkClicks += clicks.filter(isLinkClick).length;
        if (bodyClicks > 0) m.bodyCtaVisits++;
        if (linkOrButtonClicks > 0) m.anyClickVisits++;
      }

      for (const row of interactionRows) {
        if (
          row.scrollDepth >= 50 ||
          !NON_INTERNAL_EXIT_TYPES.includes(row.exitType || "")
        )
          continue;
        const clicks = parseTrackedClicks(row.ctaClicks);
        if (clicks.filter(isLinkOrButtonClick).length === 0) {
          getMetric(row.snapshotId).bounces++;
        }
      }

      const audits = auditRows.map((project) => {
        const sid = project.snapshotId;
        const m = sid
          ? metricsMap.get(sid) || emptyAuditMetric()
          : emptyAuditMetric();
        const metricValues = {
          atcRate: percent(m.atc, m.real),
          cvrRate: percent(m.conv, m.real),
          revenue: m.revenue,
          totalRevenue: m.revenue,
          linkClicks: m.linkClicks,
          searches: m.searches,
          exitRate: percent(m.exits, m.sessions),
          productCtrRate: percent(m.productClicks, m.sessions),
          bodyCtaCtrRate: percent(m.bodyCtaVisits, m.sessions),
          bounceRate: percent(m.bounces, m.sessions),
          scroll50Rate: percent(m.scroll50, m.sessions),
          scroll100Rate: percent(m.scroll100, m.sessions),
          anyClickCtrRate: percent(m.anyClickVisits, m.sessions),
        };

        return {
          id: project.id,
          productTitle: project.productTitle,
          snapshotName:
            project.snapshotName || `Snapshot ${project.snapshotNumber || 1}`,
          snapshotCount: project.snapshotCount,
          status: project.snapshotStatus || "NO_SNAPSHOT",
          realCount: m.real,
          targetVisitors: project.targetVisitors || 1000,
          metricValues,
        };
      });

      const metricDefs = getCategoryMetricDefs(config.resourceType);
      const baselineMetricValues = metricDefs.reduce<Record<string, number>>(
        (acc, def) => {
          if (def.key === "totalRevenue") {
            acc[def.key] = audits.reduce(
              (sum, audit) =>
                sum +
                ((audit.metricValues as Record<string, number>).revenue || 0),
              0,
            );
            return acc;
          }

          const values = audits.map(
            (audit) =>
              (audit.metricValues as Record<string, number>)[def.key] || 0,
          );
          const nonZeroValues = values.filter((value) => value > 0);
          acc[def.key] = nonZeroValues.length
            ? Math.round(
                (nonZeroValues.reduce((sum, value) => sum + value, 0) /
                  nonZeroValues.length) *
                  10,
              ) / 10
            : 0;
          return acc;
        },
        {},
      );

      return {
        audits,
        baseline: {
          metricValues: baselineMetricValues,
          count: audits.length,
        },
      };
    },
  );

  if (process.env.NODE_ENV === "development") {
    console.info("[MW Perf] category loader", {
      authMs,
      category,
      durationMs: Date.now() - startedAt,
      summaryRequested,
    });
  }

  return json({ category, config, audits, baseline });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "create") {
    const category = params.category || "products";
    const config = CATEGORY_CONFIG[category];
    if (!config) return json({ error: "Invalid category" }, { status: 400 });

    const productId =
      category === "homepage"
        ? HOMEPAGE_RESOURCE.id
        : (formData.get("productId") as string);
    const productTitle =
      category === "homepage"
        ? HOMEPAGE_RESOURCE.title
        : (formData.get("productTitle") as string);
    const productHandle =
      category === "homepage"
        ? HOMEPAGE_RESOURCE.handle
        : (formData.get("productHandle") as string);
    const snapshotName = formData.get("snapshotName") as string | null;
    const targetVisitors =
      parseInt(formData.get("targetVisitors") as string) || 1000;
    const resourceType = config.resourceType;

    await ensureWebPixel(admin, shop);

    const existing = await prisma.project.findFirst({
      where: {
        shop,
        productHandle,
        resourceType,
        snapshots: { some: { status: "ACTIVE" } },
      },
    });
    if (existing)
      return json(
        { error: `An active audit already exists for this ${config.singular}` },
        { status: 400 },
      );

    let project = await prisma.project.findFirst({
      where: { shop, productHandle, resourceType },
      include: { _count: { select: { snapshots: true } } },
    });

    if (project) {
      await prisma.snapshot.create({
        data: {
          projectId: project.id,
          number: project._count.snapshots + 1,
          name: snapshotName || null,
          targetVisitors,
          status: "ACTIVE",
        },
      });
    } else {
      await prisma.project.create({
        data: {
          shop,
          resourceType,
          productId,
          productTitle,
          productHandle,
          snapshots: {
            create: {
              number: 1,
              name: snapshotName || null,
              targetVisitors,
              status: "ACTIVE",
            },
          },
        },
      });
    }
    clearCategoryCaches(shop, category);
    return json({ success: true });
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

function DiffTag({
  value,
  baseline,
  higherIsBetter = true,
}: {
  value: number;
  baseline: number;
  higherIsBetter?: boolean;
}) {
  if (baseline === 0 || value === 0) return null;
  const pct = Math.round(((value - baseline) / baseline) * 100);
  if (pct === 0) return null;
  const up = pct > 0;
  const improved = higherIsBetter ? up : !up;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: improved ? "#1a7f5a" : "#bf0711",
        marginLeft: 6,
        whiteSpace: "nowrap",
      }}
    >
      {up ? "\u2197" : "\u2198"} {Math.abs(pct)}%
    </span>
  );
}

export default function AuditsCategory() {
  const loaderData = useLoaderData<CategoryLoaderData>();
  const { category, config } = loaderData;
  const submit = useSubmit();
  const navigation = useNavigation();
  const resourceFetcher = useFetcher<{
    category: string;
    resources: Array<{ id: string; title: string; handle: string }>;
  }>();
  const summaryFetcher = useFetcher<{
    category: string;
    audits: CategorySummary["audits"];
    baseline: CategorySummary["baseline"];
  }>();
  const isLoading = navigation.state !== "idle";
  const summaryData =
    summaryFetcher.data?.category === category ? summaryFetcher.data : null;
  const audits = summaryData?.audits ?? loaderData.audits;
  const baseline = summaryData?.baseline ?? loaderData.baseline;
  const metricDefs = getCategoryMetricDefs(config.resourceType as ResourceType);
  const rowMetricDefs = metricDefs.filter((metric) => !metric.hideInRows);

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [snapshotName, setSnapshotName] = useState("");
  const [targetVisitors, setTargetVisitors] = useState("1000");
  const [selectedResource, setSelectedResource] = useState<{
    id: string;
    title: string;
    handle: string;
  } | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [prefetchDetails, setPrefetchDetails] = useState(false);
  const lastSummaryRequestUrl = useRef<string | null>(null);
  const loadSummaryRef = useRef(summaryFetcher.load);

  useEffect(() => {
    loadSummaryRef.current = summaryFetcher.load;
  }, [summaryFetcher.load]);

  useEffect(() => {
    const summaryUrl = `/app/audits/${category}?_summary=1`;
    if (
      !loaderData.summaryPending ||
      lastSummaryRequestUrl.current === summaryUrl
    )
      return;
    lastSummaryRequestUrl.current = summaryUrl;
    const timeoutId = window.setTimeout(() => {
      loadSummaryRef.current(summaryUrl);
    }, 600);

    return () => window.clearTimeout(timeoutId);
  }, [category, loaderData.summaryPending]);

  useEffect(() => {
    setPrefetchDetails(false);
    const timeoutId = window.setTimeout(() => {
      setPrefetchDetails(true);
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [category]);

  const handleOpenCreate = useCallback(async () => {
    if (category === "homepage") {
      setSelectedResource(HOMEPAGE_RESOURCE);
      setSnapshotName("");
      setTargetVisitors("1000");
      setIsCreateModalOpen(true);
      return;
    }

    if (category === "products" || category === "collections") {
      try {
        const pickerType =
          category === "collections" ? "collection" : "product";
        const selected = await shopify.resourcePicker({
          type: pickerType,
          multiple: false,
          ...(pickerType === "product"
            ? { filter: { variants: false, draft: false } }
            : {}),
        });
        if (selected && selected.length > 0) {
          setSelectedResource({
            id: selected[0].id,
            title: selected[0].title,
            handle: selected[0].handle,
          });
          setSnapshotName("");
          setTargetVisitors("1000");
          setIsCreateModalOpen(true);
        }
      } catch (e) {
        console.error("Resource picker error:", e);
      }
    } else {
      // Pages/blogs — show custom picker modal
      setSelectedResource(null);
      setPickerSearch("");
      setIsPickerOpen(true);
      if (
        resourceFetcher.data?.category !== category &&
        resourceFetcher.state === "idle"
      ) {
        resourceFetcher.load(`/api/resources/${category}`);
      }
    }
  }, [category, resourceFetcher]);

  const handlePickResource = useCallback(
    (res: { id: string; title: string; handle: string }) => {
      setSelectedResource(res);
      setIsPickerOpen(false);
      setSnapshotName("");
      setTargetVisitors("1000");
      setIsCreateModalOpen(true);
    },
    [],
  );

  const handleCreate = useCallback(() => {
    if (!selectedResource) return;
    const fd = new FormData();
    fd.append("action", "create");
    fd.append("productId", selectedResource.id);
    fd.append("productTitle", selectedResource.title);
    fd.append("productHandle", selectedResource.handle);
    fd.append("snapshotName", snapshotName);
    fd.append("targetVisitors", targetVisitors);
    submit(fd, { method: "POST" });
    setIsCreateModalOpen(false);
  }, [selectedResource, snapshotName, targetVisitors, submit]);

  const availableResources =
    resourceFetcher.data?.category === category
      ? resourceFetcher.data.resources
      : [];
  const resourcesLoading =
    resourceFetcher.state !== "idle" && availableResources.length === 0;
  const filteredResources = availableResources.filter(
    (r: any) =>
      !pickerSearch ||
      r.title.toLowerCase().includes(pickerSearch.toLowerCase()),
  );
  const detailPrefetchPages = Array.from(
    new Set(
      audits
        .slice(0, DETAIL_PREFETCH_LIMIT)
        .map((audit) => `/app/project/${audit.id}`),
    ),
  );

  return (
    <Page
      title={config.label}
      subtitle={
        category === "homepage"
          ? "Audit the store homepage and compare snapshot baselines"
          : "Audit baselines and per-page comparison"
      }
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      {prefetchDetails &&
        detailPrefetchPages.map((page) => (
          <PrefetchPageLinks key={page} page={page} />
        ))}
      <TitleBar title={config.label}>
        <button variant="primary" onClick={handleOpenCreate}>
          + New {config.singular} Audit
        </button>
      </TitleBar>
      <Layout>
        <Layout.Section>
          {audits.length === 0 ? (
            <Card>
              <BlockStack gap="300" inlineAlign="center">
                <Text as="p" variant="bodyMd" tone="subdued">
                  No {category} audits yet.
                </Text>
                <Button onClick={handleOpenCreate}>
                  Create your first {config.singular} audit
                </Button>
              </BlockStack>
            </Card>
          ) : (
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    {config.label} baseline
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Average across {baseline.count} audit
                    {baseline.count === 1 ? "" : "s"}
                  </Text>
                </InlineStack>
                <div
                  style={{
                    display: "flex",
                    gap: 32,
                    flexWrap: "wrap",
                    marginTop: 8,
                  }}
                >
                  {metricDefs.map((metric) => (
                    <div key={metric.key} style={{ flex: 1, minWidth: 140 }}>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {metric.baselineLabel}
                      </Text>
                      <Text as="p" variant="headingLg" fontWeight="semibold">
                        {metric.format(
                          (baseline.metricValues as Record<string, number>)[
                            metric.key
                          ] || 0,
                        )}
                      </Text>
                    </div>
                  ))}
                </div>
              </BlockStack>
            </Card>
          )}
        </Layout.Section>

        {audits.length > 0 && (
          <Layout.Section>
            <Card padding="0">
              {audits.map((p: any, idx: number) => {
                const progressPct = Math.min(
                  100,
                  Math.round((p.realCount / p.targetVisitors) * 100),
                );
                const isDone = progressPct >= 100;
                return (
                  <Link
                    key={p.id}
                    to={`/app/project/${p.id}`}
                    prefetch="viewport"
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <div
                      style={{
                        padding: "14px 20px",
                        borderBottom:
                          idx < audits.length - 1
                            ? "1px solid #ebebeb"
                            : "none",
                        cursor: "pointer",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background =
                          "var(--p-color-bg-surface-hover)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 24,
                        }}
                      >
                        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                          <Text variant="bodyMd" fontWeight="bold" as="span">
                            {p.productTitle}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {p.snapshotName}
                            {p.snapshotCount > 1
                              ? ` \u00B7 ${p.snapshotCount} snapshots`
                              : ""}
                          </Text>
                        </div>
                        <div style={{ flex: "1 1 180px", maxWidth: 220 }}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 4,
                            }}
                          >
                            <Text as="span" variant="bodySm" tone="subdued">
                              {p.realCount}/{p.targetVisitors}
                            </Text>
                          </div>
                          <div
                            style={{
                              height: 6,
                              background: "#e4e5e7",
                              borderRadius: 3,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                width: `${progressPct}%`,
                                background: isDone ? "#29845a" : "#2c6ecb",
                                borderRadius: 3,
                                transition: "width 0.3s",
                              }}
                            />
                          </div>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 24,
                            flexShrink: 0,
                            flexWrap: "wrap",
                            justifyContent: "flex-end",
                          }}
                        >
                          {rowMetricDefs.map((metric) => {
                            const value =
                              (p.metricValues as Record<string, number>)[
                                metric.key
                              ] || 0;
                            const baselineValue =
                              (baseline.metricValues as Record<string, number>)[
                                metric.key
                              ] || 0;
                            return (
                              <div
                                key={metric.key}
                                style={{ textAlign: "center", minWidth: 88 }}
                              >
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {metric.label}
                                </Text>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "baseline",
                                    justifyContent: "center",
                                  }}
                                >
                                  <Text
                                    as="span"
                                    variant="bodyMd"
                                    fontWeight="semibold"
                                  >
                                    {metric.format(value)}
                                  </Text>
                                  <DiffTag
                                    value={value}
                                    baseline={baselineValue}
                                    higherIsBetter={metric.higherIsBetter}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </Card>
          </Layout.Section>
        )}
      </Layout>

      {/* Custom Resource Picker for Pages/Blogs */}
      <Modal
        open={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        title={`Add ${config.singular}`}
      >
        <Modal.Section>
          <TextField
            label=""
            labelHidden
            value={pickerSearch}
            onChange={setPickerSearch}
            placeholder={`Search ${category}...`}
            autoComplete="off"
            clearButton
            onClearButtonClick={() => setPickerSearch("")}
            prefix={<span style={{ color: "#6d7175" }}>{"\uD83D\uDD0D"}</span>}
          />
        </Modal.Section>
        <div style={{ maxHeight: 400, overflowY: "auto" }}>
          {resourcesLoading ? (
            <div style={{ padding: "24px 20px", textAlign: "center" }}>
              <Text as="p" variant="bodySm" tone="subdued">
                Loading {category}...
              </Text>
            </div>
          ) : filteredResources.length === 0 ? (
            <div style={{ padding: "24px 20px", textAlign: "center" }}>
              <Text as="p" variant="bodySm" tone="subdued">
                {pickerSearch
                  ? `No ${category} matching "${pickerSearch}"`
                  : `No ${category} found in your store`}
              </Text>
            </div>
          ) : (
            filteredResources.map((r: any) => (
              <div
                key={r.id}
                onClick={() => handlePickResource(r)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 20px",
                  cursor: "pointer",
                  borderBottom: "1px solid #f1f1f1",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#f6f6f7";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 6,
                    background: "#e4e5e7",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    color: "#6d7175",
                    flexShrink: 0,
                  }}
                >
                  {category === "blogs" ? "\uD83D\uDCDD" : "\uD83D\uDCC4"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text as="p" variant="bodyMd">
                    {r.title}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    /{category === "blogs" ? "blogs" : "pages"}/{r.handle}
                  </Text>
                </div>
              </div>
            ))
          )}
        </div>
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid #e4e5e7",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Text as="span" variant="bodySm" tone="subdued">
            {filteredResources.length} {category} available
          </Text>
          <Button onClick={() => setIsPickerOpen(false)}>Cancel</Button>
        </div>
      </Modal>

      {/* Create Audit Modal (after resource is selected) */}
      <Modal
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title={`Create Audit: ${selectedResource?.title || ""}`}
        primaryAction={{
          content: "Create Audit",
          onAction: handleCreate,
          loading: isLoading,
          disabled: !selectedResource,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setIsCreateModalOpen(false) },
        ]}
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
