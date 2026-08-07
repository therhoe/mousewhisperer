import { useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  FormLayout,
  InlineStack,
  Modal,
  Pagination,
  Select,
  Tabs,
  Text,
  TextField,
} from "@shopify/polaris";
import type {
  ConversionDashboardPayload,
  ConversionPeriod,
  ConversionPoint,
  ProgressTimelineEvent,
} from "../types/conversion-progress";

const PERIOD_OPTIONS: Array<{ label: string; value: ConversionPeriod }> = [
  { label: "Week to date", value: "week" },
  { label: "Month to date", value: "month" },
  { label: "Quarter to date", value: "quarter" },
  { label: "Year to date", value: "year" },
];

const CATEGORY_OPTIONS = [
  { label: "Design", value: "DESIGN" },
  { label: "Copy", value: "COPY" },
  { label: "Merchandising", value: "MERCHANDISING" },
  { label: "Pricing", value: "PRICING" },
  { label: "Promotion", value: "PROMOTION" },
  { label: "Navigation", value: "NAVIGATION" },
  { label: "Performance", value: "PERFORMANCE" },
  { label: "Other", value: "OTHER" },
];

const ACTIVITY_PAGE_SIZE = 5;

type EventActionResponse = { ok: boolean; error?: string };

function formatRate(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatDelta(value: number) {
  const amount = Math.abs(value);
  return `${amount.toFixed(2)} percentage point${amount === 1 ? "" : "s"}`;
}

function formatComparison(currentRate: number, previousRate: number) {
  const delta = currentRate - previousRate;
  if (Math.abs(delta) < 0.005) {
    return `No change from ${formatRate(previousRate)}`;
  }
  return `${delta > 0 ? "↑ Up" : "↓ Down"} ${formatDelta(delta)} (${formatRate(previousRate)} → ${formatRate(currentRate)})`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function compactText(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function activityTypeLabel(kind: ProgressTimelineEvent["kind"]) {
  if (kind === "OPTIMIZATION") return "Optimization";
  if (kind === "AB_TEST") return "Experiment";
  return "Measurement";
}

function activityDateLabel(event: ProgressTimelineEvent) {
  return event.end
    ? `${formatEventDate(event.start)} – ${formatEventDate(event.end)}`
    : formatEventDate(event.start);
}

function formatEventDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function svgPath(
  points: ConversionPoint[],
  left: number,
  width: number,
  top: number,
  height: number,
  maxValue: number,
) {
  const coordinates = points.map((point, index) => ({
    x:
      points.length <= 1
        ? left + width / 2
        : left + (index / (points.length - 1)) * width,
    y: top + height - (point.conversionRate / maxValue) * height,
  }));

  if (coordinates.length === 0) return "";
  if (coordinates.length === 1) {
    return `M${coordinates[0].x.toFixed(1)},${coordinates[0].y.toFixed(1)}`;
  }

  let path = `M${coordinates[0].x.toFixed(1)},${coordinates[0].y.toFixed(1)}`;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const previous = coordinates[index - 1] || coordinates[index];
    const current = coordinates[index];
    const next = coordinates[index + 1];
    const afterNext = coordinates[index + 2] || next;
    const controlOneX = current.x + (next.x - previous.x) / 6;
    const controlOneY = current.y + (next.y - previous.y) / 6;
    const controlTwoX = next.x - (afterNext.x - current.x) / 6;
    const controlTwoY = next.y - (afterNext.y - current.y) / 6;
    path += ` C${controlOneX.toFixed(1)},${controlOneY.toFixed(1)} ${controlTwoX.toFixed(1)},${controlTwoY.toFixed(1)} ${next.x.toFixed(1)},${next.y.toFixed(1)}`;
  }
  return path;
}

function chartDateTicks(start: string, end: string, count = 7) {
  const startAt = new Date(`${start}T12:00:00.000Z`).getTime();
  const endAt = new Date(`${end}T12:00:00.000Z`).getTime();
  const duration = Math.max(1, endAt - startAt);
  return Array.from({ length: count }, (_, index) => {
    const ratio = count === 1 ? 0 : index / (count - 1);
    return {
      ratio,
      value: new Date(startAt + duration * ratio),
    };
  });
}

function formatChartDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function eventColor(kind: ProgressTimelineEvent["kind"]) {
  if (kind === "OPTIMIZATION") return "#008060";
  if (kind === "AB_TEST") return "#7c3aed";
  return "#6d7175";
}

function ConversionChart({ data }: { data: ConversionDashboardPayload }) {
  const { progress, events } = data;
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const left = 58;
  const right = 952;
  const top = 22;
  const bottom = 238;
  const width = right - left;
  const height = bottom - top;
  const allRates = [
    ...progress.currentSeries.map((point) => point.conversionRate),
    ...progress.previousSeries.map((point) => point.conversionRate),
  ];
  const maxValue = Math.max(4, Math.ceil(Math.max(0, ...allRates) * 1.15));
  const currentPath = svgPath(
    progress.currentSeries,
    left,
    width,
    top,
    height,
    maxValue,
  );
  const previousPath = svgPath(
    progress.previousSeries,
    left,
    width,
    top,
    height,
    maxValue,
  );
  const rangeStart = new Date(`${progress.rangeStart}T00:00:00.000Z`).getTime();
  const rangeEnd = new Date(`${progress.rangeEnd}T23:59:59.999Z`).getTime();
  const rangeDuration = Math.max(1, rangeEnd - rangeStart);
  const eventX = (value: string) =>
    left +
    Math.max(
      0,
      Math.min(1, (new Date(value).getTime() - rangeStart) / rangeDuration),
    ) *
      width;
  const nearestPointY = (value: string) => {
    if (!progress.currentSeries.length) return bottom;
    const target = new Date(value).getTime();
    const nearest = progress.currentSeries.reduce((best, point) =>
      Math.abs(new Date(point.date).getTime() - target) <
      Math.abs(new Date(best.date).getTime() - target)
        ? point
        : best,
    );
    return top + height - (nearest.conversionRate / maxValue) * height;
  };
  const ticks = chartDateTicks(progress.rangeStart, progress.rangeEnd);
  const hasSeries = Boolean(currentPath || previousPath);
  const experimentEvents = events.filter((event) => event.kind === "AB_TEST");
  const pointEvents = events.filter((event) => event.kind !== "AB_TEST");
  const measurementEvents = pointEvents.filter(
    (event) => event.kind === "SNAPSHOT" || event.kind === "STORE_SNAPSHOT",
  );
  const measurementY = (event: ProgressTimelineEvent) => {
    const sameDay = measurementEvents.filter(
      (candidate) => candidate.start.slice(0, 10) === event.start.slice(0, 10),
    );
    const lane = Math.max(
      0,
      sameDay.findIndex((candidate) => candidate.id === event.id),
    );
    return bottom - 7 - (lane % 4) * 11;
  };
  const hoveredEvent = events.find((event) => event.id === hoveredEventId);
  const hoveredX = hoveredEvent
    ? hoveredEvent.kind === "AB_TEST" && hoveredEvent.end
      ? (eventX(hoveredEvent.start) + eventX(hoveredEvent.end)) / 2
      : eventX(hoveredEvent.start)
    : 0;
  const hoveredY = hoveredEvent
    ? hoveredEvent.kind === "AB_TEST"
      ? top + 28
      : hoveredEvent.kind === "OPTIMIZATION"
        ? nearestPointY(hoveredEvent.start)
        : measurementY(hoveredEvent)
    : 0;
  const tooltipWidth = 250;
  const tooltipHeight = hoveredEvent?.description ? 82 : 64;
  const tooltipX = Math.max(
    left,
    Math.min(right - tooltipWidth, hoveredX - tooltipWidth / 2),
  );
  const tooltipY = Math.max(top + 4, hoveredY - tooltipHeight - 14);

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 680 }}>
        <svg
          viewBox="0 0 980 292"
          width="100%"
          height="292"
          role="img"
          aria-label={`${progress.periodLabel} Shopify conversion rate compared with the prior period`}
          style={{ display: "block" }}
        >
          {experimentEvents.map((event) => {
            const startX = eventX(event.start);
            const endX = event.end ? eventX(event.end) : right;
            const details = [
              event.title,
              activityDateLabel(event),
              event.description,
            ]
              .filter(Boolean)
              .join(". ");
            return (
              <g
                key={event.id}
                role="button"
                tabIndex={0}
                aria-label={details}
                onMouseEnter={() => setHoveredEventId(event.id)}
                onMouseLeave={() => setHoveredEventId(null)}
                onFocus={() => setHoveredEventId(event.id)}
                onBlur={() => setHoveredEventId(null)}
                onClick={() =>
                  setHoveredEventId((current) =>
                    current === event.id ? null : event.id,
                  )
                }
                style={{ cursor: "pointer", outline: "none" }}
              >
                <rect
                  x={startX}
                  y={top}
                  width={Math.max(4, endX - startX)}
                  height={height}
                  fill="#7c3aed"
                  opacity={hoveredEventId === event.id ? 0.16 : 0.07}
                />
                <line
                  x1={startX}
                  x2={startX}
                  y1={top}
                  y2={bottom}
                  stroke="#7c3aed"
                  strokeWidth="1"
                  opacity="0.35"
                />
                <title>{details}</title>
              </g>
            );
          })}

          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = bottom - ratio * height;
            return (
              <g key={ratio}>
                <line
                  x1={left}
                  x2={right}
                  y1={y}
                  y2={y}
                  stroke="#cbddeb"
                  strokeWidth="1"
                />
                <text
                  x={left - 12}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="12"
                  fill="#66727d"
                >
                  {(ratio * maxValue).toFixed(0)}%
                </text>
              </g>
            );
          })}

          {previousPath ? (
            <path
              d={previousPath}
              fill="none"
              stroke="#78c1df"
              strokeWidth="2.5"
              strokeDasharray="5 8"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {currentPath ? (
            <path
              d={currentPath}
              fill="none"
              stroke="#149ed5"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}

          {hasSeries
            ? pointEvents.map((event) => {
                const x = eventX(event.start);
                const isOptimization = event.kind === "OPTIMIZATION";
                const y = isOptimization
                  ? nearestPointY(event.start)
                  : measurementY(event);
                const color = eventColor(event.kind);
                const details = [
                  event.title,
                  activityDateLabel(event),
                  event.description,
                ]
                  .filter(Boolean)
                  .join(". ");
                return (
                  <g
                    key={event.id}
                    role="button"
                    tabIndex={0}
                    aria-label={details}
                    onMouseEnter={() => setHoveredEventId(event.id)}
                    onMouseLeave={() => setHoveredEventId(null)}
                    onFocus={() => setHoveredEventId(event.id)}
                    onBlur={() => setHoveredEventId(null)}
                    onClick={() =>
                      setHoveredEventId((current) =>
                        current === event.id ? null : event.id,
                      )
                    }
                    style={{ cursor: "pointer", outline: "none" }}
                  >
                    <line
                      x1={x}
                      x2={x}
                      y1={top}
                      y2={bottom}
                      stroke={color}
                      strokeWidth="1"
                      strokeDasharray={isOptimization ? "3 4" : "2 6"}
                      opacity={isOptimization ? 0.72 : 0.3}
                    />
                    <circle cx={x} cy={y} r="14" fill="transparent" />
                    {isOptimization ? (
                      <circle
                        cx={x}
                        cy={y}
                        r={hoveredEventId === event.id ? 7 : 6}
                        fill={color}
                        stroke="#fff"
                        strokeWidth="2"
                      />
                    ) : (
                      <rect
                        x={x - 5}
                        y={y - 5}
                        width="10"
                        height="10"
                        rx="1"
                        fill={color}
                        stroke="#fff"
                        strokeWidth="1.5"
                        transform={`rotate(45 ${x} ${y})`}
                      />
                    )}
                    <title>{details}</title>
                  </g>
                );
              })
            : null}

          {hoveredEvent ? (
            <g pointerEvents="none" aria-hidden="true">
              <rect
                x={tooltipX}
                y={tooltipY}
                width={tooltipWidth}
                height={tooltipHeight}
                rx="9"
                fill="#202223"
                opacity="0.97"
              />
              <text
                x={tooltipX + 12}
                y={tooltipY + 20}
                fill="#ffffff"
                fontSize="12"
                fontWeight="700"
              >
                {compactText(hoveredEvent.title, 36)}
              </text>
              <text
                x={tooltipX + 12}
                y={tooltipY + 39}
                fill="#d2d5d8"
                fontSize="11"
              >
                {activityDateLabel(hoveredEvent)} ·{" "}
                {activityTypeLabel(hoveredEvent.kind)}
              </text>
              {hoveredEvent.description ? (
                <text
                  x={tooltipX + 12}
                  y={tooltipY + 60}
                  fill="#ffffff"
                  fontSize="11"
                >
                  {compactText(hoveredEvent.description, 43)}
                </text>
              ) : null}
            </g>
          ) : null}

          {!hasSeries ? (
            <text
              x={(left + right) / 2}
              y={(top + bottom) / 2}
              textAnchor="middle"
              fontSize="14"
              fill="#596b78"
            >
              Conversion data will appear here after Shopify grants access
            </text>
          ) : null}

          {ticks.map((tick, index) => (
            <text
              key={`${tick.value.toISOString()}-${index}`}
              x={left + tick.ratio * width}
              y="270"
              textAnchor={
                index === 0
                  ? "start"
                  : index === ticks.length - 1
                    ? "end"
                    : "middle"
              }
              fontSize="12"
              fill="#596b78"
            >
              {formatChartDate(tick.value)}
            </text>
          ))}
        </svg>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 24,
            color: "#596b78",
            fontSize: 12,
            paddingBottom: 4,
          }}
        >
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <span
              style={{
                width: 24,
                borderTop: "3px solid #149ed5",
              }}
            />
            Current: {progress.currentLabel}
          </span>
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <span
              style={{
                width: 24,
                borderTop: "3px dashed #78c1df",
              }}
            />
            Previous: {progress.previousLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

function TimelineEventRow({
  event,
  onEdit,
  onDelete,
}: {
  event: ProgressTimelineEvent;
  onEdit: (event: ProgressTimelineEvent) => void;
  onDelete: (event: ProgressTimelineEvent) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "10px minmax(0, 1fr) auto",
        gap: 12,
        alignItems: "start",
        padding: "10px 0",
        borderTop: "1px solid var(--p-color-border-subdued)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: event.kind === "AB_TEST" ? 2 : "50%",
          background: eventColor(event.kind),
          marginTop: 6,
        }}
      />
      <BlockStack gap="050">
        <InlineStack gap="150" blockAlign="center" wrap>
          <Text as="span" variant="bodySm" fontWeight="semibold">
            {event.title}
          </Text>
          <Badge tone={event.kind === "OPTIMIZATION" ? "success" : undefined}>
            {event.kind === "AB_TEST"
              ? "Experiment"
              : event.kind === "OPTIMIZATION"
                ? "Optimization"
                : "Measurement"}
          </Badge>
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          {formatEventDate(event.start)}
          {event.end ? ` – ${formatEventDate(event.end)}` : ""}
          {event.description ? ` · ${event.description}` : ""}
        </Text>
      </BlockStack>
      {event.editable ? (
        <InlineStack gap="100" wrap={false}>
          <Button variant="plain" size="slim" onClick={() => onEdit(event)}>
            Edit
          </Button>
          <Button
            variant="plain"
            tone="critical"
            size="slim"
            onClick={() => onDelete(event)}
          >
            Delete
          </Button>
        </InlineStack>
      ) : null}
    </div>
  );
}

