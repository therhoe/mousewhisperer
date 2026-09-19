// These are native Node tests, not Jest tests from the shared Remix lint preset.
/* eslint jest/no-deprecated-functions: "off", jest/expect-expect: ["error", { "assertFunctionNames": ["assert", "assert.*"] }] */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const trackerSource = readFileSync(
  new URL("../extensions/tracking-embed/assets/tracker.js", import.meta.url),
  "utf8",
);
const pixelSource = readFileSync(
  new URL("../extensions/tracking-pixel/src/index.js", import.meta.url),
  "utf8",
).replace(
  /^import \{ register \} from "@shopify\/web-pixels-extension";\s*/,
  "",
);
const TIMEOUT = 30 * 60 * 1000;
const BASE_TIME = Date.UTC(2026, 7, 26, 12);

function browserState() {
  return {
    now: BASE_TIME,
    cookies: new Map(),
    local: new Map(),
    session: new Map(),
  };
}

function clockDate(state) {
  return class extends Date {
    constructor(...args) {
      super(...(args.length ? args : [state.now]));
    }
    static now() {
      return state.now;
    }
  };
}

// Execute the complete theme tracker in an isolated browser-like VM. The fake
// network only captures payloads; no Shopify API or real store is contacted.
function loadTracker({
  state = browserState(),
  sessionValues = state.session,
  url = "https://shop.example/",
  referrer = "",
  navigationType = "navigate",
  sessionBlocked = false,
  localBlocked = false,
  cookiesBlocked = false,
  analyticsConsent,
} = {}) {
  const beacons = [];
  const requests = [];
  const documentEvents = new Map();
  const windowEvents = new Map();
  const timeouts = [];
  const intervals = [];
  const addListener = (map, name, fn) =>
    map.set(name, [...(map.get(name) || []), fn]);
  const document = {
    referrer,
    title: "Test storefront",
    readyState: "complete",
    hidden: false,
    visibilityState: "visible",
    body: { scrollHeight: 1200 },
    documentElement: { scrollHeight: 1200, scrollTop: 0 },
    addEventListener: (name, fn) => addListener(documentEvents, name, fn),
  };
  Object.defineProperty(document, "cookie", {
    get() {
      if (cookiesBlocked) throw new Error("Cookies denied");
      return [...state.cookies]
        .filter(([, cookie]) => cookie.expires > state.now)
        .map(([key, cookie]) => `${key}=${cookie.value}`)
        .join("; ");
    },
    set(value) {
      if (cookiesBlocked) throw new Error("Cookies denied");
      const [pair, ...options] = value.split(";");
      const separator = pair.indexOf("=");
      const expiry = options.find((option) => option.startsWith("expires="));
      state.cookies.set(pair.slice(0, separator), {
        value: pair.slice(separator + 1),
        expires: expiry ? new Date(expiry.slice(8)).getTime() : Infinity,
      });
    },
  });
  const context = {
    document,
    URL,
    URLSearchParams,
    Date: clockDate(state),
    location: new URL(url),
    Shopify: {
      shop: "test-store.myshopify.com",
      ...(analyticsConsent === undefined
        ? {}
        : {
            customerPrivacy: {
              analyticsProcessingAllowed: () => analyticsConsent,
            },
          }),
    },
    navigator: {
      userAgent: "Mozilla/5.0",
      webdriver: false,
      sendBeacon: (_endpoint, body) => {
        beacons.push(JSON.parse(body));
        return true;
      },
    },
    innerHeight: 800,
    scrollY: 0,
    performance: { getEntriesByType: () => [{ type: navigationType }] },
    history: { pushState() {}, replaceState() {} },
    console: { log() {}, warn() {}, error() {} },
    addEventListener: (name, fn) => addListener(windowEvents, name, fn),
    setTimeout: (fn, delay) => {
      timeouts.push({ fn, delay });
      return timeouts.length;
    },
    setInterval: (fn, delay) => {
      intervals.push({ fn, delay });
      return intervals.length;
    },
    clearInterval() {},
    fetch: async (endpoint, options = {}) => {
      requests.push({
        endpoint,
        payload: options.body ? JSON.parse(options.body) : null,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ assigned: false, accepted: true }),
      };
    },
  };
  for (const [name, values, blocked] of [
    ["sessionStorage", sessionValues, sessionBlocked],
    ["localStorage", state.local, localBlocked],
  ]) {
    Object.defineProperty(context, name, {
      get() {
        if (blocked) throw new Error("Storage denied");
        return {
          getItem: (key) => values.get(key) ?? null,
          setItem: (key, value) => values.set(key, value),
        };
      },
    });
  }
  context.window = context;
  vm.runInNewContext(trackerSource, context, { filename: "tracker.js" });
  function send() {
    document.visibilityState = "hidden";
    document.hidden = true;
    for (const fn of documentEvents.get("visibilitychange") || []) fn();
    document.visibilityState = "visible";
    document.hidden = false;
    for (const fn of documentEvents.get("visibilitychange") || []) fn();
    return beacons.at(-1);
  }
  function submit(action) {
    for (const fn of documentEvents.get("submit") || [])
      fn({ target: { action } });
  }
  return {
    state,
    send,
    submit,
    requests,
    beacons,
    timeouts,
    intervals,
    context,
    sessionValues,
    emitDocument: (name, event = {}) => {
      for (const fn of documentEvents.get(name) || []) fn(event);
    },
  };
}

