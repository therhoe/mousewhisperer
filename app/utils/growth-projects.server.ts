import { createHash } from "node:crypto";
import { Prisma, type GrowthProject, type ResourceType } from "@prisma/client";
import prisma from "../db.server";
import { getBillingAccess, PlanLimitError } from "./billing.server";
import { ensureWebPixel } from "./web-pixel.server";
import { resolveSetupPage, savedTrackerState } from "./snapshot-setup.server";
import { cachedValue, clearCacheKey, clearCachePrefix, loaderCacheKeys } from "./loader-cache.server";
import {
  GROWTH_PROJECT_PAGE_SIZE, GrowthProjectError, growthMeasurementStatus,
  growthRequestKey, parseGrowthProjectInput, parseMeasurementInput,
} from "./growth-projects";

export { GrowthProjectError } from "./growth-projects";
type Admin = { graphql: (query: string, options?: any) => Promise<Response> };
type MeasurementInput = ReturnType<typeof parseMeasurementInput>;
type BillingAccess = Awaited<ReturnType<typeof getBillingAccess>>;
const captures = { snapshot: true, storeSnapshot: true, channelSnapshot: true, customerSnapshot: true } as const;
const transactionOptions = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 } as const;

function stableId(shop: string, operation: string, key: string) {
  return `growth_${createHash("sha256").update(`${shop}:${operation}:${key}`).digest("hex").slice(0, 32)}`;
}

function invalidate(shop: string) {
  clearCacheKey(loaderCacheKeys.dashboard(shop));
  clearCacheKey(loaderCacheKeys.billingDisplay(shop));
  clearCachePrefix(loaderCacheKeys.categoryPrefix(shop));
  clearCachePrefix(loaderCacheKeys.categoryFastPrefix(shop));
  clearCacheKey(`growth-expiry:${shop}`);
}

function conflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
    throw new GrowthProjectError("Another capture is starting. Refresh and retry; duplicate measurements will not be created.", 409);
  throw error;
}

async function lockShop(db: Prisma.TransactionClient, shop: string) {
  // Same lock as setup: concurrent tabs cannot spend the same allowance twice.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`snapshot-setup:${shop}`}))`;
}

/** Runs on management reads/actions only, never adds a sweep to tracker heartbeats. */
export async function expireGrowthMeasurements(shop: string, force = false) {
  const key = `growth-expiry:${shop}`;
  if (force) clearCacheKey(key);
  return cachedValue(key, 15_000, () => sweepGrowthMeasurements(shop));
}

async function sweepGrowthMeasurements(shop: string) {
  const now = new Date();
  await prisma.$transaction(async (db) => {
    await db.snapshot.updateMany({
      where: { project: { shop }, status: { in: ["ACTIVE", "PAUSED"] }, endsAt: { lte: now } },
      data: { status: "COMPLETED", completedAt: now },
    });
    await db.storeSnapshot.updateMany({
      where: { shop, status: { in: ["ACTIVE", "PAUSED"] }, endsAt: { lte: now }, growthMeasurement: { isNot: null } },
      data: { status: "COMPLETED", completedAt: now },
    });
    await db.channelSnapshot.updateMany({
      where: { shop, status: { in: ["ACTIVE", "PAUSED"] }, endsAt: { lte: now }, growthMeasurement: { isNot: null } },
      data: { status: "COMPLETED", completedAt: now },
    });
    await db.customerSnapshot.updateMany({
      where: { shop, status: { in: ["ACTIVE", "PAUSED"] }, endsAt: { lte: now }, growthMeasurement: { isNot: null } },
      data: { status: "COMPLETED", completedAt: now },
    });
    // Store capture is authoritative: its optional journey companion cannot keep
    // collecting after its measurement completes, even if completion was legacy UI.
    const companions = await db.growthMeasurement.findMany({
      where: { project: { shop }, storeSnapshot: { status: "COMPLETED" }, customerSnapshot: { status: { in: ["ACTIVE", "PAUSED"] } } },
      select: { customerSnapshotId: true, storeSnapshot: { select: { completedAt: true } } },
    });
    for (const companion of companions) {
      await db.customerSnapshot.updateMany({
        where: { id: companion.customerSnapshotId!, shop },
        data: { status: "COMPLETED", completedAt: companion.storeSnapshot?.completedAt || now },
      });
    }
  }, { timeout: 15_000 });
}

