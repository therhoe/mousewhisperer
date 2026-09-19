// Exercise the actual API action orchestration with isolated writer stubs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../app/routes/api.track.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "api.track.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const selected = ast.statements
  .filter(
    (node) =>
      (ts.isFunctionDeclaration(node) &&
        ["normalizeShopDomain", "getRequestShop"].includes(node.name?.text)) ||
      (ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(
          (decl) => decl.name.getText(ast) === "action",
        )),
  )
  .map((node) => node.getText(ast))
  .join("\n");
const compiled = ts.transpileModule(selected, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

function fixture(failCustomer = false) {
  const module = { exports: {} };
  const calls = [];
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    URL,
    Error,
    console: { warn() {}, error() {} },
    json: (body, options) => new Response(JSON.stringify(body), options),
    recordCustomerCommerce: async (input) => {
      calls.push({ writer: "customer", input });
      if (failCustomer) throw new Error("Database unavailable");
    },
    handlePixelEvent: async () => {
      calls.push({ writer: "legacy" });
      return new Response('{"ok":true}');
    },
    handleEngagementTrack: () =>
      assert.fail("Must not route commerce to page engagement"),
  });
  return {
    calls,
    run: (data) =>
      module.exports.action({
        request: new Request(
          "https://app.test/api/track?shop=test.myshopify.com",
          {
            method: "POST",
            body: JSON.stringify({
              sessionId: "browser-1",
              acquisitionSessionId: "arrival-1",
              fromPixel: true,
              ...data,
            }),
          },
        ),
      }),
  };
}

test("successful commerce invokes each writer once", async () => {
  const f = fixture();
  const response = await f.run({ eventType: "conversion" });
  assert.equal(response.status, 200);
  assert.deepEqual(
    f.calls.map((call) => call.writer),
    ["customer", "legacy"],
  );
  assert.equal(response.headers.get("X-Customer-Journey-Retry"), null);
});

test("new writer failure preserves legacy success and exposes an isolated retry signal", async () => {
  const f = fixture(true);
  const response = await f.run({ eventType: "conversion" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Customer-Journey-Retry"), "1");
  assert.equal(
    response.headers.get("Access-Control-Expose-Headers"),
    "X-Customer-Journey-Retry",
  );
  assert.deepEqual(
    f.calls.map((call) => call.writer),
    ["customer", "legacy"],
  );
});

test("isolated retries never replay legacy writers, including after another failure", async () => {
  for (const failure of [false, true]) {
    const f = fixture(failure);
    const response = await f.run({
      eventType: "customer_commerce",
      commerceType: "conversion",
      orderId: "123",
    });
    assert.equal(response.status, failure ? 503 : 200);
    assert.deepEqual(
      f.calls.map((call) => call.writer),
      ["customer"],
    );
    assert.equal(f.calls[0].input.eventType, "conversion");
    assert.equal(f.calls[0].input.orderId, "123");
    assert.equal(f.calls[0].input.shop, "test.myshopify.com");
  }
});
