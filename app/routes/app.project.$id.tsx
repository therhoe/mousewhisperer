import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useSearchParams } from "@remix-run/react";
import { useState, useEffect, useCallback } from "react";
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
  ProgressBar,
  Select,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { generateCSV, generatePDF } from "../utils/export.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const projectId = params.id;
  const url = new URL(request.url);

  // Parse date range from URL params
  const startDateParam = url.searchParams.get("startDate");
  const endDateParam = url.searchParams.get("endDate");

  // Build date filter
  const dateFilter: { startedAt?: { gte?: Date; lte?: Date } } = {};
  if (startDateParam) {
    dateFilter.startedAt = { ...dateFilter.startedAt, gte: new Date(startDateParam) };
  }
  if (endDateParam) {
    // Add 23:59:59 to include the full end day
    const endDate = new Date(endDateParam);
    endDate.setHours(23, 59, 59, 999);
    dateFilter.startedAt = { ...dateFilter.startedAt, lte: endDate };
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, shop },
    include: {
      visits: {
        where: dateFilter.startedAt ? dateFilter : undefined,
        orderBy: { startedAt: "desc" },
      },
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

  // Calculate geo stats (top countries)
  const countryStats = new Map<string, number>();
  project.visits.forEach((visit) => {
    const country = (visit as any).country || "Unknown";
    countryStats.set(country, (countryStats.get(country) || 0) + 1);
  });
  const topCountries = Array.from(countryStats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([country, count]) => ({ country, count }));

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
      atcPercent: totalSessions > 0 ? Math.round((addToCartCount / totalSessions) * 100) : 0,
      convPercent: totalSessions > 0 ? Math.round((conversionCount / totalSessions) * 100) : 0,
    },
    sourceStats,
    topCountries,
    dateFilter: {
      startDate: startDateParam,
      endDate: endDateParam,
    },
    visits: project.visits, // For export
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

  if (actionType === "export-csv" || actionType === "export-pdf") {
    const project = await prisma.project.findFirst({
      where: { id: projectId, shop },
      include: { visits: true },
    });

    if (!project) {
      return json({ error: "Project not found" }, { status: 404 });
    }

    if (actionType === "export-csv") {
      const csv = generateCSV(project.visits, project);
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${project.productHandle}-traffic-report.csv"`,
        },
      });
    }

    if (actionType === "export-pdf") {
      // Calculate stats for PDF
      const totalSessions = project.visits.length;
      const realUsers = project.visits.filter((v) => v.visitorType === "REAL");
      const zombies = project.visits.filter((v) => v.visitorType === "ZOMBIE");
      const bots = project.visits.filter((v) => v.visitorType === "BOT");
      const addToCartCount = project.visits.filter((v) => v.addedToCart).length;
      const conversionCount = project.visits.filter((v) => v.converted).length;

      const stats = {
        totalSessions,
        realCount: realUsers.length,
        zombieCount: zombies.length,
        botCount: bots.length,
        realPercent: totalSessions > 0 ? Math.round((realUsers.length / totalSessions) * 100) : 0,
        zombiePercent: totalSessions > 0 ? Math.round((zombies.length / totalSessions) * 100) : 0,
        botPercent: totalSessions > 0 ? Math.round((bots.length / totalSessions) * 100) : 0,
        addToCartCount,
        conversionCount,
        avgTimeOnPage: realUsers.length > 0
          ? Math.round(realUsers.reduce((sum, v) => sum + v.timeOnPage, 0) / realUsers.length / 1000)
          : 0,
        avgScrollDepth: realUsers.length > 0
          ? Math.round(realUsers.reduce((sum, v) => sum + v.scrollDepth, 0) / realUsers.length)
          : 0,
      };

      // Calculate source stats for PDF
      const sourceCategories = new Map<string, any>();
      project.visits.forEach((visit) => {
        const category = visit.sourceCategory || "Unknown";
        if (!sourceCategories.has(category)) {
          sourceCategories.set(category, { sessions: 0, real: 0, zombie: 0, bot: 0, avgTime: 0, avgScroll: 0, atc: 0, conversions: 0 });
        }
        const s = sourceCategories.get(category)!;
        s.sessions++;
        if (visit.visitorType === "REAL") s.real++;
        else if (visit.visitorType === "ZOMBIE") s.zombie++;
        else if (visit.visitorType === "BOT") s.bot++;
        if (visit.addedToCart) s.atc++;
        if (visit.converted) s.conversions++;
        s.avgTime += visit.timeOnPage;
        s.avgScroll += visit.scrollDepth;
      });

      const sourceStats = Array.from(sourceCategories.entries()).map(([category, s]) => ({
        category,
        sessions: s.sessions,
        real: s.real,
        zombie: s.zombie,
        bot: s.bot,
        avgTime: s.sessions > 0 ? Math.round(s.avgTime / s.sessions / 1000) : 0,
        avgScroll: s.sessions > 0 ? Math.round(s.avgScroll / s.sessions) : 0,
        atcRate: s.real > 0 ? Math.round((s.atc / s.real) * 100) : 0,
        convRate: s.real > 0 ? Math.round((s.conversions / s.real) * 100) : 0,
      })).sort((a, b) => b.sessions - a.sessions);

      const pdf = await generatePDF(project, stats, sourceStats);
      return new Response(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${project.productHandle}-traffic-report.pdf"`,
        },
      });
    }
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

