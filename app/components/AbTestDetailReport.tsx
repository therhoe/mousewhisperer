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

type ClickBreakdownItem = {
  label: string;
  count: number;
};

type ClickCategoryBreakdown = BreakdownItem & {
  items?: ClickBreakdownItem[];
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
  totalPageViews?: number;
  humanPageViews: number;
  zombies: number;
  bots: number;
  pending: number;
  addToCarts: number;
  addToCartRate: number;
  checkoutStarts?: number;
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
  zoneBreakdown?: ClickCategoryBreakdown[];
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

function goalLabel(goal: string) {
  return goal
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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

function VisitorStat({
  title,
  value,
  caption,
  color,
}: {
  title: string;
  value: number;
  caption: string;
  color: string;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--p-color-border-secondary)",
        borderLeft: `4px solid ${color}`,
        borderRadius: 8,
        padding: 16,
        background: "var(--p-color-bg-surface)",
        minHeight: 112,
      }}
    >
      <BlockStack gap="100">
        <Text as="span" fontWeight="semibold">
          {title}
        </Text>
        <Text as="p" variant="heading2xl">
          {value.toLocaleString()}
        </Text>
        <Text as="p" tone="subdued">
          {caption}
        </Text>
      </BlockStack>
    </div>
  );
}

function LegendItem({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <InlineStack gap="150" blockAlign="center">
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 3,
          background: color,
          display: "inline-block",
        }}
      />
      <Text as="span">
        {label} <strong>{value}</strong>
      </Text>
    </InlineStack>
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

const CLICK_CATEGORY_COLORS: Record<string, string> = {
  Image: "#0EA5E9",
  Button: "#F59E0B",
  Link: "#10B981",
  Widget: "#8B5CF6",
  Header: "#6366F1",
  Footer: "#64748B",
};

const CLICK_CATEGORY_ORDER = [
  "Image",
  "Button",
  "Link",
  "Widget",
  "Header",
  "Footer",
];

function clickCategoryRank(key: string) {
  const index = CLICK_CATEGORY_ORDER.indexOf(key);
  return index === -1 ? CLICK_CATEGORY_ORDER.length : index;
}

function getZoneCategory(row: AbTestReportStatsRow | undefined, key: string) {
  return row?.zoneBreakdown?.find((item) => item.key === key);
}

function clicksPerVisitor(count: number, visitors: number) {
  return visitors ? count / visitors : 0;
}

function formatClicksPerVisitor(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0 / visitor";
  const absolute = Math.abs(value);
  const formatted = absolute.toFixed(absolute >= 10 ? 1 : 2);
  return `${value < 0 ? "-" : ""}${formatted} / visitor`;
}

function mergeClickedLabels(
  aItems: ClickBreakdownItem[] = [],
  bItems: ClickBreakdownItem[] = [],
) {
  const labels = new Map<string, { label: string; a: number; b: number }>();
  for (const item of aItems) {
    labels.set(item.label, {
      label: item.label,
      a: (labels.get(item.label)?.a || 0) + item.count,
      b: labels.get(item.label)?.b || 0,
    });
  }
  for (const item of bItems) {
    const existing = labels.get(item.label);
    labels.set(item.label, {
      label: item.label,
      a: existing?.a || 0,
      b: (existing?.b || 0) + item.count,
    });
  }
  return Array.from(labels.values())
    .sort((a, b) => b.a + b.b - (a.a + a.b) || a.label.localeCompare(b.label))
    .slice(0, 5);
}

function ClickLabelComparison({
  label,
  a,
  b,
  max,
  color,
}: {
  label: string;
  a: number;
  b: number;
  max: number;
  color: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 64px 64px",
        gap: 12,
        alignItems: "center",
      }}
    >
      <div
        style={{
          position: "relative",
          minHeight: 30,
          borderRadius: 6,
          background: "var(--p-color-bg-surface-secondary)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: "0 auto 0 0",
            width: `${Math.max(((a + b) / max) * 100, a + b ? 4 : 0)}%`,
            background: `${color}24`,
          }}
        />
        <Text as="span">
          <span
            title={label}
            style={{
              position: "relative",
              zIndex: 1,
              display: "block",
              overflow: "hidden",
              padding: "4px 10px",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
        </Text>
      </div>
      <Text as="span" alignment="end" tone={a ? undefined : "subdued"}>
        A {a.toLocaleString()}
      </Text>
      <Text as="span" alignment="end" tone={b ? undefined : "subdued"}>
        B {b.toLocaleString()}
      </Text>
    </div>
  );
}

