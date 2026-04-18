import React, { useState } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  Button,
  ProgressBar,
} from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";

import { PROJECTS, type Project } from "./data";
import { POSTS, type InsightPost } from "./post-card";

// ══════════════════════════════════════════════════════
// MOCK DATA (profile — shared shape with index-page.tsx)
// ══════════════════════════════════════════════════════

const MOCK_PROFILE = {
  displayName: "Shepherd",
  companyName: "The Real Heroes",
  title: "Operator",
  reputation: 40,
  answersCount: 5,
  insightsCount: 5,
};

function getLevel(rep: number) {
  if (rep < 10) return { level: 1, title: "Novice", prev: 0, next: 10 };
  if (rep < 25) return { level: 2, title: "Contributor", prev: 10, next: 25 };
  if (rep < 50) return { level: 3, title: "Regular", prev: 25, next: 50 };
  if (rep < 100) return { level: 4, title: "Veteran", prev: 50, next: 100 };
  if (rep < 200) return { level: 5, title: "Expert", prev: 100, next: 200 };
  return { level: 6, title: "Master", prev: 200, next: 500 };
}

// ══════════════════════════════════════════════════════
// ONBOARDING CARD — dismissable
// ══════════════════════════════════════════════════════

function OnboardingCard() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const steps = [
    { num: 1, label: "Create your first audit", done: true },
    { num: 2, label: "Install the Mouse Whisperer pixel", done: true },
    { num: 3, label: "Collect 100 real visitors", done: false },
    { num: 4, label: "Post your first insight", done: false },
  ];

  return (
    <Card>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Welcome to Mouse Whisperer
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Finish these steps to get the most out of your audits.
            </Text>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {steps.map((s) => (
                <div
                  key={s.num}
                  style={{ display: "flex", alignItems: "center", gap: 10 }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: s.done ? "#29845a" : "#e4e5e7",
                      color: s.done ? "#fff" : "#6d7175",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {s.done ? "\u2713" : s.num}
                  </span>
                  <Text
                    as="span"
                    variant="bodySm"
                    tone={s.done ? "subdued" : undefined}
                  >
                    {s.label}
                  </Text>
                </div>
              ))}
            </div>
          </BlockStack>
        </div>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 18,
            color: "#6d7175",
            padding: 4,
            lineHeight: 1,
          }}
          title="Dismiss"
        >
          {"\u00D7"}
        </button>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════
// PROFILE CARD — horizontal, full-width
// ══════════════════════════════════════════════════════

function ProfileCard() {
  const lvl = getLevel(MOCK_PROFILE.reputation);
  return (
    <Card>
      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
        {/* Avatar */}
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: 12,
            background: "#f6f6f7",
            overflow: "hidden",
            flexShrink: 0,
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
            }}
          />
        </div>

        {/* Main info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <BlockStack gap="100">
            <Text as="p" variant="headingLg" fontWeight="bold">
              {MOCK_PROFILE.displayName}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {MOCK_PROFILE.title} {"\u00B7"} {MOCK_PROFILE.companyName}
            </Text>
            <Text as="p" variant="bodySm">
              CRO specialist helping Shopify merchants optimize product pages
              for higher conversions.
            </Text>
            <InlineStack gap="100" wrap>
              <Badge tone="success">{"\uD83C\uDF1F"} Top Contributor</Badge>
              <Badge tone="info">{"\uD83D\uDCA1"} Insight Pioneer</Badge>
              <Badge tone="warning">{"\uD83D\uDD25"} 15 Audits</Badge>
            </InlineStack>
          </BlockStack>
        </div>

        {/* Points stack on the right */}
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <Text as="p" variant="bodySm" tone="subdued">
            Reputation
          </Text>
          <Text as="p" variant="headingLg" fontWeight="semibold">
            {MOCK_PROFILE.reputation} pts
          </Text>
          <div style={{ marginTop: 4 }}>
            <Badge tone="info">LVL {lvl.level}</Badge>
          </div>
          <div style={{ marginTop: 4 }}>
            <Text as="span" variant="bodySm" tone="subdued">
              {lvl.next - MOCK_PROFILE.reputation} pts to LVL {lvl.level + 1}
            </Text>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════
// ACTIVE AUDITS CARD — name + progress bar, no metrics
// ══════════════════════════════════════════════════════

function ActiveAuditsCard() {
  // Active = not yet at 100% progress (still collecting visitors)
  const active = PROJECTS.filter(
    (p) => p.status === "ACTIVE" || p.realCount < p.targetVisitors
  );

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">
            Active audits
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {active.length} running
          </Text>
        </InlineStack>

        {active.length === 0 ? (
          <Text as="p" variant="bodySm" tone="subdued">
            No audits currently running. Start a new one to begin collecting
            data.
          </Text>
        ) : (
          <BlockStack gap="300">
            {active.map((p) => {
              const pct = Math.min(
                100,
                Math.round((p.realCount / p.targetVisitors) * 100)
              );
              return (
                <div key={p.id}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      marginBottom: 4,
                    }}
                  >
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      {p.productTitle}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {p.realCount}/{p.targetVisitors}
                    </Text>
                  </div>
                  <ProgressBar progress={pct} size="small" tone="primary" />
                </div>
              );
            })}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

// ══════════════════════════════════════════════════════
// TRENDING POSTS CARD — top 5 titles + engagement stats
// ══════════════════════════════════════════════════════

function trendingScore(p: InsightPost): number {
  return p.viewCount + p.meTooCount * 3 + p.answerCount * 5;
}

function TrendingPostsCard() {
  const top = [...POSTS].sort((a, b) => trendingScore(b) - trendingScore(a)).slice(0, 5);
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h3" variant="headingMd">
          Trending in the feed
        </Text>
        <BlockStack gap="200">
          {top.map((p, idx) => (
            <div
              key={p.id}
              style={{
                padding: "10px 0",
                borderBottom:
                  idx === top.length - 1 ? "none" : "1px solid #ebebeb",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <Text as="span" variant="bodySm" tone="subdued">
                  {idx + 1}.
                </Text>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {p.title}
                  </Text>
                  <InlineStack gap="400" blockAlign="center">
                    <Text as="span" variant="bodySm" tone="subdued">
                      {"\uD83D\uDC41"} {p.viewCount}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {"\uD83D\uDE4B"} {p.meTooCount} me too
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {"\uD83D\uDCAC"} {p.answerCount} answers
                    </Text>
                  </InlineStack>
                </div>
              </div>
            </div>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

// ══════════════════════════════════════════════════════
// INDEX PAGE V2
// ══════════════════════════════════════════════════════

export default function IndexPageV2() {
  return (
    <Page title="Dashboard">
      <BlockStack gap="400">
        <OnboardingCard />
        <ProfileCard />
        <Layout>
          <Layout.Section variant="oneHalf">
            <ActiveAuditsCard />
          </Layout.Section>
          <Layout.Section variant="oneHalf">
            <TrendingPostsCard />
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
