import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Card,
  FormLayout,
  TextField,
  Select,
  BlockStack,
  Text,
  Button,
  Banner,
  Box,
  InlineStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sanitizeHTML } from "../utils/sanitize.server";
import { COMMUNITY_FEATURES_ENABLED } from "../utils/features";
import { RichTextEditor } from "../components/challenges/RichTextEditor";
import { SnapshotStatsPicker } from "../components/challenges/SnapshotStatsPicker";

const CATEGORY_OPTIONS = [
  { label: "Select a category", value: "" },
  { label: "High Bot Traffic", value: "HIGH_BOT_TRAFFIC" },
  { label: "Low Engagement", value: "LOW_ENGAGEMENT" },
  { label: "Source Quality", value: "SOURCE_QUALITY" },
  { label: "Conversion Drop", value: "CONVERSION_DROP" },
  { label: "General", value: "GENERAL" },
];

const NON_INTERNAL_EXIT_TYPES = ["window_closed", "back_button", "idle", "external_link"];

type TrackedClick = {
  label?: string;
  tag?: string;
  href?: string | null;
  zone?: string;
};

function percent(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatPercent(value: number): string {
  return `${Number(value || 0).toFixed(1).replace(/\.0$/, "")}%`;
}

function parseTrackedClicks(raw: string | null): TrackedClick[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;

    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed).flatMap(([label, count]) => {
        const clickCount = typeof count === "number" ? count : 0;
        return Array.from({ length: clickCount }, () => ({ label, tag: "button", zone: "main" }));
      });
    }
  } catch {}

  return [];
}

function isLinkClick(click: TrackedClick): boolean {
  return (click.tag || "").toLowerCase() === "a" && !!click.href;
}

function isBodyCtaClick(click: TrackedClick): boolean {
  const tag = (click.tag || "").toLowerCase();
  return (click.zone || "main") === "main" && (tag === "button" || tag === "input");
}

