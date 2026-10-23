import { useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  InlineStack,
  Pagination,
  Text,
} from "@shopify/polaris";
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
  onOpenJourney,
}: {
  shop: string;
  projectId: string;
  measurementId: string;
  filters: GrowthReportFilters;
  onOpenJourney: (url: string) => void;
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
    <Card padding="0">
      <Box padding="400" paddingBlockEnd="200">
        <InlineStack align="space-between" blockAlign="center" gap="200">
          <BlockStack gap="050">
            <Text as="h2" variant="headingMd">
              {t("Customer journeys")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("Each row is one visit, using the filters above.")}
            </Text>
          </BlockStack>
          <Button variant="tertiary" onClick={reload} loading={loading}>
            {t("Refresh")}
          </Button>
        </InlineStack>
      </Box>
      {error && (
        <Box paddingInline="400" paddingBlockEnd="300">
          <Banner tone="warning">{error}</Banner>
        </Box>
      )}
      {!data ? (
        <Box padding="400">
          <div role="status">
            <Text as="p" tone="subdued">
              {t(loading ? "Loading journeys…" : "No journeys available.")}
            </Text>
          </div>
        </Box>
      ) : !data.sessions.length ? (
        <Box padding="400">
          <Text as="p" tone="subdued">
            {t("No journeys match these filters.")}
          </Text>
        </Box>
      ) : (
        <DataTable
          columnContentTypes={[
            "text",
            "text",
            "numeric",
            "numeric",
            "text",
            "text",
            "text",
          ]}
          headings={[
            t("Started"),
            t("Source"),
            t("Pages visited"),
            t("Events"),
            t("Added to cart"),
            t("Purchased"),
            "",
          ]}
          rows={data.sessions.map((session) => [
            formatDate(session.startedAt, {
              dateStyle: "medium",
              timeStyle: "short",
            }),
            [session.source, session.medium, session.campaign]
              .filter(Boolean)
              .join(" / ") || "—",
            formatNumber(session.pageCount),
            formatNumber(session.eventCount),
            session.addedToCart ? (
              <Badge tone="info">{t("Yes")}</Badge>
            ) : (
              t("No")
            ),
            session.converted ? (
              <Badge tone="success">{t("Yes")}</Badge>
            ) : (
              t("No")
            ),
            <Button
              key={session.id}
              onClick={() => onOpenJourney(session.detailUrl)}
              variant="plain"
            >
              {t("View journey")}
            </Button>,
          ])}
        />
      )}
      {data && (
        <Box padding="300">
          <InlineStack align="space-between" blockAlign="center" gap="200">
            <Text as="span" variant="bodySm" tone="subdued">
              {data.total === 1
                ? t("1 recorded session")
                : t("{count} recorded sessions", {
                    count: formatNumber(data.total),
                  })}
            </Text>
            {data.pageCount > 1 && (
              <Pagination
                hasPrevious={!loading && data.page > 1}
                onPrevious={() => move(data.page - 1)}
                hasNext={!loading && data.page < data.pageCount}
                onNext={() => move(data.page + 1)}
                label={t("Page {page} of {pages}", {
                  page: formatNumber(data.page),
                  pages: formatNumber(Math.max(1, data.pageCount)),
                })}
              />
            )}
          </InlineStack>
        </Box>
      )}
    </Card>
  );
}