// Conversion Funnel Component
function ConversionFunnel({ stats }: { stats: any }) {
  const stages: Array<{
    label: string;
    value: number;
    percent: number;
    badgeTone?: "success" | "warning" | "critical" | "attention" | "info";
    progressTone?: "success" | "critical" | "highlight" | "primary";
  }> = [
    { label: "All Sessions", value: stats.totalSessions, percent: 100, progressTone: "primary" },
    { label: "Real Users", value: stats.realCount, percent: stats.realPercent, badgeTone: "info", progressTone: "highlight" },
    { label: "Added to Cart", value: stats.addToCartCount, percent: stats.atcPercent || 0, badgeTone: "warning", progressTone: "highlight" },
    { label: "Conversions", value: stats.conversionCount, percent: stats.convPercent || 0, badgeTone: "success", progressTone: "success" },
  ];

  return (
    <BlockStack gap="300">
      {stages.map((stage) => (
        <Box key={stage.label} paddingBlockEnd="200">
          <BlockStack gap="100">
            <InlineStack align="space-between">
              <Text as="span" variant="bodyMd">{stage.label}</Text>
              <InlineStack gap="200">
                <Text as="span" variant="bodyMd" fontWeight="semibold">{stage.value}</Text>
                <Badge tone={stage.badgeTone}>{`${stage.percent}%`}</Badge>
              </InlineStack>
            </InlineStack>
            <ProgressBar progress={stage.percent} size="small" tone={stage.progressTone} />
          </BlockStack>
        </Box>
      ))}
    </BlockStack>
  );
}

// Date filter presets
const DATE_PRESETS = [
  { label: "All Time", value: "all" },
  { label: "Today", value: "today" },
  { label: "Last 7 Days", value: "7days" },
  { label: "Last 30 Days", value: "30days" },
  { label: "Custom", value: "custom" },
];

