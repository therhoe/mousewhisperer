import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AppProvider,
  Page,
  Layout,
  Card,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  IndexTable,
  Box,
  Divider,
  Button,
  ButtonGroup,
  ProgressBar,
  Select,
  Banner,
} from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";

// ══════════════════════════════════════════════════════
// HELPER FUNCTIONS (from app/routes/app.project.$id.tsx)
// ══════════════════════════════════════════════════════

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatExitType(type: string): string {
  const labels: Record<string, string> = {
    window_closed: "Closed Tab",
    back_button: "Back Button",
    idle: "Idle (2+ min)",
    internal_link: "Internal Link",
    external_link: "External Link",
    checkout: "Checkout/Cart",
    unknown: "Unknown",
  };
  return labels[type] || type;
}

function getSourceIcon(category: string): string {
  const icons: Record<string, string> = {
    Direct: "\u{1F310}",
    Internal: "\u{1F3E0}",
    "Paid Search": "\u{1F4B0}",
    "Paid Social": "\u{1F4B3}",
    "Organic Search": "\u{1F50D}",
    "Organic Social": "\u{1F4F1}",
    Referral: "\u{1F517}",
    Email: "\u{2709}\uFE0F",
    Unknown: "\u{2753}",
  };
  return icons[category] || "\u{1F310}";
}

function getDeviceIcon(device: string): string {
  const icons: Record<string, string> = {
    desktop: "\u{1F5A5}\uFE0F",
    mobile: "\u{1F4F1}",
    tablet: "\u{1F4BB}",
  };
  return icons[(device || "").toLowerCase()] || "\u{2753}";
}

// ══════════════════════════════════════════════════════
// REUSABLE COMPONENTS
// ══════════════════════════════════════════════════════

function StatCard({ title, value, subtitle, tone }: {
  title: string;
  value: string | number;
  subtitle?: string;
  tone?: "success" | "warning" | "critical";
}) {
  return (
    <Box padding="400" background="bg-surface-secondary" borderRadius="200">
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">{title}</Text>
        <InlineStack gap="200" align="start" blockAlign="center">
          <Text as="p" variant="headingLg">{value}</Text>
          {subtitle && <Badge tone={tone}>{subtitle}</Badge>}
        </InlineStack>
      </BlockStack>
    </Box>
  );
}

function ConversionFunnel({ stats, isCollection = false }: { stats: any; isCollection?: boolean }) {
  const stages = [
    { label: "All Sessions", value: stats.totalSessions, percent: 100, progressTone: "primary" as const },
    { label: "Real Users", value: stats.realCount, percent: stats.realPercent, badgeTone: "info" as const, progressTone: "highlight" as const },
    { label: isCollection ? "Quick Add" : "Added to Cart", value: stats.addToCartCount, percent: stats.atcRate || 0, badgeTone: "warning" as const, progressTone: "highlight" as const },
    { label: isCollection ? "Product" : "Conversions", value: isCollection ? stats.productClickCount : stats.conversionCount, percent: isCollection ? (stats.productClickPercent || 0) : (stats.convRate || 0), badgeTone: "success" as const, progressTone: "success" as const },
  ];

  return (
    <BlockStack gap="300">
      {stages.map((stage) => (
        <Box key={stage.label} paddingBlockEnd="200">
          <BlockStack gap="100">
            <InlineStack align="space-between">
              <Text as="span" variant="bodyMd">{stage.label}</Text>
              <InlineStack gap="200">
                <Text as="span" variant="bodyMd" fontWeight="semibold">{stage.value}</Text>
                <Badge tone={stage.badgeTone}>{`${stage.percent}%`}</Badge>
              </InlineStack>
            </InlineStack>
            <ProgressBar progress={stage.percent} size="small" tone={stage.progressTone} />
          </BlockStack>
        </Box>
      ))}
    </BlockStack>
  );
}

// ══════════════════════════════════════════════════════
// MOCK DATA
// ══════════════════════════════════════════════════════

const allSnapshotTrends = [
  { name: "Baseline", revenuePerVisitor: 0.26, aov: 0.20, atcRate: 16.8, convRate: 9.8 },
  { name: "Part Deux", revenuePerVisitor: 0.26, aov: 0.20, atcRate: 12, convRate: 39.6 },
  { name: "Número tres", revenuePerVisitor: 14.34, aov: 10.76, atcRate: 16.8, convRate: 23.2 },
  { name: "Round 4", revenuePerVisitor: 8.50, aov: 45.00, atcRate: 20.1, convRate: 18.5 },
  { name: "Round 5", revenuePerVisitor: 11.20, aov: 52.30, atcRate: 22.4, convRate: 21.0 },
  { name: "Round 6", revenuePerVisitor: 9.80, aov: 48.10, atcRate: 19.5, convRate: 17.2 },
  { name: "Round 7", revenuePerVisitor: 13.00, aov: 55.60, atcRate: 24.0, convRate: 25.1 },
];

