import { Card, BlockStack, InlineStack, Text, Divider } from "@shopify/polaris";

interface LeaderboardEntry {
  displayName: string;
  avatarEmoji: string | null;
  storeCategory: string | null;
  reputation: number;
  answerCount: number;
}

const RANK_BADGES = ["🥇", "🥈", "🥉"];

export function LeaderboardCard({ leaders }: { leaders: LeaderboardEntry[] }) {
  if (leaders.length === 0) return null;

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm">Top Contributors</Text>
        <Divider />
        {leaders.map((leader, i) => (
          <InlineStack key={i} align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <Text as="span" variant="bodyMd">
                {RANK_BADGES[i] || `${i + 1}.`}
              </Text>
              <Text as="span" variant="bodyMd">
                {leader.avatarEmoji || "🐭"}
              </Text>
              <BlockStack gap="0">
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  {leader.displayName}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {leader.answerCount} answers
                </Text>
              </BlockStack>
            </InlineStack>
            <Text as="span" variant="bodySm" fontWeight="bold">
              {leader.reputation} pts
            </Text>
          </InlineStack>
        ))}
      </BlockStack>
    </Card>
  );
}
