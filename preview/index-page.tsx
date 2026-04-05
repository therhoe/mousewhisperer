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
  Box,
  Divider,
  Button,
  ButtonGroup,
  Popover,
  Modal,
  ChoiceList,
  FormLayout,
  TextField,
} from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";

// ══════════════════════════════════════════════════════
// MOCK DATA (from real store screenshot + enriched)
// ══════════════════════════════════════════════════════

type Project = {
  id: string;
  productTitle: string;
  resourceType: "PRODUCT" | "COLLECTION";
  status: string;
  snapshotName: string;
  snapshotCount: number;
  targetVisitors: number;
  realCount: number;
  zombieCount: number;
  botCount: number;
  progress: number;
  // Metrics — Products use ATC, others use CTR
  atcRate?: number;   // Add to Cart % (products)
  ctrRate?: number;   // Click-through % (collections/pages/blogs)
  cvrRate: number;    // Conversion %
  revenue: number;    // Total revenue $
};

const PROJECTS: Project[] = [
  {
    id: "p1",
    productTitle: "Footwear",
    resourceType: "COLLECTION",
    status: "COMPLETED",
    snapshotName: "Baseline",
    snapshotCount: 1,
    targetVisitors: 500,
    realCount: 500,
    zombieCount: 129,
    botCount: 13,
    progress: 100,
    ctrRate: 12.4,
    cvrRate: 3.2,
    revenue: 4850,
  },
  {
    id: "p2",
    productTitle: "Correct Toes\u00AE The Original Toe Spacer",
    resourceType: "PRODUCT",
    status: "COMPLETED",
    snapshotName: "Numero tres",
    snapshotCount: 3,
    targetVisitors: 250,
    realCount: 250,
    zombieCount: 80,
    botCount: 3,
    progress: 100,
    atcRate: 18.5,
    cvrRate: 6.8,
    revenue: 12340,
  },
  {
    id: "p3",
    productTitle: "Correct Toes\u00AE The Original",
    resourceType: "COLLECTION",
    status: "COMPLETED",
    snapshotName: "Testing",
    snapshotCount: 2,
    targetVisitors: 100,
    realCount: 100,
    zombieCount: 51,
    botCount: 2,
    progress: 100,
    ctrRate: 8.1,
    cvrRate: 2.1,
    revenue: 1520,
  },
  {
    id: "p4",
    productTitle: "Accessories",
    resourceType: "COLLECTION",
    status: "COMPLETED",
    snapshotName: "Test",
    snapshotCount: 1,
    targetVisitors: 100,
    realCount: 100,
    zombieCount: 43,
    botCount: 5,
    progress: 100,
    ctrRate: 15.3,
    cvrRate: 4.5,
    revenue: 2100,
  },
  {
    id: "p5",
    productTitle: "Closeout Sale | The Original Toe Spacer",
    resourceType: "PRODUCT",
    status: "COMPLETED",
    snapshotName: "Test",
    snapshotCount: 1,
    targetVisitors: 100,
    realCount: 100,
    zombieCount: 25,
    botCount: 7,
    progress: 100,
    atcRate: 9.2,
    cvrRate: 2.8,
    revenue: 890,
  },
  {
    id: "p6",
    productTitle: "Correct Toes StableToe\u00AE",
    resourceType: "PRODUCT",
    status: "COMPLETED",
    snapshotName: "Testing Conversion",
    snapshotCount: 3,
    targetVisitors: 250,
    realCount: 250,
    zombieCount: 76,
    botCount: 9,
    progress: 100,
    atcRate: 14.2,
    cvrRate: 5.1,
    revenue: 8750,
  },
  {
    id: "p7",
    productTitle: "Correct Toes SPORT\u00AE",
    resourceType: "PRODUCT",
    status: "COMPLETED",
    snapshotName: "+VidLibrary",
    snapshotCount: 4,
    targetVisitors: 500,
    realCount: 500,
    zombieCount: 10,
    botCount: 13,
    progress: 100,
    atcRate: 22.1,
    cvrRate: 8.4,
    revenue: 28900,
  },
];