test("customer journeys wait for consent, clear queued actions on withdrawal, and strip URL query data", async () => {
  const denied = loadTracker({
    analyticsConsent: false,
    url: "https://shop.example/products/shoes?utm_source=facebook&utm_medium=paid_social&utm_campaign=sale&ad_id=123",
  });
  denied.send();
  for (const timer of [...denied.timeouts]) timer.fn();
  await new Promise(setImmediate);
  assert.equal(
    denied.requests.filter((r) => r.payload?.eventType === "journey_batch")
      .length,
    0,
  );
  denied.context.Shopify.customerPrivacy.analyticsProcessingAllowed = () =>
    true;
  denied.emitDocument("visitorConsentCollected");
  for (const timer of [...denied.timeouts]) timer.fn();
  await new Promise(setImmediate);
  const batch = denied.requests.find(
    (r) => r.payload?.eventType === "journey_batch",
  ).payload;
  assert.equal(batch.consent, true);
  assert.equal(batch.pagePath, "/products/shoes");
  assert.equal(batch.acquisition.adId, "123");
  assert.equal(batch.events[0].type, "page_view");
  assert.equal(batch.events[0].path, "/products/shoes");
  const count = denied.requests.length;
  denied.context.Shopify.customerPrivacy.analyticsProcessingAllowed = () =>
    false;
  denied.emitDocument("visitorConsentCollected");
  for (const interval of denied.intervals.filter((t) => t.delay === 5000))
    interval.fn();
  await new Promise(setImmediate);
  assert.equal(denied.requests.length, count);
});

test("different ads in the same campaign open distinct acquisitions and preserve the first tab", () => {
  const state = browserState();
  const a = loadTracker({
    state,
    url: "https://shop.example/?utm_source=facebook&utm_medium=paid_social&utm_campaign=sale&ad_id=123",
  });
  const first = a.send();
  state.now += 1000;
  const b = loadTracker({
    state,
    sessionValues: new Map(),
    url: "https://shop.example/?utm_source=facebook&utm_medium=paid_social&utm_campaign=sale&ad_id=456",
  });
  const second = b.send();
  assert.equal(first.sessionId, second.sessionId);
  assert.notEqual(first.acquisition.id, second.acquisition.id);
  assert.equal(first.acquisition.adId, "123");
  assert.equal(second.acquisition.adId, "456");
  assert.equal(a.send().acquisition.id, first.acquisition.id);
});

