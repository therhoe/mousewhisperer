// DB-free A/B detail report math and variant snapshot contract checks.
// Run: node --test scripts/check-ab-test-detail-report.mjs
/* eslint jest/no-deprecated-functions: "off", jest/expect-expect: ["error", { "assertFunctionNames": ["assert", "assert.*"] }] */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function compilePureModule(path) {
  const source = read(path);
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const mod = { exports: {} };
  runInNewContext(compiled.outputText, {
    exports: mod.exports,
    module: mod,
    require,
  });
  return mod.exports;
}

const { buildCumulativeAbTestTrend, buildSourceQualityBreakdown } =
  compilePureModule("app/utils/ab-test-report.ts");
const { buildClickEngagement } = compilePureModule(
  "app/utils/click-engagement.ts",
);

const click = (label) =>
  JSON.stringify([{ label, tag: "button", zone: "main" }]);

test("cumulative A/B trends stay REAL-only, isolated, chronological, and event-time correct", () => {
  const controlRows = [
    {
      visitorType: "REAL",
      assignedAt: "2026-08-02T10:00:00.000Z",
      addedToCart: true,
      addedToCartAt: "2026-08-02T12:00:00.000Z",
      converted: true,
      convertedAt: "2026-08-03T08:00:00.000Z",
      orderValue: 100,
      ctaClicks: null,
      scrollDepth: 40,
      updatedAt: "2026-08-02T13:00:00.000Z",
    },
    {
      visitorType: "BOT",
      assignedAt: "2026-08-01T01:00:00.000Z",
      addedToCart: true,
      converted: true,
      convertedAt: "2026-08-01T02:00:00.000Z",
      orderValue: 9_999,
      ctaClicks: click("Bot noise"),
      scrollDepth: 100,
    },
    {
      visitorType: "REAL",
      assignedAt: "2026-08-01T23:30:00.000Z",
      addedToCart: false,
      converted: false,
      orderValue: null,
      ctaClicks: click("Control CTA"),
      scrollDepth: 20,
      updatedAt: "2026-08-02T01:00:00.000Z",
    },
    {
      visitorType: "ZOMBIE",
      assignedAt: "2026-08-02T04:00:00.000Z",
      addedToCart: true,
      converted: true,
      convertedAt: "2026-08-02T05:00:00.000Z",
      orderValue: 5_000,
      ctaClicks: click("Zombie noise"),
      scrollDepth: 90,
    },
  ];
  const variantRows = [
    {
      visitorType: "REAL",
      assignedAt: "2026-08-03T09:00:00.000Z",
      addedToCart: false,
      converted: false,
      orderValue: null,
      ctaClicks: null,
      scrollDepth: 60,
    },
    {
      visitorType: "REAL",
      assignedAt: "2026-08-01T10:00:00.000Z",
      addedToCart: true,
      addedToCartAt: "2026-08-01T12:00:00.000Z",
      converted: true,
      convertedAt: "2026-08-01T14:00:00.000Z",
      orderValue: 40,
      ctaClicks: click("Variant CTA"),
      scrollDepth: 80,
    },
  ];
  const options = {
    startAt: "2026-08-01T00:00:00.000Z",
    endAt: "2026-08-03T23:59:59.999Z",
    maxPoints: 45,
  };
  const control = buildCumulativeAbTestTrend(controlRows, options);
  const variant = buildCumulativeAbTestTrend(variantRows, options);

  assert.deepEqual(
    Array.from(control, (point) => point.date),
    ["2026-08-01", "2026-08-02", "2026-08-03"],
  );
  assert.deepEqual(
    Array.from(control, (point) => point.visitors),
    [1, 2, 2],
    "BOT and ZOMBIE assignments never enter the cumulative denominator",
  );
  assert.deepEqual(
    Array.from(control, (point) => point.conversions),
    [0, 0, 1],
    "A future conversion is not backfilled into earlier chart points",
  );
  assert.equal(control[1].addToCarts, 1);
  assert.equal(control[1].addToCartRate, 50);
  assert.equal(control[0].ctaVisitors, 0);
  assert.equal(control[0].avgScrollDepth, 0);
  assert.equal(control[1].ctaVisitors, 1);
  assert.equal(control[1].ctaClickRate, 50);
  assert.equal(control[1].avgScrollDepth, 30);
  assert.equal(control[2].conversionRate, 50);
  assert.equal(control[2].revenue, 100);
  assert.equal(control[2].revenuePerVisitor, 50);

  assert.deepEqual(
    Array.from(variant, (point) => point.visitors),
    [1, 1, 2],
  );
  assert.deepEqual(
    Array.from(variant, (point) => point.conversions),
    [1, 1, 1],
  );
  assert.equal(variant[0].conversionRate, 100);
  assert.equal(variant[2].conversionRate, 50);
  assert.equal(variant[2].revenue, 40);
  assert.equal(variant[2].revenuePerVisitor, 20);
  assert.equal(variant[2].avgScrollDepth, 70);
  assert.equal(
    control[2].revenue,
    100,
    "Variant revenue never leaks into Control A",
  );
  assert.equal(
    variant[2].revenue,
    40,
    "Control revenue never leaks into Variant B",
  );
});