export default function ProjectDetails() {
  const { project, stats, sourceStats, topCountries, dateFilter } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isLoading = navigation.state !== "idle";

  // Date filter state
  const [datePreset, setDatePreset] = useState(() => {
    if (!dateFilter.startDate && !dateFilter.endDate) return "all";
    return "custom";
  });
  const [startDate, setStartDate] = useState(dateFilter.startDate || "");
  const [endDate, setEndDate] = useState(dateFilter.endDate || "");

  // Real-time stats state
  const [liveStats, setLiveStats] = useState(stats);
  const [isLive, setIsLive] = useState(false);

  // SSE connection for real-time updates
  useEffect(() => {
    if (project.status !== "ACTIVE") return;

    const eventSource = new EventSource(`/api/stats-stream/${project.id}`);

    eventSource.onopen = () => setIsLive(true);

    eventSource.onmessage = (event) => {
      try {
        const newStats = JSON.parse(event.data);
        setLiveStats(newStats);
      } catch (e) {
        console.error("Failed to parse SSE data:", e);
      }
    };

    eventSource.onerror = () => {
      setIsLive(false);
      eventSource.close();
    };

    return () => {
      eventSource.close();
      setIsLive(false);
    };
  }, [project.id, project.status]);

  // Use live stats if available, otherwise use loader stats
  const displayStats = project.status === "ACTIVE" && isLive ? liveStats : stats;

  const handleDatePresetChange = useCallback((value: string) => {
    setDatePreset(value);

    const today = new Date();
    let newStartDate = "";
    let newEndDate = today.toISOString().split("T")[0];

    switch (value) {
      case "all":
        newStartDate = "";
        newEndDate = "";
        break;
      case "today":
        newStartDate = newEndDate;
        break;
      case "7days":
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        newStartDate = weekAgo.toISOString().split("T")[0];
        break;
      case "30days":
        const monthAgo = new Date(today);
        monthAgo.setDate(monthAgo.getDate() - 30);
        newStartDate = monthAgo.toISOString().split("T")[0];
        break;
      case "custom":
        return; // Don't update, let user set custom dates
    }

    setStartDate(newStartDate);
    setEndDate(newEndDate);

    // Update URL params
    const params = new URLSearchParams(searchParams);
    if (newStartDate) {
      params.set("startDate", newStartDate);
    } else {
      params.delete("startDate");
    }
    if (newEndDate && value !== "all") {
      params.set("endDate", newEndDate);
    } else {
      params.delete("endDate");
    }
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const applyCustomDateFilter = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    if (startDate) {
      params.set("startDate", startDate);
    } else {
      params.delete("startDate");
    }
    if (endDate) {
      params.set("endDate", endDate);
    } else {
      params.delete("endDate");
    }
    setSearchParams(params);
  }, [startDate, endDate, searchParams, setSearchParams]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return (
          <InlineStack gap="200">
            <Badge tone="success">Active</Badge>
            {isLive && <Badge tone="info">Live</Badge>}
          </InlineStack>
        );
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
      subtitle={`${displayStats.realCount}/${project.targetVisitors} real visitors`}
      primaryAction={
        project.status === "ACTIVE"
          ? { content: "Pause", onAction: () => handleAction("pause"), loading: isLoading }
          : project.status === "PAUSED"
          ? { content: "Resume", onAction: () => handleAction("resume"), loading: isLoading }
          : undefined
      }
      secondaryActions={[
        { content: "Export CSV", onAction: () => handleAction("export-csv") },
        { content: "Export PDF", onAction: () => handleAction("export-pdf") },
        { content: "Delete", destructive: true, onAction: () => handleAction("delete"), loading: isLoading },
      ]}
    >
      <Layout>
        {/* Date Filter Section */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Date Range</Text>
              <InlineStack gap="300" align="start" blockAlign="end">
                <Select
                  label="Quick Select"
                  options={DATE_PRESETS}
                  value={datePreset}
                  onChange={handleDatePresetChange}
                />
                {datePreset === "custom" && (
                  <>
                    <TextField
                      label="Start Date"
                      type="date"
                      value={startDate}
                      onChange={setStartDate}
                      autoComplete="off"
                    />
                    <TextField
                      label="End Date"
                      type="date"
                      value={endDate}
                      onChange={setEndDate}
                      autoComplete="off"
                    />
                    <div style={{ paddingTop: "24px" }}>
                      <Button onClick={applyCustomDateFilter}>Apply</Button>
                    </div>
                  </>
                )}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Stats Overview */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Overall Totals
              </Text>
              <InlineStack gap="400" wrap>
                <StatCard title="Sessions" value={displayStats.totalSessions} />
                <StatCard
                  title="Real Users"
                  value={displayStats.realCount}
                  subtitle={`${displayStats.realPercent}%`}
                  tone="success"
                />
                <StatCard
                  title="Zombies"
                  value={displayStats.zombieCount}
                  subtitle={`${displayStats.zombiePercent}%`}
                  tone="warning"
                />
                <StatCard
                  title="Bots"
                  value={displayStats.botCount}
                  subtitle={`${displayStats.botPercent}%`}
                  tone="critical"
                />
                <StatCard title="Add to Cart" value={displayStats.addToCartCount} />
                <StatCard title="Conversions" value={displayStats.conversionCount} />
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Conversion Funnel */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Conversion Funnel</Text>
              <ConversionFunnel stats={displayStats} />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Top Countries */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Top Countries</Text>
              {topCountries.length === 0 ? (
                <Text as="p" tone="subdued">No geo data available yet</Text>
              ) : (
                <BlockStack gap="200">
                  {topCountries.map((item) => (
                    <InlineStack key={item.country} align="space-between">
                      <Text as="span">{item.country}</Text>
                      <Badge>{String(item.count)}</Badge>
                    </InlineStack>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Traffic by Source Table */}
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
