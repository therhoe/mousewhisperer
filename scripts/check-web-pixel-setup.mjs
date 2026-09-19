import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("../app/utils/web-pixel.server.ts", import.meta.url),
  "utf8",
);
const SHOP = "pixel-test.myshopify.com";
const PIXEL_ID = "gid://shopify/WebPixel/123";
const APP_URL = "https://app.example.test";
const endpoint = (shop = SHOP, appUrl = APP_URL) =>
  `${appUrl}/api/track?shop=${shop}`;

function loadSetup() {
  const clock = { now: Date.UTC(2026, 7, 26, 12) };
  const env = { SHOPIFY_APP_URL: APP_URL };
  const module = { exports: {} };
  const code = ts.transpileModule(source, {
    fileName: "web-pixel.server.ts",
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock.now]));
    }
    static now() {
      return clock.now;
    }
  }
  vm.runInNewContext(
    code,
    {
      exports: module.exports,
      module,
      URL,
      Date: FixedDate,
      process: { env },
    },
    { filename: "web-pixel.server.ts" },
  );
  return { ...module.exports, clock, env };
}

function response(data, { errors, status = 200 } = {}) {
  return new Response(JSON.stringify({ data, ...(errors ? { errors } : {}) }), {
    status,
  });
}

function pixel(apiEndpoint, extra = {}) {
  return { id: PIXEL_ID, settings: JSON.stringify({ ...extra, apiEndpoint }) };
}

function mutationResponse(operation, apiEndpoint, options = {}) {
  return response({
    [operation]: {
      userErrors: [],
      webPixel: pixel(apiEndpoint),
      ...options,
    },
  });
}

// Each step is a fake GraphQL response (or callback). No real Admin client,
// credential, DB, or network is used by this regression suite.
function adminFixture(steps) {
  const calls = [];
  return {
    calls,
    admin: {
      graphql: async (query, options) => {
        const call = { query, variables: structuredClone(options?.variables) };
        calls.push(call);
        const step = steps.shift();
        assert.notEqual(step, undefined, "Unexpected extra GraphQL call");
        if (step instanceof Error) throw step;
        return typeof step === "function" ? step(call) : step;
      },
    },
  };
}

test("new pixel setup queries this app's record then creates a verified tenant-qualified endpoint", async () => {
  const setup = loadSetup();
  const f = adminFixture([
    response({ webPixel: null }),
    (call) => {
      assert.match(call.query, /webPixelCreate\(webPixel: \$webPixel\)/);
      assert.deepEqual(JSON.parse(call.variables.webPixel.settings), {
        apiEndpoint: endpoint(),
      });
      return mutationResponse("webPixelCreate", endpoint());
    },
  ]);
  const result = await setup.ensureWebPixel(
    f.admin,
    " Pixel-Test.MyShopify.com ",
  );
  assert.equal(result.ready, true);
  assert.equal(result.pixelId, PIXEL_ID);
  assert.equal(result.changed, true);
  assert.match(f.calls[0].query, /webPixel\s*\{\s*id\s+settings\s*\}/);
  assert.equal(f.calls[0].variables, undefined);
  assert.equal((await setup.ensureWebPixel(f.admin, SHOP)).changed, false);
  assert.equal(f.calls.length, 2, "Only verified success can be cached");
});

test("existing legacy endpoint is updated in place while unrelated settings are preserved", async () => {
  const setup = loadSetup();
  const f = adminFixture([
    response({
      webPixel: pixel(`${APP_URL}/api/track`, { extensionSetting: "keep" }),
    }),
    (call) => {
      assert.match(
        call.query,
        /webPixelUpdate\(id: \$id, webPixel: \$webPixel\)/,
      );
      assert.equal(call.variables.id, PIXEL_ID);
      assert.deepEqual(JSON.parse(call.variables.webPixel.settings), {
        extensionSetting: "keep",
        apiEndpoint: endpoint(),
      });
      return mutationResponse("webPixelUpdate", endpoint());
    },
  ]);
  const result = await setup.ensureWebPixel(f.admin, SHOP);
  assert.equal(result.ready, true);
  assert.equal(result.changed, true);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every((call) => !call.query.includes("webPixelCreate(")));
});

