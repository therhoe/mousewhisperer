const ensuredPixelShops = new Set<string>();

type ShopifyAdminClient = {
  graphql: (query: string, options?: any) => Promise<Response>;
};

export async function ensureWebPixel(admin: ShopifyAdminClient, shop: string) {
  if (ensuredPixelShops.has(shop)) return;

  const appUrl = process.env.SHOPIFY_APP_URL || "https://mousewhisperer.vercel.app";
  const trackingEndpoint = `${appUrl}/api/track`;

  try {
    await admin.graphql(
      `#graphql
        mutation webPixelCreate($webPixel: WebPixelInput!) {
          webPixelCreate(webPixel: $webPixel) {
            userErrors {
              code
              field
              message
            }
            webPixel {
              id
              settings
            }
          }
        }
      `,
      {
        variables: {
          webPixel: {
            settings: JSON.stringify({ apiEndpoint: trackingEndpoint }),
          },
        },
      },
    );
  } catch {
    // Existing pixels and non-critical setup failures should not block audit creation.
  } finally {
    ensuredPixelShops.add(shop);
  }
}
