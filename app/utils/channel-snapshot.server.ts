import { Prisma, type ChannelSnapshot, type VisitorType } from "@prisma/client";
import prisma from "../db.server";
import { getBillingAccess, PlanLimitError } from "./billing.server";
import { createNotification } from "./notifications.server";
import {
  CHANNEL_NAMES,
  CHANNEL_PAGE_SIZE,
  CHANNEL_SESSION_TIMEOUT_MS,
  boundedText,
  buildChannelReport,
  channelPagePath,
  channelPercent,
  readChannelAcquisition,
  summarizeChannelSessions,
  type ChannelReportFilters,
  type ChannelSessionRow,
} from "./channel-report";

export class ChannelSnapshotError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "ChannelSnapshotError";
  }
}

function isUniqueConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function validDate(value: unknown, fallback = new Date()) {
  if (value == null || value === "") return fallback;
  const date =
    value instanceof Date ? value : new Date(value as string | number);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

function boundedNumber(value: unknown, max: number) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(max, Math.round(number)))
    : 0;
}

async function notifyCompleted(snapshot: ChannelSnapshot) {
  await createNotification({
    shop: snapshot.shop,
    type: "SNAPSHOT_COMPLETED",
    title: "Channel snapshot completed",
    message: `“${snapshot.name}” is ready to compare traffic sources.`,
    linkUrl: `/app/channel-snapshots/${snapshot.id}`,
    referenceId: snapshot.id,
  }).catch((error: unknown) =>
    console.warn("Channel snapshot notification failed", error),
  );
}

async function expireChannelSnapshots(shop: string) {
  const expired = await prisma.channelSnapshot.findMany({
    where: {
      shop,
      status: { in: ["ACTIVE", "PAUSED"] },
      endsAt: { lte: new Date() },
    },
  });
  for (const snapshot of expired) {
    const result = await prisma.channelSnapshot.updateMany({
      where: { id: snapshot.id, shop, status: { in: ["ACTIVE", "PAUSED"] } },
      data: { status: "COMPLETED", completedAt: snapshot.endsAt },
    });
    if (result.count) await notifyCompleted(snapshot);
  }
}

const activeChannelLookups = new Map<string, Promise<ChannelSnapshot | null>>();

export async function getActiveChannelSnapshot(shop: string) {
  const pending = activeChannelLookups.get(shop);
  if (pending) return pending;

  // Tracking must not sweep lifecycle records on every heartbeat. Expired
  // captures are finalized by list/report/actions, and the writer independently
  // rechecks status and time under its lock. Share only in-flight lookups: a
  // cached absence could hide a capture started by another server instance.
  const lookup = prisma.channelSnapshot
    .findFirst({
      where: {
        shop,
        status: "ACTIVE",
        OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
      },
    })
    .finally(() => activeChannelLookups.delete(shop));
  activeChannelLookups.set(shop, lookup);
  return lookup;
}

export async function createChannelSnapshot(input: {
  shop: string;
  name?: string | null;
  completionMode?: string;
  targetSessions?: number | null;
  durationDays?: number | null;
}) {
  const mode = input.completionMode || "HUMAN_SESSIONS";
  if (!["HUMAN_SESSIONS", "TOTAL_SESSIONS", "TIME_WINDOW"].includes(mode)) {
    throw new ChannelSnapshotError("Choose a valid completion mode.");
  }
  const name = boundedText(input.name, 120) || "Channel snapshot";
  const target = input.targetSessions ?? 1000;
  const days = input.durationDays ?? 7;
  if (mode === "TIME_WINDOW") {
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      throw new ChannelSnapshotError(
        "Duration must be a whole number between 1 and 90 days.",
      );
    }
  } else if (!Number.isInteger(target) || target < 25 || target > 1_000_000) {
    throw new ChannelSnapshotError(
      "The session target must be a whole number of at least 25.",
    );
  }

  await expireChannelSnapshots(input.shop);
  const access = await getBillingAccess(input.shop);
  if (!access.canCreateNormalSnapshot) {
    throw new PlanLimitError(
      "Your page and channel snapshot allowance is used up. Upgrade to start another snapshot.",
    );
  }
  if (
    mode !== "TIME_WINDOW" &&
    target > access.limits.maxSnapshotTargetVisitors
  ) {
    throw new PlanLimitError(
      `Your plan supports up to ${access.limits.maxSnapshotTargetVisitors.toLocaleString()} sessions per snapshot.`,
    );
  }

  try {
    return await prisma.channelSnapshot.create({
      data: {
        shop: input.shop,
        name,
        completionMode: mode as ChannelSnapshot["completionMode"],
        targetSessions: mode === "TIME_WINDOW" ? null : target,
        durationDays: mode === "TIME_WINDOW" ? days : null,
        endsAt:
          mode === "TIME_WINDOW"
            ? new Date(Date.now() + days * 86_400_000)
            : null,
      },
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw new ChannelSnapshotError(
        "A channel snapshot is already running. Pause or finish it before starting another.",
        409,
      );
    }
    throw error;
  }
}

