// Database-free Project / A/B ownership, targeting and cohort regression tests.
// Run: node --test scripts/check-project-ab-tests.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const compile = (file, mocks = {}) => {
  const mod = { exports: {} };
  runInNewContext(
    ts.transpileModule(source(file), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    {
      module: mod,
      exports: mod.exports,
      require: (id) => (id in mocks ? mocks[id] : require(id)),
      URL,
      URLSearchParams,
      Date,
      console,
      process,
    },
  );
  return mod.exports;
};
const targeting = compile("app/utils/ab-project-targeting.ts");
const trend = compile("app/utils/ab-test-report.ts");
const clicks = compile("app/utils/click-engagement.ts");
const service = (db) =>
  compile("app/utils/ab-tests.server.ts", {
    "../db.server": { __esModule: true, default: db },
    "./ab-project-targeting": targeting,
    "./ab-test-report": trend,
    "./click-engagement": clicks,
  });
const filters = (audience = "all") => ({
  audience,
  source: "",
  medium: "",
  campaign: "",
});
const pageProject = {
  id: "project-1",
  shop: "owner.myshopify.com",
  scope: "PAGE",
  resourceProject: {
    shop: "owner.myshopify.com",
    resourceType: "PRODUCT",
    productHandle: "shoes",
  },
};

test("page targets are canonical, typed and exact", () => {
  assert.equal(
    targeting.abTargetPathForResource(pageProject.resourceProject),
    "/products/shoes",
  );
  assert.equal(
    targeting.normalizeAbTargetPath(
      "https://store.test/products/shoes/?utm_source=facebook",
    ),
    "/products/shoes",
  );
  assert.equal(
    // eslint-disable-next-line no-script-url
    targeting.normalizeAbTargetPath("javascript:alert(1)"),
    null,
  );
  assert.equal(
    targeting.abTargetPathMatchesType("/pages/about", "PRODUCT"),
    false,
  );
  assert.equal(targeting.abTargetPathMatchesType("/", "HOMEPAGE"), true);
});

test("Project defaults only initialize reports and explicit empty source clears them", () => {
  const defaults = {
    defaultSource: "facebook",
    defaultMedium: "paid",
    defaultCampaign: "launch",
  };
  const initial = targeting.parseAbReportFilters(
    new URLSearchParams(),
    defaults,
  );
  assert.equal(initial.source, "facebook");
  assert.equal(initial.audience, "all");
  const cleared = targeting.parseAbReportFilters(
    new URLSearchParams("audience=active&source=&medium=&campaign="),
    defaults,
  );
  assert.equal(cleared.source, "");
  assert.equal(cleared.medium, "");
  assert.equal(cleared.audience, "active");
  assert.equal(
    targeting.abReportFilterQuery(cleared),
    "audience=active&source=&medium=&campaign=",
  );
});

test("missing and cross-tenant projects cannot create tests", async () => {
  let ownershipWhere;
  const api = service({
    growthProject: {
      findFirst: async ({ where }) => {
        ownershipWhere = where;
        return null;
      },
    },
  });
  await assert.rejects(
    api.requireAbGrowthProject("owner.myshopify.com", "foreign"),
    /Choose a project/,
  );
  assert.equal(ownershipWhere.shop, "owner.myshopify.com");
  assert.equal(ownershipWhere.id, "foreign");
  await assert.rejects(
    api.requireAbGrowthProject("owner.myshopify.com", ""),
    /Choose a project/,
  );
});

test("new tests bind owned project and refuse page scope escape", async () => {
  let written;
  const api = service({
    growthProject: { findFirst: async () => pageProject },
    abTest: {
      create: async ({ data }) => {
        written = data;
        return { id: "test-1" };
      },
    },
  });
  const input = {
    shop: pageProject.shop,
    growthProjectId: pageProject.id,
    targetPageType: "PRODUCT",
    targetPagePath: "/products/shoes",
    name: "Product test",
    goal: "CONVERSION",
    trafficSplit: 50,
    controlTemplateName: "Default",
    variantTemplateName: "New",
  };
  await api.createTemplateAbTest(input);
  assert.equal(written.growthProjectId, "project-1");
  assert.equal(written.targetPagePath, "/products/shoes");
  await assert.rejects(
    api.createTemplateAbTest({ ...input, targetPagePath: "/products/other" }),
    /exact storefront page/,
  );
  await assert.rejects(
    api.createTemplateAbTest({
      ...input,
      targetPageType: "PAGE",
      targetPagePath: "/pages/about",
    }),
    /page type must match/,
  );
});

