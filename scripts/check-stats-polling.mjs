// Checks that live page-snapshot stats refresh through the authenticated
// report loader instead of an unauthenticated event stream.
// Run: node --test scripts/check-stats-polling.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const mod = { exports: {} };
runInNewContext(
  ts.transpileModule(
    readFileSync(new URL("../app/utils/stats-polling.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  { module: mod, exports: mod.exports },
);
const { startStatsPolling, STATS_POLL_INTERVAL_MS } = mod.exports;

function harness({ visible = true, busy = false } = {}) {
  const state = { visible, busy, loads: [], timers: new Map(), nextId: 1 };
  const stop = startStatsPolling({
    url: "/app/project/p?snapshot=s&_stats=1&_part=overview",
    load: (url) => state.loads.push(url),
    isVisible: () => state.visible,
    isBusy: () => state.busy,
    setInterval: (fn, ms) => {
      const id = state.nextId++;
      state.timers.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id) => state.timers.delete(id),
  });
  const tick = () => [...state.timers.values()].forEach((timer) => timer.fn());
  return { state, stop, tick };
}

test("an active snapshot reloads the authenticated stats URL every 30 seconds", () => {
  const { state, tick } = harness();
  assert.equal(STATS_POLL_INTERVAL_MS, 30_000);
  assert.deepEqual([...state.timers.values()].map((timer) => timer.ms), [30_000]);
  assert.equal(state.loads.length, 0, "the first load is the page's own request");
  tick();
  tick();
  assert.deepEqual(state.loads, [
    "/app/project/p?snapshot=s&_stats=1&_part=overview",
    "/app/project/p?snapshot=s&_stats=1&_part=overview",
  ]);
});

test("a hidden tab or a request still in flight skips the refresh", () => {
  const { state, tick } = harness({ visible: false });
  tick();
  state.visible = true;
  state.busy = true;
  tick();
  assert.equal(state.loads.length, 0);
});

test("stopping polling clears its timer", () => {
  const { state, stop } = harness();
  stop();
  assert.equal(state.timers.size, 0);
});

test("the unauthenticated stats stream route and EventSource client are gone", () => {
  assert.equal(
    existsSync(new URL("../app/routes/api.stats-stream.$id.tsx", import.meta.url)),
    false,
  );
  const page = readFileSync(new URL("../app/routes/app.project.$id.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /EventSource|stats-stream/);
  assert.match(page, /startStatsPolling\(/);
});
