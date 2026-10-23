import { useEffect, useState } from "react";
import type { loader as appLoader } from "./app";
import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import {
  useFetcher,
  useLoaderData,
  useSearchParams,
  useRouteLoaderData,
  type ShouldRevalidateFunction,
} from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  EmptyState,
  IndexTable,
  InlineGrid,
  InlineStack,
  Layout,
  Link,
  Modal,
  Page,
  Pagination,
  Tabs,
  Text,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getGrowthProject,
  startGrowthMeasurement,
  transitionGrowthMeasurement,
} from "../utils/growth-projects.server";
import { GrowthProjectError, projectText } from "../utils/growth-projects";
import { growthReportFilters } from "../utils/growth-report";
import { isPlanLimitError } from "../utils/billing.server";
import { GrowthProjectForm } from "../components/GrowthProjectForm";
import { GrowthResultsSheet } from "../components/GrowthResultsSheet";
import { MetricTile } from "../components/GrowthOverviewCard";
import { ScopeBadge, StatusBadge } from "../components/GrowthProjectList";
import { useBackgroundJson } from "../utils/background-json";
import type { GrowthReport } from "../utils/growth-report";
import { useI18n } from "../utils/i18n";
import { mergeReportParams } from "../utils/embedded-filter-params";
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  try {
    return json(
      {
        shop: session.shop,
        project: await getGrowthProject(session.shop, params.id || ""),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof GrowthProjectError)
      throw new Response(error.message, { status: error.status });
    throw error;
  }
};
export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}) =>
  formMethod && formMethod !== "GET"
    ? true
    : currentUrl.pathname === nextUrl.pathname &&
        currentUrl.search !== nextUrl.search
      ? false
      : defaultShouldRevalidate;
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const id = params.id || "";
  try {
    const owned = await prisma.growthProject.findFirst({
      where: { id, shop: session.shop },
      select: { id: true },
    });
    if (!owned) throw new GrowthProjectError("Project not found.", 404);
    const intent = String(form.get("intent") || "");
    if (intent === "start-measurement") {
      const result = await startGrowthMeasurement(
        session.shop,
        admin,
        id,
        form,
      );
      return redirect(
        `/app/projects/${id}?measurement=${result.measurementId}`,
      );
    }
    if (intent === "transition") {
      await transitionGrowthMeasurement(
        session.shop,
        id,
        String(form.get("measurementId") || ""),
        String(form.get("transition") || ""),
      );
      return json({ ok: true });
    }
    if (intent === "log-activity") {
      const title = projectText(form.get("title"), 120),
        description = projectText(form.get("description"), 2000);
      if (!title) throw new GrowthProjectError("Enter an optimization title.");
      await prisma.$transaction([
        prisma.growthProjectActivity.create({
          data: { projectId: id, title, description: description || null },
        }),
        prisma.growthProject.update({
          where: { id },
          data: { updatedAt: new Date() },
        }),
      ]);
      return redirect(`/app/projects/${id}?tab=activity`);
    }
    throw new GrowthProjectError("Invalid action.");
  } catch (error) {
    if (error instanceof GrowthProjectError || isPlanLimitError(error))
      return json(
        {
          error: error.message,
          errorKey:
            error instanceof GrowthProjectError
              ? error.translationKey
              : error.message,
          errorValues:
            error instanceof GrowthProjectError ? error.translationValues : {},
        },
        { status: error.status },
      );
    console.error(
      "Project action failed",
      error instanceof Error ? error.name : "unknown",
    );
    return json(
      { error: "The action could not finish. Please retry." },
      { status: 503 },
    );
  }
};
const TABS = ["measurements", "tests", "activity"] as const;
const GOALS: Record<string, string> = {
  CONVERSION: "Conversion rate",
  REVENUE: "Revenue per visitor",
  ADD_TO_CART: "Add-to-cart rate",
  CLICK_THROUGH: "Clickthrough rate",
  ENGAGEMENT: "Engagement",
};
type SummaryPayload = { report: GrowthReport };
const isSummary = (value: unknown): value is SummaryPayload =>
  !!value &&
  typeof value === "object" &&
  typeof (value as SummaryPayload).report?.sessions === "number";

