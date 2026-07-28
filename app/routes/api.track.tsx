import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { getClientIP, getGeoData } from "../utils/geo.server";
import {
  isDatacenterIP,
  calculateBotScore,
} from "../utils/datacenter-ips.server";
import { createNotification } from "../utils/notifications.server";
import {
  assignTemplateAbVariant,
  attributeAbTestAddToCart,
  attributeAbTestConversion,
  recordAbTestEngagement,
} from "../utils/ab-tests.server";
import {
  normalizeResourceType,
  trackStoreSnapshotVisit,
  updateStoreSnapshotAddToCart,
  updateStoreSnapshotConversion,
} from "../utils/store-snapshot.server";

// Visitor classification thresholds
const CLASSIFICATION = {
  MIN_TIME_FOR_REAL: 5000, // 5 seconds
  MIN_SCROLL_FOR_ENGAGED: 10, // 10% scroll
  BOT_SIGNAL_THRESHOLD: 2, // Number of bot signals to classify as bot
};

function classifyVisitor(data: {
  timeOnPage: number;
  scrollDepth: number;
  hasMouseMoved: boolean;
  hasScrolled: boolean;
  hasKeyPressed: boolean;
  hasTouched: boolean;
  isWebdriver: boolean;
  suspiciousUA: boolean;
  linearMovement: boolean;
  datacenterIP: boolean;
}): "REAL" | "ZOMBIE" | "BOT" {
  // Count bot signals
  const botSignals = [
    data.isWebdriver,
    data.suspiciousUA,
    !data.hasMouseMoved && !data.hasTouched, // No pointer activity
    data.linearMovement,
    data.datacenterIP, // Traffic from datacenter IPs
  ].filter(Boolean).length;

  // If 2+ bot signals, classify as bot
  if (botSignals >= CLASSIFICATION.BOT_SIGNAL_THRESHOLD) {
    return "BOT";
  }

  // If less than 5 seconds or very low engagement, classify as zombie
  if (data.timeOnPage < CLASSIFICATION.MIN_TIME_FOR_REAL) {
    return "ZOMBIE";
  }

  // If no scroll and no interaction, zombie
  if (
    !data.hasScrolled &&
    !data.hasMouseMoved &&
    !data.hasTouched &&
    !data.hasKeyPressed
  ) {
    return "ZOMBIE";
  }

  // Otherwise, real user
  return "REAL";
}

function normalizeShopDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const shop = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) ? shop : null;
}

function getRequestShop(request: Request): string | null {
  const url = new URL(request.url);
  return normalizeShopDomain(url.searchParams.get("shop"));
}

export const action = async ({ request }: ActionFunctionArgs) => {
  // Only allow POST requests
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  // Enable CORS for storefront requests
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  try {
    // Parse body — read as text first to handle both application/json and text/plain
    const rawBody = await request.text();
    const data = JSON.parse(rawBody);

    // Handle different event types from web pixel
    if (data.eventType) {
      return handlePixelEvent(data, headers, request);
    }

    // Handle engagement tracking from theme extension
    return handleEngagementTrack(data, headers, request);
  } catch (error) {
    console.error("Tracking error:", error);
    return json({ error: "Invalid request" }, { status: 400, headers });
  }
};

