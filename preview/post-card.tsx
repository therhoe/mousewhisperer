import React, { useState } from "react";
import {
  Card,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  Button,
  TextField,
} from "@shopify/polaris";

// ══════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════

export type Answer = {
  id: string;
  authorName: string;
  authorAvatar: string;
  authorLevel: number;
  content: string;
  upvotes: number;
  isAccepted: boolean;
  timeAgo: string;
};

export type InsightPost = {
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
  storeUrl: string;
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

// ══════════════════════════════════════════════════════
// MOCK DATA
// ══════════════════════════════════════════════════════

export const POSTS: InsightPost[] = [
  {
    id: "ins1",
    title: "Why is my bounce rate so high on this product page?",
    content:
      "I've tried changing the hero image and rewriting the description but zombies keep climbing. The page loads fast and looks good on mobile. Anyone else seeing this pattern with toe spacer products?",
    category: "Low Engagement",
    categoryTone: "warning",
    authorName: "Correct Toes",
    authorAvatar:
      "https://cdn.shopify.com/s/files/1/0958/7762/8036/files/2_b23783ea-68e2-40a2-b415-94350a570158.png?v=1775311314",
    authorLevel: 5,
    pageScreenshot: "https://cdn.shopify.com/s/files/1/0733/8160/9688/files/cst680_2.jpg?v=1776268245",
    pageTitle: "Correct Toes\u00AE The Original Toe Spacer",
    storeUrl: "https://correcttoes.com/products/the-original-toe-spacer",
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
        content:
          'Try adding urgency elements above the fold — a stock counter or shipping deadline. I saw a 15% drop in zombies after adding a "Only 3 left" badge near the ATC button.',
        upvotes: 5,
        isAccepted: true,
        timeAgo: "1d ago",
      },
      {
        id: "a2",
        authorName: "Bob's Gear Shop",
        authorAvatar: "\uD83D\uDEE0\uFE0F",
        authorLevel: 2,
        content:
          "I had the same issue. Swapping the CTA button color from grey to a high-contrast green helped my ATC rate jump from 6% to 11%.",
        upvotes: 2,
        isAccepted: false,
        timeAgo: "12h ago",
      },
    ],
  },
  {
    id: "ins2",
    title: "Collection page getting 25% bot traffic from paid ads",
    content:
      "Running Google Shopping ads to my Footwear collection and Mouse Whisperer is flagging 25% as bots. Is this normal for shopping campaigns? The CTR from the ads looks legit in Google but the on-site behavior says otherwise.",
    category: "High Bot Traffic",
    categoryTone: "critical",
    authorName: "SoleStyle Co",
    authorAvatar: "\uD83D\uDC5F",
    authorLevel: 3,
    pageScreenshot: "https://cdn.shopify.com/s/files/1/0733/8160/9688/files/cst680_2.jpg?v=1776268245",
    pageTitle: "Footwear Collection",
    storeUrl: "https://solestyle.example.com/collections/footwear",
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
        content:
          "25% bots from Shopping campaigns is unfortunately pretty common. Try excluding known bot IP ranges in your campaign settings, and check if the traffic spikes at odd hours — that's usually the giveaway.",
        upvotes: 8,
        isAccepted: false,
        timeAgo: "3h ago",
      },
    ],
  },
  {
    id: "ins3",
    title: "Conversion drop after redesigning product page — what am I missing?",
    content:
      "Redesigned my StableToe page last week. New photos, new copy, moved reviews higher. But conversions dropped from 5.1% to 3.8%. The ATC rate actually went UP which is confusing. Scroll depth improved too. What could cause ATC to go up but conversions to go down?",
    category: "Conversion Drop",
    categoryTone: "attention",
    authorName: "Correct Toes",
    authorAvatar:
      "https://cdn.shopify.com/s/files/1/0958/7762/8036/files/2_b23783ea-68e2-40a2-b415-94350a570158.png?v=1775311314",
    authorLevel: 5,
    pageScreenshot: "https://cdn.shopify.com/s/files/1/0733/8160/9688/files/cst680_2.jpg?v=1776268245",
    pageTitle: "Correct Toes StableToe\u00AE",
    storeUrl: "https://correcttoes.com/products/stabletoe",
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
    content:
      "Just started using Mouse Whisperer on my Accessories collection. Any tips on what metrics to focus on first? The filter usage seems low but I'm not sure if that's normal for a collection with only 20 products.",
    category: "General",
    categoryTone: "info",
    authorName: "NewMerchant",
    authorAvatar: "\uD83D\uDC23",
    authorLevel: 1,
    pageScreenshot: "https://placehold.co/1200x675/e8f8e8/1a1a2e?text=Accessories+Page",
    pageTitle: "Accessories Collection",
    storeUrl: "https://newmerchant.example.com/collections/accessories",
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
        content:
          "For collections, focus on CTR first — that tells you if people are finding products they want. Filter usage below 10% is normal for small collections. Start worrying if it's a 100+ product collection with low filter usage.",
        upvotes: 11,
        isAccepted: true,
        timeAgo: "2d ago",
      },
      {
        id: "a5",
        authorName: "Jane's Wellness",
        authorAvatar: "\uD83C\uDF3F",
        authorLevel: 7,
        content:
          "Also look at sort preferences — if everyone is sorting by price, your default sort might not be showing the right products first.",
        upvotes: 4,
        isAccepted: false,
        timeAgo: "2d ago",
      },
      {
        id: "a6",
        authorName: "Correct Toes",
        authorAvatar:
          "https://cdn.shopify.com/s/files/1/0958/7762/8036/files/2_b23783ea-68e2-40a2-b415-94350a570158.png?v=1775311314",
        authorLevel: 5,
        content:
          "I'd add: check your scroll depth on the collection. If people aren't scrolling past the first row, your above-the-fold products are either converting or bouncing them.",
        upvotes: 3,
        isAccepted: false,
        timeAgo: "1d ago",
      },
    ],
  },
];

