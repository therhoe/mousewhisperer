import { useEffect, useRef, useState } from "react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Select,
  SkeletonBodyText,
  Text,
} from "@shopify/polaris";
import { useI18n } from "../utils/i18n";
import { useBackgroundJson } from "../utils/background-json";
import type { ConversionProgress } from "../types/conversion-progress";

type Payload = {
  progress: ConversionProgress;
  sales: null | {
    aov: number | null;
    ltv: number | null;
    currency: string | null;
    series: Array<{ date: string; aov: number | null; ltv: number | null }>;
  };
};
const isPayload = (value: unknown): value is Payload =>
  !!value &&
  typeof value === "object" &&
  "progress" in value &&
  !!(value as Payload).progress?.currentSeries;
export function GrowthLineChart({
  points,
  title,
  percent = false,
}: {
  points: Array<{ date: string; value: number | null }>;
  title: string;
  percent?: boolean;
}) {
  const { t, formatDate, formatNumber } = useI18n();
  const valid = points.filter((point) => point.value !== null);
  const hasData = valid.length > 0;
  const chartRef = useRef<SVGSVGElement>(null);
  const [chartWidth, setChartWidth] = useState(960);
  useEffect(() => {
    const chart = chartRef.current;
    if (!hasData || !chart) return;
    const resize = () => {
      const width = chart.getBoundingClientRect().width;
      if (width > 0) setChartWidth(Math.max(300, Math.round(width)));
    };
    resize();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(resize);
      observer.observe(chart);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [hasData]);
  if (!hasData)
    return (
      <Box paddingBlock="1000">
        <Text as="p" alignment="center" tone="subdued">
          {t("No data available for this period.")}
        </Text>
      </Box>
    );
  const max =
    Math.max(...valid.map((point) => point.value || 0), percent ? 1 : 0.01) *
    1.1;
  const minDate = Date.parse(points[0].date),
    maxDate = Date.parse(points[points.length - 1].date);
  const plotLeft = 55;
  const plotRight = chartWidth - 25;
  const x = (date: string) =>
    plotLeft +
    (maxDate > minDate
      ? (Date.parse(date) - minDate) / (maxDate - minDate)
      : 0.5) *
      (plotRight - plotLeft);
  const y = (value: number) => 225 - (value / max) * 195;
  const format = (value: number) =>
    `${formatNumber(value, { maximumFractionDigits: percent ? 2 : 1 })}${percent ? "%" : ""}`;
  let connected = false;
  const path = points
    .map((point) => {
      if (point.value === null) {
        connected = false;
        return "";
      }
      const segment = `${connected ? "L" : "M"}${x(point.date)},${y(point.value)}`;
      connected = true;
      return segment;
    })
    .join(" ");
  return (
    <svg
      ref={chartRef}
      viewBox={`0 0 ${chartWidth} 270`}
      style={{ width: "100%", height: 270, overflow: "visible" }}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {[0, 1, 2, 3, 4].map((index) => {
        const value = (max * index) / 4;
        return (
          <g key={index}>
            <line
              x1={plotLeft}
              x2={plotRight}
              y1={y(value)}
              y2={y(value)}
              stroke="#e3e3e3"
            />
            <text
              x="45"
              y={y(value) + 4}
              textAnchor="end"
              fontSize="11"
              fill="#616161"
            >
              {format(value)}
            </text>
          </g>
        );
      })}
      <path
        d={path}
        fill="none"
        stroke="#2c6ecb"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {valid.map((point) => (
        <circle
          key={point.date}
          cx={x(point.date)}
          cy={y(point.value || 0)}
          r={valid.length === 1 ? 5 : 3}
          fill="#2c6ecb"
          tabIndex={0}
        >
          <title>
            {`${formatDate(`${point.date}T12:00:00Z`, {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            })}: ${format(point.value || 0)}`}
          </title>
        </circle>
      ))}
      {[
        points[0],
        ...(points.length > 2 ? [points[Math.floor(points.length / 2)]] : []),
        ...(points.length > 1 ? [points[points.length - 1]] : []),
      ].map((point, index) => (
        <text
          key={index}
          x={x(point.date)}
          y="254"
          textAnchor={
            index === 0
              ? "start"
              : point === points[points.length - 1]
                ? "end"
                : "middle"
          }
          fontSize="12"
          fill="#616161"
        >
          {formatDate(`${point.date}T12:00:00Z`, {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          })}
        </text>
      ))}
    </svg>
  );
}
/** A headline number. When `onSelect` is set it behaves as a chart selector. */
export function MetricTile({
  label,
  value,
  caption,
  selected = false,
  onSelect,
}: {
  label: string;
  value: string;
  caption?: string;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const body = (
    <BlockStack gap="100">
      <Text as="span" variant="bodySm" tone="subdued" fontWeight="medium">
        {label}
      </Text>
      <Text as="span" variant="headingXl" numeric>
        {value}
      </Text>
      {caption && (
        <Text as="span" variant="bodySm" tone="subdued">
          {caption}
        </Text>
      )}
    </BlockStack>
  );
  const style = {
    display: "block",
    width: "100%",
    minWidth: 0,
    padding: "var(--p-space-400)",
    borderRadius: "var(--p-border-radius-300)",
    border: `var(--p-border-width-025) solid ${
      selected ? "var(--p-color-border-emphasis)" : "var(--p-color-border)"
    }`,
    boxShadow: selected
      ? "inset 0 0 0 1px var(--p-color-border-emphasis)"
      : undefined,
    background: selected
      ? "var(--p-color-bg-surface-secondary)"
      : "var(--p-color-bg-surface)",
    color: "inherit",
    font: "inherit",
    textAlign: "left" as const,
    cursor: onSelect ? "pointer" : undefined,
  };
  return onSelect ? (
    <button
      type="button"
      style={style}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {body}
    </button>
  ) : (
    <div style={style}>{body}</div>
  );
}

export function GrowthOverviewCard({ shop }: { shop: string }) {
  const { t, formatNumber, formatDate } = useI18n();
  const [period, setPeriod] = useState("month");
  const [metric, setMetric] = useState("cvr");
  const { data, loading, error, reload } = useBackgroundJson<Payload>({
    path: `/api/growth-metrics?period=${period}`,
    scopeKey: shop,
    isData: isPayload,
    errorMessage: t("Growth metrics could not load. Please retry."),
  });
  const progress = data?.progress,
    ready = progress?.status === "ready";
  const currency = data?.sales?.currency;
  const money = (value: number | null | undefined) =>
    value == null
      ? "—"
      : formatNumber(
          value,
          currency
            ? { style: "currency", currency }
            : { maximumFractionDigits: 2 },
        );
  const metrics = [
    {
      key: "traffic",
      label: t("Traffic"),
      value: ready ? formatNumber(progress.currentSessions) : "—",
      hint: t("Online store sessions"),
    },
    {
      key: "cvr",
      label: t("Conversion rate"),
      value: ready
        ? `${formatNumber(progress.currentRate, { maximumFractionDigits: 2 })}%`
        : "—",
      hint: t("Sessions that completed checkout"),
    },
    {
      key: "aov",
      label: t("Average order value"),
      value: money(data?.sales?.aov),
      hint: t("Online store orders"),
    },
    {
      key: "ltv",
      label: t("Customer lifetime value"),
      value: money(data?.sales?.ltv),
      hint: t("Observed spend per customer"),
    },
  ];
  const points =
    metric === "traffic" || metric === "cvr"
      ? ready
        ? progress.currentSeries.map((point) => ({
            date: point.date,
            value: metric === "traffic" ? point.sessions : point.conversionRate,
          }))
        : []
      : (data?.sales?.series || []).map((point) => ({
          date: point.date,
          value: metric === "aov" ? point.aov : point.ltv,
        }));
  const footnote =
    metric === "ltv"
      ? t(
          "Lifetime value is what customers who bought in this period have spent in total so far, not a forecast.",
        )
      : metric === "aov"
        ? t("Average order value of online store orders, before returns.")
        : t(
            "From Shopify Analytics. Project results use Snapshot's own tracking, so numbers can differ slightly.",
          );
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start" gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              {t("Growth levers")}
            </Text>
            {progress && (
              <Text as="p" variant="bodySm" tone="subdued">
                {formatDate(`${progress.rangeStart}T12:00:00Z`, {
                  dateStyle: "medium",
                  timeZone: "UTC",
                })}{" "}
                –{" "}
                {formatDate(`${progress.rangeEnd}T12:00:00Z`, {
                  dateStyle: "medium",
                  timeZone: "UTC",
                })}
              </Text>
            )}
          </BlockStack>
          <div style={{ minWidth: 170 }}>
            <Select
              label={t("Period")}
              labelHidden
              value={period}
              onChange={setPeriod}
              options={[
                { label: t("Week to date"), value: "week" },
                { label: t("Month to date"), value: "month" },
                { label: t("Quarter to date"), value: "quarter" },
                { label: t("Year to date"), value: "year" },
              ]}
            />
          </div>
        </InlineStack>
        <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
          {metrics.map((item) => (
            <MetricTile
              key={item.key}
              label={item.label}
              value={loading && !data ? "…" : item.value}
              caption={item.hint}
              selected={metric === item.key}
              onSelect={() => setMetric(item.key)}
            />
          ))}
        </InlineGrid>
        {error ? (
          <Banner tone="warning">
            <BlockStack gap="200">
              <p>{error}</p>
              <div>
                <Button onClick={reload}>{t("Retry")}</Button>
              </div>
            </BlockStack>
          </Banner>
        ) : (
          progress &&
          !ready && (
            <Banner tone="info">
              <p>
                {t(progress.message || "Shopify Analytics is unavailable.")}
              </p>
            </Banner>
          )
        )}
        {data && !data.sales && (metric === "ltv" || metric === "aov") && (
          <Banner tone="info">
            <p>{t("Sales metrics are not available for this store yet.")}</p>
          </Banner>
        )}
        {loading && !data ? (
          <Box paddingBlock="400">
            <SkeletonBodyText lines={6} />
          </Box>
        ) : (
          <GrowthLineChart
            points={points}
            percent={metric === "cvr"}
            title={metrics.find((item) => item.key === metric)?.label || ""}
          />
        )}
        <Text as="p" variant="bodySm" tone="subdued">
          {footnote}
        </Text>
      </BlockStack>
    </Card>
  );
}
