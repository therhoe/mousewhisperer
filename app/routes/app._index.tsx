import { useCallback, useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, Link, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  useIndexResourceState,
  EmptyState,
  Button,
  BlockStack,
  InlineStack,
  ProgressBar,
  Modal,
  TextField,
  FormLayout,
  Banner,
  List,
  Box,
  Icon,
  Divider,
  CalloutCard,
  ChoiceList,
  Popover,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  MinusCircleIcon,
  ProfileIcon,
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

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&[^;]+;/g, " ").trim();
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

  const [projects, activeCount, completedCount, topAnswers, trendingInsights, notifications, unreadCount] =
    await Promise.all([
      // Existing project query
      prisma.project.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        include: {
          snapshots: {
            orderBy: { number: "desc" },
            include: {
              visits: {
                select: {
                  visitorType: true,
                },
              },
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

  // Calculate stats for each project based on active snapshot
  const projectsWithStats = projects.map((project) => {
    const activeSnapshot = project.snapshots.find((s) => s.status === "ACTIVE");
    const latestSnapshot = project.snapshots[0]; // Already ordered by number desc
    const displaySnapshot = activeSnapshot || latestSnapshot;

    // Calculate stats from active/latest snapshot
    const visits = displaySnapshot?.visits || [];
    const realCount = visits.filter((v) => v.visitorType === "REAL").length;
    const zombieCount = visits.filter((v) => v.visitorType === "ZOMBIE").length;
    const botCount = visits.filter((v) => v.visitorType === "BOT").length;
    const targetVisitors = displaySnapshot?.targetVisitors || 1000;
    const progress = Math.min(100, Math.round((realCount / targetVisitors) * 100));

    return {
      id: project.id,
      productTitle: project.productTitle,
      productHandle: project.productHandle,
      resourceType: project.resourceType,
      status: displaySnapshot?.status || "NO_SNAPSHOT",
      snapshotName: displaySnapshot?.name || `Snapshot ${displaySnapshot?.number || 1}`,
      snapshotCount: project.snapshots.length,
      targetVisitors,
      realCount,
      zombieCount,
      botCount,
      progress,
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
          displayName: profile.displayName,
          reputation: profile.reputation,
          answersCount: profile._count.answers,
          insightsCount: profile._count.insights,
        }
      : null,
    topAnswers: topAnswers.map((a) => ({
      id: a.id,
      insightId: a.insight.id,
      insightTitle: a.insight.title,
      upvoteCount: a.upvoteCount,
    })),
    trendingInsights: trendingInsights.map((i) => ({
      id: i.id,
      title: i.title,
      meTooCount: i.meTooCount,
      contentPreview: stripHtml(i.content).slice(0, 80),
    })),
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
    topAnswers,
    trendingInsights,
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

  const resourceName = {
    singular: "project",
    plural: "projects",
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(projects);

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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return <Badge tone="success">Active</Badge>;
      case "COMPLETED":
        return <Badge tone="info">Completed</Badge>;
      case "PAUSED":
        return <Badge tone="warning">Paused</Badge>;
      case "NO_SNAPSHOT":
        return <Badge tone="attention">No Snapshot</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const rowMarkup = projects.map((project, index) => (
    <IndexTable.Row
      id={project.id}
      key={project.id}
      selected={selectedResources.includes(project.id)}
      position={index}
    >
      <IndexTable.Cell>
        <BlockStack gap="100">
          <InlineStack gap="200" blockAlign="center">
            <Text variant="bodyMd" fontWeight="bold" as="span">
              <Link to={`/app/project/${project.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                {project.productTitle}
              </Link>
            </Text>
            <Badge tone={project.resourceType === "COLLECTION" ? "info" : "success"}>
              {project.resourceType === "COLLECTION" ? "Collection" : "Product"}
            </Badge>
          </InlineStack>
          <Text as="span" variant="bodySm" tone="subdued">
            {project.snapshotName} {project.snapshotCount > 1 && `(${project.snapshotCount} snapshots)`}
          </Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>{getStatusBadge(project.status)}</IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="100">
          <Text as="span" variant="bodySm">
            {project.realCount} / {project.targetVisitors}
          </Text>
          <div style={{ width: "100px" }}>
            <ProgressBar progress={project.progress} size="small" tone="primary" />
          </div>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" tone="success">
          {project.realCount}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" tone="caution">
          {project.zombieCount}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" tone="critical">
          {project.botCount}
        </Text>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const emptyStateMarkup = (
    <EmptyState
      heading="Create your first audit"
      action={{
        content: "Create New Audit",
        onAction: handleOpenPicker,
      }}
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>Select a product or collection to start tracking visitor engagement and traffic quality.</p>
    </EmptyState>
  );

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

      {/* Notification bell */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
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

        {/* Audit Status Cards */}
        <Layout.Section>
          <InlineStack gap="400" wrap={false}>
            <div style={{ flex: 1 }}>
              <Card>
                <BlockStack gap="300">
                  <Text as="p" variant="bodySm" tone="subdued">Active</Text>
                  <Text as="p" variant="headingXl" alignment="center">
                    {activeCount}
                  </Text>
                </BlockStack>
              </Card>
            </div>
            <div style={{ flex: 1 }}>
              <Card>
                <BlockStack gap="300">
                  <Text as="p" variant="bodySm" tone="subdued">Completed</Text>
                  <Text as="p" variant="headingXl" alignment="center">
                    {completedCount}
                  </Text>
                </BlockStack>
              </Card>
            </div>
          </InlineStack>
        </Layout.Section>

        {/* Profile Card */}
        <Layout.Section>
          {profile ? (
            <Card>
              <div style={{ display: "flex", justifyContent: "space-evenly", alignItems: "center", flexWrap: "wrap", gap: 16, position: "relative" }}>
                <Link to="/app/insights/profile?returnTo=/app" style={{ position: "absolute", top: 0, right: 0, color: "var(--p-color-icon-secondary)" }}>
                  <Icon source={ProfileIcon} />
                </Link>
                <BlockStack gap="100" inlineAlign="center">
                  <span style={{ fontSize: "2.5rem" }}>
                    {profile.avatarEmoji || "\uD83D\uDC2D"}
                  </span>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {profile.displayName}
                  </Text>
                </BlockStack>
                <BlockStack gap="100" inlineAlign="center">
                  <Text as="p" variant="headingXl">{profile.answersCount}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">answers</Text>
                </BlockStack>
                <BlockStack gap="100" inlineAlign="center">
                  <Text as="p" variant="headingXl">{profile.insightsCount}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">insights</Text>
                </BlockStack>
                <BlockStack gap="100" inlineAlign="center">
                  <Text as="p" variant="headingXl">{profile.reputation}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">points</Text>
                </BlockStack>
              </div>
            </Card>
          ) : (
            <Banner
              title="Set up your community profile"
              tone="info"
              action={{
                content: "Create profile",
                url: "/app/insights/profile?returnTo=/app",
              }}
            >
              <p>
                Create a display name and avatar to start posting insights and helping fellow merchants.
              </p>
            </Banner>
          )}
        </Layout.Section>

        {/* Top Answers & Trending Insights */}
        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <style>{`.mw-card-stretch > div { height: 100%; } .mw-card-stretch > div > div { height: 100%; }`}</style>
              <div className="mw-card-stretch" style={{ flex: 1 }}>
              <Card>
                <div style={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between" }}>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Top Answers</Text>
                  {topAnswers.length === 0 ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {profile ? "You haven't posted any answers yet." : "Set up your profile to start answering."}
                    </Text>
                  ) : (
                    <BlockStack gap="200">
                      {topAnswers.map((answer: any, idx: number) => (
                        <InlineStack key={answer.id} gap="200" blockAlign="start">
                          <Text as="span" variant="bodySm" tone="subdued">{idx + 1}.</Text>
                          <Link
                            to={`/app/insights/${answer.insightId}`}
                            style={{ textDecoration: "none", color: "inherit" }}
                          >
                            <Text as="span" variant="bodySm">
                              {answer.insightTitle}
                            </Text>
                          </Link>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
                  <InlineStack align="end">
                    <Link to="/app/insights" style={{ textDecoration: "none" }}>
                      <Button variant="plain">view all</Button>
                    </Link>
                  </InlineStack>
                </div>
              </Card>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div className="mw-card-stretch" style={{ flex: 1 }}>
              <Card>
                <div style={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between" }}>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Trending Insights</Text>
                  {trendingInsights.length === 0 ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      No trending insights this week.
                    </Text>
                  ) : (
                    <BlockStack gap="200">
                      {trendingInsights.map((insight: any, idx: number) => (
                        <InlineStack key={insight.id} gap="200" blockAlign="start">
                          <Text as="span" variant="bodySm" tone="subdued">{idx + 1}.</Text>
                          <Link
                            to={`/app/insights/${insight.id}`}
                            style={{ textDecoration: "none", color: "inherit" }}
                          >
                            <Text as="span" variant="bodySm">
                              {insight.title}
                            </Text>
                          </Link>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
                  <InlineStack align="end">
                    <Link to="/app/insights?sort=trending" style={{ textDecoration: "none" }}>
                      <Button variant="plain">view all</Button>
                    </Link>
                  </InlineStack>
                </div>
              </Card>
              </div>
            </div>
          </div>
        </Layout.Section>

        {/* Project Table */}
        <Layout.Section>
          <Card padding="0">
            {projects.length === 0 ? (
              emptyStateMarkup
            ) : (
              <IndexTable
                resourceName={resourceName}
                itemCount={projects.length}
                selectedItemsCount={
                  allResourcesSelected ? "All" : selectedResources.length
                }
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: "Page" },
                  { title: "Status" },
                  { title: "Progress" },
                  { title: "Real Users" },
                  { title: "Zombies" },
                  { title: "Bots" },
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
            )}
          </Card>
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
