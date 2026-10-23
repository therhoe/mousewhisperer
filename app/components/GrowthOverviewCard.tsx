import { useEffect, useRef, useState } from "react";
import { Banner, Button, Card, Select, Text } from "@shopify/polaris";
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
      <div className="gp-empty">{t("No data available for this period.")}</div>
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
      className="gp-chart"
      viewBox={`0 0 ${chartWidth} 270`}
      style={{ height: 270 }}
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
              stroke="#dce5eb"
            />
            <text
              x="45"
              y={y(value) + 4}
              textAnchor="end"
              fontSize="11"
              fill="#64717b"
            >
              {format(value)}
            </text>
          </g>
        );
      })}
      <path
        d={path}
        fill="none"
        stroke="#0b9ed0"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {valid.map((point) => (
        <circle
          key={point.date}
          cx={x(point.date)}
          cy={y(point.value || 0)}
          r={valid.length === 1 ? 5 : 3}
          fill="#0b9ed0"
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
          fill="#64717b"
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
      hint: t("Human online-store sessions"),
    },
    {
      key: "cvr",
      label: t("Conversion rate"),
      value: ready
        ? `${formatNumber(progress.currentRate, { maximumFractionDigits: 2 })}%`
        : "—",
      hint: t("Checkout-completing sessions / sessions"),
    },
    {
      key: "aov",
      label: t("AOV"),
      value: money(data?.sales?.aov),
      hint: t("Average order value"),
    },
    {
      key: "ltv",
      label: t("LTV"),
      value: money(data?.sales?.ltv),
      hint: t("Observed customer value"),
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
  return (
    <Card>
      <div className="gp-stack" style={{ paddingBottom: 0 }}>
        <div className="gp-heading">
          <div>
            <Text as="h2" variant="headingLg">
              {t("Growth overview")}
            </Text>
            <p className="gp-muted">
              {t("Your four growth levers · Shopify Analytics")}
            </p>
          </div>
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
        <div className="gp-grid">
          {metrics.map((item) => (
            <button
              type="button"
              key={item.key}
              className="gp-metric gp-focus"
              data-selected={metric === item.key}
              aria-pressed={metric === item.key}
              onClick={() => setMetric(item.key)}
            >
              <strong>{item.label}</strong>
              <span className="gp-value">
                {loading && !data ? "…" : item.value}
              </span>
              <span className="gp-muted">{item.hint}</span>
            </button>
          ))}
        </div>
        {error ? (
          <Banner tone="warning">
            <p>{error}</p>
            <Button onClick={reload}>{t("Retry")}</Button>
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
        {loading && !data ? (
          <div className="gp-empty" role="status">
            {t("Loading growth metrics…")}
          </div>
        ) : (
          <GrowthLineChart
            points={points}
            percent={metric === "cvr"}
            title={metrics.find((item) => item.key === metric)?.label || ""}
          />
        )}
        {progress && (
          <p className="gp-muted">
            {formatDate(`${progress.rangeStart}T12:00:00Z`, {
              dateStyle: "medium",
              timeZone: "UTC",
            })}{" "}
            –{" "}
            {formatDate(`${progress.rangeEnd}T12:00:00Z`, {
              dateStyle: "medium",
              timeZone: "UTC",
            })}
          </p>
        )}
        <div className="gp-note gp-muted">
          {metric === "ltv"
            ? t(
                "LTV is observed all-time spend for customers who bought in the selected period, not predicted future value. Each point represents that day's buying cohort.",
              )
            : metric === "aov"
              ? t(
                  "AOV is Shopify's average order value for online-store sales, before post-order adjustments.",
                )
              : t(
                  "Store growth uses Shopify Analytics. Project results use Snapshot's recorded sessions and may differ.",
                )}
          {data && !data.sales && (metric === "ltv" || metric === "aov") && (
            <p>
              {t(
                "Sales metrics are unavailable for this store. Missing data is not shown as zero.",
              )}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
