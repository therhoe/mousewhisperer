import { useCallback, useState, useEffect, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  useLoaderData,
  useSubmit,
  useNavigation,
  Link,
  useFetcher,
} from "@remix-run/react";
import {
  Page,
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
  ChoiceList,
  Popover,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "../utils/notifications.server";
import { COMMUNITY_FEATURES_ENABLED } from "../utils/features";
import { ensureWebPixel } from "../utils/web-pixel.server";
import {
  cachedValue,
  clearCacheKey,
  clearCachePrefix,
  loaderCacheKeys,
} from "../utils/loader-cache.server";
import { createStoreSnapshot } from "../utils/store-snapshot.server";
import { planUsagePillLabel, TargetLimitText } from "../components/PremiumGate";
import { ConversionProgressCard } from "../components/ConversionProgressCard";
import {
  assertCanCreateNormalSnapshots,
  assertCanCreateStoreSnapshot,
  assertSnapshotTargetAllowed,
  getBillingAccess,
  isPlanLimitError,
  planLimitPayload,
} from "../utils/billing.server";
import { getCROActivityTimeline } from "../utils/optimization-timeline.server";
import { getShopifyConversionProgress } from "../utils/shopify-analytics.server";

const HOMEPAGE_RESOURCE = {
  id: "gid://shopify/Homepage/__homepage__",
  title: "Homepage",
  handle: "__homepage__",
};
type AuditResourceType =
  | "product"
  | "collection"
  | "homepage"
  | "page"
  | "blog";
type PrismaResourceType =
  | "PRODUCT"
  | "COLLECTION"
  | "HOMEPAGE"
  | "PAGE"
  | "BLOG";
type DashboardSummary = {
  setupGuideDismissed: boolean;
  completedCount: number;
  profile: {
    avatarEmoji: string | null;
    avatarUrl: string | null;
    bio: string | null;
    displayName: string;
    reputation: number;
    answersCount: number;
    insightsCount: number;
  } | null;
};
type StoreSnapshotListItem = {
  id: string;
  name: string | null;
  status: string;
  completionMode: string;
  targetHumanVisitors: number | null;
  targetTotalVisits: number | null;
  durationDays: number | null;
  startedAt: string;
  completedAt: string | null;
  _count: { visits: number };
};

const DASHBOARD_CACHE_TTL_MS = 60_000;

function getLevel(rep: number) {
  if (rep >= 200)
    return { level: 10, title: "Grandmaster", next: 200, prev: 150 };
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

async function getDashboardSummary(shop: string): Promise<DashboardSummary> {
  return cachedValue(
    loaderCacheKeys.dashboard(shop),
    DASHBOARD_CACHE_TTL_MS,
    async () => {
      const [shopSettings, completedCount, profile] = await Promise.all([
        prisma.shopSettings.upsert({
          where: { shop },
          update: {},
          create: { shop },
        }),
        prisma.snapshot.count({
          where: { project: { shop }, status: "COMPLETED" },
        }),
        COMMUNITY_FEATURES_ENABLED
          ? prisma.insightProfile.findUnique({
              where: { shop },
              include: {
                _count: { select: { answers: true, insights: true } },
              },
            })
          : Promise.resolve(null),
      ]);

      return {
        setupGuideDismissed: shopSettings.setupGuideDismissed,
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
      };
    },
  );
}

function clearDashboardCache(shop: string) {
  clearCacheKey(loaderCacheKeys.dashboard(shop));
}

function clearAuditListCaches(shop: string) {
  clearDashboardCache(shop);
  clearCachePrefix(loaderCacheKeys.categoryPrefix(shop));
  clearCachePrefix(loaderCacheKeys.categoryFastPrefix(shop));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const [summary, storeSnapshots, billingAccess, conversionProgress] =
    await Promise.all([
      getDashboardSummary(shop),
      prisma.storeSnapshot.findMany({
        where: { shop },
        orderBy: { startedAt: "desc" },
        take: 5,
        select: {
          id: true,
          name: true,
          status: true,
          completionMode: true,
          targetHumanVisitors: true,
          targetTotalVisits: true,
          durationDays: true,
          startedAt: true,
          completedAt: true,
          _count: { select: { visits: true } },
        },
      }),
      getBillingAccess(shop),
      getShopifyConversionProgress({
        admin,
        shop,
        sessionScope: session.scope,
        period: "month",
      }),
    ]);
  const conversionEvents = await getCROActivityTimeline(
    shop,
    conversionProgress.rangeStart,
    conversionProgress.rangeEnd,
  );

  return json({
    ...summary,
    shop,
    conversionDashboard: {
      progress: conversionProgress,
      events: conversionEvents,
    },
    billingAccess,
    storeSnapshots: storeSnapshots.map((snapshot) => ({
      ...snapshot,
      startedAt: snapshot.startedAt.toISOString(),
      completedAt: snapshot.completedAt?.toISOString() ?? null,
    })),
    notifications: [],
    unreadCount: 0,
    notificationsPending: true,
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
    const resourceType =
      (formData.get("resourceType") as PrismaResourceType) || "PRODUCT";
    const snapshotName = formData.get("snapshotName") as string | null;
    const targetVisitors =
      parseInt(formData.get("targetVisitors") as string) || 1000;

    try {
      await assertCanCreateNormalSnapshots(shop, 1);
      await assertSnapshotTargetAllowed(shop, targetVisitors);
    } catch (error) {
      if (isPlanLimitError(error)) {
        return json(planLimitPayload(error), { status: error.status });
      }
      throw error;
    }

    await ensureWebPixel(admin, shop);

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
      const resourceLabel =
        resourceType === "COLLECTION"
          ? "collection"
          : resourceType === "HOMEPAGE"
            ? "homepage"
            : resourceType === "PAGE"
              ? "page"
              : resourceType === "BLOG"
                ? "blog"
                : "product";
      return json(
        { error: `An active audit already exists for this ${resourceLabel}` },
        { status: 400 },
      );
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

    clearAuditListCaches(shop);
    return json({ success: true });
  }

  if (actionType === "create-store-snapshot") {
    const rawMode = String(formData.get("completionMode") || "HUMAN_VISITORS");
    const completionMode =
      rawMode === "TOTAL_VISITS" || rawMode === "TIME_WINDOW"
        ? rawMode
        : "HUMAN_VISITORS";

    const targetHumanVisitors = parseInt(
      String(formData.get("targetHumanVisitors") || "1000"),
      10,
    );
    const targetTotalVisits = parseInt(
      String(formData.get("targetTotalVisits") || "2500"),
      10,
    );
    const durationDays = parseInt(
      String(formData.get("durationDays") || "7"),
      10,
    );

    try {
      await assertCanCreateStoreSnapshot(shop);
      if (completionMode === "HUMAN_VISITORS") {
        await assertSnapshotTargetAllowed(shop, targetHumanVisitors);
      }
      if (completionMode === "TOTAL_VISITS") {
        await assertSnapshotTargetAllowed(shop, targetTotalVisits);
      }
    } catch (error) {
      if (isPlanLimitError(error)) {
        return json(planLimitPayload(error), { status: error.status });
      }
      throw error;
    }

    await ensureWebPixel(admin, shop);

    const snapshot = await createStoreSnapshot({
      shop,
      name: formData.get("name") as string | null,
      completionMode,
      targetHumanVisitors,
      targetTotalVisits,
      durationDays,
    });

    return redirect(`/app/store-snapshots/${snapshot.id}`);
  }

  if (actionType === "delete") {
    const projectId = formData.get("projectId") as string;
    await prisma.project.delete({ where: { id: projectId } });
    clearAuditListCaches(shop);
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

  if (actionType === "load-notifications") {
    const [notifications, unreadCount] = await Promise.all([
      getNotifications(shop, { take: 10 }),
      getUnreadCount(shop),
    ]);

    return json({
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
    clearDashboardCache(shop);
    return json({ success: true });
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

export default function Index() {
  const {
    setupGuideDismissed,
    completedCount,
    storeSnapshots,
    billingAccess,
    profile,
    notifications: initialNotifications,
    unreadCount: initialUnreadCount,
    conversionDashboard,
    shop,
  } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const notifFetcher = useFetcher<any>();
  const notificationsLoadStarted = useRef(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isTypeModalOpen, setIsTypeModalOpen] = useState(false);
  const [isStoreSnapshotModalOpen, setIsStoreSnapshotModalOpen] =
    useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [notifPage, setNotifPage] = useState(0);
  const [hasMoreNotifs, setHasMoreNotifs] = useState(
    initialNotifications.length === 10,
  );

  useEffect(() => {
    if (initialNotifications.length === 0 && initialUnreadCount === 0) return;
    setNotifications(initialNotifications);
    setUnreadCount(initialUnreadCount);
    setNotifPage(0);
    setHasMoreNotifs(initialNotifications.length === 10);
  }, [initialNotifications, initialUnreadCount]);

  useEffect(() => {
    if (notificationsLoadStarted.current) return;
    notificationsLoadStarted.current = true;
    const formData = new FormData();
    formData.append("action", "load-notifications");
    const timeoutId = window.setTimeout(() => {
      notifFetcher.submit(formData, { method: "POST" });
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [notifFetcher]);

  useEffect(() => {
    if (notifFetcher.data?.notifications) {
      const more = notifFetcher.data.notifications;
      if (typeof notifFetcher.data.unreadCount === "number") {
        setNotifications(more);
        setUnreadCount(notifFetcher.data.unreadCount);
        setNotifPage(0);
      } else {
        setNotifications((prev: any[]) => [...prev, ...more]);
      }
      setHasMoreNotifs(more.length === 10);
    }
  }, [notifFetcher.data]);
  const [resourceType, setResourceType] =
    useState<AuditResourceType>("product");
  const [selectedProduct, setSelectedProduct] = useState<{
    id: string;
    title: string;
    handle: string;
  } | null>(null);
  const [snapshotName, setSnapshotName] = useState("");
  const [targetVisitors, setTargetVisitors] = useState("1000");
  const [manualTitle, setManualTitle] = useState("");
  const [manualHandle, setManualHandle] = useState("");
  const [storeSnapshotName, setStoreSnapshotName] = useState("");
  const [storeSnapshotMode, setStoreSnapshotMode] = useState("HUMAN_VISITORS");
  const [storeSnapshotHumanTarget, setStoreSnapshotHumanTarget] =
    useState("1000");
  const [storeSnapshotVisitTarget, setStoreSnapshotVisitTarget] =
    useState("2500");
  const [storeSnapshotDurationDays, setStoreSnapshotDurationDays] =
    useState("7");

  const isLoading = navigation.state !== "idle";

  const showSetupGuide = !setupGuideDismissed;

  const handleDismissSetup = useCallback(() => {
    const formData = new FormData();
    formData.append("action", "dismissSetup");
    submit(formData, { method: "POST" });
  }, [submit]);

  // Opens the type selection modal first
  const handleOpenPicker = useCallback(() => {
    if (!billingAccess.canCreateNormalSnapshot) {
      window.location.href = "/app/upgrade";
      return;
    }
    setResourceType("product");
    setIsTypeModalOpen(true);
  }, [billingAccess.canCreateNormalSnapshot]);

  // After selecting type, open the actual resource picker or manual input
  const handleSelectType = useCallback(async () => {
    setIsTypeModalOpen(false);

    if (resourceType === "homepage") {
      setSelectedProduct(HOMEPAGE_RESOURCE);
      setSnapshotName("");
      setTargetVisitors("1000");
      setIsModalOpen(true);
      return;
    }

    if (resourceType === "page" || resourceType === "blog") {
      // No Shopify resource picker for pages/blogs — go straight to create modal
      setSelectedProduct(null);
      setSnapshotName("");
      setTargetVisitors("1000");
      setIsModalOpen(true);
      return;
    }

    try {
      const pickerType =
        resourceType === "collection" ? "collection" : "product";
      const selected = await shopify.resourcePicker({
        type: pickerType,
        multiple: false,
        ...(pickerType === "product"
          ? { filter: { variants: false, draft: false } }
          : {}),
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
    const isHomepage = resourceType === "homepage";
    const title = isManual ? manualTitle : selectedProduct?.title;
    const handle = isManual ? manualHandle : selectedProduct?.handle;
    const id = isHomepage
      ? HOMEPAGE_RESOURCE.id
      : isManual
        ? `gid://shopify/${resourceType === "page" ? "Page" : "Blog"}/${manualHandle}`
        : selectedProduct?.id;

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
  }, [
    selectedProduct,
    resourceType,
    snapshotName,
    targetVisitors,
    submit,
    manualTitle,
    manualHandle,
  ]);

  const handleCreateStoreSnapshot = useCallback(() => {
    const formData = new FormData();
    formData.append("action", "create-store-snapshot");
    formData.append("name", storeSnapshotName);
    formData.append("completionMode", storeSnapshotMode);
    formData.append("targetHumanVisitors", storeSnapshotHumanTarget);
    formData.append("targetTotalVisits", storeSnapshotVisitTarget);
    formData.append("durationDays", storeSnapshotDurationDays);
    submit(formData, { method: "POST" });
    setIsStoreSnapshotModalOpen(false);
  }, [
    storeSnapshotDurationDays,
    storeSnapshotHumanTarget,
    storeSnapshotMode,
    storeSnapshotName,
    storeSnapshotVisitTarget,
    submit,
  ]);

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
    setNotifications((prev: any[]) =>
      prev.map((n: any) => ({ ...n, isRead: true })),
    );
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
    const seconds = Math.floor(
      (Date.now() - new Date(dateStr).getTime()) / 1000,
    );
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
    STORE_SNAPSHOT_COMPLETED: "\uD83C\uDFC1",
    HIGH_BOT_TRAFFIC: "\uD83E\uDD16",
  };

  const activeStoreSnapshot = (storeSnapshots as StoreSnapshotListItem[]).find(
    (snapshot) => snapshot.status === "ACTIVE",
  );
  const latestStoreSnapshot = (storeSnapshots as StoreSnapshotListItem[])[0];
  const displayedStoreSnapshot = activeStoreSnapshot || latestStoreSnapshot;

  const announcementMarkup = showSetupGuide ? (
    <Card>
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <BlockStack gap="300">
          <Text variant="headingLg" as="h2">
            Getting Started
          </Text>
          <Text as="p" tone="subdued">
            Create an audit for any supported storefront page and Mouse
            Whisperer will track active visitors, classify traffic quality, and
            surface the page metrics that matter for that audit type.
          </Text>
        </BlockStack>
        <Button variant="plain" onClick={handleDismissSetup}>
          Dismiss
        </Button>
      </div>
    </Card>
  ) : null;

  const storeSnapshotMarkup = (
    <Card>
      <div className="mw-store-snapshot-grid">
        <BlockStack gap="100">
          <Text as="h2" variant="headingLg" fontWeight="semibold">
            Store snapshot
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Whole-store activity and opportunities
          </Text>
        </BlockStack>
        <div>
          <Text as="p" variant="bodySm" tone="subdued">
            Status
          </Text>
          <div style={{ marginTop: 3 }}>
            {activeStoreSnapshot ? (
              <Badge tone="success">1 running</Badge>
            ) : latestStoreSnapshot ? (
              <Badge>Latest ready</Badge>
            ) : (
              <Badge tone="info">Not started</Badge>
            )}
          </div>
        </div>
        <div>
          <Text as="p" variant="bodySm" tone="subdued">
            Captured visits
          </Text>
          <Text as="p" variant="headingMd" fontWeight="semibold">
            {(displayedStoreSnapshot?._count.visits || 0).toLocaleString()}
          </Text>
        </div>
        <div>
          <Text as="p" variant="bodySm" tone="subdued">
            Audit types
          </Text>
          <Text as="p" variant="headingMd" fontWeight="semibold">
            5
          </Text>
        </div>
        <div className="mw-store-snapshot-actions">
          <InlineStack gap="200" blockAlign="center">
            {displayedStoreSnapshot ? (
              <Link
                to={`/app/store-snapshots/${displayedStoreSnapshot.id}`}
                prefetch="render"
                style={{ textDecoration: "none" }}
              >
                <Button>
                  {activeStoreSnapshot ? "Open snapshot" : "View latest"}
                </Button>
              </Link>
            ) : null}
            {!activeStoreSnapshot ? (
              <Button
                variant={latestStoreSnapshot ? undefined : "primary"}
                onClick={() => {
                  if (!billingAccess.canCreateStoreSnapshot) {
                    window.location.href = "/app/upgrade";
                    return;
                  }
                  setIsStoreSnapshotModalOpen(true);
                }}
              >
                {!billingAccess.canCreateStoreSnapshot
                  ? "Upgrade to start"
                  : latestStoreSnapshot
                    ? "Start new"
                    : "Start snapshot"}
              </Button>
            ) : null}
          </InlineStack>
        </div>
      </div>
    </Card>
  );

  const bellActivator = (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        cursor: "pointer",
        padding: 8,
      }}
      onClick={() => setBellOpen((o) => !o)}
      role="button"
      tabIndex={0}
    >
      <svg
        viewBox="0 0 20 20"
        width="24"
        height="24"
        fill="currentColor"
        style={{ color: "var(--p-color-icon)" }}
      >
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

  const dashboardHeaderActions = (
    <InlineStack gap="200" blockAlign="center" wrap={false}>
      <Button url="/app/upgrade" size="slim">
        {planUsagePillLabel(billingAccess, "normalSnapshots")}
      </Button>
      {COMMUNITY_FEATURES_ENABLED && (
        <Link
          to="/app/challenges/profile?returnTo=/app"
          style={{
            display: "inline-flex",
            padding: 8,
            cursor: "pointer",
            textDecoration: "none",
          }}
        >
          <svg
            viewBox="0 0 20 20"
            width="24"
            height="24"
            fill="currentColor"
            style={{ color: "var(--p-color-icon)" }}
          >
            <path d="M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0-6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 13H4a1 1 0 0 1-1-1v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1a1 1 0 0 1-1 1zm-1-2a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3h10z" />
          </svg>
        </Link>
      )}
      <Popover
        active={bellOpen}
        activator={bellActivator}
        onClose={() => setBellOpen(false)}
        preferredAlignment="right"
        fluidContent
      >
        <div
          style={{
            width: 360,
            maxHeight: 480,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              borderBottom: "1px solid var(--p-color-border-subdued)",
            }}
          >
            <Text as="h3" variant="headingSm">
              Notifications
            </Text>
            {unreadCount > 0 && (
              <Button variant="plain" onClick={handleMarkAllRead}>
                Mark all as read
              </Button>
            )}
          </div>

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
                  onClick={() =>
                    notif.linkUrl
                      ? handleMarkRead(notif.id, notif.linkUrl)
                      : undefined
                  }
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: "10px 16px",
                    cursor: notif.linkUrl ? "pointer" : "default",
                    background: notif.isRead
                      ? "transparent"
                      : "var(--p-color-bg-surface-secondary)",
                    borderBottom: "1px solid var(--p-color-border-subdued)",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(event) => {
                    if (notif.linkUrl) {
                      event.currentTarget.style.background =
                        "var(--p-color-bg-surface-hover)";
                    }
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = notif.isRead
                      ? "transparent"
                      : "var(--p-color-bg-surface-secondary)";
                  }}
                >
                  <span style={{ fontSize: 20, flexShrink: 0 }}>
                    {notifEmoji[notif.type] || "\uD83D\uDD14"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      as="p"
                      variant="bodySm"
                      fontWeight={notif.isRead ? "regular" : "semibold"}
                    >
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
                      onClick={(event) => {
                        event.stopPropagation();
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
    </InlineStack>
  );

  return (
    <Page
      title="Dashboard"
      secondaryActions={dashboardHeaderActions}
      primaryAction={{
        content: billingAccess.canCreateNormalSnapshot
          ? "Create New Audit"
          : "Upgrade to create audit",
        onAction: handleOpenPicker,
        loading: isLoading,
      }}
    >
      <TitleBar title="Dashboard">
        <button
          variant="primary"
          onClick={handleOpenPicker}
          disabled={isLoading}
        >
          {billingAccess.canCreateNormalSnapshot
            ? "Create New Audit"
            : "Upgrade to create audit"}
        </button>
      </TitleBar>
      <style>{`
        .mw-dashboard-card-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
          align-items: start;
        }
        .mw-dashboard-activity-card {
          min-width: 0;
        }
        .mw-dashboard-card-content {
          min-height: 0;
        }
        .mw-dashboard-kpi-grid {
          min-height: 62px;
        }
        .mw-dashboard-chart-heading {
          min-height: 36px;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }
        .mw-dashboard-preview-list {
          min-height: 108px;
        }
        .mw-dashboard-preview-row {
          min-height: 36px;
          padding: 4px 0;
          display: flex;
          align-items: center;
        }
        .mw-store-snapshot-grid {
          display: grid;
          grid-template-columns: minmax(180px, 1.4fr) repeat(3, minmax(110px, 0.7fr)) auto;
          gap: 20px;
          align-items: center;
        }
        .mw-store-snapshot-actions {
          justify-self: end;
        }
        @media (max-width: 960px) {
          .mw-dashboard-card-grid {
            grid-template-columns: minmax(0, 1fr);
          }
          .mw-store-snapshot-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .mw-store-snapshot-actions {
            grid-column: 1 / -1;
            justify-self: start;
          }
        }
        @media (max-width: 520px) {
          .mw-store-snapshot-grid {
            grid-template-columns: minmax(0, 1fr);
          }
          .mw-store-snapshot-actions {
            grid-column: auto;
          }
        }
      `}</style>
      <BlockStack gap="400">
        <ConversionProgressCard initialData={conversionDashboard} shop={shop} />
        {announcementMarkup}
        {storeSnapshotMarkup}

        {/* Profile Card — horizontal full-width */}
        {COMMUNITY_FEATURES_ENABLED &&
          (profile ? (
            (() => {
              const lvl = getLevel(profile.reputation);
              const badges: {
                label: string;
                emoji: string;
                tone: "success" | "info" | "warning";
              }[] = [];
              if (profile.answersCount >= 5)
                badges.push({
                  label: "Top Contributor",
                  emoji: "\uD83C\uDF1F",
                  tone: "success",
                });
              if (profile.insightsCount >= 3)
                badges.push({
                  label: "Challenge Pioneer",
                  emoji: "\uD83D\uDCA1",
                  tone: "info",
                });
              if (completedCount >= 10)
                badges.push({
                  label: `${completedCount} Audits`,
                  emoji: "\uD83D\uDD25",
                  tone: "warning",
                });
              return (
                <Card>
                  <div
                    style={{ display: "flex", gap: 20, alignItems: "center" }}
                  >
                    <Link
                      to="/app/challenges/profile?returnTo=/app"
                      style={{ textDecoration: "none" }}
                    >
                      <div
                        style={{
                          width: 96,
                          height: 96,
                          borderRadius: 12,
                          background: "#f6f6f7",
                          overflow: "hidden",
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {profile.avatarUrl ? (
                          <img
                            src={profile.avatarUrl}
                            alt="Avatar"
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              imageRendering: "pixelated",
                            }}
                          />
                        ) : (
                          <span style={{ fontSize: "3rem" }}>
                            {profile.avatarEmoji || "\uD83D\uDC2D"}
                          </span>
                        )}
                      </div>
                    </Link>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <BlockStack gap="100">
                        <Text as="p" variant="headingLg" fontWeight="bold">
                          {profile.displayName}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {lvl.title}
                        </Text>
                        {profile.bio && (
                          <Text as="p" variant="bodySm">
                            {profile.bio}
                          </Text>
                        )}
                        {badges.length > 0 && (
                          <InlineStack gap="100" wrap>
                            {badges.map((b) => (
                              <Badge
                                key={b.label}
                                tone={b.tone}
                              >{`${b.emoji} ${b.label}`}</Badge>
                            ))}
                          </InlineStack>
                        )}
                      </BlockStack>
                    </div>
                    <div style={{ flexShrink: 0, textAlign: "right" }}>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Reputation
                      </Text>
                      <Text as="p" variant="headingLg" fontWeight="semibold">
                        {profile.reputation} pts
                      </Text>
                      <div style={{ marginTop: 4 }}>
                        <Badge tone="info">{`LVL ${lvl.level}`}</Badge>
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {lvl.next - profile.reputation} pts to LVL{" "}
                          {lvl.level + 1}
                        </Text>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })()
          ) : (
            <Banner
              title="Set up your community profile"
              tone="info"
              action={{
                content: "Create profile",
                url: "/app/challenges/profile?returnTo=/app",
              }}
            >
              <p>
                Create a display name and avatar to start posting challenges and
                helping fellow merchants.
              </p>
            </Banner>
          ))}
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
                helpText:
                  "Track visitor engagement on a product page (/products/...)",
              },
              {
                label: "Collection page",
                value: "collection",
                helpText:
                  "Track visitor engagement on a collection page (/collections/...)",
              },
              {
                label: "Homepage",
                value: "homepage",
                helpText: "Track visitor engagement on your store homepage (/)",
              },
              {
                label: "Page",
                value: "page",
                helpText:
                  "Track visitor engagement on a custom page (/pages/...)",
              },
              {
                label: "Blog",
                value: "blog",
                helpText:
                  "Track visitor engagement on a blog or blog post (/blogs/...)",
              },
            ]}
            selected={[resourceType]}
            onChange={(value) => setResourceType(value[0] as AuditResourceType)}
          />
        </Modal.Section>
      </Modal>

      <Modal
        open={isStoreSnapshotModalOpen}
        onClose={() => setIsStoreSnapshotModalOpen(false)}
        title="Start store snapshot"
        primaryAction={{
          content: "Start snapshot",
          onAction: handleCreateStoreSnapshot,
          loading: isLoading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setIsStoreSnapshotModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Snapshot name"
              value={storeSnapshotName}
              onChange={setStoreSnapshotName}
              placeholder="e.g., Store baseline"
              autoComplete="off"
            />
            <ChoiceList
              title="Completion rule"
              choices={[
                {
                  label: "Count unique human visitors",
                  value: "HUMAN_VISITORS",
                  helpText:
                    "Best default for page recommendations because bots and unengaged traffic do not control completion.",
                },
                {
                  label: "Count total visits",
                  value: "TOTAL_VISITS",
                  helpText:
                    "Useful when you want a pageview-based scan across the store.",
                },
                {
                  label: "Run for a time window",
                  value: "TIME_WINDOW",
                  helpText:
                    "Useful for campaigns, launches, and weekly or monthly store checks.",
                },
              ]}
              selected={[storeSnapshotMode]}
              onChange={(value) => setStoreSnapshotMode(value[0])}
            />
            {storeSnapshotMode === "HUMAN_VISITORS" && (
              <TextField
                label="Target human visitors"
                type="number"
                value={storeSnapshotHumanTarget}
                onChange={setStoreSnapshotHumanTarget}
                min={25}
                max={billingAccess.limits.maxSnapshotTargetVisitors}
                autoComplete="off"
              />
            )}
            {storeSnapshotMode === "TOTAL_VISITS" && (
              <TextField
                label="Target total visits"
                type="number"
                value={storeSnapshotVisitTarget}
                onChange={setStoreSnapshotVisitTarget}
                min={25}
                max={billingAccess.limits.maxSnapshotTargetVisitors}
                autoComplete="off"
              />
            )}
            {storeSnapshotMode === "TIME_WINDOW" && (
              <TextField
                label="Duration in days"
                type="number"
                value={storeSnapshotDurationDays}
                onChange={setStoreSnapshotDurationDays}
                min={1}
                max={90}
                autoComplete="off"
              />
            )}
            {storeSnapshotMode !== "TIME_WINDOW" ? (
              <TargetLimitText
                max={billingAccess.limits.maxSnapshotTargetVisitors}
              />
            ) : null}
          </FormLayout>
        </Modal.Section>
      </Modal>

      {/* Create Audit Modal */}
      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title={`Create Audit: ${selectedProduct?.title || manualTitle || (resourceType === "homepage" ? "Homepage" : resourceType === "page" ? "Page" : resourceType === "blog" ? "Blog" : "")}`}
        primaryAction={{
          content: "Create Audit",
          onAction: handleCreateProject,
          loading: isLoading,
          disabled:
            !billingAccess.canCreateNormalSnapshot ||
            ((resourceType === "page" || resourceType === "blog") &&
              (!manualTitle || !manualHandle)),
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
                  placeholder={
                    resourceType === "blog"
                      ? "e.g., News Blog"
                      : "e.g., About Us"
                  }
                  helpText="Name for this audit"
                  autoComplete="off"
                />
                <TextField
                  label="URL Handle"
                  value={manualHandle}
                  onChange={setManualHandle}
                  placeholder={
                    resourceType === "blog"
                      ? "e.g., news or news/my-first-post"
                      : "e.g., about-us"
                  }
                  helpText={
                    resourceType === "blog"
                      ? "The blog handle from the URL: /blogs/{handle} or /blogs/{blog}/{post}"
                      : "The page handle from the URL: /pages/{handle}"
                  }
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
              max={billingAccess.limits.maxSnapshotTargetVisitors}
              helpText="Number of real visitors to collect before completing the snapshot"
              autoComplete="off"
            />
            <TargetLimitText
              max={billingAccess.limits.maxSnapshotTargetVisitors}
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
