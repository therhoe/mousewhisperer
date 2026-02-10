import { Card, BlockStack, InlineStack, Text } from "@shopify/polaris";
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

function SolvedStamp() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 10px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        color: "#1a7b3d",
        background: "#e3f5eb",
        border: "1.5px solid #b0dfc2",
      }}
    >
      <span style={{ fontSize: 14 }}>&#10003;</span> Solved
    </span>
  );
}

function StatPill({ icon, value }: { icon: string; value: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 8px",
        borderRadius: 10,
        fontSize: 12,
        color: "var(--p-color-text-secondary)",
        background: "var(--p-color-bg-surface-secondary)",
      }}
    >
      {icon} {value}
    </span>
  );
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
      <div
        style={{
          borderLeft: hasAcceptedAnswer ? "3px solid #1a7b3d" : "3px solid transparent",
          borderRadius: "var(--p-border-radius-200)",
        }}
      >
        <Card>
          <BlockStack gap="300">
            {/* Top row: author + time */}
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <span style={{ fontSize: "1.4rem" }}>{profile.avatarEmoji || "🐭"}</span>
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
              <InlineStack gap="200" blockAlign="center">
                {isBookmarked && (
                  <span style={{ fontSize: 14, opacity: 0.6 }}>🔖</span>
                )}
                <Text as="span" variant="bodySm" tone="subdued">
                  {timeAgo(createdAt)}
                </Text>
              </InlineStack>
            </InlineStack>

            {/* Title + solved stamp */}
            <InlineStack gap="300" blockAlign="center" wrap>
              <Text as="h3" variant="headingSm">{title}</Text>
              {hasAcceptedAnswer && <SolvedStamp />}
            </InlineStack>

            {/* Content preview */}
            {contentPreview && (
              <Text as="p" variant="bodySm" tone="subdued" truncate>
                {contentPreview}
              </Text>
            )}

            {/* Footer: category + stat pills */}
            <InlineStack gap="200" blockAlign="center" wrap>
              <CategoryBadge category={category} />
              <span style={{ flexGrow: 1 }} />
              <StatPill icon="🙋" value={meTooCount} />
              <StatPill icon="💬" value={answerCount} />
              <StatPill icon="👁" value={viewCount} />
            </InlineStack>
          </BlockStack>
        </Card>
      </div>
    </Link>
  );
}
