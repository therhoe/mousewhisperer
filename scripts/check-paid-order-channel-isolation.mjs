// Isolated orders/paid action checks. No Shopify, network, or database access.
// Run: node --test scripts/check-paid-order-channel-isolation.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const SHOP = "webhook-release-test.myshopify.com";
const SID = "legacy-test-session";
const ACQUISITION_ID = "acq_release_test_journey";
const CREATED_AT = "2026-08-26T12:00:00.000Z";
const source = readFileSync(
  new URL("../app/routes/webhooks.orders.paid.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;

function fixture(options = {}) {
  const calls = [];
  const warnings = [];
  const errors = [];
  const writes = [];
  const order = {
    id: 10101,
    order_number: 123,
    created_at: CREATED_AT,
    total_price: "48.50",
    currency: "USD",
    note_attributes: [
      { name: "_mw_sid", value: SID },
      { name: "_mw_csid", value: ACQUISITION_ID },
    ],
    line_items: [{ product_id: 101, quantity: 1 }],
    ...options.order,
  };
  const record = (stage, args) => {
    calls.push({ stage, args: structuredClone(args) });
    if (options.failStage === stage) throw options.legacyError;
  };
  const prisma = {
    project: {
      findFirst: async (args) => {
        record("page-project", args);
        assert.equal(args.where.shop, SHOP);
        if (options.noProject) return null;
        return {
          id: "project-a",
          productId: "gid://shopify/Product/101",
          snapshots: [{ id: "snapshot-a" }],
        };
      },
      update: async () => {
        assert.fail(
          "The matching page must not require a product identity rewrite",
        );
      },
    },
    visit: {
      findFirst: async (args) => {
        record("page-select", args);
        assert.equal(args.where.snapshotId, "snapshot-a");
        assert.equal(
          args.where.converted,
          false,
          "Existing Page selection semantics must remain unchanged",
        );
        if (options.noVisit) return null;
        return { id: "visit-a", snapshotId: "snapshot-a", converted: false };
      },
      update: async (args) => {
        record("page-write", args);
        writes.push(structuredClone(args));
        return { id: args.where.id, ...args.data };
      },
    },
    snapshotStatsCache: {
      deleteMany: async (args) => {
        record("page-cache", args);
        return { count: 1 };
      },
    },
  };
  const imports = {
    "../utils/customer-journey.server": {
      recordCustomerCommerce: async () => {
        if (options.customerError) throw options.customerError;
        return 0;
      },
    },
    "../shopify.server": {
      authenticate: {
        webhook: async () => {
          record("auth", {});
          if (options.authError) throw options.authError;
          return {
            payload: order,
            shop: SHOP,
            topic: "ORDERS_PAID",
            admin: null,
          };
        },
      },
    },
    "../db.server": prisma,
    "../utils/channel-snapshot.server": {
      attributeChannelSnapshotEvent: async (args) => {
        record("channel", args);
        if (Object.hasOwn(options, "channelError")) throw options.channelError;
        return options.channelCount ?? 1;
      },
    },
    "../utils/store-snapshot.server": {
      attributeStoreSnapshotOrder: async (args) => {
        record("store", args);
        return 1;
      },
    },
    "../utils/ab-tests.server": {
      attributeAbTestConversion: async (args) => {
        record("ab", args);
        return 1;
      },
    },
  };
  const module = { exports: {} };
  runInNewContext(
    compiled,
    {
      module,
      exports: module.exports,
      require: (name) => {
        assert.ok(Object.hasOwn(imports, name), `Unexpected import ${name}`);
        return imports[name];
      },
      Date,
      Response,
      Error,
      console: {
        log() {},
        warn: (...args) => warnings.push(args),
        error: (...args) => errors.push(args),
      },
    },
    { filename: "webhooks.orders.paid.tsx" },
  );
  const run = () =>
    module.exports.action({
      request: new Request("https://app.test/webhooks/orders/paid", {
        method: "POST",
      }),
    });
  return { run, calls, warnings, errors, writes, order };
}

const stages = (f) => f.calls.map((call) => call.stage);
const call = (f, stage) => f.calls.find((entry) => entry.stage === stage)?.args;

test("Customer journey failure preserves legacy attribution without replaying its writers at every success exit", async () => {
  for (const lineItems of [undefined, [], [{ title: "Custom item" }]]) {
    const failure = new Error("Customer journey store unavailable");
    const f = fixture({
      customerError: failure,
      ...(lineItems ? { order: { line_items: lineItems } } : {}),
    });
    assert.equal((await f.run()).status, 200);
    assert.ok(stages(f).includes("store"));
    assert.ok(stages(f).includes("ab"));
    if (!lineItems) assert.equal(f.writes.length, 1);
    assert.equal(
      f.warnings[0][0],
      "[MW Webhook] Customer journey attribution failed",
    );
    assert.doesNotMatch(JSON.stringify(f.warnings), /unavailable/);
  }
});

test("Channel-only failure still runs Store, A/B and matching Page attribution, then succeeds", async () => {
  const failure = new Error(
    "sensitive database detail and private order payload",
  );
  failure.name = "PrismaClientKnownRequestError";
  const f = fixture({ channelError: failure });
  const response = await f.run();
  assert.equal(response.status, 200);
  assert.deepEqual(stages(f), [
    "auth",
    "channel",
    "store",
    "ab",
    "page-project",
    "page-select",
    "page-write",
    "page-cache",
  ]);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].where.id, "visit-a");
  assert.deepEqual(f.writes[0].data, {
    converted: true,
    convertedAt: new Date(CREATED_AT),
    orderValue: 48.5,
    currency: "USD",
  });
  for (const stage of ["store", "ab"]) {
    assert.deepEqual(call(f, stage), {
      shop: SHOP,
      sessionId: SID,
      timestamp: new Date(CREATED_AT),
      totalPrice: 48.5,
      currency: "USD",
    });
  }
  assert.equal(f.warnings.length, 1);
  assert.equal(
    f.warnings[0][0],
    "[MW Webhook] Channel conversion attribution failed",
  );
  assert.deepEqual(structuredClone(f.warnings[0][1]), {
    error: "PrismaClientKnownRequestError",
  });
  assert.doesNotMatch(
    JSON.stringify(f.warnings),
    /sensitive|private|legacy-test-session|acq_release|stack|webhook-release-test/,
  );
  assert.equal(f.errors.length, 0);
});

