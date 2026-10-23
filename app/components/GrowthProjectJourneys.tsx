import { useState } from "react";
import { Banner, Button, Card, Text } from "@shopify/polaris";
import { useI18n } from "../utils/i18n";
import { useBackgroundJson } from "../utils/background-json";
import type { GrowthReportFilters } from "../utils/growth-report";

type Journey = {
  id: string;
  source: string;
  medium: string;
  campaign: string;
  startedAt: string;
  lastSeenAt: string;
  visitorType: string;
  addedToCart: boolean;
  converted: boolean;
  pageCount: number;
  eventCount: number;
  detailUrl: string;
};
type Payload = {
  sessions: Journey[];
  total: number;
  page: number;
  pageCount: number;
};
const isPayload = (value: unknown): value is Payload =>
  Boolean(
    value &&
    typeof value === "object" &&
    Array.isArray((value as Payload).sessions) &&
    Number.isFinite((value as Payload).total),
  );

export function GrowthProjectJourneys({
  shop,
  projectId,
  measurementId,
  filters,
}: {
  shop: string;
  projectId: string;
  measurementId: string;
  filters: GrowthReportFilters;
}) {
  const { t, formatNumber, formatDate } = useI18n();
  const filterKey = JSON.stringify([projectId, measurementId, filters]);
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const page = paging.key === filterKey ? paging.page : 1;
  const query = new URLSearchParams({
    projectId,
    measurement: measurementId,
    ...filters,
    page: String(page),
  });
  const { data, loading, error, reload } = useBackgroundJson<Payload>({
    path: `/api/project-journeys?${query}`,
    scopeKey: shop,
    isData: isPayload,
    errorMessage: t("Journeys could not load. Please retry."),
  });
  const move = (next: number) => setPaging({ key: filterKey, page: next });
  return (
    <Card>
      <div className="gp-heading">
        <Text as="h2" variant="headingMd">
          {t("Recorded journeys")}
        </Text>
        <Button onClick={reload} loading={loading}>
          {t("Refresh")}
        </Button>
      </div>
      <p className="gp-muted">
        {t(
          "These journeys use the same audience and source filters as the measurement above. Each row is one recorded session, not a lifetime customer profile.",
        )}
      </p>
      {error && <Banner tone="warning">{error}</Banner>}
      {!data ? (
        <div className="gp-empty" role="status">
          {t(loading ? "Loading journeys…" : "No journeys available.")}
        </div>
      ) : (
        <>
          <div className="gp-table-wrap">
            <table className="gp-table">
              <thead>
                <tr>
                  {[
                    "Started",
                    "Source",
                    "Medium",
                    "Campaign",
                    "Pages visited",
                    "Events",
                    "Added to cart",
                    "Purchased",
                    "Actions",
                  ].map((label) => (
                    <th key={label}>{t(label)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((session) => (
                  <tr key={session.id}>
                    <td>
                      {formatDate(session.startedAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                    <td>{session.source || "—"}</td>
                    <td>{session.medium || "—"}</td>
                    <td>{session.campaign || "—"}</td>
                    <td>{formatNumber(session.pageCount)}</td>
                    <td>{formatNumber(session.eventCount)}</td>
                    <td>{t(session.addedToCart ? "Yes" : "No")}</td>
                    <td>{t(session.converted ? "Yes" : "No")}</td>
                    <td>
                      <Button url={session.detailUrl}>
                        {t("View journey")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.sessions.length && (
            <div className="gp-empty">
              {t("No journeys match these filters.")}
            </div>
          )}
          <div className="gp-pagination">
            <span className="gp-muted">
              {data.total === 1
                ? t("1 recorded session")
                : t("{count} recorded sessions", {
                    count: formatNumber(data.total),
                  })}
            </span>
            <Button
              disabled={loading || data.page <= 1}
              onClick={() => move(data.page - 1)}
            >
              {t("Previous")}
            </Button>
            <span>
              {t("Page {page} of {pages}", {
                page: formatNumber(data.page),
                pages: formatNumber(Math.max(1, data.pageCount)),
              })}
            </span>
            <Button
              disabled={loading || data.page >= data.pageCount}
              onClick={() => move(data.page + 1)}
            >
              {t("Next")}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
