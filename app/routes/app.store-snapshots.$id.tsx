import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import type { Prisma, ResourceType } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import {
  Link,
  useActionData,
  useLoaderData,
  useSubmit,
  useNavigation,
} from "@remix-run/react";
import {
  Banner,
  Badge,
  BlockStack,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Layout,
  Page,
  ProgressBar,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getStoreSnapshotStats,
  type StoreSnapshotPageSummary,
} from "../utils/store-snapshot.server";
import {
  clearCacheKey,
  clearCachePrefix,
  loaderCacheKeys,
} from "../utils/loader-cache.server";
import {
  getStorefrontTrackerStatus,
  type StorefrontTrackerStatus,
} from "../utils/storefront-tracker-status.server";

const DEFAULT_FOCUSED_SNAPSHOT_TARGET_VISITORS = 1000;
const MIN_FOCUSED_SNAPSHOT_TARGET_VISITORS = 25;
const MAX_FOCUSED_SNAPSHOT_TARGET_VISITORS = 100000;
const MAX_BULK_SNAPSHOT_SELECTION = 4;
const PAGE_TABLE_PAGE_SIZE = 20;

type PageFilter = "human" | "all";
type PageSortKey =
  | "page"
  | "type"
  | "humanVisits"
  | "clickThroughRate"
  | "conversionRate"
  | "revenue"
  | "weaknessScore";
type SortDirection = "asc" | "desc";

const PAGE_FILTER_OPTIONS = [
  { label: "Human visits only", value: "human" },
  { label: "All pages", value: "all" },
];

const PAGE_SORT_OPTIONS = [
  { label: "Page", value: "page" },
  { label: "Type", value: "type" },
  { label: "Human visits", value: "humanVisits" },
  { label: "CTR", value: "clickThroughRate" },
  { label: "CVR", value: "conversionRate" },
  { label: "Revenue", value: "revenue" },
  { label: "Weakness", value: "weaknessScore" },
];

const SORT_DIRECTION_OPTIONS = [
  { label: "Descending", value: "desc" },
  { label: "Ascending", value: "asc" },
];

type ActionResponse =
  | {
      success: true;
      createdCount?: number;
      reusedCount?: number;
      skippedCount?: number;
      message?: string;
    }
  | { error: string };

