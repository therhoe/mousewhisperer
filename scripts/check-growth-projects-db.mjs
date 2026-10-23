// Explicit disposable local PostgreSQL only. Never reads DATABASE_URL/.env.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { PrismaClient } from "@prisma/client";
const url = process.env.GROWTH_TEST_DATABASE_URL;
assert.ok(url && ["localhost", "127.0.0.1"].includes(new URL(url).hostname), "Provide an explicit disposable loopback PostgreSQL database.");
const db = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: "event", level: "query" }] });
let completionCountQueries = 0;
db.$on("query", ({ query }) => { if (query.includes('COUNT(DISTINCT COALESCE("acquisitionId", "sessionId"))')) completionCountQueries++; });
const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const module = { exports: {} };
  const result = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  runInNewContext(result.outputText, { module, exports: module.exports, require: (key) => key in mocks ? mocks[key] : require(key), URL, Date, FormData, Response, Request, console });
  return module.exports;
}
const trackerSource = ts.createSourceFile("tracker.js", readFileSync(new URL("../extensions/tracking-embed/assets/tracker.js", import.meta.url), "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
let flushJourneySource;
function findFlushJourney(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "flushJourney") flushJourneySource = node.getText(trackerSource);
  ts.forEachChild(node, findFlushJourney);
}
findFlushJourney(trackerSource);
assert.ok(flushJourneySource);
async function verifyTrackerAcknowledgement(response) {
  const sandbox = {
    Date, navigator: {}, window: { location: { href: "https://store.test/" } },
    journeyAllowed: () => true, journeyHasPage: true, journeyQueue: [{ id: "queued-event" }],
    journeyLastActivity: Date.now(), journeyLastSend: 0, journeySending: false,
    journeyActiveTime: 1000, journeyTruncated: false,
    CONFIG: { acquisitionTimeout: 30 * 60_000, apiEndpoint: "/apps/api" },
    state: { acquisition: {}, mouseMovements: [] }, persistAcquisition() {},
    acquisitionPayload: () => ({}), journeySafePath: () => "/", isLinearMovement: () => false,
    journeyFetch: async () => ({ ok: true, json: async () => response }),
  };
  runInNewContext(`${flushJourneySource}; flushJourney(false);`, sandbox);
  await new Promise(setImmediate);
  assert.equal(sandbox.journeyQueue.length, response.accepted ? 0 : 1, "The actual tracker retains unacknowledged events and clears them only after acceptance");
}
const pure = load("../app/utils/growth-projects.ts");
const tracking = load("../app/utils/growth-tracking.server.ts", { "../db.server": db, "./customer-journey": load("../app/utils/customer-journey.ts") });
const cache = { cachedValue: async (_key, _ttl, fn) => fn(), clearCacheKey() {}, clearCachePrefix() {}, loaderCacheKeys: { dashboard: () => "", billingDisplay: () => "", categoryPrefix: () => "", categoryFastPrefix: () => "" } };
class PlanLimitError extends Error {}
let trackerState = "active";
const billing = { PlanLimitError, clearBillingDisplayCache() {}, getBillingAccess: async () => ({ limits: { storeSnapshots: 20, normalSnapshots: 50, maxSnapshotTargetVisitors: 1000 } }) };
const server = load("../app/utils/growth-projects.server.ts", {
  "../db.server": db, "./growth-projects": pure, "./billing.server": billing,
  "./web-pixel.server": { ensureWebPixel: async () => ({ ready: true }) },
  "./snapshot-setup.server": { savedTrackerState: async () => trackerState, resolveSetupPage: async (_admin, _type, id) => ({ id, title: "Test product", handle: "test-product" }) },
  "./loader-cache.server": cache,
});
const store = load("../app/utils/store-snapshot.server.ts", {
  "../db.server": db, "./growth-tracking.server": tracking, "./loader-cache.server": cache,
  "./notifications.server": { createNotification: async () => {} },
});
const journey = load("../app/utils/customer-journey.server.ts", {
  "../db.server": db, "./billing.server": billing,
  "./channel-report": load("../app/utils/channel-report.ts"),
  "./customer-journey": load("../app/utils/customer-journey.ts"),
});
const trackApi = load("../app/routes/api.track.tsx", {
  "../db.server": db,
  "../utils/channel-report": load("../app/utils/channel-report.ts"),
  "../utils/growth-tracking.server": tracking,
  "../utils/customer-journey.server": journey,
  "../utils/geo.server": { getClientIP: () => null },
  "../utils/datacenter-ips.server": { isDatacenterIP: () => ({ isDatacenter: false }) },
  "../utils/notifications.server": {}, "../utils/ab-tests.server": {},
  "../utils/store-snapshot.server": store, "../utils/channel-snapshot.server": {},
});
const shop = "growth-db-regression.myshopify.com";
const other = "growth-db-other.myshopify.com";
let authenticatedShop = shop;
const journeysApi = load("../app/routes/api.project-journeys.tsx", {
  "../db.server": db,
  "../shopify.server": { authenticate: { admin: async () => ({ session: { shop: authenticatedShop } }) } },
  "../utils/growth-report": load("../app/utils/growth-report.ts"),
});
const form = (data = {}) => {
  const result = new FormData();
  for (const [key, value] of Object.entries({ title: "Improve growth", goal: "Increase store conversion", scope: "STORE", completionMode: "VISITORS", requestKey: randomUUID(), ...data }))
    if (value != null) result.set(key, String(value));
  return result;
};
async function cleanup() {
  await db.growthProject.deleteMany({ where: { shop: { in: [shop, other] } } });
  await db.project.deleteMany({ where: { shop: { in: [shop, other] } } });
  await db.storeSnapshot.deleteMany({ where: { shop: { in: [shop, other] } } });
  await db.channelSnapshot.deleteMany({ where: { shop: { in: [shop, other] } } });
  await db.customerSnapshot.deleteMany({ where: { shop: { in: [shop, other] } } });
}
try {
  await cleanup();
  trackerState = "missing";
  await assert.rejects(server.createGrowthProject(shop, {}, form()), /Enable Snapshot Tracker/);
  assert.equal(await db.growthProject.count({ where: { shop } }), 0);
  trackerState = "active";
  const request = form({ source: "facebook", medium: "paid", campaign: "sale", journeyTracking: true, targetVisitors: 3 });
  const result = await server.createGrowthProject(shop, {}, request);
  assert.deepEqual(await server.createGrowthProject(shop, {}, request), result);
  let project = await server.getGrowthProject(shop, result.projectId);
  const measurement = project.measurements[0];
  assert.equal(project.defaultSource, "facebook");
  assert.equal(measurement.status, "ACTIVE");
  assert.equal(measurement.customerSnapshot.captureAllSources, true);
  assert.equal(measurement.customerSnapshot.endsAt, null);
  assert.equal(measurement.storeSnapshot.usesAcquisitionSessions, true);
  await assert.rejects(server.createGrowthProject(shop, {}, form()), /already running/);
  assert.equal(await db.growthProject.count({ where: { shop } }), 1);
  await assert.rejects(server.getGrowthProject(other, result.projectId), /not found/);
  await assert.rejects(server.transitionGrowthMeasurement(other, result.projectId, result.measurementId, "complete"), /not found/);
  trackerState = "missing";
  const emptyRequest = form({ targetVisitors: "invalid-unused", durationDays: "invalid-unused" });
  const empty = await server.createGrowthProject(shop, {}, emptyRequest, { startMeasurement: false });
  assert.equal(empty.measurementId, null);
  assert.deepEqual(await server.createGrowthProject(shop, {}, emptyRequest, { startMeasurement: false }), empty);
  assert.equal(await db.growthMeasurement.count({ where: { projectId: empty.projectId } }), 0);
  assert.equal(await db.storeSnapshot.count({ where: { shop } }), 1);
  await db.growthProject.delete({ where: { id: empty.projectId } });
  trackerState = "active";
  const began = new Date(Date.now() - 10_000);
  await db.storeSnapshot.update({ where: { id: measurement.storeSnapshotId }, data: { startedAt: began } });
  await db.customerSnapshot.update({ where: { id: measurement.customerSnapshotId }, data: { startedAt: began } });
  for (const source of ["facebook", "google", "direct"]) {
    await db.storeSnapshotVisit.create({ data: {
      storeSnapshotId: measurement.storeSnapshotId, sessionId: "browser-shared", pageViewId: `pv-${source}`,
      pagePath: "/products/test-product", acquisitionId: `acq_${source}`, visitorType: "PENDING",
    } });
    const accepted = await journey.recordCustomerJourney(shop, {
      sessionId: "browser-shared", pageViewId: `pv-${source}`, pagePath: "/products/test-product", startedAt: Date.now() - 3000,
      acquisition: { id: `acq_${source}`, source, medium: "different", campaign: "not-sale", startedAt: Date.now() - 4000, sourceCategory: "Direct", landingPath: "/" },
      timeOnPage: 2000, scrollDepth: 50,
    }, "REAL");
    assert.equal(accepted.captured, true, "Project default source must never restrict journey collection");
  }
  assert.equal(await db.customerJourneySession.count({ where: { snapshotId: measurement.customerSnapshotId } }), 3);
  const journeyUrl = `https://app.test/api/project-journeys?projectId=${result.projectId}&measurement=${result.measurementId}`;
  const journeys = async (suffix = "") => (await journeysApi.loader({ request: new Request(journeyUrl + suffix) })).json();
  assert.equal((await journeys()).total, 0, "Project's initial medium/campaign are reporting defaults");
  const unfiltered = await journeys("&source=&medium=&campaign=&page=-1");
  assert.equal(unfiltered.total, 3);
  assert.equal(unfiltered.page, 1);
  assert.ok(unfiltered.sessions[0].detailUrl.includes("?journey="));
  assert.equal("trackingSessionId" in unfiltered.sessions[0], false);
  await db.customerJourneySession.updateMany({ where: { snapshotId: measurement.customerSnapshotId, source: "google" }, data: { visitorType: "BOT" } });
  assert.equal((await journeys("&source=&medium=&campaign=&audience=active")).total, 2);
  assert.equal((await journeys("&source=google&medium=&campaign=&audience=active")).total, 0);
  assert.equal((await journeys("&source=GOOGLE&medium=&campaign=")).total, 1);
  authenticatedShop = other;
  await assert.rejects(journeys(), (error) => error.status === 404);
  authenticatedShop = shop;
  await server.transitionGrowthMeasurement(shop, result.projectId, result.measurementId, "pause");
  assert.equal((await db.customerSnapshot.findUnique({ where: { id: measurement.customerSnapshotId } })).status, "PAUSED");
  await server.transitionGrowthMeasurement(shop, result.projectId, result.measurementId, "resume");
  const visit = async (pageViewId, acquisitionId, visitorType = "REAL") => db.storeSnapshotVisit.create({ data: {
    storeSnapshotId: measurement.storeSnapshotId, sessionId: "browser-shared", pageViewId, pagePath: "/products/test-product",
    acquisitionId, acquisitionSource: acquisitionId === "acq_b" ? "google" : "facebook", acquisitionStartedAt: new Date(), visitorType,
  } });
  await visit("a1", "acq_a");
  await visit("a2", "acq_a");
  await visit("b1", "acq_b", "ZOMBIE");
  await visit("bot", "acq_bot", "BOT");
  assert.equal(await store.completeStoreSnapshotIfReady(await db.storeSnapshot.findUnique({ where: { id: measurement.storeSnapshotId } })), false, "Repeated page views and bots cannot meet visitor target");
  await store.attributeStoreSnapshotOrder({ shop, sessionId: "browser-shared", acquisitionSessionId: "acq_b", timestamp: new Date(), totalPrice: 10, currency: "USD" });
  const converted = await db.storeSnapshotVisit.findMany({ where: { storeSnapshotId: measurement.storeSnapshotId, converted: true } });
  assert.equal(converted.length, 1);
  assert.equal(converted[0].acquisitionId, "acq_b", "A purchase must remain with its actual acquisition");
  await store.attributeStoreSnapshotOrder({ shop, sessionId: "browser-shared", acquisitionSessionId: "acq_unknown", timestamp: new Date(), totalPrice: 10 });
  assert.equal(await db.storeSnapshotVisit.count({ where: { storeSnapshotId: measurement.storeSnapshotId, converted: true } }), 1);
  await visit("c1", "acq_c");
  assert.equal(await store.completeStoreSnapshotIfReady(await db.storeSnapshot.findUnique({ where: { id: measurement.storeSnapshotId } })), true);
  assert.equal((await db.customerSnapshot.findUnique({ where: { id: measurement.customerSnapshotId } })).status, "COMPLETED");
  project = await server.getGrowthProject(shop, result.projectId);
  assert.equal(project.measurements[0].status, "COMPLETED");
  const next = await server.startGrowthMeasurement(shop, {}, result.projectId, form({ completionMode: "DURATION", durationDays: 7 }));
  assert.equal(await db.growthMeasurement.count({ where: { projectId: result.projectId } }), 2);
  await server.transitionGrowthMeasurement(shop, result.projectId, next.measurementId, "complete");

  const page = await server.createGrowthProject(shop, {}, form({ scope: "PAGE", pageType: "PRODUCT", pageId: "gid://shopify/Product/987654", targetVisitors: 2 }));
  const capture = (await server.getGrowthProject(shop, page.projectId)).measurements[0];
  for (const [pageViewId, acquisitionId, visitorType] of [["p1", "acq_1", "REAL"], ["p2", "acq_1", "REAL"], ["p3", "acq_2", "ZOMBIE"], ["p4", "acq_bot", "BOT"]])
    await db.visit.create({ data: { snapshotId: capture.snapshotId, sessionId: "browser-shared", pageViewId, acquisitionId, visitorType } });
  assert.equal(await tracking.countGrowthPageVisitors(capture.snapshotId), 2);
  await server.transitionGrowthMeasurement(shop, page.projectId, page.measurementId, "complete");
  const timed = await server.startGrowthMeasurement(shop, {}, page.projectId, form({ completionMode: "DURATION", durationDays: 1 }));
  const timedCapture = await db.growthMeasurement.findUnique({ where: { id: timed.measurementId } });
  await db.snapshot.update({ where: { id: timedCapture.snapshotId }, data: { endsAt: new Date(Date.now() - 1000) } });
  await server.expireGrowthMeasurements(shop, true);
  assert.equal((await db.snapshot.findUnique({ where: { id: timedCapture.snapshotId } })).status, "COMPLETED");
  const heartbeat = await server.startGrowthMeasurement(shop, {}, page.projectId, form({ targetVisitors: 3 }));
  const heartbeatCapture = await db.growthMeasurement.findUnique({ where: { id: heartbeat.measurementId } });
  const writeHeartbeat = (pageViewId, acquisitionId, visitorType) => tracking.writeGrowthVisit("page", heartbeatCapture.snapshotId, visitorType, (tx) => tx.visit.upsert({
    where: { pageViewId_snapshotId: { pageViewId, snapshotId: heartbeatCapture.snapshotId } },
    create: { snapshotId: heartbeatCapture.snapshotId, sessionId: "heartbeat-browser", pageViewId, acquisitionId, visitorType },
    update: { visitorType },
  }), { acquisitionId, sessionId: "heartbeat-browser" });
  const countsBefore = completionCountQueries;
  await writeHeartbeat("heartbeat-1", "acq_heartbeat_1", "REAL");
  assert.equal(completionCountQueries, countsBefore + 1);
  await writeHeartbeat("heartbeat-1", "acq_heartbeat_1", "REAL");
  await writeHeartbeat("heartbeat-2", "acq_heartbeat_1", "ZOMBIE");
  await writeHeartbeat("heartbeat-3", "acq_heartbeat_2", "PENDING");
  assert.equal(completionCountQueries, countsBefore + 1, "Heartbeats and repeat page views avoid full target recounts");
  await writeHeartbeat("heartbeat-3", "acq_heartbeat_2", "REAL");
  assert.equal(completionCountQueries, countsBefore + 2, "First human classification must recount");
  assert.equal((await writeHeartbeat("heartbeat-4", "acq_heartbeat_3", "REAL")).completed, true);
  assert.equal(completionCountQueries, countsBefore + 3);
  const race = await server.startGrowthMeasurement(shop, {}, page.projectId, form({ targetVisitors: 2 }));
  const raceCapture = await db.growthMeasurement.findUnique({ where: { id: race.measurementId } });
  const raceResults = await Promise.all(Array.from({ length: 6 }, (_, index) => tracking.writeGrowthVisit("page", raceCapture.snapshotId, "REAL", (tx) => tx.visit.create({ data: {
    snapshotId: raceCapture.snapshotId, sessionId: "same-browser", pageViewId: `race-${index}`, acquisitionId: `acq_race_${index}`, visitorType: "REAL",
  } }), { acquisitionId: `acq_race_${index}`, sessionId: "same-browser" })));
  assert.equal(raceResults.filter((item) => item.tracked).length, 2, "Concurrent page admissions stop exactly at the visitor target");
  assert.equal(await db.visit.count({ where: { snapshotId: raceCapture.snapshotId } }), 2);
  assert.equal((await db.snapshot.findUnique({ where: { id: raceCapture.snapshotId } })).status, "COMPLETED");
  const storeRace = await server.startGrowthMeasurement(shop, {}, result.projectId, form({ targetVisitors: 3 }));
  const storeRaceCapture = await db.growthMeasurement.findUnique({ where: { id: storeRace.measurementId } });
  const storeRaceStarted = new Date();
  const storeRaceResults = await Promise.all(Array.from({ length: 6 }, (_, index) => tracking.writeGrowthVisit("store", storeRaceCapture.storeSnapshotId, "ZOMBIE", (tx) => tx.storeSnapshotVisit.create({ data: {
    storeSnapshotId: storeRaceCapture.storeSnapshotId, sessionId: "same-browser", pageViewId: `store-race-${index}`, acquisitionId: `acq_store_race_${index}`, pagePath: "/", visitorType: "ZOMBIE",
    acquisitionSource: `source-${index}`, acquisitionStartedAt: storeRaceStarted,
  } }), { acquisitionId: `acq_store_race_${index}`, sessionId: "same-browser" })));
  assert.equal(storeRaceResults.filter((item) => item.tracked).length, 3, "Concurrent store admissions stop exactly at the human target");
  assert.equal(await db.storeSnapshotVisit.count({ where: { storeSnapshotId: storeRaceCapture.storeSnapshotId } }), 3);
  const completedCompanion = await db.customerSnapshot.findUnique({ where: { id: storeRaceCapture.customerSnapshotId } });
  assert.equal(completedCompanion.status, "COMPLETED");
  const completedStore = await db.storeSnapshot.findUnique({ where: { id: storeRaceCapture.storeSnapshotId } });
  assert.equal(completedCompanion.completedAt.getTime(), completedStore.completedAt.getTime());
  const admittedJourneys = await db.customerJourneySession.findMany({ where: { snapshotId: storeRaceCapture.customerSnapshotId }, include: { pages: true } });
  assert.equal(admittedJourneys.length, 3, "Every admitted human, including the target-closing acquisition, has a companion journey");
  assert.ok(admittedJourneys.every((item) => item.pages.length === 1 && item.visitorType === "ZOMBIE"));
  assert.equal(await db.customerJourneyEvent.count({ where: { session: { snapshotId: storeRaceCapture.customerSnapshotId } } }), 0, "Atomic admission never fabricates journey events");
  const admitted = admittedJourneys[0];
  const cutoff = completedCompanion.completedAt.getTime();
  const delayed = {
    sessionId: "same-browser", pageViewId: admitted.pages[0].pageViewId, pagePath: "/",
    acquisition: { id: admitted.acquisitionId, startedAt: storeRaceStarted.getTime(), source: admitted.source, landingPath: "/" },
    timeOnPage: 999999, scrollDepth: 100,
    events: [
      { id: "before-cutoff", type: "page_view", at: storeRaceStarted.getTime(), path: "/" },
      { id: "exact-cutoff", type: "click", at: cutoff, path: "/" },
      { id: "after-cutoff", type: "click", at: cutoff + 1, path: "/" },
      { id: "different-page", type: "click", at: cutoff, path: "/new-page" },
    ],
  };
  assert.equal((await journey.recordCustomerJourney(shop, delayed, "REAL")).captured, true);
  await journey.recordCustomerJourney(shop, delayed, "REAL");
  const drained = await db.customerJourneyEvent.findMany({ where: { sessionId: admitted.id }, orderBy: { eventKey: "asc" } });
  assert.deepEqual(drained.map((event) => event.eventKey), ["before-cutoff", "exact-cutoff"], "Late delivery is inclusive at completion, excludes later/different-page events, and deduplicates retries");
  const afterDrain = await db.customerJourneySession.findUnique({ where: { id: admitted.id }, include: { pages: true } });
  assert.equal(afterDrain.visitorType, admitted.visitorType, "Post-completion heartbeats cannot change the recorded cohort");
  assert.equal(afterDrain.pages[0].timeOnPage, admitted.pages[0].timeOnPage);
  assert.equal(afterDrain.lastSeenAt.getTime(), admitted.lastSeenAt.getTime());
  assert.equal((await journey.recordCustomerJourney(shop, { ...delayed, acquisition: { ...delayed.acquisition, id: "acq_after_cap" } }, "REAL")).captured, false);
  assert.equal((await journey.recordCustomerJourney(shop, { ...delayed, pageViewId: "after-cap-page", pagePath: "/new-page" }, "REAL")).captured, false);
  assert.equal((await journey.recordCustomerJourney(shop, { ...delayed, sessionId: "other-browser" }, "REAL")).captured, false);
  assert.equal((await journey.recordCustomerJourney(other, delayed, "REAL")).captured, false);
  assert.equal(await db.customerJourneySession.count({ where: { snapshotId: storeRaceCapture.customerSnapshotId } }), 3);
  await db.customerSnapshot.update({ where: { id: completedCompanion.id }, data: { completedAt: new Date(Date.now() - 31 * 60_000) } });
  assert.equal((await journey.recordCustomerJourney(shop, delayed, "REAL")).captured, false, "Completed journey batches beyond the existing timeout are rejected");
  assert.equal((await db.customerSnapshot.findUnique({ where: { id: completedCompanion.id } })).status, "COMPLETED");
  const durationJourney = await server.startGrowthMeasurement(shop, {}, result.projectId, form({ completionMode: "DURATION", durationDays: 1 }));
  const durationCapture = await db.growthMeasurement.findUnique({ where: { id: durationJourney.measurementId } });
  const durationStarted = Date.now();
  const durationBatch = {
    eventType: "journey_batch", consent: true, sessionId: "duration-browser", pageViewId: "duration-first-page", pagePath: "/products/test-product",
    acquisition: { id: "acq_duration", startedAt: durationStarted, source: "facebook", campaign: "utm-campaign", campaignId: "ad-platform-campaign", adId: "ad-123", landingPath: "/products/test-product" },
    timeOnPage: 1000, hasMouseMoved: true, scrollDepth: 10,
    events: [{ id: "duration-before-cutoff", type: "page_view", at: durationStarted, path: "/products/test-product" }],
  };
  await journey.recordCustomerCommerce({ shop, sessionId: durationBatch.sessionId, acquisitionSessionId: "acq_duration", acquisition: durationBatch.acquisition, fromPixel: true, eventType: "add_to_cart", eventId: "quick-cart", timestamp: durationStarted });
  let durationSession = await db.customerJourneySession.findFirst({ where: { snapshotId: durationCapture.customerSnapshotId } });
  assert.equal(durationSession.addedToCart, true, "Quick successful commerce survives before the first parent heartbeat");
  assert.equal(durationSession.campaign, "utm-campaign", "Project journeys share parent acquisition campaign semantics");
  assert.equal(durationSession.adId, "ad-123");
  const durationJourneyUrl = `https://app.test/api/project-journeys?projectId=${result.projectId}&measurement=${durationJourney.measurementId}&source=&medium=&campaign=`;
  assert.equal((await (await journeysApi.loader({ request: new Request(durationJourneyUrl) })).json()).total, 0, "Provisional commerce sessions are hidden until the parent admits a page");
  const sendJourneyBatch = async (batch) => {
    const response = await trackApi.action({ request: new Request(`https://app.test/api/track?shop=${shop}`, { method: "POST", body: JSON.stringify(batch) }) });
    assert.equal(response.status, 200);
    return response.json();
  };
  const retryResponse = await sendJourneyBatch(durationBatch);
  assert.equal(retryResponse.accepted, false, "The real tracking route preserves the unacknowledged batch for retry before parent admission");
  await verifyTrackerAcknowledgement(retryResponse);
  const writeDurationPage = (pageViewId, visitorType, timeOnPage = 1000) => tracking.writeGrowthVisit("store", durationCapture.storeSnapshotId, visitorType, (tx) => tx.storeSnapshotVisit.upsert({
    where: { pageViewId_storeSnapshotId: { storeSnapshotId: durationCapture.storeSnapshotId, pageViewId } },
    create: { storeSnapshotId: durationCapture.storeSnapshotId, sessionId: durationBatch.sessionId, acquisitionId: "acq_duration", acquisitionStartedAt: new Date(durationStarted), acquisitionSource: "facebook", acquisitionCampaign: "utm-campaign", pageViewId, pagePath: "/products/test-product", visitorType, timeOnPage, scrollDepth: 10 },
    update: { visitorType, timeOnPage },
  }), { acquisitionId: "acq_duration", sessionId: durationBatch.sessionId, pageViewId });
  await writeDurationPage("duration-first-page", "PENDING");
  const acceptedResponse = await sendJourneyBatch(durationBatch);
  assert.equal(acceptedResponse.accepted, true);
  await verifyTrackerAcknowledgement(acceptedResponse);
  assert.equal((await (await journeysApi.loader({ request: new Request(durationJourneyUrl) })).json()).total, 1);
  await writeDurationPage("duration-second-page", "REAL", 6000);
  const writeDurationBot = (visitorType) => tracking.writeGrowthVisit("store", durationCapture.storeSnapshotId, visitorType, (tx) => tx.storeSnapshotVisit.upsert({
    where: { pageViewId_storeSnapshotId: { storeSnapshotId: durationCapture.storeSnapshotId, pageViewId: "duration-bot-page" } },
    create: { storeSnapshotId: durationCapture.storeSnapshotId, sessionId: "duration-bot-browser", acquisitionId: "acq_duration_bot", acquisitionStartedAt: new Date(durationStarted), acquisitionSource: "bot-source", pageViewId: "duration-bot-page", pagePath: "/", visitorType },
    update: { visitorType, timeOnPage: 1000 },
  }), { acquisitionId: "acq_duration_bot", sessionId: "duration-bot-browser", pageViewId: "duration-bot-page" });
  await writeDurationBot("PENDING");
  await writeDurationBot("BOT");
  assert.equal((await db.customerJourneySession.findFirst({ where: { snapshotId: durationCapture.customerSnapshotId, acquisitionId: "acq_duration_bot" } })).visitorType, "BOT", "A default PENDING value cannot outrank actual admitted BOT evidence");
  const durationCutoff = new Date();
  await db.storeSnapshot.update({ where: { id: durationCapture.storeSnapshotId }, data: { endsAt: durationCutoff } });
  await db.customerSnapshot.update({ where: { id: durationCapture.customerSnapshotId }, data: { endsAt: durationCutoff } });
  assert.equal((await sendJourneyBatch({ ...durationBatch, pageViewId: "duration-second-page", events: [{ id: "duration-before-sweep", type: "click", path: "/products/test-product", at: durationCutoff.getTime() }] })).captured, true, "The effective deadline accepts already-recorded events even before management expiry runs");
  assert.equal((await db.storeSnapshot.findUnique({ where: { id: durationCapture.storeSnapshotId } })).status, "ACTIVE", "Late event draining does not reopen or mutate capture lifecycle");
  await journey.expireCustomerSnapshots(shop);
  assert.equal((await db.storeSnapshot.findUnique({ where: { id: durationCapture.storeSnapshotId } })).status, "COMPLETED", "Legacy journey expiry completes its duration parent first");
  assert.equal((await sendJourneyBatch({ ...durationBatch, pageViewId: "duration-second-page", events: [{ id: "duration-exact-cutoff", type: "click", path: "/products/test-product", at: durationCutoff.getTime() }] })).captured, true, "A second parent-admitted duration page retains its delayed events");
  assert.equal((await sendJourneyBatch({ ...durationBatch, acquisition: { ...durationBatch.acquisition, id: "acq_after_duration" } })).accepted, true, "A closed capture acknowledges/drops excluded arrivals rather than retrying forever");
  assert.equal(await db.customerJourneySession.count({ where: { snapshotId: durationCapture.customerSnapshotId } }), 2);
  durationSession = await db.customerJourneySession.findUnique({ where: { id: durationSession.id } });
  assert.equal(durationSession.addedToCart, true);
  assert.equal(durationSession.campaign, "utm-campaign");
  assert.equal(durationSession.adId, "ad-123");

  const promoted = await server.startGrowthMeasurement(shop, {}, result.projectId, form({ targetVisitors: 1 }));
  const promotedCapture = await db.growthMeasurement.findUnique({ where: { id: promoted.measurementId } });
  const writePromoted = (visitorType, timeOnPage, hold) => tracking.writeGrowthVisit("store", promotedCapture.storeSnapshotId, visitorType, async (tx) => {
    if (hold) await hold(tx);
    return tx.storeSnapshotVisit.upsert({
    where: { pageViewId_storeSnapshotId: { storeSnapshotId: promotedCapture.storeSnapshotId, pageViewId: "promotion-page" } },
    create: { storeSnapshotId: promotedCapture.storeSnapshotId, sessionId: "promotion-browser", acquisitionId: "acq_promotion", acquisitionStartedAt: new Date(), acquisitionSource: "google", pageViewId: "promotion-page", pagePath: "/", visitorType, timeOnPage },
    update: { visitorType, timeOnPage },
    });
  }, { acquisitionId: "acq_promotion", sessionId: "promotion-browser", pageViewId: "promotion-page" });
  await writePromoted("PENDING", 0);
  const pendingJourney = await db.customerJourneySession.findFirst({ where: { snapshotId: promotedCapture.customerSnapshotId } });
  let releaseParent;
  let signalHeld;
  let holderPid;
  const held = new Promise((resolve) => { signalHeld = resolve; });
  const release = new Promise((resolve) => { releaseParent = resolve; });
  const finishing = writePromoted("REAL", 7000, async (tx) => {
    holderPid = (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid;
    signalHeld();
    await release;
  });
  await held;
  const waitingJourney = sendJourneyBatch({
    eventType: "journey_batch", consent: true, sessionId: "promotion-browser", pageViewId: "promotion-page", pagePath: "/", timeOnPage: 7000, hasMouseMoved: true,
    acquisition: { id: "acq_promotion", startedAt: pendingJourney.startedAt.getTime(), source: "google", landingPath: "/" },
    events: [{ id: "waited-across-completion", type: "click", at: Date.now(), path: "/" }],
  });
  let waiterObserved = false;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const blocked = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND ${holderPid}::int = ANY(pg_blocking_pids(pid))`;
      if (blocked[0].count > 0) { waiterObserved = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally { releaseParent(); }
  assert.equal((await finishing).completed, true);
  assert.equal(waiterObserved, true, "The regression must exercise an actual journey transaction waiting on the parent lock");
  assert.equal((await waitingJourney).captured, true, "A fresh post-lock clock preserves pre-cutoff events while the parent completes");
  assert.equal(await db.customerJourneyEvent.count({ where: { sessionId: pendingJourney.id, eventKey: "waited-across-completion" } }), 1);
  const promotedJourney = await db.customerJourneySession.findFirst({ where: { snapshotId: promotedCapture.customerSnapshotId }, include: { pages: true } });
  assert.equal(promotedJourney.visitorType, "REAL");
  assert.equal(promotedJourney.pages[0].visitorType, "REAL");
  assert.equal(promotedJourney.pages[0].timeOnPage, 7000, "Target-closing promotion synchronizes already-recorded page classification and metrics");
  const listed = await server.listGrowthProjects(shop);
  assert.equal(listed.total, 2);
  assert.ok(listed.projects.every((row) => row.shop === shop));
  const foreign = await server.createGrowthProject(other, {}, form());
  await db.growthProjectActivity.create({ data: { projectId: result.projectId, title: "Optimized product copy" } });
  await db.abTest.create({ data: { shop, growthProjectId: result.projectId, name: "Protected project test", targetPageType: "PRODUCT", status: "LIVE" } });
  await server.startGrowthMeasurement(shop, {}, result.projectId, form());
  const privacyImports = {
    "../db.server": db,
    "../shopify.server": { authenticate: { webhook: async () => ({ shop, topic: "TEST", session: { shop } }) } },
  };
  const uninstall = load("../app/routes/webhooks.app.uninstalled.tsx", privacyImports);
  assert.equal((await uninstall.action({ request: new Request("https://app.test/webhooks") })).status, 200);
  assert.equal(await db.storeSnapshot.count({ where: { shop, status: "ACTIVE" } }), 0);
  assert.equal(await db.customerSnapshot.count({ where: { shop, status: "ACTIVE" } }), 0);
  assert.equal(await db.abTest.count({ where: { shop, status: "LIVE" } }), 0);
  assert.equal(await db.growthProject.count({ where: { shop } }), 2, "Uninstall pauses but preserves merchant history until redaction");
  const privacy = load("../app/routes/webhooks.shop.redact.tsx", privacyImports);
  assert.equal((await privacy.action({ request: new Request("https://app.test/webhooks") })).status, 200);
  assert.equal(await db.growthProject.count({ where: { shop } }), 0);
  assert.equal(await db.growthProjectActivity.count({ where: { projectId: result.projectId } }), 0);
  assert.equal(await db.customerSnapshot.count({ where: { shop } }), 0);
  assert.equal(await db.storeSnapshot.count({ where: { shop } }), 0);
  assert.equal(await db.abTest.count({ where: { shop } }), 0);
  assert.equal((await db.growthProject.findUnique({ where: { id: foreign.projectId } })).shop, other, "Shop redaction never touches another merchant");
  console.log("Growth Projects PostgreSQL: creation/retry, ownership, activation gate, all-source journey admission, acquisition-based targets and purchases, companion completion, repeat measurements, expiry, and listing passed.");
} finally {
  await cleanup();
  await db.$disconnect();
}
