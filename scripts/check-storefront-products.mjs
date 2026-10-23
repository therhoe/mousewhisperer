// Read-only API mocks: new Projects/tests reject unpublished products without
// changing legacy snapshot setup or requiring additional Shopify scopes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
function evaluate(code, globals = {}, mocks = {}) {
  const module = { exports: {} };
  runInNewContext(ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, Response, Date, URL, FormData, Error,
    require: (key) => {
      assert.ok(key in mocks, `Unexpected dependency: ${key}`);
      return mocks[key];
    },
    ...globals,
  });
  return module.exports;
}
const pure = evaluate(source("app/utils/growth-projects.ts"));
const products = evaluate(source("app/utils/storefront-product.server.ts"), {}, {
  "./growth-projects": pure,
});
const published = { __typename: "Product", id: "gid://shopify/Product/123", title: "Product", handle: "product", status: "ACTIVE", publishedAt: "2025-01-01T00:00:00Z", onlineStoreUrl: null };
const adminFor = (product) => ({ graphql: async () => Response.json({ data: { productByIdentifier: product, node: product } }) });

test("Online Store publication guard rejects missing, draft, unpublished and future products", () => {
  for (const product of [null, { ...published, status: "DRAFT" }, { ...published, status: "ARCHIVED" }, { ...published, publishedAt: null }, { ...published, publishedAt: "invalid" }, { ...published, publishedAt: "2999-01-01T00:00:00Z" }]) {
    assert.throws(() => products.assertPublishedOnlineStoreProduct(product), /published to the Online Store/);
  }
  assert.doesNotThrow(() => products.assertPublishedOnlineStoreProduct(published), "A password-protected store with a null URL still has a valid published product");
});

test("exact test target is checked through read_products fields and never a mutation", async () => {
  await products.requirePublishedProductTarget({ graphql: async (query, options) => {
    assert.match(query, /query ProjectProductAvailability/);
    assert.match(query, /productByIdentifier\(identifier: \{ handle: \$handle \}\)/);
    assert.match(query, /status publishedAt/);
    assert.doesNotMatch(query, /mutation|resourcePublications|onlineStoreUrl/);
    assert.equal(options.variables.handle, "product");
    return Response.json({ data: { productByIdentifier: published } });
  } }, "/products/product");
  await assert.rejects(products.requirePublishedProductTarget(adminFor(null), "/products/missing"), /published to the Online Store/);
  for (const path of ["/", "/products/", "/products/product/extra", "/pages/product"]) {
    await assert.rejects(products.requirePublishedProductTarget({ graphql: () => assert.fail("Invalid paths must not query Shopify") }, path), /published to the Online Store/);
  }
});

test("Shopify errors fail closed with a retryable error, not an unavailable-product claim", async () => {
  for (const admin of [
    { graphql: async () => Response.json({ errors: [{ message: "No access" }] }) },
    { graphql: async () => { throw new Error("Network error"); } },
    { graphql: async () => new Response("Not JSON", { status: 502 }) },
  ]) {
    await assert.rejects(products.requirePublishedProductTarget(admin, "/products/product"), (error) => error.status === 503 && /could not verify/.test(error.message));
  }
});

test("Project page resolution opts into publication checks while legacy setup is preserved", async () => {
  const setup = evaluate(source("app/utils/snapshot-setup.server.ts"), {}, {
    "node:crypto": {}, "@prisma/client": {}, "../db.server": {}, "./billing.server": {}, "./web-pixel.server": {}, "./snapshot-setup": {}, "./loader-cache.server": {},
    "./storefront-product.server": products,
  });
  const hidden = adminFor({ ...published, publishedAt: null });
  const legacy = await setup.resolveSetupPage(hidden, "PRODUCT", published.id);
  assert.equal(legacy.handle, "product");
  await assert.rejects(setup.resolveSetupPage(hidden, "PRODUCT", published.id, { requirePublishedProduct: true }), /published to the Online Store/);
  const selected = await setup.resolveSetupPage(adminFor(published), "PRODUCT", published.id, { requirePublishedProduct: true });
  assert.equal(selected.id, published.id);
});

function declaration(file, name) {
  const text = source(file);
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  const visit = (node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(ast) === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(found, `${name} exists`);
  return ts.isVariableDeclaration(found) ? `export const ${found.getText(ast)};` : `${found.getText(ast)}; exports.${name} = ${name};`;
}

test("all three A/B creation actions validate existing Project targets before theme/test writes", async () => {
  const actionCode = declaration("app/routes/app.ab-tests._index.tsx", "action");
  const targeting = evaluate(source("app/utils/ab-project-targeting.ts"));
  let checks = 0;
  const { action } = evaluate(actionCode, {
    authenticate: { admin: async () => ({ session: { shop: "qa.myshopify.com" }, admin: adminFor({ ...published, publishedAt: null }) }) },
    requireAbGrowthProject: async () => ({ scope: "PAGE", resourceProject: { resourceType: "PRODUCT", productHandle: "product" } }),
    ...targeting,
    requirePublishedProductTarget: async (...args) => { checks++; return products.requirePublishedProductTarget(...args); },
    json: (body, init) => Response.json(body, init),
    createThemeTemplateVariant: () => assert.fail("No theme mutation allowed for unavailable product"),
    createTemplateAbTest: () => assert.fail("No test may be created for unavailable product"),
  });
  for (const kind of ["duplicate-template-variant", "snapshot-template-variant", "create-template-test"]) {
    const form = new FormData();
    Object.entries({ action: kind, growthProjectId: "owned-project", targetPageType: "PRODUCT", targetPagePath: "/products/product" }).forEach(([key, value]) => form.set(key, value));
    const response = await action({ request: { formData: async () => form } });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /published to the Online Store/);
  }
  assert.equal(checks, 3);
});

test("product picker restricts publication with a noneditable filter query", async () => {
  let options;
  const { pickResource } = evaluate(declaration("app/components/GrowthProjectForm.tsx", "pickResource"), {
    bridge: { resourcePicker: async (value) => { options = value; return []; } },
    pageType: "PRODUCT", setPage() {}, setPickerError: () => assert.fail("Picker should open"),
  });
  await pickResource();
  assert.equal(options.filter.query, "status:active AND published_status:published");
  assert.equal(options.filter.draft, false);
  assert.equal(options.filter.archived, false);
  assert.equal(options.filter.hidden, false);
  assert.equal(options.query, undefined, "Do not expose a removable default search filter");
});
