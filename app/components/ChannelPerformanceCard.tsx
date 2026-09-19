import { useId, useRef, useState } from "react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Select,
  Text,
} from "@shopify/polaris";
import type { ChannelOverview } from "../utils/channel-overview.server";

type ChartMetric = "humanSessions" | "conversionRate";
const CHANNEL_COLORS: Record<string, string> = {
  Direct: "#2463eb",
  "Organic Search": "#008060",
  "Paid Search": "#7c3aed",
  "Organic Social": "#149ed5",
  "Paid Social": "#bf4080",
  Email: "#b66b00",
  Referral: "#6b7c2b",
  Unknown: "#6d7175",
};
const CHART_WIDTH = 860;
const CHART_HEIGHT = 220;
const PLOT_LEFT = 44;
const PLOT_RIGHT = CHART_WIDTH - 12;
const PLOT_TOP = 10;
const PLOT_BOTTOM = CHART_HEIGHT - 34;

export function ChannelPerformanceCard({
  data,
  loading,
  error,
  onRefresh,
}: {
  data: ChannelOverview | null;
  loading: boolean;
  error?: string | null;
  onRefresh: () => void;
}) {
  const [metric, setMetric] = useState<ChartMetric>("humanSessions");
  const rate = data?.summary.conversionRate ?? null;
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" gap="300">
          <BlockStack gap="050">
            <Text as="h2" variant="headingLg" fontWeight="semibold">
              Channel performance
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {data?.snapshot
                ? data.snapshot.name
                : "Your latest channel snapshot"}
            </Text>
          </BlockStack>
          <InlineStack blockAlign="center" gap="200">
            <Badge>Snapshot tracking</Badge>
            {data?.snapshot ? (
              <Badge
                tone={
                  data.snapshot.status === "ACTIVE"
                    ? "success"
                    : data.snapshot.status === "PAUSED"
                      ? "warning"
                      : "info"
                }
              >
                {statusLabel(data.snapshot.status)}
              </Badge>
            ) : null}
          </InlineStack>
        </InlineStack>

        {error && !loading ? (
          <InlineStack align="space-between" blockAlign="center" gap="300">
            <Text as="p" tone="critical">
              {error}
              {data ? " Showing the last loaded graph." : ""}
            </Text>
            <Button onClick={onRefresh} size="slim">
              Retry graph
            </Button>
          </InlineStack>
        ) : null}

        {!data ? (
          <div
            aria-busy={loading}
            aria-live="polite"
            style={{ minHeight: 244 }}
          >
            {loading ? (
              <BlockStack gap="400">
                <div
                  aria-hidden="true"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 24,
                    padding: "12px 0",
                  }}
                >
                  {[0, 1, 2].map((item) => (
                    <div
                      key={item}
                      style={{
                        height: 48,
                        borderRadius: 5,
                        background: "var(--p-color-bg-surface-secondary)",
                      }}
                    />
                  ))}
                </div>
                <div
                  aria-hidden="true"
                  style={{
                    height: 138,
                    borderRadius: 5,
                    background: "var(--p-color-bg-surface-secondary)",
                  }}
                />
                <Text as="p" tone="subdued" variant="bodySm">
                  Loading channel performance…
                </Text>
              </BlockStack>
            ) : null}
          </div>
        ) : !data.snapshot ? (
          <EmptyChart message="Start a channel snapshot to see human-session trends by channel." />
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                borderTop: "1px solid var(--p-color-border)",
                borderBottom: "1px solid var(--p-color-border)",
                padding: "10px 0",
              }}
            >
              <Kpi
                label="Human sessions"
                value={formatCount(data.summary.humanSessions)}
                detail="Real + Zombie"
              />
              <Kpi
                label="Real traffic"
                value={formatRate(data.summary.realShare)}
                detail="of all captured sessions"
                bordered
              />
              <Kpi
                label="Converted sessions"
                value={formatCount(data.summary.conversions)}
                detail={`${formatRate(rate)} conversion rate`}
                bordered
              />
            </div>

            <BlockStack gap="150">
              <InlineStack align="space-between" blockAlign="start" gap="300">
                <BlockStack gap="050">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {metric === "humanSessions"
                      ? "Human sessions by channel"
                      : "Conversion rate by channel"}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {formatRange(data)}
                    {data.range?.truncated
                      ? " · Last 90 days of this snapshot"
                      : ""}
                  </Text>
                </BlockStack>
                <div style={{ minWidth: 156 }}>
                  <Select
                    label="Chart metric"
                    labelHidden
                    value={metric}
                    onChange={(value) => setMetric(value as ChartMetric)}
                    options={[
                      { label: "Human sessions", value: "humanSessions" },
                      { label: "Conversion rate", value: "conversionRate" },
                    ]}
                  />
                </div>
              </InlineStack>
              {data.summary.humanSessions > 0 ? (
                <ChannelTrendChart data={data} metric={metric} />
              ) : (
                <EmptyChart
                  message={
                    data.summary.sessions === 0
                      ? "No sessions captured in this range yet. The graph will appear as new traffic arrives."
                      : "No human sessions have been classified in this range yet. Bots and pending sessions are not plotted as human traffic."
                  }
                />
              )}
            </BlockStack>

            <InlineStack align="space-between" blockAlign="center" gap="300">
              <Text as="span" variant="bodySm" tone="subdued">
                {metric === "conversionRate"
                  ? "Converted human sessions ÷ human sessions. Gaps mean no human sessions."
                  : "Each acquisition session is counted once, in its first captured time bucket."}
                {data.snapshot.status === "ACTIVE"
                  ? " Current bucket may be partial."
                  : ""}
              </Text>
              <InlineStack gap="300" blockAlign="center">
                <Button
                  variant="plain"
                  url={`/app/channel-snapshots/${data.snapshot.id}`}
                >
                  View report
                </Button>
                <Button variant="plain" onClick={onRefresh} loading={loading}>
                  Refresh graph
                </Button>
              </InlineStack>
            </InlineStack>
          </>
        )}
      </BlockStack>
    </Card>
  );
}

