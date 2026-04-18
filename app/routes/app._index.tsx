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
  ProgressBar,
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

  const [projects, activeCount, completedCount, trendingChallenges, notifications, unreadCount] =
    await Promise.all([
      // Project query — snapshot metadata only
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
              _count: { select: { visits: { where: { visitorType: "REAL" } } } },
            },
          },
        },
      }),
      prisma.snapshot.count({ where: { project: { shop }, status: "ACTIVE" } }),
      prisma.snapshot.count({ where: { project: { shop }, status: "COMPLETED" } }),
      // Trending challenges (last 14 days)
      prisma.insight.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } },
        orderBy: [{ meTooCount: "desc" }, { viewCount: "desc" }, { createdAt: "desc" }],
        take: 5,
        select: { id: true, title: true, viewCount: true, meTooCount: true, answerCount: true },
      }),
      getNotifications(shop, { take: 10 }),
      getUnreadCount(shop),
    ]);

  // Build active audits list (projects with active or in-progress snapshots)
  const activeAudits = projects
    .map((project) => {
      const activeSnap = project.snapshots.find((s) => s.status === "ACTIVE");
      if (!activeSnap) return null;
      const realCount = activeSnap._count.visits;
      return {
        id: project.id,
        productTitle: project.productTitle,
        realCount,
        targetVisitors: activeSnap.targetVisitors,
        progress: Math.min(100, Math.round((realCount / activeSnap.targetVisitors) * 100)),
      };
    })
    .filter(Boolean);

  return json({
    shop,
    setupGuideDismissed: shopSettings.setupGuideDismissed,
    activeCount,
    completedCount,
    activeAudits,
    trendingChallenges,
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
    const resourceType = (formData.get("resourceType") as "PRODUCT" | "COLLECTION" | "PAGE" | "BLOG") || "PRODUCT";
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
    shop,
    setupGuideDismissed,
    activeCount,
    completedCount,
    activeAudits,
    trendingChallenges,
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
  const [resourceType, setResourceType] = useState<"product" | "collection" | "page" | "blog">("product");
  const [selectedProduct, setSelectedProduct] = useState<{
    id: string;
    title: string;
    handle: string;
  } | null>(null);
  const [snapshotName, setSnapshotName] = useState("");
  const [targetVisitors, setTargetVisitors] = useState("1000");
  const [manualTitle, setManualTitle] = useState("");
  const [manualHandle, setManualHandle] = useState("");

  const isLoading = navigation.state !== "idle";

  // Check if setup is complete
  const hasProjects = activeAudits.length > 0 || completedCount > 0;
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

  // After selecting type, open the actual resource picker or manual input
  const handleSelectType = useCallback(async () => {
    setIsTypeModalOpen(false);

    if (resourceType === "page" || resourceType === "blog") {
      // No Shopify resource picker for pages/blogs — go straight to create modal
      setSelectedProduct(null);
      setSnapshotName("");
      setTargetVisitors("1000");
      setIsModalOpen(true);
      return;
    }

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
    const isManual = resourceType === "page" || resourceType === "blog";
    const title = isManual ? manualTitle : selectedProduct?.title;
    const handle = isManual ? manualHandle : selectedProduct?.handle;
    const id = isManual ? `gid://shopify/${resourceType === "page" ? "Page" : "Blog"}/${manualHandle}` : selectedProduct?.id;

    if (!title || !handle) return;

    const formData = new FormData();
    formData.append("action", "create");
    formData.append("productId", id || "");
    formData.append("productTitle", title);
    formData.append("productHandle", handle);
    formData.append("resourceType", resourceType.toUpperCase());
    formData.append("snapshotName", snapshotName);
    formData.append("targetVisitors", targetVisitors);
    submit(formData, { method: "POST" });
    setIsModalOpen(false);
    setSelectedProduct(null);
    setManualTitle("");
    setManualHandle("");
  }, [selectedProduct, resourceType, snapshotName, targetVisitors, submit, manualTitle, manualHandle]);

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
        <Link to="/app/challenges/profile?returnTo=/app" style={{ display: "inline-flex", padding: 8, cursor: "pointer", textDecoration: "none" }}>
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

      <BlockStack gap="400">
        {setupGuideMarkup}

        {/* Profile Card — horizontal full-width */}
        {profile ? (() => {
          const lvl = getLevel(profile.reputation);
          const badges: { label: string; emoji: string; tone: "success" | "info" | "warning" }[] = [];
          if (profile.answersCount >= 5) badges.push({ label: "Top Contributor", emoji: "\uD83C\uDF1F", tone: "success" });
          if (profile.insightsCount >= 3) badges.push({ label: "Challenge Pioneer", emoji: "\uD83D\uDCA1", tone: "info" });
          if (completedCount >= 10) badges.push({ label: `${completedCount} Audits`, emoji: "\uD83D\uDD25", tone: "warning" });
          return (
            <Card>
              <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                <Link to="/app/challenges/profile?returnTo=/app" style={{ textDecoration: "none" }}>
                  <div style={{ width: 96, height: 96, borderRadius: 12, background: "#f6f6f7", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {profile.avatarUrl ? (
                      <img src={profile.avatarUrl} alt="Avatar" style={{ width: "100%", height: "100%", objectFit: "cover", imageRendering: "pixelated" }} />
                    ) : (
                      <span style={{ fontSize: "3rem" }}>{profile.avatarEmoji || "\uD83D\uDC2D"}</span>
                    )}
                  </div>
                </Link>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <BlockStack gap="100">
                    <Text as="p" variant="headingLg" fontWeight="bold">{profile.displayName}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{lvl.title}</Text>
                    {profile.bio && <Text as="p" variant="bodySm">{profile.bio}</Text>}
                    {badges.length > 0 && (
                      <InlineStack gap="100" wrap>
                        {badges.map((b) => <Badge key={b.label} tone={b.tone}>{b.emoji} {b.label}</Badge>)}
                      </InlineStack>
                    )}
                  </BlockStack>
                </div>
                <div style={{ flexShrink: 0, textAlign: "right" }}>
                  <Text as="p" variant="bodySm" tone="subdued">Reputation</Text>
                  <Text as="p" variant="headingLg" fontWeight="semibold">{profile.reputation} pts</Text>
                  <div style={{ marginTop: 4 }}>
                    <Badge tone="info">LVL {lvl.level}</Badge>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <Text as="span" variant="bodySm" tone="subdued">{lvl.next - profile.reputation} pts to LVL {lvl.level + 1}</Text>
                  </div>
                </div>
              </div>
            </Card>
          );
        })() : (
          <Banner title="Set up your community profile" tone="info" action={{ content: "Create profile", url: "/app/challenges/profile?returnTo=/app" }}>
            <p>Create a display name and avatar to start posting challenges and helping fellow merchants.</p>
          </Banner>
        )}

        {/* Two-column row: Active Audits | Trending Challenges */}
        <Layout>
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingMd">Active audits</Text>
                  <Text as="span" variant="bodySm" tone="subdued">{activeAudits.length} running</Text>
                </InlineStack>
                {activeAudits.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">No audits currently running. Start a new one to begin collecting data.</Text>
                ) : (
                  <BlockStack gap="300">
                    {(activeAudits as any[]).map((a: any) => (
                      <Link key={a.id} to={`/app/project/${a.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                            <Text as="span" variant="bodySm" fontWeight="semibold">{a.productTitle}</Text>
                            <Text as="span" variant="bodySm" tone="subdued">{a.realCount}/{a.targetVisitors}</Text>
                          </div>
                          <ProgressBar progress={a.progress} size="small" tone="primary" />
                        </div>
                      </Link>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">Trending challenges</Text>
                {(trendingChallenges as any[]).length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">No challenges posted yet.</Text>
                ) : (
                  <BlockStack gap="200">
                    {(trendingChallenges as any[]).map((c: any, idx: number) => (
                      <Link key={c.id} to={`/app/challenges/${c.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                        <div style={{ padding: "10px 0", borderBottom: idx < (trendingChallenges as any[]).length - 1 ? "1px solid #ebebeb" : "none" }}>
                          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                            <Text as="span" variant="bodySm" tone="subdued">{idx + 1}.</Text>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Text as="p" variant="bodyMd" fontWeight="semibold">{c.title}</Text>
                              <InlineStack gap="400" blockAlign="center">
                                <Text as="span" variant="bodySm" tone="subdued">{"\uD83D\uDC41"} {c.viewCount}</Text>
                                <Text as="span" variant="bodySm" tone="subdued">{"\uD83D\uDE4B"} {c.meTooCount} me too</Text>
                                <Text as="span" variant="bodySm" tone="subdued">{"\uD83D\uDCAC"} {c.answerCount} answers</Text>
                              </InlineStack>
                            </div>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

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
              {
                label: "Page",
                value: "page",
                helpText: "Track visitor engagement on a custom page (/pages/...)",
              },
              {
                label: "Blog",
                value: "blog",
                helpText: "Track visitor engagement on a blog or blog post (/blogs/...)",
              },
            ]}
            selected={[resourceType]}
            onChange={(value) => setResourceType(value[0] as "product" | "collection" | "page" | "blog")}
          />
        </Modal.Section>
      </Modal>

      {/* Create Audit Modal */}
      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title={`Create Audit: ${selectedProduct?.title || manualTitle || (resourceType === "page" ? "Page" : resourceType === "blog" ? "Blog" : "")}`}
        primaryAction={{
          content: "Create Audit",
          onAction: handleCreateProject,
          loading: isLoading,
          disabled: (resourceType === "page" || resourceType === "blog") && (!manualTitle || !manualHandle),
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
            {(resourceType === "page" || resourceType === "blog") && (
              <>
                <TextField
                  label="Title"
                  value={manualTitle}
                  onChange={setManualTitle}
                  placeholder={resourceType === "blog" ? "e.g., News Blog" : "e.g., About Us"}
                  helpText="Name for this audit"
                  autoComplete="off"
                />
                <TextField
                  label="URL Handle"
                  value={manualHandle}
                  onChange={setManualHandle}
                  placeholder={resourceType === "blog" ? "e.g., news or news/my-first-post" : "e.g., about-us"}
                  helpText={resourceType === "blog" ? "The blog handle from the URL: /blogs/{handle} or /blogs/{blog}/{post}" : "The page handle from the URL: /pages/{handle}"}
                  autoComplete="off"
                />
              </>
            )}
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
