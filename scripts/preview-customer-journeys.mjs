// Actual route components with synthetic loaders/actions on loopback only.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.SNAPSHOT_PREVIEW_PORT || 4183);
let failNextExport = process.env.SNAPSHOT_PREVIEW_FAIL_EXPORT_ONCE === "1";
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
    import { AppProvider } from '@shopify/polaris';
    import i18n from '@shopify/polaris/locales/en.json';
    import Index from './app/routes/app.customer-snapshots._index';
    import Detail from './app/routes/app.customer-snapshots.$id';
    let snapshot = { id: 'qa', name: 'Summer sale · Facebook journeys', source: 'facebook', medium: 'paid_social', campaign: 'summer_sale', adId: '123', destinationUrl: 'https://store.example/products/shoe', status: 'ACTIVE', targetSessions: 1000, startedAt: '2026-09-16T09:00:00.000Z', endsAt: '2026-09-23T09:00:00.000Z', _count: { sessions: 23 } };
    const sessions = Array.from({ length: 23 }, (_, i) => ({ id: 'visitor-' + i, startedAt: '2026-09-16T10:' + String(i).padStart(2, '0') + ':00.000Z', lastSeenAt: '2026-09-16T10:30:00.000Z', landingPath: i % 2 ? '/products/everyday-shoe' : '/collections/summer-collection', visitorType: i % 4 ? 'REAL' : 'ZOMBIE', addedToCart: i % 3 === 0, checkoutStarted: i % 5 === 0, converted: i % 6 === 0, truncated: false, _count: { pages: 3 + i % 4, events: 35 } }));
    const billing = { planName: 'Whisper', canCreateNormalSnapshot: true, usage: { normalSnapshots: 10 }, limits: { maxSnapshotTargetVisitors: 10000, normalSnapshots: 50 } };
    const router = createBrowserRouter([{ element: <><div style={{ padding: 12, background: '#eaf4ff' }}>Local preview · synthetic data · <Link to='/app/customer-snapshots'>Customer Snapshots</Link></div><Outlet /></>, children: [
      { path: '/app/customer-snapshots', element: <Index />, loader: () => ({ snapshots: [snapshot], billing, page: 1, pageCount: 1, total: 1, activeId: null }), action: async ({ request }) => { const f = await request.formData(); if (!f.get('name') || !f.get('destinationUrl')) return { error: 'Enter a snapshot name and landing URL.' }; snapshot = { ...snapshot, name: f.get('name') }; return redirect('/app/customer-snapshots/qa'); } },
      { path: '/app/customer-snapshots/:id', element: <Detail />, loader: ({ request }) => { const page = Number(new URL(request.url).searchParams.get('page') || 1); return { snapshot, sessions: sessions.slice((page - 1) * 10, page * 10), total: 23, humans: 23, carts: 8, checkouts: 5, conversions: 4, page, pageCount: 3 }; }, action: async ({ request }) => { const action = (await request.formData()).get('action'); snapshot = { ...snapshot, status: action === 'pause' ? 'PAUSED' : action === 'resume' ? 'ACTIVE' : 'COMPLETED' }; return { success: true, error: null }; } },
      { path: '/app/customer-snapshots/:id/journey/:sessionId', loader: ({ request, params }) => { const page = Number(new URL(request.url).searchParams.get('page') || 1); return { session: { id: params.sessionId, source: 'facebook', campaign: 'summer_sale', adId: '123', startedAt: '2026-09-16T10:00:00.000Z', _count: { events: 35 } }, events: Array.from({ length: page === 1 ? 30 : 5 }, (_, n) => ({ id: params.sessionId + '-' + page + '-' + n, type: ['page_view', 'click', 'add_to_cart', 'checkout_started', 'conversion'][n % 5], occurredAt: new Date(Date.UTC(2026, 8, 16, 10, page * 3, n)).toISOString(), pagePath: '/products/everyday-shoe', label: n % 5 === 1 ? 'Size guide' : null, targetPath: n % 5 === 1 ? '/pages/sizing' : null, amount: n % 5 === 4 ? 48.5 : null, currency: 'USD' })), page, pageCount: 2 }; } },
    ] }]);
    createRoot(document.getElementById('root')).render(<AppProvider i18n={i18n}><RouterProvider router={router} /></AppProvider>);
  `,
  },
  plugins: [
    {
      name: "local-route-ui",
      setup(builder) {
        builder.onResolve({ filter: /^@shopify\/app-bridge-react$/ }, () => ({
          path: "qa-bridge",
          namespace: "qa",
        }));
        builder.onLoad({ filter: /.*/, namespace: "qa" }, () => ({
          contents:
            "export function TitleBar() { return null; } export function useAppBridge() { return { idToken: async () => 'local-fixture-only' }; }",
          loader: "js",
        }));
        builder.onLoad(
          { filter: /app\.customer-snapshots\.[^/]+\.tsx$/ },
          ({ path }) => {
            const file = ts.createSourceFile(
              path,
              readFileSync(path, "utf8"),
              ts.ScriptTarget.Latest,
              true,
              ts.ScriptKind.TSX,
            );
            const statements = file.statements.filter((s) => {
              if (
                ts.isImportDeclaration(s) &&
                (s.moduleSpecifier.text.endsWith(".server") ||
                  s.moduleSpecifier.text === "@remix-run/node" ||
                  s.importClause?.isTypeOnly)
              )
                return false;
              return !(
                ts.isVariableStatement(s) &&
                s.declarationList.declarations.some(
                  (d) =>
                    ts.isIdentifier(d.name) &&
                    ["loader", "action"].includes(d.name.text),
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
const html =
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Customer journeys · local QA</title><link rel="stylesheet" href="/qa.css"></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>';
createServer((request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  const exportMatch = path.match(
    /^\/app\/customer-snapshots\/qa\/journey\/(visitor-\d+)\/export$/,
  );
  if (exportMatch) {
    // Only synthetic fixture data, never a Shopify session/token.
    if (failNextExport) {
      failNextExport = false;
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Synthetic export failure" }));
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="customer-journey.json"',
    );
    response.end(
      JSON.stringify({
        id: exportMatch[1],
        snapshotId: "qa",
        pages: [],
        events: [{ type: "click", label: "Fixture export" }],
      }),
    );
    return;
  }
  response.setHeader(
    "Content-Type",
    path === "/qa.js"
      ? "text/javascript"
      : path === "/qa.css"
        ? "text/css"
        : "text/html",
  );
  response.end(
    path === "/qa.js"
      ? bundle.outputFiles[0].contents
      : path === "/qa.css"
        ? css
        : html,
  );
}).listen(port, "127.0.0.1", () =>
  console.log(
    `Customer journey preview: http://127.0.0.1:${port}/app/customer-snapshots`,
  ),
);
