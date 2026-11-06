export const DEFAULT_MANAGED_PRICING_APP_HANDLE = "mousewhisperer";

/** Shopify's managed pricing page for this app, in the shop's admin. */
export function managedPricingUrl(shop: string) {
  const storeHandle = shop.replace(".myshopify.com", "");
  const appHandle =
    process.env.SHOPIFY_MANAGED_PRICING_APP_HANDLE || DEFAULT_MANAGED_PRICING_APP_HANDLE;
  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
}
