import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";

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
}): "REAL" | "ZOMBIE" | "BOT" {
  // Count bot signals
  const botSignals = [
    data.isWebdriver,
    data.suspiciousUA,
    !data.hasMouseMoved && !data.hasTouched, // No pointer activity
    data.linearMovement,
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
    return handleEngagementTrack(data, headers);
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

async function handleEngagementTrack(data: any, headers: Record<string, string>) {
  const {
    sessionId,
    productHandle,
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
  } = data;

  if (!sessionId || !productHandle) {
    return json({ error: "Missing required fields" }, { status: 400, headers });
  }

  // Find active project for this product handle
  const project = await prisma.project.findFirst({
    where: {
      productHandle,
      status: "ACTIVE",
    },
    include: {
      _count: {
        select: { visits: { where: { visitorType: "REAL" } } },
      },
    },
  });

  if (!project) {
    // No active project for this product
    return json({ ok: true, tracked: false }, { headers });
  }

  // Check if project has reached target
  if (project._count.visits >= project.targetVisitors) {
    await prisma.project.update({
      where: { id: project.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    return json({ ok: true, tracked: false, reason: "completed" }, { headers });
  }

  // Classify visitor
  const visitorType = classifyVisitor({
    timeOnPage: timeOnPage || 0,
    scrollDepth: scrollDepth || 0,
    hasMouseMoved: hasMouseMoved || false,
    hasScrolled: hasScrolled || false,
    hasKeyPressed: hasKeyPressed || false,
    hasTouched: hasTouched || false,
    isWebdriver: isWebdriver || false,
    suspiciousUA: suspiciousUA || false,
    linearMovement: linearMovement || false,
  });

  // Upsert visit record
  await prisma.visit.upsert({
    where: {
      sessionId_projectId: {
        sessionId,
        projectId: project.id,
      },
    },
    create: {
      projectId: project.id,
      sessionId,
      visitorType,
      source,
      medium,
      campaign,
      referrer,
      sourceCategory,
      timeOnPage: timeOnPage || 0,
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
      addedToCart: addedToCart || false,
      addedToCartAt: addedToCartAt ? new Date(addedToCartAt) : null,
      userAgent,
      deviceType,
      startedAt: startedAt ? new Date(startedAt) : new Date(),
      endedAt: endedAt ? new Date(endedAt) : null,
    },
    update: {
      visitorType,
      timeOnPage: timeOnPage || 0,
      scrollDepth: scrollDepth || 0,
      mouseMovements: mouseMovements || 0,
      keyPresses: keyPresses || 0,
      touchEvents: touchEvents || 0,
      hasMouseMoved: hasMouseMoved || false,
      hasScrolled: hasScrolled || false,
      hasKeyPressed: hasKeyPressed || false,
      hasTouched: hasTouched || false,
      linearMovement: linearMovement || false,
      addedToCart: addedToCart || false,
      addedToCartAt: addedToCartAt ? new Date(addedToCartAt) : null,
      endedAt: endedAt ? new Date(endedAt) : null,
    },
  });

  // Check again if we've hit the target after this visit
  const realCount = await prisma.visit.count({
    where: { projectId: project.id, visitorType: "REAL" },
  });

  if (realCount >= project.targetVisitors) {
    await prisma.project.update({
      where: { id: project.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
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

    // Update all visits for products in this order
    for (const product of products || []) {
      if (product.productHandle) {
        const visit = await prisma.visit.findFirst({
          where: {
            sessionId,
            project: { productHandle: product.productHandle },
          },
        });

        if (visit) {
          await prisma.visit.update({
            where: { id: visit.id },
            data: {
              converted: true,
              convertedAt: new Date(timestamp),
            },
          });
        }
      }
    }

    return json({ ok: true, tracked: true }, { headers });
  }

  return json({ ok: true, tracked: false }, { headers });
}
