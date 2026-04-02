(function() {
  'use strict';

  // Detect page type (product or collection)
  function getPageInfo() {
    var productMatch = window.location.pathname.match(/\/products\/([^/?#]+)/);
    if (productMatch) {
      return { handle: productMatch[1], type: 'product' };
    }

    var collectionMatch = window.location.pathname.match(/\/collections\/([^/?#]+)/);
    if (collectionMatch) {
      return { handle: collectionMatch[1], type: 'collection' };
    }

    return null;
  }

  // Only run on product or collection pages
  var pageInfo = getPageInfo();
  if (!pageInfo) {
    return;
  }

  var CONFIG = {
    apiEndpoint: window.__TRACKING_API_ENDPOINT__ || '',
    minTimeForReal: 5000, // 5 seconds minimum for "real" user
    sendInterval: 30000, // Send update every 30 seconds
    sessionKey: 'mw_session',
    cookieName: 'mw_sid', // Cookie name for cross-context session tracking
    cookieDays: 7, // Cookie expiry in days
    maxActiveTime: 1800000, // 30 minutes max active time (ms)
  };

  // Cookie helpers
  function setCookie(name, value, days) {
    var expires = new Date();
    expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = name + '=' + encodeURIComponent(value) +
      ';expires=' + expires.toUTCString() +
      ';path=/;SameSite=Lax';
  }

  function getCookie(name) {
    var nameEQ = name + '=';
    var ca = document.cookie.split(';');
    for (var i = 0; i < ca.length; i++) {
      var c = ca[i].trim();
      if (c.indexOf(nameEQ) === 0) {
        return decodeURIComponent(c.substring(nameEQ.length));
      }
    }
    return null;
  }

  // Generate or retrieve session ID (uses both cookie and sessionStorage)
  function getSessionId() {
    // First check cookie (persists across checkout)
    var sessionId = getCookie(CONFIG.cookieName);

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

  // Get current store hostname for same-domain detection
  function getStoreHost() {
    return window.location.hostname.replace(/^www\./, '').toLowerCase();
  }

  // Known social media platforms (used for source classification)
  var SOCIAL_PLATFORMS = /facebook|fb\.com|instagram|twitter|x\.com|tiktok|pinterest|linkedin|snapchat|reddit|tumblr|youtube/i;

  // Parse traffic source from UTM params and referrer
  function getTrafficSource() {
    var params = new URLSearchParams(window.location.search);
    var referrer = document.referrer;

    var source = params.get('utm_source');
    var medium = params.get('utm_medium');
    var campaign = params.get('utm_campaign');

    var sourceCategory = 'Direct';
    var storeHost = getStoreHost();

    if (source && medium) {
      // UTM-based classification — check source + medium together
      var sourceLower = source.toLowerCase();
      var mediumLower = medium.toLowerCase();

      // Check if the source is a social platform first
      var isSocialSource = SOCIAL_PLATFORMS.test(sourceLower);

      if (isSocialSource && ['cpc', 'ppc', 'paid', 'paidsearch', 'paid_social', 'paidsocial', 'paid-social'].includes(mediumLower)) {
        // Facebook/Instagram/TikTok etc. with CPC = Paid Social, NOT Paid Search
        sourceCategory = 'Paid Social';
      } else if (['cpc', 'ppc', 'paid', 'paidsearch'].includes(mediumLower)) {
        // Non-social CPC (Google, Bing, etc.) = Paid Search
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
        var refHost = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase();

        // Same domain = Internal navigation (e.g., homepage -> product page)
        if (refHost === storeHost || refHost.endsWith('.' + storeHost) || storeHost.endsWith('.' + refHost)) {
          sourceCategory = 'Internal';
        }
        // Search engines
        else if (/google\./i.test(refHost)) sourceCategory = 'Organic Search';
        else if (/bing\./i.test(refHost)) sourceCategory = 'Organic Search';
        else if (/yahoo\./i.test(refHost)) sourceCategory = 'Organic Search';
        else if (/duckduckgo/i.test(refHost)) sourceCategory = 'Organic Search';
        else if (/baidu/i.test(refHost)) sourceCategory = 'Organic Search';
        // Social
        else if (SOCIAL_PLATFORMS.test(refHost)) sourceCategory = 'Organic Social';
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
      var host = new URL(referrer).hostname.replace('www.', '');
      return host.split('.')[0]; // e.g., "google" from "google.com"
    } catch (e) {
      return 'unknown';
    }
  }

  // Get scroll depth as percentage
  function getScrollDepth() {
    var docHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    var winHeight = window.innerHeight;
    var scrollTop = window.scrollY || document.documentElement.scrollTop;

    if (docHeight <= winHeight) return 100;

    var scrollPercent = Math.round((scrollTop / (docHeight - winHeight)) * 100);
    return Math.min(100, Math.max(0, scrollPercent));
  }

  // Detect device type
  function getDeviceType() {
    var ua = navigator.userAgent;
    if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
    if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  // Check for linear mouse movement (bot indicator)
  function isLinearMovement(movements) {
    if (movements.length < 10) return false;

    // Sample some movements and check if they're too linear
    var sample = movements.slice(-20);
    var linearCount = 0;

    for (var i = 2; i < sample.length; i++) {
      var dx1 = sample[i-1].x - sample[i-2].x;
      var dy1 = sample[i-1].y - sample[i-2].y;
      var dx2 = sample[i].x - sample[i-1].x;
      var dy2 = sample[i].y - sample[i-1].y;

      // Check if direction is almost identical (cross product near zero)
      var cross = Math.abs(dx1 * dy2 - dy1 * dx2);
      if (cross < 10) linearCount++;
    }

    // If more than 80% of movements are linear, flag as suspicious
    return linearCount / (sample.length - 2) > 0.8;
  }

  // Extract search query, filters, and sort from URL params
  function extractSearchAndFilters() {
    var params = new URLSearchParams(window.location.search);
    var searchQuery = params.get('q') || null;
    var sortBy = params.get('sort_by') || null;
    var filters = {};
    var hasFilters = false;

    params.forEach(function(value, key) {
      // Shopify filter params: filter.v.* (variant), filter.p.* (product), filter.m.* (metafield)
      if (key.indexOf('filter.') === 0) {
        if (!filters[key]) filters[key] = [];
        filters[key].push(value);
        hasFilters = true;
      }
    });

    return {
      searchQuery: searchQuery,
      appliedFilters: hasFilters ? JSON.stringify(filters) : null,
      sortBy: sortBy,
    };
  }

  // Check referrer for search query (e.g., navigated from /search?q=term)
  function getSearchQueryFromReferrer() {
    try {
      if (!document.referrer) return null;
      var refUrl = new URL(document.referrer);
      // Only check same-domain referrer
      if (refUrl.hostname.replace(/^www\./, '') !== getStoreHost()) return null;
      if (refUrl.pathname === '/search') {
        return refUrl.searchParams.get('q') || null;
      }
    } catch (e) {}
    return null;
  }

  // Main tracking state
  var initialSearchFilters = extractSearchAndFilters();
  var state = {
    sessionId: getSessionId(),
    pageViewId: 'pv_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now(),
    productHandle: pageInfo.handle,
    resourceType: pageInfo.type,
    startTime: Date.now(),

    // Active time tracking — only counts time while page is visible and user is active
    activeTime: 0,
    lastTickTime: Date.now(),
    isPageVisible: !document.hidden,
    isStopped: false, // once stopped (idle/exit), no more updates

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
    exitUrl: null,
    lastActivityTime: Date.now(),
    idleTimeout: 120000, // 2 minutes idle = idle exit

    // Search & filter tracking
    searchQuery: initialSearchFilters.searchQuery || getSearchQueryFromReferrer(),
    appliedFilters: initialSearchFilters.appliedFilters,
    sortBy: initialSearchFilters.sortBy,
    filterInteractions: 0,
    lastUrl: window.location.href,

    // Interval IDs (for cleanup)
    sendIntervalId: null,
    idleIntervalId: null,
    timeTickIntervalId: null,

    // CTA click tracking — ordered array of clicks
    ctaClicks: [], // [{label, tag, href, time}, ...]

    // Sent flag
    hasSentInitial: false,
    cartAttributeWritten: false,
  };

  // Accumulate active time — called every second
  function tickActiveTime() {
    if (state.isStopped) return;
    var now = Date.now();
    // Only count time if page is visible and user is not idle
    var idleTime = now - state.lastActivityTime;
    if (state.isPageVisible && idleTime < state.idleTimeout) {
      state.activeTime += (now - state.lastTickTime);
    }
    state.lastTickTime = now;
    // Cap at max active time
    if (state.activeTime > CONFIG.maxActiveTime) {
      state.activeTime = CONFIG.maxActiveTime;
    }
  }

  // Stop all tracking — called on idle or final exit
  function stopTracking() {
    if (state.isStopped) return;
    state.isStopped = true;
    if (state.sendIntervalId) clearInterval(state.sendIntervalId);
    if (state.idleIntervalId) clearInterval(state.idleIntervalId);
    if (state.timeTickIntervalId) clearInterval(state.timeTickIntervalId);
  }

  // Track user activity for idle detection
  function updateActivity() {
    if (state.isStopped) return;
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
      var depth = getScrollDepth();
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

    // Click tracking for exit type and exit URL detection
    document.addEventListener('click', function(e) {
      updateActivity();
      var target = e.target.closest('a');
      if (target && target.href) {
        try {
          var url = new URL(target.href, window.location.origin);
          var currentHost = window.location.hostname;

          // Capture the exit URL
          state.exitUrl = target.href;

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
        } catch (err) {
          // Invalid URL, ignore
        }
      }

      // CTA click tracking — capture clicks across all page zones
      var clickedEl = e.target.closest('a, button, [type="submit"], input[type="submit"], img');
      if (!clickedEl) return;

      // Determine page zone
      var zone = 'main';
      if (clickedEl.closest('header, .header, .site-header, .announcement-bar, .header-wrapper')) {
        zone = 'header';
      } else if (clickedEl.closest('footer, .footer, .site-footer, .footer-wrapper')) {
        zone = 'footer';
      } else if (clickedEl.closest('.jdgm-widget, .jdgm-rev-widg, .stamped-container, .stamped-main-widget, .loox-widget, .yotpo-widget, .yotpo-main-widget, .spr-container, [data-reviewapp], .trustpilot-widget, .okendo-widget')) {
        zone = 'widget';
      } else if (clickedEl.closest('nav, .nav, .site-nav, .breadcrumb, .breadcrumbs, .pagination')) {
        zone = 'header'; // Treat nav as header
      }

      // Get CTA label from text content
      var label = '';
      if (clickedEl.tagName === 'IMG') {
        label = clickedEl.getAttribute('alt') || clickedEl.getAttribute('aria-label') || 'Image';
      } else {
        label = (clickedEl.textContent || clickedEl.value || clickedEl.getAttribute('aria-label') || '').trim();
      }
      // Clean up whitespace and limit length
      label = label.replace(/\s+/g, ' ').substring(0, 60);
      if (!label || label.length < 2) return;

      // Skip generic/non-CTA text
      if (/^(menu|close|open|search|\d+|x|×)$/i.test(label)) return;

      // Cap at 50 entries per visit (increased for multi-zone tracking)
      if (state.ctaClicks.length < 50) {
        state.ctaClicks.push({
          label: label,
          tag: clickedEl.tagName.toLowerCase(),
          href: clickedEl.href || clickedEl.src || null,
          time: Date.now() - state.startTime,
          zone: zone,
        });
      }
    }, { passive: true });

    // Save reference to original fetch BEFORE monkey-patching
    var originalFetch = window.fetch;

    // Write session ID to cart attributes so the web pixel can read it at checkout
    function writeSessionToCart() {
      if (state.cartAttributeWritten) return;
      state.cartAttributeWritten = true;
      try {
        originalFetch.call(window, '/cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attributes: {
              '_mw_sid': state.sessionId,
              '_mw_product': state.productHandle,
            }
          })
        }).catch(function() {});
      } catch (e) {}
    }

    // Add to cart detection - listen for form submissions and button clicks
    document.addEventListener('submit', function(e) {
      var form = e.target;
      if (form.action && form.action.includes('/cart/add')) {
        state.addedToCart = true;
        state.addedToCartAt = Date.now();
        state.exitType = 'checkout';
        writeSessionToCart();
        sendTrackingData();
      }
    });

    // Also listen for AJAX add-to-cart (common in modern themes)
    window.fetch = function() {
      var url = arguments[0];
      if (typeof url === 'string' && url.includes('/cart/add')) {
        state.addedToCart = true;
        state.addedToCartAt = Date.now();
        state.exitType = 'checkout';
        // Write session to cart after the add-to-cart completes
        var result = originalFetch.apply(this, arguments);
        result.then(function() { writeSessionToCart(); }).catch(function() {});
        return result;
      }
      return originalFetch.apply(this, arguments);
    };

    // URL change monitoring — detect AJAX filter/sort changes on collection pages
    function onUrlChange() {
      var newUrl = window.location.href;
      if (newUrl !== state.lastUrl) {
        state.lastUrl = newUrl;
        var updated = extractSearchAndFilters();
        if (updated.appliedFilters || updated.sortBy || updated.searchQuery) {
          state.filterInteractions++;
          state.appliedFilters = updated.appliedFilters || state.appliedFilters;
          state.sortBy = updated.sortBy || state.sortBy;
          state.searchQuery = updated.searchQuery || state.searchQuery;
        }
      }
    }

    // Monkey-patch pushState/replaceState to detect Shopify AJAX filter navigation
    var origPushState = history.pushState;
    var origReplaceState = history.replaceState;
    history.pushState = function() {
      origPushState.apply(this, arguments);
      onUrlChange();
    };
    history.replaceState = function() {
      origReplaceState.apply(this, arguments);
      onUrlChange();
    };

    // Back/forward button detection
    window.addEventListener('popstate', function() {
      onUrlChange();
      state.exitType = 'back_button';
      sendTrackingData();
    });

    // Page visibility change — pause/resume active time tracking
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') {
        state.isPageVisible = false;
        // Tick one last time before going hidden
        tickActiveTime();
        // If no exit type set, it's likely window closed or tab switched
        if (!state.exitType) {
          state.exitType = 'window_closed';
        }
        sendTrackingData();
      } else {
        state.isPageVisible = true;
        state.lastTickTime = Date.now();
      }
    });

    // Before unload - window/tab closing
    window.addEventListener('beforeunload', function() {
      tickActiveTime(); // Final tick
      if (!state.exitType) {
        state.exitType = 'window_closed';
      }
      sendTrackingData();
      stopTracking();
    });

    // Idle detection - check every 30 seconds
    state.idleIntervalId = setInterval(function() {
      var idleTime = Date.now() - state.lastActivityTime;
      if (idleTime >= state.idleTimeout && state.exitType !== 'idle') {
        tickActiveTime(); // Final tick
        state.exitType = 'idle';
        sendTrackingData();
        stopTracking(); // Stop all intervals — no more updates after idle
      }
    }, 30000);
  }

  // Build tracking payload
  function buildPayload() {
    tickActiveTime(); // Ensure active time is up to date
    var linearMovement = isLinearMovement(state.mouseMovements);

    return {
      sessionId: state.sessionId,
      pageViewId: state.pageViewId,
      productHandle: state.productHandle,
      resourceType: state.resourceType,

      // Traffic source
      source: state.trafficSource.source,
      medium: state.trafficSource.medium,
      campaign: state.trafficSource.campaign,
      referrer: state.trafficSource.referrer,
      sourceCategory: state.trafficSource.sourceCategory,

      // Engagement metrics — use activeTime instead of wall clock
      timeOnPage: state.activeTime,
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
      exitUrl: state.exitUrl,

      // Search & filter tracking
      searchQuery: state.searchQuery,
      appliedFilters: state.appliedFilters,
      sortBy: state.sortBy,
      filterInteractions: state.filterInteractions,

      // CTA clicks (ordered array)
      ctaClicks: state.ctaClicks.length > 0 ? JSON.stringify(state.ctaClicks) : null,

      // Timestamps
      startedAt: state.startTime,
      endedAt: Date.now(),
    };
  }

  // Send tracking data to API
  function sendTrackingData() {
    if (!CONFIG.apiEndpoint) return;

    var payload = buildPayload();

    // Use sendBeacon for reliability when page is unloading
    // Note: sendBeacon with string sends as text/plain (CORS-safe, no preflight)
    // Server-side handles text/plain parsing via fallback
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

    // Tick active time every second for accurate measurement
    state.timeTickIntervalId = setInterval(tickActiveTime, 1000);

    // Send initial ping after 1 second
    setTimeout(function() {
      state.hasSentInitial = true;
      sendTrackingData();
    }, 1000);

    // Send periodic updates (stops automatically on idle/exit)
    state.sendIntervalId = setInterval(function() {
      if (!state.isStopped) {
        sendTrackingData();
      }
    }, CONFIG.sendInterval);
  }

  // Start tracking when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