function ZoneComparisonRow({
  category,
  control,
  variant,
}: {
  category: string;
  control?: AbTestReportStatsRow;
  variant?: AbTestReportStatsRow;
}) {
  const controlCategory = getZoneCategory(control, category);
  const variantCategory = getZoneCategory(variant, category);
  const color = CLICK_CATEGORY_COLORS[category] || "#8c9196";
  const aCount = controlCategory?.count || 0;
  const bCount = variantCategory?.count || 0;
  const aRate = clicksPerVisitor(aCount, control?.realVisitors || 0);
  const bRate = clicksPerVisitor(bCount, variant?.realVisitors || 0);
  const rateDiff = bRate - aRate;
  const maxRate = Math.max(aRate, bRate, 0.01);
  const labels = mergeClickedLabels(controlCategory?.items, variantCategory?.items);
  const maxLabelCount = Math.max(...labels.map((item) => item.a + item.b), 1);
  const diffColor =
    Math.abs(rateDiff) < 0.005
      ? "var(--p-color-text-subdued)"
      : rateDiff > 0
        ? "var(--p-color-text-success)"
        : "var(--p-color-text-critical)";

  return (
    <div
      style={{
        border: "1px solid var(--p-color-border-secondary)",
        borderRadius: 8,
        padding: 16,
        background: "var(--p-color-bg-surface)",
      }}
    >
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start" gap="400">
          <InlineStack gap="200" blockAlign="center">
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: color,
                display: "inline-block",
              }}
            />
            <BlockStack gap="050">
              <Text as="h3" variant="headingMd">
                {category}
              </Text>
              <Text as="p" tone="subdued">
                {(aCount + bCount).toLocaleString()} total clicks
              </Text>
            </BlockStack>
          </InlineStack>
          <div style={{ textAlign: "right" }}>
            <Text as="p" tone="subdued">
              B vs A
            </Text>
            <Text as="p">
              <span style={{ color: diffColor, fontWeight: 700 }}>
                {rateDiff > 0 ? "+" : ""}
                {formatClicksPerVisitor(rateDiff)}
              </span>
            </Text>
          </div>
        </InlineStack>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 16,
          }}
        >
          {[
            { key: "A", row: control, count: aCount, rate: aRate },
            { key: "B", row: variant, count: bCount, rate: bRate },
          ].map((entry) => (
            <div key={entry.key}>
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <Text as="span" fontWeight="semibold">
                  {entry.key} · {entry.row?.name || "Variant"}
                </Text>
                <Text as="span" tone="subdued">
                  {entry.count.toLocaleString()} clicks
                </Text>
              </InlineStack>
              <div
                style={{
                  height: 8,
                  marginTop: 8,
                  borderRadius: 999,
                  background: "var(--p-color-bg-surface-secondary)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${(entry.rate / maxRate) * 100}%`,
                    height: "100%",
                    borderRadius: 999,
                    background:
                      entry.key === "A"
                        ? "var(--p-color-bg-fill-info)"
                        : color,
                  }}
                />
              </div>
              <Text as="p" tone="subdued">
                {formatClicksPerVisitor(entry.rate)} ·{" "}
                {(entry.row?.realVisitors || 0).toLocaleString()} real visitors
              </Text>
            </div>
          ))}
        </div>

        {labels.length ? (
          <BlockStack gap="150">
            <Text as="h4" variant="headingSm" tone="subdued">
              Top clicked elements
            </Text>
            {labels.map((item) => (
              <ClickLabelComparison
                key={item.label}
                label={item.label}
                a={item.a}
                b={item.b}
                max={maxLabelCount}
                color={color}
              />
            ))}
          </BlockStack>
        ) : (
          <Text as="p" tone="subdued">
            No clicked elements captured for this zone yet.
          </Text>
        )}
      </BlockStack>
    </div>
  );
}

