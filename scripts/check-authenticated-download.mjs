// Checks that report downloads send the App Bridge session token.
// Run: node --test scripts/check-authenticated-download.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

function load({ response }) {
  const seen = { requests: [], downloads: [], revoked: [] };
  const link = {
    click() {
      seen.downloads.push({ href: link.href, download: link.download });
    },
    remove() {},
  };
  const context = {
    module: { exports: {} },
    fetch: async (url, init) => {
      seen.requests.push({ url, init });
      return response;
    },
    URL: {
      createObjectURL: () => "blob:download",
      revokeObjectURL: (url) => seen.revoked.push(url),
    },
    document: { createElement: () => link, body: { appendChild() {} } },
    window: { setTimeout: (fn) => fn() },
  };
  context.exports = context.module.exports;
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../app/utils/authenticated-download.ts", import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
    ).outputText,
    context,
  );
  return { download: context.module.exports.downloadAuthenticatedFile, seen };
}
const ok = { ok: true, blob: async () => "file-bytes" };

test("the download request carries the session token and saves the file", async () => {
  const { download, seen } = load({ response: ok });
  await download({
    url: "/api/export/snap-1?format=csv",
    filename: "report-snapshot-1.csv",
    getIdToken: async () => "token-123",
  });
  assert.equal(seen.requests.length, 1);
  assert.equal(seen.requests[0].url, "/api/export/snap-1?format=csv");
  assert.equal(seen.requests[0].init.headers.Authorization, "Bearer token-123");
  assert.equal(seen.requests[0].init.redirect, "error");
  assert.deepEqual(seen.downloads, [{ href: "blob:download", download: "report-snapshot-1.csv" }]);
  assert.deepEqual(seen.revoked, ["blob:download"]);
});

test("a failed response raises instead of saving an error page", async () => {
  const { download, seen } = load({ response: { ok: false, status: 404 } });
  await assert.rejects(
    download({ url: "/api/export/x?format=csv", filename: "x.csv", getIdToken: async () => "t" }),
    /Download failed/,
  );
  assert.equal(seen.downloads.length, 0);
});

test("a missing token stops before any request", async () => {
  const { download, seen } = load({ response: ok });
  await assert.rejects(
    download({ url: "/api/export/x?format=csv", filename: "x.csv", getIdToken: async () => "" }),
    /authentication/,
  );
  assert.equal(seen.requests.length, 0);
});