function isLinkOrButtonClick(click: TrackedClick): boolean {
  const tag = (click.tag || "").toLowerCase();
  return tag === "a" || tag === "button" || tag === "input";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!COMMUNITY_FEATURES_ENABLED) {
    return redirect("/app");
  }

  const shop = session.shop;

  const profile = await prisma.insightProfile.findUnique({ where: { shop } });
  if (!profile) {
    return redirect(`/app/challenges/profile?returnTo=/app/challenges/new`);
  }

  // Fetch snapshots for the picker
  const projects = await prisma.project.findMany({
    where: { shop },
    include: {
      snapshots: {
        where: { status: { in: ["ACTIVE", "COMPLETED"] } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, number: true, name: true },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  const snapshots = projects.flatMap((p) =>
    p.snapshots.map((s) => ({
      id: s.id,
      label: `${p.productTitle} — Snapshot #${s.number}${s.name ? ` (${s.name})` : ""}`,
    })),
  );

  return json({ snapshots });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!COMMUNITY_FEATURES_ENABLED) {
    return redirect("/app");
  }

  const shop = session.shop;

  const profile = await prisma.insightProfile.findUnique({ where: { shop } });
  if (!profile) {
    return redirect(`/app/challenges/profile?returnTo=/app/challenges/new`);
  }

  const formData = await request.formData();
  const title = (formData.get("title") as string)?.trim();
  const content = formData.get("content") as string;
  const category = formData.get("category") as string;
  const snapshotId = formData.get("snapshotId") as string;

  const errors: Record<string, string> = {};
  if (!title || title.length < 3 || title.length > 200) {
    errors.title = "Title must be between 3 and 200 characters.";
  }
  if (!content || content === "<p></p>" || content.trim().length === 0) {
    errors.content = "Content cannot be empty.";
  }
  if (!category || !CATEGORY_OPTIONS.some((o) => o.value === category && o.value !== "")) {
    errors.category = "Please select a category.";
  }

  if (Object.keys(errors).length > 0) {
    return json({ errors }, { status: 400 });
  }

  const sanitizedContent = sanitizeHTML(content);

  // Build anonymized snapshot stats if selected
  let snapshotStats = null;
  if (snapshotId) {
    const snapshot = await prisma.snapshot.findFirst({
      where: { id: snapshotId, project: { shop } },
    });
    if (snapshot) {
      snapshotStats = await buildAnonymizedStats(snapshotId);
    }
  }

  const insight = await prisma.insight.create({
    data: {
      profileId: profile.id,
      title,
      content: sanitizedContent,
      category: category as any,
      snapshotStats: snapshotStats ?? undefined,
    },
  });

  return redirect(`/app/challenges/${insight.id}`);
};

async function buildAnonymizedStats(snapshotId: string) {
  const [
    typeCounts,
    metrics,
    sourceCats,
    deviceCounts,
    snapshotWithProject,
    atcCount,
    convCount,
    productClickCount,
    searchCount,
    exitCount,
    scroll50Count,
    scroll100Count,
    ctaRows,
    bounceRows,
  ] = await Promise.all([
    prisma.visit.groupBy({
      by: ["visitorType"],
      where: { snapshotId },
      _count: true,
    }),
    prisma.visit.aggregate({
      where: { snapshotId, visitorType: "REAL" },
      _avg: { timeOnPage: true, scrollDepth: true },
    }),
    prisma.visit.groupBy({
      by: ["sourceCategory"],
      where: { snapshotId },
      _count: true,
      orderBy: { _count: { sourceCategory: "desc" } },
      take: 5,
    }),
    prisma.visit.groupBy({
      by: ["deviceType"],
      where: { snapshotId },
      _count: true,
      orderBy: { _count: { deviceType: "desc" } },
    }),
    prisma.snapshot.findUnique({
      where: { id: snapshotId },
      include: { project: { select: { resourceType: true } } },
    }),
    prisma.visit.count({ where: { snapshotId, addedToCart: true } }),
    prisma.visit.count({ where: { snapshotId, converted: true } }),
    prisma.visit.count({ where: { snapshotId, exitUrl: { contains: "/products/" } } }),
    prisma.visit.count({ where: { snapshotId, searchQuery: { not: null } } }),
    prisma.visit.count({ where: { snapshotId, exitType: { in: NON_INTERNAL_EXIT_TYPES } } }),
    prisma.visit.count({ where: { snapshotId, scrollDepth: { gte: 50 } } }),
    prisma.visit.count({ where: { snapshotId, scrollDepth: { gte: 100 } } }),
    prisma.visit.findMany({ where: { snapshotId, ctaClicks: { not: null } }, select: { ctaClicks: true } }),
    prisma.visit.findMany({
      where: {
        snapshotId,
        scrollDepth: { lt: 50 },
        exitType: { in: NON_INTERNAL_EXIT_TYPES },
      },
      select: { ctaClicks: true },
    }),
  ]);

  let total = 0, real = 0, zombie = 0, bot = 0;
  typeCounts.forEach((t) => {
    total += t._count;
    if (t.visitorType === "REAL") real = t._count;
    if (t.visitorType === "ZOMBIE") zombie = t._count;
    if (t.visitorType === "BOT") bot = t._count;
  });

  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const resourceType = snapshotWithProject?.project.resourceType || "PRODUCT";
  let linkClickCount = 0;
  let bodyCtaVisits = 0;
  let anyClickVisits = 0;

  ctaRows.forEach((row) => {
    const clicks = parseTrackedClicks(row.ctaClicks);
    linkClickCount += clicks.filter(isLinkClick).length;
    if (clicks.some(isBodyCtaClick)) bodyCtaVisits++;
    if (clicks.some(isLinkOrButtonClick)) anyClickVisits++;
  });

  const bounceCount = bounceRows.filter((row) =>
    parseTrackedClicks(row.ctaClicks).filter(isLinkOrButtonClick).length === 0
  ).length;

  const summaryMetrics = (() => {
    if (resourceType === "COLLECTION") {
      return [
        { label: "Links", value: formatCount(linkClickCount) },
        { label: "Search", value: formatCount(searchCount) },
        { label: "Exit", value: formatPercent(percent(exitCount, total)) },
        { label: "Product CTR", value: formatPercent(percent(productClickCount, total)) },
      ];
    }

    if (resourceType === "PAGE" || resourceType === "HOMEPAGE") {
      return [
        { label: "Links", value: formatCount(linkClickCount) },
        { label: "Search", value: formatCount(searchCount) },
        { label: "Exit", value: formatPercent(percent(exitCount, total)) },
        { label: "CTA CTR", value: formatPercent(percent(bodyCtaVisits, total)) },
      ];
    }

    if (resourceType === "BLOG") {
      return [
        { label: "Bounce", value: formatPercent(percent(bounceCount, total)) },
        { label: "50% Scroll", value: formatPercent(percent(scroll50Count, total)) },
        { label: "100% Scroll", value: formatPercent(percent(scroll100Count, total)) },
        { label: "CTR", value: formatPercent(percent(anyClickVisits, total)) },
      ];
    }

    return [
      { label: "Real", value: formatPercent(pct(real)) },
      { label: "ATC", value: formatPercent(pct(atcCount)) },
      { label: "Conv", value: formatPercent(pct(convCount)) },
      { label: "Avg Scroll", value: formatPercent(Math.round(metrics._avg.scrollDepth || 0)) },
    ];
  })();

  return {
    totalSessions: total,
    realPercent: pct(real),
    zombiePercent: pct(zombie),
    botPercent: pct(bot),
    avgTimeOnPage: metrics._avg.timeOnPage ? Math.round(metrics._avg.timeOnPage / 1000) : 0,
    avgScrollDepth: Math.round(metrics._avg.scrollDepth || 0),
    addToCartRate: pct(atcCount),
    conversionRate: pct(convCount),
    resourceType,
    rateLabel: resourceType === "PRODUCT" ? "ATC" : undefined,
    summaryMetrics,
    topSourceCategories: sourceCats.map((s) => ({
      name: s.sourceCategory || "Direct",
      percent: pct(s._count),
    })),
    deviceBreakdown: deviceCounts.map((d) => ({
      type: d.deviceType || "Unknown",
      percent: pct(d._count),
    })),
  };
}

export default function NewInsight() {
  const { snapshots } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");

  const errors = (actionData as any)?.errors || {};

  return (
    <Page
      backAction={{ content: "Challenges", url: "/app/challenges" }}
      title="New Insight"
    >
      <TitleBar title="New Insight" />
      <Form method="post">
        <BlockStack gap="400">
          {Object.keys(errors).length > 0 && (
            <Banner tone="critical">
              <p>Please fix the errors below.</p>
            </Banner>
          )}

          <Card>
            <FormLayout>
              <TextField
                label="Title"
                name="title"
                value={title}
                onChange={setTitle}
                autoComplete="off"
                maxLength={200}
                error={errors.title}
                helpText="Briefly describe your traffic pattern or question."
              />

              <Select
                label="Category"
                name="category"
                options={CATEGORY_OPTIONS}
                value={category}
                onChange={setCategory}
                error={errors.category}
              />

              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  Description
                </Text>
                {errors.content && (
                  <Text as="p" tone="critical">{errors.content}</Text>
                )}
                <RichTextEditor
                  name="content"
                  placeholder="Describe the traffic pattern you're seeing, what you've tried, and what kind of help you're looking for..."
                />
              </BlockStack>
            </FormLayout>
          </Card>

          <Card>
            <SnapshotStatsPicker snapshots={snapshots} />
          </Card>

          <Box paddingBlockEnd="400">
            <InlineStack align="end">
              <Button variant="primary" submit loading={isSubmitting}>
                Post insight
              </Button>
            </InlineStack>
          </Box>
        </BlockStack>
      </Form>
    </Page>
  );
}
