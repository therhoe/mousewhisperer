// Database/network-free transport regression for Project companion admission.
// Executes the actual api.track action and unchanged theme tracker queue code.
// Run: node --test scripts/check-project-journey-transport.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext, runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = (file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const shop = "journey-transport.myshopify.com";

function trackingAction(recordCustomerJourney) {
  const module = { exports: {} };
  const imports = {
    "@remix-run/node": { json: (body, init) => Response.json(body, init) },
    "../db.server": {},
    "../utils/channel-report": {},
    "../utils/growth-tracking.server": {},
    "../utils/customer-journey.server": {
      recordCustomerJourney,
      recordCustomerCommerce: () => assert.fail("Journey batches are not commerce events"),
    },
    "../utils/geo.server": { getClientIP: () => "203.0.113.10" },
    "../utils/datacenter-ips.server": {
      isDatacenterIP: () => ({ isDatacenter: false }),
    },
    "../utils/notifications.server": {},
    "../utils/ab-tests.server": {},
    "../utils/store-snapshot.server": {},
    "../utils/channel-snapshot.server": {},
  };
  runInNewContext(
    ts.transpileModule(source("app/routes/api.track.tsx"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    {
      module, exports: module.exports, URL, Request, Response, Date,
      console: { error() {}, warn() {}, log() {} },
      require: (name) => {
        assert.ok(name in imports, `Unexpected route dependency: ${name}`);
        return imports[name];
      },
    },
  );
  return module.exports.action;
}

const tracker = source("extensions/tracking-embed/assets/tracker.js");
const queueStart = tracker.indexOf("  var journeyQueue = [];");
const queueEnd = tracker.indexOf("  // Initialize", queueStart);
assert.ok(queueStart >= 0 && queueEnd > queueStart);
// Use the asset's complete queue, flush, consent and retry-timer implementation,
// not a reimplementation of its acknowledgement behavior.
const journeyCode = tracker.slice(queueStart, queueEnd);

async function until(predicate) {
  for (let tries = 0; tries < 100; tries++) {
    if (predicate()) return;
    await new Promise(setImmediate);
  }
  assert.fail("Mock transport did not settle");
}

function harness() {
  let now = Date.parse("2026-10-22T18:00:00Z");
  let consent = true;
  let writer = async () => ({ accepted: false, captured: false });
  let transport;
  const requests = [];
  const responses = [];
  const records = [];
  const intervals = [];
  const timeouts = [];
  const beacons = [];
  const action = trackingAction(async (...args) => {
    records.push(args);
    return writer(...args);
  });
  const context = createContext({
    Date: class extends Date { static now() { return now; } },
    URL,
    window: {
      location: { href: "https://store.test/products/shoe?utm_source=facebook", origin: "https://store.test" },
      Shopify: { customerPrivacy: { analyticsProcessingAllowed: () => consent } },
      addEventListener() {},
    },
    document: { hidden: false, addEventListener() {} },
    navigator: { sendBeacon: (url, body) => { beacons.push({ url, body: JSON.parse(body) }); return true; } },
    CONFIG: { apiEndpoint: "/apps/api", acquisitionTimeout: 30 * 60 * 1000 },
    state: {
      shop, sessionId: "browser-qa", pageViewId: "page-qa", startTime: now,
      acquisition: { id: "acq_transport_qa", source: "facebook", startedAt: now, lastActivityAt: now },
      maxScrollDepth: 45, hasMouseMoved: true, hasScrolled: true,
      hasTouched: false, hasKeyPressed: false, isWebdriver: false,
      suspiciousUA: false, mouseMovements: [], idleTimeout: 120_000,
    },
    persistAcquisition() {},
    acquisitionPayload: () => ({ id: "acq_transport_qa", source: "facebook", startedAt: now }),
    isLinearMovement: () => false,
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    journeyFetch: async (url, options) => {
      requests.push({ url, ...options, body: JSON.parse(options.body) });
      const response = transport
        ? await transport()
        : await action({ request: new Request(`https://app.test/api/track?shop=${shop}`, {
          method: options.method, headers: options.headers, body: options.body,
        }) });
      responses.push({ status: response.status, body: await response.clone().json() });
      return response;
    },
  });
  runInContext(`${journeyCode}\ninitCustomerJourney(); journeyActiveTime = 10000;`, context);
  return {
    context, requests, responses, records, beacons,
    setWriter: (fn) => { writer = fn; },
    setTransport: (fn) => { transport = fn; },
    setConsent: (value) => { consent = value; },
    queueIds: () => Array.from(context.journeyQueue, (event) => event.id),
    click: () => runInContext('queueJourneyEvent("click", "Add to cart", "/cart");', context),
    flush: (unloading = false) => context.flushJourney(unloading),
    settle: () => until(() => !context.journeySending),
    firstFlush: () => {
      const timer = timeouts.find((item) => item.ms === 1000);
      assert.ok(timer, "Initial page must schedule its actual one-second flush");
      now += 1000;
      timer.fn();
    },
    retry: () => {
      const timer = intervals.find((item) => item.ms === 5000);
      assert.ok(timer, "Published tracker must schedule its actual five-second queued retry");
      now += 5000;
      timer.fn();
    },
  };
}

test("api.track preserves the writer's negative acknowledgement instead of swallowing it", async () => {
  const expected = { accepted: false, captured: false };
  const action = trackingAction(async (resolvedShop, data, classification) => {
    assert.equal(resolvedShop, shop, "Proxy-authored shop takes precedence");
    assert.equal(data.enrollmentOnly, false);
    assert.equal(classification, "REAL");
    return expected;
  });
  const response = await action({ request: new Request(`https://app.test/api/track?shop=${shop}`, {
    method: "POST", headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ eventType: "journey_batch", shop: "ignored.myshopify.com", consent: true, timeOnPage: 10000, hasMouseMoved: true, hasScrolled: true }),
  }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(await response.json(), expected);
});

test("parent-admission retry round-trips through the real route and retains queued events until acknowledged", async () => {
  const h = harness();
  h.click();
  const originalIds = h.queueIds();
  assert.equal(originalIds.length, 2);
  h.firstFlush();
  await h.settle();
  assert.deepEqual(h.responses[0], { status: 200, body: { accepted: false, captured: false } });
  assert.deepEqual(h.queueIds(), originalIds);
  assert.equal(h.context.journeySending, false, "A rejected batch must not leave the in-flight lock stuck");
  assert.equal(h.requests[0].url, "/apps/api");
  assert.equal(h.requests[0].headers["Content-Type"], "text/plain");
  assert.equal(h.requests[0].body.eventType, "journey_batch");
  assert.equal(h.records[0][1].enrollmentOnly, false);

  let release;
  h.setWriter(() => new Promise((resolve) => { release = resolve; }));
  h.retry();
  await until(() => Boolean(release));
  assert.deepEqual(h.requests[1].body.events.map((event) => event.id), originalIds);
  h.click(); // A new click arrives while the retried batch is awaiting its ACK.
  const newlyQueued = h.queueIds().at(-1);
  assert.ok(!originalIds.includes(newlyQueued));
  h.flush();
  assert.equal(h.requests.length, 2, "Normal flushes cannot duplicate an in-flight batch");
  release({ accepted: true, captured: true });
  await h.settle();
  assert.deepEqual(h.queueIds(), [newlyQueued], "Only events in the acknowledged request may be removed");

  h.setWriter(async () => ({ accepted: true, captured: true }));
  h.retry();
  await h.settle();
  assert.deepEqual(h.requests[2].body.events.map((event) => event.id), [newlyQueued]);
  assert.deepEqual(h.queueIds(), []);
  h.retry();
  assert.equal(h.requests.length, 3, "Empty queues do not run the five-second retry");
});

test("missing acknowledgements and HTTP/network failures keep the queue retryable", async () => {
  for (const response of [
    () => Response.json({ accepted: false, captured: false }),
    () => Response.json({}),
    () => Response.json({ accepted: true }, { status: 503 }),
    () => { throw new Error("Offline"); },
  ]) {
    const h = harness();
    h.setTransport(response);
    const ids = h.queueIds();
    h.firstFlush();
    await h.settle();
    assert.deepEqual(h.queueIds(), ids);
    h.setTransport(() => Response.json({ accepted: true, captured: true }));
    h.retry();
    await h.settle();
    assert.equal(h.requests.length, 2);
    assert.deepEqual(h.requests[1].body.events.map((event) => event.id), ids);
    assert.deepEqual(h.queueIds(), []);
  }
});

test("sendBeacon transport acceptance is not mistaken for a server acknowledgement", () => {
  const h = harness();
  const ids = h.queueIds();
  h.flush(true);
  assert.equal(h.beacons.length, 1);
  assert.deepEqual(h.beacons[0].body.events.map((event) => event.id), ids);
  assert.deepEqual(h.queueIds(), ids);
  assert.equal(h.requests.length, 0);
});

test("consent withdrawal intentionally discards the queue and prevents further transport", () => {
  const h = harness();
  h.setConsent(false);
  h.flush();
  assert.deepEqual(h.queueIds(), []);
  assert.equal(h.context.journeyHasPage, false);
  h.retry();
  h.flush(true);
  assert.equal(h.requests.length, 0);
  assert.equal(h.beacons.length, 0);
});
