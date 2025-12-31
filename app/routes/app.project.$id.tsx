import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  IndexTable,
  Box,
  Divider,
  Button,
  ButtonGroup,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const projectId = params.id;

  const project = await prisma.project.findFirst({
    where: { id: projectId, shop },
    include: {
      visits: true,
    },
  });

  if (!project) {
    throw new Response("Project not found", { status: 404 });
  }

  // Calculate overall stats
  const totalSessions = project.visits.length;
  const realUsers = project.visits.filter((v) => v.visitorType === "REAL");
  const zombies = project.visits.filter((v) => v.visitorType === "ZOMBIE");
  const bots = project.visits.filter((v) => v.visitorType === "BOT");

  const realCount = realUsers.length;
  const zombieCount = zombies.length;
  const botCount = bots.length;

  const addToCartCount = project.visits.filter((v) => v.addedToCart).length;
  const conversionCount = project.visits.filter((v) => v.converted).length;

  // Calculate averages for real users
  const avgTimeOnPage = realUsers.length > 0
    ? Math.round(realUsers.reduce((sum, v) => sum + v.timeOnPage, 0) / realUsers.length / 1000)
    : 0;
  const avgScrollDepth = realUsers.length > 0
    ? Math.round(realUsers.reduce((sum, v) => sum + v.scrollDepth, 0) / realUsers.length)
    : 0;

  // Group by source category
  const sourceCategories = new Map<string, {
    sessions: number;
    real: number;
    zombie: number;
    bot: number;
    avgTime: number;
    avgScroll: number;
    atc: number;
    conversions: number;
  }>();

  project.visits.forEach((visit) => {
    const category = visit.sourceCategory || "Unknown";
    if (!sourceCategories.has(category)) {
      sourceCategories.set(category, {
        sessions: 0,
        real: 0,
        zombie: 0,
        bot: 0,
        avgTime: 0,
        avgScroll: 0,
        atc: 0,
        conversions: 0,
      });
    }

    const stats = sourceCategories.get(category)!;
    stats.sessions++;
    if (visit.visitorType === "REAL") stats.real++;
    else if (visit.visitorType === "ZOMBIE") stats.zombie++;
    else if (visit.visitorType === "BOT") stats.bot++;
    if (visit.addedToCart) stats.atc++;
    if (visit.converted) stats.conversions++;
    stats.avgTime += visit.timeOnPage;
    stats.avgScroll += visit.scrollDepth;
  });

  // Finalize averages
  const sourceStats = Array.from(sourceCategories.entries()).map(([category, stats]) => ({
    category,
    sessions: stats.sessions,
    real: stats.real,
    zombie: stats.zombie,
    bot: stats.bot,
    avgTime: stats.sessions > 0 ? Math.round(stats.avgTime / stats.sessions / 1000) : 0,
    avgScroll: stats.sessions > 0 ? Math.round(stats.avgScroll / stats.sessions) : 0,
    atcRate: stats.real > 0 ? Math.round((stats.atc / stats.real) * 100) : 0,
    convRate: stats.real > 0 ? Math.round((stats.conversions / stats.real) * 100) : 0,
  })).sort((a, b) => b.sessions - a.sessions);

  return json({
    project: {
      id: project.id,
      productTitle: project.productTitle,
      productHandle: project.productHandle,
      status: project.status,
      targetVisitors: project.targetVisitors,
      createdAt: project.createdAt,
    },
    stats: {
      totalSessions,
      realCount,
      zombieCount,
      botCount,
      realPercent: totalSessions > 0 ? Math.round((realCount / totalSessions) * 100) : 0,
      zombiePercent: totalSessions > 0 ? Math.round((zombieCount / totalSessions) * 100) : 0,
      botPercent: totalSessions > 0 ? Math.round((botCount / totalSessions) * 100) : 0,
      addToCartCount,
      conversionCount,
      avgTimeOnPage,
      avgScrollDepth,
    },
    sourceStats,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const projectId = params.id;
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "pause") {
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "PAUSED" },
    });
    return json({ success: true });
  }

  if (actionType === "resume") {
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "ACTIVE" },
    });
    return json({ success: true });
  }

  if (actionType === "delete") {
    await prisma.project.delete({ where: { id: projectId } });
    return json({ success: true, redirect: "/app" });
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function StatCard({ title, value, subtitle, tone }: {
  title: string;
  value: string | number;
  subtitle?: string;
  tone?: "success" | "warning" | "critical";
}) {
  return (
    <Box padding="400" background="bg-surface-secondary" borderRadius="200">
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {title}
        </Text>
        <InlineStack gap="200" align="start" blockAlign="center">
          <Text as="p" variant="headingLg">
            {value}
          </Text>
          {subtitle && (
            <Badge tone={tone}>{subtitle}</Badge>
          )}
        </InlineStack>
      </BlockStack>
    </Box>
  );
}

export default function ProjectDetails() {
  const { project, stats, sourceStats } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return <Badge tone="success">Active</Badge>;
      case "COMPLETED":
        return <Badge tone="info">Completed</Badge>;
      case "PAUSED":
        return <Badge tone="warning">Paused</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const handleAction = (action: string) => {
    const formData = new FormData();
    formData.append("action", action);
    submit(formData, { method: "POST" });
  };

  const rowMarkup = sourceStats.map((source, index) => (
    <IndexTable.Row id={source.category} key={source.category} position={index}>
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="semibold" as="span">
          {source.category}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{source.sessions}</IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" tone="success">{source.real}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" tone="caution">{source.zombie}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" tone="critical">{source.bot}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{formatTime(source.avgTime)}</IndexTable.Cell>
      <IndexTable.Cell>{source.avgScroll}%</IndexTable.Cell>
      <IndexTable.Cell>{source.atcRate}%</IndexTable.Cell>
      <IndexTable.Cell>{source.convRate}%</IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      backAction={{ content: "Dashboard", url: "/app" }}
      title={project.productTitle}
      titleMetadata={getStatusBadge(project.status)}
      subtitle={`${stats.realCount}/${project.targetVisitors} real visitors`}
      primaryAction={
        project.status === "ACTIVE"
          ? { content: "Pause", onAction: () => handleAction("pause"), loading: isLoading }
          : project.status === "PAUSED"
          ? { content: "Resume", onAction: () => handleAction("resume"), loading: isLoading }
          : undefined
      }
      secondaryActions={[
        { content: "Delete", destructive: true, onAction: () => handleAction("delete"), loading: isLoading },
      ]}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Overall Totals
              </Text>
              <InlineStack gap="400" wrap={false}>
                <StatCard title="Sessions" value={stats.totalSessions} />
                <StatCard
                  title="Real Users"
                  value={stats.realCount}
                  subtitle={`${stats.realPercent}%`}
                  tone="success"
                />
                <StatCard
                  title="Zombies"
                  value={stats.zombieCount}
                  subtitle={`${stats.zombiePercent}%`}
                  tone="warning"
                />
                <StatCard
                  title="Bots"
                  value={stats.botCount}
                  subtitle={`${stats.botPercent}%`}
                  tone="critical"
                />
                <StatCard title="Add to Cart" value={stats.addToCartCount} />
                <StatCard title="Conversions" value={stats.conversionCount} />
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <Box padding="400">
              <Text as="h2" variant="headingMd">
                Traffic Quality by Source
              </Text>
            </Box>
            <IndexTable
              resourceName={{ singular: "source", plural: "sources" }}
              itemCount={sourceStats.length}
              headings={[
                { title: "Source" },
                { title: "Sessions" },
                { title: "Real" },
                { title: "Zombie" },
                { title: "Bot" },
                { title: "Avg Time" },
                { title: "Avg Scroll" },
                { title: "ATC %" },
                { title: "Conv %" },
              ]}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
