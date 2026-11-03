// Real SQL integration against a disposable loopback PostgreSQL database only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { PrismaClient } from "@prisma/client";
import ts from "typescript";
const require = createRequire(import.meta.url);
const url = process.env.GROWTH_TEST_DATABASE_URL;
assert.ok(
  url && ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
  "Explicit disposable local DB required",
);
const db = new PrismaClient({ datasources: { db: { url } } });
const shop = `growth-report-${randomUUID()}.myshopify.com`;
function compile(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(
    readFileSync(new URL(`../app/utils/${file}.ts`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    },
  ).outputText;
  runInNewContext(code, {
    module,
    exports: module.exports,
    URL,
    URLSearchParams,
    Date,
    console,
    require: (key) => (key in mocks ? mocks[key] : require(key)),
  });
  return module.exports;
}
const pure = compile("growth-projects");
const filters = compile("growth-report");
const clicks = compile("click-engagement");
const service = (client) =>
  compile("growth-report.server", {
    "../db.server": client,
    "./growth-projects": pure,
    "./click-engagement": clicks,
    "./growth-report": filters,
    // A fresh cache per service, so each call below queries the database.
    "./loader-cache.server": compile("loader-cache.server"),
  });
const all = { audience: "all", source: "", medium: "", campaign: "" };
assert.equal(
  filters.growthReportFilters(new URLSearchParams(), {
    defaultSource: "facebook",
  }).source,
  "facebook",
);
assert.equal(
  filters.growthReportFilters(new URLSearchParams("source="), {
    defaultSource: "facebook",
  }).source,
  "",
);
let project;
try {
  project = await db.growthProject.create({
    data: {
      shop,
      title: "Report fixture",
      goal: "Check cohorts",
      scope: "STORE",
    },
  });
  const store = await db.storeSnapshot.create({
    data: {
      shop,
      name: "Fixture",
      completionMode: "TIME_WINDOW",
      durationDays: 7,
      endsAt: new Date("2026-12-31"),
      usesAcquisitionSessions: true,
    },
  });
  const measurement = await db.growthMeasurement.create({
    data: {
      projectId: project.id,
      name: "Baseline",
      completionMode: "DURATION",
      durationDays: 7,
      storeSnapshotId: store.id,
    },
  });
  const start = new Date("2026-10-22T00:30:00Z");
  const row = (
    page,
    acquisition,
    type,
    source,
    converted = false,
    atc = false,
  ) => ({
    storeSnapshotId: store.id,
    sessionId: "same-browser",
    pageViewId: page,
    pagePath: `/${page}`,
    visitorType: type,
    acquisitionId: acquisition,
    acquisitionSource: source,
    acquisitionMedium: "paid",
    acquisitionCampaign: "launch",
    acquisitionStartedAt: start,
    source: "internal",
    startedAt: start,
    timeOnPage: 10000,
    scrollDepth: 50,
    converted,
    addedToCart: atc,
    ctaClicks: JSON.stringify([
      { label: "Play video", tag: "button", zone: "body" },
    ]),
  });
  await db.storeSnapshotVisit.createMany({
    data: [
      row("p1", "acq_one", "REAL", "facebook", false, true),
      row("p2", "acq_one", "ZOMBIE", "facebook", true, true),
      row("p3", "acq_two", "ZOMBIE", "google"),
      row("p4", "acq_three", "BOT", "facebook"),
      row("p5", "acq_four", "PENDING", "facebook"),
    ],
  });
  const report = await service(db).getGrowthMeasurementReport(
    shop,
    project.id,
    measurement.id,
    all,
  );
  assert.equal(
    report.sessions,
    4,
    "New arrivals within one browser are separate sessions; repeated pages are not",
  );
  assert.equal(report.pageViews, 5);
  assert.equal(report.conversions, 1);
  assert.equal(report.conversionRate, 25);
  assert.equal(report.engagement, null, "Store reports do not build Engagement by zone");
  const active = await service(db).getGrowthMeasurementReport(
    shop,
    project.id,
    measurement.id,
    { ...all, audience: "active" },
  );
  assert.equal(active.sessions, 1);
  assert.equal(
    active.pageViews,
    2,
    "Active retains whole qualifying session, not only its REAL page",
  );
  assert.equal(active.conversionRate, 100);
  const facebook = await service(db).getGrowthMeasurementReport(
    shop,
    project.id,
    measurement.id,
    { ...all, source: "FACEBOOK" },
  );
  assert.equal(facebook.sessions, 3);
  assert.ok(Math.abs(facebook.conversionRate - 100 / 3) < 0.0001);
  const none = await service(db).getGrowthMeasurementReport(
    shop,
    project.id,
    measurement.id,
    { ...all, campaign: "other" },
  );
  assert.equal(none.sessions, 0);
  assert.equal(none.conversionRate, 0);
  assert.equal(none.channels.length, 0);
  await assert.rejects(
    () =>
      service(db).getGrowthMeasurementReport(
        "other.myshopify.com",
        project.id,
        measurement.id,
        all,
      ),
    /not found/,
  );
  await assert.rejects(
    () =>
      service(db).getGrowthMeasurementReport(
        shop,
        "other-project",
        measurement.id,
        all,
      ),
    /not found/,
  );
  await db.$transaction(async (client) => {
    await client.$executeRawUnsafe("SET LOCAL TIME ZONE 'Pacific/Honolulu'");
    const localized = await service(client).getGrowthMeasurementReport(
      shop,
      project.id,
      measurement.id,
      all,
    );
    assert.equal(
      localized.series[0].date,
      "2026-10-22",
      "UTC chart dates do not shift with DB connection timezone",
    );
  });
  // A repeat open within 60 seconds reuses the report, but the shop-scoped
  // measurement lookup still runs first on every call.
  let lookups = 0;
  let queries = 0;
  let denied = false;
  const spy = {
    growthMeasurement: {
      findFirst: async (args) => {
        lookups += 1;
        return denied ? null : db.growthMeasurement.findFirst(args);
      },
    },
    $queryRaw: (...args) => {
      queries += 1;
      return db.$queryRaw(...args);
    },
  };
  const cached = service(spy);
  const first = await cached.getGrowthMeasurementReport(shop, project.id, measurement.id, all);
  assert.equal(
    await cached.getGrowthMeasurementReport(shop, project.id, measurement.id, all),
    first,
  );
  assert.deepEqual([lookups, queries], [2, 1]);
  await cached.getGrowthMeasurementReport(shop, project.id, measurement.id, { ...all, audience: "active" });
  assert.equal(queries, 2, "Each filter set has its own cache entry");
  denied = true;
  await assert.rejects(
    () => cached.getGrowthMeasurementReport(shop, project.id, measurement.id, all),
    /not found/,
    "A cached report is never returned without the shop check",
  );
  // Engagement by zone is a Page-layout section; it uses the same cohort as commerce.
  await db.growthProject.update({ where: { id: project.id }, data: { scope: "PAGE" } });
  const page = await service(db).getGrowthMeasurementReport(shop, project.id, measurement.id, all);
  assert.equal(page.engagement.groups[0].items[0].sessions, 4);
  assert.equal(page.engagement.groups[0].items[0].purchases, 1);
  assert.equal(
    await db.storeSnapshotVisit.count({ where: { storeSnapshotId: store.id } }),
    5,
    "Filters never mutate captures",
  );
  console.log(
    "PASS: real PostgreSQL report cohorts, acquisition deduplication, commerce/engagement alignment, source/medium/campaign filters, tenant boundaries, UTC dates and the 60-second report cache",
  );
} finally {
  if (project)
    await db.growthProject.deleteMany({ where: { id: project.id, shop } });
  await db.storeSnapshot.deleteMany({ where: { shop } });
  await db.$disconnect();
}
