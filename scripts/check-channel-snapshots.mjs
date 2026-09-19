import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const BASE_TIME = Date.UTC(2026, 7, 26, 12);
const SHOP = "channel-test.myshopify.com";
const OTHER_SHOP = "other-tenant.myshopify.com";
const reportSource = readFileSync(
  new URL("../app/utils/channel-report.ts", import.meta.url),
  "utf8",
);
const serverSource = readFileSync(
  new URL("../app/utils/channel-snapshot.server.ts", import.meta.url),
  "utf8",
);
const clone = (value) => structuredClone(value);

function fixedDate(clock) {
  return class extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock.now]));
    }
    static now() {
      return clock.now;
    }
  };
}

function loadModule(source, filename, imports, clock = { now: BASE_TIME }) {
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    Date: fixedDate(clock),
    URL,
    console: { warn() {} },
    require(name) {
      assert.ok(Object.hasOwn(imports, name), `Unexpected import ${name}`);
      return imports[name];
    },
  };
  vm.runInNewContext(output.outputText, context, { filename });
  return module.exports;
}

const report = loadModule(reportSource, "channel-report.ts", {});

function acquisition(overrides = {}) {
  return {
    id: "acq_regression_journey_123",
    startedAt: BASE_TIME,
    source: "google",
    medium: "cpc",
    campaign: "summer",
    referrer: "https://google.com/",
    sourceCategory: "Paid Search",
    landingPath: "/collections/shoes",
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    id: "snapshot-a",
    shop: SHOP,
    name: "Channel comparison",
    status: "ACTIVE",
    completionMode: "HUMAN_SESSIONS",
    targetSessions: 1000,
    durationDays: null,
    startedAt: new Date(BASE_TIME - 60_000),
    endsAt: null,
    completedAt: null,
    createdAt: new Date(BASE_TIME - 60_000),
    ...overrides,
  };
}

function session(overrides = {}) {
  return {
    id: "session-a",
    channelSnapshotId: "snapshot-a",
    acquisitionId: "acq_regression_journey_123",
    trackingSessionId: "legacy-browser",
    channel: "Paid Search",
    source: "google",
    medium: "cpc",
    campaign: "summer",
    referrer: "https://google.com/",
    landingPath: "/collections/shoes",
    acquiredAt: new Date(BASE_TIME - 60_000),
    startedAt: new Date(BASE_TIME - 60_000),
    lastSeenAt: new Date(BASE_TIME),
    addedToCart: false,
    checkoutStarted: false,
    checkoutStartedAt: null,
    converted: false,
    convertedAt: null,
    ...overrides,
  };
}

function row(overrides = {}) {
  return {
    id: "row-a",
    channel: "Paid Search",
    source: "google",
    medium: "cpc",
    campaign: "summer",
    visitorType: "REAL",
    pageViews: 1,
    timeOnPage: 10000,
    averageScrollDepth: 25,
    addedToCart: false,
    checkoutStarted: false,
    converted: false,
    ...overrides,
  };
}

