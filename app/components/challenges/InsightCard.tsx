import { useState } from "react";
import { Card, Text, Badge, Button, TextField, InlineStack, BlockStack } from "@shopify/polaris";
import { Link } from "@remix-run/react";
import { CategoryBadge } from "./CategoryBadge";
import type { InsightCategory } from "@prisma/client";

interface Answer {
  id: string;
  content: string;
  upvoteCount: number;
  isAccepted: boolean;
  createdAt: string;
  profile: {
    displayName: string;
    avatarEmoji: string | null;
    avatarUrl?: string | null;
    reputation?: number;
  };
}

interface ChallengeCardProps {
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
  imageUrl?: string | null;
  projectId?: string | null;
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
  answers?: Answer[];
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

function AvatarIcon({ profile, size = 32 }: { profile: { avatarEmoji: string | null; avatarUrl?: string | null; displayName: string }; size?: number }) {
  if (profile.avatarUrl) {
    return <img src={profile.avatarUrl} alt={profile.displayName} style={{ width: size, height: size, borderRadius: size * 0.25, objectFit: "cover", imageRendering: "pixelated" as any }} />;
  }
  return <span style={{ fontSize: size * 0.75 }}>{profile.avatarEmoji || "\uD83D\uDC2D"}</span>;
}

const LINK_STYLE: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: "#2c6ecb", textDecoration: "none",
  display: "inline-flex", alignItems: "center", gap: 4,
};

export function InsightCard({
  id, title, contentPreview, category,
  answerCount, meTooCount, viewCount,
  hasAcceptedAnswer, isBookmarked, createdAt,
  imageUrl, projectId,
  profile, snapshotStats, answers = [],
}: ChallengeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [replyText, setReplyText] = useState("");
  const level = getLevel(profile.reputation || 0);
  const hasImage = !!imageUrl;

  return (
    <Card padding="0">
      {/* Author row */}
      <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <InlineStack gap="200" blockAlign="center">
          <AvatarIcon profile={profile} />
          <Text as="span" variant="bodySm" fontWeight="semibold">{profile.displayName}</Text>
          <Badge tone="info">LVL {level}</Badge>
          <Text as="span" variant="bodySm" tone="subdued">{"\u00B7"} {timeAgo(createdAt)}</Text>
        </InlineStack>
        <InlineStack gap="200" blockAlign="center">
          {hasAcceptedAnswer && <Badge tone="success">Solved</Badge>}
        </InlineStack>
      </div>

      {/* Image + 2x2 Metrics row */}
      <div style={{ display: "flex", gap: 0, alignItems: "stretch", minHeight: hasImage ? 180 : 80 }}>
        <div style={{
          flex: 1, position: "relative", background: "#f6f6f7", overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {hasImage ? (
            <img src={imageUrl!} alt={title} style={{ width: "auto", height: "100%", objectFit: "contain", display: "block" }} />
          ) : (
            <Text as="span" variant="bodyMd" tone="subdued">{category === "SOURCE_QUALITY" || category === "HIGH_BOT_TRAFFIC" ? "Collection" : "Product"}</Text>
          )}
          <div style={{ position: "absolute", top: 12, left: 12 }}>
            <CategoryBadge category={category} />
          </div>
        </div>

        {snapshotStats && (
          <div style={{ flex: "0 0 180px", padding: 12, display: "flex", alignItems: "stretch" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, rowGap: 10, background: "#f6f6f7", borderRadius: 8, padding: "8px 6px", width: "100%" }}>
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodySm" tone="subdued">CTR</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">{snapshotStats.addToCartRate ?? 0}%</Text>
              </div>
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodySm" tone="subdued">CVR</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">{snapshotStats.conversionRate ?? 0}%</Text>
              </div>
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodySm" tone="subdued">REV</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">${snapshotStats.totalSessions ?? 0}</Text>
              </div>
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodySm" tone="subdued">Real%</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">{snapshotStats.realPercent ?? 0}%</Text>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Content body */}
      <div style={{ padding: 16 }}>
        <BlockStack gap="300">
          <Link to={`/app/challenges/${id}`} style={{ textDecoration: "none", color: "inherit" }}>
            <Text as="h3" variant="headingMd" fontWeight="semibold">{title}</Text>
          </Link>
          <Text as="p" variant="bodySm">{contentPreview}</Text>

          {projectId && (
            <div>
              <Link to={`/app/project/${projectId}`} style={LINK_STYLE}>
                <span>{"\u2192"}</span> View results
              </Link>
            </div>
          )}

          {/* Engagement footer */}
          <div style={{ borderTop: "1px solid #e4e5e7", paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "#6d7175" }}>{"\uD83D\uDC41"} {viewCount}</span>
              <span style={{ fontSize: 13, color: meTooCount > 0 ? "#2c6ecb" : "#6d7175", fontWeight: meTooCount > 0 ? 600 : 400 }}>
                {"\uD83D\uDE4B"} {meTooCount} me too
              </span>
              <button onClick={() => setExpanded(!expanded)} style={{
                background: "none", border: "none", cursor: "pointer", padding: 0,
                fontSize: 13, color: expanded ? "#2c6ecb" : "#6d7175", fontWeight: expanded ? 600 : 400,
              }}>
                {"\uD83D\uDCAC"} {answerCount} answers
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Button size="slim" onClick={() => setExpanded(!expanded)}>Reply</Button>
              {isBookmarked && <span style={{ fontSize: 14, opacity: 0.6 }}>{"\uD83D\uDD16"}</span>}
            </div>
          </div>
        </BlockStack>
      </div>

      {/* Expanded answers */}
      {expanded && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid #e4e5e7" }}>
          <BlockStack gap="200">
            {answers.length === 0 && (
              <div style={{ paddingTop: 12 }}>
                <Text as="p" variant="bodySm" tone="subdued">No answers yet. Be the first to help!</Text>
              </div>
            )}
            {answers.map((answer) => {
              const ansLevel = getLevel(answer.profile.reputation || 0);
              return (
                <div key={answer.id} style={{
                  background: answer.isAccepted ? "#f1f8f5" : "#f6f6f7",
                  borderRadius: 8, padding: 12, marginTop: 8,
                  border: answer.isAccepted ? "1px solid #29845a" : "1px solid transparent",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <InlineStack gap="200" blockAlign="center">
                      <AvatarIcon profile={answer.profile} size={24} />
                      <Text as="span" variant="bodySm" fontWeight="semibold">{answer.profile.displayName}</Text>
                      <Badge tone="info">LVL {ansLevel}</Badge>
                      <Text as="span" variant="bodySm" tone="subdued">{timeAgo(answer.createdAt)}</Text>
                    </InlineStack>
                    {answer.isAccepted && <Badge tone="success">{"\u2713"} Accepted</Badge>}
                  </div>
                  <Text as="p" variant="bodySm">{answer.content}</Text>
                  <div style={{ marginTop: 6 }}>
                    <span style={{ fontSize: 13, color: "#6d7175" }}>{"\u25B2"} {answer.upvoteCount}</span>
                  </div>
                </div>
              );
            })}
            <div style={{ background: "#f6f6f7", borderRadius: 8, padding: 12, marginTop: 4 }}>
              <TextField label="" labelHidden value={replyText} onChange={setReplyText} placeholder="Write your answer..." multiline={3} autoComplete="off" />
              <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
                <Link to={`/app/challenges/${id}`} style={{ textDecoration: "none" }}>
                  <Button variant="primary" size="slim">Post Answer</Button>
                </Link>
              </div>
            </div>
          </BlockStack>
        </div>
      )}
    </Card>
  );
}
