// Local, DB-free interactive QA using the actual dashboard and Channel route components.
// Run: node scripts/preview-snapshot-changes.mjs, then open http://127.0.0.1:4181.
// Synthetic loaders/actions are confined to this loopback server, never the app routes.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const conversionFixture = {
  progress: {
    status: "ready",
    period: "month",
    periodLabel: "Month to date",
    currentLabel: "Aug 1–Aug 26, 2026",
    previousLabel: "Jul 1–Jul 26, 2026",
    rangeStart: "2026-08-01",
    rangeEnd: "2026-08-26",
    previousRangeStart: "2026-07-01",
    previousRangeEnd: "2026-07-26",
    currentRate: 2.5,
    previousRate: 2.2,
    currentSessions: 26000,
    currentCompletedCheckouts: 650,
    previousSessions: 26000,
    previousCompletedCheckouts: 572,
    deltaPoints: 0.3,
    deltaPercent: 13.6,
    source: "SHOPIFY_ANALYTICS",
    updatedAt: "2026-08-26T12:00:00.000Z",
    message: null,
    ...Object.fromEntries(
      [
        ["currentSeries", "08", 0],
        ["previousSeries", "07", -3],
      ].map(([key, month, offset]) => [
        key,
        Array.from({ length: 26 }, (_, i) => ({
          date: `2026-${month}-${String(i + 1).padStart(2, "0")}`,
          sessions: 1000,
          completedCheckouts: Math.round(25 + offset + 9 * Math.sin(i * 0.67)),
          conversionRate: (25 + offset + 9 * Math.sin(i * 0.67)) / 10,
        })),
      ]),
    ),
  },
  events: [
    ["OPTIMIZATION", "Updated product gallery", "2026-08-09", null],
    ["AB_TEST", "Product headline experiment", "2026-08-04", "2026-08-13"],
    ["SNAPSHOT", "Product measurement", "2026-08-12", null],
    ["STORE_SNAPSHOT", "Store baseline", "2026-08-17", null],
    ["CHANNEL_SNAPSHOT", "Channel measurement", "2026-08-22", null],
  ].map(([kind, title, start, end], i) => ({
    id: `qa-${i}`,
    kind,
    title,
    start,
    end,
    description: "Synthetic activity for local interaction testing.",
    category: null,
    scope: null,
    pagePath: null,
    sourceType: kind,
    editable: false,
  })),
};
const bundle = await build({
  absWorkingDir: root,
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"development"' },
  stdin: {
    resolveDir: root,
    loader: "tsx",
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { createBrowserRouter, RouterProvider, Link, Outlet, redirect } from 'react-router-dom';
      import { AppProvider, Page } from '@shopify/polaris';
      import i18n from '@shopify/polaris/locales/en.json';
      import { ConversionProgressCard } from './app/components/ConversionProgressCard';
      import { DashboardConversionPanel } from './app/components/DashboardConversionPanel';
      import ChannelIndex from './app/routes/app.channel-snapshots._index';
      import ChannelDetail from './app/routes/app.channel-snapshots.$id';
      import PageSnapshots from './app/routes/app.audits.$category';
      import { buildChannelReport } from './app/utils/channel-report';

      const dashboard = ${JSON.stringify(conversionFixture)};
      const snapshot = { id: 'qa-channel', name: 'Campaign traffic · QA', status: 'ACTIVE',
        completionMode: 'HUMAN_SESSIONS', targetSessions: 1000, durationDays: null,
        startedAt: '2026-08-20T10:00:00.000Z', endsAt: null, completedAt: null };
      const samples = ['Organic Search', 'Email', 'Paid Social', 'Direct'];
      const sessions = Array.from({ length: 160 }, (_, i) => ({
        id: String(i), channel: samples[i % 4], source: ['google', 'newsletter', 'facebook', null][i % 4],
        medium: ['organic', 'email', 'paid_social', null][i % 4], campaign: i % 4 === 3 ? null : 'Campaign ' + (i % 16),
        visitorType: i % 16 === 0 ? 'BOT' : i % 16 === 1 ? 'PENDING' : i % 3 === 0 ? 'ZOMBIE' : 'REAL',
        pageViews: 2, timeOnPage: 45000 + (i % 3) * 30000, averageScrollDepth: 45,
        addedToCart: i % 5 === 0, checkoutStarted: i % 10 === 0, converted: i % 20 === 0,
      }));
      const billingAccess = { plan: 'WHISPER', planName: 'Whisper', canCreateNormalSnapshot: true,
        usage: { normalSnapshots: 2, pageSnapshots: 1, channelSnapshots: 1, storeSnapshots: 1, abTests: 0 },
        limits: { normalSnapshots: 50, storeSnapshots: 10, abTests: 5, maxSnapshotTargetVisitors: 10000 } };
      let channelPreviewMode = 'data';
      const buckets = Array.from({ length: 7 }, (_, i) => '2026-08-' + String(20 + i) + 'T00:00:00.000Z');
      const isHuman = (session) => ['REAL', 'ZOMBIE'].includes(session.visitorType);
      const overview = {
        snapshot: { id: snapshot.id, name: snapshot.name, status: snapshot.status },
        range: { start: snapshot.startedAt, end: '2026-08-26T12:30:00.000Z', unit: 'day', truncated: false, timezone: 'UTC' }, buckets,
        updatedAt: '2026-08-26T12:30:00.000Z',
        channels: samples.map((channel) => ({ channel,
          humanSessions: sessions.filter((s) => s.channel === channel && isHuman(s)).length,
          points: buckets.map((_, bucket) => {
            const group = sessions.filter((s, i) => s.channel === channel && i % 7 === bucket);
            const humanSessions = group.filter(isHuman).length;
            const conversions = group.filter((s) => isHuman(s) && s.converted).length;
            return { sessions: group.length, humanSessions, conversions, conversionRate: humanSessions ? conversions / humanSessions * 100 : null };
          }) })),
        summary: { sessions: sessions.length, real: sessions.filter((s) => s.visitorType === 'REAL').length,
          humanSessions: sessions.filter(isHuman).length, conversions: sessions.filter((s) => isHuman(s) && s.converted).length,
          realShare: sessions.filter((s) => s.visitorType === 'REAL').length / sessions.length * 100,
          conversionRate: sessions.filter((s) => isHuman(s) && s.converted).length / sessions.filter(isHuman).length * 100 },
      };
      const indexLoader = async ({ request }) => {
        const query = new URL(request.url).searchParams;
        if (query.get('_overview') === '1') {
          await new Promise((resolve) => setTimeout(resolve, 350));
          if (channelPreviewMode === 'error') return { error: 'Synthetic graph service unavailable. Please retry the graph.' };
          if (channelPreviewMode === 'empty') return { overview: { ...overview, channels: [], summary: { sessions: 0, real: 0, humanSessions: 0, conversions: 0, realShare: null, conversionRate: null } } };
          return { overview };
        }
        const page = Number(query.get('page') || 1);
        return { snapshots: page === 1 ? [{ ...snapshot, _count: { sessions: sessions.length } }] : [],
          page, pageCount: 1, total: 1, activeSnapshotId: snapshot.status === 'ACTIVE' ? snapshot.id : null,
          billingAccess };
      };
      const categoryLoader = async ({ request, params }) => {
        const category = params.category || 'products';
        const resourceType = ({ products: 'PRODUCT', collections: 'COLLECTION', homepage: 'HOMEPAGE', pages: 'PAGE', blogs: 'BLOG' })[category];
        const label = category[0].toUpperCase() + category.slice(1);
        const query = new URL(request.url).searchParams;
        const shared = { shop: 'qa.myshopify.com', category, config: { label, resourceType, singular: category === 'homepage' ? 'homepage' : category.slice(0, -1) } };
        if (query.get('_activity') === '1') return { ...shared, activityCard: {
          id: resourceType.toLowerCase(), title: label, href: '/app/page-snapshots/' + category,
          scopeLabel: 'Across latest snapshots', runningCount: 1, runningLabel: 'active audit',
          kpis: [{ label: 'CVR', value: '2.5%' }, { label: 'Add to cart', value: '12%' }, { label: 'Revenue', value: '$450' }],
          chart: { metricLabel: 'Conversion rate', contextLabel: label + ' · QA comparison', axisLabel: 'Snapshot progress', currentLabel: 'Latest', previousLabel: 'Previous', current: [1, 2, 2, 3, 2.5], previous: [1, 1.5, 2, 2, 2] },
          previews: [], emptyLabel: 'No snapshots yet' } };
        if (query.get('_summary') !== '1') await new Promise((resolve) => setTimeout(resolve, 500));
        return { ...shared, billingAccess, summaryPending: query.get('_summary') !== '1',
          audits: [{ id: 'qa-project', productTitle: label + ' example', snapshotName: 'QA snapshot', snapshotCount: 1, status: 'ACTIVE', realCount: 100, targetVisitors: 1000, metricValues: { atcRate: 12, cvrRate: 2.5, revenue: 450 } }],
          baseline: { count: 1, metricValues: { atcRate: 10, cvrRate: 2, revenue: 400 } } };
      };
      const reportLoader = ({ request }) => {
        const query = new URL(request.url).searchParams;
        const filters = { channel: query.get('channel') || '', source: query.get('source') || '', campaign: query.get('campaign') || '' };
        const report = buildChannelReport(sessions, { ...filters, page: Number(query.get('page') || 1) });
        return { filters, report: { ...report, snapshot, progress: { label: 'Human sessions captured', current: 140, target: 1000, percent: 14 } } };
      };
      const router = createBrowserRouter([{ path: '/', element: <>
        <div style={{ padding: '12px 24px', background: '#fff4db', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <span>Local QA · synthetic data · no store changes</span><Link to='/'>Dashboard</Link><Link to='/async-dashboard'>Deferred dashboard</Link><Link to='/app/channel-snapshots'>Channel Snapshots</Link><Link to='/app/page-snapshots/products'>Page Snapshots</Link>
          <label>Channel QA state <select defaultValue='data' onChange={(event) => { channelPreviewMode = event.target.value; router.revalidate(); }}><option value='data'>With data</option><option value='empty'>No sessions</option><option value='error'>Graph unavailable</option></select></label>
        </div><Outlet />
      </>, children: [
        { index: true, element: <Page title='Dashboard'><div style={{ paddingBottom: 48 }}><ConversionProgressCard initialData={dashboard} shop='qa.myshopify.com' /></div></Page> },
        { path: 'async-dashboard', element: <Page title='Dashboard'><div style={{ paddingBottom: 48 }}><DashboardConversionPanel shop='qa.myshopify.com' /></div></Page> },
        { path: 'app/channel-snapshots', loader: indexLoader, element: <ChannelIndex />,
          action: async () => redirect('/app/channel-snapshots/qa-channel') },
        { path: 'app/channel-snapshots/:id', loader: reportLoader, element: <ChannelDetail />,
          action: async ({ request }) => { const data = await request.formData(); snapshot.status = ({ pause: 'PAUSED', resume: 'ACTIVE', complete: 'COMPLETED' })[data.get('action')]; return { success: true }; } },
        { path: 'api/dashboard-conversion', loader: () => dashboard },
        { path: 'app/page-snapshots/:category', loader: categoryLoader, element: <PageSnapshots /> },
      ] }]);
      createRoot(document.getElementById('root')).render(<AppProvider i18n={i18n}><RouterProvider router={router} /></AppProvider>);
    `,
  },
  plugins: [
    {
      name: "isolate-authenticated-route-ui",
      setup(builder) {
        builder.onResolve({ filter: /^@shopify\/app-bridge-react$/ }, () => ({
          path: "qa-titlebar",
          namespace: "qa",
        }));
        builder.onLoad({ filter: /.*/, namespace: "qa" }, () => ({
          contents:
            "export function TitleBar() { return null; } export function useAppBridge() { return bridge; } const bridge = { idToken: async () => 'local-qa-only' };",
          loader: "js",
        }));
        builder.onLoad(
          {
            filter:
              /app\.(?:channel-snapshots\.[^/]+|audits\.\$category)\.tsx$/,
          },
          ({ path }) => {
            const file = ts.createSourceFile(
              path,
              readFileSync(path, "utf8"),
              ts.ScriptTarget.Latest,
              true,
              ts.ScriptKind.TSX,
            );
            const statements = file.statements.filter((statement) => {
              if (ts.isImportDeclaration(statement)) {
                const specifier = statement.moduleSpecifier.text;
                if (
                  specifier.endsWith(".server") ||
                  specifier === "@remix-run/node"
                )
                  return false;
              }
              return !(
                ts.isVariableStatement(statement) &&
                statement.declarationList.declarations.some(
                  (declaration) =>
                    ts.isIdentifier(declaration.name) &&
                    ["loader", "action"].includes(declaration.name.text),
                )
              );
            });
            return {
              contents: ts
                .createPrinter()
                .printFile(ts.factory.updateSourceFile(file, statements)),
              loader: "tsx",
              resolveDir: fileURLToPath(
                new URL("../app/routes/", import.meta.url),
              ),
            };
          },
        );
      },
    },
  ],
});
const css = readFileSync(
  new URL(
    "../node_modules/@shopify/polaris/build/esm/styles.css",
    import.meta.url,
  ),
);
const js = bundle.outputFiles[0].contents;
const html =
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Snapshot changes — local QA</title><link rel="stylesheet" href="/qa.css"></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>';
createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  response.setHeader("Cache-Control", "no-store");
  if (pathname === "/api/dashboard-conversion") {
    response.setHeader("Content-Type", "application/json");
    setTimeout(() => response.end(JSON.stringify(conversionFixture)), 500);
    return;
  }
  response.setHeader(
    "Content-Type",
    pathname === "/qa.js"
      ? "text/javascript"
      : pathname === "/qa.css"
        ? "text/css"
        : "text/html",
  );
  response.end(
    pathname === "/qa.js" ? js : pathname === "/qa.css" ? css : html,
  );
}).listen(4181, "127.0.0.1", () =>
  console.log("Synthetic snapshot UI QA: http://127.0.0.1:4181"),
);
