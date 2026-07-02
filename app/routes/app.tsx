import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import type { ShouldRevalidateFunction } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  Link,
  Outlet,
  PrefetchPageLinks,
  useLoaderData,
  useLocation,
  useNavigation,
  useRouteError,
} from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { NavMenu } from "@shopify/app-bridge-react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import { COMMUNITY_FEATURES_ENABLED } from "../utils/features";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const startedAt = Date.now();
  await authenticate.admin(request);

  if (process.env.NODE_ENV === "development") {
    console.info("[MW Perf] app layout loader", {
      durationMs: Date.now() - startedAt,
      path: new URL(request.url).pathname,
    });
  }

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export const shouldRevalidate: ShouldRevalidateFunction = () => false;

const APP_NAV_ITEMS = [
  { label: "Dashboard", to: "/app" },
  { label: "Store snapshot", to: "/app/store-snapshots" },
  { label: "A/B tests", to: "/app/ab-tests" },
  { label: "Products", to: "/app/audits/products" },
  { label: "Collections", to: "/app/audits/collections" },
  { label: "Homepage", to: "/app/audits/homepage" },
  { label: "Pages", to: "/app/audits/pages" },
  { label: "Blogs", to: "/app/audits/blogs" },
];

const PREFETCH_ROUTES = [
  "/app",
  "/app/store-snapshots",
  "/app/ab-tests",
  "/app/audits/products",
  "/app/audits/collections",
  "/app/audits/homepage",
  "/app/audits/pages",
  "/app/audits/blogs",
];

if (COMMUNITY_FEATURES_ENABLED) {
  PREFETCH_ROUTES.push("/app/challenges");
}

function getRouteTitle(pathname: string) {
  if (pathname === "/app") return "Dashboard";
  if (pathname.includes("/store-snapshots")) return "Store snapshots";
  if (pathname.includes("/ab-tests")) return "A/B tests";
  if (pathname.includes("/audits/products")) return "Products";
  if (pathname.includes("/audits/collections")) return "Collections";
  if (pathname.includes("/audits/homepage")) return "Homepage";
  if (pathname.includes("/audits/pages")) return "Pages";
  if (pathname.includes("/audits/blogs")) return "Blogs";
  if (pathname.includes("/project/")) return "Audit details";
  if (pathname.includes("/challenges")) return "Challenges";
  return "Loading";
}

function AppRoutePrefetcher() {
  const [prefetchCount, setPrefetchCount] = useState(0);

  useEffect(() => {
    const timers: number[] = [];
    const startTimer = window.setTimeout(() => {
      PREFETCH_ROUTES.forEach((_, index) => {
        timers.push(
          window.setTimeout(() => {
            setPrefetchCount((current) => Math.max(current, index + 1));
          }, index * 180),
        );
      });
    }, 450);

    return () => {
      window.clearTimeout(startTimer);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return (
    <>
      {PREFETCH_ROUTES.slice(0, prefetchCount).map((page) => (
        <PrefetchPageLinks key={page} page={page} />
      ))}
    </>
  );
}

function InstantRouteShell({ pathname }: { pathname: string }) {
  const title = getRouteTitle(pathname);

  return (
    <main
      aria-busy="true"
      aria-live="polite"
      style={{
        minHeight: "calc(100vh - 57px)",
        padding: "24px",
        background: "var(--p-color-bg)",
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              width: Math.max(140, Math.min(260, title.length * 13)),
              height: 28,
              borderRadius: 6,
              background: "var(--p-color-bg-surface-secondary)",
              marginBottom: 10,
            }}
          />
          <div
            style={{
              width: 320,
              maxWidth: "70%",
              height: 14,
              borderRadius: 6,
              background: "var(--p-color-bg-surface-secondary)",
            }}
          />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              style={{
                minHeight: 132,
                padding: 20,
                border: "1px solid var(--p-color-border-subdued)",
                borderRadius: 8,
                background: "var(--p-color-bg-surface)",
              }}
            >
              <div
                style={{
                  width: "46%",
                  height: 18,
                  borderRadius: 5,
                  background: "var(--p-color-bg-surface-secondary)",
                  marginBottom: 22,
                }}
              />
              <div
                style={{
                  width: "82%",
                  height: 12,
                  borderRadius: 5,
                  background: "var(--p-color-bg-surface-secondary)",
                  marginBottom: 10,
                }}
              />
              <div
                style={{
                  width: "68%",
                  height: 12,
                  borderRadius: 5,
                  background: "var(--p-color-bg-surface-secondary)",
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

function AppLocalNav({ activePathname }: { activePathname: string }) {
  const location = useLocation();
  const pathname = activePathname || location.pathname;

  return (
    <nav
      aria-label="Mouse Whisperer sections"
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: "12px 24px",
        borderBottom: "1px solid var(--p-color-border-subdued)",
        background: "var(--p-color-bg-surface)",
        overflowX: "auto",
      }}
    >
      {APP_NAV_ITEMS.map((item) => {
        const active =
          item.to === "/app"
            ? pathname === "/app"
            : pathname === item.to || pathname.startsWith(`${item.to}/`);

        return (
          <Link
            key={item.to}
            to={item.to}
            prefetch="render"
            style={{
              flex: "0 0 auto",
              padding: "6px 10px",
              borderRadius: 6,
              color: active ? "var(--p-color-text-brand)" : "var(--p-color-text)",
              background: active ? "var(--p-color-bg-surface-brand-selected)" : "transparent",
              fontSize: 13,
              fontWeight: active ? 650 : 500,
              lineHeight: "20px",
              textDecoration: "none",
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function AppBridgeNav() {
  return (
    <NavMenu>
      <Link to="/app" rel="home">
        Dashboard
      </Link>
      <Link to="/app/store-snapshots">Store snapshot</Link>
      <Link to="/app/audits/products">Products</Link>
      <Link to="/app/audits/collections">Collections</Link>
      <Link to="/app/audits/homepage">Homepage</Link>
      <Link to="/app/audits/pages">Pages</Link>
      <Link to="/app/audits/blogs">Blogs</Link>
      {COMMUNITY_FEATURES_ENABLED && <Link to="/app/challenges">Challenges</Link>}
    </NavMenu>
  );
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigation = useNavigation();
  const pendingPathname = navigation.location?.pathname;
  const isRouteTransition =
    navigation.state === "loading" &&
    typeof pendingPathname === "string" &&
    pendingPathname.startsWith("/app") &&
    pendingPathname !== location.pathname;

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <AppRoutePrefetcher />
      <AppBridgeNav />
      <AppLocalNav activePathname={pendingPathname || location.pathname} />
      {isRouteTransition ? <InstantRouteShell pathname={pendingPathname} /> : <Outlet />}
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
