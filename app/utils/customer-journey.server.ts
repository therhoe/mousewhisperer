import { Prisma, type VisitorType } from "@prisma/client";
import prisma from "../db.server";
import {
  getBillingAccess,
  PlanLimitError,
  clearBillingDisplayCache,
} from "./billing.server";
import { readChannelAcquisition } from "./channel-report";
import {
  JOURNEY_PAGE_SIZE,
  JOURNEY_EVENT_PAGE_SIZE,
  JOURNEY_TIMEOUT,
  JOURNEY_EVENT_LIMIT,
  journeyText,
  journeyPath,
  normalizeJourneySource,
  matchesJourney,
  readJourneyEvents,
  normalizeOrderId,
  validateJourneyDestination,
  type JourneyFilter,
} from "./customer-journey";

export class CustomerSnapshotError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export async function createCustomerSnapshot(
  input: JourneyFilter & {
    shop: string;
    name: string;
    destinationUrl: string;
    durationDays: number;
    targetSessions: number | null;
  },
) {
  const name = journeyText(input.name, 120);
  const source = normalizeJourneySource(input.source);
  if (!name || !source)
    throw new CustomerSnapshotError("Enter a snapshot name and source.");
  if (
    [input.source, input.medium, input.campaign, input.adId].some(
      (value) => value && (!journeyText(value, 240) || /\{\{|\}\}/.test(value)),
    )
  )
    throw new CustomerSnapshotError(
      "Use actual source, campaign, and ad values, without personal data or ad-platform placeholders.",
    );
  let destinationUrl: string;
  try {
    destinationUrl = validateJourneyDestination(
      input.destinationUrl,
    ).toString();
  } catch {
    throw new CustomerSnapshotError("Enter a valid HTTPS storefront URL.");
  }
  if (
    !Number.isInteger(input.durationDays) ||
    input.durationDays < 1 ||
    input.durationDays > 90
  )
    throw new CustomerSnapshotError("Choose a duration between 1 and 90 days.");
  if (
    input.targetSessions !== null &&
    (!Number.isInteger(input.targetSessions) || input.targetSessions < 1)
  )
    throw new CustomerSnapshotError(
      "The session target must be a positive whole number.",
    );
  const access = await getBillingAccess(input.shop);
  if (!access.canCreateNormalSnapshot)
    throw new PlanLimitError(
      "Your snapshot allowance is used up. Upgrade to start another snapshot.",
    );
  if (
    input.targetSessions !== null &&
    input.targetSessions > access.limits.maxSnapshotTargetVisitors
  )
    throw new PlanLimitError(
      `Your plan supports up to ${access.limits.maxSnapshotTargetVisitors.toLocaleString()} sessions per snapshot.`,
    );
  await expireCustomerSnapshots(input.shop);
  try {
    const result = await prisma.customerSnapshot.create({
      data: {
        shop: input.shop,
        name,
        source,
        destinationUrl,
        medium: journeyText(input.medium, 100)?.toLowerCase(),
        campaign: journeyText(input.campaign, 240),
        adId: journeyText(input.adId, 160),
        targetSessions:
          input.targetSessions ?? access.limits.maxSnapshotTargetVisitors,
        endsAt: new Date(Date.now() + input.durationDays * 86_400_000),
      },
    });
    clearBillingDisplayCache(input.shop);
    return result;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new CustomerSnapshotError(
        "A customer snapshot is already active. Pause or finish it first.",
        409,
      );
    throw error;
  }
}

export async function expireCustomerSnapshots(shop: string) {
  const now = new Date();
  await prisma.$transaction(async (db) => {
    // Legacy management pages must respect the same parent→companion lock order.
    await db.storeSnapshot.updateMany({
      where: { shop, status: { in: ["ACTIVE", "PAUSED"] }, endsAt: { lte: now }, growthMeasurement: { customerSnapshotId: { not: null } } },
      data: { status: "COMPLETED", completedAt: now },
    });
    await db.customerSnapshot.updateMany({
      where: { shop, status: { in: ["ACTIVE", "PAUSED"] }, endsAt: { lte: now } },
      data: { status: "COMPLETED", completedAt: now },
    });
  });
}

