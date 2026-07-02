import { useMemo, type CSSProperties } from "react";
import { Modal as AppBridgeModal, TitleBar } from "@shopify/app-bridge-react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Text,
} from "@shopify/polaris";

const PAGE_TYPE_LABELS: Record<string, string> = {
  PRODUCT: "Product page",
  COLLECTION: "Collection page",
  PAGE: "Page",
  BLOG: "Blog page",
  HOMEPAGE: "Homepage",
  CART: "Cart",
};

const MIN_VISITORS_FOR_SUMMARY = 100;
const MIN_VISITORS_PER_VARIANT_FOR_SUMMARY = 20;

type BreakdownItem = {
  key: string;
  label: string;
  count: number;
  percent: number;
};

export type AbTestReportStatsRow = {
  variantId: string;
  key: string;
  name: string;
  templateName: string;
  templateSuffix: string | null;
  assignedVisitors: number;
  visitors: number;
  realVisitors: number;
  humanPageViews: number;
  zombies: number;
  bots: number;
  pending: number;
  addToCarts: number;
  addToCartRate: number;
  conversionRate: number;
  conversions: number;
  orders: number;
  revenue: number;
  revenuePerVisitor: number;
  avgTimeOnPage: number;
  avgScrollDepth: number;
  ctaClicks: number;
  ctaClickRate: number;
  searches?: number;
  filterInteractions?: number;
  exits?: number;
  sourceBreakdown: BreakdownItem[];
  pageBreakdown: BreakdownItem[];
  deviceBreakdown?: BreakdownItem[];
  countryBreakdown?: BreakdownItem[];
  exitBreakdown?: BreakdownItem[];
};

export type AbTestReportTest = {
  id: string;
  name: string;
  status: string;
  targetPageType: string;
  goal: string;
  trafficSplit: number;
  themeName?: string | null;
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

function primaryGoalMetric(row: AbTestReportStatsRow, goal: string) {
  if (goal === "REVENUE") {
    return {
      label: "Revenue per visitor",
      value: row.revenuePerVisitor,
      formatted: formatCurrency(row.revenuePerVisitor),
      difference: "currency" as const,
    };
  }

  if (goal === "ADD_TO_CART") {
    return {
      label: "Add-to-cart rate",
      value: row.addToCartRate,
      formatted: formatPercent(row.addToCartRate),
      difference: "percentagePoint" as const,
    };
  }

  if (goal === "CLICK_THROUGH") {
    return {
      label: "Clickthrough rate",
      value: row.ctaClickRate,
      formatted: formatPercent(row.ctaClickRate),
      difference: "percentagePoint" as const,
    };
  }

  if (goal === "ENGAGEMENT") {
    return {
      label: "Scroll depth",
      value: row.avgScrollDepth,
      formatted: formatPercent(row.avgScrollDepth),
      difference: "percentagePoint" as const,
    };
  }

  return {
    label: "Conversion rate",
    value: row.conversionRate,
    formatted: formatPercent(row.conversionRate),
    difference: "percentagePoint" as const,
  };
}

function formatGoalDifference(
  difference: number,
  type: "currency" | "percentagePoint",
) {
  const sign = difference > 0 ? "+" : "";
  if (type === "currency") {
    if (difference < 0) return `-${formatCurrency(Math.abs(difference))}`;
    return `${sign}${formatCurrency(difference)}`;
  }
  return `${sign}${difference.toFixed(1)} pts`;
}

function SummaryStat({
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
        borderRadius: 8,
        border: "1px solid var(--p-color-border-secondary)",
        background: "var(--p-color-bg-surface-secondary)",
      }}
    >
      <BlockStack gap="100">
        <Text as="span" tone="subdued" fontWeight="semibold">
          {label}
        </Text>
        <Text as="p" variant="headingLg">
          {value}
        </Text>
        <Text as="p" tone="subdued">
          {caption}
        </Text>
      </BlockStack>
    </div>
  );
}

