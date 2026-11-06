import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getGrowthMetrics } from "../utils/growth-metrics.server";
import { isConversionPeriod } from "../utils/shopify-analytics.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const period = new URL(request.url).searchParams.get("period");
  return Response.json(
    await getGrowthMetrics({
      shop: session.shop,
      admin,
      sessionScope: session.scope,
      period: isConversionPeriod(period) ? period : "month",
    }),
    { headers: { "Cache-Control": "private, no-store" } },
  );
};

// Fetchers reach this route as a single-fetch .data request; Shopify needs
// these headers there so App Bridge can re-authenticate an expired session.
export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