export async function transitionCustomerSnapshot(
  shop: string,
  id: string,
  action: string,
) {
  if (!["pause", "resume", "complete"].includes(action))
    throw new CustomerSnapshotError("Invalid action.");
  const linked = await prisma.growthMeasurement.findFirst({
    where: { customerSnapshotId: id, storeSnapshotId: { not: null }, project: { shop } },
    select: { id: true, projectId: true },
  });
  if (linked) {
    const { transitionGrowthMeasurement } = await import("./growth-projects.server");
    try {
      return await transitionGrowthMeasurement(shop, linked.projectId, linked.id, action);
    } catch (error) {
      if (error instanceof Error && "status" in error)
        throw new CustomerSnapshotError(error.message, Number(error.status) || 400);
      throw error;
    }
  }
  await expireCustomerSnapshots(shop);
  if (action === "resume") await getBillingAccess(shop);
  try {
    return await prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM "CustomerSnapshot" WHERE id = ${id} AND shop = ${shop} FOR UPDATE`;
      const snapshot = await db.customerSnapshot.findFirst({
        where: { id, shop },
      });
      if (!snapshot)
        throw new CustomerSnapshotError("Snapshot not found.", 404);
      if (snapshot.status === "COMPLETED")
        throw new CustomerSnapshotError(
          "Completed snapshots cannot be restarted.",
        );
      return db.customerSnapshot.update({
        where: { id },
        data: {
          status:
            action === "pause"
              ? "PAUSED"
              : action === "resume"
                ? "ACTIVE"
                : "COMPLETED",
          ...(action === "complete" ? { completedAt: new Date() } : {}),
        },
      });
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new CustomerSnapshotError(
        "Another customer snapshot is active. Pause or finish it first.",
        409,
      );
    throw error;
  }
}

function pageNumber(value: unknown) {
  return Math.max(1, Math.floor(Number(value) || 1));
}

export async function listCustomerSnapshots(
  shop: string,
  requestedPage: unknown,
) {
  await expireCustomerSnapshots(shop);
  const total = await prisma.customerSnapshot.count({ where: { shop } });
  const pageCount = Math.max(1, Math.ceil(total / JOURNEY_PAGE_SIZE));
  const page = Math.min(pageCount, pageNumber(requestedPage));
  const [snapshots, active] = await Promise.all([
    prisma.customerSnapshot.findMany({
      where: { shop },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * JOURNEY_PAGE_SIZE,
      take: JOURNEY_PAGE_SIZE,
      include: { _count: { select: { sessions: true } } },
    }),
    prisma.customerSnapshot.findFirst({
      where: { shop, status: "ACTIVE" },
      select: { id: true },
    }),
  ]);
  return { snapshots, total, page, pageCount, activeId: active?.id };
}

const activeLookups = new Map<string, Promise<{ id: string; growthMeasurement: { storeSnapshotId: string | null } | null } | null>>();
function activeCustomerSnapshot(shop: string) {
  const pending = activeLookups.get(shop);
  if (pending) return pending;
  const lookup = prisma.customerSnapshot
    .findFirst({
      where: { shop, status: "ACTIVE", OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
      select: { id: true, growthMeasurement: { select: { storeSnapshotId: true } } },
    })
    .finally(() => activeLookups.delete(shop));
  activeLookups.set(shop, lookup);
  return lookup;
}

type Batch = {
  enrollmentOnly?: boolean;
  sessionId?: unknown;
  acquisition?: unknown;
  pageViewId?: unknown;
  pagePath?: unknown;
  startedAt?: unknown;
  timeOnPage?: unknown;
  scrollDepth?: unknown;
  events?: unknown;
  truncated?: unknown;
};

/** Drain already-recorded events for an admitted Project page without reopening collection. */
async function recordCompletedGrowthJourneyEvents(
  shop: string,
  acquisitionId: string,
  trackingSessionId: string,
  pageViewId: string | null,
  pagePath: string | null,
  events: ReturnType<typeof readJourneyEvents>,
  adId: string | null,
  now: Date,
) {
  if (!pageViewId || !pagePath) return false;
  const admitted = await prisma.customerJourneySession.findFirst({
    where: {
      acquisitionId, trackingSessionId,
      pages: { some: { pageViewId, pagePath } },
      snapshot: {
        shop,
        OR: [
          { status: "COMPLETED", completedAt: { gte: new Date(now.getTime() - JOURNEY_TIMEOUT) } },
          { status: "ACTIVE", endsAt: { lte: now, gte: new Date(now.getTime() - JOURNEY_TIMEOUT) } },
        ],
        growthMeasurement: { storeSnapshot: {
          usesAcquisitionSessions: true,
          OR: [{ status: "COMPLETED" }, { status: "ACTIVE", endsAt: { lte: now } }],
        } },
      },
    },
    select: { id: true, snapshotId: true },
  });
  if (!admitted) return false;
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM "CustomerSnapshot" WHERE id = ${admitted.snapshotId} AND shop = ${shop} FOR UPDATE`;
    const session = await db.customerJourneySession.findUnique({ where: { id: admitted.id }, include: { snapshot: true } });
    const completedAt = session?.snapshot.completedAt;
    const endsAt = session?.snapshot.endsAt;
    const cutoff = completedAt && (!endsAt || completedAt < endsAt) ? completedAt : endsAt;
    const checkedAt = new Date();
    if (!session || !["ACTIVE", "COMPLETED"].includes(session.snapshot.status) || !cutoff || cutoff > checkedAt || cutoff.getTime() < checkedAt.getTime() - JOURNEY_TIMEOUT)
      return false;
    if (!session.adId && adId) await db.customerJourneySession.update({ where: { id: session.id }, data: { adId } });
    const eligible = events.filter((event) =>
      event.occurredAt >= session.startedAt && event.occurredAt <= cutoff &&
      (!session.snapshot.endsAt || event.occurredAt <= session.snapshot.endsAt) &&
      (!event.pagePath || event.pagePath === pagePath),
    );
    if (!eligible.length) return true;
    const present = await db.customerJourneyEvent.findMany({ where: { sessionId: session.id, eventKey: { in: eligible.map((event) => event.eventKey) } }, select: { eventKey: true } });
    const keys = new Set(present.map((event) => event.eventKey));
    const novel = [...new Map(eligible.filter((event) => !keys.has(event.eventKey)).map((event) => [event.eventKey, event])).values()];
    if (!novel.length) return true;
    const count = await db.customerJourneyEvent.count({ where: { sessionId: session.id } });
    const allowed = novel.slice(0, Math.max(0, JOURNEY_EVENT_LIMIT - count));
    if (allowed.length) await db.customerJourneyEvent.createMany({ data: allowed.map((event) => ({ ...event, sessionId: session.id })), skipDuplicates: true });
    if (allowed.length < novel.length) await db.customerJourneySession.update({ where: { id: session.id }, data: { truncated: true } });
    // No new pages, classification/time changes, or lastSeenAt extension after completion.
    return true;
  });
}

