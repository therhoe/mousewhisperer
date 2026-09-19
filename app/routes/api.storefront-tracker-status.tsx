import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
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
  return json(
    { trackerStatus },
    { headers: { "Cache-Control": "private, no-store" } },
  );
};