// Handle OPTIONS request for CORS preflight
export const loader = async ({ request }: { request: Request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  return json({ error: "Method not allowed" }, { status: 405 });
};

async function handleEngagementTrack(
  data: any,
  headers: Record<string, string>,
  request: Request,
) {
  const {
    sessionId,
    pageViewId,
    shop: clientShop,
    productHandle,
    resourceType, // 'product', 'collection', 'page', 'blog', or 'homepage' (optional, defaults to 'product')
    pagePath,
    pageUrl,
    pageTitle,
    isLandingPage,
    pageOrder,
    source,
    medium,
    campaign,
    referrer,
    sourceCategory,
    timeOnPage,
    scrollDepth,
    mouseMovements,
    keyPresses,
    touchEvents,
    hasMouseMoved,
    hasScrolled,
    hasKeyPressed,
    hasTouched,
    isWebdriver,
    suspiciousUA,
    linearMovement,
    addedToCart,
    addedToCartAt,
    userAgent,
    deviceType,
    startedAt,
    endedAt,
    exitType,
    exitUrl,
    searchQuery,
    appliedFilters,
    sortBy,
    filterInteractions,
    ctaClicks,
    abTestId,
    abVariantId,
  } = data;

  if (!sessionId || (!productHandle && !pagePath && !pageUrl)) {
    return json({ error: "Missing required fields" }, { status: 400, headers });
  }

  // Generate pageViewId server-side if not provided (backward compat with old tracker)
  const resolvedPageViewId =
    pageViewId ||
    "pv_srv_" + Math.random().toString(36).substr(2, 9) + "_" + Date.now();

  // Decode URL-encoded product handle (e.g., %E2%84%A2 -> ™)
  const decodedProductHandle =
    typeof productHandle === "string" && productHandle.length > 0
      ? decodeURIComponent(productHandle)
      : null;

  // Normalize resource type for page-specific audits. Unknown store pages can still be
  // counted by store snapshots below.
  const normalizedResourceType =
    normalizeResourceType(resourceType) ||
    (decodedProductHandle ? "PRODUCT" : null);
  const trackingShop =
    getRequestShop(request) || normalizeShopDomain(clientShop);

  // Cap timeOnPage at 30 minutes (1,800,000ms) server-side as a safety net
  const MAX_TIME_ON_PAGE = 1800000;
  const cappedTimeOnPage = Math.min(timeOnPage || 0, MAX_TIME_ON_PAGE);

  // Find project with an active snapshot for this handle and resource type
  const project =
    decodedProductHandle && normalizedResourceType
      ? await prisma.project.findFirst({
          where: {
            ...(trackingShop ? { shop: trackingShop } : {}),
            productHandle: decodedProductHandle,
            resourceType: normalizedResourceType,
            snapshots: {
              some: {
                status: "ACTIVE",
              },
            },
          },
          include: {
            snapshots: {
              where: { status: "ACTIVE" },
              take: 1, // Only ONE active snapshot allowed per project
              include: {
                _count: {
                  select: { visits: { where: { visitorType: "REAL" } } },
                },
              },
            },
          },
        })
      : null;

  const effectiveShop = trackingShop || project?.shop || null;
  const activeStoreSnapshot = effectiveShop
    ? await prisma.storeSnapshot.findFirst({
        where: { shop: effectiveShop, status: "ACTIVE" },
        select: { id: true },
      })
    : null;

  let activeSnapshot = project?.snapshots[0] || null;

  if (!activeSnapshot && !activeStoreSnapshot && !abTestId) {
    // No active page snapshot, store snapshot, or A/B test engagement for this page.
    return json({ ok: true, tracked: false }, { headers });
  }

  // Get geo data only after we know this request maps to an active audit.
  const clientIP = getClientIP(request);
  const geoData = await getGeoData(clientIP);
  const datacenterCheck = clientIP
    ? isDatacenterIP(clientIP)
    : { isDatacenter: false, provider: null };
  const datacenterIP = datacenterCheck.isDatacenter;

  const botScore = calculateBotScore({
    isWebdriver: isWebdriver || false,
    suspiciousUA: suspiciousUA || false,
    linearMovement: linearMovement || false,
    datacenterIP,
    hasMouseMoved: hasMouseMoved || false,
    hasTouched: hasTouched || false,
    hasScrolled: hasScrolled || false,
    hasKeyPressed: hasKeyPressed || false,
    timeOnPage: cappedTimeOnPage,
  });

  // Check if page snapshot has reached target before writing more page-specific visits.
  if (
    project &&
    activeSnapshot &&
    activeSnapshot._count.visits >= activeSnapshot.targetVisitors
  ) {
    await prisma.snapshot.update({
      where: { id: activeSnapshot.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await createNotification({
      shop: project.shop,
      type: "SNAPSHOT_COMPLETED",
      title: "Snapshot completed!",
      message: `"${project.productTitle}" reached its ${activeSnapshot.targetVisitors} visitor target`,
      linkUrl: `/app/project/${project.id}`,
      referenceId: activeSnapshot.id,
    });
    activeSnapshot = null;
  }

  // Classify visitor (now includes datacenterIP signal)
  const visitorType = classifyVisitor({
    timeOnPage: cappedTimeOnPage,
    scrollDepth: scrollDepth || 0,
    hasMouseMoved: hasMouseMoved || false,
    hasScrolled: hasScrolled || false,
    hasKeyPressed: hasKeyPressed || false,
    hasTouched: hasTouched || false,
    isWebdriver: isWebdriver || false,
    suspiciousUA: suspiciousUA || false,
    linearMovement: linearMovement || false,
    datacenterIP,
  });

  if (activeSnapshot) {
    // Upsert visit record linked to snapshot (not project directly)
    await prisma.visit.upsert({
      where: {
        pageViewId_snapshotId: {
          pageViewId: resolvedPageViewId,
          snapshotId: activeSnapshot.id,
        },
      },
      create: {
        snapshotId: activeSnapshot.id,
        sessionId,
        pageViewId: resolvedPageViewId,
        visitorType,
        source,
        medium,
        campaign,
        referrer,
        sourceCategory,
        timeOnPage: cappedTimeOnPage,
        scrollDepth: scrollDepth || 0,
        mouseMovements: mouseMovements || 0,
        keyPresses: keyPresses || 0,
        touchEvents: touchEvents || 0,
        hasMouseMoved: hasMouseMoved || false,
        hasScrolled: hasScrolled || false,
        hasKeyPressed: hasKeyPressed || false,
        hasTouched: hasTouched || false,
        isWebdriver: isWebdriver || false,
        suspiciousUA: suspiciousUA || false,
        linearMovement: linearMovement || false,
        datacenterIP,
        botScore,
        addedToCart: addedToCart || false,
        addedToCartAt: addedToCartAt ? new Date(addedToCartAt) : null,
        userAgent,
        deviceType,
        startedAt: startedAt ? new Date(startedAt) : new Date(),
        endedAt: endedAt ? new Date(endedAt) : null,
        exitType: exitType || null,
        exitUrl: exitUrl || null,
        // Search & filter tracking
        searchQuery: searchQuery || null,
        appliedFilters: appliedFilters
          ? String(appliedFilters).slice(0, 5000)
          : null,
        sortBy: sortBy || null,
        filterInteractions: filterInteractions || 0,
        ctaClicks: ctaClicks ? String(ctaClicks).slice(0, 10000) : null,
        // Geo-location data
        ipAddress: clientIP,
        country: geoData.country,
        countryCode: geoData.countryCode,
        city: geoData.city,
        region: geoData.region,
        timezone: geoData.timezone,
      },
      update: {
        visitorType,
        timeOnPage: cappedTimeOnPage,
        scrollDepth: scrollDepth || 0,
        mouseMovements: mouseMovements || 0,
        keyPresses: keyPresses || 0,
        touchEvents: touchEvents || 0,
        hasMouseMoved: hasMouseMoved || false,
        hasScrolled: hasScrolled || false,
        hasKeyPressed: hasKeyPressed || false,
        hasTouched: hasTouched || false,
        linearMovement: linearMovement || false,
        datacenterIP,
        botScore,
        // Protect addedToCart — never overwrite true with false
        ...(addedToCart
          ? {
              addedToCart: true,
              addedToCartAt: addedToCartAt
                ? new Date(addedToCartAt)
                : undefined,
            }
          : {}),
        endedAt: endedAt ? new Date(endedAt) : null,
        exitType: exitType || null,
        exitUrl: exitUrl || null,
        // Search & filter tracking (update with latest values)
        searchQuery: searchQuery || undefined,
        appliedFilters: appliedFilters
          ? String(appliedFilters).slice(0, 5000)
          : undefined,
        sortBy: sortBy || undefined,
        filterInteractions: filterInteractions || 0,
        ...(ctaClicks ? { ctaClicks: String(ctaClicks).slice(0, 10000) } : {}),
        // Update geo only if we have new data
        ...(geoData.country && { country: geoData.country }),
        ...(geoData.countryCode && { countryCode: geoData.countryCode }),
        ...(geoData.city && { city: geoData.city }),
        ...(geoData.region && { region: geoData.region }),
        ...(geoData.timezone && { timezone: geoData.timezone }),
      },
    });
  }

  if (activeStoreSnapshot && effectiveShop) {
    await trackStoreSnapshotVisit({
      shop: effectiveShop,
      sessionId,
      pageViewId: resolvedPageViewId,
      visitorType,
      productHandle: decodedProductHandle,
      resourceType: normalizedResourceType,
      pagePath: pagePath || null,
      pageUrl: pageUrl || null,
      pageTitle: pageTitle || null,
      isLandingPage: Boolean(isLandingPage),
      pageOrder:
        typeof pageOrder === "number"
          ? pageOrder
          : Number(pageOrder || 0) || null,
      source,
      medium,
      campaign,
      referrer,
      sourceCategory,
      timeOnPage: cappedTimeOnPage,
      scrollDepth: scrollDepth || 0,
      mouseMovements: mouseMovements || 0,
      keyPresses: keyPresses || 0,
      touchEvents: touchEvents || 0,
      hasMouseMoved: hasMouseMoved || false,
      hasScrolled: hasScrolled || false,
      hasKeyPressed: hasKeyPressed || false,
      hasTouched: hasTouched || false,
      isWebdriver: isWebdriver || false,
      suspiciousUA: suspiciousUA || false,
      linearMovement: linearMovement || false,
      datacenterIP,
      botScore,
      addedToCart: addedToCart || false,
      addedToCartAt: addedToCartAt ? new Date(addedToCartAt) : null,
      userAgent,
      deviceType,
      startedAt: startedAt ? new Date(startedAt) : new Date(),
      endedAt: endedAt ? new Date(endedAt) : null,
      exitType: exitType || null,
      exitUrl: exitUrl || null,
      // Search & filter tracking
      searchQuery: searchQuery || null,
      appliedFilters: appliedFilters
        ? String(appliedFilters).slice(0, 5000)
        : null,
      sortBy: sortBy || null,
      filterInteractions: filterInteractions || 0,
      ctaClicks: ctaClicks ? String(ctaClicks).slice(0, 10000) : null,
      // Geo-location data
      ipAddress: clientIP,
      country: geoData.country,
      countryCode: geoData.countryCode,
      city: geoData.city,
      region: geoData.region,
      timezone: geoData.timezone,
    });
  }

  if (effectiveShop && abTestId) {
    await recordAbTestEngagement({
      shop: effectiveShop,
      sessionId,
      testId: abTestId,
      variantId: abVariantId || null,
      pageViewId: resolvedPageViewId,
      pagePath: pagePath || null,
      pageUrl: pageUrl || null,
      pageTitle: pageTitle || null,
      resourceType: normalizedResourceType,
      resourceHandle: decodedProductHandle,
      isLandingPage: Boolean(isLandingPage),
      pageOrder:
        typeof pageOrder === "number"
          ? pageOrder
          : Number(pageOrder || 0) || null,
      visitorType,
      source,
      medium,
      campaign,
      referrer,
      sourceCategory,
      timeOnPage: cappedTimeOnPage,
      scrollDepth: scrollDepth || 0,
      mouseMovements: mouseMovements || 0,
      keyPresses: keyPresses || 0,
      touchEvents: touchEvents || 0,
      hasMouseMoved: hasMouseMoved || false,
      hasScrolled: hasScrolled || false,
      hasKeyPressed: hasKeyPressed || false,
      hasTouched: hasTouched || false,
      isWebdriver: isWebdriver || false,
      suspiciousUA: suspiciousUA || false,
      linearMovement: linearMovement || false,
      datacenterIP,
      botScore,
      addedToCart: addedToCart || false,
      addedToCartAt: addedToCartAt ? new Date(addedToCartAt) : null,
      userAgent,
      deviceType,
      exitType: exitType || null,
      exitUrl: exitUrl || null,
      searchQuery: searchQuery || null,
      appliedFilters: appliedFilters
        ? String(appliedFilters).slice(0, 5000)
        : null,
      sortBy: sortBy || null,
      filterInteractions: filterInteractions || 0,
      startedAt: startedAt ? new Date(startedAt) : new Date(),
      endedAt: endedAt ? new Date(endedAt) : null,
      ctaClicks: ctaClicks ? String(ctaClicks).slice(0, 10000) : null,
      ipAddress: clientIP,
      country: geoData.country,
      countryCode: geoData.countryCode,
      city: geoData.city,
      region: geoData.region,
      timezone: geoData.timezone,
    });
  }

  // Check again if we've hit the target after a real-user classification.
  if (project && activeSnapshot && visitorType === "REAL") {
    const realCount = await prisma.visit.count({
      where: { snapshotId: activeSnapshot.id, visitorType: "REAL" },
    });

    if (realCount >= activeSnapshot.targetVisitors) {
      await prisma.snapshot.update({
        where: { id: activeSnapshot.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      await createNotification({
        shop: project.shop,
        type: "SNAPSHOT_COMPLETED",
        title: "Snapshot completed!",
        message: `"${project.productTitle}" reached its ${activeSnapshot.targetVisitors} visitor target`,
        linkUrl: `/app/project/${project.id}`,
        referenceId: activeSnapshot.id,
      });
    }
  }

  // High bot traffic alert (once per snapshot, if 20+ visits and >50% bots)
  if (project && activeSnapshot && visitorType === "BOT") {
    const totalVisits = await prisma.visit.count({
      where: { snapshotId: activeSnapshot.id },
    });
    const botCount = await prisma.visit.count({
      where: { snapshotId: activeSnapshot.id, visitorType: "BOT" },
    });
    if (totalVisits >= 20 && botCount / totalVisits > 0.5) {
      await createNotification({
        shop: project.shop,
        type: "HIGH_BOT_TRAFFIC",
        title: "High bot traffic detected",
        message: `${Math.round((botCount / totalVisits) * 100)}% of visits to "${project.productTitle}" are bots`,
        linkUrl: `/app/project/${project.id}`,
        referenceId: activeSnapshot.id,
      });
    }
  }

  return json({ ok: true, tracked: true, visitorType }, { headers });
}

async function handlePixelEvent(
  data: any,
  headers: Record<string, string>,
  request: Request,
) {
  const { eventType, sessionId, timestamp } = data;

  if (!sessionId) {
    console.log(`[MW Pixel] Event "${eventType}" missing sessionId — dropping`);
    return json({ error: "Missing sessionId" }, { status: 400, headers });
  }

  if (eventType === "ab_test_assign") {
    const clientShop = normalizeShopDomain(data.shop);
    const shop = getRequestShop(request) || clientShop;
    if (!shop) {
      return json(
        { ok: true, assigned: false, reason: "missing_shop" },
        { headers },
      );
    }

    const assignment = await assignTemplateAbVariant({
      shop,
      sessionId,
      pagePath: data.pagePath || null,
      pageUrl: data.pageUrl || null,
      pageTitle: data.pageTitle || null,
      resourceType: normalizeResourceType(data.resourceType),
      resourceHandle: data.productHandle || null,
      templateSuffix: data.templateSuffix || null,
      urlAbTestId: data.urlAbTestId || null,
      urlAbVariantKey: data.urlAbVariantKey || null,
    });

    if (!assignment.assigned) {
      return json(
        { ok: true, assigned: false, reason: assignment.reason },
        { headers },
      );
    }

    return json(
      {
        ok: true,
        assigned: true,
        assignmentId: assignment.assignmentId,
        test: {
          id: assignment.test.id,
          name: assignment.test.name,
          targetPageType: assignment.test.targetPageType,
        },
        variant: {
          id: assignment.variant.id,
          key: assignment.variant.key,
          name: assignment.variant.name,
          templateName: assignment.variant.templateName,
          templateSuffix: assignment.variant.templateSuffix,
          isControl: assignment.variant.isControl,
        },
      },
      { headers },
    );
  }

  if (eventType === "add_to_cart") {
    const { productHandle, productId } = data;
    console.log(
      `[MW Pixel] ATC event — session: ${sessionId}, handle: ${productHandle || "null"}, productId: ${productId || "null"}`,
    );

    if (!productHandle) {
      console.log("[MW Pixel] ATC missing productHandle, skipping");
      return json({ ok: true, tracked: false }, { headers });
    }

    const productMatch = buildProductProjectMatch({
      productId,
      productHandle,
    });

    // Find the visit for this product and session, including focused snapshots
    // created from a store snapshot that may still have a legacy synthetic ID.
    const visit = await prisma.visit.findFirst({
      where: {
        sessionId,
        ...(productMatch ? { snapshot: { project: productMatch } } : {}),
      },
      orderBy: { startedAt: "desc" },
    });

    if (visit) {
      await prisma.visit.update({
        where: { id: visit.id },
        data: {
          addedToCart: true,
          addedToCartAt: new Date(timestamp),
        },
      });
      await prisma.snapshotStatsCache
        .deleteMany({ where: { snapshotId: visit.snapshotId } })
        .catch(() => {});
      console.log(`[MW Pixel] ATC tracked for visit ${visit.id}`);
    } else {
      console.log(`[MW Pixel] ATC — no visit found for session ${sessionId}`);
    }

    const storeTracked = await updateStoreSnapshotAddToCart({
      sessionId,
      productHandle,
      timestamp,
    });
    const abTracked = await attributeAbTestAddToCart({
      sessionId,
      productHandle,
      timestamp,
    });

    return json(
      { ok: true, tracked: !!visit || storeTracked || abTracked > 0 },
      { headers },
    );
  }

  if (eventType === "conversion") {
    const { products, orderId, orderNumber } = data;
    const uniqueProducts = deduplicateOrderProducts(products);
    const numericTotal = Number.parseFloat(String(data.totalPrice ?? ""));
    const perProductRevenue =
      Number.isFinite(numericTotal) && uniqueProducts.length > 0
        ? numericTotal / uniqueProducts.length
        : null;
    console.log(
      `[MW Pixel] Conversion event — session: ${sessionId}, order: ${orderNumber || orderId || "unknown"}, products: ${uniqueProducts.length}`,
    );
    console.log(
      `[MW Pixel] Conversion products:`,
      JSON.stringify(uniqueProducts, null, 2),
    );

    let conversionsTracked = 0;

    // Update all visits for products in this order
    for (const product of uniqueProducts) {
      // Match both the real Shopify ID and handle. Store-snapshot-generated
      // focused audits historically used a synthetic ID, so handle matching is
      // required to attribute their conversions correctly.
      const projectMatch = buildProductProjectMatch(product);
      if (!projectMatch) {
        console.log(
          `[MW Pixel] Conversion — product has no ID or handle, skipping:`,
          JSON.stringify(product),
        );
        continue;
      }

      console.log(
        `[MW Pixel] Conversion — matching project with:`,
        JSON.stringify(projectMatch),
      );

      // Tier 1: exact session ID match — prefer the visit where addedToCart happened
      let visit = await prisma.visit.findFirst({
        where: {
          sessionId,
          snapshot: {
            project: projectMatch,
          },
          addedToCart: true,
          converted: false,
        },
        orderBy: { startedAt: "desc" },
      });

      let matchTier = visit ? "session+ATC" : null;

      // Tier 2: exact session match without ATC
      if (!visit) {
        visit = await prisma.visit.findFirst({
          where: {
            sessionId,
            snapshot: {
              project: projectMatch,
            },
            converted: false,
          },
          orderBy: { startedAt: "desc" },
        });
        if (visit) matchTier = "session";
      }

      // No fallback tiers — a missed conversion is better than a false one

      if (visit) {
        // Skip if already converted (dedup pixel + webhook)
        if (visit.converted) {
          console.log(
            `[MW Pixel] Conversion — visit ${visit.id} already converted, skipping`,
          );
          continue;
        }

        await prisma.visit.update({
          where: { id: visit.id },
          data: {
            converted: true,
            convertedAt: new Date(timestamp),
            ...(perProductRevenue != null
              ? { orderValue: perProductRevenue }
              : {}),
            ...(data.currency ? { currency: data.currency } : {}),
          },
        });
        await prisma.snapshotStatsCache
          .deleteMany({ where: { snapshotId: visit.snapshotId } })
          .catch(() => {});
        conversionsTracked++;
        console.log(
          `[MW Pixel] Conversion matched visit ${visit.id} via ${matchTier}`,
        );
      } else {
        console.log(
          `[MW Pixel] Conversion — no session match for project:`,
          JSON.stringify(projectMatch),
        );
      }
    }

    console.log(
      `[MW Pixel] Conversion complete — ${conversionsTracked}/${uniqueProducts.length} tracked`,
    );
    const storeConversionsTracked = await updateStoreSnapshotConversion({
      sessionId,
      timestamp,
      totalPrice: data.totalPrice,
      currency: data.currency,
    });
    const abConversionsTracked = await attributeAbTestConversion({
      sessionId,
      timestamp,
      totalPrice: data.totalPrice,
      currency: data.currency,
    });
    return json(
      {
        ok: true,
        tracked: true,
        conversionsTracked,
        storeConversionsTracked,
        abConversionsTracked,
      },
      { headers },
    );
  }

  if (eventType === "checkout_started") {
    return json({ ok: true, tracked: false }, { headers });
  }

  console.log(`[MW Pixel] Unknown event type: ${eventType}`);
  return json({ ok: true, tracked: false }, { headers });
}

function buildProductProjectMatch(product: {
  productId?: unknown;
  productHandle?: unknown;
}) {
  const matches: Array<Record<string, string>> = [];
  if (typeof product.productId === "string" && product.productId.trim()) {
    matches.push({ productId: product.productId.trim() });
  }
  if (
    typeof product.productHandle === "string" &&
    product.productHandle.trim()
  ) {
    matches.push({
      productHandle: decodeURIComponent(product.productHandle.trim()),
    });
  }

  if (matches.length === 0) return null;
  return matches.length === 1 ? matches[0] : { OR: matches };
}

function deduplicateOrderProducts(value: unknown) {
  if (!Array.isArray(value)) return [];

  const products = new Map<
    string,
    { productId?: string; productHandle?: string }
  >();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const product = item as {
      productId?: unknown;
      productHandle?: unknown;
    };
    const productId =
      typeof product.productId === "string" && product.productId.trim()
        ? product.productId.trim()
        : undefined;
    const productHandle =
      typeof product.productHandle === "string" && product.productHandle.trim()
        ? decodeURIComponent(product.productHandle.trim())
        : undefined;
    const key = productId || productHandle;
    if (!key) continue;
    products.set(key, { productId, productHandle });
  }

  return Array.from(products.values());
}
