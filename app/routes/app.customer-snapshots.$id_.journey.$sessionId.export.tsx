import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { exportCustomerJourney } from "../utils/customer-journey.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const data = await exportCustomerJourney(
    session.shop,
    params.id || "",
    params.sessionId || "",
  );
  if (!data) throw new Response("Journey not found", { status: 404 });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "Content-Disposition": 'attachment; filename="customer-journey.json"',
    },
  });
};