function tracking(overrides = {}) {
  return {
    shop: SHOP,
    snapshotId: "snapshot-a",
    sessionId: "legacy-browser",
    pageViewId: "page-1",
    acquisition: acquisition(),
    pagePath: "/products/shoes?private=value",
    startedAt: BASE_TIME,
    source: "shop.example",
    medium: null,
    campaign: null,
    sourceCategory: "Internal",
    visitorType: "REAL",
    timeOnPage: 6000,
    scrollDepth: 40,
    addedToCart: false,
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// In-memory relational mock: records every query and rolls back failed
// transactions. It never imports the actual DB client or makes network calls.
function fixture({
  snapshots = [snapshot()],
  sessions = [],
  visits = [],
  access = {},
} = {}) {
  const clock = { now: BASE_TIME };
  const state = {
    snapshots: clone(snapshots),
    sessions: clone(sessions),
    visits: clone(visits),
  };
  const calls = [];
  const notifications = [];
  const billingCalls = [];
  const rowLocks = new Map();
  const lockEvents = [];
  class KnownRequestError extends Error {
    constructor(code = "P2002") {
      super(code);
      this.code = code;
    }
  }
  class PlanLimitError extends Error {}
  const record = (method, args) => calls.push({ method, args: clone(args) });

  function scalarMatches(value, expected) {
    if (
      expected &&
      typeof expected === "object" &&
      !(expected instanceof Date)
    ) {
      if (expected.in && !expected.in.includes(value)) return false;
      if (
        Object.hasOwn(expected, "gte") &&
        (value == null || value < expected.gte)
      )
        return false;
      if (
        Object.hasOwn(expected, "lte") &&
        (value == null || value > expected.lte)
      )
        return false;
      if (
        Object.hasOwn(expected, "gt") &&
        (value == null || value <= expected.gt)
      )
        return false;
      return true;
    }
    return value instanceof Date && expected instanceof Date
      ? value.getTime() === expected.getTime()
      : value === expected;
  }

  function matches(model, value, where = {}) {
    return Object.entries(where).every(([key, expected]) => {
      if (key === "OR")
        return expected.some((condition) => matches(model, value, condition));
      if (key === "channelSnapshot") {
        const parent = state.snapshots.find(
          (item) => item.id === value.channelSnapshotId,
        );
        return !!parent && matches("snapshots", parent, expected);
      }
      if (key === "visits") {
        return state.visits.some(
          (visit) =>
            visit.sessionId === value.id &&
            matches("visits", visit, expected.some),
        );
      }
      if (
        key === "channelSnapshotId_acquisitionId" ||
        key === "sessionId_pageViewId"
      ) {
        return Object.entries(expected).every(
          ([field, target]) => value[field] === target,
        );
      }
      return scalarMatches(value[key], expected);
    });
  }

  function ordered(values, orderBy) {
    const terms = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
    return values.sort((a, b) => {
      for (const term of terms) {
        for (const [key, direction] of Object.entries(term)) {
          const comparison = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
          if (comparison)
            return direction === "desc" ? -comparison : comparison;
        }
      }
      return 0;
    });
  }

  function table(model, label, defaults) {
    const find = (args) =>
      ordered(
        state[model].filter((value) => matches(model, value, args.where)),
        args.orderBy,
      );
    const checkUnique = (candidate) => {
      if (
        model === "snapshots" &&
        candidate.status === "ACTIVE" &&
        state.snapshots.some(
          (value) =>
            value.shop === candidate.shop &&
            value.status === "ACTIVE" &&
            value.id !== candidate.id,
        )
      ) {
        throw new KnownRequestError();
      }
    };
    return {
      async findMany(args = {}) {
        record(`${label}.findMany`, args);
        let values = find(args);
        values = values.slice(
          args.skip || 0,
          args.take == null ? undefined : (args.skip || 0) + args.take,
        );
        return clone(
          values.map((value) =>
            args.include?._count
              ? {
                  ...value,
                  _count: {
                    sessions: state.sessions.filter(
                      (item) => item.channelSnapshotId === value.id,
                    ).length,
                  },
                }
              : value,
          ),
        );
      },
      async findFirst(args = {}) {
        record(`${label}.findFirst`, args);
        return clone(find(args)[0] || null);
      },
      async findUnique(args = {}) {
        record(`${label}.findUnique`, args);
        return clone(find(args)[0] || null);
      },
      async count(args = {}) {
        record(`${label}.count`, args);
        return find(args).length;
      },
      async create(args) {
        record(`${label}.create`, args);
        const value = {
          ...defaults(),
          ...clone(args.data),
          id: args.data.id || `${model}-${state[model].length + 1}`,
        };
        checkUnique(value);
        state[model].push(value);
        return clone(value);
      },
      async update(args) {
        record(`${label}.update`, args);
        const value = find(args)[0];
        assert.ok(value, `${label}.update target missing`);
        const next = { ...value, ...clone(args.data) };
        checkUnique(next);
        Object.assign(value, next);
        return clone(value);
      },
      async updateMany(args) {
        record(`${label}.updateMany`, args);
        const values = find(args);
        for (const value of values) {
          const next = { ...value, ...clone(args.data) };
          checkUnique(next);
          Object.assign(value, next);
        }
        return { count: values.length };
      },
      async upsert(args) {
        record(`${label}.upsert`, args);
        const value = find(args)[0];
        if (value) {
          Object.assign(value, clone(args.update));
          return clone(value);
        }
        const next = {
          ...defaults(),
          ...clone(args.create),
          id: args.create.id || `${model}-${state[model].length + 1}`,
        };
        state[model].push(next);
        return clone(next);
      },
    };
  }

  const db = {
    channelSnapshot: table("snapshots", "channelSnapshot", () =>
      snapshot({ startedAt: new Date(clock.now) }),
    ),
    channelSnapshotSession: table("sessions", "channelSnapshotSession", () =>
      session(),
    ),
    channelSnapshotVisit: table("visits", "channelSnapshotVisit", () => ({})),
    async $transaction(callback) {
      let before;
      const heldLocks = new Map();
      const transaction = {
        ...db,
        async $queryRaw(parts, ...values) {
          if (parts.join("?").includes("FOR UPDATE")) {
            const key = JSON.stringify(values);
            if (!heldLocks.has(key)) {
              const prior = rowLocks.get(key);
              let release;
              const pending = new Promise((resolve) => {
                release = resolve;
              });
              rowLocks.set(key, pending);
              await prior;
              lockEvents.push({ event: "acquired", key });
              heldLocks.set(key, () => {
                lockEvents.push({ event: "released", key });
                if (rowLocks.get(key) === pending) rowLocks.delete(key);
                release();
              });
              before = clone(state);
            }
          }
          return db.$queryRaw(parts, ...values);
        },
      };
      try {
        return await callback(transaction);
      } catch (error) {
        if (before) Object.assign(state, before);
        throw error;
      } finally {
        for (const release of heldLocks.values()) release();
      }
    },
    async $queryRaw(parts, ...values) {
      const sql = parts.join("?");
      record("$queryRaw", { sql, values });
      if (sql.includes("FOR UPDATE")) {
        return clone(
          state.snapshots
            .filter(
              (value) => value.id === values[0] && value.shop === values[1],
            )
            .map(({ id }) => ({ id })),
        );
      }
      assert.match(
        sql,
        /GROUP BY s\.id/,
        "Reports must aggregate by acquisition session, not count heartbeat rows",
      );
      const [shop, snapshotId] = values;
      if (
        !state.snapshots.some(
          (value) => value.id === snapshotId && value.shop === shop,
        )
      )
        return [];
      return clone(
        state.sessions
          .filter((value) => value.channelSnapshotId === snapshotId)
          .map((value) => {
            const pageRows = state.visits.filter(
              (visit) => visit.sessionId === value.id,
            );
            const visitorType =
              ["REAL", "ZOMBIE", "PENDING", "BOT"].find((type) =>
                pageRows.some((visit) => visit.visitorType === type),
              ) || "PENDING";
            return {
              ...value,
              visitorType,
              pageViews: pageRows.length,
              timeOnPage: pageRows.reduce(
                (sum, visit) => sum + visit.timeOnPage,
                0,
              ),
              averageScrollDepth: pageRows.length
                ? pageRows.reduce((sum, visit) => sum + visit.scrollDepth, 0) /
                  pageRows.length
                : 0,
            };
          }),
      );
    },
  };
  const api = loadModule(
    serverSource,
    "channel-snapshot.server.ts",
    {
      "@prisma/client": {
        Prisma: { PrismaClientKnownRequestError: KnownRequestError },
      },
      "../db.server": { __esModule: true, default: db },
      "./billing.server": {
        PlanLimitError,
        getBillingAccess: async (shop) => {
          billingCalls.push(shop);
          return {
            canCreateNormalSnapshot: true,
            limits: { maxSnapshotTargetVisitors: 1_000_000 },
            ...access,
          };
        },
      },
      "./notifications.server": {
        createNotification: async (input) => notifications.push(clone(input)),
      },
      "./channel-report": report,
    },
    clock,
  );
  return {
    api,
    state,
    db,
    calls,
    notifications,
    billingCalls,
    lockEvents,
    clock,
    PlanLimitError,
  };
}

test("acquisition validation rejects absent, malformed, stale and future timestamps", () => {
  for (const value of [
    null,
    undefined,
    [],
    "x",
    {},
    acquisition({ id: "invalid" }),
    ...[
      null,
      undefined,
      "",
      NaN,
      Infinity,
      "bad",
      BASE_TIME + 60_001,
      BASE_TIME - 7 * 86_400_000 - 1,
    ].map((startedAt) => acquisition({ startedAt })),
  ]) {
    assert.equal(
      report.readChannelAcquisition(value, new Date(BASE_TIME)),
      null,
    );
  }
  const valid = report.readChannelAcquisition(
    acquisition(),
    new Date(BASE_TIME),
  );
  assert.equal(valid.id, "acq_regression_journey_123");
  assert.equal(valid.startedAt.getTime(), BASE_TIME);
  assert.equal(
    report
      .readChannelAcquisition(
        acquisition({ startedAt: BASE_TIME + 60_000 }),
        new Date(BASE_TIME),
      )
      .startedAt.getTime(),
    BASE_TIME + 60_000,
  );
});

test("acquisition text is bounded, navigation URL queries are removed, and Internal becomes Unknown", () => {
  const value = report.readChannelAcquisition(
    acquisition({
      source: "x".repeat(500),
      medium: "y".repeat(500),
      campaign: "z".repeat(500),
      referrer: "https://google.com/search?email=private#fragment",
      landingPath: "https://shop.example/products/shoes?token=private#section",
      sourceCategory: "Internal",
    }),
  );
  assert.equal(value.channel, "Unknown");
  assert.equal(value.source.length, 160);
  assert.equal(value.medium.length, 160);
  assert.equal(value.campaign.length, 240);
  assert.equal(value.referrer, "https://google.com/search");
  assert.equal(value.landingPath, "/products/shoes");
  // eslint-disable-next-line no-script-url -- deliberately unsafe regression input
  assert.equal(report.channelPagePath("javascript:alert(1)"), null);
  assert.equal(report.channelPagePath(null), null);
  assert.equal(report.channelPagePath("/" + "x".repeat(5000)).length, 600);
  assert.equal(report.boundedText(" \u0000hi\u001f ", 10), "hi");
  assert.equal(
    report.readChannelAcquisition(
      acquisition({ referrer: "data:text/plain,private" }),
    ).referrer,
    null,
  );
});

test("human metrics include real and zombie sessions while bot/pending flags never inflate rates", () => {
  const metrics = report.summarizeChannelSessions([
    row({
      id: "real",
      addedToCart: true,
      converted: true,
      checkoutStarted: true,
    }),
    row({
      id: "zombie",
      visitorType: "ZOMBIE",
      timeOnPage: 20000,
      averageScrollDepth: 75,
      addedToCart: true,
    }),
    row({
      id: "bot",
      visitorType: "BOT",
      addedToCart: true,
      converted: true,
      checkoutStarted: true,
    }),
    row({
      id: "pending",
      visitorType: "PENDING",
      channel: "Unknown",
      addedToCart: true,
      converted: true,
    }),
  ]);
  assert.deepEqual(clone(metrics), {
    sessions: 4,
    real: 1,
    zombies: 1,
    bots: 1,
    pending: 1,
    humanSessions: 2,
    pageViews: 4,
    averageTimeSeconds: 15,
    averageScrollDepth: 50,
    addedToCart: 2,
    checkoutStarted: 1,
    conversions: 1,
    atcRate: 100,
    conversionRate: 50,
    unknownSessions: 1,
  });
  const empty = report.summarizeChannelSessions([]);
  assert.ok(Object.values(empty).every((value) => value === 0));
  assert.equal(report.channelPercent(5, 0), 0);
});

test("report groups channel/source/medium/campaign, paginates groups and clamps invalid pages", () => {
  const rows = Array.from({ length: 23 }, (_, index) =>
    row({ id: `row-${index}`, campaign: `campaign-${index}` }),
  );
  rows.push(row({ id: "extra-session", campaign: "campaign-0" }));
  const first = report.buildChannelReport(rows);
  assert.equal(first.summary.sessions, 24);
  assert.equal(first.capturedSessions, 24);
  assert.equal(first.totalRows, 23);
  assert.equal(first.rows[0].sessions, 2);
  assert.equal(first.rows.length, 10);
  assert.equal(first.pageCount, 3);
  assert.equal(report.buildChannelReport(rows, { page: 2 }).rows.length, 10);
  assert.equal(report.buildChannelReport(rows, { page: 100 }).rows.length, 3);
  assert.equal(report.buildChannelReport(rows, { page: 100 }).page, 3);
  for (const page of [-10, NaN, Infinity])
    assert.equal(report.buildChannelReport(rows, { page }).page, 1);
  assert.equal(report.buildChannelReport(rows, { page: 2.7 }).page, 2);
});

test("report filters compose, the no-campaign filter works, and clearing filters resets the result", () => {
  const rows = [
    row(),
    row({ id: "other-medium", medium: "organic" }),
    row({
      id: "social",
      channel: "Organic Social",
      source: "instagram",
      campaign: null,
    }),
  ];
  assert.equal(report.buildChannelReport(rows).totalRows, 3);
  const filtered = report.buildChannelReport(rows, {
    channel: "Organic Social",
    source: "instagram",
    campaign: "__none__",
    page: 9,
  });
  assert.equal(filtered.summary.sessions, 1);
  assert.equal(filtered.page, 1);
  assert.equal(
    filtered.options.channels.length,
    2,
    "Filter choices must not disappear with the active filter",
  );
  assert.equal(
    report.buildChannelReport(rows, { campaign: "missing" }).summary.sessions,
    0,
  );
  const reset = report.buildChannelReport(rows, {});
  assert.equal(reset.summary.sessions, 3);
  assert.equal(reset.page, 1);
  assert.equal(report.buildChannelReport([]).pageCount, 1);
});

test("create supports all independent completion modes and rejects invalid input before DB writes", async () => {
  for (const completionMode of [
    "HUMAN_SESSIONS",
    "TOTAL_SESSIONS",
    "TIME_WINDOW",
  ]) {
    const f = fixture({ snapshots: [] });
    const created = await f.api.createChannelSnapshot({
      shop: SHOP,
      name: "  Channel test  ",
      completionMode,
      targetSessions: 25,
      durationDays: 3,
    });
    assert.equal(created.shop, SHOP);
    assert.equal(created.name, "Channel test");
    assert.equal(created.status, "ACTIVE");
    assert.equal(
      created.targetSessions,
      completionMode === "TIME_WINDOW" ? null : 25,
    );
    assert.equal(
      created.durationDays,
      completionMode === "TIME_WINDOW" ? 3 : null,
    );
    if (completionMode === "TIME_WINDOW")
      assert.equal(created.endsAt.getTime(), BASE_TIME + 3 * 86_400_000);
    assert.deepEqual(f.billingCalls, [SHOP]);
  }
  for (const invalid of [
    { completionMode: "OTHER" },
    { targetSessions: 24 },
    { targetSessions: 25.5 },
    { targetSessions: 1_000_001 },
    { completionMode: "TIME_WINDOW", durationDays: 0 },
    { completionMode: "TIME_WINDOW", durationDays: 91 },
    { completionMode: "TIME_WINDOW", durationDays: 1.5 },
  ]) {
    const f = fixture({ snapshots: [] });
    await assert.rejects(
      f.api.createChannelSnapshot({ shop: SHOP, ...invalid }),
      (error) =>
        error instanceof f.api.ChannelSnapshotError && error.status === 400,
    );
    assert.equal(f.state.snapshots.length, 0);
  }
});

test("create enforces billing and active uniqueness per tenant, with pause allowing a new capture", async () => {
  const noAllowance = fixture({
    snapshots: [],
    access: { canCreateNormalSnapshot: false },
  });
  await assert.rejects(
    noAllowance.api.createChannelSnapshot({ shop: SHOP }),
    noAllowance.PlanLimitError,
  );
  const limited = fixture({
    snapshots: [],
    access: { limits: { maxSnapshotTargetVisitors: 100 } },
  });
  await assert.rejects(
    limited.api.createChannelSnapshot({ shop: SHOP, targetSessions: 101 }),
    limited.PlanLimitError,
  );
  const f = fixture();
  await assert.rejects(
    f.api.createChannelSnapshot({ shop: SHOP }),
    (error) => error.status === 409,
  );
  assert.equal(f.state.snapshots.length, 1);
  const other = await f.api.createChannelSnapshot({ shop: OTHER_SHOP });
  assert.equal(other.shop, OTHER_SHOP);
  await f.api.transitionChannelSnapshot(SHOP, "snapshot-a", "pause");
  const second = await f.api.createChannelSnapshot({ shop: SHOP });
  assert.equal(second.status, "ACTIVE");
  await assert.rejects(
    f.api.transitionChannelSnapshot(SHOP, "snapshot-a", "resume"),
    (error) => error.status === 409,
  );
  assert.equal(
    f.state.snapshots.find((value) => value.id === "snapshot-a").status,
    "PAUSED",
  );
});

test("lifecycle allows pause/resume/complete and prevents invalid transitions or cross-tenant mutation", async () => {
  const f = fixture();
  await assert.rejects(
    f.api.transitionChannelSnapshot(SHOP, "snapshot-a", "resume"),
    (error) => error.status === 409,
  );
  await assert.rejects(
    f.api.transitionChannelSnapshot(SHOP, "snapshot-a", "delete"),
    (error) => error.status === 400,
  );
  await assert.rejects(
    f.api.transitionChannelSnapshot(OTHER_SHOP, "snapshot-a", "pause"),
    (error) => error.status === 404,
  );
  assert.equal(f.state.snapshots[0].status, "ACTIVE");
  assert.equal(
    (await f.api.transitionChannelSnapshot(SHOP, "snapshot-a", "pause")).status,
    "PAUSED",
  );
  await assert.rejects(
    f.api.transitionChannelSnapshot(SHOP, "snapshot-a", "pause"),
    (error) => error.status === 409,
  );
  assert.equal(
    (await f.api.transitionChannelSnapshot(SHOP, "snapshot-a", "resume"))
      .status,
    "ACTIVE",
  );
  assert.equal(
    (await f.api.transitionChannelSnapshot(SHOP, "snapshot-a", "complete"))
      .status,
    "COMPLETED",
  );
  await assert.rejects(
    f.api.transitionChannelSnapshot(SHOP, "snapshot-a", "resume"),
    (error) => error.status === 409,
  );
  assert.equal(f.notifications.length, 1);
  const locks = f.calls.filter((call) => call.method === "$queryRaw");
  assert.ok(locks.every((call) => call.args.sql.includes("AND shop = ?")));
});

test("repeating completion is idempotent and does not emit duplicate completion notifications", async () => {
  const f = fixture();
  await f.api.transitionChannelSnapshot(SHOP, "snapshot-a", "complete");
  const completedAt = f.state.snapshots[0].completedAt.getTime();
  f.clock.now += 1000;
  await f.api.transitionChannelSnapshot(SHOP, "snapshot-a", "complete");
  assert.equal(f.state.snapshots[0].completedAt.getTime(), completedAt);
  assert.equal(f.notifications.length, 1);
});

test("expired active/paused windows complete once while other tenants remain untouched", async () => {
  const f = fixture({
    snapshots: [
      snapshot({
        endsAt: new Date(BASE_TIME - 1),
        completionMode: "TIME_WINDOW",
        targetSessions: null,
      }),
      snapshot({
        id: "paused",
        status: "PAUSED",
        endsAt: new Date(BASE_TIME - 1),
      }),
      snapshot({
        id: "other",
        shop: OTHER_SHOP,
        endsAt: new Date(BASE_TIME - 1),
      }),
    ],
  });
  assert.equal(await f.api.getActiveChannelSnapshot(SHOP), null);
  assert.equal(f.state.snapshots[0].status, "ACTIVE");
  assert.equal(f.state.snapshots[1].status, "PAUSED");
  assert.equal(f.notifications.length, 0);
  await f.api.listChannelSnapshots(SHOP);
  assert.equal(f.state.snapshots[0].status, "COMPLETED");
  assert.equal(f.state.snapshots[1].status, "COMPLETED");
  assert.equal(f.state.snapshots[2].status, "ACTIVE");
  assert.equal(f.notifications.length, 2);
  await f.api.listChannelSnapshots(SHOP);
  assert.equal(f.notifications.length, 2);
});

test("active tracking lookup is read-only, tenant-scoped, and uses one query without an expiry sweep", async () => {
  const f = fixture({ snapshots: [] });
  for (let index = 0; index < 10; index++) {
    assert.equal(await f.api.getActiveChannelSnapshot(SHOP), null);
  }
  assert.equal(f.calls.length, 10);
  assert.ok(
    f.calls.every(
      ({ method, args }) =>
        method === "channelSnapshot.findFirst" &&
        args.where.shop === SHOP &&
        args.where.status === "ACTIVE" &&
        Array.isArray(args.where.OR),
    ),
  );
  assert.deepEqual(f.state, { snapshots: [], sessions: [], visits: [] });
});

test("concurrent same-shop active lookups coalesce but settled absence never hides a newly created capture", async () => {
  const f = fixture({ snapshots: [] });
  const gate = deferred();
  const original = f.db.channelSnapshot.findFirst;
  f.db.channelSnapshot.findFirst = async (args) => {
    await gate.promise;
    return original(args);
  };
  const requests = Array.from({ length: 8 }, () =>
    f.api.getActiveChannelSnapshot(SHOP),
  );
  gate.resolve();
  assert.deepEqual(await Promise.all(requests), Array(8).fill(null));
  assert.equal(f.calls.length, 1);

  const created = await f.api.createChannelSnapshot({ shop: SHOP });
  f.calls.length = 0;
  assert.equal((await f.api.getActiveChannelSnapshot(SHOP)).id, created.id);
  assert.equal(f.calls.length, 1, "No settled negative result may be cached");
  await f.api.transitionChannelSnapshot(SHOP, created.id, "pause");
  assert.equal(await f.api.getActiveChannelSnapshot(SHOP), null);
});

test("active lookup single-flight is isolated per tenant and a failed request is immediately retryable", async () => {
  const f = fixture({
    snapshots: [snapshot(), snapshot({ id: "other", shop: OTHER_SHOP })],
  });
  const results = await Promise.all([
    f.api.getActiveChannelSnapshot(SHOP),
    f.api.getActiveChannelSnapshot(OTHER_SHOP),
    f.api.getActiveChannelSnapshot(SHOP),
  ]);
  assert.deepEqual(
    results.map((value) => value.id),
    ["snapshot-a", "other", "snapshot-a"],
  );
  assert.equal(f.calls.length, 2);

  let attempts = 0;
  const original = f.db.channelSnapshot.findFirst;
  f.db.channelSnapshot.findFirst = async (args) => {
    attempts++;
    if (attempts === 1) throw new Error("temporary lookup failure");
    return original(args);
  };
  const failures = await Promise.allSettled([
    f.api.getActiveChannelSnapshot(SHOP),
    f.api.getActiveChannelSnapshot(SHOP),
  ]);
  assert.ok(failures.every((value) => value.status === "rejected"));
  assert.equal(attempts, 1);
  assert.equal((await f.api.getActiveChannelSnapshot(SHOP)).id, "snapshot-a");
  assert.equal(attempts, 2);
});

test("list/report lookup are tenant-scoped and clamp pagination", async () => {
  const f = fixture({
    snapshots: [
      ...Array.from({ length: 23 }, (_, index) =>
        snapshot({ id: `snapshot-${index}`, status: "COMPLETED" }),
      ),
      snapshot({ id: "foreign", shop: OTHER_SHOP }),
    ],
  });
  const list = await f.api.listChannelSnapshots(SHOP, 100);
  assert.equal(list.total, 23);
  assert.equal(list.page, 3);
  assert.equal(list.snapshots.length, 3);
  assert.equal(list.activeSnapshotId, null);
  assert.equal(await f.api.getChannelSnapshotReport(SHOP, "foreign"), null);
  assert.ok(
    f.calls
      .filter(
        (call) =>
          call.method.startsWith("channelSnapshot.") &&
          ["findMany", "findFirst", "count"].some((name) =>
            call.method.endsWith(name),
          ),
      )
      .every((call) => call.args.where.shop === SHOP),
  );
});

test("heartbeat retries update one page/session, preserve acquisition and deduplicate report metrics", async () => {
  const f = fixture();
  assert.equal(await f.api.trackChannelSnapshotVisit(tracking()), true);
  f.clock.now += 5000;
  await f.api.trackChannelSnapshotVisit(
    tracking({ timeOnPage: 12000, scrollDepth: 60 }),
  );
  await f.api.trackChannelSnapshotVisit(
    tracking({
      timeOnPage: 3000,
      scrollDepth: 10,
      visitorType: "ZOMBIE",
      sourceCategory: "Referral",
      campaign: "internal-changed",
    }),
  );
  assert.equal(f.state.sessions.length, 1);
  assert.equal(f.state.visits.length, 1);
  assert.equal(f.state.visits[0].timeOnPage, 12000);
  assert.equal(f.state.visits[0].scrollDepth, 60);
  assert.equal(f.state.visits[0].visitorType, "REAL");
  assert.equal(f.state.sessions[0].campaign, "summer");
  await f.api.trackChannelSnapshotVisit(
    tracking({
      pageViewId: "page-2",
      pagePath: "/cart",
      timeOnPage: 8000,
      addedToCart: true,
    }),
  );
  const result = await f.api.getChannelSnapshotReport(SHOP, "snapshot-a");
  assert.equal(result.summary.sessions, 1);
  assert.equal(result.summary.pageViews, 2);
  assert.equal(result.summary.averageTimeSeconds, 20);
  assert.equal(result.summary.addedToCart, 1);
  assert.equal(result.summary.atcRate, 100);
  assert.equal(f.state.sessions[0].landingPath, "/collections/shoes");
  assert.ok(
    f.calls.some(
      (call) =>
        call.method === "$queryRaw" &&
        call.args.sql.includes("capture.shop = ?") &&
        call.args.values[0] === SHOP,
    ),
  );
});

test("unchanged acquisition heartbeats do not recount the whole snapshot target", async () => {
  for (const completionMode of ["HUMAN_SESSIONS", "TOTAL_SESSIONS"]) {
    const f = fixture({ snapshots: [snapshot({ completionMode })] });
    for (let index = 0; index < 10; index++) {
      await f.api.getActiveChannelSnapshot(SHOP);
      await f.api.trackChannelSnapshotVisit(
        tracking({ timeOnPage: 6000 + index * 1000 }),
      );
    }
    assert.equal(f.state.sessions.length, 1);
    assert.equal(f.state.visits.length, 1);
    assert.equal(
      f.calls.filter(({ method }) => method === "channelSnapshotSession.count")
        .length,
      1,
      "Only the first eligible admission needs a whole-snapshot count",
    );
    assert.equal(
      f.calls.filter(({ method }) => method === "$queryRaw").length,
      10,
      "Every heartbeat retains authoritative snapshot locking",
    );
    assert.equal(f.calls.length, 70, "Previously this path made 90 ORM calls");
  }
});

test("human target recounts only first-human eligibility changes, not additional human pages", async () => {
  const f = fixture({ snapshots: [snapshot({ targetSessions: 2 })] });
  const countQueries = () =>
    f.calls.filter(({ method }) => method === "channelSnapshotSession.count")
      .length;
  await f.api.trackChannelSnapshotVisit(tracking({ visitorType: "BOT" }));
  await f.api.trackChannelSnapshotVisit(
    tracking({
      sessionId: "pending-browser",
      acquisition: acquisition({ id: "acq_pending_journey_123" }),
      visitorType: "PENDING",
    }),
  );
  assert.equal(countQueries(), 0);
  await f.api.trackChannelSnapshotVisit(
    tracking({ visitorType: "REAL", timeOnPage: 8000 }),
  );
  assert.equal(countQueries(), 1);
  await f.api.trackChannelSnapshotVisit(
    tracking({ visitorType: "ZOMBIE", timeOnPage: 9000 }),
  );
  await f.api.trackChannelSnapshotVisit(tracking({ pageViewId: "page-2" }));
  assert.equal(countQueries(), 1);
  assert.equal(f.state.snapshots[0].status, "ACTIVE");
  await f.api.trackChannelSnapshotVisit(
    tracking({
      sessionId: "pending-browser",
      acquisition: acquisition({ id: "acq_pending_journey_123" }),
      visitorType: "ZOMBIE",
      timeOnPage: 8000,
    }),
  );
  assert.equal(countQueries(), 2);
  assert.equal(f.state.snapshots[0].status, "COMPLETED");
  assert.equal(f.state.sessions.length, 2);
  assert.equal(f.state.visits.length, 3);
  assert.equal(f.notifications.length, 1);
});

test("query optimization preserves timestamp-based REAL/ZOMBIE/BOT classification and monotonic engagement values", async () => {
  const f = fixture();
  const countQueries = () =>
    f.calls.filter(({ method }) => method === "channelSnapshotSession.count")
      .length;
  await f.api.trackChannelSnapshotVisit(
    tracking({ visitorType: "REAL", timeOnPage: 12000, scrollDepth: 80 }),
  );
  await f.api.trackChannelSnapshotVisit(
    tracking({ visitorType: "BOT", timeOnPage: 3000, scrollDepth: 10 }),
  );
  assert.equal(f.state.visits[0].visitorType, "REAL");
  assert.equal(f.state.visits[0].timeOnPage, 12000);
  assert.equal(f.state.visits[0].scrollDepth, 80);
  assert.equal(countQueries(), 1);
  await f.api.trackChannelSnapshotVisit(
    tracking({ visitorType: "BOT", timeOnPage: 12001 }),
  );
  assert.equal(f.state.visits[0].visitorType, "BOT");
  assert.equal(
    countQueries(),
    1,
    "Losing eligibility cannot overflow a target",
  );
  await f.api.trackChannelSnapshotVisit(
    tracking({ visitorType: "ZOMBIE", timeOnPage: 12002 }),
  );
  assert.equal(f.state.visits[0].visitorType, "ZOMBIE");
  assert.equal(countQueries(), 2, "Re-acquiring human eligibility is counted");
  await f.api.trackChannelSnapshotVisit(
    tracking({ visitorType: "REAL", timeOnPage: 12002 }),
  );
  assert.equal(f.state.visits[0].visitorType, "REAL");
  assert.equal(countQueries(), 2);
});

test("concurrent target admissions serialize on the explicit snapshot lock and never overrun the target", async () => {
  for (const completionMode of ["HUMAN_SESSIONS", "TOTAL_SESSIONS"]) {
    const f = fixture({
      snapshots: [snapshot({ completionMode, targetSessions: 2 })],
    });
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        f.api.trackChannelSnapshotVisit(
          tracking({
            sessionId: `browser-${index}`,
            acquisition: acquisition({ id: `acq_parallel_journey_${index}` }),
            visitorType:
              completionMode === "TOTAL_SESSIONS"
                ? "BOT"
                : index % 2
                  ? "ZOMBIE"
                  : "REAL",
          }),
        ),
      ),
    );
    assert.equal(results.filter(Boolean).length, 2);
    assert.equal(f.state.sessions.length, 2);
    assert.equal(f.state.visits.length, 2);
    assert.equal(f.state.snapshots[0].status, "COMPLETED");
    assert.equal(f.notifications.length, 1);
    assert.equal(f.lockEvents.length, 16);
    for (let index = 0; index < f.lockEvents.length; index += 2) {
      assert.equal(f.lockEvents[index].event, "acquired");
      assert.equal(f.lockEvents[index + 1].event, "released");
    }
  }
});

