import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const CATEGORY_CONFIG: Record<string, { label: string; resourceType: string; rateLabel: string }> = {
  products: { label: "Products", resourceType: "PRODUCT", rateLabel: "ATC" },
  collections: { label: "Collections", resourceType: "COLLECTION", rateLabel: "CTR" },
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const category = params.category || "products";
  const config = CATEGORY_CONFIG[category];

  if (!config) {
    throw new Response("Invalid category", { status: 404 });
  }

  const projects = await prisma.project.findMany({
    where: { shop, resourceType: config.resourceType },
    orderBy: { createdAt: "desc" },
    include: {
      snapshots: {
        orderBy: { number: "desc" },
        take: 1,
        select: {
          id: true,
          number: true,
          name: true,
          status: true,
          targetVisitors: true,
        },
      },
    },
  });

  // Get snapshot IDs for batch queries
  const snapshotIds = projects
    .map((p) => p.snapshots[0]?.id)
    .filter(Boolean) as string[];

  // Batch queries for metrics
  const [visitorCounts, atcCounts, convCounts, revenueSums, productClickCounts] =
    snapshotIds.length > 0
      ? await Promise.all([
          prisma.visit.groupBy({
            by: ["snapshotId", "visitorType"],
            where: { snapshotId: { in: snapshotIds } },
            _count: true,
          }),
          prisma.visit.groupBy({
            by: ["snapshotId"],
            where: { snapshotId: { in: snapshotIds }, addedToCart: true },
            _count: true,
          }),
          prisma.visit.groupBy({
            by: ["snapshotId"],
            where: { snapshotId: { in: snapshotIds }, converted: true },
            _count: true,
          }),
          prisma.visit.groupBy({
            by: ["snapshotId"],
            where: { snapshotId: { in: snapshotIds }, converted: true, orderValue: { not: null } },
            _sum: { orderValue: true },
          }),
          config.resourceType === "COLLECTION"
            ? prisma.visit.groupBy({
                by: ["snapshotId"],
                where: { snapshotId: { in: snapshotIds }, exitUrl: { contains: "/products/" } },
                _count: true,
              })
            : Promise.resolve([]),
        ])
      : [[], [], [], [], []];

  // Build metrics map
  const metricsMap = new Map<string, { real: number; atc: number; conv: number; revenue: number; productClicks: number }>();
  for (const row of visitorCounts) {
    if (row.visitorType !== "REAL") continue;
    const m = metricsMap.get(row.snapshotId) || { real: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 };
    m.real = row._count;
    metricsMap.set(row.snapshotId, m);
  }
  for (const row of atcCounts) {
    const m = metricsMap.get(row.snapshotId) || { real: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 };
    m.atc = row._count;
    metricsMap.set(row.snapshotId, m);
  }
  for (const row of convCounts) {
    const m = metricsMap.get(row.snapshotId) || { real: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 };
    m.conv = row._count;
    metricsMap.set(row.snapshotId, m);
  }
  for (const row of revenueSums) {
    const m = metricsMap.get(row.snapshotId) || { real: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 };
    m.revenue = row._sum.orderValue || 0;
    metricsMap.set(row.snapshotId, m);
  }
  for (const row of productClickCounts as any[]) {
    const m = metricsMap.get(row.snapshotId) || { real: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 };
    m.productClicks = row._count;
    metricsMap.set(row.snapshotId, m);
  }

  const audits = projects.map((project) => {
    const snap = project.snapshots[0];
    const sid = snap?.id;
    const m = sid ? metricsMap.get(sid) || { real: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 } : { real: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 };
    const rate = config.resourceType === "PRODUCT"
      ? (m.real > 0 ? Math.round((m.atc / m.real) * 1000) / 10 : 0)
      : (m.real > 0 ? Math.round((m.productClicks / m.real) * 1000) / 10 : 0);
    const cvrRate = m.real > 0 ? Math.round((m.conv / m.real) * 1000) / 10 : 0;

    return {
      id: project.id,
      productTitle: project.productTitle,
      snapshotName: snap?.name || `Snapshot ${snap?.number || 1}`,
      snapshotCount: project.snapshots.length,
      status: snap?.status || "NO_SNAPSHOT",
      realCount: m.real,
      targetVisitors: snap?.targetVisitors || 1000,
      rate,
      cvrRate,
      revenue: m.revenue,
    };
  });

  // Compute baseline averages
  const rates = audits.map((a) => a.rate).filter((r) => r > 0);
  const cvrs = audits.map((a) => a.cvrRate).filter((r) => r > 0);
  const revs = audits.map((a) => a.revenue);
  const baseline = {
    avgRate: rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10 : 0,
    avgCvr: cvrs.length ? Math.round((cvrs.reduce((a, b) => a + b, 0) / cvrs.length) * 10) / 10 : 0,
    totalRevenue: revs.reduce((a, b) => a + b, 0),
    avgRevenue: revs.length ? Math.round(revs.reduce((a, b) => a + b, 0) / revs.length) : 0,
    count: audits.length,
  };

  return json({
    category,
    config,
    audits,
    baseline,
  });
};

