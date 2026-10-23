import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const cache = new Map();
function load(relative, overrides = {}) {
  const file = path.resolve(root, relative);
  if (!Object.keys(overrides).length && cache.has(file)) return cache.get(file);
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      require(name) {
        if (name in overrides) return overrides[name];
        if (!name.startsWith(".")) return require(name);
        const base = path.resolve(path.dirname(file), name);
        const target = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
        if (!target) throw new Error(`Cannot resolve ${name} in ${file}`);
        return load(target);
      },
      console,
      process,
      URL,
      Request,
      Response,
      Headers,
      FormData,
      Date,
      Intl,
      setTimeout,
      clearTimeout,
    },
    { filename: file },
  );
  if (!Object.keys(overrides).length) cache.set(file, module.exports);
  return module.exports;
}

const core = load("app/utils/i18n-core.ts");
const { catalog } = load("app/locales/catalog.ts");
for (const [input, expected] of Object.entries({
  en: "en",
  "EN-us": "en",
  "de-AT": "de",
  de_CH: "de",
  zh: "zh-CN",
  "zh-SG": "zh-CN",
  "zh-Hans-HK": "zh-CN",
  "zh-Hant-CN": "zh-TW",
  "zh-HK": "zh-TW",
  "zh-MO": "zh-TW",
  "zh-TW": "zh-TW",
}))
  assert.equal(core.normalizeLocale(input), expected);
for (const value of ["fr", "javascript:alert(1)", null, {}, "x".repeat(100)])
  assert.equal(core.normalizeLocale(value), null);
assert.equal(core.preferredLocale("fr;q=1,de-DE;q=0.8,en;q=0.5"), "de");
assert.equal(core.preferredLocale("de;q=0,zh-Hant;q=0.9"), "zh-TW");
assert.equal(core.preferredLocale(null), "en");
assert.equal(core.translate("de", "Project"), "Projekt");
assert.equal(core.translate("zh-CN", "Create project"), "创建项目");
assert.equal(core.translate("zh-TW", "Create project"), "建立專案");
assert.equal(
  core.translate("de", "Merchant authored unknown title"),
  "Merchant authored unknown title",
);
assert.equal(core.translate("de", "__proto__"), "__proto__");
assert.equal(core.translate("de", "constructor"), "constructor");
assert.equal(
  core.translate("de", "{count} clicks", { count: "$&" }),
  "$& Klicks",
);
assert.equal(core.translate("en", "{count} clicks", { count: 8 }), "8 clicks");
assert.notEqual(
  core.localeStorageKey("a.myshopify.com"),
  core.localeStorageKey("b.myshopify.com"),
);
assert.equal(
  core.localeStorageKey("A.myshopify.com"),
  core.localeStorageKey("a.myshopify.com"),
);
const placeholders = (text) =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(",");
for (const [source, translations] of Object.entries(catalog)) {
  assert.equal(
    translations.length,
    3,
    `Three translations required: ${source}`,
  );
  for (const [index, translated] of translations.entries()) {
    assert.ok(translated.trim(), `Empty translation ${index}: ${source}`);
    assert.equal(
      placeholders(translated),
      placeholders(source),
      `Placeholder mismatch ${index}: ${source}`,
    );
  }
}

function appFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? appFiles(file)
      : /\.tsx?$/.test(entry.name)
        ? [file]
        : [];
  });
}
const sourceKeys = new Set();
function collectLiteral(node) {
  if (!node) return;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    sourceKeys.add(node.text);
  else if (ts.isConditionalExpression(node)) {
    collectLiteral(node.whenTrue);
    collectLiteral(node.whenFalse);
  } else if (ts.isBinaryExpression(node)) {
    collectLiteral(node.left);
    collectLiteral(node.right);
  }
}
for (const file of appFiles(path.join(root, "app"))) {
  const ast = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "t"
    )
      collectLiteral(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
const missing = [...sourceKeys].filter((key) => !(key in catalog)).sort();
if (process.argv.includes("--list-missing")) {
  console.log(JSON.stringify(missing, null, 2));
  process.exit(0);
}
assert.deepEqual(
  missing,
  [],
  "Every literal t() key must have German and both Chinese translations",
);

const server = load("app/utils/i18n.server.ts");
const cookie = server.localeCookie("qa.myshopify.com");
const saved = await cookie.serialize("de");
assert.match(saved, /HttpOnly/);
assert.match(saved, /Path=\//);
assert.notEqual(cookie.name, server.localeCookie("other.myshopify.com").name);
assert.equal(
  await server.resolveRequestLocale(
    new Request("https://app.example/app?locale=zh-Hant", {
      headers: { Cookie: saved },
    }),
    "qa.myshopify.com",
  ),
  "de",
);
assert.equal(
  await server.resolveRequestLocale(
    new Request("https://app.example/app?locale=zh-Hant", {
      headers: { Cookie: saved },
    }),
    "other.myshopify.com",
  ),
  "zh-TW",
);
assert.equal(
  await server.resolveRequestLocale(
    new Request("https://app.example/app", {
      headers: { "Accept-Language": "de-DE,de;q=0.9" },
    }),
    "qa.myshopify.com",
  ),
  "de",
);
assert.equal(
  await server.resolveRequestLocale(
    new Request("https://app.example/app?locale=unsupported", {
      headers: { Cookie: "broken-cookie" },
    }),
    "qa.myshopify.com",
  ),
  "en",
);

let authentications = 0;
const endpoint = load("app/routes/api.locale.tsx", {
  "../shopify.server": {
    authenticate: {
      admin: async () => {
        authentications++;
        return { session: { shop: "qa.myshopify.com" } };
      },
    },
  },
});
const localeRequest = (locale) =>
  new Request("https://app.example/api/locale", {
    method: "POST",
    body: new URLSearchParams({ locale }),
  });
const good = await endpoint.action({ request: localeRequest("zh-TW") });
assert.equal(good.status, 200);
assert.equal((await good.json()).locale, "zh-TW");
assert.match(good.headers.get("Set-Cookie"), new RegExp(cookie.name));
const bad = await endpoint.action({ request: localeRequest("invalid") });
assert.equal(bad.status, 400);
assert.equal(bad.headers.get("Set-Cookie"), null);
assert.equal(
  authentications,
  2,
  "Language preferences must authenticate and use authenticated shop scope",
);

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { I18nProvider, useI18n } = load("app/utils/i18n.tsx");
function Probe() {
  const { t, formatNumber, formatDate } = useI18n();
  return React.createElement(
    "p",
    null,
    t("Create project"),
    " · ",
    formatNumber(1234.5),
    " · ",
    formatDate("2026-10-22T12:00:00Z", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
  );
}
for (const [locale, label] of [
  ["en", "Create project"],
  ["de", "Projekt erstellen"],
  ["zh-CN", "创建项目"],
  ["zh-TW", "建立專案"],
]) {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { locale, shop: "qa.myshopify.com" },
      React.createElement(Probe),
    ),
  );
  assert.ok(html.includes(label));
  if (locale === "de") {
    assert.ok(html.includes("1.234,5"));
    assert.ok(html.includes("22.10.2026"));
  }
}
console.log(
  `i18n checks passed: four locales, ${Object.keys(catalog).length} translated messages, ${sourceKeys.size} UI keys, safe per-store persistence, interpolation, and rendered locale formatting.`,
);
