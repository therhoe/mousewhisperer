import { useState } from "react";
import { Card, Text, Badge, Button, TextField } from "@shopify/polaris";
import { Link, useSubmit } from "@remix-run/react";
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
    return <img src={profile.avatarUrl} alt={profile.displayName} style={{ width: size, height: size, borderRadius: size * 0.25, objectFit: "cover", imageRendering: "pixelated" }} />;
  }
  return <span style={{ fontSize: size * 0.75 }}>{profile.avatarEmoji || "\uD83D\uDC2D"}</span>;
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
  answers = [],
}: InsightCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [replyText, setReplyText] = useState("");
  const level = getLevel(profile.reputation || 0);

  // Determine page type placeholder color
  const isCollection = category === "SOURCE_QUALITY" || category === "HIGH_BOT_TRAFFIC";
  const placeholderBg = isCollection ? "#f8e8e8" : "#e8f4f8";
  const placeholderText = isCollection ? "Collection Page" : "Product Page";

  return (
    <Card>
      {/* Header: Avatar + Name + LVL on left */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <AvatarIcon profile={profile} />
        <Text as="span" variant="bodySm" fontWeight="semibold">{profile.displayName}</Text>
        <Badge tone="info">LVL {level}</Badge>
      </div>

      {/* Body: Screenshot left (30%) + Content right (70%) */}
      <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
        {/* Page screenshot placeholder */}
        <Link to={`/app/insights/${id}`} style={{ textDecoration: "none", flex: "0 0 30%", display: "block" }}>
          <div style={{
            borderRadius: 8, overflow: "hidden", background: placeholderBg,
            aspectRatio: "16/10", minHeight: 120,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Text as="span" variant="headingMd" fontWeight="bold">{placeholderText}</Text>
          </div>
        </Link>

        {/* Content side */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <Link to={`/app/insights/${id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Text as="span" variant="headingSm">{title}</Text>
                {hasAcceptedAnswer && <Badge tone="success">Solved</Badge>}
              </div>
            </Link>
            <div style={{ marginTop: 4 }}>
              <CategoryBadge category={category} />
            </div>
          </div>

          <Text as="p" variant="bodySm">{contentPreview}</Text>

          {/* Metrics bar */}
          {snapshotStats && (
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8,
              background: "#f6f6f7", borderRadius: 8, padding: "8px 4px", marginTop: "auto",
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
      </div>

      {/* Footer */}
      <div style={{
        borderTop: "1px solid #e4e5e7", paddingTop: 10,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#6d7175" }}>{"\uD83D\uDC41"} {viewCount}</span>
          <span style={{ fontSize: 13, color: "#6d7175" }}>{"\uD83D\uDE4B"} {meTooCount} me too</span>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: 0,
              fontSize: 13, color: expanded ? "#2c6ecb" : "#6d7175",
              fontWeight: expanded ? 600 : 400,
            }}
          >
            {"\uD83D\uDCAC"} {answerCount} answers
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button size="slim" onClick={() => setExpanded(!expanded)}>Reply</Button>
          {isBookmarked && <span style={{ fontSize: 14, opacity: 0.6 }}>{"\uD83D\uDD16"}</span>}
        </div>
      </div>

      {/* Expanded: Inline answers + reply */}
      {expanded && (
        <div style={{ marginTop: 12, borderTop: "1px solid #e4e5e7", paddingTop: 12 }}>
          {answers.length === 0 && (
            <Text as="p" variant="bodySm" tone="subdued">No answers yet. Be the first to help!</Text>
          )}

          {answers.map((answer) => {
            const ansLevel = getLevel(answer.profile.reputation || 0);
            return (
              <div
                key={answer.id}
                style={{
                  background: answer.isAccepted ? "#f1f8f5" : "#f6f6f7",
                  borderRadius: 8, padding: 12, marginBottom: 8,
                  border: answer.isAccepted ? "1px solid #29845a" : "1px solid transparent",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <AvatarIcon profile={answer.profile} size={24} />
                    <Text as="span" variant="bodySm" fontWeight="semibold">{answer.profile.displayName}</Text>
                    <Badge tone="info">LVL {ansLevel}</Badge>
                    <Text as="span" variant="bodySm" tone="subdued">{timeAgo(answer.createdAt)}</Text>
                  </div>
                  {answer.isAccepted && <Badge tone="success">{"\u2713"} Accepted</Badge>}
                </div>
                <Text as="p" variant="bodySm">{answer.content}</Text>
                <div style={{ marginTop: 6 }}>
                  <span style={{ fontSize: 13, color: "#6d7175" }}>{"\u25B2"} {answer.upvoteCount}</span>
                </div>
              </div>
            );
          })}

          {/* Reply textarea */}
          <div style={{ background: "#f6f6f7", borderRadius: 8, padding: 12, marginTop: 4 }}>
            <TextField
              label=""
              labelHidden
              value={replyText}
              onChange={setReplyText}
              placeholder="Write your answer..."
              multiline={3}
              autoComplete="off"
            />
            <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
              <Link to={`/app/insights/${id}`} style={{ textDecoration: "none" }}>
                <Button variant="primary" size="slim">Post Answer</Button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