function decorateMeasurement<T extends {
  snapshotId: string | null; storeSnapshotId: string | null; channelSnapshotId: string | null; customerSnapshotId: string | null;
  snapshot: { status: string; projectId: string; createdAt: Date; endsAt: Date | null; completedAt: Date | null } | null;
  storeSnapshot: { status: string; startedAt: Date; endsAt: Date | null; completedAt: Date | null } | null;
  channelSnapshot: { status: string; startedAt: Date; endsAt: Date | null; completedAt: Date | null } | null;
  customerSnapshot: { status: string; startedAt: Date; endsAt: Date | null; completedAt: Date | null } | null;
}>(measurement: T) {
  const capture = measurement.snapshot || measurement.storeSnapshot || measurement.channelSnapshot || measurement.customerSnapshot;
  return {
    ...measurement,
    status: growthMeasurementStatus(measurement),
    startedAt: capture && ("startedAt" in capture ? capture.startedAt : capture.createdAt),
    endsAt: capture?.endsAt || null,
    completedAt: capture?.completedAt || null,
    reportUrl: measurement.snapshot
      ? `/app/project/${measurement.snapshot.projectId}?snapshot=${measurement.snapshotId}`
      : measurement.storeSnapshotId ? `/app/store-snapshots/${measurement.storeSnapshotId}`
      : measurement.channelSnapshotId ? `/app/channel-snapshots/${measurement.channelSnapshotId}`
      : `/app/customer-snapshots/${measurement.customerSnapshotId}`,
    journeyUrl: measurement.customerSnapshotId ? `/app/customer-snapshots/${measurement.customerSnapshotId}` : null,
  };
}

export async function listGrowthProjects(shop: string, requestedPage = 1) {
  await expireGrowthMeasurements(shop);
  const total = await prisma.growthProject.count({ where: { shop } });
  const pageCount = Math.max(1, Math.ceil(total / GROWTH_PROJECT_PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Math.floor(Number(requestedPage) || 1)));
  const rows = await prisma.growthProject.findMany({
    where: { shop }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (page - 1) * GROWTH_PROJECT_PAGE_SIZE, take: GROWTH_PROJECT_PAGE_SIZE,
    include: {
      resourceProject: true,
      _count: { select: { measurements: true, abTests: true } },
      measurements: { take: 1, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: captures },
    },
  });
  return {
    projects: rows.map((row) => ({ ...row, latestMeasurement: row.measurements[0] ? decorateMeasurement(row.measurements[0]) : null })),
    total, page, pageCount,
  };
}

export async function getGrowthProject(shop: string, id: string) {
  const owned = await prisma.growthProject.findFirst({ where: { id, shop }, select: { id: true } });
  if (!owned) throw new GrowthProjectError("Project not found.", 404);
  await expireGrowthMeasurements(shop);
  const project = await prisma.growthProject.findFirst({
    where: { id, shop }, include: {
      resourceProject: true,
      measurements: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: captures },
      abTests: { where: { shop }, orderBy: { createdAt: "desc" }, include: { variants: { orderBy: { key: "asc" } } } },
      activities: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 },
    },
  });
  if (!project) throw new GrowthProjectError("Project not found.", 404);
  return { ...project, measurements: project.measurements.map(decorateMeasurement) };
}

async function checkAllowance(db: Prisma.TransactionClient, project: Pick<GrowthProject, "shop" | "scope" | "journeyTracking">, input: MeasurementInput, access: BillingAccess) {
  if (input.targetVisitors != null && input.targetVisitors > access.limits.maxSnapshotTargetVisitors)
    throw new PlanLimitError(`Your plan supports up to ${access.limits.maxSnapshotTargetVisitors.toLocaleString()} visitors per measurement.`);
  const [stores, pages, channels, customers] = await Promise.all([
    db.storeSnapshot.count({ where: { shop: project.shop } }),
    db.snapshot.count({ where: { project: { shop: project.shop } } }),
    db.channelSnapshot.count({ where: { shop: project.shop } }),
    db.customerSnapshot.count({ where: { shop: project.shop } }),
  ]);
  // Preserve current entitlements: a store capture uses the store allowance;
  // an optional journey companion uses one normal-capture allowance.
  const normalNeeded = project.scope === "PAGE" || project.journeyTracking ? 1 : 0;
  if (pages + channels + customers + normalNeeded > access.limits.normalSnapshots ||
      (project.scope === "STORE" && stores + 1 > access.limits.storeSnapshots))
    throw new PlanLimitError("Your measurement allowance is used up. Upgrade to start another measurement.");
}

