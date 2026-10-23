import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url);
const source = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path) {
  const module = { exports: {} };
  runInNewContext(
    ts.transpileModule(source(path), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (specifier) => {
        if (!specifier.startsWith(".")) return require(specifier);
        const base = new URL(specifier, new URL(`../${path}`, import.meta.url));
        const basePath = fileURLToPath(base);
        const target = [basePath, `${basePath}.ts`, `${basePath}.tsx`].find(
          existsSync,
        );
        if (!target) throw new Error(`Cannot resolve ${specifier} in ${path}`);
        return load(
          target.slice(fileURLToPath(new URL("../", import.meta.url)).length),
        );
      },
      URL,
    },
  );
  return module.exports;
}
const { buildEngagementOutcomes } = load("app/utils/click-engagement.ts");
const { EngagementOutcomesView } = load(
  "app/components/EngagementOutcomes.tsx",
);
const clicks = (label, count = 1, extra = {}) =>
  JSON.stringify(
    Array.from({ length: count }, () => ({ label, tag: "button", ...extra })),
  );
const row = (id, label, extra = {}) => ({
  sessionId: id,
  ctaClicks: label ? clicks(label) : null,
  addedToCart: false,
  converted: false,
  ...extra,
});
const item = (data, category = "Button") =>
  data.groups.find((g) => g.category === category).items[0];