test("enrollment refuses other pages before assignment and never reads reporting source", async () => {
  const api = service({
    abTest: {
      findFirst: async () => ({
        targetPagePath: "/products/shoes",
        variants: [{ key: "A" }, { key: "B" }],
      }),
    },
  });
  const result = await api.assignTemplateAbVariant({
    shop: pageProject.shop,
    sessionId: "session",
    resourceType: "PRODUCT",
    pagePath: "/products/other",
  });
  assert.equal(result.assigned, false);
  assert.equal(result.reason, "page_mismatch");
  const enrollment = source("app/utils/ab-tests.server.ts")
    .split("export async function assignTemplateAbVariant")[1]
    .split("export async function")[0];
  assert.doesNotMatch(
    enrollment,
    /defaultSource|defaultMedium|defaultCampaign|abAssignmentFilterWhere/,
  );
});

test("eligible page enrollment selects a page-scoped live test without channel restrictions", async () => {
  let liveWhere;
  let assignment;
  const api = service({
    abTest: {
      findFirst: async ({ where }) => {
        liveWhere = where;
        return {
          id: "test",
          targetPagePath: "/products/shoes",
          trafficSplit: 50,
          variants: [
            { id: "a", key: "A", isControl: true, templateSuffix: null },
            { id: "b", key: "B", templateSuffix: "variant" },
          ],
        };
      },
    },
    abTestAssignment: {
      findUnique: async () => null,
      create: async ({ data }) => {
        assignment = data;
        return { id: "assignment" };
      },
    },
  });
  const result = await api.assignTemplateAbVariant({
    shop: pageProject.shop,
    sessionId: "session",
    resourceType: "PRODUCT",
    pagePath: "/products/shoes/",
  });
  assert.equal(result.assigned, true);
  assert.equal(liveWhere.OR[1].targetPagePath, "/products/shoes");
  assert.equal(assignment.shop, pageProject.shop);
  assert.equal(assignment.testId, "test");
  for (const path of [
    "app/routes/app.ab-tests._index.tsx",
    "app/routes/app.ab-tests.$id.tsx",
  ]) {
    assert.match(
      source(path),
      /test\.targetPagePath\s*\?\s*\{\s*OR:\s*\[\s*\{ targetPagePath: null \},\s*\{ targetPagePath: test\.targetPagePath \},?\s*\],?\s*\}\s*:\s*\{\}/,
    );
  }
});

test("engagement keeps first acquisition attribution and cannot mutate another shop's assignment", async () => {
  const existing = {
    id: "assignment",
    shop: pageProject.shop,
    variantId: "a",
    source: "facebook",
    medium: "paid",
    campaign: "launch",
    sourceCategory: "Paid social",
    referrer: "https://facebook.com",
    timeOnPage: 90,
    scrollDepth: 70,
  };
  let saved;
  const api = service({
    abTestAssignment: {
      findUnique: async () => existing,
      update: async ({ data }) => {
        saved = data;
        return {};
      },
    },
  });
  const payload = {
    shop: pageProject.shop,
    testId: "test",
    sessionId: "session",
    variantId: "a",
    visitorType: "REAL",
    source: "Internal",
    medium: "internal",
    campaign: "other",
    sourceCategory: "Internal",
    timeOnPage: 10,
  };
  await api.recordAbTestEngagement(payload);
  assert.equal(saved.source, "facebook");
  assert.equal(saved.medium, "paid");
  assert.equal(saved.campaign, "launch");
  saved = null;
  assert.equal(
    await api.recordAbTestEngagement({
      ...payload,
      shop: "another.myshopify.com",
    }),
    false,
  );
  assert.equal(saved, null);
});

const rows = [
  {
    sessionId: "real",
    visitorType: "REAL",
    source: "facebook",
    addedToCart: true,
    converted: true,
    orderValue: 40,
    assignedAt: new Date("2026-10-01"),
    convertedAt: new Date("2026-10-02"),
    updatedAt: new Date("2026-10-02"),
    timeOnPage: 90,
    scrollDepth: 80,
  },
  {
    sessionId: "zombie",
    visitorType: "ZOMBIE",
    source: "google",
    addedToCart: false,
    converted: false,
    assignedAt: new Date("2026-10-01"),
    updatedAt: new Date("2026-10-02"),
    timeOnPage: 1,
    scrollDepth: 0,
  },
  {
    sessionId: "bot",
    visitorType: "BOT",
    source: "google",
    addedToCart: true,
    converted: true,
    orderValue: 10,
    assignedAt: new Date("2026-10-01"),
    convertedAt: new Date("2026-10-02"),
    updatedAt: new Date("2026-10-02"),
    timeOnPage: 5,
    scrollDepth: 10,
  },
];
test("All and Active use identical cohorts for summary, commerce and cumulative trend", async () => {
  const api = service({
    abTestVariant: {
      findMany: async ({ select }) => [
        {
          id: "variant",
          key: "A",
          assignments: select.assignments.where.visitorType
            ? rows.filter((row) => row.visitorType === "REAL")
            : rows,
        },
      ],
    },
  });
  const [all] = await api.getAbTestStats("test", "CONVERSION", filters());
  const [active] = await api.getAbTestStats(
    "test",
    "CONVERSION",
    filters("active"),
  );
  assert.equal(all.visitors, 3);
  assert.equal(all.conversions, 2);
  assert.ok(Math.abs(all.conversionRate - 200 / 3) < 0.000001);
  assert.equal(all.realVisitors, 1);
  assert.equal(all.trend.at(-1).visitors, 3);
  assert.equal(all.trend.at(-1).conversions, 2);
  assert.equal(active.visitors, 1);
  assert.equal(active.conversionRate, 100);
  assert.equal(active.trend.at(-1).visitors, 1);
  assert.equal(active.trend.at(-1).conversions, 1);
});

