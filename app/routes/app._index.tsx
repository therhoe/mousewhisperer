import { useCallback, useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, Link, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  Button,
  BlockStack,
  InlineStack,
  Modal,
  TextField,
  FormLayout,
  Banner,
  Box,
  Icon,
  Divider,
  ChoiceList,
  Popover,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  MinusCircleIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "../utils/notifications.server";

const APP_CLIENT_ID = "be249e7dc1288f980804d0bf5e40cde0";
const THEME_BLOCK_HANDLE = "tracker";

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
  const shop = session.shop;

  // Get or create shop settings
  let shopSettings = await prisma.shopSettings.findUnique({
    where: { shop },
  });

  if (!shopSettings) {
    shopSettings = await prisma.shopSettings.create({
      data: { shop },
    });
  }

  // Fetch profile first so we can conditionally query answers
  const profile = await prisma.insightProfile.findUnique({
    where: { shop },
    include: {
      _count: { select: { answers: true, insights: true } },
    },
  });

  const [projects, activeCount, completedCount, _topAnswers, _trendingInsights, notifications, unreadCount] =
    await Promise.all([
      // Project query — snapshot metadata only (no visits)
      prisma.project.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        include: {
          snapshots: {
            orderBy: { number: "desc" },
            select: {
              id: true,
              number: true,
              name: true,
              status: true,
              targetVisitors: true,
            },
          },
        },
      }),
      // Active snapshot count across this shop's projects
      prisma.snapshot.count({
        where: { project: { shop }, status: "ACTIVE" },
      }),
      // Completed snapshot count across this shop's projects
      prisma.snapshot.count({
        where: { project: { shop }, status: "COMPLETED" },
      }),
      // User's top 4 answers by upvotes (only if profile exists)
      profile
        ? prisma.insightAnswer.findMany({
            where: { profileId: profile.id },
            orderBy: { upvoteCount: "desc" },
            take: 4,
            include: {
              insight: { select: { id: true, title: true } },
            },
          })
        : Promise.resolve([]),
      // Community-wide trending insights (last 7 days)
      prisma.insight.findMany({
        where: {
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        orderBy: [{ meTooCount: "desc" }, { createdAt: "desc" }],
        take: 4,
        include: {
          profile: {
            select: { displayName: true, avatarEmoji: true },
          },
        },
      }),
      // Notifications
      getNotifications(shop, { take: 10 }),
      getUnreadCount(shop),
    ]);

  // Determine display snapshot per project
  const projectSnapshots = projects.map((project) => {
    const activeSnapshot = project.snapshots.find((s) => s.status === "ACTIVE");
    const displaySnapshot = activeSnapshot || project.snapshots[0];
    return { project, displaySnapshot };
  });

  const snapshotIds = projectSnapshots
    .map((p) => p.displaySnapshot?.id)
    .filter(Boolean) as string[];

  // Batch aggregate queries for all display snapshots
  const [visitorCounts, atcCounts, convCounts, revenueSums, productClickCounts] =
    snapshotIds.length > 0
      ? await Promise.all([
          prisma.visit.groupBy({
            by: ["snapshotId", "visitorType"],
            where: { snapshotId: { in: snapshotIds } },
            _count: true,
          }),
          prisma.visit.groupBy({
            by: ["snapshotId"],
            where: { snapshotId: { in: snapshotIds }, addedToCart: true },
            _count: true,
          }),
          prisma.visit.groupBy({
            by: ["snapshotId"],
            where: { snapshotId: { in: snapshotIds }, converted: true },
            _count: true,
          }),
          prisma.visit.groupBy({
            by: ["snapshotId"],
            where: { snapshotId: { in: snapshotIds }, converted: true, orderValue: { not: null } },
            _sum: { orderValue: true },
          }),
          prisma.visit.groupBy({
            by: ["snapshotId"],
            where: {
              snapshotId: {
                in: projectSnapshots
                  .filter((p) => p.project.resourceType === "COLLECTION" && p.displaySnapshot)
                  .map((p) => p.displaySnapshot!.id),
              },
              exitUrl: { contains: "/products/" },
            },
            _count: true,
          }),
        ])
      : [[], [], [], [], []];

  // Build lookup maps
  const metricsMap = new Map<string, { real: number; zombie: number; bot: number; atc: number; conv: number; revenue: number; productClicks: number }>();
  for (const row of visitorCounts) {
    const m = metricsMap.get(row.snapshotId) || { real: 0, zombie: 0, bot: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 };
    if (row.visitorType === "REAL") m.real = row._count;
    else if (row.visitorType === "ZOMBIE") m.zombie = row._count;
    else if (row.visitorType === "BOT") m.bot = row._count;
    metricsMap.set(row.snapshotId, m);
  }
  for (const row of atcCounts) {
    const m = metricsMap.get(row.snapshotId) || { real: 0, zombie: 0, bot: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 };
    m.atc = row._count;
    metricsMap.set(row.snapshotId, m);
  }
  for (const row of convCounts) {
    const m = metricsMap.get(row.snapshotId) || { real: 0, zombie: 0, bot: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 };
    m.conv = row._count;
    metricsMap.set(row.snapshotId, m);
  }
  for (const row of revenueSums) {
    const m = metricsMap.get(row.snapshotId) || { real: 0, zombie: 0, bot: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 };
    m.revenue = row._sum.orderValue || 0;
    metricsMap.set(row.snapshotId, m);
  }
  for (const row of productClickCounts) {
    const m = metricsMap.get(row.snapshotId) || { real: 0, zombie: 0, bot: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 };
    m.productClicks = row._count;
    metricsMap.set(row.snapshotId, m);
  }

  const projectsWithStats = projectSnapshots.map(({ project, displaySnapshot }) => {
    const sid = displaySnapshot?.id;
    const m = sid ? metricsMap.get(sid) || { real: 0, zombie: 0, bot: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 } : { real: 0, zombie: 0, bot: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 };
    const targetVisitors = displaySnapshot?.targetVisitors || 1000;
    const progress = Math.min(100, Math.round((m.real / targetVisitors) * 100));
    const atcRate = project.resourceType === "PRODUCT" && m.real > 0 ? Math.round((m.atc / m.real) * 1000) / 10 : undefined;
    const ctrRate = project.resourceType === "COLLECTION" && m.real > 0 ? Math.round((m.productClicks / m.real) * 1000) / 10 : undefined;
    const cvrRate = m.real > 0 ? Math.round((m.conv / m.real) * 1000) / 10 : 0;

    return {
      id: project.id,
      productTitle: project.productTitle,
      productHandle: project.productHandle,
      resourceType: project.resourceType,
      status: displaySnapshot?.status || "NO_SNAPSHOT",
      snapshotName: displaySnapshot?.name || `Snapshot ${displaySnapshot?.number || 1}`,
      snapshotCount: project.snapshots.length,
      targetVisitors,
      realCount: m.real,
      zombieCount: m.zombie,
      botCount: m.bot,
      progress,
      atcRate,
      ctrRate,
      cvrRate,
      revenue: m.revenue,
      createdAt: project.createdAt,
    };
  });

  return json({
    projects: projectsWithStats,
    shop,
    setupGuideDismissed: shopSettings.setupGuideDismissed,
    activeCount,
    completedCount,
    profile: profile
      ? {
          avatarEmoji: profile.avatarEmoji,
          avatarUrl: profile.avatarUrl,
          bio: profile.bio,
          displayName: profile.displayName,
          reputation: profile.reputation,
          answersCount: profile._count.answers,
          insightsCount: profile._count.insights,
        }
      : null,
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      linkUrl: n.linkUrl,
      isRead: n.isRead,
      createdAt: n.createdAt,
    })),
    unreadCount,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "create") {
    const productId = formData.get("productId") as string;
    const productTitle = formData.get("productTitle") as string;
    const productHandle = formData.get("productHandle") as string;
    const resourceType = (formData.get("resourceType") as "PRODUCT" | "COLLECTION") || "PRODUCT";
    const snapshotName = formData.get("snapshotName") as string | null;
    const targetVisitors = parseInt(formData.get("targetVisitors") as string) || 1000;

    // Check if project already exists for this resource with an active snapshot
    const existing = await prisma.project.findFirst({
      where: {
        shop,
        productId,
        resourceType,
        snapshots: {
          some: {
            status: "ACTIVE",
          },
        },
      },
    });

    if (existing) {
      const resourceLabel = resourceType === "COLLECTION" ? "collection" : "product";
      return json({ error: `An active audit already exists for this ${resourceLabel}` }, { status: 400 });
    }

    // Check if project exists (but no active snapshot)
    let project = await prisma.project.findFirst({
      where: { shop, productId, resourceType },
      include: { _count: { select: { snapshots: true } } },
    });

    if (project) {
      // Create new snapshot for existing project
      await prisma.snapshot.create({
        data: {
          projectId: project.id,
          number: project._count.snapshots + 1,
          name: snapshotName || null,
          targetVisitors,
          status: "ACTIVE",
        },
      });
    } else {
      // Create new project with first snapshot
      await prisma.project.create({
        data: {
          shop,
          resourceType,
          productId,
          productTitle,
          productHandle,
          snapshots: {
            create: {
              number: 1,
              name: snapshotName || null,
              targetVisitors,
              status: "ACTIVE",
            },
          },
        },
      });
    }

    return json({ success: true });
  }

  if (actionType === "delete") {
    const projectId = formData.get("projectId") as string;
    await prisma.project.delete({ where: { id: projectId } });
    return json({ success: true });
  }

  if (actionType === "mark-read") {
    const notificationId = formData.get("notificationId") as string;
    await markAsRead(notificationId, shop);
    return json({ success: true });
  }

  if (actionType === "mark-all-read") {
    await markAllAsRead(shop);
    return json({ success: true });
  }

  if (actionType === "load-more-notifications") {
    const skip = parseInt(formData.get("skip") as string) || 0;
    const moreNotifications = await getNotifications(shop, { take: 10, skip });
    return json({
      notifications: moreNotifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        linkUrl: n.linkUrl,
        isRead: n.isRead,
        createdAt: n.createdAt,
      })),
    });
  }

  if (actionType === "dismissSetup") {
    await prisma.shopSettings.upsert({
      where: { shop },
      update: { setupGuideDismissed: true },
      create: { shop, setupGuideDismissed: true },
    });
    return json({ success: true });
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

export default function Index() {
  const {
    projects,
    shop,
    setupGuideDismissed,
    activeCount,
    completedCount,
    profile,
    notifications: initialNotifications,
    unreadCount: initialUnreadCount,
  } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const notifFetcher = useFetcher<any>();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isTypeModalOpen, setIsTypeModalOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [notifPage, setNotifPage] = useState(1);
  const [hasMoreNotifs, setHasMoreNotifs] = useState(initialNotifications.length === 10);

  // Sync from loader when data refreshes
  useEffect(() => {
    setNotifications(initialNotifications);
    setUnreadCount(initialUnreadCount);
    setNotifPage(1);
    setHasMoreNotifs(initialNotifications.length === 10);
  }, [initialNotifications, initialUnreadCount]);

  // Handle load-more response
  useEffect(() => {
    if (notifFetcher.data?.notifications) {
      const more = notifFetcher.data.notifications;
      setNotifications((prev: any[]) => [...prev, ...more]);
      setHasMoreNotifs(more.length === 10);
    }
  }, [notifFetcher.data]);
  const [resourceType, setResourceType] = useState<"product" | "collection">("product");
  const [selectedProduct, setSelectedProduct] = useState<{
    id: string;
    title: string;
    handle: string;
  } | null>(null);
  const [snapshotName, setSnapshotName] = useState("");
  const [targetVisitors, setTargetVisitors] = useState("1000");

  const isLoading = navigation.state !== "idle";

  const [activeTab, setActiveTab] = useState<"products" | "collections">("products");

  // Check if setup is complete (has at least one project)
  const hasProjects = projects.length > 0;
  const showSetupGuide = !setupGuideDismissed;

  // Deeplink to enable theme extension
  const themeEditorDeeplink = `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${APP_CLIENT_ID}/${THEME_BLOCK_HANDLE}`;

  const handleDismissSetup = useCallback(() => {
    const formData = new FormData();
    formData.append("action", "dismissSetup");
    submit(formData, { method: "POST" });
  }, [submit]);

  // Opens the type selection modal first
  const handleOpenPicker = useCallback(() => {
    setResourceType("product");
    setIsTypeModalOpen(true);
  }, []);

  // After selecting type, open the actual resource picker
  const handleSelectType = useCallback(async () => {
    setIsTypeModalOpen(false);

    try {
      const pickerType = resourceType === "collection" ? "collection" : "product";
      const selected = await shopify.resourcePicker({
        type: pickerType,
        multiple: false,
        ...(pickerType === "product" ? { filter: { variants: false, draft: false } } : {}),
      });

      if (selected && selected.length > 0) {
        const resource = selected[0];
        setSelectedProduct({
          id: resource.id,
          title: resource.title,
          handle: resource.handle,
        });
        setSnapshotName("");
        setTargetVisitors("1000");
        setIsModalOpen(true);
      }
    } catch (error) {
      console.error("Resource picker error:", error);
    }
  }, [resourceType]);

  const handleCreateProject = useCallback(() => {
    if (!selectedProduct) return;

    const formData = new FormData();
    formData.append("action", "create");
    formData.append("productId", selectedProduct.id);
    formData.append("productTitle", selectedProduct.title);
    formData.append("productHandle", selectedProduct.handle);
    formData.append("resourceType", resourceType.toUpperCase());
    formData.append("snapshotName", snapshotName);
    formData.append("targetVisitors", targetVisitors);
    submit(formData, { method: "POST" });
    setIsModalOpen(false);
    setSelectedProduct(null);
  }, [selectedProduct, resourceType, snapshotName, targetVisitors, submit]);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedProduct(null);
  }, []);

  const handleCloseTypeModal = useCallback(() => {
    setIsTypeModalOpen(false);
  }, []);

  const handleMarkRead = useCallback(
    (id: string, linkUrl?: string | null) => {
      // Optimistic update
      setNotifications((prev: any[]) =>
        prev.map((n: any) => (n.id === id ? { ...n, isRead: true } : n)),
      );
      setUnreadCount((c: number) => Math.max(0, c - 1));
      const fd = new FormData();
      fd.append("action", "mark-read");
      fd.append("notificationId", id);
      submit(fd, { method: "POST" });
      if (linkUrl) {
        setBellOpen(false);
        window.location.href = linkUrl;
      }
    },
    [submit],
  );

  const handleMarkAllRead = useCallback(() => {
    setNotifications((prev: any[]) => prev.map((n: any) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    const fd = new FormData();
    fd.append("action", "mark-all-read");
    submit(fd, { method: "POST" });
  }, [submit]);

  const handleLoadMoreNotifs = useCallback(() => {
    const nextPage = notifPage + 1;
    setNotifPage(nextPage);
    const fd = new FormData();
    fd.append("action", "load-more-notifications");
    fd.append("skip", String(nextPage * 10));
    notifFetcher.submit(fd, { method: "POST" });
  }, [notifPage, notifFetcher]);

  function notifTimeAgo(dateStr: string): string {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  }

  const notifEmoji: Record<string, string> = {
    INSIGHT_ANSWERED: "\uD83D\uDCAC",
    ANSWER_UPVOTED: "\u2B06\uFE0F",
    ANSWER_ACCEPTED: "\u2705",
    INSIGHT_METOOED: "\uD83D\uDE4B",
    SNAPSHOT_COMPLETED: "\uD83C\uDFC1",
    HIGH_BOT_TRAFFIC: "\uD83E\uDD16",
  };


  // Setup guide component
  const setupGuideMarkup = showSetupGuide ? (
    <Layout.Section>
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="start">
            <Text variant="headingMd" as="h2">
              Get started with Mouse Whisperer
            </Text>
            <Button variant="plain" onClick={handleDismissSetup}>
              Dismiss
            </Button>
          </InlineStack>

          <Text as="p" tone="subdued">
            Follow these steps to start tracking visitor engagement on your product and collection pages.
          </Text>

          <Divider />

          <BlockStack gap="400">
            {/* Step 1 */}
            <InlineStack gap="300" blockAlign="start">
              <Box>
                <Icon source={hasProjects ? CheckCircleIcon : MinusCircleIcon} tone={hasProjects ? "success" : "subdued"} />
              </Box>
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">
                  Step 1: Enable the tracker in your theme
                </Text>
                <Text as="p" tone="subdued">
                  Add the Mouse Whisperer tracker to your online store theme. This invisible script will track visitor engagement on your product and collection pages.
                </Text>
                <Box paddingBlockStart="200">
                  <Button
                    url={themeEditorDeeplink}
                    target="_blank"
                  >
                    Open Theme Editor
                  </Button>
                </Box>
              </BlockStack>
            </InlineStack>

            {/* Step 2 */}
            <InlineStack gap="300" blockAlign="start">
              <Box>
                <Icon source={hasProjects ? CheckCircleIcon : MinusCircleIcon} tone={hasProjects ? "success" : "subdued"} />
              </Box>
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">
                  Step 2: Create your first audit
                </Text>
                <Text as="p" tone="subdued">
                  Select a product or collection to start tracking. Mouse Whisperer will analyze visitor behavior and classify traffic as real users, zombies (low engagement), or bots.
                </Text>
                {!hasProjects && (
                  <Box paddingBlockStart="200">
                    <Button onClick={handleOpenPicker} variant="primary">
                      Create New Audit
                    </Button>
                  </Box>
                )}
              </BlockStack>
            </InlineStack>

            {/* Step 3 */}
            <InlineStack gap="300" blockAlign="start">
              <Box>
                <Icon source={MinusCircleIcon} tone="subdued" />
              </Box>
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">
                  Step 3: Review your analytics
                </Text>
                <Text as="p" tone="subdued">
                  Once visitors start landing on your tracked pages, you'll see real-time engagement data including time on page, scroll depth, and conversion tracking.
                </Text>
              </BlockStack>
            </InlineStack>
          </BlockStack>

          <Divider />

          <Banner tone="info">
            <p>
              <strong>Tip:</strong> For best results, track pages that receive regular traffic. The more visitors, the faster you'll get statistically significant insights.
            </p>
          </Banner>
        </BlockStack>
      </Card>
    </Layout.Section>
  ) : null;

  const bellActivator = (
    <div
      style={{ position: "relative", display: "inline-flex", cursor: "pointer", padding: 8 }}
      onClick={() => setBellOpen((o) => !o)}
      role="button"
      tabIndex={0}
    >
      <svg viewBox="0 0 20 20" width="24" height="24" fill="currentColor" style={{ color: "var(--p-color-icon)" }}>
        <path d="M10 18a2 2 0 0 1-2-2h4a2 2 0 0 1-2 2zm7-3H3v-1l2-2V8a5 5 0 0 1 4-4.9V3a1 1 0 1 1 2 0v.1A5 5 0 0 1 15 8v4l2 2v1z" />
      </svg>
      {unreadCount > 0 && (
        <span
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            background: "#e51c00",
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 5px",
            lineHeight: 1,
            pointerEvents: "none",
            animation: "notif-pulse 2s ease-in-out infinite",
          }}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
      <style>{`
        @keyframes notif-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.15); opacity: 0.85; }
        }
      `}</style>
    </div>
  );

  return (
    <Page>
      <TitleBar title="Mouse Whisperer">
        <button variant="primary" onClick={handleOpenPicker} disabled={isLoading}>
          Create New Audit
        </button>
      </TitleBar>

      {/* Notification bell + Profile */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, marginBottom: 12 }}>
        <Link to="/app/insights/profile?returnTo=/app" style={{ display: "inline-flex", padding: 8, cursor: "pointer", textDecoration: "none" }}>
          <svg viewBox="0 0 20 20" width="24" height="24" fill="currentColor" style={{ color: "var(--p-color-icon)" }}>
            <path d="M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0-6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 13H4a1 1 0 0 1-1-1v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1a1 1 0 0 1-1 1zm-1-2a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3h10z" />
          </svg>
        </Link>
        <Popover
          active={bellOpen}
          activator={bellActivator}
          onClose={() => setBellOpen(false)}
          preferredAlignment="right"
          fluidContent
        >
          <div style={{ width: 360, maxHeight: 480, display: "flex", flexDirection: "column" }}>
            {/* Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 16px",
                borderBottom: "1px solid var(--p-color-border-subdued)",
              }}
            >
              <Text as="h3" variant="headingSm">Notifications</Text>
              {unreadCount > 0 && (
                <Button variant="plain" onClick={handleMarkAllRead}>
                  Mark all as read
                </Button>
              )}
            </div>

            {/* List */}
            <div style={{ overflowY: "auto", flex: 1 }}>
              {notifications.length === 0 ? (
                <div style={{ padding: "24px 16px", textAlign: "center" }}>
                  <Text as="p" variant="bodySm" tone="subdued">
                    No notifications yet
                  </Text>
                </div>
              ) : (
                notifications.map((notif: any) => (
                  <div
                    key={notif.id}
                    onClick={() => notif.linkUrl ? handleMarkRead(notif.id, notif.linkUrl) : undefined}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: "10px 16px",
                      cursor: notif.linkUrl ? "pointer" : "default",
                      background: notif.isRead ? "transparent" : "var(--p-color-bg-surface-secondary)",
                      borderBottom: "1px solid var(--p-color-border-subdued)",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (notif.linkUrl) e.currentTarget.style.background = "var(--p-color-bg-surface-hover)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = notif.isRead
                        ? "transparent"
                        : "var(--p-color-bg-surface-secondary)";
                    }}
                  >
                    <span style={{ fontSize: 20, flexShrink: 0 }}>
                      {notifEmoji[notif.type] || "\uD83D\uDD14"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text as="p" variant="bodySm" fontWeight={notif.isRead ? "regular" : "semibold"}>
                        {notif.title}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {notif.message}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {notifTimeAgo(notif.createdAt)}
                      </Text>
                    </div>
                    {!notif.isRead && (
                      <button
                        title="Mark as read"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkRead(notif.id);
                        }}
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 10,
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                          flexShrink: 0,
                          marginTop: 4,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            background: "#2c6ecb",
                            display: "block",
                            transition: "transform 0.15s",
                          }}
                        />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Load more */}
            {hasMoreNotifs && notifications.length > 0 && (
              <div
                style={{
                  padding: "10px 16px",
                  textAlign: "center",
                  borderTop: "1px solid var(--p-color-border-subdued)",
                }}
              >
                <Button
                  variant="plain"
                  onClick={handleLoadMoreNotifs}
                  loading={notifFetcher.state !== "idle"}
                >
                  Load more
                </Button>
              </div>
            )}
          </div>
        </Popover>
      </div>

      <Layout>
        {setupGuideMarkup}

        {/* RPG Profile Card */}
        <Layout.Section>
          {profile ? (() => {
            const lvl = getLevel(profile.reputation);
            const xpProgress = Math.round(((profile.reputation - lvl.prev) / (lvl.next - lvl.prev)) * 100);
            const badges: { label: string; emoji: string; tone: "success" | "info" | "warning" }[] = [];
            if (profile.answersCount >= 5) badges.push({ label: "Top Contributor", emoji: "\uD83C\uDF1F", tone: "success" });
            if (profile.insightsCount >= 3) badges.push({ label: "Insight Pioneer", emoji: "\uD83D\uDCA1", tone: "info" });
            if (completedCount >= 10) badges.push({ label: `${completedCount} Audits`, emoji: "\uD83D\uDD25", tone: "warning" });
            return (
              <Card>
                <div style={{ display: "flex", gap: 0 }}>
                  {/* Left: Avatar + Info */}
                  <div style={{ display: "flex", flex: 1, gap: 16 }}>
                    <Link to="/app/insights/profile?returnTo=/app" style={{ textDecoration: "none" }}>
                      <div style={{ flexShrink: 0, width: 120, minHeight: 180, borderRadius: 10, background: "#f6f6f7", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {profile.avatarUrl ? (
                          <img src={profile.avatarUrl} alt="Avatar" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 10 }} />
                        ) : (
                          <span style={{ fontSize: "4rem" }}>{profile.avatarEmoji || "\uD83D\uDC2D"}</span>
                        )}
                      </div>
                    </Link>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                      <Text as="span" variant="headingLg" fontWeight="bold">{profile.displayName}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">{lvl.title}</Text>
                      {profile.bio && <Text as="p" variant="bodySm">{profile.bio}</Text>}
                      {badges.length > 0 && (
                        <InlineStack gap="200" wrap>
                          {badges.map((b) => (
                            <Badge key={b.label} tone={b.tone}>{b.emoji} {b.label}</Badge>
                          ))}
                        </InlineStack>
                      )}
                      <div style={{ marginTop: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                          <Text as="span" variant="bodyMd" fontWeight="semibold">{profile.reputation} pts</Text>
                          <Badge tone="info">LVL {lvl.level}</Badge>
                          <Text as="span" variant="bodySm" tone="subdued">{lvl.next - profile.reputation} pts to LVL {lvl.level + 1}</Text>
                        </div>
                        <div style={{ height: 8, background: "#e4e5e7", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${xpProgress}%`, background: "#2c6ecb", borderRadius: 3, transition: "width 0.5s ease" }} />
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Divider */}
                  <div style={{ width: 1, background: "#e4e5e7", margin: "0 20px", flexShrink: 0 }} />
                  {/* Right: 2x2 Metrics */}
                  <div style={{ flex: "0 0 220px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignContent: "center" }}>
                    <div style={{ textAlign: "center", padding: "12px 0" }}>
                      <Text as="p" variant="bodySm" tone="subdued">Answers</Text>
                      <Text as="p" variant="headingXl">{profile.answersCount}</Text>
                    </div>
                    <div style={{ textAlign: "center", padding: "12px 0" }}>
                      <Text as="p" variant="bodySm" tone="subdued">Insights</Text>
                      <Text as="p" variant="headingXl">{profile.insightsCount}</Text>
                    </div>
                    <div style={{ textAlign: "center", padding: "12px 0" }}>
                      <Text as="p" variant="bodySm" tone="subdued">Audits</Text>
                      <Text as="p" variant="headingXl">{completedCount}</Text>
                    </div>
                    <div style={{ textAlign: "center", padding: "12px 0" }}>
                      <Text as="p" variant="bodySm" tone="subdued">Streak</Text>
                      <Text as="p" variant="headingXl">{activeCount > 0 ? activeCount : completedCount > 0 ? "\u2713" : "\u2014"}</Text>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })() : (
            <Banner
              title="Set up your community profile"
              tone="info"
              action={{
                content: "Create profile",
                url: "/app/insights/profile?returnTo=/app",
              }}
            >
              <p>Create a display name and avatar to start posting insights and helping fellow merchants.</p>
            </Banner>
          )}
        </Layout.Section>

        {/* Tabbed Audit Table */}
        <Layout.Section>
          <Card padding="0">
            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: "1px solid var(--p-color-border-subdued)" }}>
              {(["products", "collections"] as const).map((tab) => {
                const isActive = activeTab === tab;
                const label = tab.charAt(0).toUpperCase() + tab.slice(1);
                const count = tab === "products"
                  ? projects.filter((p: any) => p.resourceType === "PRODUCT").length
                  : projects.filter((p: any) => p.resourceType === "COLLECTION").length;
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      flex: 1, padding: "12px 16px", background: "none", border: "none",
                      borderBottom: isActive ? "2px solid #2c6ecb" : "2px solid transparent",
                      cursor: "pointer", fontSize: 14,
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? "#202223" : "#6d7175",
                      transition: "all 0.15s",
                    }}
                  >
                    {label} {count > 0 && <span style={{ color: "#8c9196", fontWeight: 400 }}>({count})</span>}
                  </button>
                );
              })}
            </div>

            {/* Table rows */}
            {(() => {
              const filtered = activeTab === "products"
                ? projects.filter((p: any) => p.resourceType === "PRODUCT")
                : projects.filter((p: any) => p.resourceType === "COLLECTION");
              const isProduct = activeTab === "products";
              const metricLabel1 = isProduct ? "ATC" : "CTR";

              if (filtered.length === 0) {
                return (
                  <div style={{ padding: "40px 16px", textAlign: "center" }}>
                    <Text as="p" variant="bodyMd" tone="subdued">No {activeTab} audits yet.</Text>
                    <div style={{ marginTop: 12 }}>
                      <Button onClick={handleOpenPicker}>Create {activeTab.slice(0, -1)} audit</Button>
                    </div>
                  </div>
                );
              }

              return filtered.map((p: any, idx: number) => {
                const progressPct = Math.min(100, Math.round((p.realCount / p.targetVisitors) * 100));
                const metric1 = isProduct ? p.atcRate : p.ctrRate;
                const isDone = progressPct >= 100;
                return (
                  <Link key={p.id} to={`/app/project/${p.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                    <div
                      style={{
                        padding: "14px 20px",
                        borderBottom: idx < filtered.length - 1 ? "1px solid #ebebeb" : "none",
                        cursor: "pointer", transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--p-color-bg-surface-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                        {/* Name + snapshot */}
                        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                          <Text variant="bodyMd" fontWeight="bold" as="span">{p.productTitle}</Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {p.snapshotName}{p.snapshotCount > 1 ? ` \u00B7 ${p.snapshotCount} snapshots` : ""}
                          </Text>
                        </div>
                        {/* Progress */}
                        <div style={{ flex: "1 1 180px", maxWidth: 220 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <Text as="span" variant="bodySm" tone="subdued">{p.realCount}/{p.targetVisitors}</Text>
                          </div>
                          <div style={{ height: 6, background: "#e4e5e7", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${progressPct}%`, background: isDone ? "#29845a" : "#2c6ecb", borderRadius: 3, transition: "width 0.3s" }} />
                          </div>
                        </div>
                        {/* Metrics */}
                        <div style={{ display: "flex", gap: 28, flexShrink: 0 }}>
                          <div style={{ textAlign: "center", minWidth: 52 }}>
                            <Text as="p" variant="bodySm" tone="subdued">{metricLabel1}</Text>
                            <Text as="p" variant="bodyMd" fontWeight="semibold">{metric1 != null ? `${metric1}%` : "\u2014"}</Text>
                          </div>
                          <div style={{ textAlign: "center", minWidth: 52 }}>
                            <Text as="p" variant="bodySm" tone="subdued">CVR</Text>
                            <Text as="p" variant="bodyMd" fontWeight="semibold">{p.cvrRate}%</Text>
                          </div>
                          <div style={{ textAlign: "center", minWidth: 64 }}>
                            <Text as="p" variant="bodySm" tone="subdued">REV</Text>
                            <Text as="p" variant="bodyMd" fontWeight="semibold">${Math.round(p.revenue).toLocaleString()}</Text>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              });
            })()}
          </Card>
        </Layout.Section>

        {/* Legend */}
        <Layout.Section>
          <InlineStack align="center" gap="400">
            <span style={{ fontSize: 12, color: "#29845a" }}>{"\u25CF"} Real</span>
            <span style={{ fontSize: 12, color: "#b98900" }}>{"\u25CF"} Zombie</span>
            <span style={{ fontSize: 12, color: "#d72c0d" }}>{"\u25CF"} Bot</span>
          </InlineStack>
        </Layout.Section>
      </Layout>

      {/* Type Selection Modal */}
      <Modal
        open={isTypeModalOpen}
        onClose={handleCloseTypeModal}
        title="What do you want to track?"
        primaryAction={{
          content: "Continue",
          onAction: handleSelectType,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: handleCloseTypeModal,
          },
        ]}
      >
        <Modal.Section>
          <ChoiceList
            title="Select page type"
            choices={[
              {
                label: "Product page",
                value: "product",
                helpText: "Track visitor engagement on a product page (/products/...)",
              },
              {
                label: "Collection page",
                value: "collection",
                helpText: "Track visitor engagement on a collection page (/collections/...)",
              },
            ]}
            selected={[resourceType]}
            onChange={(value) => setResourceType(value[0] as "product" | "collection")}
          />
        </Modal.Section>
      </Modal>

      {/* Create Audit Modal */}
      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title={`Create Audit: ${selectedProduct?.title || ""}`}
        primaryAction={{
          content: "Create Audit",
          onAction: handleCreateProject,
          loading: isLoading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: handleCloseModal,
          },
        ]}
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
              helpText="Number of real visitors to collect before completing the snapshot"
              autoComplete="off"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
