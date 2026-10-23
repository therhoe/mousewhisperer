import prisma from "../db.server";
import type { Prisma } from "@prisma/client";
import { journeyPath, journeyText, normalizeJourneySource } from "./customer-journey";

/** The engagement request can finish a target before the independent journey batch arrives. */
async function admitGrowthJourney(
  db: Prisma.TransactionClient,
  storeSnapshotId: string,
  identity: { acquisitionId?: string | null; sessionId: string; pageViewId?: string },
) {
  if (!identity.acquisitionId) return;
  const companion = await db.customerSnapshot.findFirst({
    where: { growthMeasurement: { storeSnapshotId }, status: "ACTIVE", captureAllSources: true },
    select: { id: true },
  });
  if (!companion) return;
  // Same lock order as completion: parent store first, then its companion.
  const locked = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "CustomerSnapshot" WHERE id = ${companion.id} AND status = 'ACTIVE' FOR UPDATE`;
  if (!locked.length) return;
  const visits = await db.storeSnapshotVisit.findMany({
    where: { storeSnapshotId, acquisitionId: identity.acquisitionId, sessionId: identity.sessionId, ...(identity.pageViewId ? { pageViewId: identity.pageViewId } : {}) },
    orderBy: { startedAt: "asc" },
    select: {
      pageViewId: true, pagePath: true, startedAt: true, visitorType: true,
      timeOnPage: true, scrollDepth: true, acquisitionStartedAt: true,
      acquisitionSource: true, acquisitionMedium: true, acquisitionCampaign: true,
    },
  });
  const first = visits[0];
  if (!first) return;
  const session = await db.customerJourneySession.upsert({
    where: { snapshotId_acquisitionId: { snapshotId: companion.id, acquisitionId: identity.acquisitionId } },
    create: {
      snapshotId: companion.id, acquisitionId: identity.acquisitionId,
      trackingSessionId: identity.sessionId,
      source: normalizeJourneySource(first.acquisitionSource),
      medium: journeyText(first.acquisitionMedium), campaign: journeyText(first.acquisitionCampaign, 240),
      landingPath: journeyPath(first.pagePath) || "/",
      startedAt: first.acquisitionStartedAt || first.startedAt, lastSeenAt: new Date(),
      visitorType: first.visitorType,
    },
    update: {},
  });
  if (session.trackingSessionId !== identity.sessionId) return;
  // Only parent-admitted page views are materialized; a delayed batch cannot
  // introduce a fourth acquisition or a new page after the measurement closes.
  for (const visit of visits) {
    const existing = await db.customerJourneyPage.findUnique({ where: { sessionId_pageViewId: { sessionId: session.id, pageViewId: visit.pageViewId } } });
    const latestPageType = !existing || visit.timeOnPage >= existing.timeOnPage ? visit.visitorType : existing.visitorType;
    await db.customerJourneyPage.upsert({
      where: { sessionId_pageViewId: { sessionId: session.id, pageViewId: visit.pageViewId } },
      create: {
        sessionId: session.id, pageViewId: visit.pageViewId,
        pagePath: journeyPath(visit.pagePath) || "/", startedAt: visit.startedAt,
        visitorType: visit.visitorType, timeOnPage: visit.timeOnPage, scrollDepth: visit.scrollDepth,
      },
      update: {
        visitorType: latestPageType,
        timeOnPage: Math.max(existing?.timeOnPage || 0, visit.timeOnPage),
        scrollDepth: Math.max(existing?.scrollDepth || 0, visit.scrollDepth),
      },
    });
  }
  const types = await db.customerJourneyPage.findMany({ where: { sessionId: session.id }, distinct: ["visitorType"], select: { visitorType: true } });
  const bestType = (["REAL", "ZOMBIE", "PENDING", "BOT"] as const).find((type) => types.some((item) => item.visitorType === type));
  await db.customerJourneySession.update({ where: { id: session.id }, data: { visitorType: bestType || first.visitorType, lastSeenAt: new Date() } });
}

export function growthAcquisitionMatch(value: unknown, relation: "snapshot" | "storeSnapshot") {
  const id = typeof value === "string" && /^acq_[a-zA-Z0-9_-]{1,124}$/.test(value) ? value : null;
  // Preserve legacy attribution. A new measurement never credits another
  // acquisition merely because it shares the long-lived browser checkout ID.
  return { OR: [
    { [relation]: { usesAcquisitionSessions: false } },
    ...(id ? [{ acquisitionId: id }] : []),
  ] };
}

/** New measurements count acquisitions once, not repeated page views or a seven-day browser ID. */
export async function countGrowthPageVisitors(snapshotId: string) {
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(DISTINCT COALESCE("acquisitionId", "sessionId"))::int AS count
    FROM "Visit" WHERE "snapshotId" = ${snapshotId} AND "visitorType" IN ('REAL', 'ZOMBIE')
  `;
  return Number(rows[0]?.count || 0);
}

