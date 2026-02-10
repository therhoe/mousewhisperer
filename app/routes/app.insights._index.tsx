import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigate } from "@remix-run/react";
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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { InsightCard } from "../components/insights/InsightCard";
import { ProfileSetupBanner } from "../components/insights/ProfileSetupBanner";
import { LeaderboardCard } from "../components/insights/LeaderboardCard";

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const profile = await prisma.insightProfile.findUnique({ where: { shop } });

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

  // Fetch insights + bookmark status
  const [insights, leaders] = await Promise.all([
    prisma.insight.findMany({
      where,
      orderBy,
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        profile: {
          select: { displayName: true, avatarEmoji: true, storeCategory: true },
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
  ]);

  const hasNext = insights.length > PAGE_SIZE;
  const items = hasNext ? insights.slice(0, PAGE_SIZE) : insights;
  const nextCursor = hasNext ? items[items.length - 1].id : null;

  const enrichedInsights = items.map((insight: any) => ({
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
    insights: enrichedInsights,
    nextCursor,
    leaderboard,
    filters: { category, sort, search, tab },
  });
};

export default function InsightsFeed() {
  const { hasProfile, insights, nextCursor, leaderboard, filters } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const tabs = [
    { id: "all", content: "All Insights" },
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
      navigate(`/app/insights?${params.toString()}`);
    },
    [searchParams, navigate],
  );

  const handleTabChange = useCallback(
    (index: number) => {
      const params = new URLSearchParams(searchParams);
      params.set("tab", tabs[index].id);
      params.delete("cursor");
      navigate(`/app/insights?${params.toString()}`);
    },
    [searchParams, navigate],
  );

  const loadMore = useCallback(() => {
    if (!nextCursor) return;
    const params = new URLSearchParams(searchParams);
    params.set("cursor", nextCursor);
    navigate(`/app/insights?${params.toString()}`);
  }, [searchParams, nextCursor, navigate]);

  return (
    <Page fullWidth>
      <TitleBar title="Insights Board">
        <button variant="primary" onClick={() => navigate("/app/insights/new")}>
          New Insight
        </button>
      </TitleBar>

      <BlockStack gap="400">
        {!hasProfile && <ProfileSetupBanner />}

        <Tabs tabs={tabs} selected={selectedTab >= 0 ? selectedTab : 0} onSelect={handleTabChange}>
          <Box paddingBlockStart="400">
            <Layout>
              <Layout.Section>
                <BlockStack gap="300">
                  {/* Filters */}
                  <InlineStack gap="300" wrap blockAlign="end">
                    <div style={{ minWidth: 180 }}>
                      <Select
                        label="Category"
                        labelHidden
                        options={CATEGORY_FILTER_OPTIONS}
                        value={filters.category}
                        onChange={(v) => updateFilter("category", v)}
                      />
                    </div>
                    <div style={{ minWidth: 150 }}>
                      <Select
                        label="Sort"
                        labelHidden
                        options={SORT_OPTIONS}
                        value={filters.sort}
                        onChange={(v) => updateFilter("sort", v)}
                      />
                    </div>
                    <div style={{ flexGrow: 1, minWidth: 200 }}>
                      <TextField
                        label="Search"
                        labelHidden
                        placeholder="Search insights..."
                        value={filters.search}
                        onChange={(v) => updateFilter("search", v)}
                        autoComplete="off"
                        clearButton
                        onClearButtonClick={() => updateFilter("search", "")}
                      />
                    </div>
                  </InlineStack>

                  {/* Insight list */}
                  {insights.length === 0 ? (
                    <EmptyState heading="No insights yet" image="">
                      <p>
                        {filters.search || filters.category
                          ? "Try adjusting your filters."
                          : filters.tab === "bookmarked"
                            ? "Bookmark insights to find them here later."
                            : "Be the first to share a traffic insight with the community!"}
                      </p>
                    </EmptyState>
                  ) : (
                    <BlockStack gap="300">
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
              </Layout.Section>

              {/* Sidebar */}
              <Layout.Section variant="oneThird">
                <BlockStack gap="400">
                  <LeaderboardCard leaders={leaderboard} />
                </BlockStack>
              </Layout.Section>
            </Layout>
          </Box>
        </Tabs>
      </BlockStack>
    </Page>
  );
}
