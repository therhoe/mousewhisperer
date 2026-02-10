import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigate } from "@remix-run/react";
import {
  Page,
  BlockStack,
  InlineStack,
  Select,
  TextField,
  Button,
  Text,
  EmptyState,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { InsightCard } from "../components/insights/InsightCard";
import { ProfileSetupBanner } from "../components/insights/ProfileSetupBanner";

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
  { label: "Newest first", value: "newest" },
  { label: "Most answers", value: "answers" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const profile = await prisma.insightProfile.findUnique({ where: { shop } });

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const category = url.searchParams.get("category") || "";
  const sort = url.searchParams.get("sort") || "newest";
  const search = url.searchParams.get("search") || "";

  const where: any = {};
  if (category) {
    where.category = category;
  }
  if (search) {
    where.title = { contains: search, mode: "insensitive" };
  }

  const orderBy = sort === "answers"
    ? { answerCount: "desc" as const }
    : { createdAt: "desc" as const };

  const insights = await prisma.insight.findMany({
    where,
    orderBy,
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      profile: {
        select: { displayName: true, avatarEmoji: true, storeCategory: true },
      },
    },
  });

  const hasNext = insights.length > PAGE_SIZE;
  const items = hasNext ? insights.slice(0, PAGE_SIZE) : insights;
  const nextCursor = hasNext ? items[items.length - 1].id : null;

  return json({
    hasProfile: !!profile,
    insights: items,
    nextCursor,
    filters: { category, sort, search },
  });
};

export default function InsightsFeed() {
  const { hasProfile, insights, nextCursor, filters } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete("cursor"); // reset pagination on filter change
    setSearchParams(params);
  };

  const loadMore = () => {
    if (!nextCursor) return;
    const params = new URLSearchParams(searchParams);
    params.set("cursor", nextCursor);
    setSearchParams(params);
  };

  return (
    <Page fullWidth>
      <TitleBar title="Insights Board">
        <button variant="primary" onClick={() => navigate("/app/insights/new")}>
          New Insight
        </button>
      </TitleBar>

      <BlockStack gap="400">
        {!hasProfile && <ProfileSetupBanner />}

        <InlineStack gap="300" wrap blockAlign="end">
          <div style={{ minWidth: 200 }}>
            <Select
              label="Category"
              labelHidden
              options={CATEGORY_FILTER_OPTIONS}
              value={filters.category}
              onChange={(v) => updateFilter("category", v)}
            />
          </div>
          <div style={{ minWidth: 160 }}>
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

        {insights.length === 0 ? (
          <EmptyState
            heading="No insights yet"
            image=""
          >
            <p>
              {filters.search || filters.category
                ? "Try adjusting your filters."
                : "Be the first to share a traffic insight with the community!"}
            </p>
          </EmptyState>
        ) : (
          <BlockStack gap="300">
            {insights.map((insight: any) => (
              <InsightCard
                key={insight.id}
                id={insight.id}
                title={insight.title}
                category={insight.category}
                answerCount={insight.answerCount}
                createdAt={insight.createdAt}
                profile={insight.profile}
              />
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
    </Page>
  );
}
