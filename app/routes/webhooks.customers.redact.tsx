import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { orderAttributionId } from "../utils/order-id";
import { redactOrderLinks } from "../utils/order-attribution.server";

/**
 * GDPR customers/redact webhook handler
 *
 * This webhook is triggered when a customer requests data deletion under GDPR/CCPA.
 *
 * Customer journeys do not store account identities or contact information,
 * but their order references can be linked to a customer by the merchant.
 * Delete the entire matching journey using Shopify's supplied order IDs. On
 * measurement visits and A/B assignments of those orders, remove the order IDs and
 * the visit fields that can identify a person (IP, city, region, user agent).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);

    // Customer journeys keep order IDs for purchase deduplication. Shopify
    // supplies the affected orders even though we never store customer names.
    const orderIds = (
      Array.isArray(payload.orders_to_redact) ? payload.orders_to_redact : []
    )
      .map((id: unknown) => orderAttributionId(id))
      .filter((id: string | null): id is string => Boolean(id));
    if (orderIds.length) {
      await db.customerJourneySession.deleteMany({
        where: {
          snapshot: { shop },
          events: { some: { orderId: { in: orderIds } } },
        },
      });
      // Measurement rows keep the order id only to count each order once; their
      // counts and revenue stay, without the order link or identifying fields.
      await redactOrderLinks(db, shop, orderIds);
    }

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
