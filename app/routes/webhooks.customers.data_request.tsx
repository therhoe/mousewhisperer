import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * GDPR customers/data_request webhook handler
 *
 * This webhook is triggered when a customer requests their data under GDPR/CCPA.
 *
 * MouseWhisperer does NOT store any customer-identifiable data:
 * - We track anonymous visitor sessions (not logged-in customer accounts)
 * - IP addresses are stored for geo-location but not linked to Shopify customer IDs
 * - We don't store customer emails, names, or purchase history
 *
 * Therefore, we acknowledge the request but have no customer-specific data to return.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log(`Customer data request for customer ID: ${payload.customer?.id}`);

  // MouseWhisperer tracks anonymous visitor sessions on product pages.
  // We do not store data linked to Shopify customer IDs, so there is no
  // customer-specific data to return.
  //
  // The shop owner should be informed that this app:
  // - Collects anonymous engagement metrics (scroll depth, time on page, etc.)
  // - Stores IP addresses for geo-location (not linked to customer accounts)
  // - Does not store emails, names, or personally identifiable customer data

  return new Response(null, { status: 200 });
};