async function assertCaptureAvailable(db: Prisma.TransactionClient, project: Pick<GrowthProject, "shop" | "scope" | "resourceProjectId" | "journeyTracking">, except?: { snapshotId?: string | null; storeSnapshotId?: string | null; customerSnapshotId?: string | null }) {
  const activeStore = project.scope === "STORE" && await db.storeSnapshot.findFirst({ where: { shop: project.shop, status: "ACTIVE", ...(except?.storeSnapshotId ? { id: { not: except.storeSnapshotId } } : {}) }, select: { id: true } });
  if (activeStore) throw new GrowthProjectError("A store measurement is already running. Pause or complete it first.", 409);
  const activePage = project.scope === "PAGE" && await db.snapshot.findFirst({ where: { projectId: project.resourceProjectId!, project: { shop: project.shop }, status: "ACTIVE", ...(except?.snapshotId ? { id: { not: except.snapshotId } } : {}) }, select: { id: true } });
  if (activePage) throw new GrowthProjectError("This page already has a running measurement. Pause or complete it first.", 409);
  const activeJourney = project.journeyTracking && await db.customerSnapshot.findFirst({ where: { shop: project.shop, status: "ACTIVE", ...(except?.customerSnapshotId ? { id: { not: except.customerSnapshotId } } : {}) }, select: { id: true } });
  if (activeJourney) throw new GrowthProjectError("A journey capture is already running. Pause or complete it first.", 409);
}

async function insertMeasurement(db: Prisma.TransactionClient, project: GrowthProject, id: string, input: MeasurementInput, access: BillingAccess) {
  await checkAllowance(db, project, input, access);
  await assertCaptureAvailable(db, project);
  // Each ongoing project can have one capture at a time; paused measurements
  // may coexist, but cannot resume while another capture owns the underlying scope.
  const now = new Date();
  const endsAt = input.durationDays == null ? null : new Date(now.getTime() + input.durationDays * 86_400_000);
  let snapshotId: string | null = null;
  let storeSnapshotId: string | null = null;
  let customerSnapshotId: string | null = null;
  if (project.scope === "PAGE") {
    const resource = await db.project.findFirst({ where: { id: project.resourceProjectId!, shop: project.shop } });
    if (!resource) throw new GrowthProjectError("This project's page is unavailable.", 409);
    const latest = await db.snapshot.findFirst({ where: { projectId: resource.id }, orderBy: { number: "desc" }, select: { number: true } });
    const capture = await db.snapshot.create({ data: {
      id: `${id}_page`, projectId: resource.id, name: input.name, number: (latest?.number || 0) + 1,
      targetVisitors: input.targetVisitors ?? 100, endsAt, createdAt: now, usesAcquisitionSessions: true,
    } });
    snapshotId = capture.id;
  } else {
    const capture = await db.storeSnapshot.create({ data: {
      id: `${id}_store`, shop: project.shop, name: input.name, startedAt: now,
      completionMode: input.completionMode === "DURATION" ? "TIME_WINDOW" : "HUMAN_VISITORS",
      targetHumanVisitors: input.targetVisitors, durationDays: input.durationDays, endsAt, usesAcquisitionSessions: true,
    } });
    storeSnapshotId = capture.id;
    if (project.journeyTracking) {
      const journey = await db.customerSnapshot.create({ data: {
        id: `${id}_journey`, shop: project.shop, name: input.name, source: "*", captureAllSources: true,
        // Source/medium/campaign are report defaults, NEVER enrollment filters.
        destinationUrl: `https://${project.shop}/`, targetSessions: null, startedAt: now, endsAt,
      } });
      customerSnapshotId = journey.id;
    }
  }
  await db.growthMeasurement.create({ data: { id, projectId: project.id, ...input, snapshotId, storeSnapshotId, customerSnapshotId } });
  await db.growthProject.update({ where: { id: project.id }, data: { updatedAt: now } });
  return { projectId: project.id, measurementId: id };
}