type FocusedSnapshotListItem = {
  id: string;
  productTitle: string;
  resourceType: ResourceType;
  pagePath: string;
  snapshotName: string;
  snapshotCount: number;
  status: string;
  realCount: number;
  targetVisitors: number;
  metricValues: Record<string, number>;
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const snapshotId = params.id;

  if (!snapshotId) {
    throw new Response("Store snapshot ID required", { status: 400 });
  }

  const snapshot = await prisma.storeSnapshot.findFirst({
    where: { id: snapshotId, shop },
  });

  if (!snapshot) {
    throw new Response("Store snapshot not found", { status: 404 });
  }

  const [stats, trackerStatus, focusedSnapshots] = await Promise.all([
    getStoreSnapshotStats(snapshot.id),
    getStorefrontTrackerStatus(admin, shop),
    getFocusedSnapshotsCreatedFromStoreSnapshot(snapshot.id, shop),
  ]);

  return json({
    snapshot: {
      id: snapshot.id,
      name: snapshot.name,
      status: snapshot.status,
      completionMode: snapshot.completionMode,
      targetHumanVisitors: snapshot.targetHumanVisitors,
      targetTotalVisits: snapshot.targetTotalVisits,
      durationDays: snapshot.durationDays,
      startedAt: snapshot.startedAt.toISOString(),
      endsAt: snapshot.endsAt?.toISOString() ?? null,
      completedAt: snapshot.completedAt?.toISOString() ?? null,
    },
    stats,
    trackerStatus,
    focusedSnapshots,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const snapshotId = params.id;
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (!snapshotId) {
    return json({ error: "Store snapshot ID required" }, { status: 400 });
  }

  const snapshot = await prisma.storeSnapshot.findFirst({
    where: { id: snapshotId, shop },
  });

  if (!snapshot) {
    return json({ error: "Store snapshot not found" }, { status: 404 });
  }

  if (actionType === "pause") {
    await prisma.storeSnapshot.update({
      where: { id: snapshot.id },
      data: { status: "PAUSED" },
    });
    return json({ success: true } satisfies ActionResponse);
  }

  if (actionType === "resume") {
    await prisma.storeSnapshot.update({
      where: { id: snapshot.id },
      data: { status: "ACTIVE" },
    });
    return json({ success: true } satisfies ActionResponse);
  }

  if (actionType === "complete") {
    await prisma.storeSnapshot.update({
      where: { id: snapshot.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await getStoreSnapshotStats(snapshot.id, { force: true });
    return json({ success: true } satisfies ActionResponse);
  }

  if (actionType === "delete") {
    await prisma.storeSnapshot.delete({ where: { id: snapshot.id } });
    return redirect("/app");
  }

  if (actionType === "create-page-snapshots") {
    const selectedPageKeys = Array.from(
      new Set(formData.getAll("pageKey").map(String).filter(Boolean)),
    );
    if (selectedPageKeys.length === 0) {
      return json(
        { error: "Select at least one page" } satisfies ActionResponse,
        { status: 400 },
      );
    }
    if (selectedPageKeys.length > MAX_BULK_SNAPSHOT_SELECTION) {
      return json(
        {
          error: `Select up to ${MAX_BULK_SNAPSHOT_SELECTION} pages at a time`,
        } satisfies ActionResponse,
        { status: 400 },
      );
    }

    const stats = await getStoreSnapshotStats(snapshot.id, { force: true });
    const targetVisitors = normalizeFocusedSnapshotTargetVisitors(
      formData.get("targetVisitors"),
    );
    const pageByKey = new Map(
      (stats?.pageAggregates || []).map((page) => [page.pageKey, page]),
    );
    const selectedPages = selectedPageKeys
      .map((pageKey) => pageByKey.get(pageKey))
      .filter((page): page is StoreSnapshotPageSummary => Boolean(page));

    if (selectedPages.length === 0) {
      return json(
        {
          error: "Selected pages are no longer available",
        } satisfies ActionResponse,
        { status: 404 },
      );
    }

    let createdCount = 0;
    let reusedCount = 0;
    let skippedCount = selectedPageKeys.length - selectedPages.length;

    for (const page of selectedPages) {
      const result = await createFocusedSnapshotFromStorePage(
        shop,
        snapshot.id,
        page,
        targetVisitors,
      );
      if (result.status === "created") createdCount++;
      if (result.status === "reused") reusedCount++;
      if (result.status === "skipped") skippedCount++;
    }

    if (createdCount > 0 || reusedCount > 0) {
      clearDashboardAndCategoryCaches(shop);
    }

    return json({
      success: true,
      createdCount,
      reusedCount,
      skippedCount,
      message: snapshotCreationMessage(createdCount, reusedCount, skippedCount),
    } satisfies ActionResponse);
  }

  if (actionType === "create-recommended-snapshot") {
    const recommendationId = String(formData.get("recommendationId") || "");
    const recommendation = await prisma.storeSnapshotRecommendation.findFirst({
      where: { id: recommendationId, storeSnapshotId: snapshot.id },
    });

    if (!recommendation) {
      return json({ error: "Recommendation not found" }, { status: 404 });
    }

    const resource = resolveFocusedSnapshotResource({
      pagePath: recommendation.pagePath,
      pageType: recommendation.recommendedType || recommendation.pageType,
      resourceHandle: recommendation.resourceHandle,
    });

    if (!resource) {
      return json(
        { error: "This page cannot be converted into a focused snapshot yet" },
        { status: 400 },
      );
    }

    const existing = await findProjectWithActiveSnapshot(
      shop,
      resource.resourceType,
      resource.resourceHandle,
    );

    if (existing) {
      await prisma.storeSnapshotRecommendation.update({
        where: { id: recommendation.id },
        data: { status: "CREATED", createdProjectId: existing.id },
      });
      return redirect(`/app/project/${existing.id}`);
    }

    const project = await createFocusedSnapshot({
      shop,
      resourceType: resource.resourceType,
      resourceHandle: resource.resourceHandle,
      title: recommendation.pageTitle || recommendation.pagePath,
      targetVisitors: DEFAULT_FOCUSED_SNAPSHOT_TARGET_VISITORS,
    });

    clearDashboardAndCategoryCaches(shop);
    await prisma.storeSnapshotRecommendation.update({
      where: { id: recommendation.id },
      data: { status: "CREATED", createdProjectId: project.id },
    });

    return redirect(`/app/project/${project.id}`);
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

export default function StoreSnapshotDetails() {
  const { snapshot, stats, trackerStatus, focusedSnapshots } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as
    | ActionResponse
    | undefined;
  const submit = useSubmit();
  const navigation = useNavigation();
  const [selectedPageKeys, setSelectedPageKeys] = useState<string[]>([]);
  const [focusedTargetVisitors, setFocusedTargetVisitors] = useState(
    String(DEFAULT_FOCUSED_SNAPSHOT_TARGET_VISITORS),
  );
  const [pageFilter, setPageFilter] = useState<PageFilter>("human");
  const [pageSortKey, setPageSortKey] =
    useState<PageSortKey>("humanVisits");
  const [pageSortDirection, setPageSortDirection] =
    useState<SortDirection>("desc");
  const [pageTablePage, setPageTablePage] = useState(1);
  const isLoading = navigation.state !== "idle";

  if (!stats) {
    return (
      <Page
        title="Store snapshot"
        backAction={{ content: "Dashboard", url: "/app" }}
      >
        <Card>
          <Text as="p" tone="subdued">
            No snapshot data available yet.
          </Text>
        </Card>
      </Page>
    );
  }

  const total = Math.max(stats.visitorBreakdown.total, 1);
  const humanPct = (stats.visitorBreakdown.humans / total) * 100;
  const zombiePct = (stats.visitorBreakdown.zombies / total) * 100;
  const botPct = (stats.visitorBreakdown.bots / total) * 100;
  const allPages = stats.pageAggregates as StoreSnapshotPageSummary[];
  const pagesWithHumanVisitsCount = allPages.filter(
    (page) => page.humanVisits > 0,
  ).length;
  const basePages =
    pageFilter === "human"
      ? allPages.filter((page) => page.humanVisits > 0)
      : allPages;
  const filteredPages = [...basePages].sort((a, b) =>
    compareStoreSnapshotPages(a, b, pageSortKey, pageSortDirection),
  );
  const pageCount = Math.max(
    1,
    Math.ceil(filteredPages.length / PAGE_TABLE_PAGE_SIZE),
  );
  const currentPage = Math.min(pageTablePage, pageCount);
  const visiblePages = filteredPages.slice(
    (currentPage - 1) * PAGE_TABLE_PAGE_SIZE,
    currentPage * PAGE_TABLE_PAGE_SIZE,
  );
  const visibleStart =
    filteredPages.length === 0
      ? 0
      : (currentPage - 1) * PAGE_TABLE_PAGE_SIZE + 1;
  const visibleEnd = Math.min(
    currentPage * PAGE_TABLE_PAGE_SIZE,
    filteredPages.length,
  );
  const selectablePageKeys = visiblePages
    .filter(isPageSnapshotEligible)
    .map((page) => page.pageKey);
  const selectedPageCount = selectedPageKeys.length;
  const canSelectMorePages = selectedPageCount < MAX_BULK_SNAPSHOT_SELECTION;
  const selectedPageSet = new Set(selectedPageKeys);
  const visibleSelectionKeys = selectablePageKeys.slice(
    0,
    MAX_BULK_SNAPSHOT_SELECTION,
  );
  const allSelectableVisiblePagesSelected =
    visibleSelectionKeys.length > 0 &&
    visibleSelectionKeys.every((key) => selectedPageSet.has(key));

  const submitAction = (action: string, extra?: Record<string, string>) => {
    const formData = new FormData();
    formData.append("action", action);
    Object.entries(extra || {}).forEach(([key, value]) =>
      formData.append(key, value),
    );
    submit(formData, { method: "POST" });
  };

  const togglePageSelection = (pageKey: string, checked: boolean) => {
    setSelectedPageKeys((current) => {
      if (checked) {
        if (
          current.includes(pageKey) ||
          current.length >= MAX_BULK_SNAPSHOT_SELECTION
        )
          return current;
        return [...current, pageKey];
      }
      return current.filter((key) => key !== pageKey);
    });
  };

  const toggleVisibleSelection = (checked: boolean) => {
    setSelectedPageKeys((current) => {
      if (!checked) {
        return current.filter((key) => !selectablePageKeys.includes(key));
      }

      const next = [...current];
      for (const pageKey of selectablePageKeys) {
        if (next.length >= MAX_BULK_SNAPSHOT_SELECTION) break;
        if (!next.includes(pageKey)) next.push(pageKey);
      }
      return next;
    });
  };

  const handlePageFilterChange = (value: string) => {
    setPageFilter(value as PageFilter);
    setPageTablePage(1);
  };

  const handlePageSortKeyChange = (value: string) => {
    setPageSortKey(value as PageSortKey);
    setPageTablePage(1);
  };

  const handlePageSortDirectionChange = (value: string) => {
    setPageSortDirection(value as SortDirection);
    setPageTablePage(1);
  };

  const createSelectedSnapshots = () => {
    const formData = new FormData();
    formData.append("action", "create-page-snapshots");
    formData.append("targetVisitors", focusedTargetVisitors);
    selectedPageKeys.forEach((pageKey) => formData.append("pageKey", pageKey));
    submit(formData, { method: "POST" });
    setSelectedPageKeys([]);
  };

  return (
    <Page
      title={snapshot.name || "Store snapshot"}
      subtitle={subtitleForSnapshot(snapshot, stats.progress.label)}
      backAction={{ content: "Dashboard", url: "/app" }}
      primaryAction={
        snapshot.status === "ACTIVE"
          ? {
              content: "Complete now",
              onAction: () => submitAction("complete"),
              loading: isLoading,
            }
          : snapshot.status === "PAUSED"
            ? {
                content: "Resume",
                onAction: () => submitAction("resume"),
                loading: isLoading,
              }
            : undefined
      }
      secondaryActions={[
        snapshot.status === "ACTIVE"
          ? {
              content: "Pause",
              onAction: () => submitAction("pause"),
              loading: isLoading,
            }
          : snapshot.status === "PAUSED"
            ? {
                content: "Complete",
                onAction: () => submitAction("complete"),
                loading: isLoading,
              }
            : {
                content: "Refresh analysis",
                onAction: () => submitAction("complete"),
                loading: isLoading,
              },
        {
          content: "Delete",
          destructive: true,
          onAction: () => submitAction("delete"),
          loading: isLoading,
        },
      ]}
    >
      <TitleBar title={snapshot.name || "Store snapshot"} />

      <Layout>
        {actionData && "error" in actionData ? (
          <Layout.Section>
            <Banner tone="critical" title="Could not create snapshots">
              {actionData.error}
            </Banner>
          </Layout.Section>
        ) : actionData && "success" in actionData && actionData.message ? (
          <Layout.Section>
            <Banner tone="success">{actionData.message}</Banner>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <TrackingStatusBanner trackerStatus={trackerStatus} />
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="start" gap="300">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Visitor breakdown
                  </Text>
                  <Text as="p" tone="subdued">
                    Behavior captured across the storefront.
                  </Text>
                </BlockStack>
                <Badge
                  tone={
                    snapshot.status === "ACTIVE"
                      ? "success"
                      : snapshot.status === "PAUSED"
                        ? "warning"
                        : "info"
                  }
                >
                  {stats.progress.label}
                </Badge>
              </InlineStack>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 16,
                }}
              >
                <VisitorStat
                  title="Total visitors"
                  value={stats.visitorBreakdown.total}
                  caption="Humans + zombies + bots"
                  color="#2c6ecb"
                />
                <VisitorStat
                  title="Human visits"
                  value={stats.visitorBreakdown.humans}
                  caption="Engaged real page visits"
                  color="#008060"
                  badge="Visits"
                />
                <VisitorStat
                  title="Zombies"
                  value={stats.visitorBreakdown.zombies}
                  caption="Unengaged visitors"
                  color="#8a6116"
                />
                <VisitorStat
                  title="Bots"
                  value={stats.visitorBreakdown.bots}
                  caption="Automated / non-human"
                  color="#b5371f"
                />
              </div>
              <div
                style={{
                  height: 10,
                  borderRadius: 999,
                  overflow: "hidden",
                  display: "flex",
                  background: "#e4e5e7",
                }}
              >
                <div style={{ width: `${humanPct}%`, background: "#008060" }} />
                <div
                  style={{ width: `${zombiePct}%`, background: "#8a6116" }}
                />
                <div style={{ width: `${botPct}%`, background: "#b5371f" }} />
              </div>
              <InlineStack gap="400" wrap>
                <LegendItem
                  color="#008060"
                  label="Human visits"
                  value={`${stats.visitorBreakdown.humans.toLocaleString()} (${formatPercent(humanPct)})`}
                />
                <LegendItem
                  color="#8a6116"
                  label="Zombies"
                  value={`${stats.visitorBreakdown.zombies.toLocaleString()} (${formatPercent(zombiePct)})`}
                />
                <LegendItem
                  color="#b5371f"
                  label="Bots"
                  value={`${stats.visitorBreakdown.bots.toLocaleString()} (${formatPercent(botPct)})`}
                />
              </InlineStack>
              {snapshot.status === "ACTIVE" && stats.progress.target && (
                <BlockStack gap="150">
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      {progressTitle(stats.progress.mode)}
                    </Text>
                    <Text as="span" tone="subdued">
                      {formatProgress(
                        stats.progress.current,
                        stats.progress.target,
                        stats.progress.mode,
                      )}
                    </Text>
                  </InlineStack>
                  <ProgressBar
                    progress={Math.min(100, stats.progress.percent)}
                    tone="primary"
                  />
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd" tone="subdued">
              Engagement metrics per store snapshot
            </Text>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                gap: 16,
              }}
            >
              <MetricCard
                title="Scroll Depth"
                value={formatPercent(stats.metrics.avgScrollDepth)}
                delta={stats.deltas.avgScrollDepth}
                suffix="%"
                caption="avg. page reach"
              />
              <MetricCard
                title="Duration"
                value={formatTime(stats.metrics.avgTimeOnPage)}
                delta={stats.deltas.avgTimeOnPage}
                suffix="s"
                caption="avg. on page"
              />
              <MetricCard
                title="Searches"
                value={stats.metrics.searchCount.toLocaleString()}
                delta={stats.deltas.searchCount}
                caption="on-site queries"
              />
              <MetricCard
                title="CTR"
                value={formatPercent(stats.metrics.clickThroughRate)}
                delta={stats.deltas.clickThroughRate}
                suffix="%"
                caption="click-through rate"
              />
              <MetricCard
                title="ATC Rate"
                value={formatPercent(stats.metrics.addToCartRate)}
                delta={stats.deltas.addToCartRate}
                suffix="%"
                caption="add-to-cart rate"
              />
              <MetricCard
                title="CVR"
                value={formatPercent(stats.metrics.conversionRate)}
                delta={stats.deltas.conversionRate}
                suffix="%"
                caption="conversion rate"
              />
              <MetricCard
                title="Orders"
                value={stats.metrics.orderCount.toLocaleString()}
                delta={stats.deltas.orderCount}
                caption="placed this snapshot"
              />
              <MetricCard
                title="Revenue"
                value={formatMoney(stats.metrics.revenue)}
                delta={stats.deltas.revenue}
                caption="attributed revenue"
              />
            </div>
          </BlockStack>
        </Layout.Section>

        {stats.recommendations.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    Recommended next snapshots
                  </Text>
                  <Badge tone="info">
                    {stats.recommendations.length} recommendations
                  </Badge>
                </InlineStack>
                <BlockStack gap="250">
                  {stats.recommendations.map((recommendation) => (
                    <div
                      key={recommendation.pageKey}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) auto",
                        gap: 16,
                        alignItems: "center",
                        padding: "12px 0",
                        borderTop: "1px solid var(--p-color-border-subdued)",
                      }}
                    >
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="h3" variant="headingSm">
                            {recommendation.title}
                          </Text>
                          <TypeBadge type={recommendation.pageType} />
                          <Badge
                            tone={
                              recommendation.confidence >= 70
                                ? "success"
                                : "warning"
                            }
                          >
                            {recommendation.confidence}% confidence
                          </Badge>
                        </InlineStack>
                        <Text as="p" tone="subdued">
                          {recommendation.reason}
                        </Text>
                        <Text as="p" tone="subdued">
                          {recommendation.pagePath}
                        </Text>
                      </BlockStack>
                      {recommendation.id ? (
                        <Button
                          onClick={() =>
                            submitAction("create-recommended-snapshot", {
                              recommendationId: recommendation.id!,
                            })
                          }
                          loading={isLoading}
                        >
                          {recommendation.actionLabel}
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {focusedSnapshots.length > 0 && (
          <Layout.Section>
            <Card padding="0">
              <div
                style={{
                  padding: "16px 20px",
                  borderBottom: "1px solid var(--p-color-border-subdued)",
                }}
              >
                <InlineStack
                  align="space-between"
                  blockAlign="center"
                  gap="300"
                >
                  <BlockStack gap="050">
                    <Text as="h2" variant="headingMd">
                      Focused snapshots created from this store snapshot
                    </Text>
                    <Text as="p" tone="subdued">
                      These audits were created from selected pages in the
                      engagement table.
                    </Text>
                  </BlockStack>
                  <Badge tone="info">
                    {focusedSnapshots.length} focused{" "}
                    {focusedSnapshots.length === 1 ? "snapshot" : "snapshots"}
                  </Badge>
                </InlineStack>
              </div>
              {focusedSnapshots.map((focusedSnapshot, index) => (
                <FocusedSnapshotRow
                  key={focusedSnapshot.id}
                  snapshot={focusedSnapshot}
                  isLast={index === focusedSnapshots.length - 1}
                />
              ))}
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card padding="0">
            <div
              style={{
                padding: "20px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 20,
                flexWrap: "wrap",
              }}
            >
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  Pages landed on and engaged with
                </Text>
                <InlineStack gap="200" blockAlign="center" wrap>
                  <Text as="span" tone="subdued">
                    Select up to {MAX_BULK_SNAPSHOT_SELECTION} pages to create
                    focused snapshots.
                  </Text>
                  <Badge tone={selectedPageCount > 0 ? "info" : undefined}>
                    {selectedPageCount} selected
                  </Badge>
                </InlineStack>
                <Text as="span" tone="subdued">
                  {allPages.length.toLocaleString()} pages captured ·{" "}
                  {pagesWithHumanVisitsCount.toLocaleString()} with human visits
                  · each selected page snapshot will collect the target number
                  of real visitors.
                </Text>
              </BlockStack>

              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "flex-end",
                  gap: 12,
                  flexWrap: "wrap",
                  maxWidth: 560,
                }}
              >
                <div style={{ width: 180 }}>
                  <TextField
                    label="Focused snapshot target"
                    value={focusedTargetVisitors}
                    onChange={setFocusedTargetVisitors}
                    type="number"
                    min={MIN_FOCUSED_SNAPSHOT_TARGET_VISITORS}
                    max={MAX_FOCUSED_SNAPSHOT_TARGET_VISITORS}
                    autoComplete="off"
                    disabled={isLoading}
                  />
                </div>
                <Button
                  variant="primary"
                  onClick={createSelectedSnapshots}
                  disabled={selectedPageCount === 0}
                  loading={
                    isLoading &&
                    navigation.formData?.get("action") ===
                      "create-page-snapshots"
                  }
                >
                  Create snapshots
                  {selectedPageCount > 0 ? ` (${selectedPageCount})` : ""}
                </Button>
                {selectedPageCount > 0 ? (
                  <Button
                    onClick={() => setSelectedPageKeys([])}
                    disabled={isLoading}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>

            <div
              style={{
                padding: "14px 20px 16px",
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
                alignItems: "flex-end",
                background: "var(--p-color-bg-surface-secondary)",
                borderTop: "1px solid var(--p-color-border-secondary)",
              }}
            >
              <InlineStack gap="200" blockAlign="end" wrap>
                <div style={{ width: 190 }}>
                  <Select
                    label="Show"
                    options={PAGE_FILTER_OPTIONS}
                    value={pageFilter}
                    onChange={handlePageFilterChange}
                    disabled={isLoading}
                  />
                </div>
                <div style={{ width: 190 }}>
                  <Select
                    label="Sort by"
                    options={PAGE_SORT_OPTIONS}
                    value={pageSortKey}
                    onChange={handlePageSortKeyChange}
                    disabled={isLoading}
                  />
                </div>
                <div style={{ width: 170 }}>
                  <Select
                    label="Direction"
                    options={SORT_DIRECTION_OPTIONS}
                    value={pageSortDirection}
                    onChange={handlePageSortDirectionChange}
                    disabled={isLoading}
                  />
                </div>
              </InlineStack>
              <Text as="span" tone="subdued">
                Showing {visibleStart.toLocaleString()}-
                {visibleEnd.toLocaleString()} of{" "}
                {filteredPages.length.toLocaleString()} pages
              </Text>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: 900,
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: "var(--p-color-bg-surface-secondary)",
                    }}
                  >
                    <th
                      style={{
                        width: 52,
                        padding: "10px 0 10px 20px",
                        borderTop: "1px solid var(--p-color-border-subdued)",
                        borderBottom: "1px solid var(--p-color-border-subdued)",
                      }}
                    >
                      <Checkbox
                        label="Select visible pages"
                        labelHidden
                        checked={allSelectableVisiblePagesSelected}
                        onChange={toggleVisibleSelection}
                        disabled={
                          selectablePageKeys.length === 0 ||
                          isLoading ||
                          (!allSelectableVisiblePagesSelected &&
                            selectedPageCount >= MAX_BULK_SNAPSHOT_SELECTION)
                        }
                      />
                    </th>
                    {[
                      "Page",
                      "Type",
                      "Human visits",
                      "CTR",
                      "CVR",
                      "Revenue",
                      "Weakness",
                    ].map((header) => (
                      <th
                        key={header}
                        style={{
                          textAlign: header === "Page" ? "left" : "right",
                          padding: "10px 20px",
                          borderTop: "1px solid var(--p-color-border-subdued)",
                          borderBottom:
                            "1px solid var(--p-color-border-subdued)",
                        }}
                      >
                        <Text as="span" tone="subdued" fontWeight="semibold">
                          {header}
                        </Text>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visiblePages.length > 0 ? (
                    visiblePages.map((page) => (
                      <tr key={page.pageKey}>
                        <td
                          style={{
                            padding: "14px 0 14px 20px",
                            borderBottom:
                              "1px solid var(--p-color-border-subdued)",
                            verticalAlign: "top",
                          }}
                        >
                          <Checkbox
                            label={`Select ${page.pageTitle}`}
                            labelHidden
                            checked={selectedPageSet.has(page.pageKey)}
                            disabled={
                              !isPageSnapshotEligible(page) ||
                              isLoading ||
                              (!selectedPageSet.has(page.pageKey) &&
                                !canSelectMorePages)
                            }
                            onChange={(checked) =>
                              togglePageSelection(page.pageKey, checked)
                            }
                          />
                        </td>
                        <td
                          style={{
                            padding: "14px 20px",
                            borderBottom:
                              "1px solid var(--p-color-border-subdued)",
                          }}
                        >
                          <BlockStack gap="050">
                            <Text as="span" fontWeight="semibold">
                              {page.pageTitle}
                            </Text>
                            <Text as="span" tone="subdued">
                              {page.pagePath}
                            </Text>
                          </BlockStack>
                        </td>
                        <td style={tableNumStyle}>
                          <TypeBadge type={page.pageType} />
                        </td>
                        <td style={tableNumStyle}>
                          {page.humanVisits.toLocaleString()}
                        </td>
                        <td style={tableNumStyle}>
                          {formatPercent(page.clickThroughRate)}
                        </td>
                        <td style={tableNumStyle}>
                          {formatPercent(page.conversionRate)}
                        </td>
                        <td style={tableNumStyle}>
                          {formatMoney(page.revenue)}
                        </td>
                        <td style={tableNumStyle}>
                          <Badge
                            tone={
                              page.weaknessScore >= 60
                                ? "critical"
                                : page.weaknessScore >= 35
                                  ? "warning"
                                  : "success"
                            }
                          >
                            {page.weaknessScore}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={8}
                        style={{ padding: "20px", textAlign: "center" }}
                      >
                        <Text as="p" tone="subdued">
                          No storefront pages captured yet.
                        </Text>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div
              style={{
                padding: "14px 20px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
                borderTop: "1px solid var(--p-color-border-subdued)",
              }}
            >
              <Text as="span" tone="subdued">
                Page {currentPage.toLocaleString()} of{" "}
                {pageCount.toLocaleString()}
              </Text>
              <InlineStack gap="200">
                <Button
                  onClick={() => setPageTablePage(Math.max(1, currentPage - 1))}
                  disabled={currentPage <= 1 || isLoading}
                >
                  Previous
                </Button>
                <Button
                  onClick={() =>
                    setPageTablePage(Math.min(pageCount, currentPage + 1))
                  }
                  disabled={currentPage >= pageCount || isLoading}
                >
                  Next
                </Button>
              </InlineStack>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function FocusedSnapshotRow({
  snapshot,
  isLast,
}: {
  snapshot: FocusedSnapshotListItem;
  isLast: boolean;
}) {
  const metricDefs = getFocusedSnapshotMetricDefs(snapshot.resourceType);
  const progressPct = Math.min(
    100,
    Math.round(
      (snapshot.realCount / Math.max(snapshot.targetVisitors, 1)) * 100,
    ),
  );
  const isDone = progressPct >= 100 || snapshot.status === "COMPLETED";

  return (
    <Link
      to={`/app/project/${snapshot.id}`}
      prefetch="intent"
      style={{ color: "inherit", textDecoration: "none" }}
    >
      <div
        style={{
          padding: "14px 20px",
          borderBottom: isLast ? "none" : "1px solid #ebebeb",
          cursor: "pointer",
          transition: "background 0.15s",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background =
            "var(--p-color-bg-surface-hover)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = "transparent";
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <InlineStack gap="200" blockAlign="center">
              <Text variant="bodyMd" fontWeight="bold" as="span">
                {snapshot.productTitle}
              </Text>
              <TypeBadge type={snapshot.resourceType} />
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {snapshot.snapshotName}
              {snapshot.snapshotCount > 1
                ? ` · ${snapshot.snapshotCount} snapshots`
                : ""}{" "}
              · {snapshot.pagePath}
            </Text>
          </div>
          <div style={{ flex: "1 1 180px", maxWidth: 240 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 4,
              }}
            >
              <Text as="span" variant="bodySm" tone="subdued">
                {snapshot.realCount.toLocaleString()}/
                {snapshot.targetVisitors.toLocaleString()}
              </Text>
              <StatusBadge status={snapshot.status} />
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
          <div
            style={{
              display: "flex",
              gap: 24,
              flexShrink: 0,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            {metricDefs.map((metric) => {
              const value = snapshot.metricValues[metric.key] || 0;
              return (
                <div
                  key={metric.key}
                  style={{ textAlign: "center", minWidth: 82 }}
                >
                  <Text as="p" variant="bodySm" tone="subdued">
                    {metric.label}
                  </Text>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {metric.format(value)}
                  </Text>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Link>
  );
}

function TrackingStatusBanner({
  trackerStatus,
}: {
  trackerStatus: StorefrontTrackerStatus;
}) {
  if (trackerStatus.status === "active") {
    return (
      <Banner tone="success">
        Rich storefront tracking is active on{" "}
        {formatStorefrontHost(trackerStatus.storefrontUrl)}.
      </Banner>
    );
  }

  return (
    <Banner
      title={
        trackerStatus.status === "missing"
          ? "Rich storefront tracking is not active"
          : "Could not verify rich storefront tracking"
      }
      tone={trackerStatus.status === "missing" ? "warning" : "info"}
    >
      <BlockStack gap="100">
        <Text as="p">
          {trackerStatus.message}{" "}
          {trackerStatus.status === "missing"
            ? "This snapshot will not collect storefront visits until the Mouse Whisperer theme app embed is enabled on the live theme."
            : "If the Mouse Whisperer theme app embed is enabled on the live theme, this snapshot can still collect visits; otherwise no visits will be collected."}
        </Text>
        <Text as="p" tone="subdued">
          Checked {formatStorefrontHost(trackerStatus.storefrontUrl)}.
        </Text>
      </BlockStack>
    </Banner>
  );
}

function formatStorefrontHost(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

const tableNumStyle = {
  padding: "14px 20px",
  borderBottom: "1px solid var(--p-color-border-subdued)",
  textAlign: "right" as const,
  whiteSpace: "nowrap" as const,
};

function compareStoreSnapshotPages(
  a: StoreSnapshotPageSummary,
  b: StoreSnapshotPageSummary,
  sortKey: PageSortKey,
  direction: SortDirection,
) {
  const directionMultiplier = direction === "asc" ? 1 : -1;
  const numberValue = (page: StoreSnapshotPageSummary) => {
    if (sortKey === "humanVisits") return page.humanVisits;
    if (sortKey === "clickThroughRate") return page.clickThroughRate;
    if (sortKey === "conversionRate") return page.conversionRate;
    if (sortKey === "revenue") return page.revenue;
    if (sortKey === "weaknessScore") return page.weaknessScore;
    return 0;
  };

  let comparison = 0;
  if (sortKey === "page") {
    comparison = (a.pageTitle || a.pagePath).localeCompare(
      b.pageTitle || b.pagePath,
      undefined,
      { sensitivity: "base" },
    );
  } else if (sortKey === "type") {
    comparison = String(a.pageType || "OTHER").localeCompare(
      String(b.pageType || "OTHER"),
      undefined,
      { sensitivity: "base" },
    );
  } else {
    comparison = numberValue(a) - numberValue(b);
  }

  if (comparison !== 0) return comparison * directionMultiplier;

  const humanVisitTieBreak = b.humanVisits - a.humanVisits;
  if (humanVisitTieBreak !== 0) return humanVisitTieBreak;

  return (a.pageTitle || a.pagePath).localeCompare(
    b.pageTitle || b.pagePath,
    undefined,
    { sensitivity: "base" },
  );
}

function VisitorStat({
  title,
  value,
  caption,
  color,
  badge,
}: {
  title: string;
  value: number;
  caption: string;
  color: string;
  badge?: string;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--p-color-border-subdued)",
        borderRadius: 8,
        padding: "16px 18px",
        borderLeft: `4px solid ${color}`,
      }}
    >
      <InlineStack gap="200" blockAlign="center">
        <Text as="p" fontWeight="semibold">
          {title}
        </Text>
        {badge ? <Badge tone="success">{badge}</Badge> : null}
      </InlineStack>
      <Text as="p" variant="heading2xl" fontWeight="semibold">
        {value.toLocaleString()}
      </Text>
      <Text as="p" tone="subdued">
        {caption}
      </Text>
    </div>
  );
}

function LegendItem({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <InlineStack gap="150" blockAlign="center">
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 3,
          background: color,
          display: "inline-block",
        }}
      />
      <Text as="span">
        {label} {value}
      </Text>
    </InlineStack>
  );
}

function MetricCard({
  title,
  value,
  delta,
  suffix,
  caption,
}: {
  title: string;
  value: string;
  delta?: number | null;
  suffix?: string;
  caption: string;
}) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="p" tone="subdued" fontWeight="semibold">
          {title}
        </Text>
        <Text as="p" variant="heading2xl" fontWeight="semibold">
          {value}
        </Text>
        <InlineStack gap="150" blockAlign="center">
          {typeof delta === "number" ? (
            <Badge tone={delta >= 0 ? "success" : "critical"}>
              {delta >= 0 ? "+" : ""}
              {formatDelta(delta, suffix)}
            </Badge>
          ) : null}
          <Text as="span" tone="subdued">
            {caption}
          </Text>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function TypeBadge({ type }: { type: ResourceType | null }) {
  if (type === "PRODUCT") return <Badge tone="info">Product</Badge>;
  if (type === "COLLECTION") return <Badge tone="success">Collection</Badge>;
  if (type === "HOMEPAGE") return <Badge>Home</Badge>;
  if (type === "BLOG") return <Badge tone="attention">Blog</Badge>;
  if (type === "PAGE") return <Badge tone="warning">Page</Badge>;
  return <Badge>Page</Badge>;
}

function subtitleForSnapshot(
  snapshot: { status: string; startedAt: string; completedAt: string | null },
  label: string,
) {
  const status = snapshot.status.toLowerCase();
  const date = snapshot.completedAt || snapshot.startedAt;
  return `${label} · ${status} · started ${new Date(date).toLocaleDateString()}`;
}

function progressTitle(mode: string) {
  if (mode === "HUMAN_VISITORS") return "Progress: unique human visitors";
  if (mode === "TOTAL_VISITS") return "Progress: total visits";
  if (mode === "TIME_WINDOW") return "Progress: time window";
  return "Progress";
}

function formatProgress(current: number, target: number, mode: string) {
  if (mode === "TIME_WINDOW") {
    const daysRemaining = Math.max(
      0,
      Math.ceil((target - current) / (24 * 60 * 60 * 1000)),
    );
    return `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining`;
  }
  return `${current.toLocaleString()} / ${target.toLocaleString()}`;
}

function formatPercent(value: number) {
  return `${Number(value || 0)
    .toFixed(1)
    .replace(/\.0$/, "")}%`;
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.round(seconds || 0));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDelta(value: number, suffix?: string) {
  const abs = Math.abs(value);
  if (suffix === "s") return `${Math.round(abs)}s`;
  if (suffix === "%") return `${abs.toFixed(1).replace(/\.0$/, "")}%`;
  return abs.toLocaleString();
}

function normalizeFocusedSnapshotTargetVisitors(
  value: FormDataEntryValue | null,
) {
  const parsed = parseInt(
    String(value || DEFAULT_FOCUSED_SNAPSHOT_TARGET_VISITORS),
    10,
  );
  if (!Number.isFinite(parsed)) return DEFAULT_FOCUSED_SNAPSHOT_TARGET_VISITORS;
  return Math.min(
    Math.max(parsed, MIN_FOCUSED_SNAPSHOT_TARGET_VISITORS),
    MAX_FOCUSED_SNAPSHOT_TARGET_VISITORS,
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ACTIVE") return <Badge tone="success">Active</Badge>;
  if (status === "COMPLETED") return <Badge tone="info">Done</Badge>;
  if (status === "PAUSED") return <Badge tone="warning">Paused</Badge>;
  return <Badge>{status}</Badge>;
}

type FocusedSnapshotMetricDef = {
  key: string;
  label: string;
  format: (value: number) => string;
};

function getFocusedSnapshotMetricDefs(
  resourceType: ResourceType,
): FocusedSnapshotMetricDef[] {
  if (resourceType === "COLLECTION") {
    return [
      { key: "linkClicks", label: "Links", format: formatCount },
      { key: "searches", label: "Searches", format: formatCount },
      { key: "productCtrRate", label: "Product CTR", format: formatPercent },
    ];
  }

  if (resourceType === "PAGE" || resourceType === "HOMEPAGE") {
    return [
      { key: "linkClicks", label: "Links", format: formatCount },
      { key: "searches", label: "Searches", format: formatCount },
      { key: "bodyCtaCtrRate", label: "CTA CTR", format: formatPercent },
    ];
  }

  if (resourceType === "BLOG") {
    return [
      { key: "bounceRate", label: "Bounce", format: formatPercent },
      { key: "scroll50Rate", label: "50% scroll", format: formatPercent },
      { key: "anyClickCtrRate", label: "CTR", format: formatPercent },
    ];
  }

  return [
    { key: "atcRate", label: "ATC", format: formatPercent },
    { key: "cvrRate", label: "CVR", format: formatPercent },
    { key: "revenue", label: "REV", format: formatMoney },
  ];
}

function getMetricValuesFromSnapshotStats(
  resourceType: ResourceType,
  rawStats: Prisma.JsonValue | null,
) {
  const stats =
    rawStats && typeof rawStats === "object" && !Array.isArray(rawStats)
      ? (rawStats as Record<string, unknown>)
      : null;
  const numberValue = (key: string) => {
    const value = stats?.[key];
    return typeof value === "number" ? value : 0;
  };

  if (resourceType === "COLLECTION") {
    return {
      linkClicks: numberValue("linkClickCount"),
      searches: numberValue("searchCount"),
      productCtrRate: numberValue("productCtrRate"),
    };
  }

  if (resourceType === "PAGE" || resourceType === "HOMEPAGE") {
    return {
      linkClicks: numberValue("linkClickCount"),
      searches: numberValue("searchCount"),
      bodyCtaCtrRate: numberValue("bodyCtaCtrRate"),
    };
  }

  if (resourceType === "BLOG") {
    return {
      bounceRate: numberValue("bounceRate"),
      scroll50Rate: numberValue("scroll50Rate"),
      anyClickCtrRate: numberValue("anyClickCtrRate"),
    };
  }

  return {
    atcRate: numberValue("atcRate"),
    cvrRate: numberValue("convRate"),
    revenue: numberValue("totalRevenue"),
  };
}

function formatCount(value: number) {
  return Math.round(value || 0).toLocaleString();
}

async function getFocusedSnapshotsCreatedFromStoreSnapshot(
  storeSnapshotId: string,
  shop: string,
): Promise<FocusedSnapshotListItem[]> {
  const links = await prisma.storeSnapshotRecommendation.findMany({
    where: {
      storeSnapshotId,
      status: "CREATED",
      createdProjectId: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      createdProjectId: true,
      pagePath: true,
      pageTitle: true,
      pageType: true,
      resourceHandle: true,
      updatedAt: true,
    },
  });

  const projectIds = Array.from(
    new Set(links.map((link) => link.createdProjectId).filter(Boolean)),
  ) as string[];
  if (projectIds.length === 0) return [];

  const projects = await prisma.project.findMany({
    where: { shop, id: { in: projectIds } },
    select: {
      id: true,
      productTitle: true,
      resourceType: true,
      _count: { select: { snapshots: true } },
      snapshots: {
        orderBy: { number: "desc" },
        take: 1,
        select: {
          id: true,
          name: true,
          number: true,
          status: true,
          targetVisitors: true,
          statsCache: { select: { stats: true } },
          _count: {
            select: { visits: { where: { visitorType: "REAL" } } },
          },
        },
      },
    },
  });
  const projectById = new Map(projects.map((project) => [project.id, project]));

  return links
    .map((link) => {
      if (!link.createdProjectId) return null;
      const project = projectById.get(link.createdProjectId);
      const latestSnapshot = project?.snapshots[0];
      if (!project || !latestSnapshot) return null;

      return {
        id: project.id,
        productTitle: project.productTitle,
        resourceType: project.resourceType,
        pagePath: link.pagePath,
        snapshotName:
          latestSnapshot.name || `Snapshot ${latestSnapshot.number || 1}`,
        snapshotCount: project._count.snapshots,
        status: latestSnapshot.status,
        realCount: latestSnapshot._count.visits,
        targetVisitors: latestSnapshot.targetVisitors,
        metricValues: getMetricValuesFromSnapshotStats(
          project.resourceType,
          latestSnapshot.statsCache?.stats ?? null,
        ),
      } satisfies FocusedSnapshotListItem;
    })
    .filter((snapshot): snapshot is FocusedSnapshotListItem =>
      Boolean(snapshot),
    );
}

type FocusedSnapshotResource = {
  resourceType: ResourceType;
  resourceHandle: string;
};

function resolveFocusedSnapshotResource({
  pagePath,
  pageType,
  resourceHandle,
}: {
  pagePath: string;
  pageType: ResourceType | null;
  resourceHandle: string | null;
}): FocusedSnapshotResource | null {
  const resourceType = pageType || inferResourceTypeFromPagePath(pagePath);
  const resolvedHandle =
    resourceHandle || inferResourceHandleFromPagePath(pagePath, resourceType);

  if (!resourceType || !resolvedHandle) return null;
  return { resourceType, resourceHandle: resolvedHandle };
}

function getFocusedSnapshotResource(
  page: StoreSnapshotPageSummary,
): FocusedSnapshotResource | null {
  return resolveFocusedSnapshotResource({
    pagePath: page.pagePath,
    pageType: page.pageType,
    resourceHandle: page.resourceHandle,
  });
}

function isPageSnapshotEligible(page: StoreSnapshotPageSummary) {
  return Boolean(getFocusedSnapshotResource(page));
}

function normalizeStorefrontPath(value: string | null | undefined): string {
  if (!value) return "/";

  try {
    const url = new URL(value, "https://example.com");
    const path = url.pathname || "/";
    return path.length > 1 ? path.replace(/\/+$/, "") : "/";
  } catch {
    const path = value.split("?")[0].split("#")[0] || "/";
    return path.startsWith("/")
      ? path.replace(/\/+$/, "") || "/"
      : `/${path.replace(/\/+$/, "")}`;
  }
}

function inferResourceTypeFromPagePath(path: string): ResourceType | null {
  const normalized = normalizeStorefrontPath(path);
  if (normalized === "/") return "HOMEPAGE";
  if (normalized.startsWith("/products/")) return "PRODUCT";
  if (normalized.startsWith("/collections/")) return "COLLECTION";
  if (normalized.startsWith("/pages/")) return "PAGE";
  if (normalized.startsWith("/blogs/")) return "BLOG";
  return null;
}

function inferResourceHandleFromPagePath(
  path: string,
  resourceType: ResourceType | null,
) {
  const normalized = normalizeStorefrontPath(path);
  if (resourceType === "HOMEPAGE") return "__homepage__";

  const matchers: Partial<Record<ResourceType, RegExp>> = {
    PRODUCT: /^\/products\/([^/?#]+)/,
    COLLECTION: /^\/collections\/([^/?#]+)/,
    PAGE: /^\/pages\/([^/?#]+)/,
    BLOG: /^\/blogs\/(.+)$/,
  };
  const matcher = resourceType ? matchers[resourceType] : null;
  const match = matcher ? normalized.match(matcher) : null;
  return match ? decodeURIComponent(match[1]) : null;
}

async function recordFocusedSnapshotLink({
  storeSnapshotId,
  page,
  projectId,
  resource,
}: {
  storeSnapshotId: string;
  page: StoreSnapshotPageSummary;
  projectId: string;
  resource: FocusedSnapshotResource;
}) {
  const pageAggregate = await prisma.storeSnapshotPageAggregate
    .findUnique({
      where: {
        storeSnapshotId_pageKey: {
          storeSnapshotId,
          pageKey: page.pageKey,
        },
      },
      select: { id: true },
    })
    .catch(() => null);
  const existing = await prisma.storeSnapshotRecommendation.findFirst({
    where: { storeSnapshotId, pageKey: page.pageKey },
    select: { id: true },
  });
  const data = {
    pageAggregateId: pageAggregate?.id ?? null,
    pageKey: page.pageKey,
    pagePath: page.pagePath,
    pageTitle: page.pageTitle,
    pageType: resource.resourceType,
    resourceHandle: resource.resourceHandle,
    recommendedType: resource.resourceType,
    priority: page.weaknessScore,
    confidence: page.confidence,
    weaknessScore: page.weaknessScore,
    opportunityScore: page.opportunityScore,
    title: `Focused snapshot for ${page.pageTitle || page.pagePath}`,
    reason: "Created from the store snapshot engagement table.",
    actionLabel: "Open focused snapshot",
    status: "CREATED" as const,
    createdProjectId: projectId,
  };

  if (existing) {
    await prisma.storeSnapshotRecommendation.update({
      where: { id: existing.id },
      data,
    });
    return;
  }

  await prisma.storeSnapshotRecommendation.create({
    data: {
      storeSnapshotId,
      ...data,
    },
  });
}

async function findProjectWithActiveSnapshot(
  shop: string,
  resourceType: ResourceType,
  resourceHandle: string,
) {
  return prisma.project.findFirst({
    where: {
      shop,
      resourceType,
      productHandle: resourceHandle,
      snapshots: { some: { status: "ACTIVE" } },
    },
    select: { id: true },
  });
}

async function createFocusedSnapshot({
  shop,
  resourceType,
  resourceHandle,
  title,
  targetVisitors,
}: {
  shop: string;
  resourceType: ResourceType;
  resourceHandle: string;
  title: string;
  targetVisitors: number;
}) {
  const productId = syntheticResourceId(resourceType, resourceHandle);
  const productTitle = title?.trim() || resourceHandle;

  const project = await prisma.project.findFirst({
    where: { shop, resourceType, productHandle: resourceHandle },
    include: { _count: { select: { snapshots: true } } },
  });

  if (project) {
    await prisma.snapshot.create({
      data: {
        projectId: project.id,
        number: project._count.snapshots + 1,
        name: "From store snapshot",
        targetVisitors,
        status: "ACTIVE",
      },
    });
    return project;
  }

  return prisma.project.create({
    data: {
      shop,
      resourceType,
      productId,
      productTitle,
      productHandle: resourceHandle,
      snapshots: {
        create: {
          number: 1,
          name: "From store snapshot",
          targetVisitors,
          status: "ACTIVE",
        },
      },
    },
  });
}

async function createFocusedSnapshotFromStorePage(
  shop: string,
  storeSnapshotId: string,
  page: StoreSnapshotPageSummary,
  targetVisitors: number,
) {
  const resource = getFocusedSnapshotResource(page);
  if (!resource) return { status: "skipped" as const };

  const existing = await findProjectWithActiveSnapshot(
    shop,
    resource.resourceType,
    resource.resourceHandle,
  );
  if (existing) {
    await recordFocusedSnapshotLink({
      storeSnapshotId,
      page,
      projectId: existing.id,
      resource,
    });
    return { status: "reused" as const, project: existing };
  }

  const project = await createFocusedSnapshot({
    shop,
    resourceType: resource.resourceType,
    resourceHandle: resource.resourceHandle,
    title: page.pageTitle || page.pagePath,
    targetVisitors,
  });
  await recordFocusedSnapshotLink({
    storeSnapshotId,
    page,
    projectId: project.id,
    resource,
  });
  return { status: "created" as const, project };
}

function snapshotCreationMessage(
  createdCount: number,
  reusedCount: number,
  skippedCount: number,
) {
  const parts = [];
  if (createdCount > 0)
    parts.push(
      `${createdCount} ${pluralize("snapshot", createdCount)} created`,
    );
  if (reusedCount > 0)
    parts.push(
      `${reusedCount} already had active ${pluralize("snapshot", reusedCount)}`,
    );
  if (skippedCount > 0)
    parts.push(`${skippedCount} ${pluralize("page", skippedCount)} skipped`);
  return parts.length > 0 ? parts.join(". ") : "No new snapshots were created.";
}

function pluralize(label: string, count: number) {
  return count === 1 ? label : `${label}s`;
}

function syntheticResourceId(resourceType: ResourceType, handle: string) {
  if (resourceType === "HOMEPAGE") return "gid://shopify/Homepage/__homepage__";
  const type =
    resourceType === "PRODUCT"
      ? "Product"
      : resourceType === "COLLECTION"
        ? "Collection"
        : resourceType === "BLOG"
          ? "Blog"
          : "Page";
  return `gid://shopify/${type}/${handle}`;
}

function clearDashboardAndCategoryCaches(shop: string) {
  clearCacheKey(loaderCacheKeys.dashboard(shop));
  clearCachePrefix(loaderCacheKeys.categoryPrefix(shop));
  clearCachePrefix(loaderCacheKeys.categoryFastPrefix(shop));
}