const displayStats = {
  totalSessions: 380,
  realCount: 327,
  zombieCount: 3,
  botCount: 50,
  realPercent: 86,
  zombiePercent: 1,
  botPercent: 13,
  avgTimeOnPage: 142,
  avgScrollDepth: 67,
  addToCartCount: 55,
  conversionCount: 76,
  productClickCount: 38,
  productClickPercent: 10,
  atcRate: 16.8,
  convRate: 23.2,
  revenuePerVisitor: 14.34,
  aov: 61.80,
  topCountries: [
    { country: "United States", count: 180 },
    { country: "United Kingdom", count: 45 },
    { country: "Canada", count: 32 },
    { country: "Australia", count: 28 },
    { country: "Germany", count: 15 },
  ],
  topCities: [
    { city: "New York", count: 42 },
    { city: "London", count: 28 },
    { city: "Los Angeles", count: 24 },
    { city: "Toronto", count: 18 },
    { city: "Sydney", count: 14 },
  ],
  deviceBreakdown: [
    { device: "mobile", percent: 58 },
    { device: "desktop", percent: 35 },
    { device: "tablet", percent: 7 },
  ],
  exitPaths: [
    { type: "back_button", label: "Back Button", count: 120, percent: 36 },
    { type: "checkout", label: "Checkout/Cart", count: 76, percent: 23 },
    { type: "external_link", label: "External Link", count: 52, percent: 16 },
    { type: "idle", label: "Idle (2+ min)", count: 45, percent: 14 },
    { type: "window_closed", label: "Closed Tab", count: 37, percent: 11 },
  ],
  sourceStats: [
    { category: "Direct", sessions: 120, real: 105, zombie: 2, bot: 13, avgTime: 165, avgScroll: 72, atcRate: 18.5, convRate: 25.0, productClickRate: 12 },
    { category: "Paid Search", sessions: 85, real: 70, zombie: 1, bot: 14, avgTime: 130, avgScroll: 58, atcRate: 22.0, convRate: 30.0, productClickRate: 15 },
    { category: "Organic Search", sessions: 68, real: 62, zombie: 0, bot: 6, avgTime: 180, avgScroll: 75, atcRate: 15.0, convRate: 20.0, productClickRate: 9 },
    { category: "Organic Social", sessions: 52, real: 45, zombie: 0, bot: 7, avgTime: 95, avgScroll: 45, atcRate: 8.0, convRate: 12.0, productClickRate: 5 },
    { category: "Referral", sessions: 35, real: 30, zombie: 0, bot: 5, avgTime: 155, avgScroll: 68, atcRate: 14.0, convRate: 18.0, productClickRate: 8 },
    { category: "Email", sessions: 20, real: 15, zombie: 0, bot: 5, avgTime: 200, avgScroll: 80, atcRate: 25.0, convRate: 35.0, productClickRate: 18 },
  ],
  ctaByCategory: {
    Header: [
      { label: "Logo", count: 45 },
      { label: "Navigation Menu", count: 32 },
      { label: "Search Icon", count: 18 },
    ],
    Image: [
      { label: "Product Image 1", count: 120 },
      { label: "Product Image 2", count: 85 },
      { label: "Thumbnail Gallery", count: 42 },
    ],
    Button: [
      { label: "Add to Cart", count: 55 },
      { label: "Buy Now", count: 28 },
      { label: "Size Guide", count: 15 },
    ],
    Link: [
      { label: "Reviews Section", count: 38 },
      { label: "Shipping Info", count: 22 },
      { label: "Return Policy", count: 14 },
    ],
    Footer: [
      { label: "Contact Us", count: 8 },
      { label: "FAQ", count: 5 },
    ],
  },
  recentVisits: [
    { id: "v1", visitorType: "REAL", sourceCategory: "Direct", source: "direct", medium: null, campaign: null, deviceType: "mobile", timeOnPage: 185000, scrollDepth: 82, addedToCart: true, converted: true, orderValue: 65.00, exitType: "checkout", exitUrl: "https://shop.com/checkout", ctaClicks: JSON.stringify([{ tag: "img", label: "Product Image 1", href: null, time: 3200 }, { tag: "button", label: "Add to Cart", href: null, time: 12500 }]) },
    { id: "v2", visitorType: "REAL", sourceCategory: "Paid Search", source: "google", medium: "cpc", campaign: "spring-sale", deviceType: "desktop", timeOnPage: 92000, scrollDepth: 55, addedToCart: false, converted: false, orderValue: null, exitType: "back_button", exitUrl: null, ctaClicks: JSON.stringify([{ tag: "a", label: "Reviews Section", href: "#reviews", time: 5000 }]) },
    { id: "v3", visitorType: "REAL", sourceCategory: "Organic Search", source: "google", medium: "organic", campaign: null, deviceType: "mobile", timeOnPage: 245000, scrollDepth: 95, addedToCart: true, converted: true, orderValue: 128.50, exitType: "checkout", exitUrl: "https://shop.com/checkout", ctaClicks: JSON.stringify([{ tag: "img", label: "Product Image 2", href: null, time: 4100 }, { tag: "button", label: "Size Guide", href: null, time: 8200 }, { tag: "button", label: "Add to Cart", href: null, time: 15000 }]) },
    { id: "v4", visitorType: "BOT", sourceCategory: "Direct", source: null, medium: null, campaign: null, deviceType: "desktop", timeOnPage: 2000, scrollDepth: 0, addedToCart: false, converted: false, orderValue: null, exitType: "window_closed", exitUrl: null, ctaClicks: "[]" },
    { id: "v5", visitorType: "REAL", sourceCategory: "Email", source: "klaviyo", medium: "email", campaign: "newsletter-march", deviceType: "mobile", timeOnPage: 310000, scrollDepth: 100, addedToCart: true, converted: false, orderValue: null, exitType: "idle", exitUrl: null, ctaClicks: JSON.stringify([{ tag: "img", label: "Product Image 1", href: null, time: 2000 }, { tag: "a", label: "Shipping Info", href: "/policies/shipping", time: 6000 }, { tag: "button", label: "Add to Cart", href: null, time: 20000 }]) },
    { id: "v6", visitorType: "REAL", sourceCategory: "Organic Social", source: "instagram", medium: "social", campaign: null, deviceType: "mobile", timeOnPage: 48000, scrollDepth: 30, addedToCart: false, converted: false, orderValue: null, exitType: "external_link", exitUrl: "https://instagram.com", ctaClicks: JSON.stringify([{ tag: "img", label: "Thumbnail Gallery", href: null, time: 3000 }]) },
  ],
  searchStats: {
    filterUsageCount: 42,
    topQueries: [
      { query: "blue", count: 18 },
      { query: "large", count: 12 },
      { query: "sale", count: 8 },
    ],
    sortPreferences: [
      { sort: "best-selling", count: 65 },
      { sort: "price-low-to-high", count: 32 },
      { sort: "newest", count: 18 },
    ],
  },
};