function loadPixel({
  cookies = {},
  cookieBlocked = false,
  sessionData = {},
  sessionBlocked = false,
  now = BASE_TIME,
  responseFor,
} = {}) {
  const handlers = new Map();
  const requests = [];
  const context = {
    Date: clockDate({ now }),
    setTimeout: (callback) => callback(),
    console: { log() {}, warn() {}, error() {} },
    register: (callback) =>
      callback({
        settings: { apiEndpoint: "https://api.example.test/track" },
        analytics: { subscribe: (name, fn) => handlers.set(name, fn) },
        browser: {
          sessionStorage: {
            getItem: async (key) => {
              if (sessionBlocked) throw new Error("Session storage denied");
              return sessionData[key] ?? null;
            },
          },
          cookie: {
            get: async (key) => {
              if (cookieBlocked) throw new Error("Cookies denied");
              return cookies[key] ?? null;
            },
          },
        },
      }),
    fetch: async (_endpoint, options) => {
      requests.push(JSON.parse(options.body));
      return responseFor ? responseFor(requests.length) : { status: 200 };
    },
  };
  vm.runInNewContext(pixelSource, context, { filename: "pixel.js" });
  return {
    requests,
    emit: (name, data) =>
      handlers.get(name)({
        data,
        id: "pixel-event-1",
        timestamp: new Date(now).toISOString(),
      }),
  };
}

test("pixel retries only the isolated customer writer without replaying legacy commerce", async () => {
  const pixel = loadPixel({
    cookies: {
      mw_sid: "sess_existing_123",
      mw_csid: "acq_checkout_journey_123",
      mw_rich_seen: String(BASE_TIME),
    },
    responseFor: (attempt) =>
      attempt === 1
        ? { status: 200, headers: { get: () => "1" } }
        : { status: attempt === 2 ? 503 : 200 },
  });
  await pixel.emit("product_added_to_cart", {
    cartLine: { merchandise: { product: { id: "product-1" } } },
  });
  assert.deepEqual(
    pixel.requests.map((request) => request.eventType),
    ["add_to_cart", "customer_commerce", "customer_commerce"],
  );
  assert.equal(pixel.requests[1].commerceType, "add_to_cart");
  assert.ok(
    pixel.requests.every((request) => request.eventId === "pixel-event-1"),
  );
  assert.ok(pixel.requests.every((request) => request.timestamp === BASE_TIME));
});

test("an uncertain legacy pixel delivery is not blindly replayed", async () => {
  const pixel = loadPixel({
    cookies: { mw_sid: "sess_existing_123", mw_rich_seen: String(BASE_TIME) },
    responseFor: () => {
      throw new Error("Network disconnected after write");
    },
  });
  await pixel.emit("product_added_to_cart", {
    cartLine: { merchandise: { product: { id: "product-1" } } },
  });
  assert.equal(pixel.requests.length, 1);
});

test("Google arrival persists across internal product navigation without changing legacy page attribution", () => {
  const state = browserState();
  const landing = loadTracker({
    state,
    referrer: "https://www.google.com/search?q=private-query",
  }).send();
  assert.equal(landing.acquisition.sourceCategory, "Organic Search");
  assert.equal(landing.acquisition.referrer, "https://www.google.com/search");
  assert.equal(landing.acquisition.landingPath, "/");
  assert.equal(landing.acquisition.startedAt, BASE_TIME);

  state.now += 5000;
  const product = loadTracker({
    state,
    url: "https://shop.example/products/shoes",
    referrer: "https://shop.example/",
  }).send();
  assert.deepEqual(product.acquisition, landing.acquisition);
  assert.equal(product.sourceCategory, "Internal");
  assert.equal(product.sessionId, landing.sessionId);
  assert.equal(product.pageOrder, 2);
  assert.notEqual(product.pageViewId, landing.pageViewId);
  assert.equal(state.cookies.get("mw_csid").value, landing.acquisition.id);
  assert.equal(state.cookies.get("mw_sid").value, landing.sessionId);
});