async function prepareCapture(shop: string, admin: Admin) {
  const [access, tracker] = await Promise.all([getBillingAccess(shop), savedTrackerState(admin)]);
  if (tracker !== "active") throw new GrowthProjectError(
    tracker === "missing"
      ? "Enable Snapshot Tracker in the theme editor, save, then return here."
      : "Tracker activation could not be verified. Save your live theme and retry.",
    409,
  );
  const pixel = await ensureWebPixel(admin, shop);
  if (!pixel.ready) throw new GrowthProjectError("Checkout tracking could not be configured. No measurement was started. Please retry.", 503);
  return access;
}

export async function createGrowthProject(shop: string, admin: Admin, form: FormData, options: { startMeasurement?: boolean } = {}) {
  const input = parseGrowthProjectInput(form);
  // A/B quick-create needs an owned container, not a competing baseline capture.
  // This option is controlled by the authenticated route, never a form flag.
  const measurement = options.startMeasurement === false ? null : parseMeasurementInput(form);
  const key = growthRequestKey(form);
  const projectId = stableId(shop, "project", key);
  const measurementId = stableId(shop, `measurement:${projectId}`, key);
  const existing = await prisma.growthProject.findFirst({ where: { id: projectId, shop }, select: { id: true } });
  if (existing) {
    const existingMeasurement = await prisma.growthMeasurement.findFirst({ where: { id: measurementId, project: { id: projectId, shop } }, select: { id: true } });
    return { projectId, measurementId: existingMeasurement?.id || null };
  }
  const resourceProjectId = String(form.get("resourceProjectId") || "");
  const ownedResource = input.scope === "PAGE" && resourceProjectId
    ? await prisma.project.findFirst({ where: { id: resourceProjectId, shop } }) : null;
  if (input.scope === "PAGE" && resourceProjectId && !ownedResource)
    throw new GrowthProjectError("Page not found.", 404);
  if (ownedResource?.resourceType === "PRODUCT")
    await resolveSetupPage(admin, "PRODUCT", ownedResource.productId, { requirePublishedProduct: true });
  const pageType = String(form.get("pageType") || "") as ResourceType;
  const resolvedPage = input.scope === "PAGE" && !ownedResource
    ? await resolveSetupPage(admin, pageType, String(form.get("pageId") || ""), { requirePublishedProduct: true }) : null;
  if (measurement) await expireGrowthMeasurements(shop, true);
  const access = measurement ? await prepareCapture(shop, admin) : null;
  try {
    const result = await prisma.$transaction(async (db) => {
      await lockShop(db, shop);
      const retry = await db.growthProject.findFirst({ where: { id: projectId, shop }, select: { id: true } });
      if (retry) {
        const existingMeasurement = await db.growthMeasurement.findFirst({ where: { id: measurementId, project: { id: projectId, shop } }, select: { id: true } });
        return { projectId, measurementId: existingMeasurement?.id || null };
      }
      let resource = ownedResource;
      if (resolvedPage) {
        resource = await db.project.findFirst({ where: { shop, productId: resolvedPage.id, resourceType: pageType } });
        if (!resource) resource = await db.project.create({ data: {
          shop, resourceType: pageType, productId: resolvedPage.id, productTitle: resolvedPage.title, productHandle: resolvedPage.handle,
        } });
      }
      const project = await db.growthProject.create({ data: { id: projectId, shop, ...input, resourceProjectId: resource?.id || null } });
      return measurement && access
        ? insertMeasurement(db, project, measurementId, measurement, access)
        : { projectId, measurementId: null };
    }, transactionOptions);
    invalidate(shop);
    return result;
  } catch (error) { return conflict(error); }
}

export async function startGrowthMeasurement(shop: string, admin: Admin, projectId: string, form: FormData) {
  const input = parseMeasurementInput(form);
  const id = stableId(shop, `measurement:${projectId}`, growthRequestKey(form));
  const project = await prisma.growthProject.findFirst({ where: { id: projectId, shop } });
  if (!project) throw new GrowthProjectError("Project not found.", 404);
  const existing = await prisma.growthMeasurement.findFirst({ where: { id, projectId, project: { shop } } });
  if (existing) return { projectId, measurementId: id };
  await expireGrowthMeasurements(shop, true);
  const access = await prepareCapture(shop, admin);
  try {
    const result = await prisma.$transaction(async (db) => {
      await lockShop(db, shop);
      const retry = await db.growthMeasurement.findFirst({ where: { id, projectId, project: { shop } } });
      if (retry) return { projectId, measurementId: id };
      const fresh = await db.growthProject.findFirst({ where: { id: projectId, shop } });
      if (!fresh) throw new GrowthProjectError("Project not found.", 404);
      return insertMeasurement(db, fresh, id, input, access);
    }, transactionOptions);
    invalidate(shop);
    return result;
  } catch (error) { return conflict(error); }
}

