import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const module = { exports: {} };
const progress = {
  rangeStart: "2026-10-01",
  rangeEnd: "2026-10-22",
  status: "ready",
  currentSessions: 1000,
  currentRate: 2,
};
runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL("../app/utils/growth-metrics.server.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  {
    module,
    exports: module.exports,
    require: (id) => {
      if (id === "./loader-cache.server")
        return { cachedValue: (_key, _ttl, load) => load() };
      if (id === "./shopify-analytics.server")
        return { getShopifyConversionProgress: async () => progress };
      throw new Error(id);
    },
  },
);
const { analyticsRows, analyticsNumber, getGrowthMetrics } = module.exports;
assert.equal(
  analyticsRows({ columns: [{ name: "orders" }], rows: [[2]] })[0].orders,
  2,
);
assert.equal(analyticsRows({ rows: '[{"orders":3}]' })[0].orders, 3);
assert.equal(analyticsRows({ rows: "bad json" }).length, 0);
for (const value of [null, undefined, "", "unknown", Infinity])
  assert.equal(analyticsNumber(value), null);
assert.equal(analyticsNumber("25.75"), 25.75);
assert.equal(analyticsNumber(0), 0);
const calls = [];
const admin = {
  graphql: async (query, options) => {
    calls.push(options?.variables?.query || query);
    if (query.includes("ProjectGrowthCurrency"))
      return Response.json({ data: { shop: { currencyCode: "EUR" } } });
    return Response.json({
      data: {
        shopifyqlQuery: {
          tableData: {
            rows: options.variables.query.includes("TIMESERIES")
              ? [
                  {
                    day: "2026-10-22",
                    average_order_value: "50.25",
                    amount_spent_per_customer: "125.50",
                  },
                ]
              : [
                  {
                    average_order_value: "50.25",
                    amount_spent_per_customer: "125.50",
                    orders: 2,
                  },
                ],
          },
          parseErrors: [],
        },
      },
    });
  },
};
const result = await getGrowthMetrics({
  shop: "fixture.myshopify.com",
  admin,
  sessionScope: "read_reports",
  period: "month",
});
assert.equal(result.sales.aov, 50.25);
assert.equal(result.sales.ltv, 125.5);
assert.equal(result.sales.currency, "EUR");
assert.equal(result.sales.series.length, 1);
assert.ok(
  calls.some((query) => query.includes("WHERE sales_channel = 'Online Store'")),
);
assert.ok(
  calls.some((query) => query.includes("amount_spent_per_customer")),
  "Observed customer lifetime spend, not AOV relabelled LTV",
);
assert.equal(
  (
    await getGrowthMetrics({
      shop: "fixture.myshopify.com",
      admin,
      sessionScope: "",
      period: "month",
    })
  ).sales,
  null,
);
const denied = await getGrowthMetrics({
  shop: "fixture.myshopify.com",
  admin: {
    graphql: async () =>
      Response.json({ errors: [{ message: "Not allowed" }] }),
  },
  sessionScope: "read_reports",
  period: "month",
});
assert.equal(denied.sales, null);
assert.equal(
  denied.progress.currentRate,
  2,
  "Unavailable sales must not erase working CVR",
);
console.log(
  "PASS: growth metric parsing, actual zero vs unavailable, Shopify query metrics, online-store sales scope, permissions and partial failure isolation",
);
