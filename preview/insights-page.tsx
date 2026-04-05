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
  Select,
  TextField,
  Tabs,
} from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";

// ══════════════════════════════════════════════════════
// MOCK DATA
// ══════════════════════════════════════════════════════

type Answer = {
  id: string;
  authorName: string;
  authorAvatar: string;
  authorLevel: number;
  content: string;
  upvotes: number;
  isAccepted: boolean;
  timeAgo: string;
};

type InsightPost = {
  id: string;
  title: string;
  content: string;
  category: string;
  categoryTone: "success" | "info" | "warning" | "critical" | "attention";
  authorName: string;
  authorAvatar: string;
  authorLevel: number;
  pageScreenshot: string;
  pageTitle: string;
  metrics: {
    label1: string;
    value1: string;
    cvrRate: string;
    revenue: string;
    realPercent: string;
  };
  viewCount: number;
  meTooCount: number;
  answerCount: number;
  timeAgo: string;
  isBookmarked: boolean;
  isMeTooed: boolean;
  hasSolution: boolean;
  answers: Answer[];
};

const POSTS: InsightPost[] = [
  {
    id: "ins1",
    title: "Why is my bounce rate so high on this product page?",
    content: "I've tried changing the hero image and rewriting the description but zombies keep climbing. The page loads fast and looks good on mobile. Anyone else seeing this pattern with toe spacer products?",
    category: "Low Engagement",
    categoryTone: "warning",
    authorName: "Correct Toes",
    authorAvatar: "https://cdn.shopify.com/s/files/1/0958/7762/8036/files/2_b23783ea-68e2-40a2-b415-94350a570158.png?v=1775311314",
    authorLevel: 5,
    pageScreenshot: "https://placehold.co/400x250/e8f4f8/1a1a2e?text=Product+Page",
    pageTitle: "Correct Toes\u00AE The Original Toe Spacer",
    metrics: { label1: "ATC", value1: "8.2%", cvrRate: "3.1%", revenue: "$4,850", realPercent: "72%" },
    viewCount: 142,
    meTooCount: 3,
    answerCount: 2,
    timeAgo: "2d ago",
    isBookmarked: false,
    isMeTooed: false,
    hasSolution: true,
    answers: [
      {
        id: "a1",
        authorName: "Jane's Wellness",
        authorAvatar: "\uD83C\uDF3F",
        authorLevel: 7,
        content: "Try adding urgency elements above the fold — a stock counter or shipping deadline. I saw a 15% drop in zombies after adding a \"Only 3 left\" badge near the ATC button.",
        upvotes: 5,
        isAccepted: true,
        timeAgo: "1d ago",
      },
      {
        id: "a2",
        authorName: "Bob's Gear Shop",
        authorAvatar: "\uD83D\uDEE0\uFE0F",
        authorLevel: 2,
        content: "I had the same issue. Swapping the CTA button color from grey to a high-contrast green helped my ATC rate jump from 6% to 11%.",
        upvotes: 2,
        isAccepted: false,
        timeAgo: "12h ago",
      },
    ],
  },
  {
    id: "ins2",
    title: "Collection page getting 25% bot traffic from paid ads",
    content: "Running Google Shopping ads to my Footwear collection and Mouse Whisperer is flagging 25% as bots. Is this normal for shopping campaigns? The CTR from the ads looks legit in Google but the on-site behavior says otherwise.",
    category: "High Bot Traffic",
    categoryTone: "critical",
    authorName: "SoleStyle Co",
    authorAvatar: "\uD83D\uDC5F",
    authorLevel: 3,
    pageScreenshot: "https://placehold.co/400x250/f8e8e8/1a1a2e?text=Collection+Page",
    pageTitle: "Footwear Collection",
    metrics: { label1: "CTR", value1: "12.4%", cvrRate: "3.2%", revenue: "$2,100", realPercent: "75%" },
    viewCount: 89,
    meTooCount: 7,
    answerCount: 1,
    timeAgo: "5h ago",
    isBookmarked: true,
    isMeTooed: true,
    hasSolution: false,
    answers: [
      {
        id: "a3",
        authorName: "AdTech Mike",
        authorAvatar: "\uD83D\uDCCA",
        authorLevel: 6,
        content: "25% bots from Shopping campaigns is unfortunately pretty common. Try excluding known bot IP ranges in your campaign settings, and check if the traffic spikes at odd hours — that's usually the giveaway.",
        upvotes: 8,
        isAccepted: false,
        timeAgo: "3h ago",
      },
    ],
  },
  {
    id: "ins3",
    title: "Conversion drop after redesigning product page — what am I missing?",
    content: "Redesigned my StableToe page last week. New photos, new copy, moved reviews higher. But conversions dropped from 5.1% to 3.8%. The ATC rate actually went UP which is confusing. Scroll depth improved too. What could cause ATC to go up but conversions to go down?",
    category: "Conversion Drop",
    categoryTone: "attention",
    authorName: "Correct Toes",
    authorAvatar: "https://cdn.shopify.com/s/files/1/0958/7762/8036/files/2_b23783ea-68e2-40a2-b415-94350a570158.png?v=1775311314",
    authorLevel: 5,
    pageScreenshot: "https://placehold.co/400x250/f8f4e8/1a1a2e?text=StableToe+Page",
    pageTitle: "Correct Toes StableToe\u00AE",
    metrics: { label1: "ATC", value1: "14.2%", cvrRate: "3.8%", revenue: "$8,750", realPercent: "75%" },
    viewCount: 231,
    meTooCount: 12,
    answerCount: 0,
    timeAgo: "1d ago",
    isBookmarked: false,
    isMeTooed: false,
    hasSolution: false,
    answers: [],
  },
  {
    id: "ins4",
    title: "Best practices for tracking collection page engagement?",
    content: "Just started using Mouse Whisperer on my Accessories collection. Any tips on what metrics to focus on first? The filter usage seems low but I'm not sure if that's normal for a collection with only 20 products.",
    category: "General",
    categoryTone: "info",
    authorName: "NewMerchant",
    authorAvatar: "\uD83D\uDC23",
    authorLevel: 1,
    pageScreenshot: "https://placehold.co/400x250/e8f8e8/1a1a2e?text=Accessories+Page",
    pageTitle: "Accessories Collection",
    metrics: { label1: "CTR", value1: "15.3%", cvrRate: "4.5%", revenue: "$2,100", realPercent: "68%" },
    viewCount: 45,
    meTooCount: 1,
    answerCount: 3,
    timeAgo: "3d ago",
    isBookmarked: false,
    isMeTooed: false,
    hasSolution: true,
    answers: [
      {
        id: "a4",
        authorName: "CRO Pro Sarah",
        authorAvatar: "\uD83C\uDFAF",
        authorLevel: 9,
        content: "For collections, focus on CTR first — that tells you if people are finding products they want. Filter usage below 10% is normal for small collections. Start worrying if it's a 100+ product collection with low filter usage.",
        upvotes: 11,
        isAccepted: true,
        timeAgo: "2d ago",
      },
      {
        id: "a5",
        authorName: "Jane's Wellness",
        authorAvatar: "\uD83C\uDF3F",
        authorLevel: 7,
        content: "Also look at sort preferences — if everyone is sorting by price, your default sort might not be showing the right products first.",
        upvotes: 4,
        isAccepted: false,
        timeAgo: "2d ago",
      },
      {
        id: "a6",
        authorName: "Correct Toes",
        authorAvatar: "https://cdn.shopify.com/s/files/1/0958/7762/8036/files/2_b23783ea-68e2-40a2-b415-94350a570158.png?v=1775311314",
        authorLevel: 5,
        content: "I'd add: check your scroll depth on the collection. If people aren't scrolling past the first row, your above-the-fold products are either converting or bouncing them.",
        upvotes: 3,
        isAccepted: false,
        timeAgo: "1d ago",
      },
    ],
  },
];

