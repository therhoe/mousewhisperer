import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigate, Link } from "@remix-run/react";
import {
  Page,
  Layout,
  BlockStack,
  InlineStack,
  Select,
  TextField,
  Button,
  Text,
  EmptyState,
  Box,
  Tabs,
  Card,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { COMMUNITY_FEATURES_ENABLED } from "../utils/features";
import { InsightCard } from "../components/challenges/InsightCard";
import { ProfileSetupBanner } from "../components/challenges/ProfileSetupBanner";
import { LeaderboardCard } from "../components/challenges/LeaderboardCard";

const PAGE_SIZE = 20;

const CATEGORY_FILTER_OPTIONS = [
  { label: "All categories", value: "" },
  { label: "High Bot Traffic", value: "HIGH_BOT_TRAFFIC" },
  { label: "Low Engagement", value: "LOW_ENGAGEMENT" },
  { label: "Source Quality", value: "SOURCE_QUALITY" },
  { label: "Conversion Drop", value: "CONVERSION_DROP" },
  { label: "General", value: "GENERAL" },
];

const SORT_OPTIONS = [
  { label: "Newest", value: "newest" },
  { label: "Trending", value: "trending" },
  { label: "Most Popular", value: "popular" },
  { label: "Most Answers", value: "answers" },
  { label: "Unsolved", value: "unsolved" },
];

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&[^;]+;/g, " ").trim();
}

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!COMMUNITY_FEATURES_ENABLED) {
    return redirect("/app");
  }

  const shop = session.shop;

  const profile = await prisma.insightProfile.findUnique({
    where: { shop },
    include: { _count: { select: { answers: true, insights: true } } },
  });

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const category = url.searchParams.get("category") || "";
  const sort = url.searchParams.get("sort") || "newest";
  const search = url.searchParams.get("search") || "";
  const tab = url.searchParams.get("tab") || "all";

  const where: any = {};
  if (category) where.category = category;
  if (search) where.title = { contains: search, mode: "insensitive" };

  // Tab-specific filters
  if (tab === "bookmarked" && profile) {
    where.bookmarks = { some: { profileId: profile.id } };
  }
  if (sort === "unsolved") {
    where.hasAcceptedAnswer = false;
  }

  // Trending = last 7 days, sorted by meTooCount
  if (sort === "trending") {
    where.createdAt = { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
  }

  let orderBy: any;
  switch (sort) {
    case "popular":
    case "trending":
      orderBy = [{ meTooCount: "desc" }, { createdAt: "desc" }];
      break;
    case "answers":
      orderBy = { answerCount: "desc" };
      break;
    case "unsolved":
      orderBy = { createdAt: "desc" };
      break;
    default:
      orderBy = { createdAt: "desc" };
  }

  // Fetch challenges + counts
  const [insights, leaders, activeCount, completedCount, productCount, collectionCount, homepageCount, pageCount, blogCount] = await Promise.all([
    prisma.insight.findMany({
      where,
      orderBy,
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        profile: {
          select: { displayName: true, avatarEmoji: true, avatarUrl: true, reputation: true, storeCategory: true },
        },
        answers: {
          orderBy: [{ isAccepted: "desc" }, { upvoteCount: "desc" }],
          take: 5,
          include: {
            profile: {
              select: { displayName: true, avatarEmoji: true, avatarUrl: true, reputation: true },
            },
          },
        },
        ...(profile
          ? { bookmarks: { where: { profileId: profile.id }, select: { id: true } } }
          : {}),
      },
    }),
    // Leaderboard: top 5 by reputation
    prisma.insightProfile.findMany({
      orderBy: { reputation: "desc" },
      take: 5,
      where: { reputation: { gt: 0 } },
      select: {
        displayName: true,
        avatarEmoji: true,
        storeCategory: true,
        reputation: true,
        _count: { select: { answers: true } },
      },
    }),
    prisma.snapshot.count({ where: { project: { shop }, status: "ACTIVE" } }),
    prisma.snapshot.count({ where: { project: { shop }, status: "COMPLETED" } }),
    prisma.project.count({ where: { shop, resourceType: "PRODUCT" } }),
    prisma.project.count({ where: { shop, resourceType: "COLLECTION" } }),
    prisma.project.count({ where: { shop, resourceType: "HOMEPAGE" } }),
    prisma.project.count({ where: { shop, resourceType: "PAGE" } }),
    prisma.project.count({ where: { shop, resourceType: "BLOG" } }),
  ]);

  const hasNext = insights.length > PAGE_SIZE;
  const items = hasNext ? insights.slice(0, PAGE_SIZE) : insights;
  const nextCursor = hasNext ? items[items.length - 1].id : null;

  const enrichedChallenges = items.map((insight: any) => ({
    id: insight.id,
    title: insight.title,
    contentPreview: stripHtml(insight.content).slice(0, 160),
    category: insight.category,
    answerCount: insight.answerCount,
    meTooCount: insight.meTooCount,
    viewCount: insight.viewCount,
    hasAcceptedAnswer: insight.hasAcceptedAnswer,
    isBookmarked: insight.bookmarks?.length > 0,
    createdAt: insight.createdAt,
    profile: insight.profile,
    snapshotStats: insight.snapshotStats || null,
    imageUrl: insight.imageUrl || null,
    answers: (insight.answers || []).map((a: any) => ({
      id: a.id,
      content: stripHtml(a.content),
      upvoteCount: a.upvoteCount,
      isAccepted: a.isAccepted,
      createdAt: a.createdAt,
      profile: a.profile,
    })),
  }));

  const leaderboard = leaders.map((l: any) => ({
    displayName: l.displayName,
    avatarEmoji: l.avatarEmoji,
    storeCategory: l.storeCategory,
    reputation: l.reputation,
    answerCount: l._count.answers,
  }));

  return json({
    hasProfile: !!profile,
    profileData: profile ? {
      displayName: profile.displayName,
      avatarEmoji: profile.avatarEmoji,
      avatarUrl: profile.avatarUrl,
      bio: profile.bio,
      reputation: profile.reputation,
      insightsCount: profile._count.insights,
      answersCount: profile._count.answers,
    } : null,
    insights: enrichedChallenges,
    nextCursor,
    leaderboard,
    filters: { category, sort, search, tab },
    activeCount,
    completedCount,
    productCount,
    collectionCount,
    homepageCount,
    pageCount,
    blogCount,
  });
};

