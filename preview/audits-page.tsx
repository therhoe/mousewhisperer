import React from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";
import {
  PROJECTS,
  CATEGORY_RESOURCE,
  CATEGORY_LABEL,
  rateMetric,
  type Category,
  type Project,
} from "./data";

// ══════════════════════════════════════════════════════
// DIFF INDICATOR — Shopify Analytics style
// e.g.  $9,566.74  ↗ 149%    ·    $67.72  ↘ 4%
// ══════════════════════════════════════════════════════

function DiffTag({ pct }: { pct: number | null }) {
  if (pct === null || !isFinite(pct)) return null;
  const rounded = Math.round(pct);
  if (rounded === 0) return null;
  const up = rounded > 0;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: up ? "#1a7f5a" : "#bf0711",
        marginLeft: 6,
        whiteSpace: "nowrap",
        letterSpacing: "0.01em",
      }}
    >
      {up ? "\u2197" : "\u2198"} {Math.abs(rounded)}%
    </span>
  );
}

function diffPct(value: number | undefined, baseline: number): number | null {
  if (value == null || baseline === 0) return null;
  return ((value - baseline) / baseline) * 100;
}

// ══════════════════════════════════════════════════════
// BASELINE CARD
// ══════════════════════════════════════════════════════

type Baseline = {
  rateLabel: string;
  avgRate: number;
  avgCvr: number;
  totalRevenue: number;
  avgRevenue: number;
  count: number;
};

function computeBaseline(rows: Project[], category: Category): Baseline {
  const rateLabel = category === "products" ? "ATC" : "CTR";
  const rates = rows
    .map((r) => (category === "products" ? r.atcRate : r.ctrRate))
    .filter((v): v is number => v != null);
  const avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  const avgCvr = rows.length ? rows.reduce((a, b) => a + b.cvrRate, 0) / rows.length : 0;
  const totalRevenue = rows.reduce((a, b) => a + b.revenue, 0);
  const avgRevenue = rows.length ? totalRevenue / rows.length : 0;
  return { rateLabel, avgRate, avgCvr, totalRevenue, avgRevenue, count: rows.length };
}

function BaselineCard({ baseline, category }: { baseline: Baseline; category: Category }) {
  const stat = (label: string, value: string, sub?: string) => (
    <div style={{ flex: 1, minWidth: 140 }}>
      <Text as="p" variant="bodySm" tone="subdued">
        {label}
      </Text>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
        <Text as="p" variant="headingLg" fontWeight="semibold">
          {value}
        </Text>
      </div>
      {sub && (
        <Text as="p" variant="bodySm" tone="subdued">
          {sub}
        </Text>
      )}
    </div>
  );

  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack gap="200" align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {CATEGORY_LABEL[category]} baseline
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Average across {baseline.count} audit{baseline.count === 1 ? "" : "s"}
          </Text>
        </InlineStack>
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap", marginTop: 8 }}>
          {stat(`Avg ${baseline.rateLabel}`, `${baseline.avgRate.toFixed(1)}%`)}
          {stat("Avg CVR", `${baseline.avgCvr.toFixed(1)}%`)}
          {stat("Avg revenue", `$${Math.round(baseline.avgRevenue).toLocaleString()}`)}
          {stat("Total revenue", `$${baseline.totalRevenue.toLocaleString()}`)}
        </div>
      </BlockStack>
    </Card>
  );
}

// ══════════════════════════════════════════════════════
// AUDIT ROW (diffs vs baseline)
// ══════════════════════════════════════════════════════

function AuditRow({
  p,
  baseline,
  isLast,
}: {
  p: Project;
  baseline: Baseline;
  isLast: boolean;
}) {
  const rate = rateMetric(p);
  const progressPct = Math.min(100, Math.round((p.realCount / p.targetVisitors) * 100));
  const isDone = progressPct >= 100;

  const rateDiff = diffPct(rate.value, baseline.avgRate);
  const cvrDiff = diffPct(p.cvrRate, baseline.avgCvr);
  const revDiff = diffPct(p.revenue, baseline.avgRevenue);

  return (
    <div
      style={{
        padding: "14px 20px",
        borderBottom: isLast ? "none" : "1px solid #ebebeb",
        cursor: "pointer",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--p-color-bg-surface-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        {/* Name + snapshot */}
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {p.productTitle}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {p.snapshotName}
            {p.snapshotCount > 1 ? ` \u00B7 ${p.snapshotCount} snapshots` : ""}
          </Text>
        </div>

        {/* Progress */}
        <div style={{ flex: "1 1 180px", maxWidth: 220 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <Text as="span" variant="bodySm" tone="subdued">
              {p.realCount}/{p.targetVisitors}
            </Text>
          </div>
          <div
            style={{
              height: 6,
              background: "#e4e5e7",
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progressPct}%`,
                background: isDone ? "#29845a" : "#2c6ecb",
                borderRadius: 3,
                transition: "width 0.3s",
              }}
            />
          </div>
        </div>

        {/* Metrics with diffs */}
        <div style={{ display: "flex", gap: 28, flexShrink: 0 }}>
          <div style={{ textAlign: "center", minWidth: 88 }}>
            <Text as="p" variant="bodySm" tone="subdued">
              {rate.label}
            </Text>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center" }}>
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {rate.value != null ? `${rate.value}%` : "\u2014"}
              </Text>
              <DiffTag pct={rateDiff} />
            </div>
          </div>
          <div style={{ textAlign: "center", minWidth: 88 }}>
            <Text as="p" variant="bodySm" tone="subdued">
              CVR
            </Text>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center" }}>
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {p.cvrRate}%
              </Text>
              <DiffTag pct={cvrDiff} />
            </div>
          </div>
          <div style={{ textAlign: "center", minWidth: 112 }}>
            <Text as="p" variant="bodySm" tone="subdued">
              REV
            </Text>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center" }}>
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                ${p.revenue.toLocaleString()}
              </Text>
              <DiffTag pct={revDiff} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// AUDITS PAGE — parameterized by category
// ══════════════════════════════════════════════════════

export default function AuditsPage({ category }: { category: Category }) {
  const resource = CATEGORY_RESOURCE[category];
  const rows = PROJECTS.filter((p) => p.resourceType === resource);
  const baseline = computeBaseline(rows, category);

  return (
    <Page title={CATEGORY_LABEL[category]} subtitle={`Audit baselines and per-page comparison`}>
      <Layout>
        <Layout.Section>
          {rows.length === 0 ? (
            <Card>
              <Text as="p" variant="bodyMd" tone="subdued">
                No {category} audits yet.
              </Text>
            </Card>
          ) : (
            <BaselineCard baseline={baseline} category={category} />
          )}
        </Layout.Section>

        {rows.length > 0 && (
          <Layout.Section>
            <Card padding="0">
              {rows.map((p, idx) => (
                <AuditRow
                  key={p.id}
                  p={p}
                  baseline={baseline}
                  isLast={idx === rows.length - 1}
                />
              ))}
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}

