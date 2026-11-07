// Checks the move to expiring offline access tokens (Shopify retires non-expiring
// ones: new installs are blocked from 2027-01-01, requests rejected from 2027-04-01).
// Run: node --test scripts/check-offline-token.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");

// Transpiles an app file to CommonJS and runs it. Specifiers in `mocks` are
// replaced at every depth; other relative imports load the same way; packages
// load for real from node_modules.
function loadModule(file, mocks = {}) {
  const filename = path.resolve(root, file);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  const load = (id) => {
    if (id in mocks) return mocks[id];
    if (!id.startsWith(".")) return require(id);
    const base = path.resolve(path.dirname(filename), id);
    const target = [`${base}.ts`, `${base}.tsx`, base].find(existsSync);
    if (!target) throw new Error(`Cannot resolve ${id} from ${file}`);
    return loadModule(path.relative(root, target), mocks);
  };
  new Function("module", "exports", "require", output)(mod, mod.exports, load);
  return mod.exports;
}

const { createOfflineTokenMigrator, hasNonExpiringOfflineToken } = loadModule(
  "app/utils/offline-token.server.ts",
);

const quiet = { info() {}, warn() {} };
const oldSession = (shop = "a.myshopify.com") => ({
  id: `offline_${shop}`,
  shop,
  isOnline: false,
  accessToken: "old-token",
  expires: undefined,
});
const expiringSession = (shop = "a.myshopify.com") => ({
  id: `offline_${shop}`,
  shop,
  isOnline: false,
  accessToken: "new-token",
  expires: new Date(Date.now() + 3_600_000),
  refreshToken: "refresh-token",
});

test("only offline sessions without an expiry hold a token Shopify retires", () => {
  assert.equal(hasNonExpiringOfflineToken(oldSession()), true);
  assert.equal(hasNonExpiringOfflineToken(expiringSession()), false);
  assert.equal(hasNonExpiringOfflineToken({ ...oldSession(), isOnline: true }), false);
  assert.equal(hasNonExpiringOfflineToken({ ...oldSession(), accessToken: "" }), false);
});

test("an already expiring token is left alone", async () => {
  let calls = 0;
  const ensure = createOfflineTokenMigrator({
    migrate: async () => {
      calls += 1;
      return { session: expiringSession() };
    },
    storage: { storeSession: async () => true },
    log: quiet,
  });
  const session = expiringSession();
  assert.equal(await ensure(session), session);
  assert.equal(calls, 0);
});

test("a non-expiring token is exchanged once and the expiring one is stored", async () => {
  const migrated = [];
  const stored = [];
  const ensure = createOfflineTokenMigrator({
    migrate: async (params) => {
      migrated.push(params);
      return { session: expiringSession() };
    },
    storage: {
      storeSession: async (session) => {
        stored.push(session);
        return true;
      },
    },
    log: quiet,
  });
  const result = await ensure(oldSession());
  assert.deepEqual(migrated, [
    { shop: "a.myshopify.com", nonExpiringOfflineAccessToken: "old-token" },
  ]);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].accessToken, "new-token");
  assert.equal(result.accessToken, "new-token");
  assert.ok(result.expires instanceof Date);
});

test("a failed exchange keeps the current session and never throws", async () => {
  const warnings = [];
  const ensure = createOfflineTokenMigrator({
    migrate: async () => {
      throw Object.assign(new Error("Unauthorized"), { response: { code: 401 } });
    },
    storage: { storeSession: async () => assert.fail("nothing to store") },
    log: { info() {}, warn: (message, details) => warnings.push({ message, details }) },
  });
  const session = oldSession();
  assert.equal(await ensure(session), session);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].details.shop, "a.myshopify.com");
  assert.equal(warnings[0].details.status, 401);
  assert.doesNotMatch(JSON.stringify(warnings), /old-token/, "tokens never reach the logs");
});

test("a store that fails to save is retried on the next request", async () => {
  let attempts = 0;
  let saves = 0;
  const ensure = createOfflineTokenMigrator({
    migrate: async () => {
      attempts += 1;
      return { session: expiringSession() };
    },
    storage: {
      storeSession: async () => {
        saves += 1;
        if (saves === 1) throw new Error("database unavailable");
        return true;
      },
    },
    log: quiet,
  });
  // Shopify returns the same expiring token again for the old one within seven
  // days, so a lost save is recovered by exchanging again.
  assert.equal((await ensure(oldSession())).accessToken, "old-token");
  assert.equal((await ensure(oldSession())).accessToken, "new-token");
  assert.equal(attempts, 2);
});

test("requests for the same store at the same time exchange only once", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ensure = createOfflineTokenMigrator({
    migrate: async () => {
      calls += 1;
      await gate;
      return { session: expiringSession() };
    },
    storage: { storeSession: async () => true },
    log: quiet,
  });
  const first = ensure(oldSession());
  const second = ensure(oldSession());
  release();
  const results = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(
    results.map((session) => session.accessToken),
    ["new-token", "new-token"],
  );
});

test("the app asks Shopify for expiring offline tokens and upgrades on app open", () => {
  const server = readFileSync(path.join(root, "app/shopify.server.ts"), "utf8");
  assert.match(server, /future:\s*{[^}]*expiringOfflineAccessTokens:\s*true/);
  assert.match(server, /export const ensureExpiringOfflineToken\b/);
  const layout = readFileSync(path.join(root, "app/routes/app.tsx"), "utf8");
  assert.match(layout, /await ensureExpiringOfflineToken\(session\)/);
});
