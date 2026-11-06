import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import type { ShouldRevalidateFunction } from "react-router";
import {
  Outlet,
  useLoaderData,
  useLocation,
  useNavigation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import enPolaris from "@shopify/polaris/locales/en.json";
import dePolaris from "@shopify/polaris/locales/de.json";
import zhCNPolaris from "@shopify/polaris/locales/zh-CN.json";
import zhTWPolaris from "@shopify/polaris/locales/zh-TW.json";

import { authenticate } from "../shopify.server";
import { embeddedContextForShop } from "../utils/embedded-filter-context.server";
import { BackgroundBillingSync } from "../components/BackgroundBillingSync";
import { useBackInterceptor } from "../components/polaris/navigation";
import { PolarisLink } from "../components/PolarisLink";
import { POLARIS_URL } from "../utils/polaris";
import { COMMUNITY_FEATURES_ENABLED } from "../utils/features";
import { I18nProvider, useI18n } from "../utils/i18n";
import { resolveRequestLocale } from "../utils/i18n.server";
import {
  isPageSnapshotsPath,
  PAGE_SNAPSHOTS_PATH,
} from "../utils/page-snapshot-navigation";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const startedAt = Date.now();
  const { session } = await authenticate.admin(request);

  if (process.env.NODE_ENV === "development") {
    console.info("[MW Perf] app layout loader", {
      durationMs: Date.now() - startedAt,
      path: new URL(request.url).pathname,
    });
  }

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
    embeddedContext: embeddedContextForShop(session.shop),
    locale: await resolveRequestLocale(request, session.shop),
  };
};

export const shouldRevalidate: ShouldRevalidateFunction = ({
  formAction,
  currentUrl,
  nextUrl,
}) =>
  Boolean(
    formAction && new URL(formAction, currentUrl).pathname === "/api/locale",
  ) ||
  currentUrl.searchParams.get("locale") !==
    nextUrl.searchParams.get("locale") ||
  currentUrl.searchParams.get("shop") !== nextUrl.searchParams.get("shop");

// Spec 4.1: the app name opens Home; then Projects, A/B tests, Plans, Settings.
const APP_NAV_ITEMS = [
  { label: "Projects", to: "/app/projects" },
  { label: "A/B tests", to: "/app/ab-tests" },
  { label: "Plans", to: "/app/plans" },
  { label: "Settings", to: "/app/settings" },
];
// s-link has no typed `rel`; App Bridge reads it to mark the home link.
const HOME_LINK = { rel: "home" } as const;

function getRouteTitle(pathname: string) {
  if (pathname === "/app") return "Dashboard";
  if (pathname.startsWith("/app/projects")) return "Projects";
  if (pathname.startsWith("/app/plans") || pathname.startsWith("/app/upgrade")) return "Plans";
  if (pathname.startsWith("/app/settings")) return "Settings";
  if (pathname.startsWith("/app/store-snapshots")) return "Store Snapshots";
  if (pathname.startsWith("/app/channel-snapshots")) return "Channel Snapshots";
  if (pathname.startsWith("/app/customer-snapshots"))
    return "Customer Snapshots";
  if (pathname.startsWith("/app/ab-tests")) return "A/B Tests";
  if (isPageSnapshotsPath(pathname)) return "Page Snapshots";
  if (pathname.includes("/challenges")) return "Challenges";
  return "Loading";
}

function InstantRouteShell({ pathname }: { pathname: string }) {
  const { t } = useI18n();
  const title = t(getRouteTitle(pathname));

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

function AppNav() {
  const { t } = useI18n();
  useBackInterceptor();
  return (
    <s-app-nav>
      <s-link href="/app" {...HOME_LINK}>
        Snapshot
      </s-link>
      {APP_NAV_ITEMS.map((item) => (
        <s-link key={item.to} href={item.to}>
          {t(item.label)}
        </s-link>
      ))}
      {COMMUNITY_FEATURES_ENABLED && (
        <s-link href="/app/challenges">{t("Challenges")}</s-link>
      )}
    </s-app-nav>
  );
}

const polarisTranslations = {
  en: enPolaris,
  de: dePolaris,
  "zh-CN": zhCNPolaris,
  "zh-TW": zhTWPolaris,
};

function AppContent({ apiKey }: { apiKey: string }) {
  const { locale } = useI18n();
  const location = useLocation();
  const navigation = useNavigation();
  const pendingPathname = navigation.location?.pathname;
  const isPageSnapshotCategoryTransition =
    location.pathname.startsWith(`${PAGE_SNAPSHOTS_PATH}/`) &&
    pendingPathname?.startsWith(`${PAGE_SNAPSHOTS_PATH}/`);
  const isRouteTransition =
    navigation.state === "loading" &&
    typeof pendingPathname === "string" &&
    pendingPathname.startsWith("/app") &&
    pendingPathname !== location.pathname &&
    !isPageSnapshotCategoryTransition;

  return (
    <ShopifyAppProvider apiKey={apiKey} polarisUrl={POLARIS_URL}>
      <PolarisAppProvider
        i18n={polarisTranslations[locale]}
        linkComponent={PolarisLink}
      >
        <BackgroundBillingSync />
        <AppNav />
        {isRouteTransition ? (
          <InstantRouteShell pathname={pendingPathname} />
        ) : (
          <Outlet />
        )}
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}

export default function App() {
  const { apiKey, locale, shop } = useLoaderData<typeof loader>();
  return (
    <I18nProvider locale={locale} shop={shop}>
      <AppContent apiKey={apiKey} />
    </I18nProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
