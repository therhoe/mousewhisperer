import { cachedValue } from "./loader-cache.server";

type Admin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const SHOP_CURRENCY_TTL_MS = 300_000;
const CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * The shop's currency (Admin GraphQL `shop.currencyCode`), cached for 5 minutes
 * per shop. Revenue is summed and shown in it (spec 7.2). Returns null when
 * Shopify does not answer with a currency code; a failure is not cached, so
 * the next request asks again.
 */
export async function getShopCurrency(
  admin: Admin,
  shop: string,
): Promise<string | null> {
  try {
    return await cachedValue(
      `shop-currency:${shop}`,
      SHOP_CURRENCY_TTL_MS,
      async () => {
        const response = await admin.graphql(
          `query ProjectGrowthCurrency { shop { currencyCode } }`,
        );
        const payload = await response.json();
        const code = payload?.data?.shop?.currencyCode;
        if (typeof code !== "string" || !CURRENCY_CODE.test(code))
          throw new Error("Shop currency unavailable");
        return code;
      },
    );
  } catch {
    return null;
  }
}
