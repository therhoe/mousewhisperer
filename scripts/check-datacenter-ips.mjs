// Database-free checks for datacenter IP range matching.
// Run: node --test scripts/check-datacenter-ips.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const mod = { exports: {} };
runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL("../app/utils/datacenter-ips.server.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { module: mod, exports: mod.exports },
);
const { isDatacenterIP } = mod.exports;
const match = (ip) => {
  const result = isDatacenterIP(ip);
  return [result.isDatacenter, result.provider];
};

test("ranges whose first octet is 128 or higher match", () => {
  assert.deepEqual(match("176.32.96.1"), [true, "AWS"]);
  assert.deepEqual(match("130.211.4.20"), [true, "GCP"]);
});

test("range edges are inclusive and the next address is outside", () => {
  // 176.32.96.0/19 spans 176.32.96.0 to 176.32.127.255.
  assert.deepEqual(match("176.32.96.0"), [true, "AWS"]);
  assert.deepEqual(match("176.32.127.255"), [true, "AWS"]);
  assert.deepEqual(match("176.32.128.0"), [false, null]);
});

test("low ranges still match and ordinary addresses do not", () => {
  assert.deepEqual(match("3.1.1.1"), [true, "AWS"]);
  assert.deepEqual(match("8.8.8.8"), [false, null]);
  assert.deepEqual(match("not-an-ip"), [false, null]);
});
