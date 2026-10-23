import { useEffect, useRef, useState } from "react";
import { useFetcher, useNavigate } from "@remix-run/react";
import { Modal as AppBridgeModal, TitleBar } from "@shopify/app-bridge-react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Card,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useI18n } from "../utils/i18n";
import type { GrowthReportFilters } from "../utils/growth-report";
import { GrowthMeasurementResults } from "./GrowthMeasurementResults";
import { GrowthProjectJourneys } from "./GrowthProjectJourneys";
import { ScopeBadge, StatusBadge } from "./GrowthProjectList";

export type SheetMeasurement = {
  id: string;
  name: string;
  status: string;
  customerSnapshotId?: string | null;
  customerSnapshot?: { captureAllSources?: boolean } | null;
  storeSnapshotId?: string | null;
  snapshot?: { usesAcquisitionSessions?: boolean } | null;
  storeSnapshot?: { usesAcquisitionSessions?: boolean } | null;
  reportUrl: string;
};

/**
 * Full-screen results for one Project measurement. It uses the same App Bridge
 * max modal as the A/B detail report, so results always open as a sheet.
 */
export function GrowthResultsSheet({
  open,
  onClose,
  shop,
  project,
  selected,
  comparison,
  filters,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  shop: string;
  project: {
    id: string;
    title: string;
    scope: string;
    journeyTracking: boolean;
    measurements: SheetMeasurement[];
  };
  selected: SheetMeasurement;
  comparison?: SheetMeasurement;
  filters: GrowthReportFilters;
  onChange: (values: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  // Modal content runs in its own frame, so an href would load the URL there
  // without the embedded session. Close the sheet and route the main app.
  const openInApp = (url: string) => {
    onClose();
    navigate(url);
  };
  const sources = useFetcher<{ sources: string[] }>();
  const loadSources = useRef(sources.load);
  useEffect(() => {
    if (open) loadSources.current("/api/project-sources");
  }, [open]);
  const [moreFilters, setMoreFilters] = useState(
    Boolean(filters.medium || filters.campaign),
  );
  const [medium, setMedium] = useState(filters.medium);
  const [campaign, setCampaign] = useState(filters.campaign);
  useEffect(() => {
    setMedium(filters.medium);
    setCampaign(filters.campaign);
  }, [filters.medium, filters.campaign]);
  const knownSources = Array.from(
    new Set([
      ...(sources.data?.sources || []),
      ...(filters.source ? [filters.source] : []),
    ]),
  );
  const filtered = Boolean(filters.source || filters.medium || filters.campaign);
  return (
    <AppBridgeModal
      id={`project-results-${project.id}`}
      open={open}
      variant="max"
      onHide={onClose}
    >
      <TitleBar title={t("Project results")} />
      {open && (
        <div
          style={{
            minHeight: "calc(100vh - 72px)",
            background: "var(--p-color-bg)",
            padding: "24px",
          }}
        >
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="start" gap="400">
                <BlockStack gap="200">
                  <Text as="h1" variant="headingXl">
                    {project.title}
                  </Text>
                  <InlineStack gap="200" blockAlign="center" wrap>
                    <ScopeBadge scope={project.scope} />
                    <StatusBadge status={selected.status} />
                    <Text as="span" tone="subdued">
                      {selected.name}
                    </Text>
                  </InlineStack>
                </BlockStack>
                <InlineStack gap="300" blockAlign="center">
                  <ButtonGroup variant="segmented">
                    {(["all", "active"] as const).map((value) => (
                      <Button
                        key={value}
                        pressed={filters.audience === value}
                        onClick={() => onChange({ audience: value })}
                      >
                        {t(value === "all" ? "All" : "Active")}
                      </Button>
                    ))}
                  </ButtonGroup>
                  <Button onClick={onClose}>{t("Close")}</Button>
                </InlineStack>
              </InlineStack>

              <Card>
                <BlockStack gap="300">
                  <InlineStack gap="300" blockAlign="end" wrap>
                    <div style={{ minWidth: 200, flex: "1 1 200px" }}>
                      <Select
                        label={t("Measurement")}
                        value={selected.id}
                        onChange={(value) =>
                          onChange({ measurement: value, compare: "" })
                        }
                        options={project.measurements.map((item) => ({
                          label: item.name,
                          value: item.id,
                        }))}
                      />
                    </div>
                    <div style={{ minWidth: 200, flex: "1 1 200px" }}>
                      <Select
                        label={t("Compare with")}
                        value={comparison?.id || ""}
                        onChange={(value) => onChange({ compare: value })}
                        options={[
                          { label: t("No comparison"), value: "" },
                          ...project.measurements
                            .filter((item) => item.id !== selected.id)
                            .map((item) => ({
                              label: item.name,
                              value: item.id,
                            })),
                        ]}
                      />
                    </div>
                    <div style={{ minWidth: 200, flex: "1 1 200px" }}>
                      <Select
                        label={t("Source")}
                        value={filters.source}
                        onChange={(value) => onChange({ source: value })}
                        options={[
                          { label: t("All sources"), value: "" },
                          ...knownSources.map((item) => ({
                            label: item,
                            value: item,
                          })),
                        ]}
                      />
                    </div>
                    <InlineStack gap="200">
                      <Button
                        disclosure={moreFilters ? "up" : "down"}
                        onClick={() => setMoreFilters(!moreFilters)}
                        ariaExpanded={moreFilters}
                      >
                        {t("More filters")}
                      </Button>
                      {filtered && (
                        <Button
                          variant="plain"
                          onClick={() =>
                            onChange({ source: "", medium: "", campaign: "" })
                          }
                        >
                          {t("Clear filters")}
                        </Button>
                      )}
                    </InlineStack>
                  </InlineStack>
                  {moreFilters && (
                    <InlineStack gap="300" blockAlign="end" wrap>
                      <div style={{ minWidth: 200, flex: "1 1 200px" }}>
                        <TextField
                          label={t("Medium")}
                          value={medium}
                          onChange={setMedium}
                          placeholder={t("All mediums")}
                          maxLength={100}
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ minWidth: 200, flex: "1 1 200px" }}>
                        <TextField
                          label={t("Campaign")}
                          value={campaign}
                          onChange={setCampaign}
                          placeholder={t("All campaigns")}
                          maxLength={240}
                          autoComplete="off"
                        />
                      </div>
                      <Button
                        onClick={() =>
                          onChange({
                            medium: medium.trim(),
                            campaign: campaign.trim(),
                          })
                        }
                      >
                        {t("Apply")}
                      </Button>
                    </InlineStack>
                  )}
                </BlockStack>
              </Card>

              {selected.customerSnapshot &&
                !selected.customerSnapshot.captureAllSources &&
                !selected.storeSnapshotId && (
                  <Banner tone="info">
                    {t(
                      "This older measurement only recorded the source it was set up with.",
                    )}
                  </Banner>
                )}
              {(selected.snapshot?.usesAcquisitionSessions === false ||
                selected.storeSnapshot?.usesAcquisitionSessions === false) && (
                <Banner tone="info">
                  {t(
                    "This older measurement may count repeat visits from the same browser as one session.",
                  )}
                </Banner>
              )}

              <GrowthMeasurementResults
                key={`${project.id}:${selected.id}:${comparison?.id || ""}:${JSON.stringify(filters)}`}
                shop={shop}
                projectId={project.id}
                measurementId={selected.id}
                comparisonId={comparison?.id || ""}
                comparisonName={comparison?.name}
                filters={filters}
              />
              {project.journeyTracking && selected.customerSnapshotId && (
                <GrowthProjectJourneys
                  key={`${selected.id}:${JSON.stringify(filters)}`}
                  shop={shop}
                  projectId={project.id}
                  measurementId={selected.id}
                  filters={filters}
                  onOpenJourney={openInApp}
                />
              )}
              <Box paddingBlockEnd="600">
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t(
                      "All counts every visitor. Active leaves out bots and visitors who didn't engage.",
                    )}
                  </Text>
                  <Button
                    variant="plain"
                    onClick={() => openInApp(selected.reportUrl)}
                  >
                    {t("Open classic report")}
                  </Button>
                </InlineStack>
              </Box>
            </BlockStack>
          </div>
        </div>
      )}
    </AppBridgeModal>
  );
}