test("variant report uses selected assignment cohort and exact tested page", async () => {
  let visitWhere;
  const api = service({
    abTestVariant: { findFirst: async () => ({ id: "variant", key: "A" }) },
    abTestAssignment: {
      findMany: async ({ where }) => {
        assert.equal(where.shop, pageProject.shop);
        assert.equal(where.medium.equals, "paid");
        return [rows[0]];
      },
    },
    abTestVisit: {
      findMany: async ({ where }) => {
        visitWhere = where;
        return [];
      },
    },
  });
  const result = await api.getAbVariantSnapshotStats({
    shop: pageProject.shop,
    testId: "test",
    variantId: "variant",
    targetPageType: "PRODUCT",
    targetPagePath: "/products/shoes",
    filters: { ...filters("active"), medium: "paid" },
  });
  assert.equal(visitWhere.pagePath, "/products/shoes");
  assert.deepEqual(Array.from(visitWhere.sessionId.in), ["real"]);
  assert.equal(result.visitors, 1);
  assert.equal(result.conversionRate, 100);
});

test("quick-create selects project before theme writes and filter cache isolation is retained", () => {
  const index = source("app/routes/app.ab-tests._index.tsx");
  const action = index
    .split("export const action")[1]
    .split("export default function")[0];
  assert.ok(
    action.indexOf("requireAbGrowthProject") <
      action.indexOf("await createThemeTemplateVariant"),
  );
  assert.match(index, /searchParams\.get\("create"\) === "1"/);
  assert.match(index, /\/app\/projects\?create=1&next=ab-test/);
  assert.match(index, /formData.append\("growthProjectId", growthProjectId\)/);
  const report = source("app/routes/app.ab-tests.$id.report.tsx");
  assert.match(
    report,
    /ab-test-variant-report:\$\{shop\}:\$\{test.id\}:\$\{variantId\}:\$\{filterQuery\}/,
  );
  const component = source("app/components/AbTestDetailReport.tsx");
  assert.match(component, /snapshotFetcher.data.filterQuery === filterQuery/);
});

test("the A/B modal project handoff closes the overlay and uses embedded router navigation", () => {
  const index = source("app/routes/app.ab-tests._index.tsx");
  const file = ts.createSourceFile(
    "app.ab-tests._index.tsx",
    index,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let handler;
  let createButton;
  const visit = (node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "createProjectForTest"
    ) {
      handler = node;
    }
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(file) === "Button" &&
      node.children.some((child) =>
        child.getText(file).includes('t("Create a new project")'),
      )
    ) {
      createButton = node.openingElement;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(handler, "project handoff handler exists");
  assert.ok(createButton, "project handoff button exists");
  const attributes = createButton.attributes.properties;
  assert.ok(
    attributes.some(
      (attribute) =>
        ts.isJsxAttribute(attribute) &&
        attribute.name.text === "onClick" &&
        attribute.initializer?.getText(file) === "{createProjectForTest}",
    ),
  );
  assert.ok(
    !attributes.some(
      (attribute) =>
        ts.isJsxAttribute(attribute) &&
        ["url", "href", "target"].includes(attribute.name.text),
    ),
    "modal handoff must not render a navigable anchor in another document",
  );
  assert.match(index, /const navigate = useNavigate\(\)/);
  const calls = [];
  runInNewContext(`${handler.getText(file)}; createProjectForTest();`, {
    closeCreateWizard: () => calls.push(["close"]),
    navigate: (path) => calls.push(["navigate", path]),
    window: new Proxy({}, {
      get: () => assert.fail("handoff must not use window navigation"),
    }),
  });
  assert.deepEqual(calls, [
    ["close"],
    ["navigate", "/app/projects?create=1&next=ab-test"],
  ]);
});
