import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * GDPR customers/data_request webhook handler
 *
 * This webhook is triggered when a customer requests their data under GDPR/CCPA.
 *
 * Mouse Whisperer does NOT store any customer-identifiable data:
 * - We track anonymous visitor sessions (not logged-in customer accounts)
 * - IP addresses are stored for geo-location but not linked to Shopify customer IDs
 * - We don't store customer emails, names, or purchase history
 *
 * Therefore, we acknowledge the request but have no customer-specific data to return.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);
    console.log(`Customer data request for customer ID: ${payload.customer?.id}`);

    // Mouse Whisperer tracks anonymous visitor sessions on product pages.
    // We do not store data linked to Shopify customer IDs, so there is no
    // customer-specific data to return.

    return new Response(null, { status: 200 });
  } catch (error) {
    // Return 401 for HMAC verification failures (required by Shopify)
    if (error instanceof Response) {
      return new Response("Unauthorized", { status: 401 });
    }
    throw error;
  }
};
