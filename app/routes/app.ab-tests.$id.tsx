import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useMemo, useState } from "react";
import { json, redirect } from "@remix-run/node";
import {
  Link,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import { Modal as AppBridgeModal, TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { AbTestDetailReport } from "../components/AbTestDetailReport";
import { getAbTestStats } from "../utils/ab-tests.server";

const PAGE_TYPE_LABELS: Record<string, string> = {
  PRODUCT: "Product",
  COLLECTION: "Collection",
  PAGE: "Page",
  BLOG: "Blog",
  HOMEPAGE: "Homepage",
  CART: "Cart",
};

function statusTone(status: string) {
  if (status === "LIVE") return "success" as const;
  if (status === "PAUSED") return "warning" as const;
  if (status === "ENDED") return "info" as const;
  return undefined;
}

function formatCurrency(value: number) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatPercent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

function formatDuration(milliseconds: number) {
  if (!milliseconds) return "0s";
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

type AbTestStatsRow = Awaited<ReturnType<typeof getAbTestStats>>[number];

function MetricTile({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div
      style={{
        padding: 16,
        border: "1px solid var(--p-color-border-secondary)",
        borderRadius: 8,
        background: "var(--p-color-bg-surface)",
        minHeight: 116,
      }}
    >
      <BlockStack gap="150">
        <Text as="span" tone="subdued" fontWeight="semibold">
          {label}
        </Text>
        <Text as="p" variant="heading2xl">
          {value}
        </Text>
        <Text as="p" tone="subdued">
          {caption}
        </Text>
      </BlockStack>
    </div>
  );
}

function BreakdownList({
  items,
  emptyLabel,
}: {
  items: AbTestStatsRow["sourceBreakdown"];
  emptyLabel: string;
}) {
  if (!items.length) {
    return (
      <Text as="p" tone="subdued">
        {emptyLabel}
      </Text>
    );
  }

  return (
    <BlockStack gap="250">
      {items.map((item) => (
        <div key={item.key}>
          <InlineStack align="space-between" blockAlign="center" gap="300">
            <Text as="span" fontWeight="medium">
              {item.label}
            </Text>
            <Text as="span" tone="subdued">
              {item.count.toLocaleString()} · {formatPercent(item.percent)}
            </Text>
          </InlineStack>
          <div
            style={{
              height: 6,
              borderRadius: 999,
              marginTop: 8,
              background: "var(--p-color-bg-surface-secondary)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.min(100, Math.max(0, item.percent))}%`,
                height: "100%",
                background: "var(--p-color-bg-fill-success)",
              }}
            />
          </div>
        </div>
      ))}
    </BlockStack>
  );
}

function VisitorQualityBar({ row }: { row: AbTestStatsRow }) {
  const total = row.assignedVisitors || 0;
  const realPercent = total ? (row.realVisitors / total) * 100 : 0;
  const zombiePercent = total ? (row.zombies / total) * 100 : 0;
  const botPercent = total ? (row.bots / total) * 100 : 0;
  const pendingPercent = Math.max(
    0,
    100 - realPercent - zombiePercent - botPercent,
  );

  return (
    <BlockStack gap="200">
      <div
        style={{
          display: "flex",
          height: 10,
          borderRadius: 999,
          overflow: "hidden",
          background: "var(--p-color-bg-surface-secondary)",
        }}
      >
        <div
          style={{
            width: `${realPercent}%`,
            background: "var(--p-color-bg-fill-success)",
          }}
        />
        <div
          style={{
            width: `${zombiePercent}%`,
            background: "var(--p-color-bg-fill-warning)",
          }}
        />
        <div
          style={{
            width: `${botPercent}%`,
            background: "var(--p-color-bg-fill-critical)",
          }}
        />
        <div
          style={{
            width: `${pendingPercent}%`,
            background: "var(--p-color-bg-fill-tertiary)",
          }}
        />
      </div>
      <InlineStack gap="300" wrap>
        <Text as="span" tone="subdued">
          Real {row.realVisitors.toLocaleString()}
        </Text>
        <Text as="span" tone="subdued">
          Zombies {row.zombies.toLocaleString()}
        </Text>
        <Text as="span" tone="subdued">
          Bots {row.bots.toLocaleString()}
        </Text>
      </InlineStack>
    </BlockStack>
  );
}

function VariantDetailCard({ row }: { row: AbTestStatsRow }) {
  return (
    <Card padding="0">
      <div
        style={{
          padding: 20,
          borderBottom: "1px solid var(--p-color-border-secondary)",
        }}
      >
        <InlineStack align="space-between" blockAlign="start" gap="300">
          <BlockStack gap="100">
            <Badge tone={row.key === "A" ? "info" : "warning"}>
              {row.key} · {row.name}
            </Badge>
            <Text as="h3" variant="headingLg">
              {row.templateName}
            </Text>
            <Text as="p" tone="subdued">
              {row.templateSuffix
                ? `?view=${row.templateSuffix}`
                : "Default template"}
            </Text>
          </BlockStack>
          <Text as="span" tone="subdued">
            {row.assignedVisitors.toLocaleString()} assigned
          </Text>
        </InlineStack>
      </div>
      <div style={{ padding: 20 }}>
        <BlockStack gap="500">
          <VisitorQualityBar row={row} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 12,
            }}
          >
            <MetricTile
              label="ATC"
              value={formatPercent(row.addToCartRate)}
              caption={`${row.addToCarts.toLocaleString()} add-to-carts`}
            />
            <MetricTile
              label="CVR"
              value={formatPercent(row.conversionRate)}
              caption={`${row.orders.toLocaleString()} orders`}
            />
            <MetricTile
              label="Revenue"
              value={formatCurrency(row.revenue)}
              caption={`${formatCurrency(row.revenuePerVisitor)} per real visitor`}
            />
            <MetricTile
              label="Engagement"
              value={formatPercent(row.avgScrollDepth)}
              caption={`${formatDuration(row.avgTimeOnPage)} avg. time`}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 20,
            }}
          >
            <section>
              <BlockStack gap="250">
                <Text as="h4" variant="headingSm">
                  Top traffic sources
                </Text>
                <BreakdownList
                  items={row.sourceBreakdown}
                  emptyLabel="No source data captured yet."
                />
              </BlockStack>
            </section>
            <section>
              <BlockStack gap="250">
                <Text as="h4" variant="headingSm">
                  Top pages
                </Text>
                <BreakdownList
                  items={row.pageBreakdown}
                  emptyLabel="No page data captured yet."
                />
              </BlockStack>
            </section>
          </div>
        </BlockStack>
      </div>
    </Card>
  );
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const test = await prisma.abTest.findFirst({
    where: { id: params.id, shop },
    include: {
      variants: {
        orderBy: { sortOrder: "asc" },
        include: { _count: { select: { assignments: true } } },
      },
    },
  });

  if (!test) {
    throw new Response("Not found", { status: 404 });
  }

  const stats = await getAbTestStats(test.id);

  return json({
    test: {
      ...test,
      createdAt: test.createdAt.toISOString(),
      launchedAt: test.launchedAt?.toISOString() ?? null,
      pausedAt: test.pausedAt?.toISOString() ?? null,
      endedAt: test.endedAt?.toISOString() ?? null,
      variants: test.variants.map((variant) => ({
        ...variant,
        createdAt: variant.createdAt.toISOString(),
        updatedAt: variant.updatedAt.toISOString(),
      })),
    },
    stats,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = String(formData.get("action") || "");
  const test = await prisma.abTest.findFirst({
    where: { id: params.id, shop },
  });

  if (!test) return json({ error: "Test not found" }, { status: 404 });

  if (actionType === "launch-test") {
    await prisma.abTest.updateMany({
      where: {
        shop,
        targetPageType: test.targetPageType,
        status: "LIVE",
        id: { not: test.id },
      },
      data: { status: "PAUSED", pausedAt: new Date() },
    });
    await prisma.abTest.update({
      where: { id: test.id },
      data: { status: "LIVE", launchedAt: new Date(), pausedAt: null },
    });
    return redirect(`/app/ab-tests/${test.id}`);
  }

  if (actionType === "pause-test") {
    await prisma.abTest.update({
      where: { id: test.id },
      data: { status: "PAUSED", pausedAt: new Date() },
    });
    return redirect(`/app/ab-tests/${test.id}`);
  }

  if (actionType === "end-test") {
    await prisma.abTest.update({
      where: { id: test.id },
      data: { status: "ENDED", endedAt: new Date() },
    });
    return redirect(`/app/ab-tests/${test.id}`);
  }

  if (actionType === "delete-test") {
    await prisma.abTest.delete({ where: { id: test.id } });
    return redirect("/app/ab-tests");
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

export default function AbTestDetail() {
  const { test, stats } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isLoading = navigation.state !== "idle";

  function submitAction(action: string) {
    const formData = new FormData();
    formData.append("action", action);
    submit(formData, { method: "POST" });
  }

  const totals = useMemo(() => {
    const assignedVisitors = stats.reduce(
      (sum, row) => sum + row.assignedVisitors,
      0,
    );
    const realVisitors = stats.reduce((sum, row) => sum + row.realVisitors, 0);
    const zombies = stats.reduce((sum, row) => sum + row.zombies, 0);
    const bots = stats.reduce((sum, row) => sum + row.bots, 0);
    const addToCarts = stats.reduce((sum, row) => sum + row.addToCarts, 0);
    const orders = stats.reduce((sum, row) => sum + row.orders, 0);
    const revenue = stats.reduce((sum, row) => sum + row.revenue, 0);
    const ctaClicks = stats.reduce((sum, row) => sum + row.ctaClicks, 0);
    const avgTimeOnPage = realVisitors
      ? stats.reduce(
          (sum, row) => sum + row.avgTimeOnPage * row.realVisitors,
          0,
        ) / realVisitors
      : 0;
    const avgScrollDepth = realVisitors
      ? stats.reduce(
          (sum, row) => sum + row.avgScrollDepth * row.realVisitors,
          0,
        ) / realVisitors
      : 0;

    return {
      assignedVisitors,
      realVisitors,
      zombies,
      bots,
      addToCarts,
      orders,
      revenue,
      ctaClicks,
      avgTimeOnPage,
      avgScrollDepth,
      addToCartRate: realVisitors ? (addToCarts / realVisitors) * 100 : 0,
      conversionRate: realVisitors ? (orders / realVisitors) * 100 : 0,
      revenuePerVisitor: realVisitors ? revenue / realVisitors : 0,
      ctaClickRate: realVisitors ? (ctaClicks / realVisitors) * 100 : 0,
    };
  }, [stats]);
  const totalHumans = totals.realVisitors;

  return (
    <Page
      title={test.name}
      subtitle={`${PAGE_TYPE_LABELS[test.targetPageType] || test.targetPageType} template test`}
      backAction={{ content: "A/B tests", url: "/app/ab-tests" }}
      primaryAction={
        test.status === "DRAFT"
          ? {
              content: "Launch",
              onAction: () => submitAction("launch-test"),
              loading: isLoading,
            }
          : test.status === "LIVE"
            ? {
                content: "Pause",
                onAction: () => submitAction("pause-test"),
                loading: isLoading,
              }
            : undefined
      }
      secondaryActions={[
        ...(test.status === "LIVE" || test.status === "PAUSED"
          ? [
              {
                content: "End test",
                onAction: () => submitAction("end-test"),
                loading: isLoading,
              },
            ]
          : []),
        {
          content: "Delete",
          destructive: true,
          onAction: () => submitAction("delete-test"),
          loading: isLoading,
        },
      ]}
    >
      <TitleBar title="A/B test details" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <InlineStack align="space-between" blockAlign="start" gap="400">
                <BlockStack gap="150">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={statusTone(test.status)}>
                      {test.status.toLowerCase()}
                    </Badge>
                    <Badge>
                      {test.goal.replaceAll("_", " ").toLowerCase()}
                    </Badge>
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    {test.themeName
                      ? `${test.themeName} theme`
                      : "Theme not linked yet"}{" "}
                    · {test.trafficSplit}/{100 - test.trafficSplit} traffic
                    split
                  </Text>
                </BlockStack>
                <BlockStack gap="200" inlineAlign="end">
                  <Text as="span" tone="subdued">
                    {totalHumans.toLocaleString()} real visitors assigned
                  </Text>
                  <Button onClick={() => setDetailsOpen(true)}>
                    View more detail
                  </Button>
                </BlockStack>
              </InlineStack>
            </Card>

            <Card padding="0">
              <div style={{ padding: "16px 20px" }}>
                <Text as="h2" variant="headingMd">
                  Variant results
                </Text>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    minWidth: 760,
                    borderCollapse: "collapse",
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        background: "var(--p-color-bg-surface-secondary)",
                      }}
                    >
                      {[
                        "Variant",
                        "Template",
                        "Real visitors",
                        "CVR",
                        "Revenue",
                      ].map((heading) => (
                        <th
                          key={heading}
                          style={{
                            padding: "12px 20px",
                            textAlign:
                              heading === "Variant" || heading === "Template"
                                ? "left"
                                : "right",
                            borderTop:
                              "1px solid var(--p-color-border-secondary)",
                            borderBottom:
                              "1px solid var(--p-color-border-secondary)",
                          }}
                        >
                          <Text as="span" tone="subdued" fontWeight="semibold">
                            {heading}
                          </Text>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((row) => {
                      const progress = totalHumans
                        ? Math.round((row.visitors / totalHumans) * 100)
                        : 0;
                      return (
                        <tr key={row.variantId}>
                          <td
                            style={{
                              padding: "16px 20px",
                              borderBottom:
                                "1px solid var(--p-color-border-secondary)",
                            }}
                          >
                            <BlockStack gap="050">
                              <Text as="span" fontWeight="semibold">
                                {row.key} · {row.name}
                              </Text>
                              <ProgressBar progress={progress} size="small" />
                            </BlockStack>
                          </td>
                          <td
                            style={{
                              padding: "16px 20px",
                              borderBottom:
                                "1px solid var(--p-color-border-secondary)",
                            }}
                          >
                            <Text as="span">{row.templateName}</Text>
                            {row.templateSuffix ? (
                              <Text as="p" tone="subdued">
                                ?view={row.templateSuffix}
                              </Text>
                            ) : null}
                          </td>
                          <td
                            style={{
                              padding: "16px 20px",
                              textAlign: "right",
                              borderBottom:
                                "1px solid var(--p-color-border-secondary)",
                            }}
                          >
                            {row.visitors.toLocaleString()}
                          </td>
                          <td
                            style={{
                              padding: "16px 20px",
                              textAlign: "right",
                              borderBottom:
                                "1px solid var(--p-color-border-secondary)",
                            }}
                          >
                            {row.conversionRate.toFixed(1)}%
                          </td>
                          <td
                            style={{
                              padding: "16px 20px",
                              textAlign: "right",
                              borderBottom:
                                "1px solid var(--p-color-border-secondary)",
                            }}
                          >
                            {formatCurrency(row.revenue)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                How this test runs
              </Text>
              <Text as="p" tone="subdued">
                Live visitors are assigned once per session. Variant B uses the
                selected template suffix through Shopify's view parameter.
              </Text>
              <Text as="p" tone="subdued">
                The storefront runtime is local in the theme extension until you
                deploy the extension update.
              </Text>
              <Link to="/app/ab-tests">Back to all tests</Link>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
      <AbTestDetailReport
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        test={test}
        stats={stats}
      />
      <AppBridgeModal
        id="ab-test-detail-report"
        open={false}
        variant="max"
        onHide={() => setDetailsOpen(false)}
      >
        <TitleBar title="A/B test detail report" />
        <div
          style={{
            minHeight: "calc(100vh - 72px)",
            background: "var(--p-color-bg)",
            padding: "28px",
          }}
        >
          <div style={{ maxWidth: 1280, margin: "0 auto" }}>
            <BlockStack gap="500">
              <InlineStack align="space-between" blockAlign="start" gap="400">
                <BlockStack gap="200">
                  <Text as="h1" variant="heading2xl">
                    {test.name}
                  </Text>
                  <InlineStack gap="200" blockAlign="center" wrap>
                    <Badge tone={statusTone(test.status)}>
                      {test.status.toLowerCase()}
                    </Badge>
                    <Badge>
                      {PAGE_TYPE_LABELS[test.targetPageType] ||
                        test.targetPageType}
                    </Badge>
                    <Badge>
                      {test.goal.replaceAll("_", " ").toLowerCase()}
                    </Badge>
                    <Text as="span" tone="subdued">
                      {test.trafficSplit}/{100 - test.trafficSplit} traffic
                      split
                    </Text>
                  </InlineStack>
                </BlockStack>
                <Button onClick={() => setDetailsOpen(false)}>Close</Button>
              </InlineStack>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Visitor breakdown
                  </Text>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: 12,
                    }}
                  >
                    <MetricTile
                      label="Assigned visitors"
                      value={totals.assignedVisitors.toLocaleString()}
                      caption="All A/B assignments"
                    />
                    <MetricTile
                      label="Real visitors"
                      value={totals.realVisitors.toLocaleString()}
                      caption="Human sessions counted"
                    />
                    <MetricTile
                      label="Zombies"
                      value={totals.zombies.toLocaleString()}
                      caption="Unengaged traffic"
                    />
                    <MetricTile
                      label="Bots"
                      value={totals.bots.toLocaleString()}
                      caption="Automated traffic"
                    />
                  </div>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Engagement and conversion metrics
                  </Text>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: 12,
                    }}
                  >
                    <MetricTile
                      label="ATC rate"
                      value={formatPercent(totals.addToCartRate)}
                      caption={`${totals.addToCarts.toLocaleString()} add-to-carts`}
                    />
                    <MetricTile
                      label="CVR"
                      value={formatPercent(totals.conversionRate)}
                      caption={`${totals.orders.toLocaleString()} orders`}
                    />
                    <MetricTile
                      label="Revenue"
                      value={formatCurrency(totals.revenue)}
                      caption="Attributed order value"
                    />
                    <MetricTile
                      label="RPV"
                      value={formatCurrency(totals.revenuePerVisitor)}
                      caption="Revenue per real visitor"
                    />
                    <MetricTile
                      label="Scroll depth"
                      value={formatPercent(totals.avgScrollDepth)}
                      caption="Average page reach"
                    />
                    <MetricTile
                      label="Duration"
                      value={formatDuration(totals.avgTimeOnPage)}
                      caption="Average time on page"
                    />
                    <MetricTile
                      label="CTA clicks"
                      value={totals.ctaClicks.toLocaleString()}
                      caption={`${formatPercent(totals.ctaClickRate)} per real visitor`}
                    />
                  </div>
                </BlockStack>
              </Card>

              <Card padding="0">
                <div style={{ padding: "16px 20px" }}>
                  <Text as="h2" variant="headingMd">
                    Variant comparison
                  </Text>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      minWidth: 1080,
                      borderCollapse: "collapse",
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          background: "var(--p-color-bg-surface-secondary)",
                        }}
                      >
                        {[
                          "Variant",
                          "Assigned",
                          "Real",
                          "ATC",
                          "CVR",
                          "Orders",
                          "Revenue",
                          "Scroll",
                          "Duration",
                          "CTA",
                        ].map((heading) => (
                          <th
                            key={heading}
                            style={{
                              padding: "12px 20px",
                              textAlign:
                                heading === "Variant" ? "left" : "right",
                              borderTop:
                                "1px solid var(--p-color-border-secondary)",
                              borderBottom:
                                "1px solid var(--p-color-border-secondary)",
                            }}
                          >
                            <Text
                              as="span"
                              tone="subdued"
                              fontWeight="semibold"
                            >
                              {heading}
                            </Text>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stats.map((row) => (
                        <tr key={row.variantId}>
                          <td
                            style={{
                              padding: "16px 20px",
                              borderBottom:
                                "1px solid var(--p-color-border-secondary)",
                            }}
                          >
                            <BlockStack gap="050">
                              <Text as="span" fontWeight="semibold">
                                {row.key} · {row.name}
                              </Text>
                              <Text as="span" tone="subdued">
                                {row.templateSuffix
                                  ? `${row.templateName} · ?view=${row.templateSuffix}`
                                  : row.templateName}
                              </Text>
                            </BlockStack>
                          </td>
                          <td
                            style={{
                              padding: "16px 20px",
                              textAlign: "right",
                              borderBottom:
                                "1px solid var(--p-color-border-secondary)",
                            }}
                          >
                            {row.assignedVisitors.toLocaleString()}
                          </td>
                          <td
                            style={{
                              padding: "16px 20px",
                              textAlign: "right",
                              borderBottom:
                                "1px solid var(--p-color-border-secondary)",
                            }}
                          >
                            {row.realVisitors.toLocaleString()}
                          </td>
                          <td
                            style={{
                              padding: "16px 20px",
                              textAlign: "right",
                              borderBottom:
                                "1px solid var(--p-color-border-secondary)",
                            }}
                          >
                            {formatPercent(row.addToCartRate)}
                          </td>
                          <td
                            style={{
                              padding: "16px 20px",
                              textAlign: "right",
                              borderBottom:
                                "1px solid var(--p-color-border-secondary)",
                            }}
                          >
                            {formatPercent(row.conversionRate)}
                          </td>
                          <td
                            style={{
                              padding: "16px 20px",
                              textAlign: "right",
                              borderBottom:
                                "1px solid var(--p-color-border-secondary)",
                            }}
                          >
                            {row.orders.toLocaleString()}
                          </td>
                          <td
                            style={{
                              padding: "16px 20px",
                              textAlign: "right",
                              borderBottom:
                                "1px solid var(--p-color-border-secondary)",
                            }}
                          >
                            {formatCurrency(row.revenue)}
                          </td>
                          <td
                            style={{
                              padding: "16px 20px",
                              textAlign: "right",
                              borderBottom:
                                "1px solid var(--p-color-border-secondary)",
                            }}
                          >
                            {formatPercent(row.avgScrollDepth)}
                          </td>
                          <td
                            style={{
                              padding: "16px 20px",
                              textAlign: "right",
                              borderBottom:
                                "1px solid var(--p-color-border-secondary)",
                            }}
                          >
                            {formatDuration(row.avgTimeOnPage)}
                          </td>
                          <td
                            style={{
                              padding: "16px 20px",
                              textAlign: "right",
                              borderBottom:
                                "1px solid var(--p-color-border-secondary)",
                            }}
                          >
                            {formatPercent(row.ctaClickRate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
                  gap: 20,
                }}
              >
                {stats.map((row) => (
                  <VariantDetailCard key={row.variantId} row={row} />
                ))}
              </div>
            </BlockStack>
          </div>
        </div>
      </AppBridgeModal>
    </Page>
  );
}
