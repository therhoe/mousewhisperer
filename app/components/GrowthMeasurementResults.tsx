import { useState } from "react";
import { Banner, Button, Card, Text } from "@shopify/polaris";
import { useI18n } from "../utils/i18n";
import { useBackgroundJson } from "../utils/background-json";
import { GrowthLineChart } from "./GrowthOverviewCard";
import type { GrowthReport, GrowthReportFilters } from "../utils/growth-report";
import { EngagementOutcomesView } from "./EngagementOutcomes";
type Payload = { report: GrowthReport; comparison: GrowthReport | null };
const isPayload = (value: unknown): value is Payload =>
  !!value &&
  typeof value === "object" &&
  "report" in value &&
  typeof (value as Payload).report?.sessions === "number";
export function GrowthMeasurementResults({
  shop,
  projectId,
  measurementId,
  comparisonId,
  filters,
}: {
  shop: string;
  projectId: string;
  measurementId: string;
  comparisonId: string;
  filters: GrowthReportFilters;
}) {
  const { t, formatNumber } = useI18n();
  const [channelPage, setChannelPage] = useState(0);
  const query = new URLSearchParams({
    projectId,
    measurement: measurementId,
    compare: comparisonId,
    ...filters,
  });
  const { data, loading, error, reload } = useBackgroundJson<Payload>({
    path: `/api/growth-report?${query}`,
    scopeKey: shop,
    isData: isPayload,
    errorMessage: t("Measurement results could not load. Please retry."),
  });
  const report = data?.report;
  const count = (value: number) => formatNumber(value);
  const percent = (value: number) =>
    `${formatNumber(value, { maximumFractionDigits: 2 })}%`;
  const pages = Math.max(1, Math.ceil((report?.channels.length || 0) / 10));
  const page = Math.min(channelPage, pages - 1);
  return (
    <div className="gp-stack" style={{ paddingBottom: 0 }}>
      <Card>
        <div className="gp-heading">
          <Text as="h2" variant="headingMd">
            {t("Measurement results")}
          </Text>
          <Button onClick={reload} loading={loading}>
            {t("Refresh")}
          </Button>
        </div>
        {error && <Banner tone="warning">{error}</Banner>}
        {!report ? (
          <div className="gp-empty" role="status">
            {t(loading ? "Loading results…" : "No results available.")}
          </div>
        ) : (
          <>
            <div className="gp-grid" style={{ marginTop: 20 }}>
              {[
                { label: t("Sessions"), value: count(report.sessions) },
                {
                  label: t("Added to cart"),
                  value: count(report.addedToCart),
                  hint: percent(report.atcRate),
                },
                {
                  label: t("Converted sessions"),
                  value: count(report.conversions),
                },
                {
                  label: t(
                    filters.audience === "active"
                      ? "Active-session CVR"
                      : "Conversion rate",
                  ),
                  value: percent(report.conversionRate),
                },
              ].map((item) => (
                <div className="gp-metric" key={item.label}>
                  <span>{item.label}</span>
                  <strong className="gp-value">{item.value}</strong>
                  {item.hint && <span className="gp-muted">{item.hint}</span>}
                </div>
              ))}
            </div>
            <GrowthLineChart
              title={t("Conversion rate over time")}
              percent
              points={report.series.map((point) => ({
                date: point.date,
                value: point.conversionRate,
              }))}
            />
            {data.comparison && (
              <div className="gp-note">
                <strong>{t("Before / after comparison")}</strong>
                <p>
                  {t("Comparison CVR")}:{" "}
                  {percent(data.comparison.conversionRate)} →{" "}
                  {percent(report.conversionRate)} (
                  {formatNumber(
                    report.conversionRate - data.comparison.conversionRate,
                    { signDisplay: "always", maximumFractionDigits: 2 },
                  )}{" "}
                  {t("percentage points")})
                </p>
                <p className="gp-muted">
                  {t(
                    "Both measurements use the same filters. A before/after change is not proof of causal lift; use an A/B test for that.",
                  )}
                </p>
              </div>
            )}
            <p className="gp-muted">
              {t(
                "Active excludes suspected bots, low-engagement sessions and unclassified sessions. All includes every recorded session. Rates always use the selected audience.",
              )}
            </p>
          </>
        )}
      </Card>
      {report?.engagement && report.engagement.groups.length > 0 && (
        <Card>
          <Text as="h2" variant="headingMd">
            {t("Engagement by zone")}
          </Text>
          <EngagementOutcomesView
            data={report.engagement}
            audience={t(
              filters.audience === "active"
                ? "Active sessions"
                : "All recorded sessions",
            )}
            totals={Object.fromEntries(
              report.engagement.groups.map((group) => [
                group.category,
                group.items.reduce((sum, item) => sum + item.clicks, 0),
              ]),
            )}
          />
        </Card>
      )}
      {report?.engagementUnavailable && (
        <Banner tone="info">
          {t(
            "Engagement details are too large for this view. Narrow the source filters. Summary totals still include the full selected audience.",
          )}
        </Banner>
      )}
      {report && (
        <Card>
          <Text as="h2" variant="headingMd">
            {t("Traffic by source")}
          </Text>
          <div className="gp-table-wrap">
            <table className="gp-table">
              <thead>
                <tr>
                  {[
                    "Source",
                    "Medium",
                    "Campaign",
                    "Sessions",
                    "Added to cart",
                    "Conversions",
                    "Conversion rate",
                  ].map((label) => (
                    <th key={label}>{t(label)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.channels.slice(page * 10, page * 10 + 10).map((row) => (
                  <tr
                    key={JSON.stringify([row.source, row.medium, row.campaign])}
                  >
                    <td>{row.source}</td>
                    <td>{row.medium || "—"}</td>
                    <td>{row.campaign || "—"}</td>
                    <td>{count(row.sessions)}</td>
                    <td>{count(row.addedToCart)}</td>
                    <td>{count(row.conversions)}</td>
                    <td>{percent(row.conversionRate)}</td>
                  </tr>
                ))}
                {!report.channels.length && (
                  <tr>
                    <td colSpan={7}>{t("No sessions match these filters.")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="gp-pagination">
            <Button
              disabled={page === 0}
              onClick={() => setChannelPage(page - 1)}
            >
              {t("Previous")}
            </Button>
            <span>
              {t("Page {page} of {pages}", {
                page: count(page + 1),
                pages: count(pages),
              })}
            </span>
            <Button
              disabled={page + 1 >= pages}
              onClick={() => setChannelPage(page + 1)}
            >
              {t("Next")}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
