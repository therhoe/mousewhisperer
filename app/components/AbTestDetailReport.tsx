import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useFetcher } from "@remix-run/react";
import { Modal as AppBridgeModal, TitleBar } from "@shopify/app-bridge-react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Tabs,
  Text,
} from "@shopify/polaris";
import type {
  AbTestTrendPoint,
  SourceQualityRow,
} from "../utils/ab-test-report";
import type {
  ImageEngagementItem,
  EngagementOutcomes,
} from "../utils/click-engagement";
import { EngagementOutcomesView } from "./EngagementOutcomes";
import { useI18n } from "../utils/i18n";

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
  audience?: "all" | "active";
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
  trend?: AbTestTrendPoint[];
  imageEngagement?: ImageEngagementItem[];
  engagementOutcomes?: EngagementOutcomes;
  sourceQualityBreakdown?: SourceQualityRow[];
  testedPages?: BreakdownItem[];
  scopePageCount?: number;
  linkClickCount?: number;
  bodyCtaClickCount?: number;
  bodyCtaSessionCount?: number;
  bodyCtaCtrRate?: number;
  productClickCount?: number;
  productClickSessionCount?: number;
  productCtrRate?: number;
  scroll50Count?: number;
  scroll50Rate?: number;
  scroll100Count?: number;
  scroll100Rate?: number;
  anyLinkOrButtonClickCount?: number;
  anyLinkOrButtonClickSessionCount?: number;
  anyClickCtrRate?: number;
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
  const labels: Record<string, string> = {
    CONVERSION: "Conversion rate",
    REVENUE: "Revenue per visitor",
    ADD_TO_CART: "Add-to-cart rate",
    CLICK_THROUGH: "Clickthrough rate",
    ENGAGEMENT: "Engagement",
  };
  if (labels[goal]) return labels[goal];
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

type TrendMetricKey =
  | "conversionRate"
  | "addToCartRate"
  | "revenuePerVisitor"
  | "ctaClickRate"
  | "avgScrollDepth";

function trendMetric(goal: string): {
  key: TrendMetricKey;
  label: string;
  format: (value: number) => string;
} {
  if (goal === "REVENUE") {
    return {
      key: "revenuePerVisitor",
      label: "Revenue per visitor",
      format: (value) => formatCurrency(value),
    };
  }
  if (goal === "ADD_TO_CART") {
    return {
      key: "addToCartRate",
      label: "Add-to-cart rate",
      format: (value) => formatPercent(value),
    };
  }
  if (goal === "CLICK_THROUGH") {
    return {
      key: "ctaClickRate",
      label: "Clickthrough rate",
      format: (value) => formatPercent(value),
    };
  }
  if (goal === "ENGAGEMENT") {
    return {
      key: "avgScrollDepth",
      label: "Average scroll depth",
      format: (value) => formatPercent(value),
    };
  }
  return {
    key: "conversionRate",
    label: "Conversion rate",
    format: (value) => formatPercent(value),
  };
}

function formatTrendDate(value: string, includeYear = false) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  });
}