test("paid campaign attribution survives internal UTMs and the Shopify shop-domain alias", () => {
  const state = browserState();
  const landing = loadTracker({
    state,
    url: "https://shop.example/?utm_source=google&utm_medium=cpc&utm_campaign=summer",
    referrer: "https://google.com/",
  }).send();
  assert.equal(landing.acquisition.sourceCategory, "Paid Search");
  state.now += 3000;
  const internal = loadTracker({
    state,
    url: "https://shop.example/products/shoes?utm_source=homepage&utm_medium=referral",
    referrer: "https://test-store.myshopify.com/",
  }).send();
  assert.deepEqual(internal.acquisition, landing.acquisition);
});

test("reloads and back/forward navigation do not replace an active acquisition", () => {
  const state = browserState();
  const landing = loadTracker({
    state,
    url: "https://shop.example/?utm_source=google&utm_medium=cpc&utm_campaign=summer",
  }).send();
  for (const navigationType of ["reload", "back_forward"]) {
    state.now += 5000;
    const revisit = loadTracker({
      state,
      url: "https://shop.example/?utm_source=newsletter&utm_medium=email",
      referrer: "https://mail.example/",
      navigationType,
    }).send();
    assert.deepEqual(revisit.acquisition, landing.acquisition);
  }
});

test("a distinct external campaign starts a new acquisition, not a new legacy session", () => {
  const state = browserState();
  const first = loadTracker({
    state,
    url: "https://shop.example/?utm_source=google&utm_medium=cpc&utm_campaign=summer",
  }).send();
  state.now += 60000;
  const next = loadTracker({
    state,
    url: "https://shop.example/products/shoes?utm_source=newsletter&utm_medium=email&utm_campaign=launch",
    referrer: "https://mail.example/",
  }).send();
  assert.notEqual(next.acquisition.id, first.acquisition.id);
  assert.equal(next.sessionId, first.sessionId);
  assert.equal(next.acquisition.sourceCategory, "Email");
  assert.equal(next.acquisition.startedAt, state.now);
  assert.equal(next.acquisition.landingPath, "/products/shoes");
});

test("30 minutes of inactivity expires acquisition; an internal arrival becomes Unknown, not Direct", () => {
  const state = browserState();
  const first = loadTracker({
    state,
    referrer: "https://www.google.com/",
  }).send();
  state.now += TIMEOUT;
  const afterTimeout = loadTracker({
    state,
    url: "https://shop.example/products/shoes",
    referrer: "https://shop.example/",
  }).send();
  assert.notEqual(afterTimeout.acquisition.id, first.acquisition.id);
  assert.equal(afterTimeout.acquisition.sourceCategory, "Unknown");
  assert.equal(afterTimeout.acquisition.source, null);
  assert.equal(afterTimeout.acquisition.referrer, null);
  assert.equal(afterTimeout.sessionId, first.sessionId);
});

test("engagement refreshes inactivity expiry without changing the original acquisition timestamp", () => {
  const state = browserState();
  const page = loadTracker({ state, referrer: "https://www.google.com/" });
  const first = page.send();
  state.now += 25 * 60 * 1000;
  assert.deepEqual(page.send().acquisition, first.acquisition);
  assert.equal(
    JSON.parse(state.local.get("mw_acquisition_v1")).lastActivityAt,
    state.now,
  );
  state.now += 25 * 60 * 1000;
  const next = loadTracker({
    state,
    url: "https://shop.example/products/shoes",
    referrer: "https://shop.example/",
  }).send();
  assert.deepEqual(next.acquisition, first.acquisition);
});

test("an expired old tab cannot revive the acquisition cookie on unload", () => {
  const state = browserState();
  const page = loadTracker({ state });
  page.send();
  const expiry = state.cookies.get("mw_csid").expires;
  state.now += TIMEOUT + 1;
  page.send();
  assert.equal(state.cookies.get("mw_csid").expires, expiry);
});