export async function recordCustomerJourney(
  shop: string,
  batch: Batch,
  visitorType: VisitorType,
) {
  const now = new Date();
  const acquisition = readChannelAcquisition(batch.acquisition, now);
  const raw = batch.acquisition as Record<string, unknown> | undefined;
  const trackingSessionId = journeyText(batch.sessionId);
  const pageViewId = journeyText(batch.pageViewId);
  const pagePath = journeyPath(batch.pagePath);
  if (
    !acquisition ||
    !trackingSessionId ||
    !raw ||
    (!batch.enrollmentOnly && (!pageViewId || !pagePath))
  )
    throw new CustomerSnapshotError("Invalid journey batch.");
  const arrival = {
    source: normalizeJourneySource(acquisition.source),
    medium: acquisition.medium,
    campaign: journeyText(raw.campaignId, 240) || acquisition.campaign,
    adId: journeyText(raw.adId),
  };
  const active = await activeCustomerSnapshot(shop);
  // Project filters use the immutable acquisition campaign, not a separate ad
  // platform campaign ID. Standalone customer captures retain their old rules.
  if (active?.growthMeasurement?.storeSnapshotId) arrival.campaign = acquisition.campaign;
  const events = readJourneyEvents(batch.events, acquisition.startedAt, now);
  const finishAdmittedPage = () => batch.enrollmentOnly
    ? Promise.resolve(false)
    : recordCompletedGrowthJourneyEvents(shop, acquisition.id, trackingSessionId, pageViewId, pagePath, events, arrival.adId, new Date());
  if (!active) return { accepted: true, captured: await finishAdmittedPage() };
  const result = await prisma.$transaction(async (db) => {
    const parentId = active.growthMeasurement?.storeSnapshotId;
    if (parentId) await db.$queryRaw`SELECT id FROM "StoreSnapshot" WHERE id = ${parentId} AND shop = ${shop} FOR UPDATE`;
    await db.$queryRaw`SELECT id FROM "CustomerSnapshot" WHERE id = ${active.id} AND shop = ${shop} FOR UPDATE`;
    const admittedAt = new Date();
    const capture = await db.customerSnapshot.findFirst({
      where: {
        id: active.id, shop, status: "ACTIVE",
        AND: [
          { OR: [{ endsAt: null }, { endsAt: { gt: admittedAt } }] },
          // A project journey follows its store measurement, including legacy
          // pause/complete actions, without an extra lookup per heartbeat.
          { OR: [
            { growthMeasurement: { is: null } },
            { growthMeasurement: { storeSnapshotId: null } },
            { growthMeasurement: { storeSnapshot: { status: "ACTIVE", OR: [{ endsAt: null }, { endsAt: { gt: admittedAt } }] } } },
          ] },
        ],
      },
    });
    if (
      !capture ||
      acquisition.startedAt < capture.startedAt ||
      !(
        capture.captureAllSources ||
        matchesJourney(capture, arrival) ||
        matchesJourney(capture, { ...arrival, campaign: acquisition.campaign })
      )
    )
      return false;
    if (parentId && !batch.enrollmentOnly) {
      const admittedPage = await db.storeSnapshotVisit.findFirst({
        where: { storeSnapshotId: parentId, acquisitionId: acquisition.id, sessionId: trackingSessionId, pageViewId: pageViewId! },
        select: { pagePath: true },
      });
      // Do not let a concurrent journey request enroll an acquisition excluded
      // by the parent cap. The existing client retains unacknowledged events.
      if (!admittedPage) return "retry" as const;
      if (journeyPath(admittedPage.pagePath) !== pagePath) return false;
    }
    let session = await db.customerJourneySession.findUnique({
      where: {
        snapshotId_acquisitionId: {
          snapshotId: capture.id,
          acquisitionId: acquisition.id,
        },
      },
    });
    if (session && session.trackingSessionId !== trackingSessionId)
      return false;
    // Enrollment stops at the target, but already admitted journeys can finish.
    if (!session) {
      if (
        capture.targetSessions &&
        (await db.customerJourneySession.count({
          where: { snapshotId: capture.id },
        })) >= capture.targetSessions
      )
        return false;
      session = await db.customerJourneySession.create({
        data: {
          snapshotId: capture.id,
          acquisitionId: acquisition.id,
          trackingSessionId,
          ...arrival,
          landingPath: journeyPath(acquisition.landingPath) || pagePath || "/",
          startedAt: acquisition.startedAt,
          lastSeenAt: now,
        },
      });
    } else if (now.getTime() - session.lastSeenAt.getTime() > JOURNEY_TIMEOUT)
      return false;
    if (batch.enrollmentOnly) return true;
    if (!pageViewId || !pagePath) return false;
    const existingPage = await db.customerJourneyPage.findUnique({
      where: { sessionId_pageViewId: { sessionId: session.id, pageViewId } },
    });
    const timeOnPage = Math.max(
      0,
      Math.min(1_800_000, Number(batch.timeOnPage) || 0),
    );
    const scrollDepth = Math.max(
      0,
      Math.min(100, Number(batch.scrollDepth) || 0),
    );
    const pageStartedAt = new Date(Number(batch.startedAt));
    const page = await db.customerJourneyPage.upsert({
      where: { sessionId_pageViewId: { sessionId: session.id, pageViewId } },
      create: {
        sessionId: session.id,
        pageViewId,
        pagePath,
        visitorType,
        timeOnPage: Math.round(timeOnPage),
        scrollDepth: Math.round(scrollDepth),
        startedAt:
          Number.isFinite(pageStartedAt.getTime()) &&
          pageStartedAt >= acquisition.startedAt &&
          pageStartedAt <= now
            ? pageStartedAt
            : now,
      },
      update: {
        timeOnPage: Math.round(
          Math.max(timeOnPage, existingPage?.timeOnPage || 0),
        ),
        scrollDepth: Math.round(
          Math.max(scrollDepth, existingPage?.scrollDepth || 0),
        ),
        ...(timeOnPage >= (existingPage?.timeOnPage || 0)
          ? { visitorType }
          : {}),
      },
    });
    let droppedEvents = false;
    if (events.length) {
      const present = await db.customerJourneyEvent.findMany({
        where: {
          sessionId: session.id,
          eventKey: { in: events.map((event) => event.eventKey) },
        },
        select: { eventKey: true },
      });
      const presentKeys = new Set(present.map((event) => event.eventKey));
      const novel = [
        ...new Map(
          events
            .filter(
              (event) =>
                !presentKeys.has(event.eventKey) &&
                (!capture.endsAt || event.occurredAt <= capture.endsAt),
            )
            .map((event) => [event.eventKey, event]),
        ).values(),
      ];
      const count = await db.customerJourneyEvent.count({
        where: { sessionId: session.id },
      });
      const allowed = novel.slice(0, Math.max(0, JOURNEY_EVENT_LIMIT - count));
      if (allowed.length)
        await db.customerJourneyEvent.createMany({
          data: allowed.map((event) => ({ ...event, sessionId: session!.id })),
          skipDuplicates: true,
        });
      droppedEvents = novel.length > allowed.length;
    }
    const types = await db.customerJourneyPage.findMany({
      where: { sessionId: session.id },
      distinct: ["visitorType"],
      select: { visitorType: true },
    });
    const bestType = ["REAL", "ZOMBIE", "PENDING", "BOT"].find((type) =>
      types.some((item) => item.visitorType === type),
    ) as VisitorType;
    await db.customerJourneySession.update({
      where: { id: session.id },
      data: {
        visitorType: bestType || page.visitorType,
        ...(!session.adId && arrival.adId ? { adId: arrival.adId } : {}),
        lastSeenAt: now,
        truncated:
          session.truncated || batch.truncated === true || droppedEvents,
      },
    });
    return true;
  });
  if (result === "retry") return { accepted: false, captured: false };
  // The active lookup may have raced the parent capture's final admission.
  return { accepted: true, captured: result || await finishAdmittedPage() };
}

