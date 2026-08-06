import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { syncShopBillingFromSubscription } from "../utils/billing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { payload, shop, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    const subscription =
      (payload as any).app_subscription || (payload as any).appSubscription || payload;

    await syncShopBillingFromSubscription(shop, {
      id: subscription.admin_graphql_api_id || subscription.id,
      name: subscription.name,
      status: subscription.status,
      current_period_end:
        subscription.current_period_end || subscription.currentPeriodEnd,
    });

    return new Response();
  } catch (error) {
    if (error instanceof Response) {
      return new Response("Unauthorized", { status: 401 });
    }
    throw error;
  }
};
