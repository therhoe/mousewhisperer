import { GrowthProjectError } from "./growth-projects";

type Admin = {
  graphql: (query: string, options?: any) => Promise<Response>;
};

export function assertPublishedOnlineStoreProduct(
  product: { status?: string; publishedAt?: string | null } | null | undefined,
) {
  const publishedAt = product?.publishedAt
    ? Date.parse(product.publishedAt)
    : NaN;
  // onlineStoreUrl can be null on a password-protected development store.
  // publishedAt specifically represents publication to the Online Store and
  // is available with read_products; no publication-management scope is needed.
  if (
    product?.status !== "ACTIVE" ||
    !Number.isFinite(publishedAt) ||
    publishedAt > Date.now()
  ) {
    throw new GrowthProjectError(
      "Choose a product published to the Online Store.",
    );
  }
}

/** Read-only preflight for a new test, including reused/legacy page projects. */
export async function requirePublishedProductTarget(
  admin: Admin,
  pagePath: string,
) {
  const handle = /^\/products\/([^/]+)$/.exec(pagePath)?.[1];
  if (!handle) {
    throw new GrowthProjectError(
      "Choose a product published to the Online Store.",
    );
  }
  let data;
  try {
    const response = await admin.graphql(
      `query ProjectProductAvailability($handle: String!) {
        productByIdentifier(identifier: { handle: $handle }) {
          id handle status publishedAt
        }
      }`,
      { variables: { handle } },
    );
    const result = await response.json();
    if (!response.ok || result.errors?.length || !result.data) {
      throw new Error("Product availability query failed");
    }
    data = result.data;
  } catch {
    throw new GrowthProjectError(
      "Shopify could not verify product availability. Please retry.",
      503,
    );
  }
  assertPublishedOnlineStoreProduct(data.productByIdentifier);
}