// ══════════════════════════════════════════════════════
// POST CARD COMPONENT
// ══════════════════════════════════════════════════════

function PostCard({ post }: { post: InsightPost }) {
  const [expanded, setExpanded] = useState(false);
  const [meToo, setMeToo] = useState(post.isMeTooed);
  const [meTooCount, setMeTooCount] = useState(post.meTooCount);
  const [bookmarked, setBookmarked] = useState(post.isBookmarked);
  const [replyText, setReplyText] = useState("");

  const isImageAvatar = post.authorAvatar.startsWith("http");

  return (
    <Card>
      <BlockStack gap="0">
        {/* ── Header: Level badge (left) + Avatar & Name (right) ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <Badge tone="info">LVL {post.authorLevel}</Badge>
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="bodySm" fontWeight="semibold">{post.authorName}</Text>
            {isImageAvatar ? (
              <img
                src={post.authorAvatar}
                alt={post.authorName}
                style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover" }}
              />
            ) : (
              <span style={{ fontSize: 24 }}>{post.authorAvatar}</span>
            )}
          </InlineStack>
        </div>

        {/* ── Body: Screenshot (left 30%) + Content (right 70%) ── */}
        <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
          {/* Landscape screenshot */}
          <div
            style={{
              flex: "0 0 30%",
              borderRadius: 8,
              overflow: "hidden",
              background: "#f6f6f7",
              aspectRatio: "16/10",
              minHeight: 120,
            }}
          >
            <img
              src={post.pageScreenshot}
              alt={post.pageTitle}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>

          {/* Content side */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Title + Category */}
            <div>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="headingSm">{post.title}</Text>
                {post.hasSolution && <Badge tone="success">Solved</Badge>}
              </InlineStack>
              <div style={{ marginTop: 4 }}>
                <Badge tone={post.categoryTone}>{post.category}</Badge>
              </div>
            </div>

            {/* Post text */}
            <Text as="p" variant="bodySm">
              {post.content}
            </Text>

            {/* 4 Metrics */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 8,
                background: "#f6f6f7",
                borderRadius: 8,
                padding: "8px 4px",
                marginTop: "auto",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodySm" tone="subdued">{post.metrics.label1}</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">{post.metrics.value1}</Text>
              </div>
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodySm" tone="subdued">CVR</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">{post.metrics.cvrRate}</Text>
              </div>
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodySm" tone="subdued">REV</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">{post.metrics.revenue}</Text>
              </div>
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodySm" tone="subdued">Real%</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">{post.metrics.realPercent}</Text>
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer: Engagement bar ── */}
        <div
          style={{
            borderTop: "1px solid #e4e5e7",
            paddingTop: 10,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <InlineStack gap="400" blockAlign="center">
            <Text as="span" variant="bodySm" tone="subdued">
              {"👁"} {post.viewCount}
            </Text>
            <button
              onClick={() => { setMeToo(!meToo); setMeTooCount(c => meToo ? c - 1 : c + 1); }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                fontSize: 13,
                color: meToo ? "#2c6ecb" : "#6d7175",
                fontWeight: meToo ? 600 : 400,
              }}
            >
              {"🙋"} {meTooCount} me too
            </button>
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                fontSize: 13,
                color: expanded ? "#2c6ecb" : "#6d7175",
                fontWeight: expanded ? 600 : 400,
              }}
            >
              {"💬"} {post.answerCount} answers
            </button>
          </InlineStack>

          <InlineStack gap="200">
            <Button size="slim" onClick={() => setExpanded(!expanded)}>
              Reply
            </Button>
            <button
              onClick={() => setBookmarked(!bookmarked)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px 8px",
                fontSize: 16,
              }}
              title={bookmarked ? "Remove bookmark" : "Bookmark"}
            >
              {bookmarked ? "🔖" : "🏷️"}
            </button>
          </InlineStack>
        </div>

        {/* ── Expanded: Inline comments ── */}
        {expanded && (
          <div style={{ marginTop: 12, borderTop: "1px solid #e4e5e7", paddingTop: 12 }}>
            <BlockStack gap="300">
              {post.answers.length === 0 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  No answers yet. Be the first to help!
                </Text>
              )}

              {post.answers.map((answer) => {
                const isImg = answer.authorAvatar.startsWith("http");
                return (
                  <div
                    key={answer.id}
                    style={{
                      background: answer.isAccepted ? "#f1f8f5" : "#f6f6f7",
                      borderRadius: 8,
                      padding: 12,
                      border: answer.isAccepted ? "1px solid #29845a" : "1px solid transparent",
                    }}
                  >
                    {/* Answer header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <InlineStack gap="200" blockAlign="center">
                        {isImg ? (
                          <img src={answer.authorAvatar} alt="" style={{ width: 24, height: 24, borderRadius: 6, objectFit: "cover" }} />
                        ) : (
                          <span style={{ fontSize: 18 }}>{answer.authorAvatar}</span>
                        )}
                        <Text as="span" variant="bodySm" fontWeight="semibold">{answer.authorName}</Text>
                        <Badge tone="info">LVL {answer.authorLevel}</Badge>
                        <Text as="span" variant="bodySm" tone="subdued">{answer.timeAgo}</Text>
                      </InlineStack>
                      {answer.isAccepted && <Badge tone="success">{"✓"} Accepted</Badge>}
                    </div>

                    {/* Answer content */}
                    <Text as="p" variant="bodySm">{answer.content}</Text>

                    {/* Upvote */}
                    <div style={{ marginTop: 6 }}>
                      <button
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                          fontSize: 13,
                          color: "#6d7175",
                        }}
                      >
                        {"▲"} {answer.upvotes}
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Reply textarea */}
              <div style={{ background: "#f6f6f7", borderRadius: 8, padding: 12 }}>
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
                  <Button variant="primary" size="slim" disabled={!replyText.trim()}>
                    Post Answer
                  </Button>
                </div>
              </div>
            </BlockStack>
          </div>
        )}
      </BlockStack>
    </Card>
  );
}

