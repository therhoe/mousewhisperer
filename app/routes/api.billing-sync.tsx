import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { reconcileShopBillingFromShopify } from "../utils/billing.server";
import { cachedValue, loaderCacheKeys } from "../utils/loader-cache.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  try {
    const changed = await cachedValue(
      loaderCacheKeys.billingSync(shop),
      300_000,
      async () => {
        const before = await prisma.shopBilling.findUnique({ where: { shop } });
        // This only refreshes our existing billing mirror; it does not create,
        // cancel or change any Shopify subscription or charge.
        const after = await reconcileShopBillingFromShopify(admin, shop);
        return Boolean(
          after &&
          (before?.plan !== after.plan ||
            before?.status !== after.status ||
            before?.currentPeriodEnd?.getTime() !==
              after.currentPeriodEnd?.getTime()),
        );
      },
    );
    return json(
      { billingReconciled: true, changed },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    console.warn("[billing] Background reconciliation unavailable", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    // A background refresh is not an authorization decision. Keep the page
    // usable; creation and upgrade still perform their fresh server checks.
    return json(
      { billingReconciled: true, changed: false },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
};