test("non-Error Channel failures produce only an UnknownError warning", async () => {
  const f = fixture({
    channelError: { message: "private payload", token: "private-token" },
  });
  assert.equal((await f.run()).status, 200);
  assert.deepEqual(structuredClone(f.warnings[0]), [
    "[MW Webhook] Channel conversion attribution failed",
    { error: "UnknownError" },
  ]);
  assert.equal(f.writes.length, 1);
});

test("no-line-items success exit remains safe after a Channel failure", async () => {
  const f = fixture({
    channelError: new Error("channel unavailable"),
    order: { line_items: [] },
  });
  assert.equal((await f.run()).status, 200);
  assert.deepEqual(stages(f), ["auth", "channel", "store", "ab"]);
  assert.equal(f.writes.length, 0);
});

test("no-product-ID success exit remains safe after a Channel failure", async () => {
  const f = fixture({
    channelError: new Error("channel unavailable"),
    order: { line_items: [{ title: "Custom item" }] },
  });
  assert.equal((await f.run()).status, 200);
  assert.deepEqual(stages(f), ["auth", "channel", "store", "ab"]);
  assert.equal(f.writes.length, 0);
});

test("successful Channel attribution keeps verified shop, exact acquisition and order timestamp", async () => {
  const f = fixture();
  assert.equal((await f.run()).status, 200);
  assert.deepEqual(call(f, "channel"), {
    shop: SHOP,
    sessionId: SID,
    acquisitionSessionId: ACQUISITION_ID,
    timestamp: new Date(CREATED_AT),
    event: "conversion",
  });
  assert.equal(f.warnings.length, 0);
  assert.equal(f.errors.length, 0);
  assert.equal(f.writes.length, 1);
});

