import { register } from "@shopify/web-pixels-extension";

register(({ settings, configuration, analytics, browser }) => {
  const apiEndpoint = settings?.apiEndpoint || configuration?.apiEndpoint;
  const COOKIE_NAME = "mw_sid"; // Must match tracker.js cookie name
  const ACQUISITION_COOKIE_NAME = "mw_csid";
  const ACQUISITION_DATA_COOKIE = "mw_acq";
  const ACQUISITION_STORAGE_KEY = "mw_acquisition_v1";
  const RICH_TRACKER_COOKIE = "mw_rich_seen";
  const RICH_TRACKER_RECENCY_MS = 30 * 60 * 1000;

  // Helper to get session ID from cookie (set by tracker.js)
  async function getSessionIdFromCookie() {
    try {
      const cookie = await browser.cookie.get(COOKIE_NAME);
      // browser.cookie.get returns the value string directly, not an object
      if (cookie) {
        return cookie;
      }
    } catch (e) {
      // Cookie access may fail in sandboxed context
    }
    return null;
  }

  // Extract session ID from cart/checkout attributes (most reliable method)
  function getSessionIdFromAttributes(attributes) {
    if (!attributes || !Array.isArray(attributes)) return null;
    for (let i = 0; i < attributes.length; i++) {
      if (attributes[i].key === "_mw_sid" && attributes[i].value) {
        return attributes[i].value;
      }
    }
    return null;
  }

  function validAcquisitionId(value) {
    return typeof value === "string" && /^acq_[a-zA-Z0-9_-]{8,100}$/.test(value)
      ? value
      : null;
  }

  function acquisitionRecord(value, sessionId) {
    if (typeof value !== "string" || value.length > 8192) return null;
    try {
      let record;
      try {
        record = JSON.parse(value);
      } catch (e) {
        record = JSON.parse(decodeURIComponent(value));
      }
      const now = Date.now();
      return record?.version === 1 &&
        record.trackingSessionId === sessionId &&
        validAcquisitionId(record.id) &&
        Number.isFinite(record.startedAt) &&
        Number.isFinite(record.lastActivityAt) &&
        record.lastActivityAt >= record.startedAt &&
        record.lastActivityAt <= now + 60000 &&
        now - record.lastActivityAt < RICH_TRACKER_RECENCY_MS
        ? record
        : null;
    } catch (e) {
      return null;
    }
  }

  async function resolveAcquisitionSessionId(attributes, sessionId) {
    // An explicit checkout pair is stronger than any subsequently changed
    // browser cookie or another tab's acquisition.
    if (
      Array.isArray(attributes) &&
      getSessionIdFromAttributes(attributes) === sessionId
    ) {
      for (const attribute of attributes) {
        if (attribute?.key === "_mw_csid") {
          const id = validAcquisitionId(attribute.value);
          if (id) return id;
        }
      }
    }
    // The pixel browser API exposes top-frame, per-tab sessionStorage. Prefer
    // its bound acquisition so a newer arrival in another tab cannot take
    // credit for this tab's add-to-cart or checkout event.
    try {
      const record = acquisitionRecord(
        await browser.sessionStorage.getItem(ACQUISITION_STORAGE_KEY),
        sessionId,
      );
      if (record) return record.id;
    } catch (e) {
      /* Unavailable storage falls back to a matching cookie pair. */
    }
    try {
      const [idValue, cookieSessionId, recordValue] = await Promise.all([
        browser.cookie.get(ACQUISITION_COOKIE_NAME),
        browser.cookie.get(COOKIE_NAME),
        browser.cookie.get(ACQUISITION_DATA_COOKIE),
      ]);
      if (cookieSessionId && cookieSessionId !== sessionId) return null;
      const id = validAcquisitionId(idValue);
      const record = acquisitionRecord(recordValue, sessionId);
      if (record) return record.id === id ? id : null;
      // Legacy-compatible fallback when only the two ID cookies are available.
      // Never combine a cart's old SID with an unrelated acquisition cookie.
      return !recordValue && cookieSessionId === sessionId ? id : null;
    } catch (e) {
      return null;
    }
  }

  async function richThemeTrackerIsRecent() {
    try {
      const value = await browser.cookie.get(RICH_TRACKER_COOKIE);
      const timestamp = Number(value);
      return (
        Number.isFinite(timestamp) &&
        Date.now() - timestamp < RICH_TRACKER_RECENCY_MS
      );
    } catch (e) {
      return false;
    }
  }

  async function resolveSessionId(checkoutAttributes, options = {}) {
    let sessionId = getSessionIdFromAttributes(checkoutAttributes);
    let source = sessionId ? "cart_attributes" : null;

    if (!sessionId && options.requireCartAttributes) {
      return null;
    }

    if (
      !sessionId &&
      options.requireRecentRichTracker &&
      !(await richThemeTrackerIsRecent())
    ) {
      return null;
    }

    if (!sessionId) {
      sessionId = await getSessionIdFromCookie();
      source = sessionId ? "cookie" : null;
    }

    return sessionId ? { sessionId, source } : null;
  }

  // Send event to our API
  async function sendEvent(eventType, data, checkoutAttributes, options = {}) {
    if (!apiEndpoint) {
      console.warn(
        "[MW Pixel] apiEndpoint not configured — cannot send events",
      );
      return;
    }

    const resolvedSession = await resolveSessionId(checkoutAttributes, options);
    if (!resolvedSession) {
      console.log(
        `[MW Pixel] ${eventType} skipped — Mouse Whisperer theme app embed session not found`,
      );
      return;
    }

    const { sessionId, source } = resolvedSession;
    const acquisitionSessionId = await resolveAcquisitionSessionId(
      checkoutAttributes,
      sessionId,
    );
    let acquisition = null;
    try {
      const tabArrival = acquisitionRecord(
        await browser.sessionStorage.getItem(ACQUISITION_STORAGE_KEY),
        sessionId,
      );
      const cookieArrival = !tabArrival
        ? acquisitionRecord(
            await browser.cookie.get(ACQUISITION_DATA_COOKIE),
            sessionId,
          )
        : null;
      const arrival = tabArrival || cookieArrival;
      if (arrival?.id === acquisitionSessionId) acquisition = arrival;
    } catch (e) {
      /* An existing captured journey can still use its exact ID. */
    }
    console.log(
      `[MW Pixel] Sending ${eventType} — session: ${sessionId} (from: ${source})`,
    );

    const payload = {
      eventType,
      sessionId,
      ...(acquisitionSessionId ? { acquisitionSessionId } : {}),
      ...(acquisition ? { acquisition } : {}),
      timestamp: Date.now(),
      fromPixel: true,
      ...data,
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(apiEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        });
        if (response.headers?.get?.("X-Customer-Journey-Retry") === "1") {
          payload.commerceType = eventType;
          payload.eventType = "customer_commerce";
        } else {
          if (response.status >= 200 && response.status < 300) return;
          if (response.status < 500 && response.status !== 429) return;
        }
      } catch (e) {
        /* Only the idempotent customer writer is safe to retry. */
      }
      if (payload.eventType !== "customer_commerce") break;
      if (attempt < 2)
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * (attempt + 1)),
        );
    }
    console.warn(`[MW Pixel] ${eventType} could not be delivered`);
  }

  // Subscribe to product added to cart
  analytics.subscribe("product_added_to_cart", async (event) => {
    const { cartLine } = event.data;

    if (cartLine && cartLine.merchandise) {
      const product = cartLine.merchandise.product;

      await sendEvent(
        "add_to_cart",
        {
          eventId: event.id,
          timestamp: new Date(event.timestamp).getTime(),
          productId: product?.id,
          productTitle: product?.title,
          productHandle:
            product?.handle ||
            product?.url?.split("/products/")[1]?.split("?")[0],
          variantId: cartLine.merchandise.id,
          variantTitle: cartLine.merchandise.title,
          quantity: cartLine.quantity,
          price: cartLine.merchandise.price?.amount,
          currency: cartLine.merchandise.price?.currencyCode,
        },
        null,
        { requireRecentRichTracker: true },
      );
    }
  });

  // Subscribe to checkout completed (conversion)
  analytics.subscribe("checkout_completed", async (event) => {
    const { checkout } = event.data;

    console.log("[MW Pixel] checkout_completed fired");
    console.log(
      "[MW Pixel] checkout attributes:",
      JSON.stringify(checkout?.attributes),
    );
    console.log(
      "[MW Pixel] checkout lineItems count:",
      checkout?.lineItems?.length,
    );
    if (checkout?.lineItems?.[0]) {
      const sample = checkout.lineItems[0];
      console.log("[MW Pixel] Sample lineItem keys:", Object.keys(sample));
      console.log(
        "[MW Pixel] Sample variant.product:",
        JSON.stringify(sample.variant?.product),
      );
    }

    if (checkout) {
      // Extract product info from line items - handle various Shopify event structures
      const products =
        checkout.lineItems
          ?.map((item) => {
            // Try multiple paths to get product ID (Shopify GID)
            const productId =
              item.variant?.product?.id ||
              item.product?.id ||
              item.merchandise?.product?.id;

            // Try multiple paths to get product handle
            const productHandle =
              item.variant?.product?.handle ||
              item.product?.handle ||
              item.merchandise?.product?.handle ||
              extractHandleFromUrl(item.variant?.product?.url) ||
              extractHandleFromUrl(item.product?.url);

            // Try to get product title
            const productTitle =
              item.variant?.product?.title ||
              item.product?.title ||
              item.merchandise?.product?.title ||
              item.title;

            return {
              productId,
              productHandle,
              productTitle,
              quantity: item.quantity,
              price: item.variant?.price?.amount || item.price?.amount,
            };
          })
          .filter((p) => p.productId || p.productHandle) || [];

      // Pass checkout.attributes so sendEvent can extract the session ID
      await sendEvent(
        "conversion",
        {
          eventId: event.id,
          timestamp: new Date(event.timestamp).getTime(),
          orderId: checkout.order?.id,
          orderNumber: checkout.order?.name,
          totalPrice: checkout.totalPrice?.amount,
          currency: checkout.currencyCode,
          products,
          email: checkout.email,
        },
        checkout.attributes,
        { requireRecentRichTracker: true },
      );
    }
  });

  // Helper to extract handle from URL
  function extractHandleFromUrl(url) {
    if (!url) return null;
    const match = url.match(/\/products\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  // Also track checkout started for funnel analysis
  analytics.subscribe("checkout_started", async (event) => {
    const { checkout } = event.data;

    if (checkout) {
      const products =
        checkout.lineItems?.map((item) => ({
          productId: item.variant?.product?.id,
          productHandle: item.variant?.product?.handle,
          productTitle: item.variant?.product?.title,
        })) || [];

      await sendEvent(
        "checkout_started",
        {
          eventId: event.id,
          timestamp: new Date(event.timestamp).getTime(),
          checkoutId: checkout.token,
          totalPrice: checkout.totalPrice?.amount,
          currency: checkout.currencyCode,
          products,
        },
        checkout.attributes,
        { requireRecentRichTracker: true },
      );
    }
  });

  analytics.subscribe("product_removed_from_cart", async (event) => {
    await sendEvent(
      "cart_removed",
      {
        eventId: event.id,
        timestamp: new Date(event.timestamp).getTime(),
        productTitle: event.data?.cartLine?.merchandise?.product?.title,
      },
      null,
      { requireRecentRichTracker: true },
    );
  });
});