export function ConversionProgressCard({
  initialData,
  shop,
}: {
  initialData: ConversionDashboardPayload;
  shop: string;
}) {
  const analyticsFetcher = useFetcher<ConversionDashboardPayload>();
  const eventFetcher = useFetcher<EventActionResponse>();
  const [period, setPeriod] = useState<ConversionPeriod>(
    initialData.progress.period,
  );
  const [data, setData] = useState(initialData);
  const [selectedActivityTab, setSelectedActivityTab] = useState(0);
  const [activityPage, setActivityPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] =
    useState<ProgressTimelineEvent | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [scope, setScope] = useState("STORE");
  const [pagePath, setPagePath] = useState("");
  const [implementedAt, setImplementedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [endedAt, setEndedAt] = useState("");
  const handledEventResponse = useRef<EventActionResponse | undefined>();

  useEffect(() => {
    if (analyticsFetcher.data?.progress) {
      setData(analyticsFetcher.data);
      setActivityPage(1);
    }
  }, [analyticsFetcher.data]);

  useEffect(() => {
    if (
      !eventFetcher.data?.ok ||
      handledEventResponse.current === eventFetcher.data
    )
      return;
    handledEventResponse.current = eventFetcher.data;
    setModalOpen(false);
    setEditingEvent(null);
    setSelectedActivityTab(0);
    setActivityPage(1);
    analyticsFetcher.load(`/api/dashboard-conversion?period=${period}`);
  }, [analyticsFetcher, eventFetcher.data, period]);

  const progress = data.progress;
  const isLoading = analyticsFetcher.state !== "idle";
  const isSaving = eventFetcher.state !== "idle";
  const activityGroups = [
    {
      id: "optimizations",
      label: "Optimizations",
      emptyMessage:
        "No optimizations have been logged in this period. Use “Log optimization” to add an implemented change.",
      events: data.events.filter((event) => event.kind === "OPTIMIZATION"),
    },
    {
      id: "experiments",
      label: "Experiments",
      emptyMessage: "No A/B tests ran during this period.",
      events: data.events.filter((event) => event.kind === "AB_TEST"),
    },
    {
      id: "measurements",
      label: "Measurements",
      emptyMessage: "No snapshots were completed during this period.",
      events: data.events.filter(
        (event) => event.kind === "SNAPSHOT" || event.kind === "STORE_SNAPSHOT",
      ),
    },
  ].map((group) => ({
    ...group,
    events: [...group.events].sort(
      (left, right) =>
        new Date(right.start).getTime() - new Date(left.start).getTime(),
    ),
  }));
  const selectedActivityGroup = activityGroups[selectedActivityTab];
  const totalActivityPages = Math.max(
    1,
    Math.ceil(selectedActivityGroup.events.length / ACTIVITY_PAGE_SIZE),
  );
  const currentActivityPage = Math.min(activityPage, totalActivityPages);
  const visibleActivityEvents = selectedActivityGroup.events.slice(
    (currentActivityPage - 1) * ACTIVITY_PAGE_SIZE,
    currentActivityPage * ACTIVITY_PAGE_SIZE,
  );
  const activityTabs = activityGroups.map((group) => ({
    id: group.id,
    content: `${group.label} (${group.events.length})`,
    accessibilityLabel: `${group.label}, ${group.events.length} in this period`,
    panelID: `${group.id}-panel`,
  }));
  const changePeriod = (nextPeriod: ConversionPeriod) => {
    if (nextPeriod === period) return;
    setPeriod(nextPeriod);
    analyticsFetcher.load(`/api/dashboard-conversion?period=${nextPeriod}`);
  };

  const openCreate = () => {
    setEditingEvent(null);
    setTitle("");
    setDescription("");
    setCategory("OTHER");
    setScope("STORE");
    setPagePath("");
    setImplementedAt(new Date().toISOString().slice(0, 10));
    setEndedAt("");
    setModalOpen(true);
  };

  const openEdit = (event: ProgressTimelineEvent) => {
    setEditingEvent(event);
    setTitle(event.title);
    setDescription(event.description || "");
    setCategory(event.category || "OTHER");
    setScope(event.scope || "STORE");
    setPagePath(event.pagePath || "");
    setImplementedAt(event.start.slice(0, 10));
    setEndedAt(event.end?.slice(0, 10) || "");
    setModalOpen(true);
  };

  const saveEvent = () => {
    const formData = new FormData();
    formData.append(
      "action",
      editingEvent ? "update-optimization" : "create-optimization",
    );
    if (editingEvent) formData.append("id", editingEvent.id);
    formData.append("title", title);
    formData.append("description", description);
    formData.append("category", category);
    formData.append("scope", scope);
    formData.append("pagePath", pagePath);
    formData.append("implementedAt", implementedAt);
    formData.append("endedAt", endedAt);
    eventFetcher.submit(formData, {
      method: "POST",
      action: "/api/dashboard-conversion",
    });
  };

  const deleteEvent = (event: ProgressTimelineEvent) => {
    if (
      !window.confirm(`Delete “${event.title}” from the optimization timeline?`)
    )
      return;
    const formData = new FormData();
    formData.append("action", "delete-optimization");
    formData.append("id", event.id);
    eventFetcher.submit(formData, {
      method: "POST",
      action: "/api/dashboard-conversion",
    });
  };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start" gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingXl" fontWeight="semibold">
              Conversion progress
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Store conversion rate over time, with your CRO work shown in
              context.
            </Text>
          </BlockStack>
          <InlineStack gap="200" blockAlign="center" wrap>
            <div
              style={{
                width: 190,
              }}
            >
              <Select
                label="Date range"
                labelHidden
                options={PERIOD_OPTIONS}
                value={period}
                disabled={isLoading}
                onChange={(value) => changePeriod(value as ConversionPeriod)}
              />
            </div>
            <Button variant="primary" onClick={openCreate}>
              Log optimization
            </Button>
          </InlineStack>
        </InlineStack>

        <div
          style={{
            background: "#eaf4ff",
            border: "1px solid #d4e5f3",
            borderRadius: 18,
            padding: "20px 20px 16px",
          }}
        >
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="start" gap="300">
              <BlockStack gap="100">
                <Text as="h3" variant="headingMd" fontWeight="semibold">
                  Conversion rate over time
                </Text>
                <InlineStack gap="200" blockAlign="center" wrap>
                  <Text as="p" variant="heading2xl" fontWeight="bold">
                    {progress.status === "ready"
                      ? formatRate(progress.currentRate)
                      : "—"}
                  </Text>
                  {progress.status === "ready" ? (
                    <Text
                      as="p"
                      variant="bodyMd"
                      fontWeight="semibold"
                      tone={
                        progress.deltaPoints > 0
                          ? "success"
                          : progress.deltaPoints < 0
                            ? "critical"
                            : "subdued"
                      }
                    >
                      {formatComparison(
                        progress.currentRate,
                        progress.previousRate,
                      )}
                    </Text>
                  ) : null}
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {progress.periodLabel} · {progress.currentLabel}
                </Text>
              </BlockStack>
              <Badge tone="info">Shopify Analytics</Badge>
            </InlineStack>

            {progress.status === "ready" ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "rgba(255, 255, 255, 0.68)",
                  border: "1px solid #d8e7f2",
                }}
              >
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    What this rate means
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {progress.currentSessions > 0
                      ? `${formatCount(progress.currentCompletedCheckouts)} checkout-completing sessions from ${formatCount(progress.currentSessions)} human online-store sessions.`
                      : "No human online-store sessions were recorded in this period."}
                  </Text>
                </BlockStack>
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    Previous comparison: {formatRate(progress.previousRate)}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Same elapsed length in the prior period ·{" "}
                    {progress.previousLabel}
                  </Text>
                </BlockStack>
              </div>
            ) : null}

            {progress.status !== "ready" ? (
              <div
                role="status"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid #c6dceb",
                  background: "rgba(255, 255, 255, 0.74)",
                }}
              >
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {progress.status === "missing_scope"
                      ? "This store still needs to approve report access"
                      : progress.status === "approval_required"
                        ? "Shopify app approval is still required"
                        : "Shopify Analytics is temporarily unavailable"}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {progress.message}
                  </Text>
                  {progress.status === "approval_required" ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      No additional store activity is needed. The Mouse
                      Whisperer app owner must complete this approval in Shopify
                      Partner Dashboard.
                    </Text>
                  ) : null}
                </BlockStack>
                {progress.status === "missing_scope" ? (
                  <Button
                    size="slim"
                    url={`/auth?shop=${encodeURIComponent(shop)}`}
                  >
                    Reconnect app
                  </Button>
                ) : null}
              </div>
            ) : null}

            <ConversionChart data={data} />

            {progress.status === "ready" && data.events.length ? (
              <InlineStack gap="300" blockAlign="center" wrap>
                {activityGroups[0].events.length ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      color: "#596b78",
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: "50%",
                        background: "#008060",
                      }}
                    />
                    Implemented optimization
                  </span>
                ) : null}
                {activityGroups[1].events.length ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      color: "#596b78",
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 9,
                        borderRadius: 2,
                        background: "rgba(124, 58, 237, 0.22)",
                        border: "1px solid rgba(124, 58, 237, 0.45)",
                      }}
                    />
                    A/B-test period
                  </span>
                ) : null}
                {activityGroups[2].events.length ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 9,
                      color: "#596b78",
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 1,
                        background: "#6d7175",
                        transform: "rotate(45deg)",
                      }}
                    />
                    Snapshot measurement
                  </span>
                ) : null}
                <Text as="span" variant="bodySm" tone="subdued">
                  Hover or focus a marker for details.
                </Text>
              </InlineStack>
            ) : null}
          </BlockStack>
        </div>

        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center" gap="300">
            <BlockStack gap="050">
              <Text as="h3" variant="headingMd">
                CRO activity
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Implemented changes, experiments, and measurements are kept
                separate so each event is interpreted correctly.
              </Text>
            </BlockStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {data.events.length} total in this period
            </Text>
          </InlineStack>

          <div
            style={{
              border: "1px solid var(--p-color-border-subdued)",
              borderRadius: 12,
              overflow: "hidden",
              background: "var(--p-color-bg-surface)",
            }}
          >
            <Tabs
              tabs={activityTabs}
              selected={selectedActivityTab}
              fitted
              onSelect={(index) => {
                setSelectedActivityTab(index);
                setActivityPage(1);
              }}
            >
              <div
                id={`${selectedActivityGroup.id}-panel`}
                style={{ padding: "0 16px 14px" }}
              >
                {visibleActivityEvents.length ? (
                  visibleActivityEvents.map((event) => (
                    <TimelineEventRow
                      key={event.id}
                      event={event}
                      onEdit={openEdit}
                      onDelete={deleteEvent}
                    />
                  ))
                ) : (
                  <div style={{ padding: "18px 0 6px" }}>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {selectedActivityGroup.emptyMessage}
                    </Text>
                  </div>
                )}

                {selectedActivityGroup.events.length > ACTIVITY_PAGE_SIZE ? (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      paddingTop: 14,
                    }}
                  >
                    <Pagination
                      label={`Page ${currentActivityPage} of ${totalActivityPages}`}
                      hasPrevious={currentActivityPage > 1}
                      onPrevious={() =>
                        setActivityPage((current) => Math.max(1, current - 1))
                      }
                      hasNext={currentActivityPage < totalActivityPages}
                      onNext={() =>
                        setActivityPage((current) =>
                          Math.min(totalActivityPages, current + 1),
                        )
                      }
                    />
                  </div>
                ) : null}
              </div>
            </Tabs>
          </div>
        </BlockStack>

        <Text as="p" variant="bodySm" tone="subdued">
          Timeline alignment shows correlation, not proof of causation. Use the
          A/B test report to measure causal lift.
        </Text>
      </BlockStack>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingEvent ? "Edit optimization" : "Log optimization"}
        primaryAction={{
          content: editingEvent ? "Save changes" : "Add to timeline",
          onAction: saveEvent,
          loading: isSaving,
          disabled: !title.trim() || !implementedAt,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            {eventFetcher.data?.ok === false && eventFetcher.data.error ? (
              <Banner tone="critical">
                <p>{eventFetcher.data.error}</p>
              </Banner>
            ) : null}
            <TextField
              label="What changed?"
              value={title}
              onChange={setTitle}
              maxLength={120}
              autoComplete="off"
              placeholder="e.g. Rewrote product-page value proposition"
            />
            <TextField
              label="Notes"
              value={description}
              onChange={setDescription}
              multiline={3}
              autoComplete="off"
              placeholder="What was changed and why?"
            />
            <Select
              label="Category"
              options={CATEGORY_OPTIONS}
              value={category}
              onChange={setCategory}
            />
            <Select
              label="Scope"
              options={[
                { label: "Whole store", value: "STORE" },
                { label: "Specific page", value: "PAGE" },
              ]}
              value={scope}
              onChange={setScope}
            />
            {scope === "PAGE" ? (
              <TextField
                label="Page path"
                value={pagePath}
                onChange={setPagePath}
                autoComplete="off"
                placeholder="/products/example"
              />
            ) : null}
            <FormLayout.Group>
              <TextField
                label="Implemented on"
                type="date"
                value={implementedAt}
                onChange={setImplementedAt}
                autoComplete="off"
              />
              <TextField
                label="Ended on (optional)"
                type="date"
                value={endedAt}
                onChange={setEndedAt}
                autoComplete="off"
              />
            </FormLayout.Group>
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Card>
  );
}