// ══════════════════════════════════════════════════════
// POST CARD — hero image on top, action links, engagement bar
// ══════════════════════════════════════════════════════

const LINK_STYLE: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#2c6ecb",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

export type MetricsLayout = "below" | "right-2x2" | "right-1x4";

function MetricsBlock({
  post,
  layout,
}: {
  post: InsightPost;
  layout: MetricsLayout;
}) {
  const cells = [
    { label: post.metrics.label1, value: post.metrics.value1 },
    { label: "CVR", value: post.metrics.cvrRate },
    { label: "REV", value: post.metrics.revenue },
    { label: "Real%", value: post.metrics.realPercent },
  ];
  const isRow = layout === "right-1x4";

  // right-1x4: each metric is its own grey pill, stretched to fill the height
  if (isRow) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          width: "100%",
          height: "100%",
        }}
      >
        {cells.map((c, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              background: "#f6f6f7",
              borderRadius: 8,
              padding: "0 12px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              minHeight: 0,
            }}
          >
            <Text as="span" variant="bodySm" tone="subdued">
              {c.label}
            </Text>
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {c.value}
            </Text>
          </div>
        ))}
      </div>
    );
  }

  // below / right-2x2: one shared grey container
  const gridStyle: React.CSSProperties =
    layout === "below"
      ? { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }
      : { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, rowGap: 10 };
  return (
    <div
      style={{
        ...gridStyle,
        background: "#f6f6f7",
        borderRadius: 8,
        padding: "8px 6px",
        width: "100%",
      }}
    >
      {cells.map((c, i) => (
        <div key={i} style={{ textAlign: "center" }}>
          <Text as="p" variant="bodySm" tone="subdued">
            {c.label}
          </Text>
          <Text as="p" variant="bodyMd" fontWeight="semibold">
            {c.value}
          </Text>
        </div>
      ))}
    </div>
  );
}