const MOCK_DATA = {
  activeCount: 0,
  completedCount: 15,
  profile: {
    avatarEmoji: "\uD83D\uDD25",
    displayName: "Correct Toes",
    reputation: 40,
    answersCount: 5,
    insightsCount: 5,
  },
  trendingInsights: [
    { id: "t1", title: "Ok Test 3" },
    { id: "t2", title: "OG Toe Spacer" },
  ],
  notifications: [
    { id: "n1", type: "ANSWER_UPVOTED", title: "Answer upvoted", message: "Your answer on \"Why so many zombies!!\" was upvoted", isRead: false, createdAt: "2026-04-03T08:30:00Z" },
    { id: "n2", type: "INSIGHT_ANSWERED", title: "New answer", message: "Someone answered your insight", isRead: false, createdAt: "2026-04-03T07:15:00Z" },
    { id: "n3", type: "SNAPSHOT_COMPLETED", title: "Snapshot complete", message: "Footwear reached 500 real visitors", isRead: false, createdAt: "2026-04-02T22:00:00Z" },
    { id: "n4", type: "HIGH_BOT_TRAFFIC", title: "High bot traffic", message: "Accessories has 5% bot traffic", isRead: false, createdAt: "2026-04-02T18:00:00Z" },
    { id: "n5", type: "INSIGHT_METOOED", title: "Me too!", message: "Someone related to your insight", isRead: false, createdAt: "2026-04-02T14:00:00Z" },
    { id: "n6", type: "ANSWER_ACCEPTED", title: "Answer accepted", message: "Your answer was marked as accepted", isRead: false, createdAt: "2026-04-01T20:00:00Z" },
    { id: "n7", type: "ANSWER_UPVOTED", title: "Answer upvoted", message: "Your answer received an upvote", isRead: false, createdAt: "2026-04-01T16:00:00Z" },
    { id: "n8", type: "SNAPSHOT_COMPLETED", title: "Snapshot complete", message: "StableToe\u00AE reached 250 visitors", isRead: false, createdAt: "2026-04-01T10:00:00Z" },
    { id: "n9", type: "INSIGHT_ANSWERED", title: "New answer", message: "New answer on \"OG Toe Spacer\"", isRead: false, createdAt: "2026-03-31T09:00:00Z" },
  ],
  unreadCount: 9,
};

// ══════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════

const notifEmoji: Record<string, string> = {
  INSIGHT_ANSWERED: "\uD83D\uDCAC",
  ANSWER_UPVOTED: "\u2B06\uFE0F",
  ANSWER_ACCEPTED: "\u2705",
  INSIGHT_METOOED: "\uD83D\uDE4B",
  SNAPSHOT_COMPLETED: "\uD83C\uDFC1",
  HIGH_BOT_TRAFFIC: "\uD83E\uDD16",
};