function ChannelTrendChart({
  data,
  metric,
}: {
  data: ChannelOverview;
  metric: ChartMetric;
}) {
  const tooltipId = `channel-chart-${useId().replace(/:/g, "")}`;
  const [hoveredBucket, setHoveredBucket] = useState<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<SVGSVGElement>(null);
  const bucketIndex = Math.max(
    0,
    Math.min(data.buckets.length - 1, hoveredBucket ?? data.buckets.length - 1),
  );
  const values = data.channels.flatMap((channel) =>
    channel.points
      .map((point) => point[metric])
      .filter((value): value is number => value !== null),
  );
  const maximum = chartMaximum(Math.max(0, ...values), metric);
  const x = (index: number) =>
    data.buckets.length === 1
      ? (PLOT_LEFT + PLOT_RIGHT) / 2
      : PLOT_LEFT +
        (index / (data.buckets.length - 1)) * (PLOT_RIGHT - PLOT_LEFT);
  const y = (value: number) =>
    PLOT_BOTTOM - (value / maximum) * (PLOT_BOTTOM - PLOT_TOP);
  const tickCount = Math.min(6, data.buckets.length);
  const tickIndexes = [
    ...new Set(
      Array.from({ length: tickCount }, (_, index) =>
        Math.round(
          (index / Math.max(1, tickCount - 1)) * (data.buckets.length - 1),
        ),
      ),
    ),
  ];
  function selectFocusedBucket(index: number) {
    setHoveredBucket(index);
    revealChartPosition(viewportRef.current, chartRef.current, x(index));
  }

  return (
    <BlockStack gap="200">
      <div
        ref={viewportRef}
        role="slider"
        aria-label="Chart date in UTC. Use arrow keys to inspect each date."
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={data.buckets.length - 1}
        aria-valuenow={bucketIndex}
        aria-valuetext={formatBucket(
          data.buckets[bucketIndex],
          data.range?.unit || "day",
          true,
        )}
        aria-describedby={tooltipId}
        tabIndex={0}
        onFocus={() => selectFocusedBucket(bucketIndex)}
        onBlur={() => setHoveredBucket(null)}
        onKeyDown={(event) => {
          if (
            ![
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "Home",
              "End",
            ].includes(event.key)
          )
            return;
          event.preventDefault();
          selectFocusedBucket(
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? data.buckets.length - 1
                : Math.max(
                    0,
                    Math.min(
                      data.buckets.length - 1,
                      bucketIndex +
                        (["ArrowRight", "ArrowUp"].includes(event.key)
                          ? 1
                          : -1),
                    ),
                  ),
          );
        }}
        style={{ overflowX: "auto" }}
      >
        <svg
          ref={chartRef}
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          width="100%"
          height="190"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${metric === "humanSessions" ? "Human sessions" : "Conversion rate"} by acquisition channel, ${data.range?.unit === "hour" ? "hourly" : "daily"} in UTC`}
          style={{ display: "block", minWidth: 560 }}
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const plotX =
              ((event.clientX - bounds.left) / bounds.width) * CHART_WIDTH;
            setHoveredBucket(
              Math.max(
                0,
                Math.min(
                  data.buckets.length - 1,
                  Math.round(
                    ((plotX - PLOT_LEFT) / (PLOT_RIGHT - PLOT_LEFT)) *
                      (data.buckets.length - 1),
                  ),
                ),
              ),
            );
          }}
          onPointerLeave={() => setHoveredBucket(null)}
        >
          {Array.from({ length: 5 }, (_, index) => {
            const value = (maximum * index) / 4;
            return (
              <g key={index}>
                <line
                  x1={PLOT_LEFT}
                  x2={PLOT_RIGHT}
                  y1={y(value)}
                  y2={y(value)}
                  stroke="var(--p-color-border)"
                />
                <text
                  x={PLOT_LEFT - 8}
                  y={y(value) + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="var(--p-color-text-secondary)"
                >
                  {metric === "conversionRate"
                    ? formatRate(value)
                    : formatCount(value)}
                </text>
              </g>
            );
          })}
          {data.channels.map((channel) => {
            const points = channel.points.map((point) => point[metric]);
            const populated = points
              .map((value, index) => ({ value, index }))
              .filter(
                (point): point is { value: number; index: number } =>
                  point.value !== null,
              );
            return (
              <g key={channel.channel}>
                <path
                  d={seriesPath(points, x, y)}
                  fill="none"
                  stroke={
                    CHANNEL_COLORS[channel.channel] || CHANNEL_COLORS.Unknown
                  }
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={
                    channel.channel === "Unknown" ? "5 4" : undefined
                  }
                  vectorEffect="non-scaling-stroke"
                />
                {populated
                  .filter(
                    (point) =>
                      (point.index === 0 || points[point.index - 1] === null) &&
                      (point.index === points.length - 1 ||
                        points[point.index + 1] === null),
                  )
                  .map((point) => (
                    <circle
                      key={point.index}
                      cx={x(point.index)}
                      cy={y(point.value)}
                      r="3"
                      fill={
                        CHANNEL_COLORS[channel.channel] ||
                        CHANNEL_COLORS.Unknown
                      }
                    />
                  ))}
              </g>
            );
          })}
          {hoveredBucket !== null ? (
            <g>
              <line
                x1={x(bucketIndex)}
                x2={x(bucketIndex)}
                y1={PLOT_TOP}
                y2={PLOT_BOTTOM}
                stroke="#8c9196"
                strokeDasharray="3 4"
              />
              {data.channels.map((channel) => {
                const value = channel.points[bucketIndex]?.[metric];
                return value === null || value === undefined ? null : (
                  <circle
                    key={channel.channel}
                    cx={x(bucketIndex)}
                    cy={y(value)}
                    r="3"
                    fill={
                      CHANNEL_COLORS[channel.channel] || CHANNEL_COLORS.Unknown
                    }
                    stroke="white"
                    strokeWidth="1"
                  />
                );
              })}
            </g>
          ) : null}
          {tickIndexes.map((index) => (
            <text
              key={index}
              x={x(index)}
              y={CHART_HEIGHT - 9}
              textAnchor={
                index === 0
                  ? "start"
                  : index === data.buckets.length - 1
                    ? "end"
                    : "middle"
              }
              fontSize="11"
              fill="var(--p-color-text-secondary)"
            >
              {formatBucket(data.buckets[index], data.range?.unit || "day")}
            </text>
          ))}
        </svg>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 16px",
          fontSize: 12,
        }}
      >
        {data.channels.map((channel) => (
          <span
            key={channel.channel}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 14,
                height: 2,
                background:
                  CHANNEL_COLORS[channel.channel] || CHANNEL_COLORS.Unknown,
              }}
            />
            {channel.channel}
          </span>
        ))}
      </div>
      <div
        id={tooltipId}
        aria-live="polite"
        style={{
          minHeight: 34,
          fontSize: 12,
          color: "var(--p-color-text-secondary)",
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 12px",
        }}
      >
        {hoveredBucket === null ? (
          <span>
            Hover over the graph, or focus it and use arrow keys, to inspect a
            date.
          </span>
        ) : (
          <>
            <strong>
              {formatBucket(
                data.buckets[bucketIndex],
                data.range?.unit || "day",
                true,
              )}{" "}
              UTC
            </strong>
            {data.channels.map((channel) => {
              const point = channel.points[bucketIndex];
              return (
                <span key={channel.channel}>
                  {channel.channel}:{" "}
                  {metric === "humanSessions"
                    ? formatCount(point.humanSessions)
                    : `${formatRate(point.conversionRate)} (${formatCount(point.conversions)}/${formatCount(point.humanSessions)})`}
                </span>
              );
            })}
          </>
        )}
      </div>
    </BlockStack>
  );
}

function revealChartPosition(
  viewport: HTMLDivElement | null,
  chart: SVGSVGElement | null,
  chartX: number,
) {
  if (!viewport || !chart || viewport.clientWidth <= 0) return;
  const chartBounds = chart.getBoundingClientRect();
  const viewportLeft =
    viewport.getBoundingClientRect().left + viewport.clientLeft;
  const position =
    chartBounds.left +
    (chartX / CHART_WIDTH) * chartBounds.width -
    viewportLeft;
  const margin = Math.min(16, viewport.clientWidth / 2);
  const delta =
    position < margin
      ? position - margin
      : position > viewport.clientWidth - margin
        ? position - (viewport.clientWidth - margin)
        : 0;
  const nextScrollLeft = Math.max(
    0,
    Math.min(
      viewport.scrollWidth - viewport.clientWidth,
      viewport.scrollLeft + delta,
    ),
  );
  // Scroll only this horizontal viewport; scrollIntoView would also move the
  // page. Keep keyboard focus on the same slider and leave pointer hover alone.
  if (nextScrollLeft !== viewport.scrollLeft)
    viewport.scrollLeft = nextScrollLeft;
}

function seriesPath(
  points: Array<number | null>,
  x: (index: number) => number,
  y: (value: number) => number,
) {
  let previousValue = false;
  return points
    .map((value, index) => {
      if (value === null) {
        previousValue = false;
        return "";
      }
      const command = previousValue ? "L" : "M";
      previousValue = true;
      return `${command}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" ");
}

