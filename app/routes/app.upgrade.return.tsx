import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
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

// Fetchers reach this route as a single-fetch .data request; Shopify needs
// these headers there so App Bridge can re-authenticate an expired session.
export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