function notifTimeAgo(dateStr: string): string {
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

function getQualityPercent(p: Project) {
  const total = p.realCount + p.zombieCount + p.botCount;
  if (total === 0) return { real: 0, zombie: 0, bot: 0 };
  return {
    real: Math.round((p.realCount / total) * 100),
    zombie: Math.round((p.zombieCount / total) * 100),
    bot: Math.round((p.botCount / total) * 100),
  };
}

// ══════════════════════════════════════════════════════
// STACKED BAR COMPONENT
// ══════════════════════════════════════════════════════

function StackedBar({ project, height = 8, width }: { project: Project; height?: number; width?: string }) {
  const q = getQualityPercent(project);
  return (
    <div
      style={{
        display: "flex",
        width: width || "100%",
        height,
        borderRadius: height / 2,
        overflow: "hidden",
        background: "#e4e5e7",
      }}
    >
      <div style={{ width: `${q.real}%`, background: "#29845a", transition: "width 0.3s" }} />
      <div style={{ width: `${q.zombie}%`, background: "#b98900", transition: "width 0.3s" }} />
      <div style={{ width: `${q.bot}%`, background: "#d72c0d", transition: "width 0.3s" }} />
    </div>
  );
}

// ══════════════════════════════════════════════════════
// TREND INDICATOR
// ══════════════════════════════════════════════════════

function TrendIndicator({ trend, detail }: { trend: string; detail: string }) {
  const arrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  const color = trend === "up" ? "#29845a" : trend === "down" ? "#d72c0d" : "#8c9196";
  return (
    <span style={{ color, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
      {arrow} {detail}
    </span>
  );
}

// ══════════════════════════════════════════════════════
// FINDING BADGE
// ══════════════════════════════════════════════════════

function FindingBadge({ finding, tone }: { finding: string; tone: string }) {
  const icon = tone === "success" ? "\u2705" : tone === "critical" ? "\uD83D\uDED1" : "\u26A0\uFE0F";
  const color = tone === "success" ? "#29845a" : tone === "critical" ? "#d72c0d" : "#b98900";
  return (
    <span style={{ color, fontSize: 13, fontWeight: 500 }}>
      {icon} {finding}
    </span>
  );
}

// ══════════════════════════════════════════════════════
// OPTION A: PROJECT CARDS LAYOUT
// ══════════════════════════════════════════════════════

function ProjectCardsLayout({ projects }: { projects: Project[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
        gap: 16,
      }}
    >
      {projects.map((p) => {
        const q = getQualityPercent(p);
        return (
          <div key={p.id} style={{ cursor: "pointer" }}>
            <Card>
              <BlockStack gap="300">
                {/* Header */}
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      <Text variant="headingSm" as="h3">
                        {p.productTitle}
                      </Text>
                    </InlineStack>
                    <InlineStack gap="200">
                      <Badge tone={p.resourceType === "COLLECTION" ? "info" : "success"}>
                        {p.resourceType === "COLLECTION" ? "Collection" : "Product"}
                      </Badge>
                      <Badge tone={p.status === "ACTIVE" ? "success" : "info"}>
                        {p.status === "ACTIVE" ? "Active" : "Completed"}
                      </Badge>
                    </InlineStack>
                  </BlockStack>
                </InlineStack>

                <Text as="span" variant="bodySm" tone="subdued">
                  {p.snapshotName}{p.snapshotCount > 1 ? ` · ${p.snapshotCount} snapshots` : ""}
                </Text>

                {/* Stacked bar + quality label */}
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      {q.real}% real traffic
                    </Text>
                    <TrendIndicator trend={p.trend} detail={p.trendDetail} />
                  </InlineStack>
                  <StackedBar project={p} height={10} />
                  <InlineStack gap="300">
                    <span style={{ fontSize: 12, color: "#29845a" }}>{"●"} {p.realCount} real</span>
                    <span style={{ fontSize: 12, color: "#b98900" }}>{"●"} {p.zombieCount} zombie</span>
                    <span style={{ fontSize: 12, color: "#d72c0d" }}>{"●"} {p.botCount} bot</span>
                  </InlineStack>
                </BlockStack>

                {/* Finding */}
                <FindingBadge finding={p.finding} tone={p.findingTone} />

                {/* Progress (for active only) */}
                {p.status === "ACTIVE" && (
                  <div style={{ background: "#f6f6f7", borderRadius: 8, padding: "8px 12px" }}>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">Progress</Text>
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {p.realCount} / {p.targetVisitors}
                      </Text>
                    </InlineStack>
                  </div>
                )}
              </BlockStack>
            </Card>
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// OPTION B: SMART TABLE LAYOUT
// ══════════════════════════════════════════════════════

function SmartTableLayout({ projects }: { projects: Project[] }) {
  return (
    <Card padding="0">
      {/* Table header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 140px 1.2fr 1fr 100px",
          gap: 8,
          padding: "12px 16px",
          borderBottom: "1px solid var(--p-color-border-subdued)",
          background: "var(--p-color-bg-surface-secondary)",
        }}
      >
        <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">Page</Text>
        <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">Quality</Text>
        <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">Finding</Text>
        <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">Trend</Text>
        <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">Status</Text>
      </div>

      {/* Rows */}
      {projects.map((p, idx) => {
        const q = getQualityPercent(p);
        return (
          <div
            key={p.id}
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 140px 1.2fr 1fr 100px",
              gap: 8,
              padding: "12px 16px",
              borderBottom: idx < projects.length - 1 ? "1px solid var(--p-color-border-subdued)" : "none",
              cursor: "pointer",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--p-color-bg-surface-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            {/* Page */}
            <div>
              <InlineStack gap="200" blockAlign="center" wrap={false}>
                <Text variant="bodyMd" fontWeight="bold" as="span">
                  {p.productTitle}
                </Text>
                <Badge tone={p.resourceType === "COLLECTION" ? "info" : "success"}>
                  {p.resourceType === "COLLECTION" ? "Collection" : "Product"}
                </Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {p.snapshotName}{p.snapshotCount > 1 ? ` (${p.snapshotCount} snapshots)` : ""}
              </Text>
            </div>

            {/* Quality bar */}
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
              <StackedBar project={p} height={8} />
              <Text as="span" variant="bodySm" tone="subdued">
                {q.real}% real
              </Text>
            </div>

            {/* Finding */}
            <div style={{ display: "flex", alignItems: "center" }}>
              <FindingBadge finding={p.finding} tone={p.findingTone} />
            </div>

            {/* Trend */}
            <div style={{ display: "flex", alignItems: "center" }}>
              <TrendIndicator trend={p.trend} detail={p.trendDetail} />
            </div>

            {/* Status */}
            <div style={{ display: "flex", alignItems: "center" }}>
              <Badge tone={p.status === "ACTIVE" ? "success" : "info"}>
                {p.status === "ACTIVE" ? "Active" : "Completed"}
              </Badge>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

// ══════════════════════════════════════════════════════
// RETRO RPG PROFILE CARD
// ══════════════════════════════════════════════════════

function getLevel(rep: number) {
  if (rep >= 200) return { level: 10, title: "Grandmaster", next: 200, prev: 150 };
  if (rep >= 150) return { level: 9, title: "Master", next: 200, prev: 150 };
  if (rep >= 100) return { level: 8, title: "Expert", next: 150, prev: 100 };
  if (rep >= 75) return { level: 7, title: "Veteran", next: 100, prev: 75 };
  if (rep >= 50) return { level: 6, title: "Specialist", next: 75, prev: 50 };
  if (rep >= 35) return { level: 5, title: "Analyst", next: 50, prev: 35 };
  if (rep >= 20) return { level: 4, title: "Scout", next: 35, prev: 20 };
  if (rep >= 10) return { level: 3, title: "Observer", next: 20, prev: 10 };
  if (rep >= 5) return { level: 2, title: "Rookie", next: 10, prev: 5 };
  return { level: 1, title: "Newcomer", next: 5, prev: 0 };
}

function RetroProfileCard() {
  const { profile, trendingInsights, activeCount, completedCount } = MOCK_DATA;
  const lvl = getLevel(profile.reputation);
  const xpProgress = Math.round(((profile.reputation - lvl.prev) / (lvl.next - lvl.prev)) * 100);

  return (
    <Card>
      <div style={{ display: "flex", gap: 0 }}>
        {/* ─── Left half: Avatar + Profile info ─── */}
        <div style={{ display: "flex", flex: 1, gap: 16 }}>
          {/* Avatar — full height */}
          <div
            style={{
              flexShrink: 0,
              width: 120,
              minHeight: 180,
              borderRadius: 10,
              background: "#f6f6f7",
              overflow: "hidden",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
            }}
          >
            <img
              src="https://cdn.shopify.com/s/files/1/0958/7762/8036/files/2_b23783ea-68e2-40a2-b415-94350a570158.png?v=1775311314"
              alt="Avatar"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "center top",
                borderRadius: 10,
              }}
            />
          </div>

          {/* Profile details */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
            {/* Name */}
            <Text as="span" variant="headingLg" fontWeight="bold">
              {profile.displayName}
            </Text>

            {/* Subtitle */}
            <Text as="p" variant="bodySm" tone="subdued">
              {lvl.title}
            </Text>

            {/* Description */}
            <Text as="p" variant="bodySm">
              CRO specialist helping Shopify merchants optimize product pages for higher conversions.
            </Text>

            {/* Badges */}
            <InlineStack gap="200" wrap>
              <Badge tone="success">{"🌟"} Top Contributor</Badge>
              <Badge tone="info">{"💡"} Insight Pioneer</Badge>
              <Badge tone="warning">{"🔥"} 15 Audits</Badge>
            </InlineStack>

            {/* Points + Level + Progress */}
            <div style={{ marginTop: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  {profile.reputation} pts
                </Text>
                <Badge tone="info">LVL {lvl.level}</Badge>
                <Text as="span" variant="bodySm" tone="subdued">
                  {lvl.next - profile.reputation} pts to LVL {lvl.level + 1}
                </Text>
              </div>
              <div
                style={{
                  height: 8,
                  background: "#e4e5e7",
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${xpProgress}%`,
                    background: "#2c6ecb",
                    borderRadius: 3,
                    transition: "width 0.5s ease",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ─── Divider ─── */}
        <div style={{ width: 1, background: "#e4e5e7", margin: "0 20px", flexShrink: 0 }} />

        {/* ─── Right half: 2x2 Metrics grid ─── */}
        <div
          style={{
            flex: "0 0 220px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            alignContent: "center",
          }}
        >
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <Text as="p" variant="bodySm" tone="subdued">Answers</Text>
            <Text as="p" variant="headingXl">{profile.answersCount}</Text>
          </div>
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <Text as="p" variant="bodySm" tone="subdued">Insights</Text>
            <Text as="p" variant="headingXl">{profile.insightsCount}</Text>
          </div>
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <Text as="p" variant="bodySm" tone="subdued">Audits</Text>
            <Text as="p" variant="headingXl">{completedCount}</Text>
          </div>
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <Text as="p" variant="bodySm" tone="subdued">Streak</Text>
            <Text as="p" variant="headingXl">
              {activeCount > 0 ? activeCount : completedCount > 0 ? "✓" : "—"}
            </Text>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════
// NOTIFICATION BELL (shared)
// ══════════════════════════════════════════════════════

function NotificationBell() {
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState(MOCK_DATA.notifications);
  const [unreadCount, setUnreadCount] = useState(MOCK_DATA.unreadCount);

  const handleMarkRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
  };
  const handleMarkAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
  };

  const bellActivator = (
    <div
      style={{ position: "relative", display: "inline-flex", cursor: "pointer", padding: 8 }}
      onClick={() => setBellOpen((o) => !o)}
      role="button"
      tabIndex={0}
    >
      <svg viewBox="0 0 20 20" width="24" height="24" fill="currentColor" style={{ color: "var(--p-color-icon)" }}>
        <path d="M10 18a2 2 0 0 1-2-2h4a2 2 0 0 1-2 2zm7-3H3v-1l2-2V8a5 5 0 0 1 4-4.9V3a1 1 0 1 1 2 0v.1A5 5 0 0 1 15 8v4l2 2v1z" />
      </svg>
      {unreadCount > 0 && (
        <span
          style={{
            position: "absolute", top: 2, right: 2, minWidth: 18, height: 18, borderRadius: 9,
            background: "#e51c00", color: "#fff", fontSize: 11, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "0 5px", lineHeight: 1, pointerEvents: "none",
            animation: "notif-pulse 2s ease-in-out infinite",
          }}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
      <style>{`
        @keyframes notif-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.15); opacity: 0.85; }
        }
      `}</style>
    </div>
  );

  return (
    <Popover
      active={bellOpen}
      activator={bellActivator}
      onClose={() => setBellOpen(false)}
      preferredAlignment="right"
      fluidContent
    >
      <div style={{ width: 360, maxHeight: 480, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "12px 16px", borderBottom: "1px solid var(--p-color-border-subdued)",
          }}
        >
          <Text as="h3" variant="headingSm">Notifications</Text>
          {unreadCount > 0 && (
            <Button variant="plain" onClick={handleMarkAllRead}>Mark all as read</Button>
          )}
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {notifications.map((notif) => (
            <div
              key={notif.id}
              style={{
                display: "flex", gap: 10, padding: "10px 16px", cursor: "pointer",
                background: notif.isRead ? "transparent" : "var(--p-color-bg-surface-secondary)",
                borderBottom: "1px solid var(--p-color-border-subdued)", transition: "background 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--p-color-bg-surface-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = notif.isRead ? "transparent" : "var(--p-color-bg-surface-secondary)"; }}
            >
              <span style={{ fontSize: 20, flexShrink: 0 }}>{notifEmoji[notif.type] || "\uD83D\uDD14"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text as="p" variant="bodySm" fontWeight={notif.isRead ? "regular" : "semibold"}>{notif.title}</Text>
                <Text as="p" variant="bodySm" tone="subdued">{notif.message}</Text>
                <Text as="p" variant="bodySm" tone="subdued">{notifTimeAgo(notif.createdAt)}</Text>
              </div>
              {!notif.isRead && (
                <button
                  title="Mark as read"
                  onClick={(e) => { e.stopPropagation(); handleMarkRead(notif.id); }}
                  style={{
                    width: 20, height: 20, borderRadius: 10, background: "none", border: "none",
                    cursor: "pointer", padding: 0, flexShrink: 0, marginTop: 4,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: "#2c6ecb", display: "block" }} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </Popover>
  );
}

// ══════════════════════════════════════════════════════
// INDEX PAGE (MAIN COMPONENT)
// ══════════════════════════════════════════════════════

function IndexPage() {
  const { activeCount, completedCount } = MOCK_DATA;
  const [activeTab, setActiveTab] = useState<"products" | "collections" | "pages" | "blogs">("products");
  const [isTypeModalOpen, setIsTypeModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [resourceType, setResourceType] = useState<string>("product");
  const [snapshotName, setSnapshotName] = useState("");
  const [targetVisitors, setTargetVisitors] = useState("1000");

  return (
    <Page
      title="Mouse Whisperer"
      primaryAction={{
        content: "Create New Audit",
        onAction: () => setIsTypeModalOpen(true),
      }}
    >
      {/* ── Top-right icons ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, marginBottom: 8 }}>
        <div style={{ display: "inline-flex", padding: 8, cursor: "pointer" }}>
          <svg viewBox="0 0 20 20" width="24" height="24" fill="currentColor" style={{ color: "var(--p-color-icon)" }}>
            <path d="M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0-6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 13H4a1 1 0 0 1-1-1v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1a1 1 0 0 1-1 1zm-1-2a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3h10z" />
          </svg>
        </div>
        <NotificationBell />
      </div>

      <Layout>
        {/* ── Retro RPG Profile Card ── */}
        <Layout.Section>
          <RetroProfileCard />
        </Layout.Section>

        {/* ── Tabbed Audit Table ── */}
        <Layout.Section>
          <Card padding="0">
            {/* Tabs */}
            <div
              style={{
                display: "flex",
                borderBottom: "1px solid var(--p-color-border-subdued)",
              }}
            >
              {(["products", "collections", "pages", "blogs"] as const).map((tab) => {
                const isActive = activeTab === tab;
                const label = tab.charAt(0).toUpperCase() + tab.slice(1);
                const count = tab === "products"
                  ? PROJECTS.filter((p) => p.resourceType === "PRODUCT").length
                  : tab === "collections"
                  ? PROJECTS.filter((p) => p.resourceType === "COLLECTION").length
                  : 0;
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      flex: 1,
                      padding: "12px 16px",
                      background: "none",
                      border: "none",
                      borderBottom: isActive ? "2px solid #2c6ecb" : "2px solid transparent",
                      cursor: "pointer",
                      fontSize: 14,
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? "#202223" : "#6d7175",
                      transition: "all 0.15s",
                    }}
                  >
                    {label} {count > 0 && <span style={{ color: "#8c9196", fontWeight: 400 }}>({count})</span>}
                  </button>
                );
              })}
            </div>

            {/* Table content */}
            {(() => {
              const filtered =
                activeTab === "products"
                  ? PROJECTS.filter((p) => p.resourceType === "PRODUCT")
                  : activeTab === "collections"
                  ? PROJECTS.filter((p) => p.resourceType === "COLLECTION")
                  : [];

              if (filtered.length === 0) {
                return (
                  <div style={{ padding: "40px 16px", textAlign: "center" }}>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      No {activeTab} audits yet.
                    </Text>
                    <div style={{ marginTop: 12 }}>
                      <Button onClick={() => setIsTypeModalOpen(true)}>
                        Create {activeTab.slice(0, -1)} audit
                      </Button>
                    </div>
                  </div>
                );
              }

              const isProduct = activeTab === "products";
              const metricLabel1 = isProduct ? "ATC" : "CTR";

              return (
                <>
                  {/* Rows */}
                  {filtered.map((p, idx) => {
                    const progressPct = Math.min(100, Math.round((p.realCount / p.targetVisitors) * 100));
                    const metric1 = isProduct ? p.atcRate : p.ctrRate;
                    const isDone = progressPct >= 100;

                    return (
                      <div
                        key={p.id}
                        style={{
                          padding: "14px 20px",
                          borderBottom: idx < filtered.length - 1 ? "1px solid #ebebeb" : "none",
                          cursor: "pointer",
                          transition: "background 0.15s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--p-color-bg-surface-hover)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                          {/* Single row: Name | Progress | Metrics */}
                        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                          {/* Left: Name + snapshot */}
                          <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                            <div>
                              <Text variant="bodyMd" fontWeight="bold" as="span">
                                {p.productTitle}
                              </Text>
                            </div>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {p.snapshotName}{p.snapshotCount > 1 ? ` · ${p.snapshotCount} snapshots` : ""}
                            </Text>
                          </div>

                          {/* Center: Progress bar */}
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

                          {/* Right: Metrics */}
                          <div style={{ display: "flex", gap: 28, flexShrink: 0 }}>
                            <div style={{ textAlign: "center", minWidth: 52 }}>
                              <Text as="p" variant="bodySm" tone="subdued">{metricLabel1}</Text>
                              <Text as="p" variant="bodyMd" fontWeight="semibold">
                                {metric1 != null ? `${metric1}%` : "—"}
                              </Text>
                            </div>
                            <div style={{ textAlign: "center", minWidth: 52 }}>
                              <Text as="p" variant="bodySm" tone="subdued">CVR</Text>
                              <Text as="p" variant="bodyMd" fontWeight="semibold">
                                {p.cvrRate}%
                              </Text>
                            </div>
                            <div style={{ textAlign: "center", minWidth: 64 }}>
                              <Text as="p" variant="bodySm" tone="subdued">REV</Text>
                              <Text as="p" variant="bodyMd" fontWeight="semibold">
                                ${p.revenue.toLocaleString()}
                              </Text>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </Card>
        </Layout.Section>

        {/* ── Legend Row ── */}
        <Layout.Section>
          <InlineStack align="center" gap="400">
            <span style={{ fontSize: 12, color: "#29845a" }}>{"●"} Real</span>
            <span style={{ fontSize: 12, color: "#b98900" }}>{"●"} Zombie</span>
            <span style={{ fontSize: 12, color: "#d72c0d" }}>{"●"} Bot</span>
          </InlineStack>
        </Layout.Section>
      </Layout>

      {/* ── Type Selection Modal ── */}
      <Modal
        open={isTypeModalOpen}
        onClose={() => setIsTypeModalOpen(false)}
        title="What do you want to track?"
        primaryAction={{
          content: "Continue",
          onAction: () => { setIsTypeModalOpen(false); setIsCreateModalOpen(true); },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setIsTypeModalOpen(false) }]}
      >
        <Modal.Section>
          <ChoiceList
            title="Select page type"
            choices={[
              { label: "Product page", value: "product", helpText: "Track visitor engagement on a product page (/products/...)" },
              { label: "Collection page", value: "collection", helpText: "Track visitor engagement on a collection page (/collections/...)" },
            ]}
            selected={[resourceType]}
            onChange={(value) => setResourceType(value[0])}
          />
        </Modal.Section>
      </Modal>

      {/* ── Create Audit Modal ── */}
      <Modal
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create Audit: Sample Product"
        primaryAction={{ content: "Create Audit", onAction: () => setIsCreateModalOpen(false) }}
        secondaryActions={[{ content: "Cancel", onAction: () => setIsCreateModalOpen(false) }]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Snapshot Name"
              value={snapshotName}
              onChange={setSnapshotName}
              placeholder="e.g., Baseline, After Redesign"
              helpText="Optional label for this measurement period"
              autoComplete="off"
            />
            <TextField
              label="Target Visitors"
              type="number"
              value={targetVisitors}
              onChange={setTargetVisitors}
              min={100}
              helpText="Number of real visitors to collect before completing the snapshot"
              autoComplete="off"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

// ══════════════════════════════════════════════════════
// MOUNT
// ══════════════════════════════════════════════════════

const root = createRoot(document.getElementById("root")!);
root.render(
  <AppProvider i18n={{}}>
    <IndexPage />
  </AppProvider>
);
