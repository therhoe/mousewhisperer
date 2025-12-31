import { register } from "@shopify/web-pixels-extension";

register(({ configuration, analytics, browser }) => {
  const apiEndpoint = configuration.apiEndpoint;
  const sessionKey = 'crofly_session';

  // Helper to get or create session ID
  async function getSessionId() {
    try {
      let sessionId = await browser.sessionStorage.getItem(sessionKey);
      if (!sessionId) {
        sessionId = 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
        await browser.sessionStorage.setItem(sessionKey, sessionId);
      }
      return sessionId;
    } catch (e) {
      return 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    }
  }

  // Send event to our API
  async function sendEvent(eventType, data) {
    if (!apiEndpoint) return;

    const sessionId = await getSessionId();
    const payload = {
      eventType,
      sessionId,
      timestamp: Date.now(),
      ...data,
    };

    try {
      await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch (e) {
      // Silently fail
    }
  }

  // Subscribe to product added to cart
  analytics.subscribe('product_added_to_cart', async (event) => {
    const { cartLine } = event.data;

    if (cartLine && cartLine.merchandise) {
      const product = cartLine.merchandise.product;

      await sendEvent('add_to_cart', {
        productId: product?.id,
        productTitle: product?.title,
        productHandle: product?.handle || product?.url?.split('/products/')[1]?.split('?')[0],
        variantId: cartLine.merchandise.id,
        variantTitle: cartLine.merchandise.title,
        quantity: cartLine.quantity,
        price: cartLine.merchandise.price?.amount,
        currency: cartLine.merchandise.price?.currencyCode,
      });
    }
  });

  // Subscribe to checkout completed (conversion)
  analytics.subscribe('checkout_completed', async (event) => {
    const { checkout } = event.data;

    if (checkout) {
      // Get all product handles from the order
      const products = checkout.lineItems?.map(item => ({
        productId: item.variant?.product?.id,
        productHandle: item.variant?.product?.handle || item.variant?.product?.url?.split('/products/')[1]?.split('?')[0],
        productTitle: item.variant?.product?.title,
        quantity: item.quantity,
        price: item.variant?.price?.amount,
      })) || [];

      await sendEvent('conversion', {
        orderId: checkout.order?.id,
        orderNumber: checkout.order?.name,
        totalPrice: checkout.totalPrice?.amount,
        currency: checkout.currencyCode,
        products,
        email: checkout.email,
      });
    }
  });

  // Also track checkout started for funnel analysis
  analytics.subscribe('checkout_started', async (event) => {
    const { checkout } = event.data;

    if (checkout) {
      const products = checkout.lineItems?.map(item => ({
        productId: item.variant?.product?.id,
        productHandle: item.variant?.product?.handle,
        productTitle: item.variant?.product?.title,
      })) || [];

      await sendEvent('checkout_started', {
        checkoutId: checkout.token,
        totalPrice: checkout.totalPrice?.amount,
        currency: checkout.currencyCode,
        products,
      });
    }
  });
});
