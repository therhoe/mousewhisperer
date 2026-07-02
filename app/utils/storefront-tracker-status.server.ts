type ShopifyAdminClient = {
  graphql: (query: string, options?: any) => Promise<Response>;
};

export type StorefrontTrackerStatus = {
  status: "active" | "missing" | "unknown";
  storefrontUrl: string;
  checkedAt: string;
  message: string;
};

const STATUS_TTL_MS = 5 * 60_000;
const NEGATIVE_STATUS_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 3_500;
const statusCache = new Map<string, { expiresAt: number; value: StorefrontTrackerStatus }>();

const STOREFRONT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
};

export async function getStorefrontTrackerStatus(
  admin: ShopifyAdminClient,
  shop: string,
): Promise<StorefrontTrackerStatus> {
  const cached = statusCache.get(shop);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const storefrontUrls = await getStorefrontUrls(admin, shop);
  const storefrontUrl = storefrontUrls[0];
  const checkedAt = new Date().toISOString();

  try {
    const checks = await Promise.all(storefrontUrls.map((url) => fetchTrackerStatus(url)));
    const activeCheck = checks.find((check) => check.status === "active");
    if (activeCheck) {
      return cacheStatus(shop, {
        status: "active",
        storefrontUrl: activeCheck.storefrontUrl,
        checkedAt,
        message: "Rich storefront tracking is detected on the live theme.",
      });
    }

    const checkedPage = checks.find((check) => check.responseOk);
    if (checkedPage) {
      return cacheStatus(shop, {
        status: "missing",
        storefrontUrl: checkedPage.storefrontUrl,
        checkedAt,
        message: "Rich storefront tracking is not detected on the live theme.",
      });
    }

    const responseStatuses = checks
      .map((check) => check.statusCode)
      .filter((status): status is number => typeof status === "number");

    return cacheStatus(shop, {
      status: "unknown",
      storefrontUrl,
      checkedAt,
      message:
        responseStatuses.length > 0
          ? `Could not verify rich storefront tracking. Storefront returned ${responseStatuses.join(", ")}.`
          : "Could not verify rich storefront tracking from the live theme.",
    });
  } catch {
    return cacheStatus(shop, {
      status: "unknown",
      storefrontUrl,
      checkedAt,
      message: "Could not verify rich storefront tracking from the live theme.",
    });
  }
}

async function fetchTrackerStatus(storefrontUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(storefrontUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: STOREFRONT_HEADERS,
    });

    if (!response.ok) {
      return {
        status: "unknown" as const,
        storefrontUrl,
        responseOk: false,
        statusCode: response.status,
      };
    }

    const html = await response.text();
    const hasTracker =
      html.includes("__TRACKING_API_ENDPOINT__") ||
      html.includes("/apps/api") ||
      html.includes("tracker.js") ||
      html.includes("Mouse Whisperer Tracker");

    return {
      status: hasTracker ? ("active" as const) : ("missing" as const),
      storefrontUrl: response.url || storefrontUrl,
      responseOk: true,
      statusCode: response.status,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getStorefrontUrls(admin: ShopifyAdminClient, shop: string) {
  const urls = new Set<string>();
  try {
    const response = await admin.graphql(`#graphql
      query StorefrontTrackingDomain {
        shop {
          myshopifyDomain
          primaryDomain {
            host
            url
          }
        }
      }
    `);
    const payload = await response.json();
    const primaryUrl = payload?.data?.shop?.primaryDomain?.url;
    if (typeof primaryUrl === "string" && primaryUrl.startsWith("http")) {
      urls.add(primaryUrl);
    }
    const primaryHost = payload?.data?.shop?.primaryDomain?.host;
    if (typeof primaryHost === "string" && primaryHost.length > 0) {
      urls.add(`https://${primaryHost}`);
    }
  } catch {
    // Fall back to the myshopify domain below.
  }

  urls.add(`https://${shop}`);
  return Array.from(urls);
}

function cacheStatus(shop: string, value: StorefrontTrackerStatus) {
  const ttl = value.status === "active" ? STATUS_TTL_MS : NEGATIVE_STATUS_TTL_MS;
  statusCache.set(shop, { value, expiresAt: Date.now() + ttl });
  return value;
}