test("source quality reports every traffic class while rates use REAL sessions only", () => {
  const rows = [
    {
      visitorType: "REAL",
      sourceCategory: "Organic Search",
      timeOnPage: 10_000,
      scrollDepth: 20,
      addedToCart: true,
      converted: false,
    },
    {
      visitorType: "REAL",
      sourceCategory: "Organic Search",
      timeOnPage: 30_000,
      scrollDepth: 60,
      addedToCart: false,
      converted: true,
    },
    {
      visitorType: "ZOMBIE",
      sourceCategory: "Organic Search",
      timeOnPage: 999_000,
      scrollDepth: 99,
      addedToCart: true,
      converted: true,
    },
    {
      visitorType: "BOT",
      sourceCategory: "Organic Search",
      timeOnPage: 999_000,
      scrollDepth: 99,
      addedToCart: true,
      converted: true,
    },
    {
      visitorType: "PENDING",
      sourceCategory: "Organic Search",
      timeOnPage: 999_000,
      scrollDepth: 99,
      addedToCart: true,
      converted: true,
    },
    {
      visitorType: "REAL",
      source: "newsletter",
      medium: "email",
      timeOnPage: 5_000,
      scrollDepth: 10,
      addedToCart: false,
      converted: false,
    },
    {
      visitorType: "REAL",
      sourceCategory: null,
      source: null,
      medium: null,
      timeOnPage: 1_000,
      scrollDepth: 5,
      addedToCart: false,
      converted: false,
    },
  ];
  const breakdown = buildSourceQualityBreakdown(rows);
  const organic = breakdown.find((row) => row.key === "organic search");
  const newsletter = breakdown.find((row) => row.key === "newsletter");
  const direct = breakdown.find((row) => row.key === "direct / unknown");

  assert.ok(organic);
  assert.equal(organic.sessions, 5);
  assert.equal(organic.real, 2);
  assert.equal(organic.zombies, 1);
  assert.equal(organic.bots, 1);
  assert.equal(organic.pending, 1);
  assert.equal(organic.realPercent, 40);
  assert.equal(organic.zombiePercent, 20);
  assert.equal(organic.botPercent, 20);
  assert.equal(organic.avgTimeOnPage, 20_000);
  assert.equal(organic.avgScrollDepth, 40);
  assert.equal(organic.addToCarts, 1);
  assert.equal(organic.addToCartRate, 50);
  assert.equal(organic.conversions, 1);
  assert.equal(organic.conversionRate, 50);
  assert.equal(newsletter?.label, "newsletter");
  assert.equal(newsletter?.sessions, 1);
  assert.equal(direct?.label, "Direct / unknown");
  assert.equal(direct?.sessions, 1);
  assert.equal(breakdown[0].key, "organic search");
});

test("image session reach is deduplicated across multiple page views in one variant session", () => {
  const imageClick = JSON.stringify([
    {
      label: "Product image",
      tag: "img",
      href: "https://cdn.shopify.com/files/shoe_400x.jpg?width=400",
      time: 1_000,
    },
  ]);
  const result = buildClickEngagement(
    [
      { sessionId: "session-1", ctaClicks: imageClick },
      { sessionId: "session-1", ctaClicks: imageClick },
      { sessionId: "session-2", ctaClicks: imageClick },
    ],
    2,
  );

  assert.equal(result.imageEngagement[0].clickCount, 3);
  assert.equal(result.imageEngagement[0].sessionCount, 2);
  assert.equal(result.imageEngagement[0].sessionPercent, 100);
});