export async function listChannelSnapshots(shop: string, requestedPage = 1) {
  await expireChannelSnapshots(shop);
  const total = await prisma.channelSnapshot.count({ where: { shop } });
  const pageCount = Math.max(1, Math.ceil(total / CHANNEL_PAGE_SIZE));
  const page = Math.max(
    1,
    Math.min(
      pageCount,
      Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1,
    ),
  );
  const [snapshots, active] = await Promise.all([
    prisma.channelSnapshot.findMany({
      where: { shop },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * CHANNEL_PAGE_SIZE,
      take: CHANNEL_PAGE_SIZE,
      include: { _count: { select: { sessions: true } } },
    }),
    prisma.channelSnapshot.findFirst({
      where: { shop, status: "ACTIVE" },
      select: { id: true },
    }),
  ]);
  return {
    snapshots,
    page,
    pageCount,
    total,
    activeSnapshotId: active?.id || null,
  };
}

async function countCapturedSessions(
  db: Prisma.TransactionClient,
  snapshot: ChannelSnapshot,
) {
  return db.channelSnapshotSession.count({
    where: {
      channelSnapshotId: snapshot.id,
      ...(snapshot.completionMode === "HUMAN_SESSIONS"
        ? {
            visits: {
              some: {
                visitorType: { in: ["REAL", "ZOMBIE"] as VisitorType[] },
              },
            },
          }
        : {}),
    },
  });
}