test("localStorage fallback preserves attribution when session storage and cookies are denied", () => {
  const state = browserState();
  const options = { state, sessionBlocked: true, cookiesBlocked: true };
  const first = loadTracker({
    ...options,
    referrer: "https://www.google.com/",
  }).send();
  state.now += 5000;
  const next = loadTracker({
    ...options,
    url: "https://shop.example/products/shoes",
    referrer: "https://shop.example/",
  }).send();
  assert.deepEqual(next.acquisition, first.acquisition);
  assert.equal(next.sessionId, first.sessionId);
  assert.equal(
    JSON.parse(state.local.get("mw_acquisition_v1")).trackingSessionId,
    first.sessionId,
  );
});

test("cookie-only fallback preserves acquisition and legacy session when both storage APIs are denied", () => {
  const state = browserState();
  const options = { state, sessionBlocked: true, localBlocked: true };
  const first = loadTracker({
    ...options,
    referrer: "https://www.google.com/",
  }).send();
  state.now += 5000;
  const next = loadTracker({
    ...options,
    url: "https://shop.example/products/shoes",
    referrer: "https://shop.example/",
  }).send();
  assert.deepEqual(next.acquisition, first.acquisition);
  assert.equal(next.sessionId, first.sessionId);
});

test("fully blocked storage still sends engagement with stable in-page IDs and an honest Unknown fallback", () => {
  const options = {
    sessionBlocked: true,
    localBlocked: true,
    cookiesBlocked: true,
  };
  const page = loadTracker({
    ...options,
    url: "https://shop.example/products/shoes",
    referrer: "https://shop.example/",
  });
  const first = page.send();
  const next = page.send();
  assert.equal(first.acquisition.sourceCategory, "Unknown");
  assert.match(first.acquisition.id, /^acq_/);
  assert.equal(next.acquisition.id, first.acquisition.id);
  assert.equal(next.sessionId, first.sessionId);
  assert.equal(first.sourceCategory, "Internal");
});

test("an untracked internal arrival or unrecoverable reload is Unknown; a fresh no-referrer arrival is Direct", () => {
  assert.equal(
    loadTracker({ referrer: "https://shop.example/" }).send().acquisition
      .sourceCategory,
    "Unknown",
  );
  assert.equal(
    loadTracker({ navigationType: "reload" }).send().acquisition.sourceCategory,
    "Unknown",
  );
  assert.equal(loadTracker().send().acquisition.sourceCategory, "Direct");
});

test("invalid storage records and malformed cookies do not abort tracking or override valid fallback data", () => {
  const state = browserState();
  const first = loadTracker({
    state,
    referrer: "https://www.google.com/",
  }).send();
  state.session.set("mw_acquisition_v1", "not-json");
  state.local.set(
    "mw_acquisition_v1",
    JSON.stringify({ version: 1, id: "invalid" }),
  );
  state.cookies.set("mw_sid", {
    value: "%E0%A4%A",
    expires: state.now + TIMEOUT,
  });
  state.now += 5000;
  const next = loadTracker({ state, referrer: "https://shop.example/" }).send();
  assert.deepEqual(next.acquisition, first.acquisition);
  assert.equal(next.sessionId, first.sessionId);
});

test("large Unicode campaign fields fit the fallback cookie and acquisition referrers omit query strings", () => {
  const state = browserState();
  const long = "🛍️広告".repeat(500);
  const url = new URL("https://shop.example/" + "x".repeat(2000));
  url.searchParams.set("utm_source", long);
  url.searchParams.set("utm_medium", "email");
  url.searchParams.set("utm_campaign", long);
  const first = loadTracker({
    state,
    url: url.href,
    referrer:
      "https://mail.example/" + "y".repeat(2000) + "?token=private#fragment",
    sessionBlocked: true,
    localBlocked: true,
  }).send();
  assert.equal(first.acquisition.sourceCategory, "Email");
  assert.ok(state.cookies.get("mw_acq").value.length < 3800);
  assert.ok(JSON.stringify(first.acquisition).length < 2000);
  assert.ok(!first.acquisition.referrer.includes("private"));
  state.now += 5000;
  const next = loadTracker({
    state,
    referrer: "https://shop.example/",
    sessionBlocked: true,
    localBlocked: true,
  }).send();
  assert.deepEqual(next.acquisition, first.acquisition);
});