test("concurrent same-session heartbeats deduplicate and count a pending-to-human promotion only once", async () => {
  const f = fixture({ snapshots: [snapshot({ targetSessions: 2 })] });
  await f.api.trackChannelSnapshotVisit(tracking({ visitorType: "PENDING" }));
  const results = await Promise.all(
    [9000, 2000, 8000, 12000].map((timeOnPage) =>
      f.api.trackChannelSnapshotVisit(
        tracking({
          timeOnPage,
          scrollDepth: timeOnPage / 200,
          visitorType: timeOnPage < 5000 ? "BOT" : "REAL",
        }),
      ),
    ),
  );
  assert.ok(results.every(Boolean));
  assert.equal(f.state.sessions.length, 1);
  assert.equal(f.state.visits.length, 1);
  assert.equal(f.state.visits[0].visitorType, "REAL");
  assert.equal(f.state.visits[0].timeOnPage, 12000);
  assert.equal(f.state.visits[0].scrollDepth, 60);
  assert.equal(
    f.calls.filter(({ method }) => method === "channelSnapshotSession.count")
      .length,
    1,
  );
});

test("a capture queued behind pause or completion cannot write after the lifecycle transition", async () => {
  for (const action of ["pause", "complete"]) {
    const f = fixture();
    const locked = deferred();
    const release = deferred();
    const original = f.db.$queryRaw;
    let holdFirstLock = true;
    f.db.$queryRaw = async (parts, ...values) => {
      if (parts.join("?").includes("FOR UPDATE") && holdFirstLock) {
        holdFirstLock = false;
        locked.resolve();
        await release.promise;
      }
      return original(parts, ...values);
    };
    const transition = f.api.transitionChannelSnapshot(
      SHOP,
      "snapshot-a",
      action,
    );
    await locked.promise;
    const capture = f.api.trackChannelSnapshotVisit(tracking());
    release.resolve();
    await transition;
    assert.equal(await capture, false);
    assert.equal(f.state.sessions.length, 0);
    assert.equal(f.state.visits.length, 0);
    assert.equal(
      f.state.snapshots[0].status,
      action === "pause" ? "PAUSED" : "COMPLETED",
    );
  }
});