test("legacy SID-only and custom attribute contracts are unchanged", async () => {
  for (const attributes of [
    { note_attributes: [{ name: "_mw_sid", value: SID }] },
    {
      note_attributes: [],
      custom_attributes: [
        { key: "_mw_sid", value: SID },
        { key: "_mw_csid", value: ACQUISITION_ID },
      ],
    },
  ]) {
    const f = fixture({ order: attributes });
    assert.equal((await f.run()).status, 200);
    assert.equal(call(f, "channel").sessionId, SID);
    assert.equal(
      call(f, "channel").acquisitionSessionId,
      attributes.custom_attributes ? ACQUISITION_ID : null,
    );
    assert.equal(call(f, "store").sessionId, SID);
    assert.equal(call(f, "ab").sessionId, SID);
    assert.equal(f.writes.length, 1);
  }
});

test("orders without a legacy SID retain the existing Page-only ATC fallback", async () => {
  const f = fixture({ order: { note_attributes: [], custom_attributes: [] } });
  assert.equal((await f.run()).status, 200);
  assert.deepEqual(stages(f), [
    "auth",
    "page-project",
    "page-select",
    "page-write",
    "page-cache",
  ]);
  assert.equal(call(f, "page-select").where.addedToCart, true);
  assert.equal(call(f, "page-select").where.sessionId, undefined);
  assert.equal(f.warnings.length, 0);
});

test("a valid Channel callback with no matching captured journey does not block legacy writes", async () => {
  const f = fixture({ channelCount: 0 });
  assert.equal((await f.run()).status, 200);
  assert.equal(f.writes.length, 1);
  assert.equal(f.warnings.length, 0);
});

test("unmatched Page project or visit still acknowledges successful legacy processing", async () => {
  for (const missing of [{ noProject: true }, { noVisit: true }]) {
    const f = fixture({
      ...missing,
      channelError: new Error("channel unavailable"),
    });
    assert.equal((await f.run()).status, 200);
    assert.ok(stages(f).includes("store"));
    assert.ok(stages(f).includes("ab"));
    assert.equal(f.writes.length, 0);
  }
});

test("Store, A/B and Page failures still reject even when Channel also failed", async () => {
  for (const failStage of ["store", "ab", "page-project", "page-write"]) {
    const legacyError = new Error(`existing ${failStage} failure`);
    const f = fixture({
      channelError: new Error("channel unavailable"),
      failStage,
      legacyError,
    });
    await assert.rejects(f.run(), (error) => error === legacyError);
    assert.equal(f.warnings.length, 1);
    assert.equal(f.errors.length, 1);
    assert.equal(f.errors[0][1], legacyError);
    assert.equal(stages(f).at(-1), failStage);
  }
});

test("authentication Responses still return 401 before any attribution", async () => {
  const f = fixture({
    authError: new Response("verification failed", { status: 403 }),
  });
  const response = await f.run();
  assert.equal(response.status, 401);
  assert.equal(await response.text(), "Unauthorized");
  assert.deepEqual(stages(f), ["auth"]);
  assert.equal(f.warnings.length, 0);
  assert.equal(f.errors.length, 0);
});

test("non-Response authentication failures retain the existing rejection behavior", async () => {
  const authError = new Error("authentication service unavailable");
  const f = fixture({ authError });
  await assert.rejects(f.run(), (error) => error === authError);
  assert.deepEqual(stages(f), ["auth"]);
  assert.equal(f.warnings.length, 0);
  assert.equal(f.errors[0][1], authError);
});