test("theme cart attributes and commerce events carry both IDs and pixel checkout honors exact cart attribution", async () => {
  const page = loadTracker({ referrer: "https://www.google.com/" });
  const engagement = page.send();
  page.submit("https://shop.example/cart/add");
  const cartUpdate = page.requests.find(
    (request) => request.endpoint === "/cart/update.js",
  ).payload;
  assert.equal(cartUpdate.attributes._mw_sid, engagement.sessionId);
  assert.equal(cartUpdate.attributes._mw_csid, engagement.acquisition.id);
  const commerce = page.requests.find(
    (request) => request.payload?.eventType === "add_to_cart",
  ).payload;
  assert.equal(commerce.acquisitionSessionId, engagement.acquisition.id);
  const pixel = loadPixel({
    cookies: {
      mw_sid: "newer-cookie-session",
      mw_csid: "acq_different_journey_123",
    },
  });
  const checkout = {
    attributes: Object.entries(cartUpdate.attributes).map(([key, value]) => ({
      key,
      value,
    })),
    lineItems: [],
    token: "checkout-token",
    order: { id: "gid://shopify/Order/1" },
  };
  await pixel.emit("checkout_started", { checkout });
  await pixel.emit("checkout_completed", { checkout });
  assert.equal(pixel.requests.length, 2);
  for (const event of pixel.requests) {
    assert.equal(event.sessionId, engagement.sessionId);
    assert.equal(event.acquisitionSessionId, engagement.acquisition.id);
    assert.equal(event.fromPixel, true);
  }
});

test("pixel cart events use acquisition cookie without weakening the existing rich-tracker requirement", async () => {
  const cookies = {
    mw_sid: "sess_existing_123",
    mw_csid: "acq_checkout_journey_123",
    mw_rich_seen: String(BASE_TIME),
  };
  const cartLine = {
    quantity: 1,
    merchandise: {
      id: "variant-1",
      product: { id: "product-1", handle: "shoes" },
    },
  };
  const pixel = loadPixel({ cookies });
  await pixel.emit("product_added_to_cart", { cartLine });
  assert.equal(pixel.requests[0].acquisitionSessionId, cookies.mw_csid);
  assert.equal(pixel.requests[0].sessionId, cookies.mw_sid);
  const stale = loadPixel({
    cookies: { ...cookies, mw_rich_seen: String(BASE_TIME - TIMEOUT - 1) },
  });
  await stale.emit("product_added_to_cart", { cartLine });
  assert.equal(stale.requests.length, 0);
});

test("pixel falls back to acquisition cookie on checkout, or omits it when unavailable or invalid", async () => {
  const checkout = {
    attributes: [{ key: "_mw_sid", value: "sess_existing_123" }],
    lineItems: [],
  };
  const withCookie = loadPixel({
    cookies: {
      mw_sid: "sess_existing_123",
      mw_csid: "acq_checkout_cookie_123",
    },
  });
  await withCookie.emit("checkout_started", { checkout });
  assert.equal(
    withCookie.requests[0].acquisitionSessionId,
    "acq_checkout_cookie_123",
  );
  for (const options of [
    { cookieBlocked: true },
    { cookies: { mw_csid: "invalid" } },
  ]) {
    const pixel = loadPixel(options);
    await pixel.emit("checkout_completed", { checkout });
    assert.equal(pixel.requests.length, 1);
    assert.equal(
      Object.hasOwn(pixel.requests[0], "acquisitionSessionId"),
      false,
    );
  }
});

test("pixel checkout can forward cart acquisition attributes when cookies are blocked", async () => {
  const pixel = loadPixel({ cookieBlocked: true });
  await pixel.emit("checkout_completed", {
    checkout: {
      attributes: [
        { key: "_mw_sid", value: "sess_existing_123" },
        { key: "_mw_csid", value: "acq_cart_journey_123" },
      ],
      lineItems: [],
    },
  });
  assert.equal(pixel.requests[0].acquisitionSessionId, "acq_cart_journey_123");
});

