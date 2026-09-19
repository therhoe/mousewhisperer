type ShopifyAdminClient = {
  graphql: (query: string, options?: any) => Promise<Response>;
};

export type WebPixelSetupResult =
  | { ready: true; pixelId: string; changed: boolean }
  | {
      ready: false;
      reason: "invalid_shop" | "invalid_endpoint" | "setup_failed";
      message: string;
    };

type WebPixel = { id: string; settings: unknown };
type PixelMutation = {
  userErrors?: Array<{ code?: string; message?: string }>;
  webPixel?: WebPixel | null;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const ensuredPixelShops = new Map<
  string,
  { pixelId: string; checkedAt: number }
>();
const pendingPixelShops = new Map<string, Promise<WebPixelSetupResult>>();

const WEB_PIXEL_QUERY = `#graphql
  query CurrentAppWebPixel {
    webPixel { id settings }
  }
`;

const WEB_PIXEL_CREATE = `#graphql
  mutation ConfigureAppWebPixelCreate($webPixel: WebPixelInput!) {
    webPixelCreate(webPixel: $webPixel) {
      userErrors { code field message }
      webPixel { id settings }
    }
  }
`;

const WEB_PIXEL_UPDATE = `#graphql
  mutation ConfigureAppWebPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
    webPixelUpdate(id: $id, webPixel: $webPixel) {
      userErrors { code field message }
      webPixel { id settings }
    }
  }
`;

function readSettings(value: unknown): Record<string, unknown> | null {
  try {
    const settings = typeof value === "string" ? JSON.parse(value) : value;
    return settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function graphqlData(
  admin: ShopifyAdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, any>> {
  const response = await admin.graphql(
    query,
    variables ? { variables } : undefined,
  );
  if (!response.ok) throw new Error("Web pixel API request failed");
  const payload = await response.json();
  if (
    !payload ||
    payload.errors?.length ||
    !payload.data ||
    typeof payload.data !== "object"
  ) {
    throw new Error("Web pixel API returned errors");
  }
  return payload.data;
}

async function currentPixel(
  admin: ShopifyAdminClient,
): Promise<WebPixel | null> {
  // Omitting id queries this app's own pixel, not another app's pixel on the shop.
  const data = await graphqlData(admin, WEB_PIXEL_QUERY);
  if (data.webPixel === null) return null;
  if (typeof data.webPixel?.id !== "string" || !data.webPixel.id) {
    throw new Error("Web pixel lookup returned an invalid record");
  }
  return data.webPixel;
}

function verifiedPixel(payload: PixelMutation | undefined, endpoint: string) {
  if (
    !payload ||
    !Array.isArray(payload.userErrors) ||
    payload.userErrors.length ||
    typeof payload.webPixel?.id !== "string" ||
    !payload.webPixel.id ||
    readSettings(payload.webPixel.settings)?.apiEndpoint !== endpoint
  )
    throw new Error("Web pixel settings could not be verified");
  return payload.webPixel;
}

async function configureExistingPixel(
  admin: ShopifyAdminClient,
  pixel: WebPixel,
  endpoint: string,
): Promise<WebPixelSetupResult> {
  const settings = readSettings(pixel.settings);
  if (settings?.apiEndpoint === endpoint) {
    return { ready: true, pixelId: pixel.id, changed: false };
  }
  const data = await graphqlData(admin, WEB_PIXEL_UPDATE, {
    id: pixel.id,
    webPixel: {
      settings: JSON.stringify({ ...settings, apiEndpoint: endpoint }),
    },
  });
  const updated = verifiedPixel(data.webPixelUpdate, endpoint);
  return { ready: true, pixelId: updated.id, changed: true };
}

async function configurePixel(
  admin: ShopifyAdminClient,
  endpoint: string,
): Promise<WebPixelSetupResult> {
  const existing = await currentPixel(admin);
  if (existing) return configureExistingPixel(admin, existing, endpoint);
  const data = await graphqlData(admin, WEB_PIXEL_CREATE, {
    webPixel: { settings: JSON.stringify({ apiEndpoint: endpoint }) },
  });
  const result = data.webPixelCreate as PixelMutation | undefined;
  // A different worker can win the creation race after our lookup. Re-query
  // and verify/update that record rather than declaring an unverified success.
  if (result?.userErrors?.some((error) => error.code === "TAKEN")) {
    const createdElsewhere = await currentPixel(admin);
    if (createdElsewhere)
      return configureExistingPixel(admin, createdElsewhere, endpoint);
  }
  const created = verifiedPixel(result, endpoint);
  return { ready: true, pixelId: created.id, changed: true };
}

export async function ensureWebPixel(
  admin: ShopifyAdminClient,
  shop: string,
): Promise<WebPixelSetupResult> {
  const normalizedShop =
    typeof shop === "string" ? shop.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalizedShop)) {
    return {
      ready: false,
      reason: "invalid_shop",
      message: "Checkout tracking requires a valid Shopify store.",
    };
  }

  let endpoint: string;
  try {
    const appUrl =
      process.env.SHOPIFY_APP_URL || "https://mousewhisperer.vercel.app";
    const url = new URL("/api/track", appUrl);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error("Invalid app URL");
    }
    // Pixel requests use the app origin, so Shopify's app-proxy shop parameter
    // is unavailable. Store it in this app's per-shop pixel settings instead.
    url.searchParams.set("shop", normalizedShop);
    endpoint = url.toString();
  } catch {
    return {
      ready: false,
      reason: "invalid_endpoint",
      message: "Checkout tracking could not be configured for this app URL.",
    };
  }

  const key = `${normalizedShop}|${endpoint}`;
  const cached = ensuredPixelShops.get(key);
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return { ready: true, pixelId: cached.pixelId, changed: false };
  }
  ensuredPixelShops.delete(key);
  const pending = pendingPixelShops.get(key);
  if (pending) return pending;

  const setup = configurePixel(admin, endpoint)
    .then((result) => {
      if (result.ready)
        ensuredPixelShops.set(key, {
          pixelId: result.pixelId,
          checkedAt: Date.now(),
        });
      return result;
    })
    .catch(
      (): WebPixelSetupResult => ({
        ready: false,
        reason: "setup_failed",
        message:
          "Shopify checkout tracking could not be configured. Retry setup before relying on checkout metrics.",
      }),
    )
    .finally(() => pendingPixelShops.delete(key));
  pendingPixelShops.set(key, setup);
  // Existing audit callers may ignore this result and remain nonfatal. Channel
  // setup can surface the failure; unsuccessful requests never enter the cache.
  return setup;
}