function chartMaximum(value: number, metric: ChartMetric) {
  const roughStep = Math.max(metric === "humanSessions" ? 1 : 0.25, value / 4);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step =
    [1, 2, 5, 10].find((candidate) => candidate * magnitude >= roughStep) || 10;
  const maximum = step * magnitude * 4;
  return metric === "conversionRate" ? Math.min(100, maximum) : maximum;
}

function Kpi({
  label,
  value,
  detail,
  bordered = false,
}: {
  label: string;
  value: string;
  detail: string;
  bordered?: boolean;
}) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: bordered ? "0 16px" : "0 16px 0 0",
        borderLeft: bordered ? "1px solid var(--p-color-border)" : undefined,
      }}
    >
      <Text as="p" variant="bodySm" tone="subdued">
        {label}
      </Text>
      <div
        style={{
          fontSize: 22,
          lineHeight: "28px",
          fontWeight: 650,
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>
      <Text as="p" variant="bodySm" tone="subdued">
        {detail}
      </Text>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div
      style={{
        minHeight: 184,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        borderTop: "1px solid var(--p-color-border)",
        borderBottom: "1px solid var(--p-color-border)",
        padding: 20,
      }}
    >
      <Text as="p" tone="subdued" variant="bodySm">
        {message}
      </Text>
    </div>
  );
}

function formatCount(value: number) {
  return Math.round(value).toLocaleString("en-US");
}
function formatRate(value: number | null) {
  return value === null
    ? "—"
    : `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}
function statusLabel(status: string) {
  return status === "ACTIVE"
    ? "Active"
    : status === "PAUSED"
      ? "Paused"
      : "Completed";
}
function formatBucket(value: string, unit: "hour" | "day", full = false) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    ...(full ? { year: "numeric" as const } : {}),
    ...(unit === "hour"
      ? { hour: "2-digit" as const, minute: "2-digit" as const, hour12: false }
      : {}),
    timeZone: "UTC",
  });
}
function formatRange(data: ChannelOverview) {
  if (!data.range) return "";
  return `${formatBucket(data.range.start, data.range.unit)}–${formatBucket(data.range.end, data.range.unit, true)} · ${data.range.unit === "hour" ? "Hourly" : "Daily"} · UTC`;
}
