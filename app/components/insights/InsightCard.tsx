import { Card, BlockStack, InlineStack, Text, Badge, Icon } from "@shopify/polaris";
import { Link } from "@remix-run/react";
import { CategoryBadge } from "./CategoryBadge";
import type { InsightCategory } from "@prisma/client";

interface InsightCardProps {
  id: string;
  title: string;
  contentPreview: string;
  category: InsightCategory;
  answerCount: number;
  meTooCount: number;
  viewCount: number;
  hasAcceptedAnswer: boolean;
  isBookmarked: boolean;
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

export function InsightCard({
  id,
  title,
  contentPreview,
  category,
  answerCount,
  meTooCount,
  viewCount,
  hasAcceptedAnswer,
  isBookmarked,
  createdAt,
  profile,
}: InsightCardProps) {
  return (
    <Link to={`/app/insights/${id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <Card>
        <BlockStack gap="300">
          {/* Author row */}
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

          {/* Title + badges */}
          <InlineStack gap="200" blockAlign="center" wrap>
            <Text as="h3" variant="headingSm">{title}</Text>
            {hasAcceptedAnswer && (
              <Badge tone="success">Solved</Badge>
            )}
          </InlineStack>

          {/* Content preview */}
          {contentPreview && (
            <Text as="p" variant="bodySm" tone="subdued" truncate>
              {contentPreview}
            </Text>
          )}

          {/* Footer stats */}
          <InlineStack gap="400" blockAlign="center" wrap>
            <CategoryBadge category={category} />
            <InlineStack gap="100" blockAlign="center">
              <Text as="span" variant="bodySm" tone="subdued">
                🙋 {meTooCount}
              </Text>
            </InlineStack>
            <Text as="span" variant="bodySm" tone="subdued">
              💬 {answerCount}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              👁 {viewCount}
            </Text>
            {isBookmarked && (
              <Text as="span" variant="bodySm" tone="subdued">
                🔖
              </Text>
            )}
          </InlineStack>
        </BlockStack>
      </Card>
    </Link>
  );
}