test("repeat clicks and page views deduplicate sessions and outcomes", () => {
  const data = buildEngagementOutcomes([
    row("a", "Play video", {
      ctaClicks: clicks("Play video", 3),
      addedToCart: true,
    }),
    row("a", "Play video", { converted: true }),
    row("b", "Play video"),
  ]);
  assert.equal(item(data).clicks, 5);
  assert.equal(item(data).sessions, 2);
  assert.equal(item(data).carts, 1);
  assert.equal(item(data).purchases, 1);
  assert.equal(data.maxSessions, 2);
});
test("commerce on a different page joins only the matching tracked session", () => {
  const data = buildEngagementOutcomes([
    row("a", "Size guide"),
    row("b", "Size guide"),
    row("a", null, { converted: true }),
    row("unrelated", null, { converted: true }),
  ]);
  assert.equal(item(data).sessions, 2);
  assert.equal(item(data).purchases, 1);
});
test("Add to cart button click is not a successful cart addition", () => {
  const data = buildEngagementOutcomes([row("a", "Add to cart")]);
  assert.equal(item(data).carts, 0);
  assert.equal(item(data).purchases, 0);
});
test("purchase without recorded add to cart is valid; bars are not a mandatory funnel", () => {
  const data = buildEngagementOutcomes([
    row("a", "Buy now", { converted: true }),
  ]);
  assert.equal(item(data).carts, 0);
  assert.equal(item(data).purchases, 1);
});
test("separate variant commerce cannot leak across identical session IDs", () => {
  const a = buildEngagementOutcomes(
    [row("shared", "Play video")],
    [row("shared", null, { converted: true })],
  );
  const b = buildEngagementOutcomes(
    [row("shared", "Play video")],
    [row("shared", null)],
  );
  assert.equal(item(a).purchases, 1);
  assert.equal(item(b).purchases, 0);
});
test("missing IDs or assignment data show unavailable, never fabricated zeros", () => {
  const missingId = buildEngagementOutcomes([row(null, "Video")]);
  assert.equal(item(missingId).sessions, null);
  assert.equal(item(missingId).purchases, null);
  const noAssignment = buildEngagementOutcomes([row("a", "Video")], []);
  assert.equal(item(noAssignment).sessions, 1);
  assert.equal(item(noAssignment).purchases, null);
});
test("old object click payloads retain clicks while counting one session", () => {
  const data = buildEngagementOutcomes([
    row("a", null, {
      ctaClicks: JSON.stringify({ Video: 12, bad: -1 }),
      converted: true,
    }),
  ]);
  assert.equal(item(data).clicks, 12);
  assert.equal(item(data).sessions, 1);
  assert.equal(item(data).purchases, 1);
});
test("malformed payloads are safely ignored or normalized", () => {
  assert.equal(
    buildEngagementOutcomes([row("a", null, { ctaClicks: "broken" })]).groups
      .length,
    0,
  );
  const data = buildEngagementOutcomes([
    row("a", null, {
      ctaClicks: '[null,3,{"label":"Video","zone":{},"tag":null,"href":1}]',
    }),
  ]);
  assert.equal(item(data).sessions, 1);
});
test("image variants merge by canonical file, retaining outcomes", () => {
  const data = buildEngagementOutcomes([
    row("a", null, {
      ctaClicks: clicks("Photo", 1, {
        tag: "img",
        href: "https://cdn.example/shoe_400x.jpg?width=400",
      }),
    }),
    row("a", null, {
      ctaClicks: clicks("Photo", 1, {
        tag: "img",
        href: "https://cdn.example/shoe_800x.jpg?width=800",
      }),
      converted: true,
    }),
  ]);
  assert.equal(data.groups[0].items.length, 1);
  assert.equal(item(data, "Image").clicks, 2);
  assert.equal(item(data, "Image").purchases, 1);
});
test("identical labels with different destinations are not merged", () => {
  const data = buildEngagementOutcomes([
    row("a", null, {
      ctaClicks: clicks("Guide", 1, { tag: "a", href: "/pages/one" }),
    }),
    row("a", null, {
      ctaClicks: clicks("Guide", 1, { tag: "a", href: "/pages/two" }),
    }),
  ]);
  assert.equal(data.groups[0].items.length, 2);
});
test("one shared maximum covers categories, images, header and footer", () => {
  const data = buildEngagementOutcomes([
    row("a", "Play video"),
    ...Array.from({ length: 10 }, (_, i) =>
      row(String(i), null, {
        ctaClicks: clicks("Home", 1, { zone: "header" }),
      }),
    ),
  ]);
  assert.equal(data.maxSessions, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(data)).maxSessions, 10);
});
test("rendered outcome percentages use clicked sessions, not raw clicks or carts", () => {
  const data = buildEngagementOutcomes(
    Array.from({ length: 24 }, (_, i) =>
      row(String(i), "Play video", {
        ctaClicks: clicks("Play video", i < 8 ? 2 : 1),
        addedToCart: i < 8,
        converted: i < 3,
      }),
    ),
  );
  const html = renderToStaticMarkup(
    React.createElement(EngagementOutcomesView, {
      data,
      totals: { Button: 32 },
    }),
  );
  assert.match(html, /8 \(33\.3%\)/);
  assert.match(html, /3 \(12\.5%\)/);
  assert.match(html, /not proof of sequence or causation/);
  assert.match(html, /width:33\.33333333333333%/);
});
test("groups paginate five elements and retain accessible controls", () => {
  const data = buildEngagementOutcomes(
    Array.from({ length: 8 }, (_, i) => row(String(i), `Button ${i}`)),
  );
  const html = renderToStaticMarkup(
    React.createElement(EngagementOutcomesView, {
      data,
      totals: { Button: 8 },
    }),
  );
  assert.match(html, /aria-label="Button elements"/);
  assert.match(html, /Page 1 of 2/);
  assert.doesNotMatch(html, /<strong>Button 7/);
});
test("both Page query paths carry identities/outcomes and invalidate pre-feature caches", () => {
  const page = source("app/routes/app.project.$id.tsx");
  assert.match(page, /value\.engagementOutcomes\?\.version !== 1/);
  assert.match(
    page,
    /engagementOutcomes: buildEngagementOutcomes\(\s*interactionRows\.filter/,
  );
  assert.match(
    page,
    /engagementOutcomes: buildEngagementOutcomes\(\s*ctaClickRows\.filter/,
  );
  const fast = page.slice(
    page.indexOf("async function getSnapshotStatsFast"),
    page.indexOf("async function getSnapshotTrendsFast"),
  );
  assert.match(
    fast,
    /sessionId: true,\s*visitorType: true,\s*addedToCart: true,\s*converted: true/,
  );
  const slow = page.slice(page.indexOf("// CTA clicks — fetch raw JSON"));
  assert.match(
    slow,
    /\.\.\.whereClause,[\s\S]*?addedToCart: true[\s\S]*?converted: true/,
  );
  const ab = source("app/utils/ab-tests.server.ts");
  assert.match(
    ab,
    /engagementOutcomes: buildEngagementOutcomes\(\s*clickRows,\s*assignmentHumans\s*\)/,
  );
});
