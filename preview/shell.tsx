import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider, Frame, Navigation } from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";

import IndexPage from "./index-page";
import IndexPageV2 from "./index-page-v2";
import AuditsPage from "./audits-page";
import type { Category } from "./data";

// ══════════════════════════════════════════════════════
// PREVIEW SHELL — sidebar nav that swaps between pages
// ══════════════════════════════════════════════════════

type Route =
  | { kind: "dashboard" }
  | { kind: "dashboard-v2" }
  | { kind: "audits"; category: Category };

const AUDIT_CATEGORIES: Category[] = ["products", "collections", "pages", "blogs"];
const AUDIT_LABELS: Record<Category, string> = {
  products: "Products",
  collections: "Collections",
  pages: "Pages",
  blogs: "Blogs",
};

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] === "audits" && AUDIT_CATEGORIES.includes(parts[1] as Category)) {
    return { kind: "audits", category: parts[1] as Category };
  }
  if (parts[0] === "dashboard-v2") return { kind: "dashboard-v2" };
  return { kind: "dashboard" };
}

function routeToHash(r: Route): string {
  switch (r.kind) {
    case "dashboard":
      return "/dashboard";
    case "dashboard-v2":
      return "/dashboard-v2";
    case "audits":
      return `/audits/${r.category}`;
  }
}

function routeKey(r: Route): string {
  return routeToHash(r);
}

function Shell() {
  const [route, setRoute] = useState<Route>(() => parseHash());

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const currentKey = routeKey(route);

  const navigate = (r: Route) => {
    window.location.hash = routeToHash(r);
  };

  const navMarkup = (
    <Navigation location={`#${currentKey}`}>
      <Navigation.Section
        title="Testing"
        items={[
          {
            label: "Challenges",
            url: `#/dashboard`,
            selected: currentKey === "/dashboard",
            onClick: () => navigate({ kind: "dashboard" }),
          },
          {
            label: "Dashboard",
            url: `#/dashboard-v2`,
            selected: currentKey === "/dashboard-v2",
            onClick: () => navigate({ kind: "dashboard-v2" }),
          },
          ...AUDIT_CATEGORIES.map((cat) => ({
            label: AUDIT_LABELS[cat],
            url: `#/audits/${cat}`,
            selected: currentKey === `/audits/${cat}`,
            onClick: () => navigate({ kind: "audits", category: cat }),
          })),
        ]}
      />
    </Navigation>
  );

  let body: React.ReactNode;
  switch (route.kind) {
    case "dashboard":
      body = <IndexPage />;
      break;
    case "dashboard-v2":
      body = <IndexPageV2 />;
      break;
    case "audits":
      body = <AuditsPage category={route.category} />;
      break;
  }

  return (
    <AppProvider i18n={{}}>
      <Frame navigation={navMarkup}>{body}</Frame>
    </AppProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Shell />);
