import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { getClientIP, getGeoData } from "../utils/geo.server";
import { isDatacenterIP, calculateBotScore } from "../utils/datacenter-ips.server";
import { createNotification } from "../utils/notifications.server";

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
  if (!data.hasScrolled && !data.hasMouseMoved && !data.hasTouched && !data.hasKeyPressed) {
    return "ZOMBIE";
  }

  // Otherwise, real user
  return "REAL";
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
    const data = await request.json();

    // Handle different event types from web pixel
    if (data.eventType) {
      return handlePixelEvent(data, headers);
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

async function handleEngagementTrack(data: any, headers: Record<string, string>, request: Request) {
  const {
    sessionId,
    pageViewId,
    productHandle,
    resourceType,  // 'product' or 'collection' (optional, defaults to 'product')
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
  } = data;

  if (!sessionId || !productHandle) {
    return json({ error: "Missing required fields" }, { status: 400, headers });
  }

  // Generate pageViewId server-side if not provided (backward compat with old tracker)
  const resolvedPageViewId = pageViewId || ('pv_srv_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now());

  // Decode URL-encoded product handle (e.g., %E2%84%A2 -> ™)
  const decodedProductHandle = decodeURIComponent(productHandle);

  // Normalize resource type (default to PRODUCT for backwards compatibility)
  const normalizedResourceType = (resourceType || 'product').toUpperCase() as "PRODUCT" | "COLLECTION";

  // Get client IP and geo-location data
  const clientIP = getClientIP(request);
  const geoData = await getGeoData(clientIP);

  // Check if IP belongs to a datacenter
  const datacenterCheck = clientIP ? isDatacenterIP(clientIP) : { isDatacenter: false, provider: null };
  const datacenterIP = datacenterCheck.isDatacenter;

  // Cap timeOnPage at 30 minutes (1,800,000ms) server-side as a safety net
  const MAX_TIME_ON_PAGE = 1800000;
  const cappedTimeOnPage = Math.min(timeOnPage || 0, MAX_TIME_ON_PAGE);

  // Calculate bot score
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

  // Find project with an active snapshot for this handle and resource type
  const project = await prisma.project.findFirst({
    where: {
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
  });

  if (!project || project.snapshots.length === 0) {
    // No active snapshot for this product
    return json({ ok: true, tracked: false }, { headers });
  }

  const activeSnapshot = project.snapshots[0];

  // Check if snapshot has reached target
  if (activeSnapshot._count.visits >= activeSnapshot.targetVisitors) {
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
    return json({ ok: true, tracked: false, reason: "completed" }, { headers });
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
      appliedFilters: appliedFilters ? String(appliedFilters).slice(0, 5000) : null,
      sortBy: sortBy || null,
      filterInteractions: filterInteractions || 0,
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
      ...(addedToCart ? { addedToCart: true, addedToCartAt: addedToCartAt ? new Date(addedToCartAt) : undefined } : {}),
      endedAt: endedAt ? new Date(endedAt) : null,
      exitType: exitType || null,
      exitUrl: exitUrl || null,
      // Search & filter tracking (update with latest values)
      searchQuery: searchQuery || undefined,
      appliedFilters: appliedFilters ? String(appliedFilters).slice(0, 5000) : undefined,
      sortBy: sortBy || undefined,
      filterInteractions: filterInteractions || 0,
      // Update geo only if we have new data
      ...(geoData.country && { country: geoData.country }),
      ...(geoData.countryCode && { countryCode: geoData.countryCode }),
      ...(geoData.city && { city: geoData.city }),
      ...(geoData.region && { region: geoData.region }),
      ...(geoData.timezone && { timezone: geoData.timezone }),
    },
  });

  // Check again if we've hit the target after this visit
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

  // High bot traffic alert (once per snapshot, if 20+ visits and >50% bots)
  const totalVisits = await prisma.visit.count({
    where: { snapshotId: activeSnapshot.id },
  });
  if (totalVisits >= 20) {
    const botCount = await prisma.visit.count({
      where: { snapshotId: activeSnapshot.id, visitorType: "BOT" },
    });
    if (botCount / totalVisits > 0.5) {
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

async function handlePixelEvent(data: any, headers: Record<string, string>) {
  const { eventType, sessionId, timestamp } = data;

  if (!sessionId) {
    return json({ error: "Missing sessionId" }, { status: 400, headers });
  }

  if (eventType === "add_to_cart") {
    const { productHandle } = data;
    if (!productHandle) {
      return json({ ok: true, tracked: false }, { headers });
    }

    // Find visit by session and update
    const visit = await prisma.visit.findFirst({
      where: { sessionId },
    });

    if (visit) {
      await prisma.visit.update({
        where: { id: visit.id },
        data: {
          addedToCart: true,
          addedToCartAt: new Date(timestamp),
        },
      });
    }

    return json({ ok: true, tracked: true }, { headers });
  }

  if (eventType === "conversion") {
    const { products } = data;
    let conversionsTracked = 0;

    // Update all visits for products in this order
    for (const product of products || []) {
      // Build project match condition - try productId first (more reliable), then handle
      const projectMatch: any = {};
      if (product.productId) {
        projectMatch.productId = product.productId;
      } else if (product.productHandle) {
        projectMatch.productHandle = decodeURIComponent(product.productHandle);
      } else {
        // No way to identify the product, skip
        continue;
      }

      // First try: exact session ID match — prefer the visit where addedToCart happened
      let visit = await prisma.visit.findFirst({
        where: {
          sessionId,
          snapshot: {
            project: projectMatch,
          },
          addedToCart: true,
        },
        orderBy: { startedAt: "desc" },
      });

      // If no ATC visit in this session, find most recent visit in this session
      if (!visit) {
        visit = await prisma.visit.findFirst({
          where: {
            sessionId,
            snapshot: {
              project: projectMatch,
            },
          },
          orderBy: { startedAt: "desc" },
        });
      }

      // Fallback: if no exact match, find most recent unconverted visit
      // that added this product to cart in the last 7 days
      if (!visit) {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        visit = await prisma.visit.findFirst({
          where: {
            snapshot: {
              project: projectMatch,
              status: { in: ["ACTIVE", "COMPLETED"] },
            },
            addedToCart: true,
            converted: false,
            startedAt: { gte: sevenDaysAgo },
          },
          orderBy: { startedAt: "desc" }, // Most recent first
        });
      }

      // Second fallback: find any unconverted visit for this product in the last 7 days
      // (even without addedToCart - some conversions happen without ATC detection)
      if (!visit) {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        visit = await prisma.visit.findFirst({
          where: {
            snapshot: {
              project: projectMatch,
              status: { in: ["ACTIVE", "COMPLETED"] },
            },
            converted: false,
            startedAt: { gte: sevenDaysAgo },
          },
          orderBy: { startedAt: "desc" }, // Most recent first
        });
      }

      if (visit) {
        await prisma.visit.update({
          where: { id: visit.id },
          data: {
            converted: true,
            convertedAt: new Date(timestamp),
          },
        });
        conversionsTracked++;
      }
    }

    return json({ ok: true, tracked: true, conversionsTracked }, { headers });
  }

  return json({ ok: true, tracked: false }, { headers });
}