/** Serializes admission and completion only for new Project measurements. */
export async function writeGrowthVisit(
  kind: "page" | "store",
  snapshotId: string,
  visitorType: string,
  write: (db: Prisma.TransactionClient) => Promise<unknown>,
  identity?: { acquisitionId?: string | null; sessionId: string; pageViewId?: string },
) {
  return prisma.$transaction(async (db) => {
    if (kind === "page") await db.$queryRaw`SELECT id FROM "Snapshot" WHERE id = ${snapshotId} FOR UPDATE`;
    else await db.$queryRaw`SELECT id FROM "StoreSnapshot" WHERE id = ${snapshotId} FOR UPDATE`;
    const capture = kind === "page"
      ? await db.snapshot.findUnique({ where: { id: snapshotId } })
      : await db.storeSnapshot.findUnique({ where: { id: snapshotId } });
    if (!capture || !capture.usesAcquisitionSessions || capture.status !== "ACTIVE")
      return { tracked: false, completed: false };
    const expired = Boolean(capture.endsAt && capture.endsAt.getTime() <= Date.now());
    const target = "targetVisitors" in capture ? capture.targetVisitors : capture.targetHumanVisitors;
    const previousPage = !expired && kind === "store" && identity?.pageViewId
      ? await db.storeSnapshotVisit.findUnique({
        where: { pageViewId_storeSnapshotId: { pageViewId: identity.pageViewId, storeSnapshotId: snapshotId } },
        select: { id: true, acquisitionId: true, sessionId: true, visitorType: true },
      })
      : null;
    let recount = !expired && !capture.endsAt && Boolean(target) && ["REAL", "ZOMBIE"].includes(visitorType);
    if (recount && previousPage && previousPage.sessionId === identity?.sessionId && previousPage.acquisitionId === (identity?.acquisitionId || null) && ["REAL", "ZOMBIE"].includes(previousPage.visitorType))
      recount = false;
    if (recount && identity) {
      // Indexed existence check: repeat heartbeats/page views for an already-human
      // acquisition cannot increase the distinct visitor count. Check under the
      // same capture lock so concurrent first admissions still respect the cap.
      const match = identity.acquisitionId
        ? { acquisitionId: identity.acquisitionId }
        : { acquisitionId: null, sessionId: identity.sessionId };
      const existing = kind === "page"
        ? await db.visit.findFirst({ where: { snapshotId, ...match, visitorType: { in: ["REAL", "ZOMBIE"] } }, select: { id: true } })
        : await db.storeSnapshotVisit.findFirst({ where: { storeSnapshotId: snapshotId, ...match, visitorType: { in: ["REAL", "ZOMBIE"] } }, select: { id: true } });
      recount = !existing;
    }
    if (!expired) await write(db);
    // Only new pages or first human admissions need a companion write. This also
    // protects duration captures; repeated heartbeats do not rewrite journeys.
    if (!expired && kind === "store" && identity && (recount || (identity.pageViewId && (!previousPage || previousPage.visitorType !== visitorType))))
      await admitGrowthJourney(db, snapshotId, identity);
    let complete = expired;
    if (recount) {
      const rows = kind === "page"
        ? await db.$queryRaw<Array<{ count: number }>>`SELECT COUNT(DISTINCT COALESCE("acquisitionId", "sessionId"))::int AS count FROM "Visit" WHERE "snapshotId" = ${snapshotId} AND "visitorType" IN ('REAL', 'ZOMBIE')`
        : await db.$queryRaw<Array<{ count: number }>>`SELECT COUNT(DISTINCT COALESCE("acquisitionId", "sessionId"))::int AS count FROM "StoreSnapshotVisit" WHERE "storeSnapshotId" = ${snapshotId} AND "visitorType" IN ('REAL', 'ZOMBIE')`;
      complete = Number(rows[0]?.count || 0) >= target!;
    }
    if (complete) {
      const completedAt = expired ? capture.endsAt! : new Date();
      if (kind === "page") await db.snapshot.update({ where: { id: snapshotId }, data: { status: "COMPLETED", completedAt } });
      else {
        await db.storeSnapshot.update({ where: { id: snapshotId }, data: { status: "COMPLETED", completedAt } });
        await db.customerSnapshot.updateMany({
          where: { growthMeasurement: { storeSnapshotId: snapshotId }, status: { in: ["ACTIVE", "PAUSED"] } },
          data: { status: "COMPLETED", completedAt },
        });
      }
    }
    return { tracked: !expired, completed: complete };
  }, { timeout: 10_000 });
}