test("local-only SID recovery retains seven-day identity across acquisition expiry, but not beyond its own expiry", () => {
  const state = browserState();
  const options = { state, sessionBlocked: true, cookiesBlocked: true };
  const first = loadTracker({
    ...options,
    referrer: "https://google.com/",
  }).send();
  state.now += TIMEOUT + 1;
  const next = loadTracker({
    ...options,
    referrer: "https://shop.example/",
  }).send();
  assert.notEqual(next.acquisition.id, first.acquisition.id);
  assert.equal(next.sessionId, first.sessionId);
  assert.equal(next.acquisition.sourceCategory, "Unknown");
  state.now += 7 * 24 * 60 * 60 * 1000 + 1;
  const expired = loadTracker({
    ...options,
    referrer: "https://shop.example/",
  }).send();
  assert.notEqual(expired.sessionId, first.sessionId);
});

test("a changed primary SID cannot reuse an acquisition bound to the old SID", () => {
  const state = browserState();
  const first = loadTracker({ state, referrer: "https://google.com/" }).send();
  state.now += 1000;
  state.cookies.set("mw_sid", {
    value: "sess_new_tracking_123",
    expires: state.now + 7 * 24 * 60 * 60 * 1000,
  });
  const next = loadTracker({ state, referrer: "https://shop.example/" }).send();
  assert.equal(next.sessionId, "sess_new_tracking_123");
  assert.notEqual(next.acquisition.id, first.acquisition.id);
  assert.equal(next.acquisition.sourceCategory, "Unknown");
});

test("a different untagged external source starts a new acquisition without changing legacy SID or page attribution", () => {
  const state = browserState();
  const first = loadTracker({ state, referrer: "https://google.com/" }).send();
  state.now += 1000;
  const next = loadTracker({ state, referrer: "https://facebook.com/" }).send();
  assert.notEqual(next.acquisition.id, first.acquisition.id);
  assert.equal(next.acquisition.sourceCategory, "Organic Social");
  assert.equal(next.acquisition.source, "facebook.com");
  assert.equal(next.sourceCategory, "Organic Social");
  assert.equal(next.sessionId, first.sessionId);
});

test("expired tagged reloads and back-forward returns are Unknown, not fresh campaign arrivals", () => {
  for (const navigationType of ["reload", "back_forward"]) {
    const state = browserState();
    const options = {
      state,
      url: "https://shop.example/?utm_source=google&utm_medium=cpc&utm_campaign=summer",
      referrer: "https://google.com/",
    };
    const first = loadTracker(options).send();
    state.now += TIMEOUT + 1;
    const next = loadTracker({ ...options, navigationType }).send();
    assert.notEqual(next.acquisition.id, first.acquisition.id);
    assert.equal(next.acquisition.sourceCategory, "Unknown");
    assert.equal(next.acquisition.source, null);
    assert.equal(next.acquisition.medium, null);
    assert.equal(next.acquisition.campaign, null);
    assert.equal(next.acquisition.referrer, null);
    assert.equal(next.sessionId, first.sessionId);
    // Existing page-level attribution is deliberately unaffected.
    assert.equal(next.sourceCategory, "Paid Search");
  }
});