const mockSnapshots = [
  { id: "s3", number: 3, name: "Número tres", status: "COMPLETED", targetVisitors: 500, realCount: 327, createdAt: "2026-03-15", completedAt: "2026-03-28" },
  { id: "s2", number: 2, name: "Part Deux", status: "COMPLETED", targetVisitors: 300, realCount: 300, createdAt: "2026-02-20", completedAt: "2026-03-05" },
  { id: "s1", number: 1, name: "Baseline", status: "COMPLETED", targetVisitors: 200, realCount: 200, createdAt: "2026-01-10", completedAt: "2026-01-25" },
];

// ══════════════════════════════════════════════════════
// TREND CHART CARD (redesigned)
// ══════════════════════════════════════════════════════

function TrendChartCard({ snapshotTrends }: { snapshotTrends: typeof allSnapshotTrends }) {
  const [activeMetrics, setActiveMetrics] = useState<Set<string>>(
    new Set(["revenuePerVisitor", "aov", "atcRate", "convRate"])
  );

  const allMetrics = [
    { key: "revenuePerVisitor" as const, label: "RPV", color: "#2C6ECB", format: (v: number) => `$${v.toFixed(2)}` },
    { key: "aov" as const, label: "AOV", color: "#8B5CF6", format: (v: number) => `$${v.toFixed(2)}` },
    { key: "atcRate" as const, label: "ATC %", color: "#059669", format: (v: number) => `${v}%` },
    { key: "convRate" as const, label: "Conv %", color: "#D97706", format: (v: number) => `${v}%` },
  ];

  const visibleMetrics = allMetrics.filter((m) => activeMetrics.has(m.key));
  const chartHeight = 220;
  const chartPadTop = 24;
  const chartPadBottom = 28;
  const barArea = chartHeight - chartPadTop - chartPadBottom;
  const globalMax = Math.max(
    ...visibleMetrics.flatMap((m) =>
      snapshotTrends.map((t) => t[m.key as keyof typeof t] as number)
    ),
    0.01
  );

  const maxVisibleSets = 5;
  const totalSets = snapshotTrends.length;
  const needsScroll = totalSets > maxVisibleSets;
  const svgRefWidth = 800;
  const setsInView = needsScroll ? totalSets : Math.min(totalSets, maxVisibleSets);
  const groupPadding = setsInView === 1 ? 0.25 : 0.12;
  const groupWidth = needsScroll ? svgRefWidth / maxVisibleSets : svgRefWidth / setsInView;
  const gap = groupWidth * groupPadding;
  const usableGroupWidth = groupWidth - gap;
  const totalSvgWidth = needsScroll ? totalSets * groupWidth : svgRefWidth;

  const maxBarWidth = 48;
  const barGap = 3;
  const rawBarWidth = visibleMetrics.length > 0
    ? (usableGroupWidth - (visibleMetrics.length - 1) * barGap) / visibleMetrics.length
    : 0;
  const barWidth = Math.min(rawBarWidth, maxBarWidth);
  const totalBarsWidth = visibleMetrics.length * barWidth + (visibleMetrics.length - 1) * barGap;

  const gridLineCount = 4;
  const gridLines = Array.from({ length: gridLineCount + 1 }, (_, i) => {
    const frac = i / gridLineCount;
    return { y: chartPadTop + barArea * (1 - frac), value: globalMax * frac };
  });

  return (
    <Card>
      <BlockStack gap="400">
        {/* Engaged Visitors & Bot Traffic summary */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ padding: "16px 20px", border: "1px solid var(--p-color-border-subdued)", borderRadius: 8 }}>
            <BlockStack gap="100">
              <Text as="span" variant="bodySm" tone="subdued">Engaged Visitors</Text>
              <Text as="span" variant="headingLg">{displayStats.realCount + displayStats.zombieCount}</Text>
            </BlockStack>
          </div>
          <div style={{ padding: "16px 20px", border: "1px solid var(--p-color-border-subdued)", borderRadius: 8 }}>
            <BlockStack gap="100">
              <Text as="span" variant="bodySm" tone="subdued">Bot Traffic</Text>
              <Text as="span" variant="headingLg">{displayStats.botCount}</Text>
            </BlockStack>
          </div>
        </div>

        {/* Bar chart */}
        <BlockStack gap="200">
          <div style={{
            position: "relative",
            border: "1px solid var(--p-color-border-subdued)",
            borderRadius: 8,
            padding: "12px 16px",
            overflowX: needsScroll ? "auto" : "hidden",
            overflowY: "hidden",
          }}>
            <svg
              width={needsScroll ? totalSvgWidth : "100%"}
              height={chartHeight}
              viewBox={`0 0 ${totalSvgWidth} ${chartHeight}`}
              preserveAspectRatio={needsScroll ? "none" : "xMidYMid meet"}
              style={{ display: "block" }}
            >
              {gridLines.map((line, i) => (
                <g key={`grid-${i}`}>
                  <line x1={0} y1={line.y} x2={totalSvgWidth} y2={line.y} stroke="#e5e7eb" strokeWidth={i === 0 ? 1 : 0.5} strokeDasharray={i === 0 ? "none" : "4 3"} />
                </g>
              ))}
              {snapshotTrends.map((t, si) => {
                const groupCenterX = si * groupWidth + groupWidth / 2;
                const barsStartX = groupCenterX - totalBarsWidth / 2;
                return (
                  <g key={si}>
                    {visibleMetrics.map((m, mi) => {
                      const val = t[m.key as keyof typeof t] as number;
                      const barH = Math.max((val / globalMax) * barArea, 2);
                      const x = barsStartX + mi * (barWidth + barGap);
                      const y = chartPadTop + barArea - barH;
                      return (
                        <g key={m.key}>
                          <rect x={x} y={y} width={barWidth} height={barH} fill={m.color} rx={3} opacity={0.85} />
                          {val > 0 && (
                            <text x={x + barWidth / 2} y={y - 5} textAnchor="middle" fontSize="10" fill={m.color} fontWeight="600">{m.format(val)}</text>
                          )}
                        </g>
                      );
                    })}
                    <text x={groupCenterX} y={chartHeight - 6} textAnchor="middle" fontSize="11" fill="#6b7280" fontWeight="500">{t.name}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        </BlockStack>

        {/* Metric toggle cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {[
            { key: "revenuePerVisitor", title: "Revenue per Visitor", value: `$${displayStats.revenuePerVisitor.toFixed(2)}`, color: "#2C6ECB" },
            { key: "aov", title: "AOV", value: `$${displayStats.aov.toFixed(2)}`, color: "#8B5CF6" },
            { key: "atcRate", title: "Add-to-Cart Rate", value: `${displayStats.atcRate}%`, color: "#059669" },
            { key: "convRate", title: "Conversion Rate", value: `${displayStats.convRate}%`, color: "#D97706" },
          ].map((card) => (
            <div
              key={card.key}
              onClick={() => {
                setActiveMetrics((prev) => {
                  const next = new Set(prev);
                  if (next.has(card.key) && next.size === 1) return new Set(["revenuePerVisitor", "aov", "atcRate", "convRate"]);
                  if (next.has(card.key) && next.size === 4) return new Set([card.key]);
                  if (next.has(card.key)) { next.delete(card.key); } else { next.add(card.key); }
                  return next;
                });
              }}
              style={{
                cursor: "pointer",
                borderRadius: 8,
                border: `2px solid ${activeMetrics.has(card.key) ? card.color : "transparent"}`,
                opacity: activeMetrics.has(card.key) ? 1 : 0.4,
                transition: "all 0.15s ease",
              }}
            >
              <StatCard title={card.title} value={card.value} />
            </div>
          ))}
        </div>
      </BlockStack>
    </Card>
  );
}

// ══════════════════════════════════════════════════════
// FULL PROJECT RESULTS PAGE
// ══════════════════════════════════════════════════════

function ProjectResultsPage() {
  const [setCount, setSetCount] = useState(3);
  const snapshotTrends = allSnapshotTrends.slice(0, setCount);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [expandedVisits, setExpandedVisits] = useState<Set<string>>(new Set());
  const [activeSource, setActiveSource] = useState("all");
  const [currentPage, setCurrentPage] = useState(0);

  const isCollection = false;
  const atcLabel = isCollection ? "Quick Add" : "Add to Cart";
  const convLabel = isCollection ? "Product" : "Conversions";
  const topCountries = displayStats.topCountries;
  const sourceStats = displayStats.sourceStats;
  const filteredRecentVisits = sourceFilter
    ? displayStats.recentVisits.filter((v) => v.sourceCategory === sourceFilter)
    : displayStats.recentVisits;

  return (
    <Page
      backAction={{ content: "Dashboard", url: "#" }}
      title="Premium Leather Wallet"
      titleMetadata={<Badge tone="info">Completed</Badge>}
      subtitle="327/500 real visitors"
    >
      <Layout>
        {/* ── Dev: Snapshot Count Toggle ── */}
        <Layout.Section>
          <Banner tone="info">
            <InlineStack gap="200" blockAlign="center">
              <Text as="span" variant="bodySm">Preview: chart sets</Text>
              {[1, 2, 3, 5, 7].map((n) => (
                <Button key={n} pressed={setCount === n} onClick={() => setSetCount(n)} size="micro">
                  {String(n)}
                </Button>
              ))}
            </InlineStack>
          </Banner>
        </Layout.Section>

        {/* ── Snapshot Selector ── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Snapshots</Text>
                <InlineStack gap="200">
                  <Button>Compare</Button>
                  <Button variant="primary">+ New Snapshot</Button>
                </InlineStack>
              </InlineStack>
              <Select
                label="Select snapshot"
                labelHidden
                options={mockSnapshots.map((s) => ({ label: `#${s.number} ${s.name || ""} (${s.status})`, value: s.id }))}
                value="s3"
                onChange={() => {}}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Source Filter Buttons ── */}
        <Layout.Section>
          <InlineStack gap="200" wrap>
            {[
              { label: "All Traffic", value: "all" },
              { label: "Paid", value: "paid" },
              { label: "Organic", value: "organic" },
              { label: "Direct", value: "direct" },
              { label: "Referral", value: "referral" },
              { label: "Email", value: "email" },
            ].map((filter) => (
              <Button key={filter.value} pressed={activeSource === filter.value} onClick={() => setActiveSource(filter.value)}>
                {filter.label}
              </Button>
            ))}
          </InlineStack>
        </Layout.Section>

        {/* ── Trend Chart Card (redesigned) ── */}
        <Layout.Section>
          <TrendChartCard snapshotTrends={snapshotTrends} />
        </Layout.Section>

        {/* ── Traffic Overview (aggregate + by source) ── */}
        <Layout.Section>
          <Card padding="0">
            <Box padding="400">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16 }}>
                <StatCard title="Real Users" value={displayStats.realCount} subtitle={`${displayStats.realPercent}%`} tone="success" />
                <StatCard title="Bots" value={displayStats.botCount} subtitle={`${displayStats.botPercent}%`} tone="critical" />
                <StatCard title="Avg Time" value={formatTime(displayStats.avgTimeOnPage)} />
                <StatCard title="Avg Scroll" value={`${displayStats.avgScrollDepth}%`} />
                <StatCard title={atcLabel} value={displayStats.addToCartCount} />
                <StatCard title={convLabel} value={displayStats.conversionCount} />
              </div>
            </Box>
            <Divider />
            <Box padding="400" paddingBlockEnd="200">
              <Text as="h3" variant="headingSm" tone="subdued">Traffic Quality by Source</Text>
            </Box>
            <IndexTable
              resourceName={{ singular: "source", plural: "sources" }}
              itemCount={sourceStats.length}
              headings={[
                { title: "Source" },
                { title: "Sessions" },
                { title: "Real" },
                { title: "Zombie" },
                { title: "Bot" },
                { title: "Avg Time" },
                { title: "Avg Scroll" },
                { title: isCollection ? "QA %" : "ATC %" },
                { title: isCollection ? "Prod %" : "Conv %" },
              ]}
              selectable={false}
            >
              {sourceStats.map((source, index) => (
                <IndexTable.Row
                  id={source.category}
                  key={source.category}
                  position={index}
                  onClick={() => setSourceFilter(sourceFilter === source.category ? null : source.category)}
                  selected={sourceFilter === source.category}
                >
                  <IndexTable.Cell>
                    <Text variant="bodyMd" fontWeight="semibold" as="span">
                      {getSourceIcon(source.category)} {source.category}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{source.sessions}</IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" tone="success">{source.real}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" tone="caution">{source.zombie}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" tone="critical">{source.bot}</Text></IndexTable.Cell>
                  <IndexTable.Cell>{formatTime(source.avgTime)}</IndexTable.Cell>
                  <IndexTable.Cell>{source.avgScroll}%</IndexTable.Cell>
                  <IndexTable.Cell>{source.atcRate}%</IndexTable.Cell>
                  <IndexTable.Cell>{isCollection ? source.productClickRate : source.convRate}%</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </Layout.Section>

        {/* ── Conversion Funnel + Exit Paths (side by side) ── */}
        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "stretch" }}>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Conversion Funnel</Text>
                <ConversionFunnel stats={displayStats} isCollection={isCollection} />
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Exit Paths</Text>
                <BlockStack gap="200">
                  {displayStats.exitPaths.map((item) => (
                    <InlineStack key={item.type} align="space-between">
                      <Text as="span">{item.label}</Text>
                      <InlineStack gap="100">
                        <Text as="span" tone="subdued">{item.count}</Text>
                        <Badge tone={item.type === "checkout" ? "success" : undefined}>{`${item.percent}%`}</Badge>
                      </InlineStack>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>

        {/* ── Top Countries / Cities / Devices ── */}
        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, alignItems: "stretch" }}>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Top Countries</Text>
                <BlockStack gap="200">
                  {topCountries.map((item) => (
                    <InlineStack key={item.country} align="space-between">
                      <Text as="span">{item.country}</Text>
                      <Badge>{String(item.count)}</Badge>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Top Cities</Text>
                <BlockStack gap="200">
                  {displayStats.topCities.map((item) => (
                    <InlineStack key={item.city} align="space-between">
                      <Text as="span">{item.city}</Text>
                      <Badge>{String(item.count)}</Badge>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Devices</Text>
                {(() => {
                  const devices = displayStats.deviceBreakdown;
                  const colors: Record<string, string> = { mobile: "#2C6ECB", desktop: "#8B5CF6", tablet: "#059669" };
                  const radius = 40;
                  const circumference = 2 * Math.PI * radius;
                  let offset = 0;
                  return (
                    <BlockStack gap="300" inlineAlign="center">
                      <svg width="120" height="120" viewBox="0 0 120 120">
                        {devices.map((item) => {
                          const dashLength = (item.percent / 100) * circumference;
                          const dashGap = circumference - dashLength;
                          const currentOffset = offset;
                          offset += dashLength;
                          return (
                            <circle key={item.device} cx="60" cy="60" r={radius} fill="none" stroke={colors[item.device] || "#94A3B8"} strokeWidth="16" strokeDasharray={`${dashLength} ${dashGap}`} strokeDashoffset={-currentOffset} transform="rotate(-90 60 60)" />
                          );
                        })}
                      </svg>
                      <BlockStack gap="200">
                        {devices.map((item) => (
                          <InlineStack key={item.device} align="space-between" blockAlign="center">
                            <InlineStack gap="200" blockAlign="center">
                              <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: colors[item.device] || "#94A3B8" }} />
                              <Text as="span">{item.device}</Text>
                            </InlineStack>
                            <Badge>{`${item.percent}%`}</Badge>
                          </InlineStack>
                        ))}
                      </BlockStack>
                    </BlockStack>
                  );
                })()}
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>

        {/* ── Search & Filters ── */}
        <Layout.Section>
          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Filter Usage</Text>
                  <InlineStack align="space-between">
                    <Text as="span">Visits using filters</Text>
                    <Badge>{String(displayStats.searchStats.filterUsageCount)}</Badge>
                  </InlineStack>
                </BlockStack>
              </Card>
            </div>
            <div style={{ flex: 1 }}>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Top Search Queries</Text>
                  <BlockStack gap="200">
                    {displayStats.searchStats.topQueries.map((item) => (
                      <InlineStack key={item.query} align="space-between">
                        <Text as="span" variant="bodySm" truncate>"{item.query}"</Text>
                        <Badge>{String(item.count)}</Badge>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>
            </div>
            <div style={{ flex: 1 }}>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Sort Preferences</Text>
                  <BlockStack gap="200">
                    {displayStats.searchStats.sortPreferences.map((item) => (
                      <InlineStack key={item.sort} align="space-between">
                        <Text as="span" variant="bodySm">{item.sort.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}</Text>
                        <Badge>{String(item.count)}</Badge>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>
            </div>
          </div>
        </Layout.Section>


        {/* ── Source filter indicator ── */}
        {sourceFilter && (
          <Layout.Section>
            <Banner tone="info" onDismiss={() => setSourceFilter(null)}>
              <p>Showing visits from <strong>{sourceFilter}</strong></p>
            </Banner>
          </Layout.Section>
        )}

        {/* ── Click Map (DEPRECATED — to be replaced) ── */}
        <Layout.Section>
          <Card background="bg-surface-secondary">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Click Map</Text>
              {(() => {
                const ctaData = displayStats.ctaByCategory as Record<string, Array<{ label: string; count: number }>>;
                const categoryOrder = ["Header", "Image", "Button", "Link", "Widget", "Footer"];
                const categoryColors: Record<string, string> = {
                  Header: "#6366F1", Image: "#0EA5E9", Button: "#F59E0B",
                  Link: "#10B981", Widget: "#8B5CF6", Footer: "#64748B",
                };
                const activeCategories = categoryOrder.filter((cat) => ctaData[cat] && ctaData[cat].length > 0);
                const totalClicks = activeCategories.reduce((sum, cat) => sum + ctaData[cat].reduce((s, i) => s + i.count, 0), 0);
                return (
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(activeCategories.length, 6)}, 1fr)`, gap: 16 }}>
                    {activeCategories.map((cat) => {
                      const items = ctaData[cat] || [];
                      const catTotal = items.reduce((s, i) => s + i.count, 0);
                      const pct = totalClicks > 0 ? Math.round((catTotal / totalClicks) * 100) : 0;
                      return (
                        <div key={cat} style={{ borderLeft: `3px solid ${categoryColors[cat] || "#94A3B8"}`, paddingLeft: 12 }}>
                          <BlockStack gap="200">
                            <InlineStack align="space-between" blockAlign="center">
                              <Text as="span" variant="headingSm">{cat}</Text>
                              <Text as="span" variant="bodySm" tone="subdued">{catTotal} ({pct}%)</Text>
                            </InlineStack>
                            <BlockStack gap="100">
                              {items.slice(0, 8).map((item) => (
                                <InlineStack key={item.label} align="space-between" blockAlign="start">
                                  <Text as="span" variant="bodySm" breakWord>{item.label}</Text>
                                  <Text as="span" variant="bodySm" tone="subdued">{item.count}</Text>
                                </InlineStack>
                              ))}
                            </BlockStack>
                          </BlockStack>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Click Map v2 (experimental) ── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Engagement by Zone</Text>
              {(() => {
                const ctaData = displayStats.ctaByCategory as Record<string, Array<{ label: string; count: number }>>;
                const categoryOrder = ["Header", "Image", "Button", "Link", "Widget", "Footer"];
                const categoryColors: Record<string, string> = {
                  Header: "#6366F1", Image: "#0EA5E9", Button: "#F59E0B",
                  Link: "#10B981", Widget: "#8B5CF6", Footer: "#64748B",
                };
                const activeCategories = categoryOrder.filter((cat) => ctaData[cat] && ctaData[cat].length > 0);
                const catTotals = activeCategories.map((cat) => ({
                  cat,
                  total: ctaData[cat].reduce((s, i) => s + i.count, 0),
                  items: ctaData[cat],
                  color: categoryColors[cat] || "#94A3B8",
                }));
                const totalClicks = catTotals.reduce((s, c) => s + c.total, 0);

                // Donut chart
                const radius = 70;
                const circumference = 2 * Math.PI * radius;
                let offset = 0;

                return (
                  <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 32, alignItems: "start" }}>
                    {/* Donut chart */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                      <svg width="180" height="180" viewBox="0 0 180 180">
                        {catTotals.map((c) => {
                          const frac = totalClicks > 0 ? c.total / totalClicks : 0;
                          const dashLength = frac * circumference;
                          const dashGap = circumference - dashLength;
                          const currentOffset = offset;
                          offset += dashLength;
                          return (
                            <circle
                              key={c.cat}
                              cx="90" cy="90" r={radius}
                              fill="none"
                              stroke={c.color}
                              strokeWidth="24"
                              strokeDasharray={`${dashLength} ${dashGap}`}
                              strokeDashoffset={-currentOffset}
                              transform="rotate(-90 90 90)"
                            />
                          );
                        })}
                        {/* Center text */}
                        <text x="90" y="85" textAnchor="middle" fontSize="22" fontWeight="700" fill="#1a1a1a">{totalClicks}</text>
                        <text x="90" y="104" textAnchor="middle" fontSize="11" fill="#6b7280">total clicks</text>
                      </svg>

                      {/* Legend */}
                      <BlockStack gap="200">
                        {catTotals.map((c) => {
                          const pct = totalClicks > 0 ? Math.round((c.total / totalClicks) * 100) : 0;
                          return (
                            <InlineStack key={c.cat} gap="200" blockAlign="center">
                              <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: c.color, flexShrink: 0 }} />
                              <Text as="span" variant="bodySm">{c.cat}</Text>
                              <Text as="span" variant="bodySm" tone="subdued">{c.total} ({pct}%)</Text>
                            </InlineStack>
                          );
                        })}
                      </BlockStack>
                    </div>

                    {/* Horizontal bar breakdown per zone */}
                    <BlockStack gap="300">
                      {catTotals.map((c) => {
                        const pct = totalClicks > 0 ? Math.round((c.total / totalClicks) * 100) : 0;
                        return (
                          <BlockStack key={c.cat} gap="100">
                            <InlineStack align="space-between">
                              <InlineStack gap="200" blockAlign="center">
                                <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: c.color }} />
                                <Text as="span" variant="bodyMd" fontWeight="semibold">{c.cat}</Text>
                              </InlineStack>
                              <Text as="span" variant="bodySm" tone="subdued">{c.total} clicks ({pct}%)</Text>
                            </InlineStack>
                            {/* Individual items as horizontal bars */}
                            <div style={{ paddingLeft: 20 }}>
                              {c.items.slice(0, 5).map((item) => {
                                const itemPct = c.total > 0 ? (item.count / c.total) * 100 : 0;
                                return (
                                  <div key={item.label} style={{ display: "grid", gridTemplateColumns: "1fr 50px", gap: 8, alignItems: "center", marginBottom: 4 }}>
                                    <div style={{ position: "relative", height: 22, borderRadius: 4, backgroundColor: "var(--p-color-bg-surface-secondary)", overflow: "hidden" }}>
                                      <div style={{
                                        position: "absolute",
                                        top: 0, left: 0, bottom: 0,
                                        width: `${itemPct}%`,
                                        backgroundColor: c.color,
                                        opacity: 0.2,
                                        borderRadius: 4,
                                      }} />
                                      <div style={{ position: "relative", padding: "2px 8px", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {item.label}
                                      </div>
                                    </div>
                                    <Text as="span" variant="bodySm" tone="subdued" alignment="end">{item.count}</Text>
                                  </div>
                                );
                              })}
                              {c.items.length > 5 && (
                                <Text as="span" variant="bodySm" tone="subdued">+{c.items.length - 5} more</Text>
                              )}
                            </div>
                          </BlockStack>
                        );
                      })}
                    </BlockStack>
                  </div>
                );
              })()}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Recent Visits (combined table + expandable journeys) ── */}
        <Layout.Section>
          <Card padding="0">
            <Box padding="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Recent Visits {sourceFilter ? `\u2014 ${sourceFilter}` : ""}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">{filteredRecentVisits.length} visits</Text>
              </InlineStack>
            </Box>
            {(() => {
              const PAGE_SIZE = 15;
              const totalPages = Math.max(1, Math.ceil(filteredRecentVisits.length / PAGE_SIZE));
              const safeCurrentPage = Math.min(currentPage, totalPages - 1);
              const pageVisits = filteredRecentVisits.slice(safeCurrentPage * PAGE_SIZE, (safeCurrentPage + 1) * PAGE_SIZE);
              const gridCols = "40px 1fr 1fr 60px 65px 55px 50px 70px 1fr 30px";

              return (
                <div>
                  {/* Header row */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: gridCols,
                    gap: 8,
                    padding: "8px 16px",
                    borderBottom: "1px solid var(--p-color-border-subdued)",
                    backgroundColor: "var(--p-color-bg-surface-secondary)",
                  }}>
                    {["Device", "Source", "UTM", "Clicks", "Duration", "Scroll", "ATC", "Conv", "Exit", ""].map((h) => (
                      <Text key={h} as="span" variant="bodySm" tone="subdued" fontWeight="semibold">{h}</Text>
                    ))}
                  </div>

                  {/* Data rows */}
                  {pageVisits.map((visit) => {
                    const isExpanded = expandedVisits.has(visit.id);
                    const isPaid = (visit.sourceCategory || "").includes("Paid");
                    const ctaEntries: any[] = (() => {
                      try { return JSON.parse(visit.ctaClicks); } catch { return []; }
                    })();
                    const clickCount = ctaEntries.length;

                    return (
                      <div key={visit.id} style={{ borderBottom: "1px solid var(--p-color-border-subdued)" }}>
                        {/* Collapsed row */}
                        <div
                          onClick={() => setExpandedVisits((prev) => {
                            const next = new Set(prev);
                            next.has(visit.id) ? next.delete(visit.id) : next.add(visit.id);
                            return next;
                          })}
                          style={{
                            display: "grid",
                            gridTemplateColumns: gridCols,
                            gap: 8,
                            padding: "10px 16px",
                            cursor: "pointer",
                            alignItems: "center",
                            backgroundColor: isExpanded ? "var(--p-color-bg-surface-secondary)" : "transparent",
                            transition: "background-color 0.1s ease",
                          }}
                        >
                          {/* Device */}
                          <Text as="span" variant="bodySm">{getDeviceIcon(visit.deviceType || "")}</Text>
                          {/* Source */}
                          <InlineStack gap="100" blockAlign="center" wrap={false}>
                            <Text as="span" variant="bodySm" fontWeight="semibold">{visit.sourceCategory || "Direct"}</Text>
                            {isPaid && <Badge tone="info" size="small">Paid</Badge>}
                          </InlineStack>
                          {/* UTM */}
                          <BlockStack gap="050">
                            {visit.source && <Text as="span" variant="bodySm" tone="subdued">{visit.source}{visit.medium ? ` / ${visit.medium}` : ""}</Text>}
                            {visit.campaign && <Text as="span" variant="bodySm" tone="subdued">{visit.campaign}</Text>}
                          </BlockStack>
                          {/* Clicks */}
                          <Text as="span" variant="bodySm">{clickCount}</Text>
                          {/* Duration */}
                          <Text as="span" variant="bodySm">{formatTime(Math.round(visit.timeOnPage / 1000))}</Text>
                          {/* Scroll */}
                          <Text as="span" variant="bodySm">{visit.scrollDepth}%</Text>
                          {/* ATC */}
                          <div>{visit.addedToCart ? <Badge tone="success" size="small">Yes</Badge> : <Text as="span" tone="subdued">-</Text>}</div>
                          {/* Conv */}
                          <div>
                            {visit.converted
                              ? <Badge tone="success" size="small">{visit.orderValue ? `$${visit.orderValue.toFixed(0)}` : "Yes"}</Badge>
                              : <Text as="span" tone="subdued">-</Text>
                            }
                          </div>
                          {/* Exit */}
                          <BlockStack gap="050">
                            <Text as="span" variant="bodySm">{formatExitType(visit.exitType || "unknown")}</Text>
                            {visit.exitUrl && (
                              <Text as="span" variant="bodySm" tone="subdued" truncate>
                                {(() => { try { return new URL(visit.exitUrl).pathname; } catch { return visit.exitUrl; } })()}
                              </Text>
                            )}
                          </BlockStack>
                          {/* Chevron */}
                          <Text as="span" variant="bodySm" tone="subdued" alignment="end">{isExpanded ? "\u25B2" : "\u25BC"}</Text>
                        </div>

                        {/* Expanded journey detail */}
                        {isExpanded && (
                          <div style={{ padding: "12px 16px 16px", borderTop: "1px solid var(--p-color-border-subdued)", backgroundColor: "var(--p-color-bg-surface-secondary)" }}>
                            <BlockStack gap="200">
                              {/* PAGE entry */}
                              <InlineStack gap="200" blockAlign="start">
                                <Badge tone="info">PAGE</Badge>
                                <BlockStack gap="100">
                                  <Text as="span" variant="bodySm">/products/premium-leather-wallet</Text>
                                  <InlineStack gap="100" wrap>
                                    {visit.source && (
                                      <span style={{ fontSize: 11, padding: "2px 6px", backgroundColor: "var(--p-color-bg-surface)", borderRadius: 4 }}>source: {visit.source}</span>
                                    )}
                                    {visit.medium && (
                                      <span style={{ fontSize: 11, padding: "2px 6px", backgroundColor: "var(--p-color-bg-surface)", borderRadius: 4 }}>medium: {visit.medium}</span>
                                    )}
                                    {visit.campaign && (
                                      <span style={{ fontSize: 11, padding: "2px 6px", backgroundColor: "var(--p-color-bg-surface)", borderRadius: 4 }}>campaign: {visit.campaign}</span>
                                    )}
                                  </InlineStack>
                                </BlockStack>
                              </InlineStack>

                              {/* CTA click entries */}
                              {ctaEntries.map((cta: any, i: number) => (
                                <div key={i} style={{ paddingLeft: 8, borderLeft: "2px solid var(--p-color-border-subdued)" }}>
                                  <InlineStack gap="200" blockAlign="center">
                                    <Badge tone="attention">CLICK</Badge>
                                    <Text as="span" variant="bodySm">
                                      {"<"}{cta.tag}{">"} {cta.label}
                                      {cta.href ? ` \u2192 ${(() => { try { return new URL(cta.href).pathname; } catch { return cta.href; } })()}` : ""}
                                    </Text>
                                  </InlineStack>
                                </div>
                              ))}

                              {/* EXIT entry */}
                              {visit.exitType && (
                                <div style={{ paddingLeft: 8, borderLeft: "2px solid var(--p-color-border-subdued)" }}>
                                  <InlineStack gap="200" blockAlign="center">
                                    <Badge tone="critical">EXIT</Badge>
                                    <Text as="span" variant="bodySm">
                                      {formatExitType(visit.exitType)}
                                      {visit.exitUrl ? `: ${(() => { try { return new URL(visit.exitUrl).pathname; } catch { return visit.exitUrl; } })()}` : ""}
                                    </Text>
                                  </InlineStack>
                                </div>
                              )}
                            </BlockStack>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div style={{ padding: "12px 16px", display: "flex", justifyContent: "center", alignItems: "center", gap: 16 }}>
                      <Button disabled={safeCurrentPage === 0} onClick={() => setCurrentPage((p) => Math.max(0, p - 1))} size="micro">
                        Previous
                      </Button>
                      <Text as="span" variant="bodySm" tone="subdued">
                        Page {safeCurrentPage + 1} of {totalPages}
                      </Text>
                      <Button disabled={safeCurrentPage >= totalPages - 1} onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))} size="micro">
                        Next
                      </Button>
                    </div>
                  )}
                </div>
              );
            })()}
          </Card>
        </Layout.Section>

        {/* ── Danger Zone ── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Danger Zone</Text>
              <Text as="p" tone="subdued">Deleting this project will remove all snapshots and visit data.</Text>
              <Button tone="critical">Delete Project</Button>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

// ══════════════════════════════════════════════════════
// APP ENTRY
// ══════════════════════════════════════════════════════

function App() {
  return (
    <AppProvider i18n={{}}>
      <ProjectResultsPage />
    </AppProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
