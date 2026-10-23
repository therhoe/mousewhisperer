import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";

const require = createRequire(import.meta.url);
function compile(file, mocks = {}) {
  const module = { exports: {} };
  const result = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  runInNewContext(result.outputText, {
    module, exports: module.exports, require: (key) => key in mocks ? mocks[key] : require(key),
    FormData, URL, Date, console,
  });
  return module.exports;
}
const pure = compile("../app/utils/growth-projects.ts");
function form(fields = {}) {
  const value = new FormData();
  for (const [key, item] of Object.entries({ requestKey: randomUUID(), title: "Improve checkout", goal: "Increase CVR", scope: "STORE", completionMode: "VISITORS", ...fields })) {
    if (item != null) value.set(key, String(item));
  }
  return value;
}
assert.equal(pure.parseMeasurementInput(form()).targetVisitors, 100);
assert.equal(pure.parseMeasurementInput(form()).durationDays, null);
assert.equal(pure.parseMeasurementInput(form({ completionMode: "DURATION" })).durationDays, 7);
assert.equal(pure.parseMeasurementInput(form({ completionMode: "DURATION" })).targetVisitors, null);
assert.throws(() => pure.parseMeasurementInput(form({ durationDays: 7 })), /only one/);
assert.throws(() => pure.parseMeasurementInput(form({ completionMode: "DURATION", targetVisitors: 100 })), /only one/);
for (const targetVisitors of [0, -1, 0.5, "no", 1000001])
  assert.throws(() => pure.parseMeasurementInput(form({ targetVisitors })), /whole number/);
assert.throws(() => pure.parseGrowthProjectInput(form({ scope: "PAGE", journeyTracking: true })), /store-level/);
assert.throws(() => pure.parseGrowthProjectInput(form({ goal: "" })), /title and goal/);
assert.throws(() => pure.growthRequestKey(form({ requestKey: "invalid" })), /Refresh/);
assert.equal(pure.parseGrowthProjectInput(form({ source: "all" })).defaultSource, null);
assert.equal(pure.growthResourcePath({ resourceType: "BLOG", productHandle: "news/our-product" }), "/blogs/news/our-product");
assert.equal(pure.growthResourcePath({ resourceType: "HOMEPAGE", productHandle: "__homepage__" }), "/");

