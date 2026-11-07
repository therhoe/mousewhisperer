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
  "./loader-cache.server": compile("loader-cache.server"),
});
const plain = (value) => JSON.parse(JSON.stringify(value));
const all = { audience: "all", source: "", medium: "", campaign: "" };
const t0 = new Date("2026-10-22T10:00:00Z");
const later = (minutes) => new Date(t0.getTime() + minutes * 60_000);
const click = (zone) => JSON.stringify([{ label: "Card", tag: "a", zone }]);
const report = (projectId, measurementId, filters = all, currency = null) =>
  service.getGrowthMeasurementReport(shop, projectId, measurementId, filters, currency);
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
      // Locale-prefixed and collection-scoped URLs of a product the session already viewed share its row.
      view("a3", "acq_a", "REAL", "/fr/products/red-shoe", "PRODUCT", { startedAt: later(0.5) }),
      view("a4", "acq_a", "REAL", "/collections/shoes/products/red-shoe", "PRODUCT", { startedAt: later(0.75) }),
      // Account links carry personal tokens; private paths share one /private-page row without a type.
      view("e2", "acq_e", "BOT", "/pages/orders", "PAGE", { startedAt: later(0.5) }),
      view("e3", "acq_e", "BOT", "/account/reset/123/abc", null, { startedAt: later(1) }),
      // AJAX add-to-cart also records exitType "checkout"; a shopper who added to cart and
      // then left without reaching checkout exits from the product page.
      view("f1", "acq_f", "REAL", "/collections/shoes", "COLLECTION", {
        exitType: "internal_link",
        exitUrl: "https://shop.example/products/blue",
        deviceType: "tablet",
        timeOnPage: 10000,
      }),
      view("f2", "acq_f", "REAL", "/products/blue", "PRODUCT", {
        startedAt: later(1),
        addedToCart: true,
        exitType: "checkout",
        deviceType: "tablet",
        timeOnPage: 10000,
      }),
    ],
  });

  const storeReport = await report(storeProject.id, storeMeasurement.id);
  assert.equal(storeReport.layout, "store");
  assert.equal(storeReport.pageType, null);
  assert.deepEqual(plain(storeReport.funnel), {
    sessions: 6,
    addedToCart: 2,
    checkoutStarted: 1,
    purchased: 1,
    // No shop currency was passed, so the one order counts as unpriced.
    revenue: 0,
    pricedConversions: 0,
    unpricedConversions: 1,
  });
  const summary = storeReport.engagementSummary;
  assert.equal(summary.available, true);
  assert.equal(
    summary.clickThroughRate,
    50,
    "Image-in-card, locale-prefixed and malformed-JSON page views count; menu clicks and collection-to-page do not",
  );
  assert.equal(summary.searchRate, 50);
  assert.deepEqual(plain(summary.topSearches), [{ term: "red shoes", sessions: 2 }]);
  assert.equal(summary.timeMedianSeconds, 20);
  assert.equal(summary.pagesPerSession, 2);
  assert.deepEqual(
    plain(summary.devices).map((row) => [row.device, row.sessions, row.conversionRate]),
    [
      ["desktop", 2, 50],
      ["mobile", 2, 0],
      ["tablet", 2, 0],
    ],
  );
  const shoes = storeReport.pages.find((row) => row.path === "/collections/shoes");
  assert.deepEqual(
    [shoes.type, shoes.sessions, shoes.forwards, shoes.exits],
    ["COLLECTION", 4, 2, 2],
    "Collection exits stay with sessions b and c",
  );
  const blue = storeReport.pages.find((row) => row.path === "/products/blue");
  assert.deepEqual(
    [blue.sessions, blue.carts, blue.exits],
    [1, 1, 1],
    "Add to cart without checkout exits from the page it happened on",
  );
  assert.deepEqual(
    storeReport.pages.filter((row) => row.path.endsWith("/products/red-shoe")).map((row) => row.path),
    ["/products/red-shoe"],
    "Locale and collection prefixes are removed before grouping",
  );
  const product = storeReport.pages.find((row) => row.path === "/products/red-shoe");
  assert.deepEqual(
    [product.sessions, product.carts, product.conversions, product.exits],
    [1, 1, 1, 0],
    "A session that bought never exits from the product page",
  );
  const hidden = storeReport.pages.find((row) => row.path === "/private-page");
  assert.deepEqual([hidden.type, hidden.sessions, hidden.exits], [null, 1, 1]);
  assert.ok(!storeReport.pages.some((row) => /\/(account|orders)/.test(row.path)));
  assert.equal(storeReport.exitPaths.exitPages[0].path, "/collections/shoes");
  assert.equal(storeReport.exitPaths.exitPages[0].exitRate, 50);
  assert.ok(
    !storeReport.exitPaths.exitPages.some((row) => row.path === "/products/red-shoe"),
    "Buyers are not counted as exits",
  );
  // Store reports never show Engagement by zone or next pages, so they are not built.
  assert.equal(storeReport.engagement, null);
  assert.equal(storeReport.engagementUnavailable, false);
  assert.deepEqual(plain(storeReport.exitPaths.nextPages), []);

  const active = await report(storeProject.id, storeMeasurement.id, {
    ...all,
    audience: "active",
  });
  assert.equal(active.funnel.sessions, 4);
  assert.equal(active.engagementSummary.clickThroughRate, 75);
  assert.equal(active.pages.find((row) => row.path === "/collections/shoes").sessions, 3);

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
      // Themes that link product cards with `product.url | within: collection` use this form.
      visit("p5", "acq_p5", {
        exitType: "internal_link",
        exitUrl: "https://shop.example/collections/shoes/products/b",
        ctaClicks: click("main"),
      }),
    ],
  });
  const pageReport = await report(pageProject.id, pageMeasurement.id);
  assert.equal(pageReport.layout, "page");
  assert.equal(pageReport.pageType, "COLLECTION");
  assert.equal(pageReport.engagementSummary.clickThroughRate, 40);
  assert.deepEqual(
    plain(pageReport.exitPaths.outcomes)
      .filter((row) => row.pageViews)
      .map((row) => [row.type, row.pageViews]),
    [
      ["internal_link", 3],
      ["back_button", 1],
      ["unknown", 1],
    ],
  );
  assert.deepEqual(
    plain(pageReport.exitPaths.nextPages).map((row) => row.path).sort(),
    ["/collections/shoes/products/b", "/private-page", "/products/a"],
    "Query strings are removed and account paths are masked",
  );
  assert.deepEqual(plain(pageReport.pages), []);
  assert.deepEqual(plain(pageReport.exitPaths.exitPages), []);
  assert.ok(pageReport.engagement?.groups.length, "Page reports keep Engagement by zone");

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
    revenue: 0,
    pricedConversions: 0,
    unpricedConversions: 0,
  });
  assert.deepEqual(plain(imported.pages), []);
  // ── Revenue (spec 7.2): summed per session in the shop's currency, then given to
  // every page the converted session viewed.
  const revenueProject = await db.growthProject.create({
    data: { shop, title: "Revenue", goal: "Sum orders", scope: "STORE" },
  });
  const revenueStore = await db.storeSnapshot.create({
    data: {
      shop,
      name: "Revenue fixture",
      completionMode: "TIME_WINDOW",
      durationDays: 7,
      endsAt: new Date("2026-12-31"),
      usesAcquisitionSessions: true,
    },
  });
  const revenueMeasurement = await db.growthMeasurement.create({
    data: {
      projectId: revenueProject.id,
      name: "Revenue baseline",
      completionMode: "DURATION",
      durationDays: 7,
      storeSnapshotId: revenueStore.id,
    },
  });
  const order = (orderValue, currency) => ({ converted: true, convertedAt: later(5), orderValue, currency });
  const sale = (pageViewId, acquisitionId, pagePath, resourceType, extra = {}) => ({
    storeSnapshotId: revenueStore.id,
    sessionId: `browser-${acquisitionId}`,
    pageViewId,
    pagePath,
    resourceType,
    visitorType: "REAL",
    acquisitionId,
    acquisitionSource: "facebook",
    acquisitionStartedAt: t0,
    startedAt: t0,
    deviceType: "mobile",
    ...extra,
  });
  await db.storeSnapshotVisit.createMany({
    data: [
      // r1 bought twice: attribution wrote each order to a different page view of the session.
      sale("r1a", "acq_r1", "/collections/shoes", "COLLECTION", { deviceType: "desktop", ...order(30, "EUR") }),
      sale("r1b", "acq_r1", "/products/blue", "PRODUCT", { deviceType: "desktop", startedAt: later(1), ...order(20, "EUR") }),
      // r2 viewed two pages and bought once: its order counts on both pages.
      sale("r2a", "acq_r2", "/collections/shoes", "COLLECTION", { deviceType: "desktop", acquisitionSource: "google", ...order(40, "EUR") }),
      sale("r2b", "acq_r2", "/products/red", "PRODUCT", { deviceType: "desktop", acquisitionSource: "google", startedAt: later(1) }),
      // r3 paid in another currency; r4 has no amount; r6 has an amount but no currency.
      sale("r3", "acq_r3", "/products/red", "PRODUCT", order(25, "USD")),
      sale("r4", "acq_r4", "/products/red", "PRODUCT", order(null, null)),
      // r5 never bought.
      sale("r5", "acq_r5", "/pages/about", "PAGE"),
      sale("r6", "acq_r6", "/products/green", "PRODUCT", order(10, null)),
    ],
  });
  const eur = await report(revenueProject.id, revenueMeasurement.id, all, "EUR");
  assert.equal(eur.currency, "EUR");
  assert.deepEqual(
    [eur.sessions, eur.conversions, eur.revenue, eur.pricedConversions, eur.unpricedConversions],
    [6, 5, 90, 2, 3],
    "Only EUR amounts are summed; USD, a missing amount and a missing currency are unpriced",
  );
  assert.deepEqual(
    [eur.funnel.purchased, eur.funnel.revenue, eur.funnel.pricedConversions, eur.funnel.unpricedConversions],
    [5, 90, 2, 3],
  );
  const pageRevenue = (path) => {
    const row = eur.pages.find((item) => item.path === path);
    return [row.sessions, row.conversions, row.revenue, row.pricedConversions, row.unpricedConversions];
  };
  assert.deepEqual(pageRevenue("/collections/shoes"), [2, 2, 90, 2, 0], "r1's two orders and r2's order");
  assert.deepEqual(pageRevenue("/products/blue"), [1, 1, 50, 1, 0], "A session that bought twice brings both orders");
  assert.deepEqual(pageRevenue("/products/red"), [3, 3, 40, 1, 2], "r2 viewed it and bought; r3 and r4 are unpriced");
  assert.deepEqual(pageRevenue("/pages/about"), [1, 0, 0, 0, 0], "A page without conversions has zero revenue");
  assert.deepEqual(pageRevenue("/products/green"), [1, 1, 0, 0, 1], "An amount without a currency is not recorded");
  assert.deepEqual(
    plain(eur.channels).map((row) => [row.source, row.conversions, row.revenue, row.pricedConversions, row.unpricedConversions]),
    [
      ["facebook", 4, 50, 1, 3],
      ["google", 1, 40, 1, 0],
    ],
  );
  assert.deepEqual(
    plain(eur.engagementSummary.devices).map((row) => [
      row.device,
      row.sessions,
      row.conversions,
      row.revenue,
      row.pricedConversions,
      row.unpricedConversions,
    ]),
    [
      ["mobile", 4, 3, 0, 0, 3],
      ["desktop", 2, 2, 90, 2, 0],
    ],
  );
  const usd = await report(revenueProject.id, revenueMeasurement.id, all, "USD");
  assert.deepEqual(
    [usd.currency, usd.revenue, usd.pricedConversions, usd.unpricedConversions],
    ["USD", 25, 1, 4],
    "The shop currency decides which amounts count",
  );
  const unknown = await report(revenueProject.id, revenueMeasurement.id);
  assert.deepEqual(
    [unknown.currency, unknown.revenue, unknown.pricedConversions, unknown.unpricedConversions],
    [null, 0, 0, 5],
    "Without a shop currency nothing is summed",
  );
  const googleOnly = await report(revenueProject.id, revenueMeasurement.id, { ...all, source: "google" }, "EUR");
  assert.deepEqual(
    [googleOnly.conversions, googleOnly.revenue, googleOnly.pricedConversions],
    [1, 40, 1],
    "Revenue follows the same filters as the rate",
  );

  // Page capture (Visit): the same session bought twice from two loads of the page.
  const bootResource = await db.project.create({
    data: {
      shop,
      resourceType: "PRODUCT",
      productId: "gid://shopify/Product/9",
      productTitle: "Boot",
      productHandle: "boot",
    },
  });
  const bootProject = await db.growthProject.create({
    data: { shop, title: "Boot", goal: "Sell boots", scope: "PAGE", resourceProjectId: bootResource.id },
  });
  const bootSnapshot = await db.snapshot.create({
    data: { projectId: bootResource.id, number: 1, usesAcquisitionSessions: true },
  });
  const bootMeasurement = await db.growthMeasurement.create({
    data: {
      projectId: bootProject.id,
      name: "Boot baseline",
      completionMode: "VISITORS",
      targetVisitors: 100,
      snapshotId: bootSnapshot.id,
    },
  });
  const boot = (pageViewId, acquisitionId, extra = {}) => ({
    snapshotId: bootSnapshot.id,
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
      boot("b1", "acq_b1", order(30, "EUR")),
      boot("b2", "acq_b1", { startedAt: later(2), ...order(12, "EUR") }),
      boot("b3", "acq_b2", order(null, null)),
      boot("b4", "acq_b3"),
    ],
  });
  const bootReport = await report(bootProject.id, bootMeasurement.id, all, "EUR");
  assert.deepEqual(
    [bootReport.sessions, bootReport.conversions, bootReport.revenue, bootReport.pricedConversions, bootReport.unpricedConversions],
    [3, 2, 42, 1, 1],
    "Page captures sum a session's orders once per session",
  );
  assert.deepEqual(plain(bootReport.pages), []);

  // Imported channel capture: amounts were never recorded.
  const soldChannel = await db.channelSnapshot.create({ data: { shop, name: "Imported sale" } });
  await db.channelSnapshotSession.create({
    data: {
      channelSnapshotId: soldChannel.id,
      acquisitionId: "acq_sold",
      trackingSessionId: "browser-sold",
      source: "facebook",
      converted: true,
    },
  });
  const soldProject = await db.growthProject.create({
    data: { shop, title: "Imported sale", goal: "", scope: "STORE" },
  });
  const soldMeasurement = await db.growthMeasurement.create({
    data: {
      projectId: soldProject.id,
      name: "Imported sale",
      completionMode: "VISITORS",
      targetVisitors: 100,
      channelSnapshotId: soldChannel.id,
    },
  });
  const sold = await report(soldProject.id, soldMeasurement.id, all, "EUR");
  assert.deepEqual(
    [sold.conversions, sold.revenue, sold.pricedConversions, sold.unpricedConversions],
    [1, 0, 0, 1],
    "Imported channel captures show Not recorded",
  );

  // Imported customer capture: amounts sit on conversion events; pages must not multiply them.
  const journeys = await db.customerSnapshot.create({
    data: { shop, name: "Imported journeys", source: "facebook", destinationUrl: "https://shop.example/" },
  });
  const journey = (acquisitionId, converted) =>
    db.customerJourneySession.create({
      data: {
        snapshotId: journeys.id,
        acquisitionId,
        trackingSessionId: `browser-${acquisitionId}`,
        source: "facebook",
        landingPath: "/",
        startedAt: t0,
        lastSeenAt: later(5),
        visitorType: "REAL",
        converted,
      },
    });
  const j1 = await journey("acq_j1", true);
  const j2 = await journey("acq_j2", true);
  await journey("acq_j3", false);
  await db.customerJourneyPage.createMany({
    data: [
      { sessionId: j1.id, pageViewId: "j1a", pagePath: "/", startedAt: t0 },
      { sessionId: j1.id, pageViewId: "j1b", pagePath: "/products/boot", startedAt: later(1) },
    ],
  });
  await db.customerJourneyEvent.createMany({
    data: [
      { sessionId: j1.id, eventKey: "order-1", type: "conversion", occurredAt: later(3), orderId: "1", amount: 40, currency: "EUR" },
      { sessionId: j2.id, eventKey: "order-2", type: "conversion", occurredAt: later(3), orderId: "2", amount: 15, currency: "USD" },
      // Other events never carry revenue, even with an amount.
      { sessionId: j1.id, eventKey: "cart-1", type: "add_to_cart", occurredAt: later(2), amount: 99, currency: "EUR" },
    ],
  });
  const journeyProject = await db.growthProject.create({
    data: { shop, title: "Imported journeys", goal: "", scope: "STORE" },
  });
  const journeyMeasurement = await db.growthMeasurement.create({
    data: {
      projectId: journeyProject.id,
      name: "Imported journeys",
      completionMode: "VISITORS",
      targetVisitors: 100,
      customerSnapshotId: journeys.id,
    },
  });
  const journeyReport = await report(journeyProject.id, journeyMeasurement.id, all, "EUR");
  assert.deepEqual(
    [journeyReport.sessions, journeyReport.conversions, journeyReport.revenue, journeyReport.pricedConversions, journeyReport.unpricedConversions],
    [3, 2, 40, 1, 1],
    "A two-page journey counts its order once; the USD order is unpriced",
  );
  console.log(
    "PASS: funnel, click-through rule, searches, devices, medians, exit paths, page rows (buyers, private paths, URL variants), layout-only sections, cohorts, empty filters, imported measurements, and per-session revenue for store, page, channel and customer captures in the shop currency",
  );
} finally {
  await db.growthProject.deleteMany({ where: { shop } });
  await db.project.deleteMany({ where: { shop } });
  await db.storeSnapshot.deleteMany({ where: { shop } });
  await db.channelSnapshot.deleteMany({ where: { shop } });
  await db.customerSnapshot.deleteMany({ where: { shop } });
  await db.$disconnect();
}