// Commerce requires the exact acquisition + browser ID. Never fall back to the
// latest session: another ad or tab may share the seven-day browser ID.
export async function recordCustomerCommerce(input: {
  acquisition?: unknown;
  shop: string | null;
  sessionId: unknown;
  acquisitionSessionId: unknown;
  eventType: string;
  eventId?: unknown;
  timestamp?: unknown;
  fromPixel?: boolean;
  orderId?: unknown;
  totalPrice?: unknown;
  currency?: unknown;
  productTitle?: unknown;
}) {
  const sid = journeyText(input.sessionId);
  const acquisitionId = journeyText(input.acquisitionSessionId);
  const orderId = normalizeOrderId(input.orderId);
  if (!input.shop || !sid || !acquisitionId) return 0;
  if (
    !["add_to_cart", "cart_removed", "checkout_started", "conversion"].includes(
      input.eventType,
    )
  )
    return 0;
  // Only successful Shopify events, not optimistic button clicks, set outcomes.
  if (!input.fromPixel && input.eventType !== "conversion") return 0;
  const occurredAt = new Date(input.timestamp as string | number | Date);
  if (
    !Number.isFinite(occurredAt.getTime()) ||
    occurredAt.getTime() > Date.now() + 60_000
  )
    return 0;
  const eventKey =
    input.eventType === "conversion" && orderId
      ? `order:${orderId}`
      : journeyText(input.eventId);
  if (!eventKey) return 0;
  const arrival = input.acquisition as Record<string, unknown> | undefined;
  if (input.fromPixel && arrival?.id === acquisitionId) {
    // A quick cart action can beat the first theme heartbeat. Admit its exact
    // arrival without inventing a page view, then let the theme fill the journey.
    await recordCustomerJourney(
      input.shop,
      { sessionId: sid, acquisition: arrival, enrollmentOnly: true },
      "PENDING",
    );
  }
  const sessions = await prisma.customerJourneySession.findMany({
    where: {
      trackingSessionId: sid,
      acquisitionId,
      snapshot: { shop: input.shop },
      startedAt: { lte: occurredAt },
      lastSeenAt: { gte: new Date(occurredAt.getTime() - JOURNEY_TIMEOUT) },
    },
    include: { snapshot: true },
  });
  let tracked = 0;
  for (const session of sessions) {
    const cutoff =
      session.snapshot.completedAt &&
      (!session.snapshot.endsAt || session.snapshot.completedAt < session.snapshot.endsAt)
        ? session.snapshot.completedAt
        : session.snapshot.endsAt;
    if (cutoff && occurredAt > cutoff) continue;
    const recorded = await prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM "CustomerSnapshot" WHERE id = ${session.snapshotId} AND shop = ${input.shop} FOR UPDATE`;
      await db.$queryRaw`SELECT id FROM "CustomerJourneySession" WHERE id = ${session.id} FOR UPDATE`;
      const fresh = await db.customerJourneySession.findUnique({
        where: { id: session.id },
        include: { snapshot: true },
      });
      if (
        !fresh ||
        (fresh.snapshot.completedAt &&
          occurredAt > fresh.snapshot.completedAt) ||
        (fresh.snapshot.endsAt && occurredAt > fresh.snapshot.endsAt)
      )
        return false;
      const amount = Number(input.totalPrice);
      await db.customerJourneyEvent.upsert({
        where: { sessionId_eventKey: { sessionId: session.id, eventKey } },
        create: {
          sessionId: session.id,
          eventKey,
          type: input.eventType,
          occurredAt,
          orderId: input.eventType === "conversion" ? orderId : null,
          label:
            input.eventType === "add_to_cart" ||
            input.eventType === "cart_removed"
              ? journeyText(input.productTitle, 120)
              : null,
          amount:
            input.totalPrice != null && Number.isFinite(amount) && amount >= 0
              ? amount
              : null,
          currency:
            typeof input.currency === "string" &&
            /^[A-Z]{3}$/.test(input.currency)
              ? input.currency
              : null,
        },
        update: {},
      });
      await db.customerJourneySession.update({
        where: { id: session.id },
        data: {
          ...(input.eventType === "add_to_cart" ? { addedToCart: true } : {}),
          ...(input.eventType === "checkout_started"
            ? { checkoutStarted: true }
            : {}),
          ...(input.eventType === "conversion" ? { converted: true } : {}),
          lastSeenAt: new Date(
            Math.max(fresh.lastSeenAt.getTime(), occurredAt.getTime()),
          ),
        },
      });
      return true;
    });
    if (recorded) tracked++;
  }
  return tracked;
}

export async function getCustomerSnapshotReport(
  shop: string,
  id: string,
  requestedPage: unknown,
) {
  await expireCustomerSnapshots(shop);
  const snapshot = await prisma.customerSnapshot.findFirst({
    where: { id, shop },
  });
  if (!snapshot) return null;
  const where = { snapshotId: id, snapshot: { shop } };
  const [totals] = await prisma.$queryRaw<
    Array<{
      total: number;
      humans: number;
      carts: number;
      checkouts: number;
      conversions: number;
    }>
  >`
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE s."visitorType" IN ('REAL', 'ZOMBIE'))::int AS humans,
      COUNT(*) FILTER (WHERE s."visitorType" IN ('REAL', 'ZOMBIE') AND s."addedToCart")::int AS carts,
      COUNT(*) FILTER (WHERE s."visitorType" IN ('REAL', 'ZOMBIE') AND s."checkoutStarted")::int AS checkouts,
      COUNT(*) FILTER (WHERE s."visitorType" IN ('REAL', 'ZOMBIE') AND s.converted)::int AS conversions
    FROM "CustomerJourneySession" s JOIN "CustomerSnapshot" c ON c.id = s."snapshotId"
    WHERE s."snapshotId" = ${id} AND c.shop = ${shop}
  `;
  const { total, humans, carts, checkouts, conversions } = totals;
  const pageCount = Math.max(1, Math.ceil(total / JOURNEY_PAGE_SIZE));
  const page = Math.min(pageCount, pageNumber(requestedPage));
  const sessions = await prisma.customerJourneySession.findMany({
    where,
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * JOURNEY_PAGE_SIZE,
    take: JOURNEY_PAGE_SIZE,
    select: {
      id: true,
      startedAt: true,
      lastSeenAt: true,
      landingPath: true,
      visitorType: true,
      addedToCart: true,
      checkoutStarted: true,
      converted: true,
      truncated: true,
      _count: { select: { pages: true, events: true } },
    },
  });
  return {
    snapshot,
    sessions,
    page,
    pageCount,
    total,
    humans,
    carts,
    checkouts,
    conversions,
  };
}

export async function exportCustomerJourney(
  shop: string,
  snapshotId: string,
  sessionId: string,
) {
  return prisma.customerJourneySession.findFirst({
    where: { id: sessionId, snapshotId, snapshot: { shop } },
    include: {
      pages: { orderBy: [{ startedAt: "asc" }, { id: "asc" }] },
      events: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] },
    },
  });
}

export async function getCustomerJourney(
  shop: string,
  snapshotId: string,
  sessionId: string,
  requestedPage: unknown,
) {
  const session = await prisma.customerJourneySession.findFirst({
    where: { id: sessionId, snapshotId, snapshot: { shop } },
    select: {
      id: true,
      source: true,
      medium: true,
      campaign: true,
      adId: true,
      startedAt: true,
      truncated: true,
      _count: { select: { events: true } },
    },
  });
  if (!session) return null;
  const pageCount = Math.max(
    1,
    Math.ceil(session._count.events / JOURNEY_EVENT_PAGE_SIZE),
  );
  const page = Math.min(pageCount, pageNumber(requestedPage));
  const events = await prisma.customerJourneyEvent.findMany({
    where: { sessionId },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    skip: (page - 1) * JOURNEY_EVENT_PAGE_SIZE,
    take: JOURNEY_EVENT_PAGE_SIZE,
    select: {
      id: true,
      eventKey: true,
      type: true,
      occurredAt: true,
      pagePath: true,
      label: true,
      targetPath: true,
      amount: true,
      currency: true,
    },
  });
  const pages = await prisma.customerJourneyPage.findMany({
    where: {
      sessionId,
      pageViewId: {
        in: events
          .filter((event) => event.type === "page_view")
          .map((event) => event.eventKey.split(":")[0]),
      },
    },
    select: { pageViewId: true, timeOnPage: true, scrollDepth: true },
  });
  return {
    session,
    events: events.map(({ eventKey, ...event }) => ({
      ...event,
      engagement:
        event.type === "page_view"
          ? pages.find((item) => item.pageViewId === eventKey.split(":")[0]) ||
            null
          : null,
    })),
    page,
    pageCount,
  };
}
