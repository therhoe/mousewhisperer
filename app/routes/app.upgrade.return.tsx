import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate, isShopifyBillingTestMode } from "../shopify.server";
import { BILLING_PLAN_NAMES, SIGNAL_PLAN } from "../utils/billing-plans";
import { syncShopBillingFromSubscription } from "../utils/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const billingCheck = await billing.check({
    plans: [...BILLING_PLAN_NAMES],
    isTest: isShopifyBillingTestMode(),
  });

  const subscriptions = billingCheck.appSubscriptions || [];
  const subscription =
    subscriptions.find((candidate) => candidate.name === SIGNAL_PLAN) ||
    subscriptions[0];

  if (!subscription) {
    return redirect("/app/upgrade?billing=not-approved");
  }

  await syncShopBillingFromSubscription(session.shop, subscription);
  return redirect("/app/upgrade?billing=approved");
};
