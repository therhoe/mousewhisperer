import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
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
  return json(journey, { headers: { "Cache-Control": "private, no-store" } });
};
