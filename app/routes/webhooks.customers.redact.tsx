import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { normalizeOrderId } from "../utils/customer-journey";

/**
 * GDPR customers/redact webhook handler
 *
 * This webhook is triggered when a customer requests data deletion under GDPR/CCPA.
 *
 * Customer journeys do not store account identities or contact information,
 * but their order references can be linked to a customer by the merchant.
 * Delete the entire matching journey using Shopify's supplied order IDs.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);

    // Customer journeys keep order IDs for purchase deduplication. Shopify
    // supplies the affected orders even though we never store customer names.
    const orderIds = (
      Array.isArray(payload.orders_to_redact) ? payload.orders_to_redact : []
    )
      .map(normalizeOrderId)
      .filter((id: string | null): id is string => Boolean(id));
    if (orderIds.length)
      await db.customerJourneySession.deleteMany({
        where: {
          snapshot: { shop },
          events: { some: { orderId: { in: orderIds } } },
        },
      });

    console.log(`Received ${topic} webhook for ${shop}`);

    return new Response(null, { status: 200 });
  } catch (error) {
    // Return 401 for HMAC verification failures (required by Shopify)
    if (error instanceof Response) {
      return new Response("Unauthorized", { status: 401 });
    }
    throw error;
  }
};