function AbTestTrendChart({
  stats,
  goal,
}: {
  stats: AbTestReportStatsRow[];
  goal: string;
}) {
  const { t } = useI18n();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const metric = trendMetric(goal);
  const dates = Array.from(
    new Set(
      stats.flatMap((row) => (row.trend || []).map((point) => point.date)),
    ),
  ).sort();
  const series = stats
    .map((row) => ({
      key: row.key,
      name: row.name,
      color: row.key === "A" ? "#2563EB" : "#7C3AED",
      values: dates.map((date) => {
        const point = row.trend?.find((entry) => entry.date === date);
        return point && point.visitors > 0 ? point[metric.key] : null;
      }),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
  const values = series.flatMap((row) =>
    row.values.filter((value): value is number => value !== null),
  );

  if (!dates.length || !values.length) {
    return (
      <Card>
        <BlockStack gap="150">
          <Text as="h2" variant="headingMd">
            {t("{metric} over time", { metric: t(metric.label) })}
          </Text>
          <Text as="p" tone="subdued">
            {t("The A/B lines will appear after sessions are assigned.")}
          </Text>
        </BlockStack>
      </Card>
    );
  }

  const width = 920;
  const height = 270;
  const left = 58;
  const right = width - 18;
  const top = 18;
  const bottom = height - 42;
  const maximum = Math.max(...values, 0);
  const ceiling = maximum > 0 ? maximum * 1.12 : 1;
  const x = (index: number) =>
    dates.length === 1
      ? (left + right) / 2
      : left + (index / (dates.length - 1)) * (right - left);
  const y = (value: number) => bottom - (value / ceiling) * (bottom - top);
  const pathFor = (points: Array<number | null>) => {
    let path = "";
    points.forEach((value, index) => {
      if (value === null) return;
      path += `${path ? " L" : "M"} ${x(index)} ${y(value)}`;
    });
    return path;
  };
  const activeIndex = hoveredIndex ?? dates.length - 1;
  const tickIndexes = Array.from(
    new Set(
      Array.from({ length: Math.min(5, dates.length) }, (_, index) =>
        Math.round(
          (index / Math.max(1, Math.min(5, dates.length) - 1)) *
            (dates.length - 1),
        ),
      ),
    ),
  );

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" gap="300">
          <BlockStack gap="050">
            <Text as="h2" variant="headingMd">
              {t("{metric} over time", { metric: t(metric.label) })}
            </Text>
            <Text as="p" tone="subdued">
              {t("Cumulative result for visitors assigned to each variant.")}
            </Text>
          </BlockStack>
          <InlineStack gap="300" wrap>
            {series.map((row) => (
              <InlineStack key={row.key} gap="100" blockAlign="center">
                <span
                  aria-hidden="true"
                  style={{
                    width: 12,
                    height: 3,
                    borderRadius: 999,
                    background: row.color,
                  }}
                />
                <Text as="span" tone="subdued">
                  {row.key} · {row.name}
                </Text>
              </InlineStack>
            ))}
          </InlineStack>
        </InlineStack>

        <div
          style={{
            border: "1px solid var(--p-color-border-secondary)",
            borderRadius: 10,
            padding: "12px 12px 4px",
            background: "var(--p-color-bg-surface-secondary)",
          }}
        >
          <InlineStack align="space-between" blockAlign="center" gap="300">
            <Text as="span" fontWeight="semibold">
              {formatTrendDate(dates[activeIndex], true)}
            </Text>
            <InlineStack gap="300" wrap>
              {series.map((row) => {
                const value = row.values[activeIndex];
                return (
                  <Text key={row.key} as="span" tone="subdued">
                    {row.key} {value === null ? "—" : metric.format(value)}
                  </Text>
                );
              })}
            </InlineStack>
          </InlineStack>
          <div style={{ overflowX: "auto" }}>
            <svg
              viewBox={`0 0 ${width} ${height}`}
              width="100%"
              height="270"
              preserveAspectRatio="none"
              role="img"
              aria-label={t("{metric} for Original A and Variant B over time", {
                metric: t(metric.label),
              })}
              style={{ display: "block", minWidth: 620 }}
              onPointerMove={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                const plotX =
                  ((event.clientX - bounds.left) / bounds.width) * width;
                const index = Math.round(
                  ((plotX - left) / (right - left)) * (dates.length - 1),
                );
                setHoveredIndex(Math.max(0, Math.min(dates.length - 1, index)));
              }}
              onPointerLeave={() => setHoveredIndex(null)}
            >
              <title>
                {t("{metric} for Original A and Variant B over time", {
                  metric: t(metric.label),
                })}
              </title>
              {Array.from({ length: 5 }, (_, index) => {
                const value = (ceiling * index) / 4;
                return (
                  <g key={index}>
                    <line
                      x1={left}
                      x2={right}
                      y1={y(value)}
                      y2={y(value)}
                      stroke="var(--p-color-border)"
                    />
                    <text
                      x={left - 8}
                      y={y(value) + 4}
                      textAnchor="end"
                      fontSize="11"
                      fill="var(--p-color-text-secondary)"
                    >
                      {metric.format(value)}
                    </text>
                  </g>
                );
              })}
              {tickIndexes.map((index) => (
                <text
                  key={dates[index]}
                  x={x(index)}
                  y={height - 14}
                  textAnchor={
                    index === 0
                      ? "start"
                      : index === dates.length - 1
                        ? "end"
                        : "middle"
                  }
                  fontSize="11"
                  fill="var(--p-color-text-secondary)"
                >
                  {formatTrendDate(dates[index])}
                </text>
              ))}
              {series.map((row) => (
                <g key={row.key}>
                  <path
                    d={pathFor(row.values)}
                    fill="none"
                    stroke={row.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  {row.values.map((value, index) =>
                    value === null || index !== activeIndex ? null : (
                      <circle
                        key={dates[index]}
                        cx={x(index)}
                        cy={y(value)}
                        r="5"
                        fill={row.color}
                        stroke="white"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                      />
                    ),
                  )}
                </g>
              ))}
              <line
                x1={x(activeIndex)}
                x2={x(activeIndex)}
                y1={top}
                y2={bottom}
                stroke="var(--p-color-border-emphasis)"
                strokeDasharray="4 4"
              />
            </svg>
          </div>
        </div>

        <details>
          <summary
            style={{
              cursor: "pointer",
              fontWeight: 600,
              padding: "4px 0",
            }}
          >
            {t("View chart data")}
          </summary>
          <div style={{ overflowX: "auto", paddingTop: 8 }}>
            <table
              style={{
                width: "100%",
                minWidth: 480,
                borderCollapse: "collapse",
              }}
            >
              <caption
                style={{
                  paddingBottom: 8,
                  textAlign: "left",
                  color: "var(--p-color-text-secondary)",
                }}
              >
                {t("Cumulative {metric} by variant", {
                  metric: t(metric.label),
                })}
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      borderBottom: "1px solid var(--p-color-border-secondary)",
                    }}
                  >
                    {t("Date")}
                  </th>
                  {series.map((row) => (
                    <th
                      key={row.key}
                      scope="col"
                      style={{
                        padding: "8px 12px",
                        textAlign: "right",
                        borderBottom:
                          "1px solid var(--p-color-border-secondary)",
                      }}
                    >
                      {row.key} · {row.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dates.map((date, index) => (
                  <tr key={date}>
                    <th
                      scope="row"
                      style={{
                        padding: "8px 12px",
                        textAlign: "left",
                        fontWeight: 500,
                        borderBottom:
                          "1px solid var(--p-color-border-secondary)",
                      }}
                    >
                      {formatTrendDate(date, true)}
                    </th>
                    {series.map((row) => {
                      const value = row.values[index];
                      return (
                        <td
                          key={row.key}
                          style={{
                            padding: "8px 12px",
                            textAlign: "right",
                            whiteSpace: "nowrap",
                            borderBottom:
                              "1px solid var(--p-color-border-secondary)",
                          }}
                        >
                          {value === null ? "—" : metric.format(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </BlockStack>
    </Card>
  );
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
    <BlockStack gap="200">
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

function VisitorQualityBar({ row }: { row: AbTestReportStatsRow }) {
  const { t } = useI18n();
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
          {t("Real")} {row.realVisitors.toLocaleString()}
        </Text>
        <Text as="span" tone="subdued">
          {t("Zombies")} {row.zombies.toLocaleString()}
        </Text>
        <Text as="span" tone="subdued">
          {t("Bots")} {row.bots.toLocaleString()}
        </Text>
        {row.pending ? (
          <Text as="span" tone="subdued">
            {t("Pending")} {row.pending.toLocaleString()}
          </Text>
        ) : null}
      </InlineStack>
    </BlockStack>
  );
}

function TrafficQualityTable({
  rows,
  showPercentages,
  onTogglePercentages,
}: {
  rows: SourceQualityRow[];
  showPercentages: boolean;
  onTogglePercentages: () => void;
}) {
  const { t } = useI18n();
  const [showClassification, setShowClassification] = useState(false);
  const countWithRate = (count: number, rate: number) =>
    showPercentages
      ? `${count.toLocaleString()} (${formatPercent(rate, 0)})`
      : count.toLocaleString();

  return (
    <section>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center" gap="300">
          <BlockStack gap="050">
            <Text as="h3" variant="headingMd">
              {t("Traffic by source")}
            </Text>
            <Text as="p" tone="subdued">
              {t("Session quality and conversion for this variant only.")}
            </Text>
          </BlockStack>
          <InlineStack gap="200">
            <Button
              size="slim"
              onClick={() => setShowClassification((value) => !value)}
            >
              {t(
                showClassification
                  ? "Hide classification"
                  : "Show classification",
              )}
            </Button>
            <Button size="slim" onClick={onTogglePercentages}>
              {t(showPercentages ? "Hide percentages" : "Show percentages")}
            </Button>
          </InlineStack>
        </InlineStack>
        {!rows.length ? (
          <Text as="p" tone="subdued">
            {t("No source data captured for this variant yet.")}
          </Text>
        ) : (
          <div
            style={{
              overflowX: "auto",
              border: "1px solid var(--p-color-border-secondary)",
              borderRadius: 10,
            }}
          >
            <table
              style={{
                width: "100%",
                minWidth: showClassification
                  ? showPercentages
                    ? 1120
                    : 960
                  : 680,
                borderCollapse: "collapse",
              }}
            >
              <thead>
                <tr
                  style={{ background: "var(--p-color-bg-surface-secondary)" }}
                >
                  {[
                    "Source",
                    "Sessions",
                    ...(showClassification ? ["Real", "Zombie", "Bot"] : []),
                    "Add to cart",
                    "Conversions",
                    "Avg time",
                    "Avg scroll",
                  ].map((heading) => (
                    <th
                      key={heading}
                      style={{
                        padding: "12px 16px",
                        textAlign: heading === "Source" ? "left" : "right",
                        whiteSpace: "nowrap",
                        borderBottom:
                          "1px solid var(--p-color-border-secondary)",
                      }}
                    >
                      <Text as="span" tone="subdued" fontWeight="semibold">
                        {t(heading)}
                      </Text>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((source) => (
                  <tr key={source.key}>
                    <td style={tableTextCellStyle}>
                      <Text as="span" fontWeight="semibold">
                        {source.label}
                      </Text>
                    </td>
                    <td style={tableNumberCellStyle}>
                      {source.sessions.toLocaleString()}
                    </td>
                    {showClassification ? (
                      <>
                        <td style={tableNumberCellStyle}>
                          {countWithRate(source.real, source.realPercent)}
                        </td>
                        <td style={tableNumberCellStyle}>
                          {countWithRate(source.zombies, source.zombiePercent)}
                        </td>
                        <td style={tableNumberCellStyle}>
                          {countWithRate(source.bots, source.botPercent)}
                        </td>
                      </>
                    ) : null}
                    <td style={tableNumberCellStyle}>
                      {countWithRate(source.addToCarts, source.addToCartRate)}
                    </td>
                    <td style={tableNumberCellStyle}>
                      {countWithRate(source.conversions, source.conversionRate)}
                    </td>
                    <td style={tableNumberCellStyle}>
                      {formatDuration(source.avgTimeOnPage)}
                    </td>
                    <td style={tableNumberCellStyle}>
                      {formatPercent(source.avgScrollDepth, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </BlockStack>
    </section>
  );
}

function VariantImageEngagement({
  items,
  maxClicks,
}: {
  items: ImageEngagementItem[];
  maxClicks: number;
}) {
  const { t } = useI18n();
  return (
    <section>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center" gap="300">
          <BlockStack gap="050">
            <Text as="h3" variant="headingMd">
              {t("Image engagement")}
            </Text>
            <Text as="p" tone="subdued">
              {t("Storefront images clicked by this variant's visitors.")}
            </Text>
          </BlockStack>
          <Text as="span" tone="subdued">
            {items
              .reduce((sum, item) => sum + item.clickCount, 0)
              .toLocaleString()}{" "}
            {t("clicks")}
          </Text>
        </InlineStack>
        {!items.length ? (
          <Text as="p" tone="subdued">
            {t("No image interactions captured for this variant yet.")}
          </Text>
        ) : (
          <div
            aria-label={t("Image engagement thumbnails")}
            style={{
              display: "flex",
              gap: 16,
              overflowX: "auto",
              paddingBottom: 8,
              scrollSnapType: "x proximity",
            }}
          >
            {items.map((item) => (
              <div
                key={item.key}
                style={{
                  minWidth: 220,
                  width: 220,
                  scrollSnapAlign: "start",
                }}
              >
                <div
                  style={{
                    height: 164,
                    position: "relative",
                    border: "1px solid var(--p-color-border-secondary)",
                    borderRadius: 10,
                    overflow: "hidden",
                    background: "var(--p-color-bg-surface-secondary)",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 10,
                      left: 10,
                      zIndex: 1,
                      borderRadius: 8,
                      padding: "4px 9px",
                      background: "white",
                      boxShadow: "0 1px 3px rgba(0,0,0,.14)",
                      fontWeight: 700,
                    }}
                  >
                    {item.clickCount.toLocaleString()}
                  </span>
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt={item.label}
                      loading="lazy"
                      style={{
                        width: "100%",
                        height: "100%",
                        display: "block",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        height: "100%",
                        display: "grid",
                        placeItems: "center",
                        padding: 20,
                        textAlign: "center",
                        color: "var(--p-color-text-secondary)",
                      }}
                    >
                      {t("Image preview unavailable")}
                    </div>
                  )}
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: 5,
                      width: `${maxClicks ? (item.clickCount / maxClicks) * 100 : 0}%`,
                      background: CLICK_CATEGORY_COLORS.Image,
                    }}
                  />
                </div>
                <div style={{ paddingTop: 10 }}>
                  <Text as="p" fontWeight="semibold">
                    {formatPercent(item.sessionPercent)} {t("of sessions")}
                  </Text>
                  <Text as="p" tone="subdued">
                    <span
                      title={item.label}
                      style={{
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.label}
                    </span>
                  </Text>
                  <Text as="p" tone="subdued">
                    {item.sessionCount.toLocaleString()} {t("sessions")}
                    {item.averageClickTimeSeconds !== null
                      ? ` · avg ${formatDuration(
                          item.averageClickTimeSeconds * 1000,
                        )} to click`
                      : ""}
                  </Text>
                </div>
              </div>
            ))}
          </div>
        )}
      </BlockStack>
    </section>
  );
}

function VariantZoneBreakdown({
  zones,
  maxClicks,
}: {
  zones: ClickCategoryBreakdown[];
  maxClicks: number;
}) {
  const { t } = useI18n();
  const visibleZones = zones.filter((zone) => zone.key !== "Image");
  return (
    <section>
      <BlockStack gap="200">
        <BlockStack gap="050">
          <Text as="h3" variant="headingMd">
            {t("Engagement by zone")}
          </Text>
          <Text as="p" tone="subdued">
            {t("Every clicked element uses the same scale across click types.")}
          </Text>
        </BlockStack>
        {!visibleZones.length ? (
          <Text as="p" tone="subdued">
            {t(
              "No button, link, widget, header, or footer clicks captured yet.",
            )}
          </Text>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 16,
            }}
          >
            {visibleZones.map((zone) => {
              const color = CLICK_CATEGORY_COLORS[zone.key] || "#8c9196";
              return (
                <div
                  key={zone.key}
                  style={{
                    border: "1px solid var(--p-color-border-secondary)",
                    borderRadius: 10,
                    padding: 16,
                    background: "var(--p-color-bg-surface)",
                  }}
                >
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="150" blockAlign="center">
                        <span
                          aria-hidden="true"
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background: color,
                          }}
                        />
                        <Text as="h4" variant="headingSm">
                          {zone.label}
                        </Text>
                      </InlineStack>
                      <Text as="span" tone="subdued">
                        {zone.count.toLocaleString()} ·{" "}
                        {formatPercent(zone.percent)}
                      </Text>
                    </InlineStack>
                    <BlockStack gap="150">
                      {(zone.items || []).slice(0, 8).map((item) => (
                        <div key={item.label}>
                          <InlineStack
                            align="space-between"
                            blockAlign="center"
                            gap="200"
                          >
                            <Text as="span">
                              <span
                                title={item.label}
                                style={{
                                  display: "block",
                                  maxWidth: 230,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {item.label}
                              </span>
                            </Text>
                            <Text as="span" tone="subdued">
                              {item.count.toLocaleString()}
                            </Text>
                          </InlineStack>
                          <div
                            aria-hidden="true"
                            style={{
                              height: 6,
                              marginTop: 6,
                              borderRadius: 999,
                              overflow: "hidden",
                              background: "var(--p-color-bg-surface-secondary)",
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                width: `${maxClicks ? (item.count / maxClicks) * 100 : 0}%`,
                                borderRadius: 999,
                                background: color,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </BlockStack>
                  </BlockStack>
                </div>
              );
            })}
          </div>
        )}
      </BlockStack>
    </section>
  );
}

function VariantDetailCard({
  row,
  targetPageType,
}: {
  row: AbTestReportStatsRow;
  targetPageType: string;
}) {
  const { t } = useI18n();
  const [showPercentages, setShowPercentages] = useState(false);
  const [showOutcomes, setShowOutcomes] = useState(false);
  const imageItems = row.imageEngagement || [];
  const zoneItems = row.zoneBreakdown || [];
  const maxClicks = Math.max(
    1,
    ...imageItems.map((item) => item.clickCount),
    ...zoneItems.flatMap((zone) =>
      (zone.items || []).map((item) => item.count),
    ),
  );
  const scopeLabel = PAGE_TYPE_LABELS[targetPageType] || targetPageType;
  const commonMetricTiles = [
    {
      label: t("Sessions in this view"),
      value: row.visitors.toLocaleString(),
      caption: `${row.assignedVisitors.toLocaleString()} total assignments`,
    },
    {
      label: t("Page views"),
      value: row.humanPageViews.toLocaleString(),
      caption: `${row.totalPageViews?.toLocaleString() || "0"} all traffic`,
    },
  ];
  const resourceMetricTiles = (() => {
    if (targetPageType === "COLLECTION") {
      return [
        {
          label: t("Link clicks"),
          value: (row.linkClickCount || 0).toLocaleString(),
          caption: "Tracked link click events",
        },
        {
          label: t("Product click rate"),
          value: formatPercent(row.productCtrRate || 0),
          caption: `${(row.productClickSessionCount || 0).toLocaleString()} visitor sessions · ${(row.productClickCount || 0).toLocaleString()} clicks`,
        },
      ];
    }

    if (targetPageType === "PAGE" || targetPageType === "HOMEPAGE") {
      return [
        {
          label: t("Link clicks"),
          value: (row.linkClickCount || 0).toLocaleString(),
          caption: "Tracked link click events",
        },
        {
          label: t("Body CTA rate"),
          value: formatPercent(row.bodyCtaCtrRate || 0),
          caption: `${(row.bodyCtaSessionCount || 0).toLocaleString()} visitor sessions · ${(row.bodyCtaClickCount || 0).toLocaleString()} clicks`,
        },
      ];
    }

    if (targetPageType === "BLOG") {
      return [
        {
          label: t("50% scroll"),
          value: formatPercent(row.scroll50Rate || 0),
          caption: `${(row.scroll50Count || 0).toLocaleString()} recorded reaches`,
        },
        {
          label: t("100% scroll"),
          value: formatPercent(row.scroll100Rate || 0),
          caption: `${(row.scroll100Count || 0).toLocaleString()} recorded reaches`,
        },
        {
          label: t("Link / button rate"),
          value: formatPercent(row.anyClickCtrRate || 0),
          caption: `${(row.anyLinkOrButtonClickSessionCount || 0).toLocaleString()} visitor sessions · ${(row.anyLinkOrButtonClickCount || 0).toLocaleString()} clicks`,
        },
      ];
    }

    return [];
  })();
  const commerceMetricTiles = [
    {
      label: t("Add to cart"),
      value: formatPercent(row.addToCartRate),
      caption: `${row.addToCarts.toLocaleString()} add-to-carts`,
    },
    {
      label: t("CVR"),
      value: formatPercent(row.conversionRate),
      caption: `${row.orders.toLocaleString()} orders`,
    },
    {
      label: t("Revenue"),
      value: formatCurrency(row.revenue),
      caption: `${formatCurrency(row.revenuePerVisitor)} per real visitor`,
    },
  ];
  const behaviorMetricTiles = [
    {
      label: t("Avg. scroll"),
      value: formatPercent(row.avgScrollDepth),
      caption: "Average page reach",
    },
    {
      label: t("Avg. time"),
      value: formatDuration(row.avgTimeOnPage),
      caption: "Average time on page",
    },
    {
      label: t("Interactions"),
      value: (row.ctaClicks + (row.filterInteractions || 0)).toLocaleString(),
      caption: `${row.ctaClicks.toLocaleString()} tracked clicks`,
    },
  ];
  const metricTiles = [
    ...commonMetricTiles,
    ...resourceMetricTiles,
    ...commerceMetricTiles,
    ...behaviorMetricTiles,
  ];

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
            <InlineStack>
              <Badge tone={row.key === "A" ? "info" : "warning"}>
                {row.key === "A" ? t("Control A") : t("Variant B")}
              </Badge>
            </InlineStack>
            <Text as="h3" variant="headingLg">
              {row.name} {t("snapshot")}
            </Text>
            <Text as="p" tone="subdued">
              {row.templateName}
              {row.templateSuffix ? ` · ?view=${row.templateSuffix}` : ""}
            </Text>
          </BlockStack>
          <Badge>{t("Read-only snapshot")}</Badge>
        </InlineStack>
      </div>
      <div style={{ padding: 20 }}>
        <BlockStack gap="500">
          <div
            style={{
              padding: 14,
              borderRadius: 8,
              background: "var(--p-color-bg-surface-secondary)",
            }}
          >
            <Text as="p" tone="subdued">
              {t("Captured")} {scopeLabel.toLowerCase()}{" "}
              {t(
                "behavior for visitors assigned to this variant during the test",
              )}
              {row.scopePageCount
                ? ` · ${row.scopePageCount.toLocaleString()} captured ${
                    row.scopePageCount === 1 ? "page" : "pages"
                  }`
                : ""}
              .
            </Text>
          </div>
          <details>
            <summary style={{ cursor: "pointer" }}>
              {t("Traffic classification details")}
            </summary>
            <VisitorQualityBar row={row} />
          </details>
          <div style={metricGridStyle(140)}>
            {metricTiles.map((tile) => (
              <MetricTile key={tile.label} {...tile} />
            ))}
          </div>

          <TrafficQualityTable
            rows={row.sourceQualityBreakdown || []}
            showPercentages={showPercentages}
            onTogglePercentages={() =>
              setShowPercentages((current) => !current)
            }
          />

          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingMd">
              {t("Engagement outcomes")}
            </Text>
            <Button
              pressed={showOutcomes}
              onClick={() => setShowOutcomes((value) => !value)}
            >
              {showOutcomes ? t("Hide outcomes") : t("Show outcomes")}
            </Button>
          </InlineStack>
          {showOutcomes ? (
            <EngagementOutcomesView
              data={row.engagementOutcomes}
              totals={Object.fromEntries(
                zoneItems.map((zone) => [zone.key, zone.count]),
              )}
              audience={t("Sessions in this view")}
            />
          ) : (
            <>
              <VariantImageEngagement
                items={imageItems}
                maxClicks={maxClicks}
              />
              <VariantZoneBreakdown zones={zoneItems} maxClicks={maxClicks} />
            </>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 20,
            }}
          >
            <section>
              <BlockStack gap="200">
                <Text as="h4" variant="headingSm">
                  {t("Tested pages")}
                </Text>
                <BreakdownList
                  items={row.testedPages || row.pageBreakdown}
                  emptyLabel="No tested page visits captured yet."
                />
              </BlockStack>
            </section>
            <section>
              <BlockStack gap="200">
                <Text as="h4" variant="headingSm">
                  {t("Devices")}
                </Text>
                <BreakdownList
                  items={row.deviceBreakdown}
                  emptyLabel="No device data captured yet."
                />
              </BlockStack>
            </section>
            <section>
              <BlockStack gap="200">
                <Text as="h4" variant="headingSm">
                  {t("Countries")}
                </Text>
                <BreakdownList
                  items={row.countryBreakdown}
                  emptyLabel="No country data captured yet."
                />
              </BlockStack>
            </section>
            <section>
              <BlockStack gap="200">
                <Text as="h4" variant="headingSm">
                  {t("Exit types")}
                </Text>
                <BreakdownList
                  items={row.exitBreakdown}
                  emptyLabel="No exit data captured yet."
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
  const { t } = useI18n();
  return (
    <Card padding="0">
      <div style={{ padding: "16px 20px" }}>
        <Text as="h2" variant="headingMd">
          {t("Variant comparison")}
        </Text>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            minWidth: 840,
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
                "Sessions in this view",
                "Add to cart",
                "Conversion rate",
                "Orders",
                "Revenue",
                "Revenue / visitor",
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
                  {row.visitors.toLocaleString()}
                </td>
                <td style={tableNumberCellStyle}>
                  {row.addToCarts.toLocaleString()} ·{" "}
                  {formatPercent(row.addToCartRate)}
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
                  {formatCurrency(row.revenuePerVisitor)}
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
  whiteSpace: "nowrap",
};

const tableTextCellStyle: CSSProperties = {
  padding: "16px 20px",
  textAlign: "left",
  borderBottom: "1px solid var(--p-color-border-secondary)",
  whiteSpace: "nowrap",
};

type AbVariantSnapshotResponse = {
  testId: string;
  variantId: string;
  snapshot: AbTestReportStatsRow;
  filterQuery: string;
};

function VariantSnapshotTabs({
  test,
  stats,
  open,
  filterQuery,
}: {
  test: AbTestReportTest;
  stats: AbTestReportStatsRow[];
  open: boolean;
  filterQuery: string;
}) {
  const { t } = useI18n();
  const orderedStats = useMemo(
    () => [...stats].sort((left, right) => left.key.localeCompare(right.key)),
    [stats],
  );
  const [selected, setSelected] = useState(0);
  const [snapshotByVariantId, setSnapshotByVariantId] = useState<
    Record<string, AbTestReportStatsRow>
  >({});
  const [loadingVariantId, setLoadingVariantId] = useState<string | null>(null);
  const requestedVariantIds = useRef(new Set<string>());
  const wasOpen = useRef(open);
  const snapshotFetcher = useFetcher<AbVariantSnapshotResponse>();
  const activeSummary =
    orderedStats[Math.min(selected, orderedStats.length - 1)];
  const activeSnapshot = activeSummary
    ? snapshotByVariantId[activeSummary.variantId]
    : undefined;

  useEffect(() => {
    setSelected(0);
    setSnapshotByVariantId({});
    setLoadingVariantId(null);
    requestedVariantIds.current.clear();
  }, [test.id, filterQuery]);

  useEffect(() => {
    const reopened = open && !wasOpen.current;
    wasOpen.current = open;
    if (!reopened) return;

    setSnapshotByVariantId({});
    requestedVariantIds.current.clear();

    if (!activeSummary) {
      setLoadingVariantId(null);
      return;
    }

    requestedVariantIds.current.add(activeSummary.variantId);
    setLoadingVariantId(activeSummary.variantId);
    snapshotFetcher.load(
      `/app/ab-tests/${test.id}/report?variantId=${encodeURIComponent(
        activeSummary.variantId,
      )}&${filterQuery}&refresh=${Date.now()}`,
    );
  }, [activeSummary, open, snapshotFetcher, test.id, filterQuery]);

  useEffect(() => {
    if (
      !open ||
      !activeSummary ||
      activeSnapshot ||
      loadingVariantId ||
      requestedVariantIds.current.has(activeSummary.variantId)
    ) {
      return;
    }
    requestedVariantIds.current.add(activeSummary.variantId);
    setLoadingVariantId(activeSummary.variantId);
    snapshotFetcher.load(
      `/app/ab-tests/${test.id}/report?variantId=${encodeURIComponent(
        activeSummary.variantId,
      )}&${filterQuery}`,
    );
  }, [
    activeSnapshot,
    activeSummary,
    loadingVariantId,
    open,
    snapshotFetcher,
    test.id,
    filterQuery,
  ]);

  useEffect(() => {
    if (!open || snapshotFetcher.state !== "idle") return;
    if (
      snapshotFetcher.data?.testId === test.id &&
      snapshotFetcher.data.filterQuery === filterQuery
    ) {
      const loadedVariantId = snapshotFetcher.data.variantId;
      setSnapshotByVariantId((current) => ({
        ...current,
        [loadedVariantId]: snapshotFetcher.data!.snapshot,
      }));
      setLoadingVariantId((current) =>
        current === loadedVariantId ? null : current,
      );
    }
  }, [open, snapshotFetcher.data, snapshotFetcher.state, test.id, filterQuery]);

  if (!orderedStats.length) {
    return (
      <Card>
        <Text as="p" tone="subdued">
          {t(
            "Variant snapshots will appear after Original A and Variant B are configured.",
          )}
        </Text>
      </Card>
    );
  }

  const tabs = orderedStats.map((row) => ({
    id: `variant-snapshot-${row.variantId}`,
    content: row.key === "A" ? t("Control A") : t("Variant B"),
    accessibilityLabel: t("{variant} page snapshot", {
      variant: t(row.key === "A" ? "Control A" : "Variant B"),
    }),
    panelID: `variant-snapshot-panel-${row.variantId}`,
  }));
  const failed = Boolean(
    activeSummary &&
    requestedVariantIds.current.has(activeSummary.variantId) &&
    loadingVariantId !== activeSummary.variantId &&
    !activeSnapshot,
  );

  return (
    <Card padding="0">
      <div
        style={{
          padding: "18px 20px 0",
          borderBottom: "1px solid var(--p-color-border-secondary)",
        }}
      >
        <BlockStack gap="200">
          <BlockStack gap="050">
            <Text as="h2" variant="headingLg">
              {t("Variant page snapshots")}
            </Text>
            <Text as="p" tone="subdued">
              {t(
                "Explore behavior inside one variant at a time. These reports use A/B-assigned visits, not blended Page Snapshot traffic.",
              )}
            </Text>
          </BlockStack>
          <Tabs
            tabs={tabs}
            selected={Math.min(selected, tabs.length - 1)}
            onSelect={setSelected}
          />
        </BlockStack>
      </div>
      <div
        id={tabs[Math.min(selected, tabs.length - 1)].panelID}
        role="tabpanel"
        aria-labelledby={tabs[Math.min(selected, tabs.length - 1)].id}
        style={{ padding: 20 }}
      >
        {activeSnapshot ? (
          <VariantDetailCard
            row={activeSnapshot}
            targetPageType={test.targetPageType}
          />
        ) : loadingVariantId === activeSummary?.variantId ? (
          <div aria-live="polite" style={{ padding: "32px 0" }}>
            <BlockStack gap="150" inlineAlign="center">
              <Text as="h3" variant="headingMd">
                {t("Loading")}{" "}
                {activeSummary?.key === "A" ? t("Control A") : t("Variant B")}
              </Text>
              <Text as="p" tone="subdued">
                {t(
                  "Pulling this variant's traffic, engagement, and click data.",
                )}
              </Text>
            </BlockStack>
          </div>
        ) : failed && activeSummary ? (
          <div style={{ padding: "32px 0" }}>
            <BlockStack gap="200" inlineAlign="center">
              <Text as="h3" variant="headingMd">
                {t("Snapshot could not load")}
              </Text>
              <Text as="p" tone="subdued">
                {t("The A/B results above are still available.")}
              </Text>
              <Button
                onClick={() => {
                  requestedVariantIds.current.delete(activeSummary.variantId);
                  requestedVariantIds.current.add(activeSummary.variantId);
                  setLoadingVariantId(activeSummary.variantId);
                  snapshotFetcher.load(
                    `/app/ab-tests/${test.id}/report?variantId=${encodeURIComponent(
                      activeSummary.variantId,
                    )}&${filterQuery}`,
                  );
                }}
              >
                {t("Retry snapshot")}
              </Button>
            </BlockStack>
          </div>
        ) : null}
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
  filterQuery = "audience=active&source=&medium=&campaign=",
}: {
  open: boolean;
  onClose: () => void;
  test: AbTestReportTest;
  stats: AbTestReportStatsRow[];
  loading?: boolean;
  filterQuery?: string;
}) {
  const { t } = useI18n();
  const totalRealVisitors = useMemo(
    () => stats.reduce((sum, row) => sum + row.visitors, 0),
    [stats],
  );
  const summary = useMemo(() => {
    const control = stats.find((row) => row.key === "A") || stats[0];
    const variant = stats.find((row) => row.key === "B") || stats[1];

    if (!control || !variant) {
      return {
        title: t("Needs both variants"),
        description: t(
          "This report needs an Original (A) and Variant (B) row before it can compare performance.",
        ),
        badge: t("Incomplete"),
        badgeTone: "warning" as const,
        metricLabel: t("Primary goal"),
        controlLabel: "-",
        variantLabel: "-",
        differenceLabel: "-",
        sampleLabel: `${totalRealVisitors.toLocaleString()} sessions`,
      };
    }

    const controlMetric = primaryGoalMetric(control, test.goal);
    const variantMetric = primaryGoalMetric(variant, test.goal);
    const difference = variantMetric.value - controlMetric.value;
    const hasEnoughSignal =
      totalRealVisitors >= MIN_VISITORS_FOR_SUMMARY &&
      control.visitors >= MIN_VISITORS_PER_VARIANT_FOR_SUMMARY &&
      variant.visitors >= MIN_VISITORS_PER_VARIANT_FOR_SUMMARY;
    const sampleLabel = `A ${control.visitors.toLocaleString()} · B ${variant.visitors.toLocaleString()}`;

    if (
      new URLSearchParams(filterQuery).get("source") ||
      new URLSearchParams(filterQuery).get("medium") ||
      new URLSearchParams(filterQuery).get("campaign") ||
      new URLSearchParams(filterQuery).get("audience") === "active"
    ) {
      return {
        title: t("Filtered comparison"),
        description: t(
          "Filtered comparisons are exploratory. Do not treat a selected segment as proof of overall test lift.",
        ),
        badge: t("Exploratory"),
        badgeTone: "info" as const,
        metricLabel: t(controlMetric.label),
        controlLabel: controlMetric.formatted,
        variantLabel: variantMetric.formatted,
        differenceLabel: formatGoalDifference(
          difference,
          controlMetric.difference,
        ),
        sampleLabel,
      };
    }

    if (!hasEnoughSignal) {
      return {
        title:
          test.status === "ENDED" ? t("Inconclusive") : t("Collecting data"),
        description: t(
          "Need at least {total} sessions total and {perVariant} per variant for an early comparison. This is not a statistical significance test.",
          {
            total: MIN_VISITORS_FOR_SUMMARY,
            perVariant: MIN_VISITORS_PER_VARIANT_FOR_SUMMARY,
          },
        ),
        badge: t(test.status === "ENDED" ? "No winner" : "Too early"),
        badgeTone: "warning" as const,
        metricLabel: t(controlMetric.label),
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
        title: t("No clear lift"),
        description: t(
          "A and B are performing nearly the same on the primary goal.",
        ),
        badge: t("Tied"),
        badgeTone: undefined,
        metricLabel: t(controlMetric.label),
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
      title: t("{variant} is leading", { variant: winner.key }),
      description: t(
        "{variant} is ahead on {metric}. Keep monitoring until the sample size is large enough for a final decision.",
        { variant: winner.name, metric: t(controlMetric.label) },
      ),
      badge: t(variantLeading ? "B ahead" : "A ahead"),
      badgeTone: variantLeading ? ("success" as const) : ("critical" as const),
      metricLabel: t(controlMetric.label),
      controlLabel: controlMetric.formatted,
      variantLabel: variantMetric.formatted,
      differenceLabel: formatGoalDifference(
        difference,
        controlMetric.difference,
      ),
      sampleLabel,
    };
  }, [stats, test.goal, test.status, totalRealVisitors, filterQuery, t]);

  return (
    <AppBridgeModal
      id={`ab-test-detail-report-${test.id}`}
      open={open}
      variant="max"
      onHide={onClose}
    >
      <TitleBar title={t("A/B test detail report")} />
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
                    {test.trafficSplit}/{100 - test.trafficSplit}{" "}
                    {t("traffic split")}
                  </Text>
                  {test.themeName ? (
                    <Text as="span" tone="subdued">
                      {test.themeName} {t("theme")}
                    </Text>
                  ) : null}
                </InlineStack>
              </BlockStack>
              <Button onClick={onClose}>{t("Close")}</Button>
            </InlineStack>

            {loading ? (
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    {t("Loading full A/B report")}
                  </Text>
                  <Text as="p" tone="subdued">
                    {t(
                      "Pulling visitor quality, engagement, conversion, and page breakdown data for this test.",
                    )}
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
                        <InlineStack gap="200" blockAlign="center" wrap>
                          <Text as="h2" variant="headingLg">
                            {summary.title}
                          </Text>
                          <Badge tone={summary.badgeTone}>
                            {summary.badge}
                          </Badge>
                        </InlineStack>
                        <Text as="p" tone="subdued">
                          {t("A/B test result")}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100" align="end">
                        <Badge tone="info">{t(goalLabel(test.goal))}</Badge>
                        <Text as="span" tone="subdued">
                          {t("Primary goal:")} {summary.metricLabel}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    <div style={metricGridStyle(190)}>
                      <SummaryStat
                        label={t("Original (A)")}
                        value={summary.controlLabel}
                        caption="Primary metric"
                      />
                      <SummaryStat
                        label={t("Variant (B)")}
                        value={summary.variantLabel}
                        caption="Primary metric"
                      />
                      <SummaryStat
                        label={t("B vs A")}
                        value={summary.differenceLabel}
                        caption="Primary goal difference"
                      />
                      <SummaryStat
                        label={t("Sample")}
                        value={totalRealVisitors.toLocaleString()}
                        caption={summary.sampleLabel}
                      />
                    </div>
                    <Text as="p" tone="subdued">
                      {summary.description}
                    </Text>
                  </BlockStack>
                </Card>

                <AbTestTrendChart stats={stats} goal={test.goal} />

                <VariantComparisonTable stats={stats} />

                <VariantSnapshotTabs
                  key={`${test.id}:${filterQuery}`}
                  test={test}
                  stats={stats}
                  open={open}
                  filterQuery={filterQuery}
                />
              </>
            )}
          </BlockStack>
        </div>
      </div>
    </AppBridgeModal>
  );
}
