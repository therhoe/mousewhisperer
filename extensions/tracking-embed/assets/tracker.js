(function () {
  "use strict";

  // Detect page type (homepage, product, collection, page, or blog)
  function getPageInfo() {
    if (window.location.pathname === "/" || window.location.pathname === "") {
      return { handle: "__homepage__", type: "homepage" };
    }

    var productMatch = window.location.pathname.match(/\/products\/([^/?#]+)/);
    if (productMatch) {
      return { handle: productMatch[1], type: "product" };
    }

    var collectionMatch = window.location.pathname.match(
      /\/collections\/([^/?#]+)/,
    );
    if (collectionMatch) {
      return { handle: collectionMatch[1], type: "collection" };
    }

    // Blog post: /blogs/{blog-handle}/{post-handle} or blog index: /blogs/{blog-handle}
    var blogPostMatch = window.location.pathname.match(
      /\/blogs\/([^/?#]+)\/([^/?#]+)/,
    );
    if (blogPostMatch) {
      return {
        handle: blogPostMatch[1] + "/" + blogPostMatch[2],
        type: "blog",
      };
    }
    var blogMatch = window.location.pathname.match(/\/blogs\/([^/?#]+)/);
    if (blogMatch) {
      return { handle: blogMatch[1], type: "blog" };
    }

    // Pages: /pages/{handle}
    var pageMatch = window.location.pathname.match(/\/pages\/([^/?#]+)/);
    if (pageMatch) {
      return { handle: pageMatch[1], type: "page" };
    }

    // Store snapshots are store-wide, so keep collecting engagement on other
    // storefront paths even when they do not map to a focused audit resource.
    return { handle: null, type: "store_page" };
  }

  var pageInfo = getPageInfo();
  var journeyFetch = window.fetch.bind(window);

  function resolveApiEndpoint() {
    var endpoint = window.__TRACKING_API_ENDPOINT__ || "/apps/api";
    try {
      var url = new URL(endpoint, window.location.origin);
      if (url.hostname === "mousewhisperer.vercel.app") {
        return "/apps/api";
      }
    } catch (e) {}
    return endpoint;
  }

  var CONFIG = {
    apiEndpoint: resolveApiEndpoint(),
    minTimeForReal: 5000, // 5 seconds minimum for "real" user
    sendInterval: 30000, // Send update every 30 seconds
    sessionKey: "mw_session",
    cookieName: "mw_sid", // Cookie name for cross-context session tracking
    richTrackerCookieName: "mw_rich_seen",
    acquisitionKey: "mw_acquisition_v1",
    acquisitionCookieName: "mw_csid",
    acquisitionDataCookieName: "mw_acq",
    acquisitionTimeout: 30 * 60 * 1000,
    cookieDays: 7, // Cookie expiry in days
    maxActiveTime: 1800000, // 30 minutes max active time (ms)
  };

  // Cookie helpers
  function setCookie(name, value, days) {
    try {
      var expires = new Date();
      expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
      document.cookie =
        name +
        "=" +
        encodeURIComponent(value) +
        ";expires=" +
        expires.toUTCString() +
        ";path=/;SameSite=Lax";
    } catch (e) {}
  }

  function getCookie(name) {
    try {
      var nameEQ = name + "=";
      var ca = document.cookie.split(";");
      for (var i = 0; i < ca.length; i++) {
        var c = ca[i].trim();
        if (c.indexOf(nameEQ) === 0) {
          return decodeURIComponent(c.substring(nameEQ.length));
        }
      }
    } catch (e) {}
    return null;
  }

  function readStorage(storageName, key) {
    try {
      return window[storageName].getItem(key);
    } catch (e) {
      return null;
    }
  }

  function writeStorage(storageName, key, value) {
    try {
      window[storageName].setItem(key, value);
    } catch (e) {}
  }

  var inMemorySessionId = null;

  function acquisitionTrackingSession(value, now) {
    try {
      var record = JSON.parse(value);
      return record &&
        record.version === 1 &&
        typeof record.trackingSessionId === "string" &&
        /^[a-zA-Z0-9_-]{1,160}$/.test(record.trackingSessionId) &&
        Number.isFinite(record.trackingExpiresAt) &&
        record.trackingExpiresAt > now &&
        record.trackingExpiresAt <= now + CONFIG.cookieDays * 86400000 + 60000
        ? record.trackingSessionId
        : null;
    } catch (e) {
      return null;
    }
  }

  // Generate or retrieve session ID (uses both cookie and sessionStorage)
  function getSessionId() {
    // First check cookie (persists across checkout)
    var sessionId = getCookie(CONFIG.cookieName);

    // Then check sessionStorage
    if (!sessionId) {
      sessionId = readStorage("sessionStorage", CONFIG.sessionKey);
    }

    if (!sessionId) sessionId = inMemorySessionId;

    // Keep the acquisition and checkout IDs paired when localStorage is the
    // only available persistence. This fallback has the same seven-day expiry
    // as mw_sid, independent of the acquisition's 30-minute inactivity window.
    if (!sessionId) {
      sessionId =
        acquisitionTrackingSession(
          readStorage("localStorage", CONFIG.acquisitionKey),
          Date.now(),
        ) ||
        acquisitionTrackingSession(
          getCookie(CONFIG.acquisitionDataCookieName),
          Date.now(),
        );
    }

    // If still no session, create new one
    if (!sessionId) {
      sessionId =
        "sess_" + Math.random().toString(36).substr(2, 9) + "_" + Date.now();
    }

    // Store in both places for redundancy
    inMemorySessionId = sessionId;
    writeStorage("sessionStorage", CONFIG.sessionKey, sessionId);
    setCookie(CONFIG.cookieName, sessionId, CONFIG.cookieDays);

    return sessionId;
  }

  // Get current store hostname for same-domain detection
  function getStoreHost() {
    return window.location.hostname.replace(/^www\./, "").toLowerCase();
  }

  function getShopDomain() {
    if (window.Shopify && typeof window.Shopify.shop === "string") {
      return window.Shopify.shop;
    }
    return null;
  }

  function getCurrentTemplateSuffix() {
    if (
      window.__MW_CURRENT_TEMPLATE__ &&
      typeof window.__MW_CURRENT_TEMPLATE__.suffix === "string" &&
      window.__MW_CURRENT_TEMPLATE__.suffix.trim()
    ) {
      return window.__MW_CURRENT_TEMPLATE__.suffix.trim();
    }
    return null;
  }

  // Known social media platforms (used for source classification)
  var SOCIAL_PLATFORMS =
    /facebook|fb\.com|instagram|twitter|x\.com|tiktok|pinterest|linkedin|snapchat|reddit|tumblr|youtube/i;

  // Parse traffic source from UTM params and referrer
  function getTrafficSource() {
    var params = new URLSearchParams(window.location.search);
    var referrer = document.referrer;

    var source = params.get("utm_source");
    var medium = params.get("utm_medium");
    var campaign = params.get("utm_campaign");

    var sourceCategory = "Direct";
    var storeHost = getStoreHost();

    if (source && medium) {
      // UTM-based classification — check source + medium together
      var sourceLower = source.toLowerCase();
      var mediumLower = medium.toLowerCase();

      // Check if the source is a social platform first
      var isSocialSource = SOCIAL_PLATFORMS.test(sourceLower);

      if (
        isSocialSource &&
        [
          "cpc",
          "ppc",
          "paid",
          "paidsearch",
          "paid_social",
          "paidsocial",
          "paid-social",
        ].includes(mediumLower)
      ) {
        // Facebook/Instagram/TikTok etc. with CPC = Paid Social, NOT Paid Search
        sourceCategory = "Paid Social";
      } else if (["cpc", "ppc", "paid", "paidsearch"].includes(mediumLower)) {
        // Non-social CPC (Google, Bing, etc.) = Paid Search
        sourceCategory = "Paid Search";
      } else if (
        ["paid_social", "paidsocial", "paid-social"].includes(mediumLower)
      ) {
        sourceCategory = "Paid Social";
      } else if (mediumLower === "email") {
        sourceCategory = "Email";
      } else if (
        mediumLower === "organic" ||
        mediumLower === "product_sync" ||
        mediumLower === "product_listing"
      ) {
        sourceCategory = "Organic Search";
      } else if (mediumLower === "social") {
        sourceCategory = "Organic Social";
      } else if (mediumLower === "referral") {
        sourceCategory = "Referral";
      } else if (
        /^(google|bing|yahoo|duckduckgo|baidu|yandex)$/i.test(sourceLower)
      ) {
        // Known search engine with unknown medium — treat as Organic Search
        sourceCategory = "Organic Search";
      } else if (isSocialSource) {
        sourceCategory = "Organic Social";
      }
    } else if (referrer) {
      // Referrer-based classification
      try {
        var refHost = new URL(referrer).hostname
          .replace(/^www\./, "")
          .toLowerCase();

        // Same domain = Internal navigation (e.g., homepage -> product page)
        if (
          refHost === storeHost ||
          refHost.endsWith("." + storeHost) ||
          storeHost.endsWith("." + refHost)
        ) {
          sourceCategory = "Internal";
        }
        // Search engines
        else if (/google\./i.test(refHost)) sourceCategory = "Organic Search";
        else if (/bing\./i.test(refHost)) sourceCategory = "Organic Search";
        else if (/yahoo\./i.test(refHost)) sourceCategory = "Organic Search";
        else if (/duckduckgo/i.test(refHost)) sourceCategory = "Organic Search";
        else if (/baidu/i.test(refHost)) sourceCategory = "Organic Search";
        // Social
        else if (SOCIAL_PLATFORMS.test(refHost))
          sourceCategory = "Organic Social";
        // Email
        else if (/mail|outlook|klaviyo/i.test(refHost))
          sourceCategory = "Email";
        // Everything else is referral
        else sourceCategory = "Referral";
      } catch (e) {
        sourceCategory = "Referral";
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
    if (!referrer) return "direct";
    try {
      var host = new URL(referrer).hostname.replace("www.", "");
      return host.split(".")[0]; // e.g., "google" from "google.com"
    } catch (e) {
      return "unknown";
    }
  }

  // Acquisition is separate from legacy page-level traffic attribution. A visit
  // arriving from Google stays Google when the shopper opens an internal page.
  var ACQUISITION_CATEGORIES = [
    "Direct",
    "Paid Search",
    "Paid Social",
    "Organic Search",
    "Organic Social",
    "Email",
    "Referral",
    "Unknown",
  ];

  // Bound encoded bytes as well as characters so the complete record fits in a
  // cookie when both storage APIs are unavailable. Never store URL query data.
  function acquisitionText(value, maxBytes) {
    if (typeof value !== "string") return null;
    var text = value.trim();
    var result = "";
    var bytes = 0;
    for (var i = 0; i < text.length; i++) {
      var character = text.charAt(i);
      var code = text.charCodeAt(i);
      if (code < 0x20 || code === 0x7f) continue;
      if (code >= 0xd800 && code <= 0xdbff) {
        var next = text.charCodeAt(i + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) continue;
        character += text.charAt(++i);
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        continue;
      }
      bytes += encodeURIComponent(character).length;
      if (bytes > maxBytes) break;
      result += character;
    }
    return result || null;
  }

  function acquisitionNavigationType() {
    try {
      var entries = window.performance.getEntriesByType("navigation");
      return entries.length ? entries[0].type : null;
    } catch (e) {
      return null;
    }
  }

  function isAcquisitionInternalHost(host) {
    var normalized = host.replace(/^www\./, "").toLowerCase();
    var hosts = [getStoreHost(), (getShopDomain() || "").toLowerCase()];
    return hosts.some(function (storeHost) {
      return (
        storeHost &&
        (normalized === storeHost ||
          normalized.endsWith("." + storeHost) ||
          storeHost.endsWith("." + normalized))
      );
    });
  }

  function getAcquisitionArrival() {
    var params = new URLSearchParams(window.location.search);
    var source = acquisitionText(params.get("utm_source"), 160);
    var medium = acquisitionText(params.get("utm_medium"), 100);
    var campaign = acquisitionText(params.get("utm_campaign"), 240);
    var campaignId = acquisitionText(
      params.get("utm_id") || params.get("campaign_id"),
      160,
    );
    var adId = acquisitionText(
      params.get("ad_id") || params.get("utm_content"),
      160,
    );
    var referrer = null;
    var refHost = null;
    var internal = false;
    try {
      if (document.referrer) {
        var refUrl = new URL(document.referrer);
        if (refUrl.protocol === "https:" || refUrl.protocol === "http:") {
          refHost = refUrl.hostname.toLowerCase();
          internal = isAcquisitionInternalHost(refHost);
          referrer = acquisitionText(refUrl.origin + refUrl.pathname, 600);
        }
      }
    } catch (e) {}

    var category = "Unknown";
    var sourceLower = (source || "").toLowerCase();
    var mediumLower = (medium || "").toLowerCase();
    var hasCampaign = !!(source || medium || campaign || campaignId || adId);
    var navigationType = acquisitionNavigationType();
    var revisiting =
      navigationType === "reload" || navigationType === "back_forward";
    if (!internal && !revisiting) {
      if (hasCampaign) {
        if (
          ["paid_social", "paidsocial", "paid-social"].includes(mediumLower)
        ) {
          category = "Paid Social";
        } else if (
          ["cpc", "ppc", "paid", "paidsearch", "paid_search"].includes(
            mediumLower,
          )
        ) {
          category = SOCIAL_PLATFORMS.test(sourceLower)
            ? "Paid Social"
            : "Paid Search";
        } else if (mediumLower === "email") {
          category = "Email";
        } else if (mediumLower === "social") {
          category = "Organic Social";
        } else if (
          ["organic", "product_sync", "product_listing"].includes(mediumLower)
        ) {
          category = SOCIAL_PLATFORMS.test(sourceLower)
            ? "Organic Social"
            : "Organic Search";
        } else if (mediumLower === "referral") {
          category = "Referral";
        } else if (
          /^(google|bing|yahoo|duckduckgo|baidu|yandex)$/i.test(sourceLower)
        ) {
          category = "Organic Search";
        } else if (SOCIAL_PLATFORMS.test(sourceLower)) {
          category = "Organic Social";
        }
      } else if (refHost) {
        if (
          /(^|\.)(google\.[a-z.]+|bing\.com|yahoo\.[a-z.]+|duckduckgo\.com|baidu\.com|yandex\.[a-z.]+)$/i.test(
            refHost,
          )
        ) {
          category = "Organic Search";
        } else if (SOCIAL_PLATFORMS.test(refHost)) {
          category = "Organic Social";
        } else if (/mail|outlook|klaviyo/i.test(refHost)) {
          category = "Email";
        } else {
          category = "Referral";
        }
      } else if (!document.referrer && !revisiting) {
        category = "Direct";
      }
    }

    // Internal links are not an acquisition source, even when a theme decorates
    // those links with UTMs. Without saved arrival data the honest label is Unknown.
    return {
      source:
        internal || revisiting
          ? null
          : source ||
            (refHost
              ? acquisitionText(refHost.replace(/^www\./, ""), 160)
              : category === "Direct"
                ? "direct"
                : null),
      medium: internal || revisiting ? null : medium,
      campaign: internal || revisiting ? null : campaign,
      campaignId: internal || revisiting ? null : campaignId,
      adId: internal || revisiting ? null : adId,
      referrer: internal || revisiting ? null : referrer,
      sourceCategory: category,
      landingPath: acquisitionText(window.location.pathname || "/", 600) || "/",
      canStartCampaign: hasCampaign && !internal && !revisiting,
      canStartExternal: !!refHost && !internal && !revisiting,
    };
  }

  function parseAcquisitionRecord(value, now) {
    try {
      var record = JSON.parse(value);
      if (
        !record ||
        record.version !== 1 ||
        !acquisitionTrackingSession(value, now) ||
        typeof record.id !== "string" ||
        !/^acq_[a-zA-Z0-9_-]{8,100}$/.test(record.id) ||
        !Number.isFinite(record.startedAt) ||
        !Number.isFinite(record.lastActivityAt) ||
        record.startedAt <= 0 ||
        record.lastActivityAt < record.startedAt ||
        record.lastActivityAt > now + 60000 ||
        now - record.lastActivityAt >= CONFIG.acquisitionTimeout ||
        !ACQUISITION_CATEGORIES.includes(record.sourceCategory) ||
        typeof record.landingPath !== "string" ||
        record.landingPath.charAt(0) !== "/"
      )
        return null;
      return {
        version: 1,
        id: record.id,
        startedAt: record.startedAt,
        lastActivityAt: record.lastActivityAt,
        trackingSessionId: record.trackingSessionId,
        trackingExpiresAt: record.trackingExpiresAt,
        source: acquisitionText(record.source, 160),
        medium: acquisitionText(record.medium, 100),
        campaign: acquisitionText(record.campaign, 240),
        campaignId: acquisitionText(record.campaignId, 160),
        adId: acquisitionText(record.adId, 160),
        referrer: acquisitionText(record.referrer, 600),
        sourceCategory: record.sourceCategory,
        landingPath: acquisitionText(record.landingPath, 600) || "/",
      };
    } catch (e) {
      return null;
    }
  }

  function isNewerAcquisition(candidate, current) {
    return (
      !!candidate &&
      (!current ||
        candidate.startedAt > current.startedAt ||
        (candidate.startedAt === current.startedAt &&
          candidate.id > current.id))
    );
  }

  function latestSharedAcquisition(now) {
    var local = parseAcquisitionRecord(
      readStorage("localStorage", CONFIG.acquisitionKey),
      now,
    );
    var cookie = parseAcquisitionRecord(
      getCookie(CONFIG.acquisitionDataCookieName),
      now,
    );
    return isNewerAcquisition(cookie, local) ? cookie : local;
  }

  function persistAcquisition(record) {
    var value = JSON.stringify(record);
    writeStorage("sessionStorage", CONFIG.acquisitionKey, value);
    // Each tab retains its journey, but its heartbeat must not replace a newer
    // arrival shared with other tabs. Checkout uses explicit IDs from its tab.
    if (isNewerAcquisition(latestSharedAcquisition(Date.now()), record)) return;
    writeStorage("localStorage", CONFIG.acquisitionKey, value);
    var days = CONFIG.acquisitionTimeout / (24 * 60 * 60 * 1000);
    setCookie(CONFIG.acquisitionDataCookieName, value, days);
    setCookie(CONFIG.acquisitionCookieName, record.id, days);
  }

  function getAcquisition() {
    var now = Date.now();
    var trackingSessionId = getSessionId();
    var arrival = getAcquisitionArrival();
    var shared = latestSharedAcquisition(now);
    var tabRecord = parseAcquisitionRecord(
      readStorage("sessionStorage", CONFIG.acquisitionKey),
      now,
    );
    var record =
      tabRecord && tabRecord.trackingSessionId === trackingSessionId
        ? tabRecord
        : shared && shared.trackingSessionId === trackingSessionId
          ? shared
          : null;
    var newArrival =
      record &&
      (arrival.canStartCampaign || arrival.canStartExternal) &&
      (record.source !== arrival.source ||
        record.medium !== arrival.medium ||
        record.campaign !== arrival.campaign ||
        (record.campaignId || null) !== arrival.campaignId ||
        (record.adId || null) !== arrival.adId ||
        record.sourceCategory !== arrival.sourceCategory);
    if (!record || newArrival) {
      // Resolve same-millisecond arrivals deterministically across tabs.
      var acquisitionStartedAt = Math.max(
        now,
        shared ? shared.startedAt + 1 : now,
      );
      record = {
        version: 1,
        id: "acq_" + Math.random().toString(36).substr(2, 9) + "_" + now,
        startedAt: acquisitionStartedAt,
        lastActivityAt: acquisitionStartedAt,
        trackingSessionId: trackingSessionId,
        source: arrival.source,
        medium: arrival.medium,
        campaign: arrival.campaign,
        campaignId: arrival.campaignId,
        adId: arrival.adId,
        referrer: arrival.referrer,
        sourceCategory: arrival.sourceCategory,
        landingPath: arrival.landingPath,
      };
    }
    record.lastActivityAt = Math.max(now, record.startedAt);
    record.trackingExpiresAt = now + CONFIG.cookieDays * 86400000;
    persistAcquisition(record);
    return record;
  }

  function acquisitionPayload() {
    var record = state.acquisition;
    return {
      id: record.id,
      startedAt: record.startedAt,
      source: record.source,
      medium: record.medium,
      campaign: record.campaign,
      campaignId: record.campaignId || null,
      adId: record.adId || null,
      referrer: record.referrer,
      sourceCategory: record.sourceCategory,
      landingPath: record.landingPath,
    };
  }

  // Get scroll depth as percentage
  function getScrollDepth() {
    var docHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
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
    if (/tablet|ipad|playbook|silk/i.test(ua)) return "tablet";
    if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua))
      return "mobile";
    return "desktop";
  }

  function getSessionPageOrder() {
    var key = "mw_page_order_" + getSessionId();
    var current = parseInt(readStorage("sessionStorage", key) || "0", 10);
    var next = current + 1;
    writeStorage("sessionStorage", key, String(next));
    return next;
  }

  // Check for linear mouse movement (bot indicator)
  function isLinearMovement(movements) {
    if (movements.length < 10) return false;

    // Sample some movements and check if they're too linear
    var sample = movements.slice(-20);
    var linearCount = 0;

    for (var i = 2; i < sample.length; i++) {
      var dx1 = sample[i - 1].x - sample[i - 2].x;
      var dy1 = sample[i - 1].y - sample[i - 2].y;
      var dx2 = sample[i].x - sample[i - 1].x;
      var dy2 = sample[i].y - sample[i - 1].y;

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
    var searchQuery = params.get("q") || null;
    var sortBy = params.get("sort_by") || null;
    var filters = {};
    var hasFilters = false;

    params.forEach(function (value, key) {
      // Shopify filter params: filter.v.* (variant), filter.p.* (product), filter.m.* (metafield)
      if (key.indexOf("filter.") === 0) {
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
      if (refUrl.hostname.replace(/^www\./, "") !== getStoreHost()) return null;
      if (refUrl.pathname === "/search") {
        return refUrl.searchParams.get("q") || null;
      }
    } catch (e) {}
    return null;
  }

  // Main tracking state
  var initialSearchFilters = extractSearchAndFilters();
  var state = {
    sessionId: getSessionId(),
    pageViewId:
      "pv_" + Math.random().toString(36).substr(2, 9) + "_" + Date.now(),
    shop: getShopDomain(),
    productHandle: pageInfo.handle,
    resourceType: pageInfo.type,
    pagePath: window.location.pathname || "/",
    pageUrl: window.location.href,
    pageTitle: document.title || null,
    templateSuffix: getCurrentTemplateSuffix(),
    urlAbTestId: new URLSearchParams(window.location.search).get("mw_ab"),
    urlAbVariantKey: new URLSearchParams(window.location.search).get("mw_abv"),
    pageOrder: getSessionPageOrder(),
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
    suspiciousUA: /bot|crawler|spider|headless|phantom|selenium/i.test(
      navigator.userAgent,
    ),

    // Traffic source
    trafficSource: getTrafficSource(),
    acquisition: getAcquisition(),

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
    searchQuery:
      initialSearchFilters.searchQuery || getSearchQueryFromReferrer(),
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
    cartAttributeWriteInFlight: null,
    abAssignmentChecked: false,
    abTestId: null,
    abVariantId: null,
    abVariantKey: null,
    abTemplateSuffix: null,
  };

  // Accumulate active time — called every second
  function tickActiveTime() {
    if (state.isStopped) return;
    var now = Date.now();
    // Only count time if page is visible and user is not idle
    var idleTime = now - state.lastActivityTime;
    if (state.isPageVisible && idleTime < state.idleTimeout) {
      state.activeTime += now - state.lastTickTime;
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

  function applyAbAssignment(assignment) {
    if (
      !assignment ||
      !assignment.assigned ||
      !assignment.test ||
      !assignment.variant
    )
      return;

    state.abTestId = assignment.test.id;
    state.abVariantId = assignment.variant.id;
    state.abVariantKey = assignment.variant.key;
    state.abTemplateSuffix = assignment.variant.templateSuffix || null;

    if (
      assignment.variant.isControl ||
      !assignment.variant.templateSuffix ||
      (window.Shopify && window.Shopify.designMode)
    ) {
      return;
    }

    try {
      var url = new URL(window.location.href);
      if (url.searchParams.get("view") === assignment.variant.templateSuffix) {
        return;
      }
      if (url.searchParams.get("mw_ab") === assignment.test.id) {
        return;
      }

      url.searchParams.set("view", assignment.variant.templateSuffix);
      url.searchParams.set("mw_ab", assignment.test.id);
      url.searchParams.set("mw_abv", assignment.variant.key);
      window.location.replace(url.toString());
    } catch (e) {}
  }

  function requestAbAssignment() {
    if (!CONFIG.apiEndpoint || state.abAssignmentChecked) return;
    state.abAssignmentChecked = true;

    try {
      fetch(CONFIG.apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "ab_test_assign",
          sessionId: state.sessionId,
          shop: state.shop,
          productHandle: state.productHandle,
          resourceType: state.resourceType,
          templateSuffix: state.templateSuffix,
          urlAbTestId: state.urlAbTestId,
          urlAbVariantKey: state.urlAbVariantKey,
          pagePath: state.pagePath,
          pageUrl: state.pageUrl,
          pageTitle: state.pageTitle,
        }),
        keepalive: true,
      })
        .then(function (response) {
          return response.json();
        })
        .then(applyAbAssignment)
        .catch(function () {});
    } catch (e) {}
  }

  // Event listeners
  function setupEventListeners() {
    // Mouse movement
    document.addEventListener(
      "mousemove",
      function (e) {
        state.hasMouseMoved = true;
        state.mouseMovementCount++;
        state.mouseMovements.push({
          x: e.clientX,
          y: e.clientY,
          t: Date.now(),
        });
        updateActivity();

        // Keep only last 100 movements
        if (state.mouseMovements.length > 100) {
          state.mouseMovements.shift();
        }
      },
      { passive: true },
    );

    // Scroll
    document.addEventListener(
      "scroll",
      function () {
        state.hasScrolled = true;
        var depth = getScrollDepth();
        state.maxScrollDepth = Math.max(state.maxScrollDepth, depth);
        updateActivity();
      },
      { passive: true },
    );

    // Keyboard
    document.addEventListener(
      "keydown",
      function () {
        state.hasKeyPressed = true;
        state.keyPressCount++;
        updateActivity();
      },
      { passive: true },
    );

    // Touch (mobile)
    document.addEventListener(
      "touchstart",
      function () {
        state.hasTouched = true;
        state.touchEventCount++;
        updateActivity();
      },
      { passive: true },
    );

    // Click tracking for exit type and exit URL detection
    document.addEventListener(
      "click",
      function (e) {
        updateActivity();
        var target = e.target.closest("a");
        if (target && target.href) {
          try {
            var url = new URL(target.href, window.location.origin);
            var currentHost = window.location.hostname;

            // Capture the exit URL
            state.exitUrl = target.href;

            // Check if it's a checkout/cart link
            if (
              url.pathname.includes("/cart") ||
              url.pathname.includes("/checkout")
            ) {
              state.exitType = "checkout";
            }
            // Check if internal or external link
            else if (url.hostname === currentHost) {
              state.exitType = "internal_link";
            } else {
              state.exitType = "external_link";
            }
          } catch (err) {
            // Invalid URL, ignore
          }
        }

        // CTA click tracking — capture clicks across all page zones
        var clickedEl = e.target.closest(
          'a, button, [type="submit"], input[type="submit"], img',
        );
        if (!clickedEl) return;

        // Determine page zone
        var zone = "main";
        if (
          clickedEl.closest(
            "header, .header, .site-header, .announcement-bar, .header-wrapper",
          )
        ) {
          zone = "header";
        } else if (
          clickedEl.closest("footer, .footer, .site-footer, .footer-wrapper")
        ) {
          zone = "footer";
        } else if (
          clickedEl.closest(
            ".jdgm-widget, .jdgm-rev-widg, .stamped-container, .stamped-main-widget, .loox-widget, .yotpo-widget, .yotpo-main-widget, .spr-container, [data-reviewapp], .trustpilot-widget, .okendo-widget",
          )
        ) {
          zone = "widget";
        } else if (
          clickedEl.closest(
            "nav, .nav, .site-nav, .breadcrumb, .breadcrumbs, .pagination",
          )
        ) {
          zone = "header"; // Treat nav as header
        }

        // Get CTA label from text content
        var label = "";
        if (clickedEl.tagName === "IMG") {
          label =
            clickedEl.getAttribute("alt") ||
            clickedEl.getAttribute("aria-label") ||
            "Image";
        } else {
          label = (
            clickedEl.textContent ||
            clickedEl.value ||
            clickedEl.getAttribute("aria-label") ||
            ""
          ).trim();
        }
        // Clean up whitespace and limit length
        label = label.replace(/\s+/g, " ").substring(0, 60);
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
      },
      { passive: true },
    );

    // Save reference to original fetch BEFORE monkey-patching
    var originalFetch = window.fetch;

    // Write session ID to cart attributes so the web pixel can read it at checkout
    function writeSessionToCart(force, isRetry) {
      // A delayed add-to-cart retry from an older tab must not overwrite a
      // newer journey's cart attributes. An explicit checkout still writes
      // the IDs of its actual initiating tab, even when that tab is older.
      if (
        isRetry &&
        isNewerAcquisition(
          latestSharedAcquisition(Date.now()),
          state.acquisition,
        )
      ) {
        return Promise.resolve(false);
      }
      if (state.cartAttributeWritten && !force) return Promise.resolve(true);
      if (state.cartAttributeWriteInFlight)
        return state.cartAttributeWriteInFlight;
      try {
        var attributes = {
          _mw_sid: state.sessionId,
          _mw_csid: state.acquisition.id,
          _mw_product: state.productHandle,
        };
        if (state.abTestId) attributes._mw_ab_test = state.abTestId;
        if (state.abVariantKey) attributes._mw_ab_variant = state.abVariantKey;

        state.cartAttributeWriteInFlight = originalFetch
          .call(window, "/cart/update.js", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              attributes: attributes,
            }),
          })
          .then(function (response) {
            if (response && response.ok === false)
              throw new Error("cart_update_failed");
            state.cartAttributeWritten = true;
            return true;
          })
          .catch(function () {
            return false;
          })
          .then(function (result) {
            state.cartAttributeWriteInFlight = null;
            return result;
          });
        return state.cartAttributeWriteInFlight;
      } catch (e) {
        state.cartAttributeWriteInFlight = null;
        return Promise.resolve(false);
      }
    }

    function sendCommerceEvent(eventType) {
      if (!CONFIG.apiEndpoint) return;
      try {
        originalFetch
          .call(window, CONFIG.apiEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eventType: eventType,
              sessionId: state.sessionId,
              acquisitionSessionId: state.acquisition.id,
              timestamp: Date.now(),
              productHandle: state.productHandle,
              productId: null,
              productTitle: state.pageTitle,
            }),
            keepalive: true,
          })
          .catch(function () {});
      } catch (e) {}
    }

    function isAddToCartElement(el) {
      if (!el) return false;
      var form = el.form || (el.closest && el.closest("form"));
      var action = form && form.action ? form.action : "";
      if (action.indexOf("/cart/add") !== -1) return true;
      var name = (el.getAttribute("name") || "").toLowerCase();
      var type = (el.getAttribute("type") || "").toLowerCase();
      var label = (
        el.textContent ||
        el.value ||
        el.getAttribute("aria-label") ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      return (
        name === "add" ||
        (type === "submit" && /add to cart|add/.test(label)) ||
        /add to cart/.test(label)
      );
    }

    function isCheckoutElement(el) {
      if (!el) return false;
      var href = el.href || (el.getAttribute && el.getAttribute("href")) || "";
      var form = el.form || (el.closest && el.closest("form"));
      var action = form && form.action ? form.action : "";
      var name = (el.getAttribute("name") || "").toLowerCase();
      var label = (
        el.textContent ||
        el.value ||
        el.getAttribute("aria-label") ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      return (
        href.indexOf("/checkout") !== -1 ||
        action.indexOf("/checkout") !== -1 ||
        name === "checkout" ||
        /check out|checkout|buy it now/.test(label)
      );
    }

    function resumeCheckout(el) {
      if (!el) return;
      el.setAttribute("data-mw-checkout-resumed", "1");
      var href = el.href || (el.getAttribute && el.getAttribute("href"));
      if (href) {
        window.location.href = href;
        return;
      }
      var form = el.form || (el.closest && el.closest("form"));
      if (form) {
        if (typeof form.requestSubmit === "function") {
          try {
            form.requestSubmit(el);
            return;
          } catch (e) {}
        }
        form.submit();
        return;
      }
      el.click();
    }

    function markAddedToCart() {
      state.addedToCart = true;
      state.addedToCartAt = Date.now();
      state.exitType = "checkout";
      writeSessionToCart(true);
      setTimeout(function () {
        writeSessionToCart(true, true);
      }, 800);
      sendCommerceEvent("add_to_cart");
      sendTrackingData();
    }

    document.addEventListener(
      "click",
      function (e) {
        var clickedEl =
          e.target && e.target.closest
            ? e.target.closest(
                'a, button, [type="submit"], input[type="submit"]',
              )
            : null;
        if (!clickedEl) return;

        if (isAddToCartElement(clickedEl)) {
          markAddedToCart();
          return;
        }

        if (isCheckoutElement(clickedEl)) {
          state.exitType = "checkout";
          if (clickedEl.getAttribute("data-mw-checkout-resumed") === "1") {
            clickedEl.removeAttribute("data-mw-checkout-resumed");
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          sendTrackingData();
          Promise.race([
            writeSessionToCart(true),
            new Promise(function (resolve) {
              setTimeout(resolve, 900);
            }),
          ]).then(function () {
            resumeCheckout(clickedEl);
          });
        }
      },
      true,
    );

    // Add to cart detection - listen for form submissions and button clicks
    document.addEventListener("submit", function (e) {
      var form = e.target;
      if (form.action && form.action.includes("/cart/add")) {
        markAddedToCart();
      } else if (form.action && form.action.includes("/checkout")) {
        state.exitType = "checkout";
        writeSessionToCart(true);
        sendTrackingData();
      }
    });

    // Also listen for AJAX add-to-cart (common in modern themes)
    window.fetch = function () {
      var url = arguments[0];
      if (typeof url === "string" && url.includes("/cart/add")) {
        state.addedToCart = true;
        state.addedToCartAt = Date.now();
        state.exitType = "checkout";
        sendCommerceEvent("add_to_cart");
        // Write session to cart after the add-to-cart completes
        var result = originalFetch.apply(this, arguments);
        result
          .then(function () {
            writeSessionToCart(true, true);
          })
          .catch(function () {});
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
    history.pushState = function () {
      origPushState.apply(this, arguments);
      onUrlChange();
    };
    history.replaceState = function () {
      origReplaceState.apply(this, arguments);
      onUrlChange();
    };

    // Back/forward button detection
    window.addEventListener("popstate", function () {
      onUrlChange();
      state.exitType = "back_button";
      sendTrackingData();
    });

    // Page visibility change — pause/resume active time tracking
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        state.isPageVisible = false;
        // Tick one last time before going hidden
        tickActiveTime();
        // If no exit type set, it's likely window closed or tab switched
        if (!state.exitType) {
          state.exitType = "window_closed";
        }
        sendTrackingData();
      } else {
        state.isPageVisible = true;
        state.lastTickTime = Date.now();
      }
    });

    // Before unload - window/tab closing
    window.addEventListener("beforeunload", function () {
      tickActiveTime(); // Final tick
      if (!state.exitType) {
        state.exitType = "window_closed";
      }
      sendTrackingData();
      stopTracking();
    });

    // Idle detection - check every 30 seconds
    state.idleIntervalId = setInterval(function () {
      var idleTime = Date.now() - state.lastActivityTime;
      if (idleTime >= state.idleTimeout && state.exitType !== "idle") {
        tickActiveTime(); // Final tick
        state.exitType = "idle";
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
      shop: state.shop,
      productHandle: state.productHandle,
      resourceType: state.resourceType,
      pagePath: state.pagePath,
      pageUrl: state.pageUrl,
      pageTitle: state.pageTitle,
      pageOrder: state.pageOrder,
      isLandingPage: state.pageOrder === 1,

      // Traffic source
      source: state.trafficSource.source,
      medium: state.trafficSource.medium,
      campaign: state.trafficSource.campaign,
      referrer: state.trafficSource.referrer,
      sourceCategory: state.trafficSource.sourceCategory,
      acquisition: acquisitionPayload(),

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
      ctaClicks:
        state.ctaClicks.length > 0 ? JSON.stringify(state.ctaClicks) : null,

      // A/B test assignment
      abTestId: state.abTestId,
      abVariantId: state.abVariantId,
      abVariantKey: state.abVariantKey,

      // Timestamps
      startedAt: state.startTime,
      endedAt: Date.now(),
    };
  }

  // Send tracking data to API
  function sendTrackingData() {
    if (!CONFIG.apiEndpoint) return;

    // Don't revive an expired journey when an already-idle tab finally unloads.
    // A new page will open a fresh acquisition after the inactivity window.
    if (
      Date.now() - state.acquisition.lastActivityAt <
      CONFIG.acquisitionTimeout
    ) {
      state.acquisition.lastActivityAt = Math.max(
        Date.now(),
        state.acquisition.startedAt,
      );
      persistAcquisition(state.acquisition);
    }
    var payload = buildPayload();

    // Use sendBeacon for reliability when page is unloading
    // Note: sendBeacon with string sends as text/plain (CORS-safe, no preflight)
    // Server-side handles text/plain parsing via fallback
    if (navigator.sendBeacon) {
      navigator.sendBeacon(CONFIG.apiEndpoint, JSON.stringify(payload));
    } else {
      // Fallback to fetch
      fetch(CONFIG.apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(function () {});
    }
  }

  // Customer journeys have a small, acknowledged event queue. They do not
  // depend on a Page/Store/Channel Snapshot being active, or stop at the legacy
  // page tracker's two-minute idle threshold.
  var journeyQueue = [];
  var journeySequence = 0;
  var journeySending = false;
  var journeyTruncated = false;
  var journeyLastActivity = Date.now();
  var journeyLastSend = 0;
  var journeyActiveTime = 0;
  var journeyLastTick = Date.now();
  var journeyHasPage = false;
  var journeyFlushScheduled = false;

  function journeyAllowed() {
    var privacy = window.Shopify && window.Shopify.customerPrivacy;
    try {
      return !!(privacy && privacy.analyticsProcessingAllowed());
    } catch (e) {
      return false;
    }
  }

  function journeySafePath(value) {
    try {
      var url = new URL(value, window.location.origin);
      if (!/^https?:$/.test(url.protocol)) return null;
      if (/\/(account|accounts|checkouts|orders)(\/|$)/i.test(url.pathname))
        return "/private-page";
      return url.pathname.slice(0, 600);
    } catch (e) {
      return null;
    }
  }

  function queueJourneyEvent(type, label, target) {
    if (
      !journeyAllowed() ||
      Date.now() - journeyLastActivity >= CONFIG.acquisitionTimeout
    )
      return;
    if (!journeyHasPage) {
      journeyHasPage = true;
      journeyQueue.push({
        id: state.pageViewId + ":0",
        type: "page_view",
        at: Date.now(),
        path: journeySafePath(window.location.href),
      });
    }
    if (type !== "page_view") {
      if (journeyQueue.length >= 200) {
        journeyTruncated = true;
        return;
      }
      var safeLabel = String(label || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
      if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(safeLabel)) safeLabel = "";
      journeyQueue.push({
        id: state.pageViewId + ":" + ++journeySequence,
        type: type,
        at: Date.now(),
        path: journeySafePath(window.location.href),
        label: safeLabel,
        target: target ? journeySafePath(target) : null,
      });
    }
    if (!journeyFlushScheduled) {
      journeyFlushScheduled = true;
      setTimeout(function () {
        journeyFlushScheduled = false;
        flushJourney(false);
      }, 1000);
    }
  }

  function flushJourney(unloading) {
    if (!journeyAllowed()) {
      journeyQueue = [];
      journeyHasPage = false;
      return;
    }
    if (
      !journeyHasPage ||
      Date.now() - journeyLastActivity >= CONFIG.acquisitionTimeout
    )
      return;
    if (!unloading && journeySending) return;
    if (
      !unloading &&
      !journeyQueue.length &&
      Date.now() - journeyLastSend < 30000
    )
      return;
    // Renew only this tab's original acquisition; never steal another tab's ad.
    state.acquisition.lastActivityAt = journeyLastActivity;
    persistAcquisition(state.acquisition);
    var events = journeyQueue.slice(0, 50);
    var payload = {
      eventType: "journey_batch",
      consent: true,
      shop: state.shop,
      sessionId: state.sessionId,
      acquisition: acquisitionPayload(),
      pageViewId: state.pageViewId,
      pagePath: journeySafePath(window.location.href),
      startedAt: state.startTime,
      timeOnPage: journeyActiveTime,
      scrollDepth: state.maxScrollDepth,
      hasMouseMoved: state.hasMouseMoved,
      hasScrolled: state.hasScrolled,
      hasTouched: state.hasTouched,
      hasKeyPressed: state.hasKeyPressed,
      isWebdriver: state.isWebdriver,
      suspiciousUA: state.suspiciousUA,
      linearMovement: isLinearMovement(state.mouseMovements),
      events: events,
      truncated: journeyTruncated,
    };
    if (unloading && navigator.sendBeacon) {
      navigator.sendBeacon(CONFIG.apiEndpoint, JSON.stringify(payload));
      return;
    }
    journeySending = true;
    journeyLastSend = Date.now();
    journeyFetch(CONFIG.apiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
      keepalive: true,
    })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (result) {
        if (result && result.accepted) {
          var ids = events.map(function (event) {
            return event.id;
          });
          journeyQueue = journeyQueue.filter(function (event) {
            return ids.indexOf(event.id) === -1;
          });
        }
      })
      .catch(function () {})
      .finally(function () {
        journeySending = false;
      });
  }

  function initCustomerJourney() {
    setInterval(function () {
      var now = Date.now();
      if (
        journeyAllowed() &&
        !document.hidden &&
        now - journeyLastActivity < state.idleTimeout
      ) {
        journeyActiveTime += Math.max(0, Math.min(5000, now - journeyLastTick));
      }
      journeyLastTick = now;
    }, 1000);
    function begin() {
      if (journeyAllowed()) queueJourneyEvent("page_view");
    }
    if (
      window.Shopify &&
      window.Shopify.loadFeatures &&
      !window.Shopify.customerPrivacy
    ) {
      window.Shopify.loadFeatures(
        [{ name: "consent-tracking-api", version: "0.1" }],
        begin,
      );
    }
    document.addEventListener("visitorConsentCollected", function () {
      if (!journeyAllowed()) {
        journeyQueue = [];
        journeyHasPage = false;
      } else begin();
    });
    ["pointerdown", "keydown", "scroll", "touchstart"].forEach(function (name) {
      document.addEventListener(
        name,
        function () {
          // A session that has expired is not silently joined to its old ad.
          if (Date.now() - journeyLastActivity < CONFIG.acquisitionTimeout)
            journeyLastActivity = Date.now();
        },
        { passive: true },
      );
    });
    document.addEventListener(
      "click",
      function (event) {
        var el =
          event.target &&
          event.target.closest &&
          event.target.closest(
            'a, button, img, [role="button"], input[type="submit"]',
          );
        if (
          !el ||
          el.closest(
            '[data-private], [data-sensitive], [contenteditable="true"]',
          ) ||
          journeySafePath(window.location.href) === "/private-page"
        )
          return;
        if (Date.now() - journeyLastActivity >= CONFIG.acquisitionTimeout)
          return;
        journeyLastActivity = Date.now();
        queueJourneyEvent(
          "click",
          el.tagName === "IMG"
            ? el.getAttribute("alt") || "Image"
            : el.getAttribute("aria-label") || el.textContent || "Button",
          el.href,
        );
      },
      true,
    );
    document.addEventListener(
      "submit",
      function (event) {
        var form = event.target;
        if (form && form.action && /\/search(?:\?|$)/.test(form.action))
          queueJourneyEvent("search", "Store search");
      },
      true,
    );
    document.addEventListener(
      "change",
      function (event) {
        var name = event.target && event.target.name;
        if (
          typeof name === "string" &&
          (/^filter\./.test(name) || name === "sort_by")
        )
          queueJourneyEvent(
            "filter_change",
            name === "sort_by"
              ? "Changed sort order"
              : "Changed product filter",
          );
      },
      true,
    );
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        queueJourneyEvent("page_hidden", "Page hidden");
        flushJourney(true);
      }
    });
    window.addEventListener("pagehide", function () {
      flushJourney(true);
    });
    setInterval(function () {
      if (journeyQueue.length) flushJourney(false);
    }, 5000);
    setInterval(function () {
      flushJourney(false);
    }, 30000);
    begin();
  }

  // Initialize
  function init() {
    if (!state.productHandle && !state.pagePath) return;

    setCookie(CONFIG.richTrackerCookieName, String(Date.now()), 1);
    requestAbAssignment();
    setupEventListeners();
    initCustomerJourney();

    // Tick active time every second for accurate measurement
    state.timeTickIntervalId = setInterval(tickActiveTime, 1000);

    // Send initial ping after 1 second
    setTimeout(function () {
      state.hasSentInitial = true;
      sendTrackingData();
    }, 1000);

    // Send periodic updates (stops automatically on idle/exit)
    state.sendIntervalId = setInterval(function () {
      if (!state.isStopped) {
        sendTrackingData();
      }
    }, CONFIG.sendInterval);
  }

  // Start tracking when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