export default function ChallengesFeed() {
  const { hasProfile, profileData, insights, nextCursor, leaderboard, filters, activeCount, completedCount, productCount, collectionCount, homepageCount, pageCount, blogCount } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const tabs = [
    { id: "all", content: "All Challenges" },
    { id: "bookmarked", content: "Bookmarked" },
  ];
  const selectedTab = tabs.findIndex((t) => t.id === filters.tab);

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("cursor");
      navigate(`/app/challenges?${params.toString()}`);
    },
    [searchParams, navigate],
  );

  const handleTabChange = useCallback(
    (index: number) => {
      const params = new URLSearchParams(searchParams);
      params.set("tab", tabs[index].id);
      params.delete("cursor");
      navigate(`/app/challenges?${params.toString()}`);
    },
    [searchParams, navigate],
  );

  const loadMore = useCallback(() => {
    if (!nextCursor) return;
    const params = new URLSearchParams(searchParams);
    params.set("cursor", nextCursor);
    navigate(`/app/challenges?${params.toString()}`);
  }, [searchParams, nextCursor, navigate]);

  const lvl = profileData ? getLevel(profileData.reputation) : null;

  return (
    <Page fullWidth>
      <TitleBar title="Challenges" />

      <BlockStack gap="400">
        {!hasProfile && <ProfileSetupBanner />}

        <Tabs tabs={tabs} selected={selectedTab >= 0 ? selectedTab : 0} onSelect={handleTabChange}>
          <Box paddingBlockStart="400">
            {/* Two-column layout: sticky sidebar + scrollable feed */}
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              {/* Left: sticky profile + audits */}
              {profileData && (
                <div style={{ flex: "0 0 280px", position: "sticky", top: 16, alignSelf: "flex-start" }}>
                  <BlockStack gap="400">
                    {/* Compact Profile Card */}
                    <Card>
                      <BlockStack gap="300">
                        <InlineStack gap="300" blockAlign="center">
                          <div style={{ width: 72, height: 72, borderRadius: 10, background: "#f6f6f7", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {profileData.avatarUrl ? (
                              <img src={profileData.avatarUrl} alt="Avatar" style={{ width: "100%", height: "100%", objectFit: "cover", imageRendering: "pixelated" }} />
                            ) : (
                              <span style={{ fontSize: "2.5rem" }}>{profileData.avatarEmoji || "\uD83D\uDC2D"}</span>
                            )}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <Text as="p" variant="headingMd" fontWeight="bold">{profileData.displayName}</Text>
                            <Text as="p" variant="bodySm" tone="subdued">{lvl?.title}</Text>
                          </div>
                        </InlineStack>
                        {profileData.bio && <Text as="p" variant="bodySm">{profileData.bio}</Text>}

                        {/* Points + Level */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <Text as="span" variant="bodyMd" fontWeight="semibold">{profileData.reputation} pts</Text>
                          <Badge tone="info">{`LVL ${lvl?.level || 1}`}</Badge>
                          <Text as="span" variant="bodySm" tone="subdued">{(lvl?.next || 0) - profileData.reputation} pts to LVL {(lvl?.level || 0) + 1}</Text>
                        </div>

                        <div style={{ height: 1, background: "#e4e5e7" }} />

                        {/* Audits */}
                        <BlockStack gap="200">
                          <Text as="h3" variant="headingSm">Audits</Text>
                          <InlineStack align="space-between"><Text as="span" variant="bodySm" tone="subdued">Completed</Text><Text as="span" variant="bodyMd" fontWeight="semibold">{completedCount}</Text></InlineStack>
                          <InlineStack align="space-between"><Text as="span" variant="bodySm" tone="subdued">Active</Text><Text as="span" variant="bodyMd" fontWeight="semibold">{activeCount}</Text></InlineStack>
                        </BlockStack>

                        <div style={{ height: 1, background: "#e4e5e7" }} />

                        {/* Challenges stats */}
                        <BlockStack gap="200">
                          <Text as="h3" variant="headingSm">Challenges</Text>
                          <InlineStack align="space-between"><Text as="span" variant="bodySm" tone="subdued">Created</Text><Text as="span" variant="bodyMd" fontWeight="semibold">{profileData.insightsCount}</Text></InlineStack>
                          <InlineStack align="space-between"><Text as="span" variant="bodySm" tone="subdued">Answered</Text><Text as="span" variant="bodyMd" fontWeight="semibold">{profileData.answersCount}</Text></InlineStack>
                        </BlockStack>
                      </BlockStack>
                    </Card>

                    {/* Your audits links */}
                    <Card>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">Your audits</Text>
                        {[
                          { label: "Products", count: productCount, url: "/app/audits/products" },
                          { label: "Collections", count: collectionCount, url: "/app/audits/collections" },
                          { label: "Homepage", count: homepageCount, url: "/app/audits/homepage" },
                          { label: "Pages", count: pageCount, url: "/app/audits/pages" },
                          { label: "Blogs", count: blogCount, url: "/app/audits/blogs" },
                        ].map(({ label, count, url }) => (
                          <Link key={label} to={url} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 4px", borderBottom: "1px solid #ebebeb", textDecoration: "none", color: "inherit", fontSize: 13, fontWeight: 500 }}>
                            <span>{label}</span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#6d7175" }}>
                              <span>{count}</span>
                              <span>{"\u2192"}</span>
                            </span>
                          </Link>
                        ))}
                      </BlockStack>
                    </Card>
                  </BlockStack>
                </div>
              )}

              {/* Right: filters + challenge feed */}
              <div style={{ flex: 1, minWidth: 0, maxWidth: 680 }}>
                <BlockStack gap="300">
                  {/* Filters */}
                  <Card>
                    <InlineStack gap="300" wrap blockAlign="end">
                      <div style={{ minWidth: 180 }}>
                        <Select label="Category" labelInline options={CATEGORY_FILTER_OPTIONS} value={filters.category} onChange={(v) => updateFilter("category", v)} />
                      </div>
                      <div style={{ minWidth: 150 }}>
                        <Select label="Sort" labelInline options={SORT_OPTIONS} value={filters.sort} onChange={(v) => updateFilter("sort", v)} />
                      </div>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <TextField label="" labelHidden placeholder="Search challenges..." value={filters.search} onChange={(v) => updateFilter("search", v)} autoComplete="off" clearButton onClearButtonClick={() => updateFilter("search", "")} />
                      </div>
                    </InlineStack>
                  </Card>

                  {/* Challenge list */}
                  {insights.length === 0 ? (
                    <EmptyState heading="No challenges yet" image="">
                      <p>
                        {filters.search || filters.category
                          ? "Try adjusting your filters."
                          : filters.tab === "bookmarked"
                            ? "Bookmark challenges to find them here later."
                            : "Complete a snapshot and create your first challenge!"}
                      </p>
                    </EmptyState>
                  ) : (
                    <BlockStack gap="400">
                      {insights.map((insight: any) => (
                        <InsightCard key={insight.id} {...insight} />
                      ))}
                    </BlockStack>
                  )}

                  {nextCursor && (
                    <Box paddingBlockEnd="400">
                      <InlineStack align="center">
                        <Button onClick={loadMore}>Load more</Button>
                      </InlineStack>
                    </Box>
                  )}
                </BlockStack>
              </div>
            </div>
          </Box>
        </Tabs>
      </BlockStack>
    </Page>
  );
}