function metricGridStyle(minWidth = 170): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}px, 1fr))`,
    gap: 12,
  };
}

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
  items?: BreakdownItem[];
  emptyLabel: string;
}) {
  if (!items?.length) {
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

function VisitorQualityBar({ row }: { row: AbTestReportStatsRow }) {
  const total = row.assignedVisitors || row.realVisitors || 0;
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
        {row.pending ? (
          <Text as="span" tone="subdued">
            Pending {row.pending.toLocaleString()}
          </Text>
        ) : null}
      </InlineStack>
    </BlockStack>
  );
}

function VariantDetailCard({ row }: { row: AbTestReportStatsRow }) {
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
          <div style={metricGridStyle(140)}>
            <MetricTile
              label="Real visitors"
              value={row.realVisitors.toLocaleString()}
              caption={`${row.humanPageViews.toLocaleString()} page views`}
            />
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
            <MetricTile
              label="Interactions"
              value={(
                row.ctaClicks + (row.filterInteractions || 0)
              ).toLocaleString()}
              caption={`${row.ctaClicks.toLocaleString()} CTA clicks`}
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
                  Test entry pages
                </Text>
                <BreakdownList
                  items={row.pageBreakdown}
                  emptyLabel="No page data captured yet."
                />
              </BlockStack>
            </section>
            <section>
              <BlockStack gap="250">
                <Text as="h4" variant="headingSm">
                  Devices
                </Text>
                <BreakdownList
                  items={row.deviceBreakdown}
                  emptyLabel="No device data captured yet."
                />
              </BlockStack>
            </section>
            <section>
              <BlockStack gap="250">
                <Text as="h4" variant="headingSm">
                  Countries
                </Text>
                <BreakdownList
                  items={row.countryBreakdown}
                  emptyLabel="No country data captured yet."
                />
              </BlockStack>
            </section>
          </div>
        </BlockStack>
      </div>
    </Card>
  );
}

export function AbTestDetailReport({
  open,
  onClose,
  test,
  stats,
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  test: AbTestReportTest;
  stats: AbTestReportStatsRow[];
  loading?: boolean;
}) {
  const totals = useMemo(() => {
    const assignedVisitors = stats.reduce(
      (sum, row) => sum + row.assignedVisitors,
      0,
    );
    const realVisitors = stats.reduce((sum, row) => sum + row.realVisitors, 0);
    const humanPageViews = stats.reduce(
      (sum, row) => sum + row.humanPageViews,
      0,
    );
    const zombies = stats.reduce((sum, row) => sum + row.zombies, 0);
    const bots = stats.reduce((sum, row) => sum + row.bots, 0);
    const pending = stats.reduce((sum, row) => sum + row.pending, 0);
    const addToCarts = stats.reduce((sum, row) => sum + row.addToCarts, 0);
    const orders = stats.reduce((sum, row) => sum + row.orders, 0);
    const revenue = stats.reduce((sum, row) => sum + row.revenue, 0);
    const ctaClicks = stats.reduce((sum, row) => sum + row.ctaClicks, 0);
    const searches = stats.reduce((sum, row) => sum + (row.searches || 0), 0);
    const filterInteractions = stats.reduce(
      (sum, row) => sum + (row.filterInteractions || 0),
      0,
    );
    const exits = stats.reduce((sum, row) => sum + (row.exits || 0), 0);
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
      humanPageViews,
      zombies,
      bots,
      pending,
      addToCarts,
      orders,
      revenue,
      ctaClicks,
      searches,
      filterInteractions,
      exits,
      avgTimeOnPage,
      avgScrollDepth,
      addToCartRate: realVisitors ? (addToCarts / realVisitors) * 100 : 0,
      conversionRate: realVisitors ? (orders / realVisitors) * 100 : 0,
      revenuePerVisitor: realVisitors ? revenue / realVisitors : 0,
      ctaClickRate: realVisitors ? (ctaClicks / realVisitors) * 100 : 0,
    };
  }, [stats]);
  const summary = useMemo(() => {
    const control = stats.find((row) => row.key === "A") || stats[0];
    const variant = stats.find((row) => row.key === "B") || stats[1];

    if (!control || !variant) {
      return {
        title: "Needs both variants",
        description:
          "This report needs an Original (A) and Variant (B) row before it can compare performance.",
        badge: "Incomplete",
        badgeTone: "warning" as const,
        metricLabel: "Primary goal",
        controlLabel: "-",
        variantLabel: "-",
        differenceLabel: "-",
        sampleLabel: `${totals.realVisitors.toLocaleString()} real visitors`,
      };
    }

    const controlMetric = primaryGoalMetric(control, test.goal);
    const variantMetric = primaryGoalMetric(variant, test.goal);
    const difference = variantMetric.value - controlMetric.value;
    const hasEnoughSignal =
      totals.realVisitors >= MIN_VISITORS_FOR_SUMMARY &&
      control.realVisitors >= MIN_VISITORS_PER_VARIANT_FOR_SUMMARY &&
      variant.realVisitors >= MIN_VISITORS_PER_VARIANT_FOR_SUMMARY;
    const sampleLabel = `A ${control.realVisitors.toLocaleString()} · B ${variant.realVisitors.toLocaleString()}`;

    if (!hasEnoughSignal) {
      return {
        title: test.status === "ENDED" ? "Inconclusive" : "Collecting data",
        description: `Need at least ${MIN_VISITORS_FOR_SUMMARY.toLocaleString()} real visitors total and ${MIN_VISITORS_PER_VARIANT_FOR_SUMMARY.toLocaleString()} per variant before calling a winner.`,
        badge: test.status === "ENDED" ? "No winner" : "Too early",
        badgeTone: "warning" as const,
        metricLabel: controlMetric.label,
        controlLabel: controlMetric.formatted,
        variantLabel: variantMetric.formatted,
        differenceLabel: formatGoalDifference(
          difference,
          controlMetric.difference,
        ),
        sampleLabel,
      };
    }

    if (Math.abs(difference) < 0.1) {
      return {
        title: "No clear lift",
        description:
          "A and B are performing nearly the same on the primary goal.",
        badge: "Tied",
        badgeTone: undefined,
        metricLabel: controlMetric.label,
        controlLabel: controlMetric.formatted,
        variantLabel: variantMetric.formatted,
        differenceLabel: formatGoalDifference(
          difference,
          controlMetric.difference,
        ),
        sampleLabel,
      };
    }

    const variantLeading = difference > 0;
    const winner = variantLeading ? variant : control;

    return {
      title: `${winner.key} is leading`,
      description: `${winner.name} is ahead on ${controlMetric.label.toLowerCase()}. Keep monitoring until the sample size is large enough for a final decision.`,
      badge: variantLeading ? "B ahead" : "A ahead",
      badgeTone: variantLeading ? ("success" as const) : ("critical" as const),
      metricLabel: controlMetric.label,
      controlLabel: controlMetric.formatted,
      variantLabel: variantMetric.formatted,
      differenceLabel: formatGoalDifference(
        difference,
        controlMetric.difference,
      ),
      sampleLabel,
    };
  }, [stats, test.goal, test.status, totals.realVisitors]);

  return (
    <AppBridgeModal
      id={`ab-test-detail-report-${test.id}`}
      open={open}
      variant="max"
      onHide={onClose}
    >
      <TitleBar title="A/B test detail report" />
      <div
        style={{
          minHeight: "calc(100vh - 72px)",
          background: "var(--p-color-bg)",
          padding: "28px",
        }}
      >
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
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
                  <Badge>{test.goal.replaceAll("_", " ").toLowerCase()}</Badge>
                  <Text as="span" tone="subdued">
                    {test.trafficSplit}/{100 - test.trafficSplit} traffic split
                  </Text>
                  {test.themeName ? (
                    <Text as="span" tone="subdued">
                      {test.themeName} theme
                    </Text>
                  ) : null}
                </InlineStack>
              </BlockStack>
              <Button onClick={onClose}>Close</Button>
            </InlineStack>

            {loading ? (
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Loading full A/B report
                  </Text>
                  <Text as="p" tone="subdued">
                    Pulling visitor quality, engagement, conversion, and page
                    breakdown data for this test.
                  </Text>
                </BlockStack>
              </Card>
            ) : (
              <>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack
                      align="space-between"
                      blockAlign="start"
                      gap="400"
                    >
                      <BlockStack gap="100">
                        <Text as="h2" variant="headingMd">
                          A/B test summary
                        </Text>
                        <Text as="p" tone="subdued">
                          Primary goal: {summary.metricLabel}
                        </Text>
                      </BlockStack>
                      <Badge tone={summary.badgeTone}>{summary.badge}</Badge>
                    </InlineStack>
                    <div
                      style={{
                        padding: 18,
                        borderRadius: 10,
                        background: "var(--p-color-bg-surface-secondary)",
                        border: "1px solid var(--p-color-border-secondary)",
                      }}
                    >
                      <BlockStack gap="150">
                        <Text as="h3" variant="headingLg">
                          {summary.title}
                        </Text>
                        <Text as="p" tone="subdued">
                          {summary.description}
                        </Text>
                      </BlockStack>
                    </div>
                    <div style={metricGridStyle(190)}>
                      <SummaryStat
                        label="Original (A)"
                        value={summary.controlLabel}
                        caption="Primary metric"
                      />
                      <SummaryStat
                        label="Variant (B)"
                        value={summary.variantLabel}
                        caption="Primary metric"
                      />
                      <SummaryStat
                        label="B vs A"
                        value={summary.differenceLabel}
                        caption="Primary goal difference"
                      />
                      <SummaryStat
                        label="Sample"
                        value={totals.realVisitors.toLocaleString()}
                        caption={summary.sampleLabel}
                      />
                    </div>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Visitor breakdown
                    </Text>
                    <div style={metricGridStyle(180)}>
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
                        label="Human page views"
                        value={totals.humanPageViews.toLocaleString()}
                        caption="Tracked A/B page visits"
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
                      <MetricTile
                        label="Pending"
                        value={totals.pending.toLocaleString()}
                        caption="Still being classified"
                      />
                    </div>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Engagement and conversion metrics
                    </Text>
                    <div style={metricGridStyle(180)}>
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
                        caption="Average time on A/B pages"
                      />
                      <MetricTile
                        label="CTA clicks"
                        value={totals.ctaClicks.toLocaleString()}
                        caption={`${formatPercent(totals.ctaClickRate)} per real visitor`}
                      />
                      <MetricTile
                        label="Searches"
                        value={totals.searches.toLocaleString()}
                        caption="Search terms captured"
                      />
                      <MetricTile
                        label="Filter changes"
                        value={totals.filterInteractions.toLocaleString()}
                        caption="Collection filter interactions"
                      />
                      <MetricTile
                        label="Exits"
                        value={totals.exits.toLocaleString()}
                        caption="Exit behavior captured"
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
                        minWidth: 1180,
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
                            "Page views",
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
                              {row.humanPageViews.toLocaleString()}
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
              </>
            )}
          </BlockStack>
        </div>
      </div>
    </AppBridgeModal>
  );
}