// Transactional fake: executes actual server functions and rolls back all writes
// on failure. No merchant DB, network call, or real capture is used by this test.
let state;
let pixelCalls = 0;
let limits;
let trackerState = "active";
let billingCalls = 0;
let pageChecks = [];
let unavailableProduct = false;
function reset() {
  state = Object.fromEntries(["growthProject", "growthMeasurement", "project", "snapshot", "storeSnapshot", "channelSnapshot", "customerSnapshot"].map((name) => [name, []]));
  limits = { storeSnapshots: 20, normalSnapshots: 50, maxSnapshotTargetVisitors: 1000 };
  pixelCalls = 0;
  billingCalls = 0;
  trackerState = "active";
  pageChecks = [];
  unavailableProduct = false;
}
reset();
function relation(model, row, key) {
  if (key === "project") return state[model === "snapshot" ? "project" : "growthProject"].find((p) => p.id === row.projectId) || null;
  if (["snapshot", "storeSnapshot", "channelSnapshot", "customerSnapshot"].includes(key)) return state[key].find((p) => p.id === row[`${key}Id`]) || null;
  if (key === "growthMeasurement") return state.growthMeasurement.find((p) => p[`${model}Id`] === row.id) || null;
  return row[key];
}
function matches(model, row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return expected.some((item) => matches(model, row, item));
    if (key === "AND") return expected.every((item) => matches(model, row, item));
    const actual = relation(model, row, key);
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      if ("not" in expected) return actual !== expected.not;
      if ("in" in expected) return expected.in.includes(actual);
      if ("lte" in expected) return actual != null && actual <= expected.lte;
      if ("gt" in expected) return actual != null && actual > expected.gt;
      if ("isNot" in expected) return actual != null;
      if ("is" in expected && expected.is === null) return actual == null;
      return actual != null && matches(key === "project" ? model === "snapshot" ? "project" : "growthProject" : key, actual, expected);
    }
    return expected === null ? actual == null : actual === expected;
  });
}
function result(model, row, query) {
  if (!row) return null;
  const copy = { ...row };
  if (query.include) for (const key of Object.keys(query.include)) copy[key] = relation(model, row, key);
  return copy;
}
const db = { $executeRaw: async () => 1 };
for (const model of Object.keys(state)) {
  db[model] = {
    async findFirst(query = {}) {
      let rows = state[model].filter((row) => matches(model, row, query.where));
      if (query.orderBy?.number) rows.sort((a, b) => b.number - a.number);
      return result(model, rows[0], query);
    },
    async findMany(query = {}) { return state[model].filter((row) => matches(model, row, query.where)).map((row) => result(model, row, query)); },
    async count(query = {}) { return state[model].filter((row) => matches(model, row, query.where)).length; },
    async create({ data }) {
      const row = { id: `${model}_${randomUUID()}`, status: "ACTIVE", endsAt: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data };
      state[model].push(row);
      return row;
    },
    async updateMany({ where, data }) {
      const rows = state[model].filter((row) => matches(model, row, where));
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
    async update({ where, data }) {
      const row = state[model].find((row) => matches(model, row, where));
      if (!row) throw new Error("Row not found");
      Object.assign(row, data);
      return row;
    },
  };
}
db.$transaction = async (callback) => {
  const before = structuredClone(state);
  try { return await callback(db); } catch (error) { state = before; throw error; }
};
class PlanLimitError extends Error {}
const server = compile("../app/utils/growth-projects.server.ts", {
  "../db.server": db,
  "./growth-projects": pure,
  "./billing.server": { PlanLimitError, getBillingAccess: async () => { billingCalls++; return { limits }; } },
  "./web-pixel.server": { ensureWebPixel: async () => { pixelCalls++; return { ready: true }; } },
  "./snapshot-setup.server": {
    savedTrackerState: async () => trackerState,
    resolveSetupPage: async (_admin, type, id, options) => {
      pageChecks.push({ type, id, options });
      if (type === "PRODUCT" && options?.requirePublishedProduct && unavailableProduct)
        throw new pure.GrowthProjectError("Choose a product published to the Online Store.");
      return { id, title: "Product", handle: "product" };
    },
  },
  "./loader-cache.server": { cachedValue: async (_key, _ttl, load) => load(), clearCacheKey() {}, clearCachePrefix() {}, loaderCacheKeys: { dashboard: () => "", billingDisplay: () => "", categoryPrefix: () => "", categoryFastPrefix: () => "" } },
});
const shop = "owner.myshopify.com";
const initial = form({ source: "facebook", medium: "paid", campaign: "sale", journeyTracking: true });
const created = await server.createGrowthProject(shop, {}, initial);
assert.equal(state.growthProject.length, 1);
assert.equal(state.storeSnapshot.length, 1);
assert.equal(state.customerSnapshot.length, 1);
assert.equal(state.growthProject[0].defaultSource, "facebook");
assert.equal(state.customerSnapshot[0].captureAllSources, true);
assert.equal(state.customerSnapshot[0].source, "*");
assert.equal(state.customerSnapshot[0].medium, undefined);
assert.equal(state.customerSnapshot[0].campaign, undefined);
assert.equal(state.customerSnapshot[0].endsAt, null);
assert.equal(state.customerSnapshot[0].targetSessions, null);
assert.equal(state.storeSnapshot[0].targetHumanVisitors, 100);
assert.equal(state.growthMeasurement[0].targetVisitors, 100);
assert.deepEqual(await server.createGrowthProject(shop, {}, initial), created);
assert.equal(pixelCalls, 1, "Idempotent replay must not mutate Shopify again");
assert.equal(state.storeSnapshot.length, 1);
await assert.rejects(server.createGrowthProject(shop, {}, form()), /already running/);
assert.equal(state.growthProject.length, 1, "Failed capture creation rolls back its Project");
await assert.rejects(server.startGrowthMeasurement("other.myshopify.com", {}, created.projectId, form()), /not found/);
await assert.rejects(server.transitionGrowthMeasurement("other.myshopify.com", created.projectId, created.measurementId, "complete"), /not found/);
assert.equal(state.storeSnapshot[0].status, "ACTIVE");
await server.transitionGrowthMeasurement(shop, created.projectId, created.measurementId, "pause");
assert.equal(state.storeSnapshot[0].status, "PAUSED");
assert.equal(state.customerSnapshot[0].status, "PAUSED");
await server.transitionGrowthMeasurement(shop, created.projectId, created.measurementId, "resume");
assert.equal(state.storeSnapshot[0].status, "ACTIVE");
assert.equal(state.customerSnapshot[0].status, "ACTIVE");
await server.transitionGrowthMeasurement(shop, created.projectId, created.measurementId, "complete");
assert.equal(state.storeSnapshot[0].status, "COMPLETED");
assert.equal(state.customerSnapshot[0].status, "COMPLETED");
assert.equal(state.growthProject.length, 1, "Completing a capture preserves its ongoing Project");
await assert.rejects(server.transitionGrowthMeasurement(shop, created.projectId, created.measurementId, "resume"), /cannot restart/);
const second = await server.startGrowthMeasurement(shop, {}, created.projectId, form({ completionMode: "DURATION", durationDays: 3 }));
assert.equal(state.growthMeasurement.length, 2);
assert.equal(state.storeSnapshot[1].targetHumanVisitors, null);
assert.equal(state.storeSnapshot[1].durationDays, 3);
assert.equal(state.customerSnapshot[1].endsAt.getTime(), state.storeSnapshot[1].endsAt.getTime());
assert.equal(state.growthMeasurement[1].projectId, created.projectId);
await server.transitionGrowthMeasurement(shop, created.projectId, second.measurementId, "complete");

reset();
limits.normalSnapshots = 0;
await assert.rejects(server.createGrowthProject(shop, {}, form({ journeyTracking: true })), /allowance/);
assert.equal(state.growthProject.length, 0);
assert.equal(state.storeSnapshot.length, 0);
assert.equal(state.customerSnapshot.length, 0);
reset();
await assert.rejects(server.createGrowthProject(shop, {}, form({ targetVisitors: 1001 })), /1000|1,000/);
assert.equal(state.growthProject.length, 0);
reset();
state.project.push({ id: "foreign-page", shop: "other.myshopify.com", resourceType: "PRODUCT" });
await assert.rejects(server.createGrowthProject(shop, {}, form({ scope: "PAGE", resourceProjectId: "foreign-page" })), /not found/);
assert.equal(pixelCalls, 0, "Ownership must be checked before Shopify mutation");
const page = await server.createGrowthProject(shop, {}, form({ scope: "PAGE", pageType: "PRODUCT", pageId: "gid://shopify/Product/123", completionMode: "DURATION", durationDays: 2 }));
assert.equal(state.snapshot.length, 1);
assert.ok(state.snapshot[0].endsAt);
assert.equal(state.storeSnapshot.length, 0);
assert.equal(state.growthMeasurement[0].targetVisitors, null);
assert.equal(state.growthProject[0].scope, "PAGE");
await server.transitionGrowthMeasurement(shop, page.projectId, page.measurementId, "complete");
const followup = await server.startGrowthMeasurement(shop, {}, page.projectId, form());
assert.equal(state.snapshot[1].number, 2);
assert.equal(state.snapshot[1].endsAt, null);
assert.equal(state.growthMeasurement[1].id, followup.measurementId);

reset();
trackerState = "missing";
limits.storeSnapshots = 0;
limits.normalSnapshots = 0;
state.storeSnapshot.push({ id: "existing-active", shop, status: "ACTIVE" });
const emptyRequest = form({ targetVisitors: "unused-invalid", durationDays: "unused-invalid" });
const empty = await server.createGrowthProject(shop, {}, emptyRequest, { startMeasurement: false });
assert.equal(empty.measurementId, null);
assert.equal(state.growthMeasurement.length, 0);
assert.equal(state.storeSnapshot.length, 1, "An A/B project creates no competing baseline capture");
assert.equal(pixelCalls, 0);
assert.equal(billingCalls, 0, "An empty project consumes no measurement allowance");
assert.deepEqual(await server.createGrowthProject(shop, {}, emptyRequest, { startMeasurement: false }), empty);
assert.equal(state.growthProject.length, 1);
await assert.rejects(server.createGrowthProject(shop, {}, form({ title: "" }), { startMeasurement: false }), /title and goal/);
state.project.push({ id: "foreign-empty", shop: "other.myshopify.com", resourceType: "PRODUCT" });
await assert.rejects(server.createGrowthProject(shop, {}, form({ scope: "PAGE", resourceProjectId: "foreign-empty" }), { startMeasurement: false }), /not found/);
const pageOnly = await server.createGrowthProject(shop, {}, form({ scope: "PAGE", pageType: "PRODUCT", pageId: "gid://shopify/Product/123" }), { startMeasurement: false });
assert.equal(pageOnly.measurementId, null);
assert.ok(state.growthProject.find((row) => row.id === pageOnly.projectId).resourceProjectId);
assert.equal(state.snapshot.length, 0);

reset();
unavailableProduct = true;
for (const startMeasurement of [true, false]) {
  await assert.rejects(
    server.createGrowthProject(shop, {}, form({ scope: "PAGE", pageType: "PRODUCT", pageId: "gid://shopify/Product/123" }), { startMeasurement }),
    /published to the Online Store/,
  );
}
state.project.push({ id: "owned-unpublished", shop, resourceType: "PRODUCT", productId: "gid://shopify/Product/123" });
await assert.rejects(
  server.createGrowthProject(shop, {}, form({ scope: "PAGE", resourceProjectId: "owned-unpublished" }), { startMeasurement: false }),
  /published to the Online Store/,
);
assert.equal(pageChecks.length, 3, "New picker selections and reused page resources must both be checked");
assert.ok(pageChecks.every((check) => check.options.requirePublishedProduct));
assert.equal(state.growthProject.length, 0);
assert.equal(state.growthMeasurement.length, 0);
assert.equal(pixelCalls, 0, "Publication validation happens before pixel mutations");
assert.equal(billingCalls, 0);

const migration = readFileSync(new URL("../prisma/migrations/20261022000000_growth_projects/migration.sql", import.meta.url), "utf8");
assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
assert.match(migration, /ON CONFLICT DO NOTHING/);
assert.match(migration, /a\.shop = g\.shop/);
assert.match(migration, /GrowthMeasurement_completion_check/);
for (const table of ["Snapshot", "StoreSnapshot", "ChannelSnapshot", "CustomerSnapshot", "AbTest"])
  assert.ok(migration.includes(`FROM "${table}"`), `${table} must be preserved and attached`);
const tracker = readFileSync(new URL("../app/routes/api.track.tsx", import.meta.url), "utf8");
assert.match(tracker, /activeSnapshot\?\.endsAt/);
assert.match(tracker, /writeGrowthVisit\("page"/);
assert.match(tracker, /!activeSnapshot\.usesAcquisitionSessions && visitorType === "REAL"/);
const journeySource = readFileSync(new URL("../app/utils/customer-journey.server.ts", import.meta.url), "utf8");
assert.match(journeySource, /capture\.captureAllSources \|\|/);
assert.match(journeySource, /growthMeasurement: \{ storeSnapshot: \{ status: "ACTIVE"/);
console.log("Growth Projects: validation, ownership, atomic creation, billing, idempotency, lifecycle, all-source journeys, duration guards, and migration preservation passed.");
