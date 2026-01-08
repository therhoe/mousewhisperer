(function() {
  'use strict';

  // Only run on product pages
  if (!window.location.pathname.includes('/products/')) {
    return;
  }

  const CONFIG = {
    apiEndpoint: window.__TRACKING_API_ENDPOINT__ || '',
    minTimeForReal: 5000, // 5 seconds minimum for "real" user
    sendInterval: 30000, // Send update every 30 seconds
    sessionKey: 'mw_session',
    cookieName: 'mw_sid', // Cookie name for cross-context session tracking
    cookieDays: 7, // Cookie expiry in days
  };

  // Cookie helpers
  function setCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = name + '=' + encodeURIComponent(value) +
      ';expires=' + expires.toUTCString() +
      ';path=/;SameSite=Lax';
  }

  function getCookie(name) {
    const nameEQ = name + '=';
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i].trim();
      if (c.indexOf(nameEQ) === 0) {
        return decodeURIComponent(c.substring(nameEQ.length));
      }
    }
    return null;
  }

  // Generate or retrieve session ID (uses both cookie and sessionStorage)
  function getSessionId() {
    // First check cookie (persists across checkout)
    let sessionId = getCookie(CONFIG.cookieName);

    // Then check sessionStorage
    if (!sessionId) {
      sessionId = sessionStorage.getItem(CONFIG.sessionKey);
    }

    // If still no session, create new one
    if (!sessionId) {
      sessionId = 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    }

    // Store in both places for redundancy
    sessionStorage.setItem(CONFIG.sessionKey, sessionId);
    setCookie(CONFIG.cookieName, sessionId, CONFIG.cookieDays);

    return sessionId;
  }

  // Get product handle from URL
  function getProductHandle() {
    const match = window.location.pathname.match(/\/products\/([^/?]+)/);
    return match ? match[1] : null;
  }

  // Parse traffic source from UTM params and referrer
  function getTrafficSource() {
    const params = new URLSearchParams(window.location.search);
    const referrer = document.referrer;

    const source = params.get('utm_source');
    const medium = params.get('utm_medium');
    const campaign = params.get('utm_campaign');

    let sourceCategory = 'Direct';

    if (source && medium) {
      // UTM-based classification
      const mediumLower = medium.toLowerCase();
      if (['cpc', 'ppc', 'paid', 'paidsearch'].includes(mediumLower)) {
        sourceCategory = 'Paid Search';
      } else if (['paid_social', 'paidsocial', 'paid-social'].includes(mediumLower)) {
        sourceCategory = 'Paid Social';
      } else if (mediumLower === 'email') {
        sourceCategory = 'Email';
      } else if (mediumLower === 'organic') {
        sourceCategory = 'Organic Search';
      } else if (mediumLower === 'social') {
        sourceCategory = 'Organic Social';
      } else if (mediumLower === 'referral') {
        sourceCategory = 'Referral';
      }
    } else if (referrer) {
      // Referrer-based classification
      try {
        const refHost = new URL(referrer).hostname.toLowerCase();

        // Search engines
        if (/google\./i.test(refHost)) sourceCategory = 'Organic Search';
        else if (/bing\./i.test(refHost)) sourceCategory = 'Organic Search';
        else if (/yahoo\./i.test(refHost)) sourceCategory = 'Organic Search';
        else if (/duckduckgo/i.test(refHost)) sourceCategory = 'Organic Search';
        // Social
        else if (/facebook|fb\.com/i.test(refHost)) sourceCategory = 'Organic Social';
        else if (/instagram/i.test(refHost)) sourceCategory = 'Organic Social';
        else if (/twitter|x\.com/i.test(refHost)) sourceCategory = 'Organic Social';
        else if (/tiktok/i.test(refHost)) sourceCategory = 'Organic Social';
        else if (/pinterest/i.test(refHost)) sourceCategory = 'Organic Social';
        else if (/linkedin/i.test(refHost)) sourceCategory = 'Organic Social';
        // Email
        else if (/mail|outlook|klaviyo/i.test(refHost)) sourceCategory = 'Email';
        // Everything else is referral
        else sourceCategory = 'Referral';
      } catch (e) {
        sourceCategory = 'Referral';
      }
    }

    return {
      source: source || parseSourceFromReferrer(referrer),
      medium: medium || null,
      campaign: campaign || null,
      referrer: referrer || null,
      sourceCategory: sourceCategory,
    };
  }

  function parseSourceFromReferrer(referrer) {
    if (!referrer) return 'direct';
    try {
      const host = new URL(referrer).hostname.replace('www.', '');
      return host.split('.')[0]; // e.g., "google" from "google.com"
    } catch (e) {
      return 'unknown';
    }
  }

  // Get scroll depth as percentage
  function getScrollDepth() {
    const docHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    const winHeight = window.innerHeight;
    const scrollTop = window.scrollY || document.documentElement.scrollTop;

    if (docHeight <= winHeight) return 100;

    const scrollPercent = Math.round((scrollTop / (docHeight - winHeight)) * 100);
    return Math.min(100, Math.max(0, scrollPercent));
  }

  // Detect device type
  function getDeviceType() {
    const ua = navigator.userAgent;
    if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
    if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  // Check for linear mouse movement (bot indicator)
  function isLinearMovement(movements) {
    if (movements.length < 10) return false;

    // Sample some movements and check if they're too linear
    const sample = movements.slice(-20);
    let linearCount = 0;

    for (let i = 2; i < sample.length; i++) {
      const dx1 = sample[i-1].x - sample[i-2].x;
      const dy1 = sample[i-1].y - sample[i-2].y;
      const dx2 = sample[i].x - sample[i-1].x;
      const dy2 = sample[i].y - sample[i-1].y;

      // Check if direction is almost identical (cross product near zero)
      const cross = Math.abs(dx1 * dy2 - dy1 * dx2);
      if (cross < 10) linearCount++;
    }

    // If more than 80% of movements are linear, flag as suspicious
    return linearCount / (sample.length - 2) > 0.8;
  }

  // Main tracking state
  const state = {
    sessionId: getSessionId(),
    productHandle: getProductHandle(),
    startTime: Date.now(),

    // Engagement signals
    hasMouseMoved: false,
    hasScrolled: false,
    hasKeyPressed: false,
    hasTouched: false,

    // Metrics
    maxScrollDepth: 0,
    mouseMovements: [],
    mouseMovementCount: 0,
    keyPressCount: 0,
    touchEventCount: 0,

    // Bot detection
    isWebdriver: navigator.webdriver === true,
    suspiciousUA: /bot|crawler|spider|headless|phantom|selenium/i.test(navigator.userAgent),

    // Traffic source
    trafficSource: getTrafficSource(),

    // Device
    userAgent: navigator.userAgent,
    deviceType: getDeviceType(),

    // Conversion tracking
    addedToCart: false,
    addedToCartAt: null,

    // Exit tracking
    exitType: null,
    lastActivityTime: Date.now(),
    idleTimeout: 120000, // 2 minutes idle = idle exit

    // Sent flag
    hasSentInitial: false,
  };

  // Track user activity for idle detection
  function updateActivity() {
    state.lastActivityTime = Date.now();
  }

  // Event listeners
  function setupEventListeners() {
    // Mouse movement
    document.addEventListener('mousemove', function(e) {
      state.hasMouseMoved = true;
      state.mouseMovementCount++;
      state.mouseMovements.push({ x: e.clientX, y: e.clientY, t: Date.now() });
      updateActivity();

      // Keep only last 100 movements
      if (state.mouseMovements.length > 100) {
        state.mouseMovements.shift();
      }
    }, { passive: true });

    // Scroll
    document.addEventListener('scroll', function() {
      state.hasScrolled = true;
      const depth = getScrollDepth();
      state.maxScrollDepth = Math.max(state.maxScrollDepth, depth);
      updateActivity();
    }, { passive: true });

    // Keyboard
    document.addEventListener('keydown', function() {
      state.hasKeyPressed = true;
      state.keyPressCount++;
      updateActivity();
    }, { passive: true });

    // Touch (mobile)
    document.addEventListener('touchstart', function() {
      state.hasTouched = true;
      state.touchEventCount++;
      updateActivity();
    }, { passive: true });

    // Click tracking for exit type detection
    document.addEventListener('click', function(e) {
      updateActivity();
      const target = e.target.closest('a');
      if (target && target.href) {
        const url = new URL(target.href, window.location.origin);
        const currentHost = window.location.hostname;

        // Check if it's a checkout/cart link
        if (url.pathname.includes('/cart') || url.pathname.includes('/checkout')) {
          state.exitType = 'checkout';
        }
        // Check if internal or external link
        else if (url.hostname === currentHost) {
          state.exitType = 'internal_link';
        } else {
          state.exitType = 'external_link';
        }
      }
    }, { passive: true });

    // Add to cart detection - listen for form submissions and button clicks
    document.addEventListener('submit', function(e) {
      const form = e.target;
      if (form.action && form.action.includes('/cart/add')) {
        state.addedToCart = true;
        state.addedToCartAt = Date.now();
        state.exitType = 'checkout';
        sendTrackingData();
      }
    });

    // Also listen for AJAX add-to-cart (common in modern themes)
    const originalFetch = window.fetch;
    window.fetch = function() {
      const url = arguments[0];
      if (typeof url === 'string' && url.includes('/cart/add')) {
        state.addedToCart = true;
        state.addedToCartAt = Date.now();
        state.exitType = 'checkout';
        sendTrackingData();
      }
      return originalFetch.apply(this, arguments);
    };

    // Back button detection
    window.addEventListener('popstate', function() {
      state.exitType = 'back_button';
      sendTrackingData();
    });

    // Page visibility change (user leaving)
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') {
        // If no exit type set, it's likely window closed or tab switched
        if (!state.exitType) {
          state.exitType = 'window_closed';
        }
        sendTrackingData();
      }
    });

    // Before unload - window/tab closing
    window.addEventListener('beforeunload', function() {
      // If no exit type set yet, classify as window_closed
      if (!state.exitType) {
        state.exitType = 'window_closed';
      }
      sendTrackingData();
    });

    // Idle detection - check every 30 seconds
    setInterval(function() {
      const idleTime = Date.now() - state.lastActivityTime;
      if (idleTime >= state.idleTimeout && state.exitType !== 'idle') {
        state.exitType = 'idle';
        sendTrackingData();
      }
    }, 30000);
  }

  // Build tracking payload
  function buildPayload() {
    const timeOnPage = Date.now() - state.startTime;
    const linearMovement = isLinearMovement(state.mouseMovements);

    return {
      sessionId: state.sessionId,
      productHandle: state.productHandle,

      // Traffic source
      source: state.trafficSource.source,
      medium: state.trafficSource.medium,
      campaign: state.trafficSource.campaign,
      referrer: state.trafficSource.referrer,
      sourceCategory: state.trafficSource.sourceCategory,

      // Engagement metrics
      timeOnPage: timeOnPage,
      scrollDepth: state.maxScrollDepth,
      mouseMovements: state.mouseMovementCount,
      keyPresses: state.keyPressCount,
      touchEvents: state.touchEventCount,

      // Bot detection signals
      hasMouseMoved: state.hasMouseMoved,
      hasScrolled: state.hasScrolled,
      hasKeyPressed: state.hasKeyPressed,
      hasTouched: state.hasTouched,
      isWebdriver: state.isWebdriver,
      suspiciousUA: state.suspiciousUA,
      linearMovement: linearMovement,

      // Conversion
      addedToCart: state.addedToCart,
      addedToCartAt: state.addedToCartAt,

      // Device
      userAgent: state.userAgent,
      deviceType: state.deviceType,

      // Exit tracking
      exitType: state.exitType,

      // Timestamps
      startedAt: state.startTime,
      endedAt: Date.now(),
    };
  }

  // Send tracking data to API
  function sendTrackingData() {
    if (!CONFIG.apiEndpoint) return;

    const payload = buildPayload();

    // Use sendBeacon for reliability when page is unloading
    if (navigator.sendBeacon) {
      navigator.sendBeacon(CONFIG.apiEndpoint, JSON.stringify(payload));
    } else {
      // Fallback to fetch
      fetch(CONFIG.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(function() {});
    }
  }

  // Initialize
  function init() {
    if (!state.productHandle) return;

    setupEventListeners();

    // Send initial ping after 1 second
    setTimeout(function() {
      state.hasSentInitial = true;
      sendTrackingData();
    }, 1000);

    // Send periodic updates
    setInterval(function() {
      sendTrackingData();
    }, CONFIG.sendInterval);
  }

  // Start tracking when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
