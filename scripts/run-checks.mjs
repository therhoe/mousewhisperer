// Runs every node --test check script with an unreachable database, so no
// check can ever touch the production database from the local .env.
// Usage: node scripts/run-checks.mjs [--write <file>] [--compare <file>]
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const UNREACHABLE = "postgresql://none:none@127.0.0.1:1/none";
const env = { ...process.env, DATABASE_URL: UNREACHABLE, DIRECT_URL: UNREACHABLE };
delete env.GROWTH_TEST_DATABASE_URL;
delete env.JOURNEY_TEST_DATABASE_URL;

const files = readdirSync("scripts")
  .filter((name) => /^check-.*\.mjs$/.test(name) || /\.test\.mjs$/.test(name))
  .sort();
const results = files.map((name) => {
  const run = spawnSync(process.execPath, ["--test", `scripts/${name}`], {
    env,
    encoding: "utf8",
    timeout: 180_000,
  });
  return [name, run.status === 0 ? "PASS" : "FAIL"];
});
const text = `${results.map(([name, status]) => `${status} ${name}`).join("\n")}\n`;
process.stdout.write(text);

const writeTo = option("--write");
if (writeTo) writeFileSync(writeTo, text);

const compareTo = option("--compare");
if (compareTo) {
  const before = new Map(
    readFileSync(compareTo, "utf8")
      .split("\n")
      .filter((line) => /^(PASS|FAIL) /.test(line))
      .map((line) => {
        const [status, name] = line.split(" ");
        return [name, status];
      }),
  );
  const regressions = results
    .filter(([name, status]) => before.get(name) === "PASS" && status !== "PASS")
    .map(([name]) => name);
  if (regressions.length) {
    console.error(`Regressions against ${compareTo}: ${regressions.join(", ")}`);
    process.exit(1);
  }
  console.log(`No regressions against ${compareTo}`);
}