function LatestSummary({
  shop,
  projectId,
  measurementId,
}: {
  shop: string;
  projectId: string;
  measurementId: string;
}) {
  const { t, formatNumber } = useI18n();
  const query = new URLSearchParams({
    projectId,
    measurement: measurementId,
    compare: "",
    audience: "all",
    source: "",
    medium: "",
    campaign: "",
  });
  const { data, loading } = useBackgroundJson<SummaryPayload>({
    path: `/api/growth-report?${query}`,
    scopeKey: shop,
    isData: isSummary,
    errorMessage: t("Measurement results could not load. Please retry."),
  });
  const report = data?.report;
  const value = (format: (report: GrowthReport) => string) =>
    report ? format(report) : loading ? "…" : "—";
  const percent = (number: number) =>
    `${formatNumber(number, { maximumFractionDigits: 2 })}%`;
  return (
    <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
      <MetricTile
        label={t("Sessions")}
        value={value((item) => formatNumber(item.sessions))}
      />
      <MetricTile
        label={t("Add-to-cart rate")}
        value={value((item) => percent(item.atcRate))}
      />
      <MetricTile
        label={t("Conversion rate")}
        value={value((item) => percent(item.conversionRate))}
      />
    </InlineGrid>
  );
}

export default function ProjectDetail() {
  const { project, shop } = useLoaderData<typeof loader>();
  const { t, formatDate, formatNumber } = useI18n();
  const [params, setParams] = useSearchParams();
  const appData = useRouteLoaderData<typeof appLoader>("routes/app");
  const mutations = useFetcher<{
    error?: string;
    errorKey?: string;
    errorValues?: Record<string, string | number>;
  }>();
  const [create, setCreate] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logTitle, setLogTitle] = useState("");
  const [logNotes, setLogNotes] = useState("");
  const [confirmComplete, setConfirmComplete] = useState("");
  const measurementId = params.get("measurement");
  useEffect(() => {
    setCreate(false);
  }, [project.id, measurementId]);
  const requested = params.get("tab") || "";
  const tab = (TABS as readonly string[]).includes(requested)
    ? requested
    : "measurements";
  const selected =
    project.measurements.find(
      (item) => item.id === params.get("measurement"),
    ) || project.measurements[0];
  const comparison = project.measurements.find(
    (item) => item.id === params.get("compare") && item.id !== selected?.id,
  );
  const filters = growthReportFilters(params, project);
  const resultsOpen = Boolean(selected) && params.get("results") === "1";
  const page = Math.max(1, Math.floor(Number(params.get("listPage")) || 1));
  const list =
    tab === "tests"
      ? project.abTests
      : tab === "activity"
        ? project.activities
        : project.measurements;
  const pages = Math.max(1, Math.ceil(list.length / 10));
  const currentPage = Math.min(page, pages);
  const sliceStart = (currentPage - 1) * 10;
  function change(values: Record<string, string>) {
    setParams(mergeReportParams(params, values, appData?.embeddedContext));
  }
  function openResults(id = selected?.id || "") {
    change({ results: "1", measurement: id });
  }
  function closeResults() {
    const next = mergeReportParams(params, {}, appData?.embeddedContext);
    next.delete("results");
    setParams(next);
  }
  function transition(id: string, value: string) {
    mutations.submit(
      { intent: "transition", measurementId: id, transition: value },
      { method: "post" },
    );
  }
  function logActivity() {
    mutations.submit(
      { intent: "log-activity", title: logTitle, description: logNotes },
      { method: "post" },
    );
    setLogOpen(false);
    setLogTitle("");
    setLogNotes("");
  }
  const completion = (item: (typeof project.measurements)[number]) =>
    item.completionMode === "DURATION"
      ? t("{days} days", { days: item.durationDays || 0 })
      : t("{count} visitors", {
          count: formatNumber(item.targetVisitors || 0),
        });
  const tabs = [
    {
      id: "measurements",
      content: t("Measurements"),
      badge: formatNumber(project.measurements.length),
    },
    {
      id: "tests",
      content: t("A/B tests"),
      badge: formatNumber(project.abTests.length),
    },
    { id: "activity", content: t("Optimization log") },
  ];
  return (
    <Page
      title={project.title}
      subtitle={project.goal}
      titleMetadata={<ScopeBadge scope={project.scope} />}
      backAction={{ content: t("Projects"), url: "/app/projects" }}
      primaryAction={
        selected
          ? { content: t("View results"), onAction: () => openResults() }
          : { content: t("Start measurement"), onAction: () => setCreate(true) }
      }
      secondaryActions={[
        ...(selected
          ? [
              {
                content: t("Start measurement"),
                onAction: () => setCreate(true),
              },
            ]
          : []),
        {
          content: t("Create A/B test"),
          url: `/app/ab-tests?create=1&projectId=${project.id}`,
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {mutations.data?.error && (
              <Banner tone="critical">
                {t(
                  mutations.data.errorKey || mutations.data.error,
                  mutations.data.errorValues,
                )}
              </Banner>
            )}
            {selected ? (
              <Card>
                <BlockStack gap="400">
                  <InlineStack
                    align="space-between"
                    blockAlign="start"
                    gap="300"
                  >
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h2" variant="headingMd">
                          {selected.name}
                        </Text>
                        <StatusBadge status={selected.status} />
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {[
                          project.resourceProject?.productTitle,
                          completion(selected),
                          selected.startedAt || selected.createdAt
                            ? t("Started {date}", {
                                date: formatDate(
                                  selected.startedAt || selected.createdAt,
                                  { dateStyle: "medium" },
                                ),
                              })
                            : null,
                          project.journeyTracking
                            ? t("Journey tracking on")
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </BlockStack>
                    <Button variant="primary" onClick={() => openResults()}>
                      {t("View results")}
                    </Button>
                  </InlineStack>
                  <LatestSummary
                    key={selected.id}
                    shop={shop}
                    projectId={project.id}
                    measurementId={selected.id}
                  />
                </BlockStack>
              </Card>
            ) : (
              <Card>
                <EmptyState
                  heading={t("No measurements yet")}
                  action={{
                    content: t("Start measurement"),
                    onAction: () => setCreate(true),
                  }}
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    {t(
                      "Start a measurement to record a baseline for this project.",
                    )}
                  </p>
                </EmptyState>
              </Card>
            )}
            <Card padding="0">
              <Tabs
                tabs={tabs}
                selected={TABS.indexOf(tab as (typeof TABS)[number])}
                onSelect={(index) =>
                  change({ tab: TABS[index], listPage: "1" })
                }
              />
              {tab === "measurements" &&
                (project.measurements.length ? (
                  <IndexTable
                    resourceName={{
                      singular: t("measurement"),
                      plural: t("measurements"),
                    }}
                    itemCount={project.measurements.length}
                    selectable={false}
                    headings={[
                      { title: t("Measurement") },
                      { title: t("Status") },
                      { title: t("Completion") },
                      { title: t("Started") },
                      { title: t("Actions"), alignment: "end" },
                    ]}
                  >
                    {project.measurements
                      .slice(sliceStart, sliceStart + 10)
                      .map((item, index) => (
                        <IndexTable.Row
                          id={item.id}
                          key={item.id}
                          position={index}
                        >
                          <IndexTable.Cell>
                            <Text as="span" fontWeight="semibold">
                              {item.name}
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <StatusBadge status={item.status} />
                          </IndexTable.Cell>
                          <IndexTable.Cell>{completion(item)}</IndexTable.Cell>
                          <IndexTable.Cell>
                            {formatDate(item.startedAt || item.createdAt, {
                              dateStyle: "medium",
                            })}
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <InlineStack align="end" gap="200" wrap={false}>
                              <Button
                                size="slim"
                                onClick={() => openResults(item.id)}
                              >
                                {t("Results")}
                              </Button>
                              {item.status !== "COMPLETED" && (
                                <>
                                  <Button
                                    size="slim"
                                    disabled={mutations.state !== "idle"}
                                    onClick={() =>
                                      transition(
                                        item.id,
                                        item.status === "PAUSED"
                                          ? "resume"
                                          : "pause",
                                      )
                                    }
                                  >
                                    {t(
                                      item.status === "PAUSED"
                                        ? "Resume"
                                        : "Pause",
                                    )}
                                  </Button>
                                  <Button
                                    size="slim"
                                    disabled={mutations.state !== "idle"}
                                    onClick={() => setConfirmComplete(item.id)}
                                  >
                                    {t("Complete")}
                                  </Button>
                                </>
                              )}
                            </InlineStack>
                          </IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                  </IndexTable>
                ) : (
                  <Box padding="400">
                    <Text as="p" tone="subdued">
                      {t("No measurements yet.")}
                    </Text>
                  </Box>
                ))}
              {tab === "tests" &&
                (project.abTests.length ? (
                  <IndexTable
                    resourceName={{
                      singular: t("A/B test"),
                      plural: t("A/B tests"),
                    }}
                    itemCount={project.abTests.length}
                    selectable={false}
                    headings={[
                      { title: t("Test") },
                      { title: t("Status") },
                      { title: t("Success metric") },
                      { title: t("Created"), alignment: "end" },
                    ]}
                  >
                    {project.abTests
                      .slice(sliceStart, sliceStart + 10)
                      .map((test, index) => (
                        <IndexTable.Row
                          id={test.id}
                          key={test.id}
                          position={index}
                        >
                          <IndexTable.Cell>
                            <Link
                              url={`/app/ab-tests/${test.id}`}
                              monochrome
                              removeUnderline
                              dataPrimaryLink
                            >
                              <Text as="span" fontWeight="semibold">
                                {test.name}
                              </Text>
                            </Link>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <StatusBadge status={test.status} />
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            {t(GOALS[test.goal] || test.goal)}
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text as="span" alignment="end" numeric>
                              {formatDate(test.createdAt, {
                                dateStyle: "medium",
                              })}
                            </Text>
                          </IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                  </IndexTable>
                ) : (
                  <Box padding="400">
                    <BlockStack gap="300" inlineAlign="start">
                      <Text as="p" tone="subdued">
                        {t(
                          "No experiments yet. Test an idea against your Project goal.",
                        )}
                      </Text>
                      <Button
                        url={`/app/ab-tests?create=1&projectId=${project.id}`}
                      >
                        {t("Create A/B test")}
                      </Button>
                    </BlockStack>
                  </Box>
                ))}
              {tab === "activity" && (
                <Box padding="400">
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="p" tone="subdued">
                        {t(
                          "Log the changes you make so you can line them up with your results.",
                        )}
                      </Text>
                      <Button onClick={() => setLogOpen(true)}>
                        {t("Log optimization")}
                      </Button>
                    </InlineStack>
                    {project.activities
                      .slice(sliceStart, sliceStart + 10)
                      .map((item) => (
                        <Box
                          key={item.id}
                          paddingBlockStart="300"
                          borderBlockStartWidth="025"
                          borderColor="border-secondary"
                        >
                          <BlockStack gap="100">
                            <InlineStack
                              align="space-between"
                              blockAlign="center"
                              gap="200"
                            >
                              <Text as="h3" fontWeight="semibold">
                                {item.title}
                              </Text>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {formatDate(item.createdAt, {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                })}
                              </Text>
                            </InlineStack>
                            {item.description && (
                              <Text as="p">{item.description}</Text>
                            )}
                          </BlockStack>
                        </Box>
                      ))}
                    {!project.activities.length && (
                      <Text as="p" tone="subdued">
                        {t("Nothing logged yet.")}
                      </Text>
                    )}
                  </BlockStack>
                </Box>
              )}
              {pages > 1 && (
                <Box padding="300">
                  <InlineStack align="center">
                    <Pagination
                      hasPrevious={currentPage > 1}
                      onPrevious={() =>
                        change({ listPage: String(currentPage - 1) })
                      }
                      hasNext={currentPage < pages}
                      onNext={() =>
                        change({ listPage: String(currentPage + 1) })
                      }
                      label={t("Page {page} of {pages}", {
                        page: currentPage,
                        pages,
                      })}
                    />
                  </InlineStack>
                </Box>
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
      {selected && (
        <GrowthResultsSheet
          open={resultsOpen}
          onClose={closeResults}
          shop={shop}
          project={project}
          selected={selected}
          comparison={comparison}
          filters={filters}
          onChange={change}
        />
      )}
      <Modal
        open={Boolean(confirmComplete)}
        onClose={() => setConfirmComplete("")}
        title={t("Complete this measurement?")}
        primaryAction={{
          content: t("Complete"),
          destructive: true,
          onAction: () => {
            transition(confirmComplete, "complete");
            setConfirmComplete("");
          },
        }}
        secondaryActions={[
          { content: t("Cancel"), onAction: () => setConfirmComplete("") },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            {t(
              "It stops collecting now and can't be restarted. You can start a new measurement any time.",
            )}
          </Text>
        </Modal.Section>
      </Modal>
      <Modal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title={t("Log optimization")}
        primaryAction={{
          content: t("Save"),
          disabled: !logTitle.trim(),
          loading: mutations.state !== "idle",
          onAction: logActivity,
        }}
        secondaryActions={[
          { content: t("Cancel"), onAction: () => setLogOpen(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <TextField
              label={t("Optimization title")}
              value={logTitle}
              onChange={setLogTitle}
              maxLength={120}
              autoComplete="off"
              placeholder={t("e.g. Moved reviews above the fold")}
            />
            <TextField
              label={t("Notes")}
              value={logNotes}
              onChange={setLogNotes}
              maxLength={2000}
              multiline={3}
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
      {create && (
        <GrowthProjectForm
          open
          onClose={() => setCreate(false)}
          shop={shop}
          projectId={project.id}
        />
      )}
    </Page>
  );
}
