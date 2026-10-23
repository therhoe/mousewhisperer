/** Exact page targeting is independent of the Project's reporting filters. */
export function normalizeAbTargetPath(value?: string | null): string | null {
  const input = String(value || "").trim();
  if (!input || (!input.startsWith("/") && !/^https?:\/\//i.test(input)))
    return null;
  try {
    const url = new URL(input, "https://store.invalid");
    if (!/^https?:$/.test(url.protocol)) return null;
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, "") || "/";
    return path.startsWith("/") && !path.includes("\\") ? path : null;
  } catch {
    return null;
  }
}

export function abTargetPathForResource(resource: {
  resourceType: string;
  productHandle: string;
}): string | null {
  if (resource.resourceType === "HOMEPAGE") return "/";
  const prefix: Record<string, string> = {
    PRODUCT: "/products/",
    COLLECTION: "/collections/",
    PAGE: "/pages/",
    BLOG: "/blogs/",
  };
  const root = prefix[resource.resourceType];
  if (!root || !resource.productHandle) return null;
  return normalizeAbTargetPath(
    resource.productHandle.startsWith("/")
      ? resource.productHandle
      : root + resource.productHandle,
  );
}

export function abTargetPathMatchesType(
  path: string | null,
  type: string,
): boolean {
  if (!path) return false;
  if (type === "HOMEPAGE") return path === "/";
  if (type === "CART") return path === "/cart";
  const roots: Record<string, string> = {
    PRODUCT: "/products/",
    COLLECTION: "/collections/",
    PAGE: "/pages/",
    BLOG: "/blogs/",
  };
  return Boolean(
    roots[type] &&
    path.startsWith(roots[type]) &&
    path.length > roots[type].length,
  );
}

export type AbReportFilters = {
  audience: "all" | "active";
  source: string;
  medium: string;
  campaign: string;
};

export function parseAbReportFilters(
  params: URLSearchParams,
  defaults?: {
    defaultSource?: string | null;
    defaultMedium?: string | null;
    defaultCampaign?: string | null;
  } | null,
): AbReportFilters {
  const value = (key: string, fallback?: string | null) =>
    String(params.has(key) ? params.get(key) : fallback || "")
      .trim()
      .slice(0, 255);
  return {
    audience: params.get("audience") === "active" ? "active" : "all",
    source: value("source", defaults?.defaultSource),
    medium: value("medium", defaults?.defaultMedium),
    campaign: value("campaign", defaults?.defaultCampaign),
  };
}

export function abReportFilterQuery(filters: AbReportFilters): string {
  return new URLSearchParams(filters).toString();
}
