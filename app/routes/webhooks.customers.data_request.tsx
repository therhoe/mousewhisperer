import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { normalizeOrderId } from "../utils/customer-journey";
import { createNotification } from "../utils/notifications.server";

/**
 * GDPR customers/data_request webhook handler
 *
 * This webhook is triggered when a customer requests their data under GDPR/CCPA.
 *
 * Customer journeys store order references for deduplication. Find requested
 * journeys using Shopify's order IDs and alert the merchant, who can export
 * the relevant session from the authenticated report.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);

    const orderIds = (
      Array.isArray(payload.orders_requested) ? payload.orders_requested : []
    )
      .map(normalizeOrderId)
      .filter((id: string | null): id is string => Boolean(id));
    if (orderIds.length) {
      const journeys = await db.customerJourneySession.findMany({
        where: {
          snapshot: { shop },
          events: { some: { orderId: { in: orderIds } } },
        },
        select: { id: true, snapshotId: true },
      });
      for (const journey of journeys)
        await createNotification({
          shop,
          type: "PRIVACY_REQUEST",
          title: "Customer journey data requested",
          message:
            "Shopify forwarded a customer data request. Review and export this matching journey for the requester.",
          referenceId: `journey-privacy:${payload.data_request?.id || "orders"}:${journey.id}`,
          linkUrl: `/app/customer-snapshots/${journey.snapshotId}?journey=${journey.id}`,
        });
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    // Return 401 for HMAC verification failures (required by Shopify)
    if (error instanceof Response) {
      return new Response("Unauthorized", { status: 401 });
    }
    throw error;
  }
};
