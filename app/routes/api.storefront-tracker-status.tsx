import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getStorefrontTrackerStatus } from "../utils/storefront-tracker-status.server";
import { cachedValue } from "../utils/loader-cache.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const trackerStatus = await cachedValue(
    `tracker-status:${session.shop}`,
    60_000,
    () => getStorefrontTrackerStatus(admin, session.shop),
  );
  return Response.json(
    { trackerStatus },
    { headers: { "Cache-Control": "private, no-store" } },
  );
};

// Fetchers reach this route as a single-fetch .data request; Shopify needs
// these headers there so App Bridge can re-authenticate an expired session.
export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
