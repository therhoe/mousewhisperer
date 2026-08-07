import { useId } from "react";
import { BlockStack, Card, InlineStack, Text } from "@shopify/polaris";
import type { DashboardActivityCard } from "../utils/dashboard-activity.server";

function chartPath(values: number[], maxValue: number) {
  if (!values.length) return "";

  const left = 12;
  const width = 576;
  const top = 10;
  const height = 82;

  return values
    .map((value, index) => {
      const x =
        values.length === 1
          ? left + width / 2
          : left + (index / (values.length - 1)) * width;
      const y = top + height - (Math.max(0, value) / maxValue) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function ComparisonAreaChart({ card }: { card: DashboardActivityCard }) {
  const gradientId = `resource-area-${useId().replace(/:/g, "")}`;
  const allValues = [...card.chart.current, ...card.chart.previous];
  const maxValue = Math.max(1, ...allValues) * 1.12;
  const currentPath = chartPath(card.chart.current, maxValue);
  const previousPath = chartPath(card.chart.previous, maxValue);
  const currentArea = currentPath ? `${currentPath} L588,104 L12,104 Z` : "";

  return (
    <div style={{ minHeight: 104 }}>
      {currentPath || previousPath ? (
        <svg
          viewBox="0 0 600 112"
          width="100%"
          height="88"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${card.chart.metricLabel} comparison for ${card.chart.contextLabel}`}
          style={{ display: "block" }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2c6ecb" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#2c6ecb" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[24, 64, 104].map((y) => (
            <line
              key={y}
              x1="12"
              x2="588"
              y1={y}
              y2={y}
              stroke="#e3e3e3"
              strokeWidth="1"
            />
          ))}
          {currentArea ? (
            <path d={currentArea} fill={`url(#${gradientId})`} />
          ) : null}
          {previousPath ? (
            <path
              d={previousPath}
              fill="none"
              stroke="#8c9196"
              strokeWidth="2"
              strokeDasharray="6 6"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {currentPath ? (
            <path
              d={currentPath}
              fill="none"
              stroke="#2463eb"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
      ) : (
        <div
          style={{
            height: 88,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderTop: "1px solid var(--p-color-border-subdued)",
            borderBottom: "1px solid var(--p-color-border-subdued)",
          }}
        >
          <Text as="p" variant="bodySm" tone="subdued">
            Comparison data will appear as visits are collected
          </Text>
        </div>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          color: "var(--p-color-text-subdued)",
          fontSize: 11,
          marginTop: 2,
        }}
      >
        <span>Start</span>
        <span>{card.chart.axisLabel}</span>
        <span>100%</span>
      </div>
    </div>
  );
}

export function ResourceActivityChart({
  card,
}: {
  card: DashboardActivityCard;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" gap="300">
          <BlockStack gap="050">
            <Text as="h2" variant="headingLg" fontWeight="semibold">
              {card.title} performance
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {card.scopeLabel}
            </Text>
          </BlockStack>
          <div
            style={{
              display: "flex",
              gap: 7,
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: card.runningCount > 0 ? "#008060" : "#8c9196",
              }}
            />
            <Text as="span" variant="bodySm" tone="subdued">
              {card.runningCount} {card.runningLabel}
            </Text>
          </div>
        </InlineStack>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            borderTop: "1px solid var(--p-color-border-subdued)",
            borderBottom: "1px solid var(--p-color-border-subdued)",
            padding: "10px 0",
          }}
        >
          {card.kpis.map((kpi, index) => (
            <div
              key={kpi.label}
              style={{
                minWidth: 0,
                padding: index === 0 ? "0 16px 0 0" : "0 16px",
                borderLeft:
                  index === 0
                    ? undefined
                    : "1px solid var(--p-color-border-subdued)",
              }}
            >
              <Text as="p" variant="bodySm" tone="subdued">
                {kpi.label}
              </Text>
              <div
                style={{
                  fontSize: 22,
                  lineHeight: "28px",
                  fontWeight: 650,
                  overflowWrap: "anywhere",
                }}
              >
                {kpi.value}
              </div>
            </div>
          ))}
        </div>

        <BlockStack gap="150">
          <InlineStack align="space-between" blockAlign="start" gap="300">
            <div style={{ minWidth: 0 }}>
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                {card.chart.metricLabel}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {card.chart.contextLabel}
              </Text>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexShrink: 0,
                fontSize: 11,
                color: "var(--p-color-text-subdued)",
              }}
            >
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <span style={{ width: 14, height: 2, background: "#2463eb" }} />
                {card.chart.currentLabel}
              </span>
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <span style={{ width: 14, borderTop: "2px dashed #8c9196" }} />
                {card.chart.previousLabel}
              </span>
            </div>
          </InlineStack>
          <ComparisonAreaChart card={card} />
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
