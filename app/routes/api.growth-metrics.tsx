import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getGrowthMetrics } from "../utils/growth-metrics.server";
import { isConversionPeriod } from "../utils/shopify-analytics.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const period = new URL(request.url).searchParams.get("period");
  return json(
    await getGrowthMetrics({
      shop: session.shop,
      admin,
      sessionScope: session.scope,
      period: isConversionPeriod(period) ? period : "month",
    }),
    { headers: { "Cache-Control": "private, no-store" } },
  );
};
