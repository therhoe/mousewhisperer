import type { EmbeddedFilterContext } from "./embedded-filter-params";

/** Call only with session.shop returned by authenticate.admin(). */
export function embeddedContextForShop(
  shop: string,
): EmbeddedFilterContext | null {
  const match = /^([a-z0-9][a-z0-9-]*)\.myshopify\.com$/i.exec(shop);
  if (!match) return null;
  const handle = match[1].toLowerCase();
  return {
    shop: `${handle}.myshopify.com`,
    // This is the canonical admin host format used by Shopify's API SDK.
    host: Buffer.from(`admin.shopify.com/store/${handle}`).toString("base64"),
    embedded: "1",
  };
}