test("already-correct settings in string or object form require no mutation", async () => {
  for (const settings of [
    JSON.stringify({ apiEndpoint: endpoint() }),
    { apiEndpoint: endpoint() },
  ]) {
    const setup = loadSetup();
    const f = adminFixture([
      response({ webPixel: { id: PIXEL_ID, settings } }),
    ]);
    const result = await setup.ensureWebPixel(f.admin, SHOP);
    assert.equal(result.ready, true);
    assert.equal(result.changed, false);
    assert.equal(f.calls.length, 1);
    assert.equal((await setup.ensureWebPixel(f.admin, SHOP)).ready, true);
    assert.equal(f.calls.length, 1);
  }
});

test("HTTP failures, GraphQL errors, invalid JSON, and thrown client failures never trigger blind creation or poison cache", async () => {
  const failures = [
    response(null, { status: 403 }),
    response({ webPixel: null }, { errors: [{ message: "Access denied" }] }),
    new Response("not-json", { status: 200 }),
    new Error("Network unavailable"),
    response({}),
    response({ webPixel: { settings: {} } }),
  ];
  for (const failure of failures) {
    const setup = loadSetup();
    const f = adminFixture([
      failure,
      response({ webPixel: null }),
      mutationResponse("webPixelCreate", endpoint()),
    ]);
    const first = await setup.ensureWebPixel(f.admin, SHOP);
    assert.equal(first.ready, false);
    assert.equal(first.reason, "setup_failed");
    assert.equal(f.calls.length, 1);
    assert.equal((await setup.ensureWebPixel(f.admin, SHOP)).ready, true);
    assert.equal(f.calls.length, 3);
  }
});

test("mutation userErrors are failures even when a pixel object is returned and a retry can succeed", async () => {
  const setup = loadSetup();
  const f = adminFixture([
    response({ webPixel: null }),
    mutationResponse("webPixelCreate", endpoint(), {
      userErrors: [{ code: "INVALID_SETTINGS", message: "Invalid settings" }],
    }),
    response({ webPixel: null }),
    mutationResponse("webPixelCreate", endpoint()),
  ]);
  assert.equal((await setup.ensureWebPixel(f.admin, SHOP)).ready, false);
  assert.equal((await setup.ensureWebPixel(f.admin, SHOP)).ready, true);
  assert.equal(f.calls.length, 4);
});

test("missing mutation payload, unverified settings, and missing IDs are not treated as successful setup", async () => {
  const failures = [
    response({}),
    response({ webPixelCreate: { webPixel: pixel(endpoint()) } }),
    response({ webPixelCreate: { userErrors: [], webPixel: null } }),
    response({
      webPixelCreate: { userErrors: [], webPixel: { id: "", settings: {} } },
    }),
    mutationResponse("webPixelCreate", `${APP_URL}/api/track`),
    response({
      webPixelCreate: {
        userErrors: [],
        webPixel: { id: PIXEL_ID, settings: "invalid-json" },
      },
    }),
    response(
      { webPixelCreate: { userErrors: [], webPixel: pixel(endpoint()) } },
      { errors: [{ message: "API error" }] },
    ),
    response({}, { status: 500 }),
  ];
  for (const failure of failures) {
    const setup = loadSetup();
    const f = adminFixture([
      response({ webPixel: null }),
      failure,
      response({ webPixel: null }),
      mutationResponse("webPixelCreate", endpoint()),
    ]);
    assert.equal((await setup.ensureWebPixel(f.admin, SHOP)).ready, false);
    assert.equal((await setup.ensureWebPixel(f.admin, SHOP)).ready, true);
    assert.equal(f.calls.length, 4);
  }
});

test("failed updates remain retryable instead of silently keeping the old endpoint", async () => {
  const setup = loadSetup();
  const existing = pixel(`${APP_URL}/api/track`);
  const f = adminFixture([
    response({ webPixel: existing }),
    mutationResponse("webPixelUpdate", endpoint(), {
      userErrors: [{ code: "NO_EXTENSION" }],
      webPixel: null,
    }),
    response({ webPixel: existing }),
    mutationResponse("webPixelUpdate", endpoint()),
  ]);
  assert.equal((await setup.ensureWebPixel(f.admin, SHOP)).ready, false);
  const result = await setup.ensureWebPixel(f.admin, SHOP);
  assert.equal(result.ready, true);
  assert.equal(result.changed, true);
  assert.equal(f.calls.length, 4);
});

test("a cross-worker creation race re-queries and updates the winning pixel", async () => {
  const setup = loadSetup();
  const f = adminFixture([
    response({ webPixel: null }),
    response({
      webPixelCreate: { userErrors: [{ code: "TAKEN" }], webPixel: null },
    }),
    response({ webPixel: pixel(`${APP_URL}/api/track`) }),
    mutationResponse("webPixelUpdate", endpoint()),
  ]);
  const result = await setup.ensureWebPixel(f.admin, SHOP);
  assert.equal(result.ready, true);
  assert.equal(result.changed, true);
  assert.equal(f.calls.length, 4);
});

