import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getCustomerJourney } from "../utils/customer-journey.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const journey = await getCustomerJourney(
    session.shop,
    params.id || "",
    params.sessionId || "",
    new URL(request.url).searchParams.get("page"),
  );
  if (!journey) throw new Response("Journey not found", { status: 404 });
  return Response.json(journey, { headers: { "Cache-Control": "private, no-store" } });
};

// Fetchers reach this route as a single-fetch .data request; Shopify needs
// these headers there so App Bridge can re-authenticate an expired session.
export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