test("an older tab cannot replace newer shared acquisition or overwrite its cart via a delayed retry; pixels stay tab-bound", async () => {
  const state = browserState();
  const tabA = loadTracker({
    state,
    sessionValues: new Map(),
    referrer: "https://google.com/",
  });
  const a = tabA.send();
  tabA.submit("https://shop.example/cart/add");
  await new Promise((resolve) => setImmediate(resolve));
  const cartWritesBefore = tabA.requests.filter(
    (request) => request.endpoint === "/cart/update.js",
  ).length;

  state.now += 1000;
  const tabB = loadTracker({
    state,
    sessionValues: new Map(),
    url: "https://shop.example/?utm_source=newsletter&utm_medium=email&utm_campaign=launch",
    referrer: "https://mail.example/",
  });
  const b = tabB.send();
  tabB.submit("https://shop.example/cart/add");
  await new Promise((resolve) => setImmediate(resolve));
  state.now += 30000;
  tabA.intervals.find(({ delay }) => delay === 30000).fn();
  for (const retry of tabA.timeouts.filter(({ delay }) => delay === 800))
    retry.fn();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(state.cookies.get("mw_csid").value, b.acquisition.id);
  assert.equal(
    JSON.parse(state.local.get("mw_acquisition_v1")).id,
    b.acquisition.id,
  );
  assert.equal(
    JSON.parse(tabA.sessionValues.get("mw_acquisition_v1")).id,
    a.acquisition.id,
  );
  assert.equal(
    tabA.requests.filter((request) => request.endpoint === "/cart/update.js")
      .length,
    cartWritesBefore,
  );
  const bCart = tabB.requests.find(
    (request) => request.endpoint === "/cart/update.js",
  ).payload.attributes;
  assert.equal(bCart._mw_csid, b.acquisition.id);

  const cookies = Object.fromEntries(
    [...state.cookies].map(([key, cookie]) => [key, cookie.value]),
  );
  const cartLine = {
    quantity: 1,
    merchandise: { id: "variant", product: { id: "product", handle: "shoes" } },
  };
  for (const [tab, engagement] of [
    [tabA, a],
    [tabB, b],
  ]) {
    const pixel = loadPixel({
      cookies,
      now: state.now,
      sessionData: Object.fromEntries(tab.sessionValues),
    });
    await pixel.emit("product_added_to_cart", { cartLine });
    assert.equal(
      pixel.requests[0].acquisitionSessionId,
      engagement.acquisition.id,
    );
    assert.equal(pixel.requests[0].sessionId, engagement.sessionId);
  }

  // A deliberate checkout from A remains attributable to A, not the newer tab.
  tabA.submit("https://shop.example/checkout");
  await new Promise((resolve) => setImmediate(resolve));
  const aCart = tabA.requests
    .filter((request) => request.endpoint === "/cart/update.js")
    .at(-1).payload.attributes;
  assert.equal(aCart._mw_csid, a.acquisition.id);
  const checkoutPixel = loadPixel({
    cookies,
    now: state.now,
    sessionData: Object.fromEntries(tabB.sessionValues),
  });
  await checkoutPixel.emit("checkout_completed", {
    checkout: {
      attributes: Object.entries(aCart).map(([key, value]) => ({ key, value })),
      lineItems: [],
    },
  });
  assert.equal(
    checkoutPixel.requests[0].acquisitionSessionId,
    a.acquisition.id,
  );
});

test("pixel does not mix checkout SID with another SID's tab record or cookie", async () => {
  const state = browserState();
  const page = loadTracker({ state, referrer: "https://google.com/" });
  const engagement = page.send();
  const pixel = loadPixel({
    cookies: Object.fromEntries(
      [...state.cookies].map(([key, cookie]) => [key, cookie.value]),
    ),
    sessionData: Object.fromEntries(page.sessionValues),
  });
  await pixel.emit("checkout_completed", {
    checkout: {
      attributes: [{ key: "_mw_sid", value: "sess_old_cart_123" }],
      lineItems: [],
    },
  });
  assert.notEqual(engagement.sessionId, "sess_old_cart_123");
  assert.equal(pixel.requests[0].sessionId, "sess_old_cart_123");
  assert.equal(Object.hasOwn(pixel.requests[0], "acquisitionSessionId"), false);
});

test("pixel reads its endpoint from the actual SDK settings API", async () => {
  const pixel = loadPixel({
    cookies: { mw_sid: "sess_settings_123", mw_rich_seen: String(BASE_TIME) },
  });
  await pixel.emit("checkout_started", {
    checkout: { attributes: [], lineItems: [] },
  });
  assert.equal(pixel.requests.length, 1);
  assert.equal(pixel.requests[0].sessionId, "sess_settings_123");
});