test("a creation-race error without a verifiable existing pixel remains a failure", async () => {
  const setup = loadSetup();
  const f = adminFixture([
    response({ webPixel: null }),
    response({
      webPixelCreate: { userErrors: [{ code: "TAKEN" }], webPixel: null },
    }),
    response({ webPixel: null }),
    response({ webPixel: pixel(endpoint()) }),
  ]);
  assert.equal((await setup.ensureWebPixel(f.admin, SHOP)).ready, false);
  assert.equal((await setup.ensureWebPixel(f.admin, SHOP)).ready, true);
  assert.equal(f.calls.length, 4);
});

test("concurrent setup calls for the same shop and endpoint share one setup request", async () => {
  const setup = loadSetup();
  let resolveLookup;
  const lookup = new Promise((resolve) => {
    resolveLookup = resolve;
  });
  const f = adminFixture([
    () => lookup,
    mutationResponse("webPixelCreate", endpoint()),
  ]);
  const first = setup.ensureWebPixel(f.admin, SHOP);
  const second = setup.ensureWebPixel(f.admin, SHOP);
  assert.equal(f.calls.length, 1);
  resolveLookup(response({ webPixel: null }));
  const results = await Promise.all([first, second]);
  assert.ok(results.every((result) => result.ready));
  assert.equal(f.calls.length, 2);
});

test("cache is per tenant, per endpoint and expires so deleted/reconfigured pixels are checked again", async () => {
  const setup = loadSetup();
  const f = adminFixture([
    response({ webPixel: pixel(endpoint()) }),
    response({ webPixel: pixel(endpoint()) }),
    response({ webPixel: pixel(endpoint()) }),
    mutationResponse(
      "webPixelUpdate",
      endpoint(SHOP, "https://new-app.example.test"),
    ),
  ]);
  await setup.ensureWebPixel(f.admin, SHOP);
  setup.clock.now += 5 * 60 * 1000;
  await setup.ensureWebPixel(f.admin, SHOP);
  assert.equal(f.calls.length, 2, "Expired success must be re-verified");
  setup.env.SHOPIFY_APP_URL = "https://new-app.example.test";
  const moved = await setup.ensureWebPixel(f.admin, SHOP);
  assert.equal(moved.ready, true);
  assert.equal(moved.changed, true);
  assert.equal(f.calls.length, 4);
  const other = "other-pixel-test.myshopify.com";
  const otherAdmin = adminFixture([
    response({ webPixel: pixel(endpoint(other, setup.env.SHOPIFY_APP_URL)) }),
  ]);
  await setup.ensureWebPixel(otherAdmin.admin, other);
  assert.equal(
    otherAdmin.calls.length,
    1,
    "Another shop must not share cached readiness",
  );
});

test("invalid shop and invalid endpoint configuration fail nonfatally without API calls", async () => {
  const setup = loadSetup();
  const f = adminFixture([]);
  for (const shop of [
    "",
    null,
    "not-a-shop",
    "other.myshopify.com?shop=victim",
    "example.com",
  ]) {
    const result = await setup.ensureWebPixel(f.admin, shop);
    assert.equal(result.ready, false);
    assert.equal(result.reason, "invalid_shop");
  }
  for (const appUrl of [
    "not-a-url",
    "file:///tmp/app",
    "ftp://app.example.test",
    "https://user:password@app.example.test",
  ]) {
    setup.env.SHOPIFY_APP_URL = appUrl;
    const result = await setup.ensureWebPixel(f.admin, SHOP);
    assert.equal(result.ready, false);
    assert.equal(result.reason, "invalid_endpoint");
  }
  assert.equal(f.calls.length, 0);
});

test("app URL path/query/trailing slash cannot leak into the configured tracking endpoint", async () => {
  const setup = loadSetup();
  setup.env.SHOPIFY_APP_URL = `${APP_URL}/some/path/?unexpected=value#fragment`;
  const f = adminFixture([
    response({ webPixel: null }),
    (call) => {
      assert.equal(
        JSON.parse(call.variables.webPixel.settings).apiEndpoint,
        endpoint(),
      );
      return mutationResponse("webPixelCreate", endpoint());
    },
  ]);
  assert.equal((await setup.ensureWebPixel(f.admin, SHOP)).ready, true);
});
