import { Card, BlockStack, InlineStack, InlineGrid, Text, ProgressBar } from "@shopify/polaris";

interface SnapshotStats {
  totalSessions: number;
  realPercent: number;
  zombiePercent: number;
  botPercent: number;
  avgTimeOnPage: number;
  avgScrollDepth: number;
  addToCartRate: number;
  conversionRate: number;
  topSourceCategories: { name: string; percent: number }[];
  deviceBreakdown: { type: string; percent: number }[];
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <InlineStack align="space-between" blockAlign="center">
      <Text as="span" variant="bodySm" tone="subdued">{label}</Text>
      <Text as="span" variant="bodySm" fontWeight="semibold">{value}</Text>
    </InlineStack>
  );
}

export function SnapshotStatsDisplay({ stats }: { stats: SnapshotStats }) {
  return (
    <BlockStack gap="300">
      <Text as="h3" variant="headingSm">Attached Stats</Text>
      <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
        {/* Card 1: Traffic Quality */}
        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" fontWeight="semibold">Traffic Quality</Text>
            <StatRow label="Total sessions" value={String(stats.totalSessions)} />
            <StatRow label="Real users" value={`${stats.realPercent}%`} />
            <ProgressBar progress={stats.realPercent} tone="success" size="small" />
            <StatRow label="Zombies" value={`${stats.zombiePercent}%`} />
            <ProgressBar progress={stats.zombiePercent} tone="highlight" size="small" />
            <StatRow label="Bots" value={`${stats.botPercent}%`} />
            <ProgressBar progress={stats.botPercent} tone="critical" size="small" />
          </BlockStack>
        </Card>

        {/* Card 2: Engagement & Conversions */}
        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" fontWeight="semibold">Engagement</Text>
            <StatRow label="Avg. time on page" value={`${stats.avgTimeOnPage}s`} />
            <StatRow label="Avg. scroll depth" value={`${stats.avgScrollDepth}%`} />
            <StatRow label="Add to cart rate" value={`${stats.addToCartRate}%`} />
            <StatRow label="Conversion rate" value={`${stats.conversionRate}%`} />
          </BlockStack>
        </Card>

        {/* Card 3: Sources & Devices */}
        <Card>
          <BlockStack gap="300">
            {stats.topSourceCategories.length > 0 && (
              <>
                <Text as="p" variant="bodySm" fontWeight="semibold">Top Sources</Text>
                {stats.topSourceCategories.map((s) => (
                  <StatRow key={s.name} label={s.name || "Direct"} value={`${s.percent}%`} />
                ))}
              </>
            )}
            {stats.deviceBreakdown.length > 0 && (
              <>
                <Text as="p" variant="bodySm" fontWeight="semibold">Devices</Text>
                {stats.deviceBreakdown.map((d) => (
                  <StatRow key={d.type} label={d.type || "Unknown"} value={`${d.percent}%`} />
                ))}
              </>
            )}
          </BlockStack>
        </Card>
      </InlineGrid>
    </BlockStack>
  );
}
