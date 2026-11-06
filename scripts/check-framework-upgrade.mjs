// Guards for the framework upgrade (docs/superpowers/plans/2026-11-06-framework-upgrade.md).
// Read-only: reads source files and loads small modules with mocks; never
// connects to Shopify or a database.
// Run: node --test scripts/check-framework-upgrade.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const listFiles = (dir) =>
  readdirSync(new URL(`../${dir}`, import.meta.url), { recursive: true })
    .filter((name) => /\.(tsx?|mjs)$/.test(name))
    .map((name) => `${dir}/${name}`);
const routeFiles = listFiles("app/routes").filter((file) => /\.tsx?$/.test(file));
const isScreenRoute = (source) => /^export default/m.test(source);

test("every screen route that calls authenticate.admin exports Shopify's boundary headers", () => {
  const missing = routeFiles.filter((file) => {
    const source = read(file);
    if (!isScreenRoute(source) || !source.includes("authenticate.admin")) return false;
    return !/export const headers\b[\s\S]{0,160}?boundary\.headers\(/.test(source);
  });
  assert.deepEqual(missing, []);
});