export async function transitionChannelSnapshot(
  shop: string,
  id: string,
  action: "pause" | "resume" | "complete",
) {
  if (!["pause", "resume", "complete"].includes(action)) {
    throw new ChannelSnapshotError("Invalid snapshot action.");
  }
  await expireChannelSnapshots(shop);
  let newlyCompleted = false;
  try {
    const updated = await prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM "ChannelSnapshot" WHERE id = ${id} AND shop = ${shop} FOR UPDATE`;
      const snapshot = await db.channelSnapshot.findFirst({
        where: { id, shop },
      });
      if (!snapshot)
        throw new ChannelSnapshotError("Channel snapshot not found.", 404);
      if (snapshot.status === "COMPLETED") {
        if (action === "complete") return snapshot;
        throw new ChannelSnapshotError(
          "Completed snapshots cannot be restarted. Start a new snapshot instead.",
          409,
        );
      }
      if (
        (action === "pause" && snapshot.status !== "ACTIVE") ||
        (action === "resume" && snapshot.status !== "PAUSED")
      ) {
        throw new ChannelSnapshotError(
          "This action is not available for the current snapshot status.",
          409,
        );
      }
      const targetReached =
        snapshot.targetSessions != null &&
        (await countCapturedSessions(db, snapshot)) >= snapshot.targetSessions;
      const status =
        action === "complete" || targetReached
          ? "COMPLETED"
          : action === "pause"
            ? "PAUSED"
            : "ACTIVE";
      newlyCompleted = status === "COMPLETED";
      return db.channelSnapshot.update({
        where: { id: snapshot.id },
        data: {
          status,
          ...(status === "COMPLETED" ? { completedAt: new Date() } : {}),
        },
      });
    });
    if (newlyCompleted) await notifyCompleted(updated);
    return updated;
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw new ChannelSnapshotError(
        "Another channel snapshot is active. Pause or finish it before resuming this one.",
        409,
      );
    }
    throw error;
  }
}

export async function trackChannelSnapshotVisit(input: {
  shop: string;
  snapshotId: string;
  sessionId: string;
  pageViewId: string;
  acquisition?: unknown;
  pagePath?: unknown;
  pageUrl?: unknown;
  source?: unknown;
  medium?: unknown;
  campaign?: unknown;
  sourceCategory?: unknown;
  visitorType: VisitorType;
  timeOnPage?: unknown;
  scrollDepth?: unknown;
  startedAt?: unknown;
  addedToCart?: boolean;
}) {
  const trackingSessionId = boundedText(input.sessionId, 160);
  const pageViewId = boundedText(input.pageViewId, 160);
  if (!input.shop || !trackingSessionId || !pageViewId) return false;
  const receivedAt = new Date();
  const startedAt = validDate(input.startedAt, receivedAt);
  if (startedAt.getTime() > receivedAt.getTime() + 60_000) return false;
  const acquisition = readChannelAcquisition(input.acquisition, receivedAt);
  const pagePath = channelPagePath(input.pagePath || input.pageUrl) || "/";
  const result = await prisma.$transaction(async (db) => {
    // Serialize capture with pause/finish and enforce the target without admitting extra sessions.
    await db.$queryRaw`SELECT id FROM "ChannelSnapshot" WHERE id = ${input.snapshotId} AND shop = ${input.shop} FOR UPDATE`;
    const snapshot = await db.channelSnapshot.findFirst({
      where: { id: input.snapshotId, shop: input.shop, status: "ACTIVE" },
    });
    // A queued heartbeat can cross the deadline while waiting for the lock.
    const now = new Date();
    if (!snapshot || startedAt < snapshot.startedAt) return null;
    if (snapshot.endsAt && now >= snapshot.endsAt) return null;

    // Older tracker versions may not send acquisition. Reuse only a recent captured journey;
    // when the first observed page is internal, its original arrival remains Unknown.
    const legacySession = !acquisition
      ? await db.channelSnapshotSession.findFirst({
          where: {
            channelSnapshotId: snapshot.id,
            trackingSessionId,
            lastSeenAt: {
              gte: new Date(now.getTime() - CHANNEL_SESSION_TIMEOUT_MS),
            },
          },
          orderBy: { lastSeenAt: "desc" },
        })
      : null;
    const acquisitionId =
      acquisition?.id ||
      legacySession?.acquisitionId ||
      `legacy_${trackingSessionId}_${Math.floor(now.getTime() / CHANNEL_SESSION_TIMEOUT_MS)}`;
    const acquisitionKey = {
      channelSnapshotId: snapshot.id,
      acquisitionId,
    };
    const previousSession =
      legacySession ||
      (await db.channelSnapshotSession.findUnique({
        where: { channelSnapshotId_acquisitionId: acquisitionKey },
      }));
    if (
      previousSession &&
      previousSession.trackingSessionId !== trackingSessionId
    ) {
      throw new ChannelSnapshotError("Invalid acquisition session.");
    }
    const existing = previousSession
      ? await db.channelSnapshotVisit.findUnique({
          where: {
            sessionId_pageViewId: { sessionId: previousSession.id, pageViewId },
          },
        })
      : null;
    const timeOnPage = boundedNumber(input.timeOnPage, 1_800_000);
    const scrollDepth = boundedNumber(input.scrollDepth, 100);
    // Keep the existing classification contract: only an equally/newer
    // cumulative-time payload may change the page's visitor type.
    const visitorType =
      !existing || timeOnPage >= existing.timeOnPage
        ? input.visitorType
        : existing.visitorType;
    const isHuman = (type: VisitorType | undefined) =>
      type === "REAL" || type === "ZOMBIE";

    let addsTargetSession = false;
    if (snapshot.targetSessions != null) {
      if (snapshot.completionMode === "TOTAL_SESSIONS") {
        addsTargetSession = !previousSession;
      } else if (
        snapshot.completionMode === "HUMAN_SESSIONS" &&
        isHuman(visitorType) &&
        !isHuman(existing?.visitorType)
      ) {
        // A new human page is not a new human session when another page in the
        // journey already qualifies. This indexed EXISTS-style query examines
        // one session, never all captured sessions.
        const previousHumanVisit = previousSession
          ? await db.channelSnapshotVisit.findFirst({
              where: {
                sessionId: previousSession.id,
                visitorType: { in: ["REAL", "ZOMBIE"] },
              },
              select: { id: true },
            })
          : null;
        addsTargetSession = !previousHumanVisit;
      }
    }
    // Unchanged heartbeats cannot increase a target count. Only admissions or
    // first-human promotions need the full count, while the snapshot row lock
    // still serializes them with every writer and pause/complete transition.
    const capturedBefore = addsTargetSession
      ? await countCapturedSessions(db, snapshot)
      : null;
    if (capturedBefore != null && capturedBefore >= snapshot.targetSessions!) {
      return db.channelSnapshot.update({
        where: { id: snapshot.id },
        data: { status: "COMPLETED", completedAt: now },
      });
    }
    const legacyChannel =
      CHANNEL_NAMES.find((name) => name === input.sourceCategory) || "Unknown";
    const session = await db.channelSnapshotSession.upsert({
      where: {
        channelSnapshotId_acquisitionId: acquisitionKey,
      },
      create: {
        channelSnapshotId: snapshot.id,
        acquisitionId,
        trackingSessionId,
        channel: acquisition?.channel || legacyChannel,
        source: acquisition
          ? acquisition.source
          : legacyChannel === "Unknown"
            ? null
            : boundedText(input.source, 160),
        medium: acquisition
          ? acquisition.medium
          : boundedText(input.medium, 160),
        campaign: acquisition
          ? acquisition.campaign
          : boundedText(input.campaign, 240),
        referrer: acquisition?.referrer || null,
        landingPath: acquisition
          ? acquisition.landingPath
          : legacyChannel === "Unknown"
            ? null
            : pagePath,
        acquiredAt: acquisition?.startedAt || null,
        startedAt,
        lastSeenAt: now,
        addedToCart: Boolean(input.addedToCart),
      },
      // Acquisition attribution is immutable for the captured journey.
      update: {
        lastSeenAt: now,
        ...(input.addedToCart ? { addedToCart: true } : {}),
      },
    });
    if (session.trackingSessionId !== trackingSessionId) {
      throw new ChannelSnapshotError("Invalid acquisition session.");
    }
    const visitKey = { sessionId: session.id, pageViewId };
    await db.channelSnapshotVisit.upsert({
      where: { sessionId_pageViewId: visitKey },
      create: {
        ...visitKey,
        pagePath,
        visitorType,
        timeOnPage,
        scrollDepth,
        startedAt,
      },
      update: {
        timeOnPage: Math.max(timeOnPage, existing?.timeOnPage || 0),
        scrollDepth: Math.max(scrollDepth, existing?.scrollDepth || 0),
        visitorType,
      },
    });
    if (
      capturedBefore != null &&
      capturedBefore + 1 >= snapshot.targetSessions!
    ) {
      return db.channelSnapshot.update({
        where: { id: snapshot.id },
        data: { status: "COMPLETED", completedAt: now },
      });
    }
    return snapshot;
  });
  if (result?.status === "COMPLETED") await notifyCompleted(result);
  return result != null;
}

export async function attributeChannelSnapshotEvent(input: {
  shop: string | null;
  sessionId: unknown;
  acquisitionSessionId?: unknown;
  timestamp?: unknown;
  event: "add_to_cart" | "checkout_started" | "conversion";
}) {
  const trackingSessionId = boundedText(input.sessionId, 160);
  if (!input.shop || !trackingSessionId) return 0;
  const acquisitionId = boundedText(input.acquisitionSessionId, 128);
  const timestamp = validDate(input.timestamp);
  if (timestamp.getTime() > Date.now() + 5 * 60_000) return 0;
  const earliest = new Date(
    timestamp.getTime() -
      (input.event === "conversion"
        ? 30 * 86_400_000
        : CHANNEL_SESSION_TIMEOUT_MS),
  );
  const sessions = await prisma.channelSnapshotSession.findMany({
    where: {
      trackingSessionId,
      ...(acquisitionId ? { acquisitionId } : {}),
      channelSnapshot: { shop: input.shop },
      startedAt: { lte: timestamp },
      lastSeenAt: { gte: earliest },
    },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
  });
  // Select the same acquisition BEFORE checking flags. Pixel/webhook retries must
  // not advance to an older unconverted session sharing the seven-day tracking ID.
  const selected = new Map<string, (typeof sessions)[number]>();
  for (const session of sessions) {
    if (!selected.has(session.channelSnapshotId))
      selected.set(session.channelSnapshotId, session);
  }
  for (const session of selected.values()) {
    await prisma.channelSnapshotSession.updateMany({
      where: { id: session.id, channelSnapshot: { shop: input.shop } },
      data:
        input.event === "conversion"
          ? {
              converted: true,
              ...(session.convertedAt ? {} : { convertedAt: timestamp }),
            }
          : input.event === "checkout_started"
            ? {
                checkoutStarted: true,
                ...(session.checkoutStartedAt
                  ? {}
                  : { checkoutStartedAt: timestamp }),
              }
            : { addedToCart: true },
    });
  }
  return selected.size;
}

export async function getChannelSnapshotReport(
  shop: string,
  id: string,
  filters: ChannelReportFilters = {},
) {
  await expireChannelSnapshots(shop);
  const snapshot = await prisma.channelSnapshot.findFirst({
    where: { id, shop },
  });
  if (!snapshot) return null;
  const sessions = await prisma.$queryRaw<ChannelSessionRow[]>`
    SELECT s.id, s.channel, s.source, s.medium, s.campaign,
      s."addedToCart", s."checkoutStarted", s.converted,
      COUNT(v.id)::int AS "pageViews",
      COALESCE(SUM(v."timeOnPage"), 0)::float8 AS "timeOnPage",
      COALESCE(AVG(v."scrollDepth"), 0)::float8 AS "averageScrollDepth",
      CASE
        WHEN BOOL_OR(v."visitorType" = 'REAL') THEN 'REAL'
        WHEN BOOL_OR(v."visitorType" = 'ZOMBIE') THEN 'ZOMBIE'
        WHEN BOOL_OR(v."visitorType" = 'PENDING') THEN 'PENDING'
        WHEN BOOL_OR(v."visitorType" = 'BOT') THEN 'BOT'
        ELSE 'PENDING'
      END AS "visitorType"
    FROM "ChannelSnapshotSession" s
    JOIN "ChannelSnapshot" capture ON capture.id = s."channelSnapshotId" AND capture.shop = ${shop}
    LEFT JOIN "ChannelSnapshotVisit" v ON v."sessionId" = s.id
    WHERE s."channelSnapshotId" = ${id}
    GROUP BY s.id
  `;
  const totals = summarizeChannelSessions(sessions);
  const isTime = snapshot.completionMode === "TIME_WINDOW";
  const current = isTime
    ? Math.max(
        0,
        Math.min(
          (snapshot.endsAt?.getTime() || 0) - snapshot.startedAt.getTime(),
          (snapshot.completedAt?.getTime() || Date.now()) -
            snapshot.startedAt.getTime(),
        ),
      )
    : snapshot.completionMode === "HUMAN_SESSIONS"
      ? totals.humanSessions
      : totals.sessions;
  const target = isTime
    ? (snapshot.endsAt?.getTime() || 0) - snapshot.startedAt.getTime()
    : snapshot.targetSessions;
  return {
    snapshot,
    ...buildChannelReport(sessions, filters),
    progress: {
      label: isTime
        ? `${snapshot.durationDays}-day capture`
        : snapshot.completionMode === "HUMAN_SESSIONS"
          ? "Human sessions captured"
          : "Sessions captured",
      current,
      target,
      percent: Math.min(100, channelPercent(current, target || 0)),
    },
  };
}