function EngagementByZoneComparison({
  stats,
}: {
  stats: AbTestReportStatsRow[];
}) {
  const control = stats.find((row) => row.key === "A") || stats[0];
  const variant = stats.find((row) => row.key === "B") || stats[1];
  const categories = Array.from(
    new Set([
      ...CLICK_CATEGORY_ORDER,
      ...(control?.zoneBreakdown || []).map((item) => item.key),
      ...(variant?.zoneBreakdown || []).map((item) => item.key),
    ]),
  )
    .sort((a, b) => clickCategoryRank(a) - clickCategoryRank(b))
    .filter((category) => {
      const a = getZoneCategory(control, category)?.count || 0;
      const b = getZoneCategory(variant, category)?.count || 0;
      return a + b > 0;
    });

  if (!control || !variant) {
    return (
      <Text as="p" tone="subdued">
        This comparison needs both Original (A) and Variant (B) data.
      </Text>
    );
  }

  if (!categories.length) {
    return (
      <Text as="p" tone="subdued">
        No click zone data captured yet.
      </Text>
    );
  }

  return (
    <BlockStack gap="300">
      {categories.map((category) => (
        <ZoneComparisonRow
          key={category}
          category={category}
          control={control}
          variant={variant}
        />
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

function VariantComparisonTable({ stats }: { stats: AbTestReportStatsRow[] }) {
  return (
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
                "RCC",
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
                    textAlign: heading === "Variant" ? "left" : "right",
                    borderTop: "1px solid var(--p-color-border-secondary)",
                    borderBottom: "1px solid var(--p-color-border-secondary)",
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
            {stats.map((row) => (
              <tr key={row.variantId}>
                <td
                  style={{
                    padding: "16px 20px",
                    borderBottom: "1px solid var(--p-color-border-secondary)",
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
                <td style={tableNumberCellStyle}>
                  {row.assignedVisitors.toLocaleString()}
                </td>
                <td style={tableNumberCellStyle}>
                  {row.realVisitors.toLocaleString()}
                </td>
                <td style={tableNumberCellStyle}>
                  {row.humanPageViews.toLocaleString()}
                </td>
                <td style={tableNumberCellStyle}>
                  {formatPercent(row.addToCartRate)}
                </td>
                <td style={tableNumberCellStyle}>
                  {(row.checkoutStarts || 0).toLocaleString()}
                </td>
                <td style={tableNumberCellStyle}>
                  {formatPercent(row.conversionRate)}
                </td>
                <td style={tableNumberCellStyle}>
                  {row.orders.toLocaleString()}
                </td>
                <td style={tableNumberCellStyle}>
                  {formatCurrency(row.revenue)}
                </td>
                <td style={tableNumberCellStyle}>
                  {formatPercent(row.avgScrollDepth)}
                </td>
                <td style={tableNumberCellStyle}>
                  {formatDuration(row.avgTimeOnPage)}
                </td>
                <td style={tableNumberCellStyle}>
                  {formatPercent(row.ctaClickRate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const tableNumberCellStyle: CSSProperties = {
  padding: "16px 20px",
  textAlign: "right",
  borderBottom: "1px solid var(--p-color-border-secondary)",
};

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
    const totalPageViews = stats.reduce(
      (sum, row) => sum + (row.totalPageViews ?? row.humanPageViews),
      0,
    );
    const zombies = stats.reduce((sum, row) => sum + row.zombies, 0);
    const bots = stats.reduce((sum, row) => sum + row.bots, 0);
    const pending = stats.reduce((sum, row) => sum + row.pending, 0);
    const addToCarts = stats.reduce((sum, row) => sum + row.addToCarts, 0);
    const checkoutStarts = stats.reduce(
      (sum, row) => sum + (row.checkoutStarts || 0),
      0,
    );
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
    const ctaClickRate = realVisitors
      ? stats.reduce(
          (sum, row) => sum + row.ctaClickRate * row.realVisitors,
          0,
        ) / realVisitors
      : 0;

    return {
      assignedVisitors,
      realVisitors,
      totalPageViews,
      humanPageViews,
      zombies,
      bots,
      pending,
      addToCarts,
      checkoutStarts,
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
      ctaClickRate,
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
                      </BlockStack>
                      <BlockStack gap="100" align="end">
                        <Badge tone="info">{goalLabel(test.goal)}</Badge>
                        <Text as="span" tone="subdued">
                          Primary goal: {summary.metricLabel}
                        </Text>
                      </BlockStack>
                    </InlineStack>
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
                    <Text as="p" tone="subdued">
                      {summary.description}
                    </Text>
                  </BlockStack>
                </Card>

                <VariantComparisonTable stats={stats} />

                <Card>
                  <BlockStack gap="300">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">
                        Traffic Breakdown
                      </Text>
                      <Text as="p" tone="subdued">
                        Visitor quality captured across this A/B test.
                      </Text>
                    </BlockStack>
                    <div style={metricGridStyle(180)}>
                      <VisitorStat
                        title="Total visitors"
                        value={totals.assignedVisitors}
                        caption="All assigned sessions"
                        color="#2c6ecb"
                      />
                      <VisitorStat
                        title="Humans"
                        value={totals.realVisitors}
                        caption="Engaged real visitors"
                        color="#008060"
                      />
                      <VisitorStat
                        title="Zombies"
                        value={totals.zombies}
                        caption="Unengaged visitors"
                        color="#8a6116"
                      />
                      <VisitorStat
                        title="Bots"
                        value={totals.bots}
                        caption="Automated / non-human"
                        color="#b5371f"
                      />
                      {totals.pending > 0 ? (
                        <VisitorStat
                          title="Pending"
                          value={totals.pending}
                          caption="Still classifying"
                          color="#8c9196"
                        />
                      ) : null}
                    </div>
                    <div
                      style={{
                        height: 10,
                        borderRadius: 999,
                        overflow: "hidden",
                        display: "flex",
                        background: "#e4e5e7",
                      }}
                    >
                      <div
                        style={{
                          width: `${
                            totals.assignedVisitors
                              ? (totals.realVisitors / totals.assignedVisitors) *
                                100
                              : 0
                          }%`,
                          background: "#008060",
                        }}
                      />
                      <div
                        style={{
                          width: `${
                            totals.assignedVisitors
                              ? (totals.zombies / totals.assignedVisitors) * 100
                              : 0
                          }%`,
                          background: "#8a6116",
                        }}
                      />
                      <div
                        style={{
                          width: `${
                            totals.assignedVisitors
                              ? (totals.bots / totals.assignedVisitors) * 100
                              : 0
                          }%`,
                          background: "#b5371f",
                        }}
                      />
                      {totals.pending > 0 ? (
                        <div
                          style={{
                            width: `${
                              totals.assignedVisitors
                                ? (totals.pending / totals.assignedVisitors) *
                                  100
                                : 0
                            }%`,
                            background: "#8c9196",
                          }}
                        />
                      ) : null}
                    </div>
                    <InlineStack gap="400" wrap>
                      <LegendItem
                        color="#008060"
                        label="Humans"
                        value={`${totals.realVisitors.toLocaleString()} (${formatPercent(
                          totals.assignedVisitors
                            ? (totals.realVisitors / totals.assignedVisitors) *
                                100
                            : 0,
                        )})`}
                      />
                      <LegendItem
                        color="#8a6116"
                        label="Zombies"
                        value={`${totals.zombies.toLocaleString()} (${formatPercent(
                          totals.assignedVisitors
                            ? (totals.zombies / totals.assignedVisitors) * 100
                            : 0,
                        )})`}
                      />
                      <LegendItem
                        color="#b5371f"
                        label="Bots"
                        value={`${totals.bots.toLocaleString()} (${formatPercent(
                          totals.assignedVisitors
                            ? (totals.bots / totals.assignedVisitors) * 100
                            : 0,
                        )})`}
                      />
                    </InlineStack>
                  </BlockStack>
                </Card>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                    gap: 16,
                  }}
                >
                  <Card>
                    <BlockStack gap="300">
                      <Text as="h2" variant="headingMd">
                        Engagement
                      </Text>
                      <div style={metricGridStyle(150)}>
                        <MetricTile
                          label="Scroll"
                          value={formatPercent(totals.avgScrollDepth)}
                          caption="avg. page reach"
                        />
                        <MetricTile
                          label="Duration"
                          value={formatDuration(totals.avgTimeOnPage)}
                          caption="avg. on page"
                        />
                        <MetricTile
                          label="Searches"
                          value={totals.searches.toLocaleString()}
                          caption="sessions"
                        />
                        <MetricTile
                          label="CTR"
                          value={formatPercent(totals.ctaClickRate)}
                          caption="click rate"
                        />
                        <MetricTile
                          label="Filters"
                          value={totals.filterInteractions.toLocaleString()}
                          caption="changes"
                        />
                        <MetricTile
                          label="TPV"
                          value={totals.totalPageViews.toLocaleString()}
                          caption="page views"
                        />
                      </div>
                    </BlockStack>
                  </Card>

                  <Card>
                    <BlockStack gap="300">
                      <Text as="h2" variant="headingMd">
                        Conversions
                      </Text>
                      <div style={metricGridStyle(150)}>
                        <MetricTile
                          label="ATC"
                          value={formatPercent(totals.addToCartRate)}
                          caption="cart rate"
                        />
                        <MetricTile
                          label="RCC"
                          value={totals.checkoutStarts.toLocaleString()}
                          caption="checkout"
                        />
                        <MetricTile
                          label="CVR"
                          value={formatPercent(totals.conversionRate)}
                          caption="conversion"
                        />
                        <MetricTile
                          label="Orders"
                          value={totals.orders.toLocaleString()}
                          caption="placed this test"
                        />
                        <MetricTile
                          label="Revenue"
                          value={formatCurrency(totals.revenue)}
                          caption="attributed revenue"
                        />
                        <MetricTile
                          label="RPV"
                          value={formatCurrency(totals.revenuePerVisitor)}
                          caption="per real visitor"
                        />
                      </div>
                    </BlockStack>
                  </Card>
                </div>

                <Card>
                  <BlockStack gap="300">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">
                        Engagement by zone
                      </Text>
                      <Text as="p" tone="subdued">
                        Compares where visitors interacted in A vs B. Rates are
                        normalized by each variant&apos;s real visitors.
                      </Text>
                    </BlockStack>
                    <EngagementByZoneComparison stats={stats} />
                  </BlockStack>
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
