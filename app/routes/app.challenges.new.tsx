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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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
      snapshotStats,
    },
  });

  return redirect(`/app/challenges/${insight.id}`);
};

async function buildAnonymizedStats(snapshotId: string) {
  const [typeCounts, metrics, sourceCats, deviceCounts] = await Promise.all([
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
  ]);

  let total = 0, real = 0, zombie = 0, bot = 0;
  typeCounts.forEach((t) => {
    total += t._count;
    if (t.visitorType === "REAL") real = t._count;
    if (t.visitorType === "ZOMBIE") zombie = t._count;
    if (t.visitorType === "BOT") bot = t._count;
  });

  const [atcCount, convCount] = await Promise.all([
    prisma.visit.count({ where: { snapshotId, addedToCart: true } }),
    prisma.visit.count({ where: { snapshotId, converted: true } }),
  ]);

  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  return {
    totalSessions: total,
    realPercent: pct(real),
    zombiePercent: pct(zombie),
    botPercent: pct(bot),
    avgTimeOnPage: metrics._avg.timeOnPage ? Math.round(metrics._avg.timeOnPage / 1000) : 0,
    avgScrollDepth: Math.round(metrics._avg.scrollDepth || 0),
    addToCartRate: pct(atcCount),
    conversionRate: pct(convCount),
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