// ══════════════════════════════════════════════════════
// INSIGHTS PAGE
// ══════════════════════════════════════════════════════

function InsightsPage() {
  const [selectedTab, setSelectedTab] = useState(0);
  const [category, setCategory] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [search, setSearch] = useState("");

  const tabs = [
    { id: "all", content: "All Insights" },
    { id: "bookmarked", content: "Bookmarked" },
  ];

  const categoryOptions = [
    { label: "All Categories", value: "all" },
    { label: "High Bot Traffic", value: "high-bot" },
    { label: "Low Engagement", value: "low-engagement" },
    { label: "Source Quality", value: "source-quality" },
    { label: "Conversion Drop", value: "conversion-drop" },
    { label: "General", value: "general" },
  ];

  const sortOptions = [
    { label: "Newest", value: "newest" },
    { label: "Trending", value: "trending" },
    { label: "Most Answers", value: "most-answers" },
    { label: "Unsolved", value: "unsolved" },
  ];

  // Filter posts based on tab
  const filteredPosts = selectedTab === 1
    ? POSTS.filter((p) => p.isBookmarked)
    : POSTS;

  return (
    <Page title="Insights Board">
      <Layout>
        {/* Tabs */}
        <Layout.Section>
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} />
        </Layout.Section>

        {/* Filters */}
        <Layout.Section>
          <InlineStack gap="300" blockAlign="end" wrap>
            <div style={{ minWidth: 180 }}>
              <Select
                label="Category"
                labelInline
                options={categoryOptions}
                value={category}
                onChange={setCategory}
              />
            </div>
            <div style={{ minWidth: 160 }}>
              <Select
                label="Sort"
                labelInline
                options={sortOptions}
                value={sortBy}
                onChange={setSortBy}
              />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <TextField
                label=""
                labelHidden
                value={search}
                onChange={setSearch}
                placeholder="Search insights..."
                autoComplete="off"
                clearButton
                onClearButtonClick={() => setSearch("")}
              />
            </div>
          </InlineStack>
        </Layout.Section>

        {/* Posts */}
        <Layout.Section>
          <BlockStack gap="400">
            {filteredPosts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </BlockStack>
        </Layout.Section>

        {/* Load More */}
        <Layout.Section>
          <InlineStack align="center">
            <Button>Load More</Button>
          </InlineStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

// ══════════════════════════════════════════════════════
// MOUNT
// ══════════════════════════════════════════════════════

const root = createRoot(document.getElementById("root")!);
root.render(
  <AppProvider i18n={{}}>
    <InsightsPage />
  </AppProvider>
);