test("variant snapshot endpoint is tenant-safe, variant-safe, and target-page scoped", () => {
  const route = read("app/routes/app.ab-tests.$id.report.tsx");
  const service = read("app/utils/ab-tests.server.ts");
  const snapshotService = service.slice(
    service.indexOf("export async function getAbVariantSnapshotStats"),
  );

  assert.match(route, /where:\s*\{\s*id:\s*params\.id,\s*shop\s*\}/);
  assert.match(route, /searchParams\.get\("variantId"\)/);
  assert.match(
    route,
    /getAbVariantSnapshotStats\(\{\s*shop,\s*testId:\s*test\.id,\s*variantId,\s*targetPageType:\s*test\.targetPageType/,
  );
  assert.match(
    route,
    /throw new Response\("Variant not found", \{ status: 404 \}\)/,
  );

  assert.match(
    service,
    /where:\s*\{\s*id:\s*variantId,\s*testId,\s*test:\s*\{\s*shop\s*\}/,
  );
  assert.match(
    service,
    /where:\s*\{\s*shop,\s*testId,\s*variantId,\s*\.\.\.abAssignmentFilterWhere\(filters\)\s*\}/,
  );
  assert.match(
    service,
    /shop,\s*testId,\s*variantId,\s*\.\.\.targetVariantVisitWhere\(targetPageType\)/,
  );
  assert.match(service, /if \(targetPageType === "CART"\)/);
  assert.match(service, /\{ resourceType \}/);
  assert.match(service, /targetPageType === "HOMEPAGE"/);
  assert.match(service, /pagePath:\s*\{\s*startsWith:\s*fallbackPath\s*\}/);

  assert.match(snapshotService, /const behaviorRows = visitHumans;/);
  assert.match(snapshotService, /const clickRows = behaviorRows\.map/);
  assert.match(
    snapshotService,
    /avgTimeOnPage:\s*average\(behaviorRows,\s*\(row\) => row\.timeOnPage\)/,
  );
  assert.match(
    snapshotService,
    /avgScrollDepth:\s*average\(behaviorRows,\s*\(row\) => row\.scrollDepth\)/,
  );
  assert.doesNotMatch(
    snapshotService,
    /const behaviorRows\s*=\s*visitHumans\.length\s*\?[^;]*assignmentHumans/,
    "A target-page snapshot must stay empty when it has no matching visits instead of borrowing assignment engagement",
  );
  assert.doesNotMatch(
    snapshotService,
    /average\(assignmentHumans,\s*\(row\) => row\.(?:timeOnPage|scrollDepth)\)/,
    "Target-page time and scroll metrics must never fall back to assignment rows",
  );
});

test("source behavior is calculated from target-page visits after the compact assignment query", () => {
  const service = read("app/utils/ab-tests.server.ts");
  const snapshotService = service.slice(
    service.indexOf("export async function getAbVariantSnapshotStats"),
  );

  assert.match(
    snapshotService,
    /const sourceQualityBreakdown = buildSourceQualityBreakdown\(\s*assignments,\s*filters\?\.audience \|\| "active",?\s*\);/,
    "Assignment rows may retain traffic-class and conversion outcome counts",
  );
  assert.match(snapshotService, /for \(const row of visitHumans\) \{/);
  assert.match(
    snapshotService,
    /avgTimeOnPage:\s*engagement\.timeOnPage \/ engagement\.visits/,
  );
  assert.match(
    snapshotService,
    /avgScrollDepth:\s*engagement\.scrollDepth \/ engagement\.visits/,
  );
  assert.match(
    snapshotService,
    /sourceQualityBreakdown:\s*sourceQualityWithVisitEngagement/,
    "The response must expose visit-derived source engagement, not the assignment defaults",
  );
  assert.doesNotMatch(
    snapshotService,
    /for \(const row of assignmentHumans\)[\s\S]{0,800}sourceVisitEngagement/,
    "Source time and scroll must remain scoped to target-page visits",
  );
});

test("Control A and Variant B tabs lazy-load one isolated snapshot at a time", () => {
  const component = read("app/components/AbTestDetailReport.tsx");
  const detailRoute = read("app/routes/app.ab-tests.$id.tsx");
  const tabsSource = component.slice(
    component.indexOf("function VariantSnapshotTabs"),
    component.indexOf("export function AbTestDetailReport"),
  );

  assert.match(component, /function VariantSnapshotTabs\(/);
  assert.match(
    component,
    /content:\s*row\.key === "A" \? t\("Control A"\) : t\("Variant B"\)/,
  );
  assert.match(
    component,
    /accessibilityLabel:.*page snapshot.*Control A.*Variant B/s,
  );
  assert.match(component, /<Tabs\s+tabs=\{tabs\}\s+selected=/s);
  assert.match(component, /role="tabpanel"/);
  assert.match(
    component,
    /requestedVariantIds\.current\.has\(activeSummary\.variantId\)/,
  );
  assert.match(component, /snapshotByVariantId\[activeSummary\.variantId\]/);
  assert.match(
    component,
    /snapshotFetcher\.load\(\s*`\/app\/ab-tests\/\$\{test\.id\}\/report\?variantId=\$\{encodeURIComponent\(/,
  );
  assert.match(
    component,
    /if \(\s*!open \|\|\s*!activeSummary \|\|\s*activeSnapshot/s,
  );
  assert.match(component, /not blended Page Snapshot traffic/);
  assert.match(
    component,
    /<VariantSnapshotTabs[\s\S]*?test=\{test\}\s+stats=\{stats\}\s+open=\{open\}\s+filterQuery=\{filterQuery\}/,
  );
  assert.doesNotMatch(
    detailRoute,
    /getAbVariantSnapshotStats/,
    "The main detail loader must not eagerly load either heavy variant snapshot",
  );

  assert.match(tabsSource, /const wasOpen = useRef\(open\);/);
  assert.match(tabsSource, /const reopened = open && !wasOpen\.current;/);
  assert.match(
    tabsSource,
    /if \(!reopened\) return;[\s\S]*setSnapshotByVariantId\(\{\}\);[\s\S]*requestedVariantIds\.current\.clear\(\);/,
    "Reopening must invalidate both the cached snapshots and request de-duplication set",
  );
  assert.match(
    tabsSource,
    /&refresh=\$\{Date\.now\(\)\}/,
    "The first request after reopen must bypass stale route/browser cache entries",
  );
  assert.match(
    tabsSource,
    /if \(!open \|\| snapshotFetcher\.state !== "idle"\) return;/,
    "A response that resolves after closing must not repopulate the cleared snapshot cache",
  );
});
