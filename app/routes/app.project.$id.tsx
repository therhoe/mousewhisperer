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
  Modal,
  FormLayout,
  Banner,
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

  // Get snapshot ID from URL or use active/latest
  const snapshotIdParam = url.searchParams.get("snapshot");
  const compareMode = url.searchParams.get("compare") === "true";
  const compareIdsParam = url.searchParams.get("compareIds");

  // Parse date range from URL params
  const startDateParam = url.searchParams.get("startDate");
  const endDateParam = url.searchParams.get("endDate");

  // Build date filter
  const dateFilter: { startedAt?: { gte?: Date; lte?: Date } } = {};
  if (startDateParam) {
    dateFilter.startedAt = { ...dateFilter.startedAt, gte: new Date(startDateParam) };
  }
  if (endDateParam) {
    const endDate = new Date(endDateParam);
    endDate.setHours(23, 59, 59, 999);
    dateFilter.startedAt = { ...dateFilter.startedAt, lte: endDate };
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, shop },
    include: {
      snapshots: {
        orderBy: { number: "desc" },
        include: {
          visits: {
            where: dateFilter.startedAt ? dateFilter : undefined,
            orderBy: { startedAt: "desc" },
          },
          _count: {
            select: { visits: { where: { visitorType: "REAL" } } },
          },
        },
      },
    },
  });

  if (!project) {
    throw new Response("Project not found", { status: 404 });
  }

  // Find active or specified snapshot
  let selectedSnapshot = snapshotIdParam
    ? project.snapshots.find((s) => s.id === snapshotIdParam)
    : project.snapshots.find((s) => s.status === "ACTIVE") || project.snapshots[0];

  if (!selectedSnapshot && project.snapshots.length > 0) {
    selectedSnapshot = project.snapshots[0];
  }

  // Calculate stats for a snapshot
  const calculateSnapshotStats = (snapshot: typeof project.snapshots[0]) => {
    const visits = snapshot.visits;
    const totalSessions = visits.length;
    const realUsers = visits.filter((v) => v.visitorType === "REAL");
    const zombies = visits.filter((v) => v.visitorType === "ZOMBIE");
    const bots = visits.filter((v) => v.visitorType === "BOT");

    const realCount = realUsers.length;
    const zombieCount = zombies.length;
    const botCount = bots.length;

    const addToCartCount = visits.filter((v) => v.addedToCart).length;
    const conversionCount = visits.filter((v) => v.converted).length;

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

    visits.forEach((visit) => {
      const category = visit.sourceCategory || "Unknown";
      if (!sourceCategories.has(category)) {
        sourceCategories.set(category, {
          sessions: 0, real: 0, zombie: 0, bot: 0, avgTime: 0, avgScroll: 0, atc: 0, conversions: 0,
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

    // Calculate geo stats
    const countryStats = new Map<string, number>();
    const cityStats = new Map<string, number>();
    visits.forEach((visit) => {
      const country = visit.country || "Unknown";
      countryStats.set(country, (countryStats.get(country) || 0) + 1);

      if (visit.city) {
        const cityKey = `${visit.city}, ${visit.region || visit.country || ""}`;
        cityStats.set(cityKey, (cityStats.get(cityKey) || 0) + 1);
      }
    });
    const topCountries = Array.from(countryStats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([country, count]) => ({ country, count }));
    const topCities = Array.from(cityStats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([city, count]) => ({ city, count }));

    // Calculate device stats
    const deviceStats = new Map<string, number>();
    visits.forEach((visit) => {
      const device = visit.deviceType || "Unknown";
      deviceStats.set(device, (deviceStats.get(device) || 0) + 1);
    });
    const deviceBreakdown = Array.from(deviceStats.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([device, count]) => ({ device, count, percent: Math.round((count / totalSessions) * 100) }));

    // Prepare recent visits for detail table (last 50)
    const recentVisits = visits.slice(0, 50).map((v) => ({
      id: v.id,
      sessionId: v.sessionId,
      visitorType: v.visitorType,
      source: v.source,
      medium: v.medium,
      campaign: v.campaign,
      sourceCategory: v.sourceCategory,
      timeOnPage: v.timeOnPage,
      scrollDepth: v.scrollDepth,
      mouseMovements: v.mouseMovements,
      keyPresses: v.keyPresses,
      touchEvents: v.touchEvents,
      country: v.country,
      city: v.city,
      region: v.region,
      deviceType: v.deviceType,
      botScore: v.botScore,
      addedToCart: v.addedToCart,
      converted: v.converted,
      startedAt: v.startedAt,
      endedAt: v.endedAt,
      exitType: v.exitType,
    }));

    // Calculate exit path stats
    const exitPathStats = new Map<string, number>();
    visits.forEach((visit) => {
      const exitType = visit.exitType || "unknown";
      exitPathStats.set(exitType, (exitPathStats.get(exitType) || 0) + 1);
    });
    const exitPaths = Array.from(exitPathStats.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({
        type,
        count,
        percent: totalSessions > 0 ? Math.round((count / totalSessions) * 100) : 0,
        label: formatExitType(type),
      }));

    return {
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
      sourceStats,
      topCountries,
      topCities,
      deviceBreakdown,
      recentVisits,
      exitPaths,
    };
  };

  // Calculate stats for selected snapshot
  const stats = selectedSnapshot ? calculateSnapshotStats(selectedSnapshot) : null;

  // Calculate comparison data if in compare mode
  let comparisonData: Array<{
    id: string;
    name: string;
    number: number;
    stats: ReturnType<typeof calculateSnapshotStats>;
  }> = [];

  if (compareMode && compareIdsParam) {
    const compareIds = compareIdsParam.split(",");
    comparisonData = project.snapshots
      .filter((s) => compareIds.includes(s.id))
      .map((s) => ({
        id: s.id,
        name: s.name || `Snapshot ${s.number}`,
        number: s.number,
        stats: calculateSnapshotStats(s),
      }));
  }

  return json({
    project: {
      id: project.id,
      productTitle: project.productTitle,
      productHandle: project.productHandle,
      createdAt: project.createdAt,
    },
    snapshots: project.snapshots.map((s) => ({
      id: s.id,
      number: s.number,
      name: s.name,
      status: s.status,
      targetVisitors: s.targetVisitors,
      realCount: s._count.visits,
      createdAt: s.createdAt,
      completedAt: s.completedAt,
    })),
    selectedSnapshot: selectedSnapshot ? {
      id: selectedSnapshot.id,
      number: selectedSnapshot.number,
      name: selectedSnapshot.name,
      status: selectedSnapshot.status,
      targetVisitors: selectedSnapshot.targetVisitors,
      realCount: selectedSnapshot._count.visits,
      createdAt: selectedSnapshot.createdAt,
      completedAt: selectedSnapshot.completedAt,
    } : null,
    stats,
    comparisonData,
    compareMode,
    dateFilter: {
      startDate: startDateParam,
      endDate: endDateParam,
    },
    visits: selectedSnapshot?.visits || [],
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const projectId = params.id;
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "pause-snapshot") {
    const snapshotId = formData.get("snapshotId") as string;
    await prisma.snapshot.update({
      where: { id: snapshotId },
      data: { status: "PAUSED" },
    });
    return json({ success: true });
  }

  if (actionType === "resume-snapshot") {
    const snapshotId = formData.get("snapshotId") as string;
    // Check if there's already an active snapshot
    const activeSnapshot = await prisma.snapshot.findFirst({
      where: { projectId, status: "ACTIVE" },
    });
    if (activeSnapshot) {
      return json({ error: "Another snapshot is already active" }, { status: 400 });
    }
    await prisma.snapshot.update({
      where: { id: snapshotId },
      data: { status: "ACTIVE" },
    });
    return json({ success: true });
  }

  if (actionType === "create-snapshot") {
    const snapshotName = formData.get("snapshotName") as string | null;
    const targetVisitors = parseInt(formData.get("targetVisitors") as string) || 1000;

    // Check if there's already an active snapshot
    const activeSnapshot = await prisma.snapshot.findFirst({
      where: { projectId, status: "ACTIVE" },
    });
    if (activeSnapshot) {
      return json({ error: "Another snapshot is already active. Pause or complete it first." }, { status: 400 });
    }

    // Get next snapshot number
    const lastSnapshot = await prisma.snapshot.findFirst({
      where: { projectId },
      orderBy: { number: "desc" },
    });

    await prisma.snapshot.create({
      data: {
        projectId: projectId!,
        number: (lastSnapshot?.number || 0) + 1,
        name: snapshotName || null,
        targetVisitors,
        status: "ACTIVE",
      },
    });

    return json({ success: true });
  }

  if (actionType === "edit-snapshot") {
    const snapshotId = formData.get("snapshotId") as string;
    const snapshotName = formData.get("snapshotName") as string | null;
    const targetVisitors = parseInt(formData.get("targetVisitors") as string);

    // Get current snapshot to validate
    const snapshot = await prisma.snapshot.findUnique({
      where: { id: snapshotId },
      include: { _count: { select: { visits: { where: { visitorType: "REAL" } } } } },
    });

    if (!snapshot) {
      return json({ error: "Snapshot not found" }, { status: 404 });
    }

    // Can't lower target below current real count
    if (targetVisitors < snapshot._count.visits) {
      return json({ error: `Target cannot be lower than current real users (${snapshot._count.visits})` }, { status: 400 });
    }

    // Check if we should complete the snapshot
    const shouldComplete = targetVisitors <= snapshot._count.visits;

    await prisma.snapshot.update({
      where: { id: snapshotId },
      data: {
        name: snapshotName || null,
        targetVisitors,
        ...(shouldComplete && { status: "COMPLETED", completedAt: new Date() }),
      },
    });

    return json({ success: true });
  }

  if (actionType === "delete-snapshot") {
    const snapshotId = formData.get("snapshotId") as string;
    await prisma.snapshot.delete({ where: { id: snapshotId } });
    return json({ success: true });
  }

  if (actionType === "delete-project") {
    await prisma.project.delete({ where: { id: projectId } });
    return json({ success: true, redirect: "/app" });
  }

  if (actionType === "export-csv" || actionType === "export-pdf") {
    const snapshotId = formData.get("snapshotId") as string;
    const snapshot = await prisma.snapshot.findUnique({
      where: { id: snapshotId },
      include: {
        visits: true,
        project: true,
      },
    });

    if (!snapshot) {
      return json({ error: "Snapshot not found" }, { status: 404 });
    }

    const snapshotInfo = {
      name: snapshot.name || `Snapshot ${snapshot.number}`,
      number: snapshot.number,
      targetVisitors: snapshot.targetVisitors,
    };

    if (actionType === "export-csv") {
      const csv = generateCSV(snapshot.visits, snapshot.project, snapshotInfo);
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${snapshot.project.productHandle}-snapshot-${snapshot.number}-report.csv"`,
        },
      });
    }

    if (actionType === "export-pdf") {
      const visits = snapshot.visits;
      const totalSessions = visits.length;
      const realUsers = visits.filter((v) => v.visitorType === "REAL");
      const zombies = visits.filter((v) => v.visitorType === "ZOMBIE");
      const bots = visits.filter((v) => v.visitorType === "BOT");
      const addToCartCount = visits.filter((v) => v.addedToCart).length;
      const conversionCount = visits.filter((v) => v.converted).length;

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

      const sourceCategories = new Map<string, any>();
      visits.forEach((visit) => {
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

      const pdf = await generatePDF(snapshot.project, stats, sourceStats, snapshotInfo);
      return new Response(Buffer.from(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${snapshot.project.productHandle}-snapshot-${snapshot.number}-report.pdf"`,
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

function formatExitType(type: string): string {
  const labels: Record<string, string> = {
    window_closed: "Closed Window/Tab",
    back_button: "Back Button",
    idle: "Idle (2+ min)",
    internal_link: "Internal Link",
    external_link: "External Link",
    checkout: "Checkout/Cart",
    unknown: "Unknown",
  };
  return labels[type] || type;
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

const DATE_PRESETS = [
  { label: "All Time", value: "all" },
  { label: "Today", value: "today" },
  { label: "Last 7 Days", value: "7days" },
  { label: "Last 30 Days", value: "30days" },
  { label: "Custom", value: "custom" },
];

export default function ProjectDetails() {
  const { project, snapshots, selectedSnapshot, stats, comparisonData, compareMode, dateFilter } = useLoaderData<typeof loader>();
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

  // Modal states
  const [isNewSnapshotModalOpen, setIsNewSnapshotModalOpen] = useState(false);
  const [isEditSnapshotModalOpen, setIsEditSnapshotModalOpen] = useState(false);
  const [snapshotName, setSnapshotName] = useState("");
  const [targetVisitors, setTargetVisitors] = useState("1000");

  // Compare mode state
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);

  // Real-time stats state
  const [liveStats, setLiveStats] = useState(stats);
  const [isLive, setIsLive] = useState(false);

  // SSE connection for real-time updates
  useEffect(() => {
    if (!selectedSnapshot || selectedSnapshot.status !== "ACTIVE") return;

    const eventSource = new EventSource(`/api/stats-stream/${selectedSnapshot.id}`);

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
  }, [selectedSnapshot?.id, selectedSnapshot?.status]);

  const displayStats = selectedSnapshot?.status === "ACTIVE" && isLive ? liveStats : stats;

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
        return;
    }

    setStartDate(newStartDate);
    setEndDate(newEndDate);

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

  const handleSnapshotSelect = useCallback((snapshotId: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("snapshot", snapshotId);
    params.delete("compare");
    params.delete("compareIds");
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const handleToggleCompare = useCallback((snapshotId: string) => {
    setSelectedForCompare((prev) => {
      if (prev.includes(snapshotId)) {
        return prev.filter((id) => id !== snapshotId);
      }
      return [...prev, snapshotId];
    });
  }, []);

  const enterCompareMode = useCallback(() => {
    if (selectedForCompare.length < 2) return;
    const params = new URLSearchParams(searchParams);
    params.set("compare", "true");
    params.set("compareIds", selectedForCompare.join(","));
    setSearchParams(params);
  }, [selectedForCompare, searchParams, setSearchParams]);

  const exitCompareMode = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.delete("compare");
    params.delete("compareIds");
    setSearchParams(params);
    setSelectedForCompare([]);
  }, [searchParams, setSearchParams]);

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

  const handleAction = (action: string, extra?: Record<string, string>) => {
    const formData = new FormData();
    formData.append("action", action);
    if (selectedSnapshot) {
      formData.append("snapshotId", selectedSnapshot.id);
    }
    if (extra) {
      Object.entries(extra).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }
    submit(formData, { method: "POST" });
  };

  const handleExport = useCallback(async (format: "csv" | "pdf") => {
    if (!selectedSnapshot) return;

    try {
      const response = await fetch(`/api/export/${selectedSnapshot.id}?format=${format}`);
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Export failed:", errorText);
        return;
      }

      // Get the blob and create download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report-snapshot-${selectedSnapshot.number}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export error:", error);
    }
  }, [selectedSnapshot]);

  const handleCreateSnapshot = useCallback(() => {
    const formData = new FormData();
    formData.append("action", "create-snapshot");
    formData.append("snapshotName", snapshotName);
    formData.append("targetVisitors", targetVisitors);
    submit(formData, { method: "POST" });
    setIsNewSnapshotModalOpen(false);
    setSnapshotName("");
    setTargetVisitors("1000");
  }, [snapshotName, targetVisitors, submit]);

  const handleEditSnapshot = useCallback(() => {
    if (!selectedSnapshot) return;
    const formData = new FormData();
    formData.append("action", "edit-snapshot");
    formData.append("snapshotId", selectedSnapshot.id);
    formData.append("snapshotName", snapshotName);
    formData.append("targetVisitors", targetVisitors);
    submit(formData, { method: "POST" });
    setIsEditSnapshotModalOpen(false);
  }, [selectedSnapshot, snapshotName, targetVisitors, submit]);

  const openEditModal = useCallback(() => {
    if (!selectedSnapshot) return;
    setSnapshotName(selectedSnapshot.name || "");
    setTargetVisitors(String(selectedSnapshot.targetVisitors));
    setIsEditSnapshotModalOpen(true);
  }, [selectedSnapshot]);

  const openNewSnapshotModal = useCallback(() => {
    const lastTarget = snapshots[0]?.targetVisitors || 1000;
    setSnapshotName("");
    setTargetVisitors(String(lastTarget));
    setIsNewSnapshotModalOpen(true);
  }, [snapshots]);

  const hasActiveSnapshot = snapshots.some((s) => s.status === "ACTIVE");

  const sourceStats = displayStats?.sourceStats || [];
  const topCountries = displayStats?.topCountries || [];

  const rowMarkup = sourceStats.map((source: any, index: number) => (
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

  // No snapshots view
  if (snapshots.length === 0) {
    return (
      <Page
        backAction={{ content: "Dashboard", url: "/app" }}
        title={project.productTitle}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" align="center">
                <Text as="h2" variant="headingMd">No Snapshots Yet</Text>
                <Text as="p" tone="subdued">Create a snapshot to start tracking visitors for this product.</Text>
                <Button variant="primary" onClick={openNewSnapshotModal}>Create Snapshot</Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Modal
          open={isNewSnapshotModalOpen}
          onClose={() => setIsNewSnapshotModalOpen(false)}
          title="Create New Snapshot"
          primaryAction={{
            content: "Create",
            onAction: handleCreateSnapshot,
            loading: isLoading,
          }}
          secondaryActions={[{ content: "Cancel", onAction: () => setIsNewSnapshotModalOpen(false) }]}
        >
          <Modal.Section>
            <FormLayout>
              <TextField
                label="Snapshot Name"
                value={snapshotName}
                onChange={setSnapshotName}
                placeholder="e.g., Baseline, After Redesign"
                helpText="Optional label for this measurement period"
                autoComplete="off"
              />
              <TextField
                label="Target Visitors"
                type="number"
                value={targetVisitors}
                onChange={setTargetVisitors}
                min={100}
                helpText="Number of real visitors to collect before completing"
                autoComplete="off"
              />
            </FormLayout>
          </Modal.Section>
        </Modal>
      </Page>
    );
  }

  // Compare mode view
  if (compareMode && comparisonData.length >= 2) {
    return (
      <Page
        backAction={{ content: "Dashboard", url: "/app" }}
        title={project.productTitle}
        subtitle="Snapshot Comparison"
        primaryAction={{ content: "Exit Compare", onAction: exitCompareMode }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Comparison</Text>
                <IndexTable
                  resourceName={{ singular: "metric", plural: "metrics" }}
                  itemCount={8}
                  headings={[
                    { title: "Metric" },
                    ...comparisonData.map((s) => ({ title: s.name })),
                  ]}
                  selectable={false}
                >
                  <IndexTable.Row id="real" position={0}>
                    <IndexTable.Cell><Text fontWeight="semibold" as="span">Real Users</Text></IndexTable.Cell>
                    {comparisonData.map((s) => (
                      <IndexTable.Cell key={s.id}><Text as="span" tone="success">{s.stats.realCount}</Text></IndexTable.Cell>
                    ))}
                  </IndexTable.Row>
                  <IndexTable.Row id="zombie" position={1}>
                    <IndexTable.Cell><Text fontWeight="semibold" as="span">Zombies</Text></IndexTable.Cell>
                    {comparisonData.map((s) => (
                      <IndexTable.Cell key={s.id}><Text as="span" tone="caution">{s.stats.zombieCount}</Text></IndexTable.Cell>
                    ))}
                  </IndexTable.Row>
                  <IndexTable.Row id="bot" position={2}>
                    <IndexTable.Cell><Text fontWeight="semibold" as="span">Bots</Text></IndexTable.Cell>
                    {comparisonData.map((s) => (
                      <IndexTable.Cell key={s.id}><Text as="span" tone="critical">{s.stats.botCount}</Text></IndexTable.Cell>
                    ))}
                  </IndexTable.Row>
                  <IndexTable.Row id="real-pct" position={3}>
                    <IndexTable.Cell><Text fontWeight="semibold" as="span">Real %</Text></IndexTable.Cell>
                    {comparisonData.map((s) => (
                      <IndexTable.Cell key={s.id}>{s.stats.realPercent}%</IndexTable.Cell>
                    ))}
                  </IndexTable.Row>
                  <IndexTable.Row id="atc" position={4}>
                    <IndexTable.Cell><Text fontWeight="semibold" as="span">Add to Cart</Text></IndexTable.Cell>
                    {comparisonData.map((s) => (
                      <IndexTable.Cell key={s.id}>{s.stats.addToCartCount}</IndexTable.Cell>
                    ))}
                  </IndexTable.Row>
                  <IndexTable.Row id="conv" position={5}>
                    <IndexTable.Cell><Text fontWeight="semibold" as="span">Conversions</Text></IndexTable.Cell>
                    {comparisonData.map((s) => (
                      <IndexTable.Cell key={s.id}>{s.stats.conversionCount}</IndexTable.Cell>
                    ))}
                  </IndexTable.Row>
                  <IndexTable.Row id="time" position={6}>
                    <IndexTable.Cell><Text fontWeight="semibold" as="span">Avg Time</Text></IndexTable.Cell>
                    {comparisonData.map((s) => (
                      <IndexTable.Cell key={s.id}>{formatTime(s.stats.avgTimeOnPage)}</IndexTable.Cell>
                    ))}
                  </IndexTable.Row>
                  <IndexTable.Row id="scroll" position={7}>
                    <IndexTable.Cell><Text fontWeight="semibold" as="span">Avg Scroll</Text></IndexTable.Cell>
                    {comparisonData.map((s) => (
                      <IndexTable.Cell key={s.id}>{s.stats.avgScrollDepth}%</IndexTable.Cell>
                    ))}
                  </IndexTable.Row>
                </IndexTable>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      backAction={{ content: "Dashboard", url: "/app" }}
      title={project.productTitle}
      titleMetadata={selectedSnapshot && getStatusBadge(selectedSnapshot.status)}
      subtitle={selectedSnapshot ? `${selectedSnapshot.realCount}/${selectedSnapshot.targetVisitors} real visitors` : ""}
      primaryAction={
        selectedSnapshot?.status === "ACTIVE"
          ? { content: "Pause", onAction: () => handleAction("pause-snapshot"), loading: isLoading }
          : selectedSnapshot?.status === "PAUSED" && !hasActiveSnapshot
          ? { content: "Resume", onAction: () => handleAction("resume-snapshot"), loading: isLoading }
          : undefined
      }
      secondaryActions={selectedSnapshot ? [
        { content: "Edit", onAction: openEditModal },
        { content: "Export CSV", onAction: () => handleExport("csv") },
        { content: "Export PDF", onAction: () => handleExport("pdf") },
        { content: "Delete Snapshot", destructive: true, onAction: () => handleAction("delete-snapshot"), loading: isLoading },
      ] : []}
    >
      <Layout>
        {/* Snapshot Selector */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Snapshots</Text>
                <InlineStack gap="200">
                  {selectedForCompare.length >= 2 && (
                    <Button onClick={enterCompareMode}>{`Compare Selected (${selectedForCompare.length})`}</Button>
                  )}
                  <Button variant="primary" onClick={openNewSnapshotModal} disabled={hasActiveSnapshot}>
                    + New Snapshot
                  </Button>
                </InlineStack>
              </InlineStack>
              {hasActiveSnapshot && snapshots.length > 0 && snapshots[0].status !== "ACTIVE" && (
                <Banner tone="warning">
                  Another snapshot is currently active. Complete or pause it to create a new one.
                </Banner>
              )}
              <InlineStack gap="200" wrap>
                {snapshots.map((snapshot) => (
                  <InlineStack key={snapshot.id} gap="100">
                    <Button
                      pressed={selectedSnapshot?.id === snapshot.id}
                      onClick={() => handleSnapshotSelect(snapshot.id)}
                    >
                      {snapshot.name || `Snapshot ${snapshot.number}`}
                    </Button>
                    {snapshot.status === "ACTIVE" && <Badge tone="success">Active</Badge>}
                    {snapshot.status === "COMPLETED" && <Badge tone="info">Done</Badge>}
                    {snapshot.status === "PAUSED" && <Badge tone="warning">Paused</Badge>}
                  </InlineStack>
                ))}
              </InlineStack>
              <InlineStack gap="200">
                <Text as="span" variant="bodySm" tone="subdued">Select multiple for comparison:</Text>
                {snapshots.map((snapshot) => (
                  <Button
                    key={`compare-${snapshot.id}`}
                    size="slim"
                    pressed={selectedForCompare.includes(snapshot.id)}
                    onClick={() => handleToggleCompare(snapshot.id)}
                  >
                    {snapshot.name || `#${snapshot.number}`}
                  </Button>
                ))}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {selectedSnapshot && displayStats && (
          <>
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
                  <Text as="h2" variant="headingMd">Overall Totals</Text>
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
                      {topCountries.map((item: any) => (
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

            {/* Top Cities */}
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Top Cities</Text>
                  {(displayStats?.topCities || []).length === 0 ? (
                    <Text as="p" tone="subdued">No city data available yet</Text>
                  ) : (
                    <BlockStack gap="200">
                      {(displayStats?.topCities || []).map((item: any) => (
                        <InlineStack key={item.city} align="space-between">
                          <Text as="span">{item.city}</Text>
                          <Badge>{String(item.count)}</Badge>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Device Breakdown */}
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Devices</Text>
                  {(displayStats?.deviceBreakdown || []).length === 0 ? (
                    <Text as="p" tone="subdued">No device data available yet</Text>
                  ) : (
                    <BlockStack gap="200">
                      {(displayStats?.deviceBreakdown || []).map((item: any) => (
                        <InlineStack key={item.device} align="space-between">
                          <Text as="span">{item.device}</Text>
                          <Badge>{`${item.percent}%`}</Badge>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Exit Paths */}
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Exit Paths</Text>
                  {(displayStats?.exitPaths || []).length === 0 ? (
                    <Text as="p" tone="subdued">No exit data available yet</Text>
                  ) : (
                    <BlockStack gap="200">
                      {(displayStats?.exitPaths || []).map((item: any) => (
                        <InlineStack key={item.type} align="space-between">
                          <Text as="span">{item.label}</Text>
                          <InlineStack gap="100">
                            <Text as="span" tone="subdued">{item.count}</Text>
                            <Badge tone={item.type === "checkout" ? "success" : undefined}>
                              {`${item.percent}%`}
                            </Badge>
                          </InlineStack>
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
                  <Text as="h2" variant="headingMd">Traffic Quality by Source</Text>
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

            {/* Detailed Visits Table */}
            <Layout.Section>
              <Card padding="0">
                <Box padding="400">
                  <Text as="h2" variant="headingMd">Recent Visits (Last 50)</Text>
                </Box>
                <div style={{ overflowX: "auto" }}>
                  <IndexTable
                    resourceName={{ singular: "visit", plural: "visits" }}
                    itemCount={(displayStats?.recentVisits || []).length}
                    headings={[
                      { title: "Time" },
                      { title: "Type" },
                      { title: "Source" },
                      { title: "Location" },
                      { title: "Device" },
                      { title: "Duration" },
                      { title: "Scroll" },
                      { title: "Mouse" },
                      { title: "Bot Score" },
                      { title: "Exit" },
                      { title: "ATC" },
                    ]}
                    selectable={false}
                  >
                    {(displayStats?.recentVisits || []).map((visit: any, index: number) => (
                      <IndexTable.Row id={visit.id} key={visit.id} position={index}>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm">
                            {visit.startedAt ? new Date(visit.startedAt).toLocaleString() : "-"}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Badge
                            tone={visit.visitorType === "REAL" ? "success" : visit.visitorType === "ZOMBIE" ? "warning" : "critical"}
                          >
                            {visit.visitorType}
                          </Badge>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="050">
                            <Text as="span" variant="bodySm" fontWeight="semibold">{visit.sourceCategory || "Direct"}</Text>
                            {visit.source && (
                              <Text as="span" variant="bodySm" tone="subdued">
                                {visit.source}{visit.medium ? ` / ${visit.medium}` : ""}
                              </Text>
                            )}
                            {visit.campaign && (
                              <Text as="span" variant="bodySm" tone="subdued">
                                Campaign: {visit.campaign}
                              </Text>
                            )}
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="050">
                            <Text as="span" variant="bodySm">{visit.country || "-"}</Text>
                            {visit.city && (
                              <Text as="span" variant="bodySm" tone="subdued">
                                {visit.city}{visit.region ? `, ${visit.region}` : ""}
                              </Text>
                            )}
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm">{visit.deviceType || "-"}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm">{formatTime(Math.round(visit.timeOnPage / 1000))}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm">{visit.scrollDepth}%</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm">{visit.mouseMovements || 0}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm">{visit.botScore || 0}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm">{formatExitType(visit.exitType || "unknown")}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          {visit.addedToCart ? <Badge tone="success">Yes</Badge> : <Text as="span" tone="subdued">-</Text>}
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                </div>
              </Card>
            </Layout.Section>
          </>
        )}

        {/* Delete Project */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Danger Zone</Text>
              <Text as="p" tone="subdued">Deleting this project will remove all snapshots and visit data.</Text>
              <Button tone="critical" onClick={() => handleAction("delete-project")}>Delete Project</Button>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* New Snapshot Modal */}
      <Modal
        open={isNewSnapshotModalOpen}
        onClose={() => setIsNewSnapshotModalOpen(false)}
        title="Create New Snapshot"
        primaryAction={{
          content: "Create",
          onAction: handleCreateSnapshot,
          loading: isLoading,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setIsNewSnapshotModalOpen(false) }]}
      >
        <Modal.Section>
          <Banner tone="info">This snapshot will start fresh from 0 visitors.</Banner>
          <br />
          <FormLayout>
            <TextField
              label="Snapshot Name"
              value={snapshotName}
              onChange={setSnapshotName}
              placeholder="e.g., After Redesign"
              helpText="Optional label for this measurement period"
              autoComplete="off"
            />
            <TextField
              label="Target Visitors"
              type="number"
              value={targetVisitors}
              onChange={setTargetVisitors}
              min={100}
              helpText="Number of real visitors to collect before completing"
              autoComplete="off"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>

      {/* Edit Snapshot Modal */}
      <Modal
        open={isEditSnapshotModalOpen}
        onClose={() => setIsEditSnapshotModalOpen(false)}
        title="Edit Snapshot"
        primaryAction={{
          content: "Save",
          onAction: handleEditSnapshot,
          loading: isLoading,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setIsEditSnapshotModalOpen(false) }]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Snapshot Name"
              value={snapshotName}
              onChange={setSnapshotName}
              placeholder="e.g., After Redesign"
              autoComplete="off"
            />
            <TextField
              label="Target Visitors"
              type="number"
              value={targetVisitors}
              onChange={setTargetVisitors}
              min={selectedSnapshot?.realCount || 100}
              helpText={`Cannot be lower than current real users (${selectedSnapshot?.realCount || 0})`}
              autoComplete="off"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
