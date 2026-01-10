import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * GDPR customers/redact webhook handler
 *
 * This webhook is triggered when a customer requests data deletion under GDPR/CCPA.
 *
 * MouseWhisperer does NOT store any customer-identifiable data:
 * - We track anonymous visitor sessions (not logged-in customer accounts)
 * - Session IDs are randomly generated and not linked to Shopify customer IDs
 * - IP addresses are stored for geo-location but not linked to customer accounts
 * - We don't store emails, names, or any data that could identify specific customers
 *
 * Therefore, we acknowledge the request but have no customer-specific data to delete.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);
    console.log(`Customer redact request for customer ID: ${payload.customer?.id}`);

    // MouseWhisperer tracks anonymous visitor sessions.
    // We cannot link our data to specific Shopify customers because:
    // 1. We don't store Shopify customer IDs in our Visit records
    // 2. Session IDs are randomly generated browser sessions, not customer accounts
    // 3. IP addresses cannot be reliably matched to customer IDs

    return new Response(null, { status: 200 });
  } catch (error) {
    // Return 401 for HMAC verification failures (required by Shopify)
    if (error instanceof Response) {
      return new Response("Unauthorized", { status: 401 });
    }
    throw error;
  }
};
