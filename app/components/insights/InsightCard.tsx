import { Card, BlockStack, InlineStack, Text, Box } from "@shopify/polaris";
import { Link } from "@remix-run/react";
import { CategoryBadge } from "./CategoryBadge";
import type { InsightCategory } from "@prisma/client";

interface InsightCardProps {
  id: string;
  title: string;
  category: InsightCategory;
  answerCount: number;
  createdAt: string;
  profile: {
    displayName: string;
    avatarEmoji: string | null;
    storeCategory: string | null;
  };
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function InsightCard({ id, title, category, answerCount, createdAt, profile }: InsightCardProps) {
  return (
    <Link to={`/app/insights/${id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <Card>
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <Text as="span" variant="bodyLg">{profile.avatarEmoji || "🐭"}</Text>
              <BlockStack gap="0">
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  {profile.displayName}
                </Text>
                {profile.storeCategory && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    {profile.storeCategory}
                  </Text>
                )}
              </BlockStack>
            </InlineStack>
            <Text as="span" variant="bodySm" tone="subdued">
              {timeAgo(createdAt)}
            </Text>
          </InlineStack>

          <Text as="h3" variant="headingSm">{title}</Text>

          <InlineStack gap="300" blockAlign="center">
            <CategoryBadge category={category} />
            <Text as="span" variant="bodySm" tone="subdued">
              {answerCount} {answerCount === 1 ? "answer" : "answers"}
            </Text>
          </InlineStack>
        </BlockStack>
      </Card>
    </Link>
  );
}
