// Real SQL checks for the redesigned Project report sections.
// Disposable loopback database only:
// GROWTH_TEST_DATABASE_URL='postgresql://growth_test@127.0.0.1:55443/growth_report_test' node scripts/check-growth-report-sections.mjs
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
const shop = `report-sections-${randomUUID()}.myshopify.com`;
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
const reportPure = compile("growth-report");
const service = compile("growth-report.server", {
  "../db.server": db,
  "./growth-projects": compile("growth-projects"),
  "./click-engagement": compile("click-engagement"),
  "./growth-report": reportPure,
});
const plain = (value) => JSON.parse(JSON.stringify(value));
const all = { audience: "all", source: "", medium: "", campaign: "" };
const t0 = new Date("2026-10-22T10:00:00Z");
const later = (minutes) => new Date(t0.getTime() + minutes * 60_000);
const click = (zone) => JSON.stringify([{ label: "Card", tag: "a", zone }]);
const report = (projectId, measurementId, filters = all) =>
  service.getGrowthMeasurementReport(shop, projectId, measurementId, filters);
try {
  // Store Project: five sessions across collection, product, page and homepage.
  const storeProject = await db.growthProject.create({
    data: { shop, title: "Store", goal: "Find focus pages", scope: "STORE" },
  });
  const store = await db.storeSnapshot.create({
    data: {
      shop,
      name: "Store fixture",
      completionMode: "TIME_WINDOW",
      durationDays: 7,
      endsAt: new Date("2026-12-31"),
      usesAcquisitionSessions: true,
    },
  });
  const storeMeasurement = await db.growthMeasurement.create({
    data: {
      projectId: storeProject.id,
      name: "Store baseline",
      completionMode: "DURATION",
      durationDays: 7,
      storeSnapshotId: store.id,
    },
  });
  const view = (pageViewId, acquisitionId, visitorType, pagePath, resourceType, extra = {}) => ({
    storeSnapshotId: store.id,
    sessionId: `browser-${acquisitionId}`,
    pageViewId,
    pagePath,
    resourceType,
    visitorType,
    acquisitionId,
    acquisitionSource: "facebook",
    acquisitionStartedAt: t0,
    startedAt: t0,
    timeOnPage: 0,
    scrollDepth: 50,
    ...extra,
  });
  await db.storeSnapshotVisit.createMany({
    data: [
      // Image inside a product card: ctaClicks holds the image, exitUrl the product (locale-prefixed).
      view("a1", "acq_a", "REAL", "/collections/shoes", "COLLECTION", {
        exitType: "internal_link",
        exitUrl: "https://shop.example/en-us/products/red-shoe?variant=1",
        ctaClicks: JSON.stringify([
          { label: "Red shoe", tag: "img", href: "https://cdn.shopify.com/red.jpg", zone: "main" },
        ]),
        deviceType: "desktop",
        searchQuery: "Red Shoes ",
        timeOnPage: 30000,
      }),
      view("a2", "acq_a", "REAL", "/products/red-shoe", "PRODUCT", {
        startedAt: later(1),
        addedToCart: true,
        checkoutStarted: true,
        converted: true,
        exitType: "checkout",
        deviceType: "desktop",
        timeOnPage: 60000,
        scrollDepth: 100,
      }),
      // Collection to a content page is not a product click-through.
      view("b1", "acq_b", "REAL", "/collections/shoes", "COLLECTION", {
        exitType: "internal_link",
        exitUrl: "https://shop.example/pages/about",
        ctaClicks: click("main"),
        deviceType: "mobile",
        searchQuery: "red shoes",
        timeOnPage: 20000,
      }),
      // Menu navigation does not count; a one-session search term is never listed.
      view("c1", "acq_c", "ZOMBIE", "/collections/shoes", "COLLECTION", {
        exitType: "internal_link",
        exitUrl: "https://shop.example/products/blue",
        ctaClicks: click("header"),
        deviceType: "mobile",
        searchQuery: "john@example.com",
        timeOnPage: 4000,
      }),
      // Truncated click JSON must not break the report or drop the click-through.
      view("d1", "acq_d", "REAL", "/pages/about", "PAGE", {
        exitType: "internal_link",
        exitUrl: "https://shop.example/fr/products/x",
        ctaClicks: '[{"label":"Broken"',
        deviceType: "tablet",
        timeOnPage: 30000,
      }),
      view("e1", "acq_e", "BOT", "/", "HOMEPAGE", {
        exitType: "window_closed",
        deviceType: "desktop",
      }),
    ],
  });

  const storeReport = await report(storeProject.id, storeMeasurement.id);
  assert.equal(storeReport.layout, "store");
  assert.equal(storeReport.pageType, null);
  assert.deepEqual(plain(storeReport.funnel), {
    sessions: 5,
    addedToCart: 1,
    checkoutStarted: 1,
    purchased: 1,
  });
  const summary = storeReport.engagementSummary;
  assert.equal(summary.available, true);
  assert.equal(
    summary.clickThroughRate,
    40,
    "Image-in-card, locale-prefixed and malformed-JSON page views count; menu clicks and collection-to-page do not",
  );
  assert.equal(summary.searchRate, 60);
  assert.deepEqual(plain(summary.topSearches), [{ term: "red shoes", sessions: 2 }]);
  assert.equal(summary.timeMedianSeconds, 20);
  assert.equal(summary.pagesPerSession, 1.2);
  assert.deepEqual(
    plain(summary.devices).map((row) => [row.device, row.sessions, row.conversionRate]),
    [
      ["desktop", 2, 50],
      ["mobile", 2, 0],
      ["tablet", 1, 0],
    ],
  );
  const shoes = storeReport.pages.find((row) => row.path === "/collections/shoes");
  assert.deepEqual(
    [shoes.type, shoes.sessions, shoes.forwards, shoes.exits],
    ["COLLECTION", 3, 1, 2],
  );
  const product = storeReport.pages.find((row) => row.path === "/products/red-shoe");
  assert.deepEqual(
    [product.sessions, product.carts, product.conversions, product.exits],
    [1, 1, 1, 1],
  );
  assert.equal(storeReport.exitPaths.exitPages[0].path, "/collections/shoes");
  assert.equal(Math.round(storeReport.exitPaths.exitPages[0].exitRate), 67);

  const active = await report(storeProject.id, storeMeasurement.id, {
    ...all,
    audience: "active",
  });
  assert.equal(active.funnel.sessions, 3);
  assert.equal(Math.round(active.engagementSummary.clickThroughRate), 67);
  assert.equal(active.pages.find((row) => row.path === "/collections/shoes").sessions, 2);

  const none = await report(storeProject.id, storeMeasurement.id, {
    ...all,
    campaign: "nothing",
  });
  assert.equal(none.funnel.sessions, 0);
  assert.equal(none.engagementSummary.timeMedianSeconds, 0);
  assert.equal(none.engagementSummary.clickThroughRate, 0);
  assert.equal(none.engagementSummary.pagesPerSession, 0);
  assert.deepEqual(plain(none.pages), []);
  assert.equal(none.exitPaths.outcomes.length, 7);
  assert.ok(none.exitPaths.outcomes.every((row) => row.pageViews === 0 && row.share === 0));

  // Page Project on a collection: only clicks to a product count.
  const resource = await db.project.create({
    data: {
      shop,
      resourceType: "COLLECTION",
      productId: "gid://shopify/Collection/1",
      productTitle: "Shoes",
      productHandle: "shoes",
    },
  });
  const pageProject = await db.growthProject.create({
    data: { shop, title: "Shoes", goal: "More product clicks", scope: "PAGE", resourceProjectId: resource.id },
  });
  const snapshot = await db.snapshot.create({
    data: { projectId: resource.id, number: 1, usesAcquisitionSessions: true },
  });
  const pageMeasurement = await db.growthMeasurement.create({
    data: {
      projectId: pageProject.id,
      name: "Page baseline",
      completionMode: "VISITORS",
      targetVisitors: 100,
      snapshotId: snapshot.id,
    },
  });
  const visit = (pageViewId, acquisitionId, extra = {}) => ({
    snapshotId: snapshot.id,
    sessionId: `browser-${acquisitionId}`,
    pageViewId,
    acquisitionId,
    acquisitionSource: "google",
    acquisitionStartedAt: t0,
    startedAt: t0,
    visitorType: "REAL",
    ...extra,
  });
  await db.visit.createMany({
    data: [
      visit("p1", "acq_p1", {
        exitType: "internal_link",
        exitUrl: "https://shop.example/products/a?x=1#top",
        ctaClicks: click("main"),
      }),
      visit("p2", "acq_p2", {
        exitType: "internal_link",
        exitUrl: "https://shop.example/account/orders/123",
        ctaClicks: click("main"),
      }),
      visit("p3", "acq_p3", { exitType: "back_button" }),
      visit("p4", "acq_p4"),
    ],
  });
  const pageReport = await report(pageProject.id, pageMeasurement.id);
  assert.equal(pageReport.layout, "page");
  assert.equal(pageReport.pageType, "COLLECTION");
  assert.equal(pageReport.engagementSummary.clickThroughRate, 25);
  assert.deepEqual(
    plain(pageReport.exitPaths.outcomes)
      .filter((row) => row.pageViews)
      .map((row) => [row.type, row.pageViews]),
    [
      ["internal_link", 2],
      ["back_button", 1],
      ["unknown", 1],
    ],
  );
  assert.deepEqual(
    plain(pageReport.exitPaths.nextPages).map((row) => row.path).sort(),
    ["/private-page", "/products/a"],
    "Query strings are removed and account paths are masked",
  );
  assert.deepEqual(plain(pageReport.pages), []);

  // Imported Channel measurement: no page-level data was ever recorded.
  const channel = await db.channelSnapshot.create({ data: { shop, name: "Imported" } });
  await db.channelSnapshotSession.create({
    data: {
      channelSnapshotId: channel.id,
      acquisitionId: "acq_channel",
      trackingSessionId: "browser-channel",
      source: "facebook",
      addedToCart: true,
      checkoutStarted: true,
    },
  });
  const channelProject = await db.growthProject.create({
    data: { shop, title: "Imported", goal: "", scope: "STORE" },
  });
  const channelMeasurement = await db.growthMeasurement.create({
    data: {
      projectId: channelProject.id,
      name: "Imported",
      completionMode: "VISITORS",
      targetVisitors: 100,
      channelSnapshotId: channel.id,
    },
  });
  const imported = await report(channelProject.id, channelMeasurement.id);
  assert.equal(imported.engagementSummary.available, false);
  assert.equal(imported.exitPaths.available, false);
  assert.deepEqual(plain(imported.funnel), {
    sessions: 1,
    addedToCart: 1,
    checkoutStarted: 1,
    purchased: 0,
  });
  assert.deepEqual(plain(imported.pages), []);
  console.log(
    "PASS: funnel, click-through rule, searches, devices, medians, exit paths, page rows, cohorts, empty filters and imported measurements",
  );
} finally {
  await db.growthProject.deleteMany({ where: { shop } });
  await db.project.deleteMany({ where: { shop } });
  await db.storeSnapshot.deleteMany({ where: { shop } });
  await db.channelSnapshot.deleteMany({ where: { shop } });
  await db.$disconnect();
}