function DiffTag({ value, baseline }: { value: number; baseline: number }) {
  if (baseline === 0 || value === 0) return null;
  const pct = Math.round(((value - baseline) / baseline) * 100);
  if (pct === 0) return null;
  const up = pct > 0;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: up ? "#1a7f5a" : "#bf0711", marginLeft: 6, whiteSpace: "nowrap" }}>
      {up ? "\u2197" : "\u2198"} {Math.abs(pct)}%
    </span>
  );
}

export default function AuditsCategory() {
  const { category, config, audits, baseline } = useLoaderData<typeof loader>();

  return (
    <Page
      title={config.label}
      subtitle="Audit baselines and per-page comparison"
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <TitleBar title={config.label} />
      <Layout>
        {/* Baseline Card */}
        <Layout.Section>
          {audits.length === 0 ? (
            <Card>
              <Text as="p" variant="bodyMd" tone="subdued">No {category} audits yet.</Text>
            </Card>
          ) : (
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">{config.label} baseline</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Average across {baseline.count} audit{baseline.count === 1 ? "" : "s"}</Text>
                </InlineStack>
                <div style={{ display: "flex", gap: 32, flexWrap: "wrap", marginTop: 8 }}>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <Text as="p" variant="bodySm" tone="subdued">Avg {config.rateLabel}</Text>
                    <Text as="p" variant="headingLg" fontWeight="semibold">{baseline.avgRate}%</Text>
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <Text as="p" variant="bodySm" tone="subdued">Avg CVR</Text>
                    <Text as="p" variant="headingLg" fontWeight="semibold">{baseline.avgCvr}%</Text>
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <Text as="p" variant="bodySm" tone="subdued">Avg revenue</Text>
                    <Text as="p" variant="headingLg" fontWeight="semibold">${baseline.avgRevenue.toLocaleString()}</Text>
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <Text as="p" variant="bodySm" tone="subdued">Total revenue</Text>
                    <Text as="p" variant="headingLg" fontWeight="semibold">${Math.round(baseline.totalRevenue).toLocaleString()}</Text>
                  </div>
                </div>
              </BlockStack>
            </Card>
          )}
        </Layout.Section>

        {/* Audit rows */}
        {audits.length > 0 && (
          <Layout.Section>
            <Card padding="0">
              {audits.map((p: any, idx: number) => {
                const progressPct = Math.min(100, Math.round((p.realCount / p.targetVisitors) * 100));
                const isDone = progressPct >= 100;
                return (
                  <Link key={p.id} to={`/app/project/${p.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                    <div
                      style={{
                        padding: "14px 20px",
                        borderBottom: idx < audits.length - 1 ? "1px solid #ebebeb" : "none",
                        cursor: "pointer", transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--p-color-bg-surface-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                          <Text variant="bodyMd" fontWeight="bold" as="span">{p.productTitle}</Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {p.snapshotName}{p.snapshotCount > 1 ? ` \u00B7 ${p.snapshotCount} snapshots` : ""}
                          </Text>
                        </div>
                        <div style={{ flex: "1 1 180px", maxWidth: 220 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <Text as="span" variant="bodySm" tone="subdued">{p.realCount}/{p.targetVisitors}</Text>
                          </div>
                          <div style={{ height: 6, background: "#e4e5e7", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${progressPct}%`, background: isDone ? "#29845a" : "#2c6ecb", borderRadius: 3, transition: "width 0.3s" }} />
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 28, flexShrink: 0 }}>
                          <div style={{ textAlign: "center", minWidth: 88 }}>
                            <Text as="p" variant="bodySm" tone="subdued">{config.rateLabel}</Text>
                            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center" }}>
                              <Text as="span" variant="bodyMd" fontWeight="semibold">{p.rate}%</Text>
                              <DiffTag value={p.rate} baseline={baseline.avgRate} />
                            </div>
                          </div>
                          <div style={{ textAlign: "center", minWidth: 88 }}>
                            <Text as="p" variant="bodySm" tone="subdued">CVR</Text>
                            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center" }}>
                              <Text as="span" variant="bodyMd" fontWeight="semibold">{p.cvrRate}%</Text>
                              <DiffTag value={p.cvrRate} baseline={baseline.avgCvr} />
                            </div>
                          </div>
                          <div style={{ textAlign: "center", minWidth: 112 }}>
                            <Text as="p" variant="bodySm" tone="subdued">REV</Text>
                            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center" }}>
                              <Text as="span" variant="bodyMd" fontWeight="semibold">${Math.round(p.revenue).toLocaleString()}</Text>
                              <DiffTag value={p.revenue} baseline={baseline.avgRevenue} />
                            </div>
                          </div>
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
    </Page>
  );
}
