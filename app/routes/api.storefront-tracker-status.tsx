import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getStorefrontTrackerStatus } from "../utils/storefront-tracker-status.server";
import { getWebPixelStatus } from "../utils/web-pixel.server";
import { cachedValue, clearCacheKey } from "../utils/loader-cache.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const trackerKey = `tracker-status:${session.shop}`;
  const pixelKey = `pixel-status:${session.shop}`;
  const [trackerStatus, pixelStatus] = await Promise.all([
    cachedValue(trackerKey, 60_000, () =>
      getStorefrontTrackerStatus(admin, session.shop),
    ),
    cachedValue(pixelKey, 60_000, () => getWebPixelStatus(admin)),
  ]);
  // "unknown" means the check failed, not that the answer is unknown for a
  // minute: forget it so the next request, including Retry, asks again.
  if (trackerStatus.status === "unknown") clearCacheKey(trackerKey);
  if (pixelStatus === "unknown") clearCacheKey(pixelKey);
  return Response.json(
    { trackerStatus, pixelStatus },
    { headers: { "Cache-Control": "private, no-store" } },
  );
};

// Fetchers reach this route as a single-fetch .data request; Shopify needs
// these headers there so App Bridge can re-authenticate an expired session.
export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