export function PostCard({
  post,
  metricsLayout = "below",
}: {
  post: InsightPost;
  metricsLayout?: MetricsLayout;
}) {
  const [expanded, setExpanded] = useState(false);
  const [meToo, setMeToo] = useState(post.isMeTooed);
  const [meTooCount, setMeTooCount] = useState(post.meTooCount);
  const [bookmarked, setBookmarked] = useState(post.isBookmarked);
  const [replyText, setReplyText] = useState("");

  const isImageAvatar = post.authorAvatar.startsWith("http");

  return (
    <Card padding="0">
      {/* ── Author row (top) ── */}
      <div
        style={{
          padding: "12px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <InlineStack gap="200" blockAlign="center">
          {isImageAvatar ? (
            <img
              src={post.authorAvatar}
              alt={post.authorName}
              style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover" }}
            />
          ) : (
            <span style={{ fontSize: 24 }}>{post.authorAvatar}</span>
          )}
          <Text as="span" variant="bodySm" fontWeight="semibold">
            {post.authorName}
          </Text>
          <Badge tone="info">LVL {post.authorLevel}</Badge>
          <Text as="span" variant="bodySm" tone="subdued">
            {"\u00B7"} {post.timeAgo}
          </Text>
        </InlineStack>
        <InlineStack gap="200" blockAlign="center">
          {post.hasSolution && <Badge tone="success">Solved</Badge>}
          <a
            href={post.storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={LINK_STYLE}
            title={`Open ${post.pageTitle} in a new tab`}
          >
            <span aria-hidden>{"\u2197"}</span> Open store page
          </a>
        </InlineStack>
      </div>

      {/* ── Hero image + (optional) side metrics ── */}
      {metricsLayout === "below" ? (
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "21 / 9",
            background: "#f6f6f7",
            overflow: "hidden",
          }}
        >
          <img
            src={post.pageScreenshot}
            alt={post.pageTitle}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
          <div style={{ position: "absolute", top: 12, left: 12 }}>
            <Badge tone={post.categoryTone}>{post.category}</Badge>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 0, alignItems: "stretch", height: 180 }}>
          <div
            style={{
              flex: 1,
              position: "relative",
              background: "#f6f6f7",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src={post.pageScreenshot}
              alt={post.pageTitle}
              style={{ width: "auto", height: "100%", objectFit: "contain", display: "block" }}
            />
            <div style={{ position: "absolute", top: 12, left: 12 }}>
              <Badge tone={post.categoryTone}>{post.category}</Badge>
            </div>
          </div>
          <div
            style={{
              flex: metricsLayout === "right-2x2" ? "0 0 180px" : "0 0 140px",
              padding: 12,
              display: "flex",
              alignItems: "stretch",
            }}
          >
            <MetricsBlock post={post} layout={metricsLayout} />
          </div>
        </div>
      )}

      {/* ── Content body (below image) ── */}
      <div style={{ padding: 16 }}>
        <BlockStack gap="300">
          {/* Title */}
          <Text as="h3" variant="headingMd" fontWeight="semibold">
            {post.title}
          </Text>

          {/* Body text */}
          <Text as="p" variant="bodySm">
            {post.content}
          </Text>

          {/* Metrics grid — only when layout is "below" */}
          {metricsLayout === "below" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 8,
                background: "#f6f6f7",
                borderRadius: 8,
                padding: "8px 4px",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodySm" tone="subdued">
                  {post.metrics.label1}
                </Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {post.metrics.value1}
                </Text>
              </div>
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodySm" tone="subdued">
                  CVR
                </Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {post.metrics.cvrRate}
                </Text>
              </div>
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodySm" tone="subdued">
                  REV
                </Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {post.metrics.revenue}
                </Text>
              </div>
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodySm" tone="subdued">
                  Real%
                </Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {post.metrics.realPercent}
                </Text>
              </div>
            </div>
          )}

          {/* Action link — internal fake link */}
          <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            <a href={`#/challenges/${post.id}`} style={LINK_STYLE} title="View challenge results">
              <span aria-hidden>{"\u2192"}</span> View results
            </a>
          </div>

          {/* Engagement footer */}
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
                {"\uD83D\uDC41"} {post.viewCount}
              </Text>
              <button
                onClick={() => {
                  setMeToo(!meToo);
                  setMeTooCount((c) => (meToo ? c - 1 : c + 1));
                }}
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
                {"\uD83D\uDE4B"} {meTooCount} me too
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
                {"\uD83D\uDCAC"} {post.answerCount} answers
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
                {bookmarked ? "\uD83D\uDD16" : "\uD83C\uDFF7\uFE0F"}
              </button>
            </InlineStack>
          </div>

          {/* Expanded: answers + reply textarea */}
          {expanded && (
            <div style={{ borderTop: "1px solid #e4e5e7", paddingTop: 12 }}>
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
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 6,
                        }}
                      >
                        <InlineStack gap="200" blockAlign="center">
                          {isImg ? (
                            <img
                              src={answer.authorAvatar}
                              alt=""
                              style={{ width: 24, height: 24, borderRadius: 6, objectFit: "cover" }}
                            />
                          ) : (
                            <span style={{ fontSize: 18 }}>{answer.authorAvatar}</span>
                          )}
                          <Text as="span" variant="bodySm" fontWeight="semibold">
                            {answer.authorName}
                          </Text>
                          <Badge tone="info">LVL {answer.authorLevel}</Badge>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {answer.timeAgo}
                          </Text>
                        </InlineStack>
                        {answer.isAccepted && <Badge tone="success">{"\u2713"} Accepted</Badge>}
                      </div>

                      <Text as="p" variant="bodySm">
                        {answer.content}
                      </Text>

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
                          {"\u25B2"} {answer.upvotes}
                        </button>
                      </div>
                    </div>
                  );
                })}

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
      </div>
    </Card>
  );
}