test("expired time-window direct capture is a no-write rejection until a lifecycle reader finalizes it", async () => {
  const f = fixture({
    snapshots: [
      snapshot({
        completionMode: "TIME_WINDOW",
        targetSessions: null,
        endsAt: new Date(BASE_TIME),
      }),
    ],
  });
  const before = clone(f.state);
  assert.equal(await f.api.getActiveChannelSnapshot(SHOP), null);
  assert.equal(await f.api.trackChannelSnapshotVisit(tracking()), false);
  assert.deepEqual(f.state, before);
  assert.equal(f.notifications.length, 0);
  assert.ok(
    f.calls.every(
      ({ method }) => !/\.(create|update|updateMany|upsert)$/.test(method),
    ),
  );
  await f.api.listChannelSnapshots(SHOP);
  assert.equal(f.state.snapshots[0].status, "COMPLETED");
  assert.equal(f.notifications.length, 1);
});

test("a heartbeat that crosses the deadline while waiting on the snapshot lock is rejected without writes", async () => {
  const f = fixture({
    snapshots: [
      snapshot({
        completionMode: "TIME_WINDOW",
        targetSessions: null,
        endsAt: new Date(BASE_TIME + 1000),
      }),
    ],
  });
  const locked = deferred();
  const release = deferred();
  const holder = f.db.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM "ChannelSnapshot" WHERE id = ${"snapshot-a"} AND shop = ${SHOP} FOR UPDATE`;
    locked.resolve();
    await release.promise;
  });
  await locked.promise;
  const before = clone(f.state);
  const capture = f.api.trackChannelSnapshotVisit(tracking());
  f.clock.now += 1000;
  release.resolve();
  await holder;
  assert.equal(await capture, false);
  assert.deepEqual(f.state, before);
  assert.equal(f.notifications.length, 0);
});

test("explicit Unknown acquisition keeps null source fields instead of importing internal page attribution", async () => {
  const f = fixture();
  await f.api.trackChannelSnapshotVisit(
    tracking({
      acquisition: acquisition({
        sourceCategory: "Unknown",
        source: null,
        medium: null,
        campaign: null,
      }),
      source: "homepage-banner",
      medium: "internal-promo",
      campaign: "not-an-arrival",
      sourceCategory: "Internal",
    }),
  );
  assert.equal(f.state.sessions[0].channel, "Unknown");
  assert.equal(f.state.sessions[0].source, null);
  assert.equal(f.state.sessions[0].medium, null);
  assert.equal(f.state.sessions[0].campaign, null);
});

test("legacy internal first pages remain Unknown and recent legacy journeys retain their known source", async () => {
  const unknown = fixture();
  await unknown.api.trackChannelSnapshotVisit(
    tracking({ acquisition: undefined }),
  );
  assert.equal(unknown.state.sessions[0].channel, "Unknown");
  assert.equal(unknown.state.sessions[0].source, null);
  assert.equal(unknown.state.sessions[0].landingPath, null);
  const f = fixture();
  await f.api.trackChannelSnapshotVisit(
    tracking({
      acquisition: undefined,
      sourceCategory: "Organic Search",
      source: "google",
    }),
  );
  f.clock.now += 5000;
  await f.api.trackChannelSnapshotVisit(
    tracking({
      acquisition: undefined,
      pageViewId: "page-2",
      sourceCategory: "Internal",
      source: "shop.example",
    }),
  );
  assert.equal(f.state.sessions.length, 1);
  assert.equal(f.state.sessions[0].channel, "Organic Search");
  assert.equal(f.state.sessions[0].source, "google");
});

test("capture rejects wrong tenants/status/time and blocks acquisition ID reuse by another tracking session", async () => {
  for (const input of [
    tracking({ shop: OTHER_SHOP }),
    tracking({ snapshotId: "missing" }),
    tracking({ sessionId: "" }),
    tracking({ pageViewId: "" }),
    tracking({ startedAt: BASE_TIME + 60_001 }),
    tracking({ startedAt: BASE_TIME - 60_001 }),
  ]) {
    const f = fixture();
    assert.equal(await f.api.trackChannelSnapshotVisit(input), false);
    assert.equal(f.state.sessions.length, 0);
  }
  for (const status of ["PAUSED", "COMPLETED"]) {
    const f = fixture({ snapshots: [snapshot({ status })] });
    assert.equal(await f.api.trackChannelSnapshotVisit(tracking()), false);
  }
  const f = fixture();
  await f.api.trackChannelSnapshotVisit(tracking());
  const before = clone(f.state);
  await assert.rejects(
    f.api.trackChannelSnapshotVisit(tracking({ sessionId: "other-browser" })),
    (error) => error instanceof f.api.ChannelSnapshotError,
  );
  assert.deepEqual(
    f.state,
    before,
    "Rejected acquisition reuse must roll back any heartbeat update",
  );
});

test("human completion counts real plus zombie acquisition sessions, excludes bots, and stops further admission", async () => {
  const f = fixture({ snapshots: [snapshot({ targetSessions: 2 })] });
  await f.api.trackChannelSnapshotVisit(tracking());
  await f.api.trackChannelSnapshotVisit(
    tracking({
      sessionId: "bot-browser",
      acquisition: acquisition({ id: "acq_bot_journey_123" }),
      visitorType: "BOT",
    }),
  );
  assert.equal(f.state.snapshots[0].status, "ACTIVE");
  await f.api.trackChannelSnapshotVisit(
    tracking({
      sessionId: "zombie-browser",
      acquisition: acquisition({ id: "acq_zombie_journey_123" }),
      visitorType: "ZOMBIE",
    }),
  );
  assert.equal(f.state.snapshots[0].status, "COMPLETED");
  assert.equal(f.notifications.length, 1);
  assert.equal(
    await f.api.trackChannelSnapshotVisit(
      tracking({
        sessionId: "extra-browser",
        acquisition: acquisition({ id: "acq_extra_journey_123" }),
      }),
    ),
    false,
  );
  const result = await f.api.getChannelSnapshotReport(SHOP, "snapshot-a");
  assert.equal(result.summary.sessions, 3);
  assert.equal(result.progress.current, 2);
  assert.equal(result.progress.percent, 100);
});

test("total-session completion includes bots while duration captures expire at their configured end", async () => {
  const total = fixture({
    snapshots: [
      snapshot({ completionMode: "TOTAL_SESSIONS", targetSessions: 1 }),
    ],
  });
  await total.api.trackChannelSnapshotVisit(tracking({ visitorType: "BOT" }));
  assert.equal(total.state.snapshots[0].status, "COMPLETED");
  assert.equal(
    (await total.api.getChannelSnapshotReport(SHOP, "snapshot-a")).progress
      .current,
    1,
  );
  const timed = fixture({
    snapshots: [
      snapshot({
        completionMode: "TIME_WINDOW",
        targetSessions: null,
        durationDays: 1,
        endsAt: new Date(BASE_TIME + 1000),
      }),
    ],
  });
  await timed.api.trackChannelSnapshotVisit(tracking());
  assert.equal(timed.state.snapshots[0].status, "ACTIVE");
  timed.clock.now += 1000;
  assert.equal(await timed.api.getActiveChannelSnapshot(SHOP), null);
  assert.equal(timed.state.snapshots[0].status, "ACTIVE");
  assert.equal(timed.notifications.length, 0);
  await timed.api.getChannelSnapshotReport(SHOP, "snapshot-a");
  assert.equal(
    timed.state.snapshots[0].completedAt.getTime(),
    BASE_TIME + 1000,
  );
  assert.equal(timed.notifications.length, 1);
});

test("missing and null event/page timestamps default to now rather than Unix epoch", async () => {
  for (const timestamp of [null, undefined, ""]) {
    const f = fixture();
    assert.equal(
      await f.api.trackChannelSnapshotVisit(tracking({ startedAt: timestamp })),
      true,
    );
    assert.equal(f.state.sessions[0].startedAt.getTime(), BASE_TIME);
    assert.equal(
      await f.api.attributeChannelSnapshotEvent({
        shop: SHOP,
        sessionId: "legacy-browser",
        timestamp,
        event: "conversion",
      }),
      1,
    );
    assert.equal(f.state.sessions[0].convertedAt.getTime(), BASE_TIME);
  }
});

test("a journey captured by a newer independent snapshot gets its own snapshot-scoped session", async () => {
  const f = fixture({
    snapshots: [
      snapshot({ status: "PAUSED" }),
      snapshot({ id: "snapshot-b", startedAt: new Date(BASE_TIME - 1000) }),
    ],
    sessions: [session()],
  });
  await f.api.trackChannelSnapshotVisit(
    tracking({
      snapshotId: "snapshot-b",
      acquisition: acquisition({ startedAt: BASE_TIME - 120_000 }),
    }),
  );
  assert.equal(f.state.sessions.length, 2);
  const next = f.state.sessions.find(
    (value) => value.channelSnapshotId === "snapshot-b",
  );
  assert.equal(next.acquisitionId, "acq_regression_journey_123");
  assert.equal(next.acquiredAt.getTime(), BASE_TIME - 120_000);
  assert.equal(next.startedAt.getTime(), BASE_TIME);
  assert.equal(f.state.visits[0].sessionId, next.id);
  assert.equal(
    (await f.api.getChannelSnapshotReport(SHOP, "snapshot-b")).summary.sessions,
    1,
  );
});

test("conversion retries always select the same latest session before conversion flags", async () => {
  const f = fixture({
    snapshots: [snapshot(), snapshot({ id: "foreign", shop: OTHER_SHOP })],
    sessions: [
      session({
        id: "older",
        acquisitionId: "acq_old_journey_123",
        startedAt: new Date(BASE_TIME - 120_000),
      }),
      session({
        id: "latest",
        acquisitionId: "acq_new_journey_123",
        startedAt: new Date(BASE_TIME - 60_000),
      }),
      session({
        id: "foreign-session",
        channelSnapshotId: "foreign",
        startedAt: new Date(BASE_TIME - 1000),
      }),
    ],
  });
  const event = {
    shop: SHOP,
    sessionId: "legacy-browser",
    timestamp: BASE_TIME,
    event: "conversion",
  };
  assert.equal(await f.api.attributeChannelSnapshotEvent(event), 1);
  f.clock.now += 1000;
  assert.equal(
    await f.api.attributeChannelSnapshotEvent({
      ...event,
      timestamp: f.clock.now,
    }),
    1,
  );
  assert.equal(
    f.state.sessions.find((value) => value.id === "latest").converted,
    true,
  );
  assert.equal(
    f.state.sessions
      .find((value) => value.id === "latest")
      .convertedAt.getTime(),
    BASE_TIME,
  );
  assert.equal(
    f.state.sessions.find((value) => value.id === "older").converted,
    false,
  );
  assert.equal(
    f.state.sessions.find((value) => value.id === "foreign-session").converted,
    false,
  );
  const selections = f.calls.filter(
    (call) => call.method === "channelSnapshotSession.findMany",
  );
  assert.ok(
    selections.every((call) => !Object.hasOwn(call.args.where, "converted")),
  );
  assert.ok(
    selections.every((call) => call.args.where.channelSnapshot.shop === SHOP),
  );
});

test("exact acquisition commerce attribution never moves conversion to a different journey or tenant", async () => {
  const f = fixture({
    snapshots: [snapshot(), snapshot({ id: "foreign", shop: OTHER_SHOP })],
    sessions: [
      session({
        id: "older",
        acquisitionId: "acq_old_journey_123",
        startedAt: new Date(BASE_TIME - 120_000),
      }),
      session({ id: "latest", acquisitionId: "acq_new_journey_123" }),
      session({
        id: "foreign-session",
        channelSnapshotId: "foreign",
        acquisitionId: "acq_old_journey_123",
      }),
    ],
  });
  for (const event of ["add_to_cart", "checkout_started", "conversion"]) {
    assert.equal(
      await f.api.attributeChannelSnapshotEvent({
        shop: SHOP,
        sessionId: "legacy-browser",
        acquisitionSessionId: "acq_old_journey_123",
        timestamp: BASE_TIME,
        event,
      }),
      1,
    );
  }
  const old = f.state.sessions.find((value) => value.id === "older");
  assert.equal(old.addedToCart, true);
  assert.equal(old.checkoutStarted, true);
  assert.equal(old.converted, true);
  assert.ok(
    f.state.sessions
      .filter((value) => value.id !== "older")
      .every(
        (value) =>
          !value.converted && !value.checkoutStarted && !value.addedToCart,
      ),
  );
  assert.equal(
    await f.api.attributeChannelSnapshotEvent({
      shop: SHOP,
      sessionId: "legacy-browser",
      acquisitionSessionId: "acq_missing_journey_123",
      timestamp: BASE_TIME,
      event: "conversion",
    }),
    0,
  );
});

test("commerce attribution rejects missing tenant, future timestamps and sessions outside allowed windows", async () => {
  const f = fixture({
    sessions: [
      session({
        lastSeenAt: new Date(BASE_TIME - 31 * 86_400_000),
        startedAt: new Date(BASE_TIME - 31 * 86_400_000),
      }),
    ],
  });
  for (const input of [
    { shop: null },
    { sessionId: "" },
    { timestamp: BASE_TIME + 300_001 },
  ]) {
    assert.equal(
      await f.api.attributeChannelSnapshotEvent({
        shop: SHOP,
        sessionId: "legacy-browser",
        timestamp: BASE_TIME,
        event: "conversion",
        ...input,
      }),
      0,
    );
  }
  assert.equal(
    await f.api.attributeChannelSnapshotEvent({
      shop: SHOP,
      sessionId: "legacy-browser",
      timestamp: BASE_TIME,
      event: "conversion",
    }),
    0,
  );
  const staleCart = fixture({
    sessions: [
      session({
        lastSeenAt: new Date(BASE_TIME - 31 * 60_000),
        startedAt: new Date(BASE_TIME - 31 * 60_000),
      }),
    ],
  });
  assert.equal(
    await staleCart.api.attributeChannelSnapshotEvent({
      shop: SHOP,
      sessionId: "legacy-browser",
      timestamp: BASE_TIME,
      event: "add_to_cart",
    }),
    0,
  );
  assert.equal(
    await staleCart.api.attributeChannelSnapshotEvent({
      shop: SHOP,
      sessionId: "legacy-browser",
      timestamp: BASE_TIME,
      event: "conversion",
    }),
    1,
  );
});

test("report progress remains global while campaign filters change the visible summary", async () => {
  const f = fixture({
    sessions: [
      session({ id: "s1", campaign: "one" }),
      session({
        id: "s2",
        acquisitionId: "acq_second_journey_123",
        campaign: "two",
      }),
    ],
    visits: [
      {
        id: "v1",
        sessionId: "s1",
        pageViewId: "page-1",
        visitorType: "REAL",
        timeOnPage: 5000,
        scrollDepth: 20,
      },
      {
        id: "v2",
        sessionId: "s2",
        pageViewId: "page-2",
        visitorType: "ZOMBIE",
        timeOnPage: 2000,
        scrollDepth: 10,
      },
    ],
  });
  const filtered = await f.api.getChannelSnapshotReport(SHOP, "snapshot-a", {
    campaign: "one",
  });
  assert.equal(filtered.summary.sessions, 1);
  assert.equal(filtered.progress.current, 2);
  assert.equal(filtered.capturedSessions, 2);
});

test("API engagement and commerce wiring preserve acquisition IDs and explicit tenant scope", () => {
  const source = readFileSync(
    new URL("../app/routes/api.track.tsx", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "api.track.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const calls = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ["trackChannelSnapshotVisit", "attributeChannelSnapshotEvent"].includes(
        node.expression.getText(ast),
      )
    ) {
      const argument = node.arguments[0];
      assert.ok(ts.isObjectLiteralExpression(argument));
      const fields = Object.fromEntries(
        argument.properties.map((property) => [
          property.name?.getText(ast),
          ts.isPropertyAssignment(property)
            ? property.initializer.getText(ast)
            : property.name?.getText(ast),
        ]),
      );
      calls.push({ name: node.expression.getText(ast), fields });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const engagement = calls.filter(
    (call) => call.name === "trackChannelSnapshotVisit",
  );
  assert.equal(engagement.length, 1);
  assert.equal(engagement[0].fields.shop, "trackingShop");
  assert.equal(engagement[0].fields.acquisition, "data.acquisition");
  assert.equal(engagement[0].fields.snapshotId, "activeChannelSnapshot.id");
  const events = calls.filter(
    (call) => call.name === "attributeChannelSnapshotEvent",
  );
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((call) => JSON.parse(call.fields.event)).sort(), [
    "add_to_cart",
    "checkout_started",
    "conversion",
  ]);
  assert.ok(
    events.every(
      (call) =>
        call.fields.acquisitionSessionId === "data.acquisitionSessionId" &&
        call.fields.shop === "channelShop",
    ),
  );
  assert.match(
    source,
    /!activeSnapshot\s*&&\s*!activeStoreSnapshot\s*&&\s*!activeChannelSnapshot/,
    "Channel-only captures must pass the independent capture guard",
  );
});

test("paid-order webhook forwards verified shop and exact cart acquisition before focused-product early exits", () => {
  const source = readFileSync(
    new URL("../app/routes/webhooks.orders.paid.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /authenticate\.webhook\(request\)/);
  assert.match(
    source,
    /getAttributeValue\(order\.note_attributes,\s*"_mw_csid"\)/,
  );
  assert.match(
    source,
    /getAttributeValue\(order\.custom_attributes,\s*"_mw_csid"\)/,
  );
  assert.match(
    source,
    /attributeChannelSnapshotEvent\(\{\s*shop,\s*sessionId,\s*acquisitionSessionId,/,
  );
  assert.ok(
    source.indexOf("await attributeChannelSnapshotEvent(") <
      source.indexOf("if (lineItems.length === 0)"),
  );
});

test("schema and migration enforce one active capture per shop plus session/page deduplication", () => {
  const schema = readFileSync(
    new URL("../prisma/schema.prisma", import.meta.url),
    "utf8",
  );
  const migration = readFileSync(
    new URL(
      "../prisma/migrations/20260826000000_add_channel_snapshots/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(schema, /@@unique\(\[channelSnapshotId,\s*acquisitionId\]\)/);
  assert.match(schema, /@@unique\(\[sessionId,\s*pageViewId\]\)/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX[^;]+ON "ChannelSnapshot"\s*\("shop"\)\s*WHERE "status"\s*=\s*'ACTIVE'/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX[^;]+ON "ChannelSnapshotSession"\s*\("channelSnapshotId",\s*"acquisitionId"\)/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX[^;]+ON "ChannelSnapshotVisit"\s*\("sessionId",\s*"pageViewId"\)/,
  );
});
