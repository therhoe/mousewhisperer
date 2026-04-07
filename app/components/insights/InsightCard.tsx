import { Card, Text, Badge, Button } from "@shopify/polaris";
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
    avatarUrl?: string | null;
    reputation?: number;
  };
  snapshotStats?: {
    totalSessions?: number;
    realPercent?: number;
    addToCartRate?: number;
    conversionRate?: number;
  } | null;
}

function getLevel(rep: number) {
  if (rep >= 200) return 10;
  if (rep >= 150) return 9;
  if (rep >= 100) return 8;
  if (rep >= 75) return 7;
  if (rep >= 50) return 6;
  if (rep >= 35) return 5;
  if (rep >= 20) return 4;
  if (rep >= 10) return 3;
  if (rep >= 5) return 2;
  return 1;
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
  snapshotStats,
}: InsightCardProps) {
  const level = getLevel(profile.reputation || 0);
  const isImageAvatar = profile.avatarUrl?.startsWith("http");

  return (
    <Link to={`/app/insights/${id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <Card>
        {/* Header: Avatar+Name on left, LVL badge on right */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isImageAvatar ? (
              <img src={profile.avatarUrl!} alt={profile.displayName} style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover" }} />
            ) : (
              <span style={{ fontSize: 24 }}>{profile.avatarEmoji || "\uD83D\uDC2D"}</span>
            )}
            <Text as="span" variant="bodySm" fontWeight="semibold">{profile.displayName}</Text>
          </div>
          <Badge tone="info">LVL {level}</Badge>
        </div>

        {/* Body: Content */}
        <div style={{ marginBottom: 12 }}>
          {/* Title + Solved */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <Text as="span" variant="headingSm">{title}</Text>
            {hasAcceptedAnswer && <Badge tone="success">Solved</Badge>}
          </div>
          <div style={{ marginBottom: 8 }}>
            <CategoryBadge category={category} />
          </div>

          {/* Content preview */}
          {contentPreview && (
            <Text as="p" variant="bodySm" tone="subdued">
              {contentPreview}
            </Text>
          )}

          {/* Snapshot metrics */}
          {snapshotStats && (
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8,
              background: "#f6f6f7", borderRadius: 8, padding: "8px 4px", marginTop: 12,
            }}>
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodySm" tone="subdued">ATC</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">{snapshotStats.addToCartRate ?? 0}%</Text>
              </div>
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodySm" tone="subdued">CVR</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">{snapshotStats.conversionRate ?? 0}%</Text>
              </div>
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodySm" tone="subdued">Sessions</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">{snapshotStats.totalSessions ?? 0}</Text>
              </div>
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodySm" tone="subdued">Real%</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">{snapshotStats.realPercent ?? 0}%</Text>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: "1px solid #e4e5e7", paddingTop: 10,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#6d7175" }}>{"\uD83D\uDC41"} {viewCount}</span>
            <span style={{ fontSize: 13, color: "#6d7175" }}>{"\uD83D\uDE4B"} {meTooCount} me too</span>
            <span style={{ fontSize: 13, color: "#6d7175" }}>{"\uD83D\uDCAC"} {answerCount} answers</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button size="slim">Reply</Button>
            {isBookmarked && <span style={{ fontSize: 14, opacity: 0.6 }}>{"\uD83D\uDD16"}</span>}
          </div>
        </div>
      </Card>
    </Link>
  );
}