export async function transitionGrowthMeasurement(shop: string, projectId: string, measurementId: string, action: string) {
  if (!["pause", "resume", "complete"].includes(action)) throw new GrowthProjectError("Invalid measurement action.");
  const owned = await prisma.growthMeasurement.findFirst({ where: { id: measurementId, projectId, project: { shop } }, select: { id: true } });
  if (!owned) throw new GrowthProjectError("Measurement not found.", 404);
  await expireGrowthMeasurements(shop, true);
  try {
    const result = await prisma.$transaction(async (db) => {
      await lockShop(db, shop);
      const measurement = await db.growthMeasurement.findFirst({ where: { id: measurementId, projectId, project: { shop } }, include: { ...captures, project: true } });
      if (!measurement) throw new GrowthProjectError("Measurement not found.", 404);
      const status = growthMeasurementStatus(measurement);
      if (status === "COMPLETED") {
        if (action === "complete") return { status };
        throw new GrowthProjectError("Completed measurements cannot restart. Start a new measurement in this project.", 409);
      }
      if ((action === "pause" && status !== "ACTIVE") || (action === "resume" && status !== "PAUSED"))
        throw new GrowthProjectError("This action is not available for the measurement's current status.", 409);
      if (action === "resume") {
        // Historical channel/customer imports resume their own original pipeline.
        if (measurement.channelSnapshotId) {
          if (await db.channelSnapshot.findFirst({ where: { shop, status: "ACTIVE", id: { not: measurement.channelSnapshotId } }, select: { id: true } }))
            throw new GrowthProjectError("Another channel capture is active.", 409);
        } else if (measurement.customerSnapshotId && !measurement.storeSnapshotId) {
          if (await db.customerSnapshot.findFirst({ where: { shop, status: "ACTIVE", id: { not: measurement.customerSnapshotId } }, select: { id: true } }))
            throw new GrowthProjectError("Another journey capture is active.", 409);
        } else await assertCaptureAvailable(db, measurement.project, measurement);
      }
      const nextStatus = action === "pause" ? "PAUSED" : action === "resume" ? "ACTIVE" : "COMPLETED";
      const data = { status: nextStatus as "PAUSED" | "ACTIVE" | "COMPLETED", ...(action === "complete" ? { completedAt: new Date() } : {}) };
      if (measurement.snapshotId) await db.snapshot.updateMany({ where: { id: measurement.snapshotId, project: { shop } }, data });
      if (measurement.storeSnapshotId) await db.storeSnapshot.updateMany({ where: { id: measurement.storeSnapshotId, shop }, data });
      if (measurement.channelSnapshotId) await db.channelSnapshot.updateMany({ where: { id: measurement.channelSnapshotId, shop }, data });
      if (measurement.customerSnapshotId) await db.customerSnapshot.updateMany({ where: { id: measurement.customerSnapshotId, shop }, data });
      await db.growthProject.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
      return { status: nextStatus };
    }, transactionOptions);
    invalidate(shop);
    return result;
  } catch (error) { return conflict(error); }
}

export async function listProjectSources(shop: string) {
  const rows = await prisma.$queryRaw<Array<{ source: string }>>`
    SELECT DISTINCT source FROM (
      SELECT v.source FROM "Visit" v JOIN "Snapshot" s ON s.id = v."snapshotId" JOIN "Project" p ON p.id = s."projectId" WHERE p.shop = ${shop} AND v.source IS NOT NULL
      UNION ALL SELECT v.source FROM "StoreSnapshotVisit" v JOIN "StoreSnapshot" s ON s.id = v."storeSnapshotId" WHERE s.shop = ${shop} AND v.source IS NOT NULL
      UNION ALL SELECT v.source FROM "ChannelSnapshotSession" v JOIN "ChannelSnapshot" s ON s.id = v."channelSnapshotId" WHERE s.shop = ${shop} AND v.source IS NOT NULL
      UNION ALL SELECT v.source FROM "CustomerJourneySession" v JOIN "CustomerSnapshot" s ON s.id = v."snapshotId" WHERE s.shop = ${shop}
    ) sources WHERE source <> '' AND source <> '*' ORDER BY source LIMIT 200
  `;
  return rows.map((row) => row.source);
}
