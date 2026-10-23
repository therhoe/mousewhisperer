import { useEffect, useState } from "react";
import type { loader as appLoader } from "./app";
import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import {
  Form,
  Link,
  useFetcher,
  useLoaderData,
  useSearchParams,
  useRouteLoaderData,
  type ShouldRevalidateFunction,
} from "@remix-run/react";
import { Badge, Banner, Button, Card, Page, Text } from "@shopify/polaris";
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
import { GrowthMeasurementResults } from "../components/GrowthMeasurementResults";
import { GrowthProjectJourneys } from "../components/GrowthProjectJourneys";
import { useI18n } from "../utils/i18n";
import { embeddedFilterParams } from "../utils/embedded-filter-params";
import styles from "../styles/projects.css?url";
export const links = () => [{ rel: "stylesheet", href: styles }];
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
  const measurementId = params.get("measurement");
  useEffect(() => {
    setCreate(false);
  }, [project.id, measurementId]);
  const tab = ["overview", "measurements", "tests", "activity"].includes(
    params.get("tab") || "",
  )
    ? params.get("tab")!
    : "overview";
  const selected =
    project.measurements.find(
      (item) => item.id === params.get("measurement"),
    ) || project.measurements[0];
  const comparison = project.measurements.find(
    (item) => item.id === params.get("compare") && item.id !== selected?.id,
  );
  const filters = growthReportFilters(params, project);
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
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) next.set(key, value);
    setParams(next);
  }
  function href(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) next.set(key, value);
    return `?${next}`;
  }
  const status = (value: string) =>
    t(
      (
        {
          ACTIVE: "Running",
          COMPLETED: "Completed",
          PAUSED: "Paused",
          LIVE: "Live",
          DRAFT: "Draft",
          ENDED: "Ended",
        } as Record<string, string>
      )[value] || value,
    );
  return (
    <Page
      title={project.title}
      subtitle={project.goal}
      backAction={{ content: t("Projects"), url: "/app/projects" }}
      primaryAction={{
        content: t("Start measurement"),
        onAction: () => setCreate(true),
      }}
      secondaryActions={[
        {
          content: t("Create A/B test"),
          url: `/app/ab-tests?create=1&projectId=${project.id}`,
        },
      ]}
    >
      <div className="gp-stack">
        <div className="gp-actions">
          <Badge>
            {t(project.scope === "PAGE" ? "Page-level" : "Store-level")}
          </Badge>
          {project.resourceProject && (
            <span>{project.resourceProject.productTitle}</span>
          )}
          {project.journeyTracking && <Badge>{t("Journey tracking")}</Badge>}
        </div>
        <nav className="gp-tabs" aria-label={t("Project sections")}>
          {[
            ["overview", "Overview"],
            ["measurements", "Measurements"],
            ["tests", "A/B tests"],
            ["activity", "Activity"],
          ].map(([key, label]) => (
            <Link
              key={key}
              to={href({ tab: key, listPage: "1" })}
              aria-current={tab === key ? "page" : undefined}
            >
              {t(label)}
            </Link>
          ))}
        </nav>
        {mutations.data?.error && (
          <Banner tone="critical">
            {t(
              mutations.data.errorKey || mutations.data.error,
              mutations.data.errorValues,
            )}
          </Banner>
        )}
        {tab === "overview" && (
          <>
            {selected ? (
              <>
                <Card>
                  <Form
                    method="get"
                    className="gp-filters"
                    key={`${project.id}:${params}`}
                  >
                    {Array.from(
                      embeddedFilterParams(params, {}, appData?.embeddedContext),
                    ).map(([name, value]) => (
                      <input key={name} type="hidden" name={name} value={value} />
                    ))}
                    <input type="hidden" name="tab" value="overview" />
                    <input
                      type="hidden"
                      name="audience"
                      value={filters.audience}
                    />
                    <label>
                      {t("Measurement")}
                      <select
                        className="gp-input"
                        name="measurement"
                        defaultValue={selected.id}
                      >
                        {project.measurements.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t("Compare with")}
                      <select
                        className="gp-input"
                        name="compare"
                        defaultValue={comparison?.id || ""}
                      >
                        <option value="">{t("No comparison")}</option>
                        {project.measurements
                          .filter((item) => item.id !== selected.id)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      {t("Source")}
                      <input
                        className="gp-input"
                        name="source"
                        defaultValue={filters.source}
                        placeholder={t("All sources")}
                        maxLength={160}
                      />
                    </label>
                    <label>
                      {t("Medium")}
                      <input
                        className="gp-input"
                        name="medium"
                        defaultValue={filters.medium}
                        placeholder={t("All mediums")}
                        maxLength={100}
                      />
                    </label>
                    <label>
                      {t("Campaign")}
                      <input
                        className="gp-input"
                        name="campaign"
                        defaultValue={filters.campaign}
                        placeholder={t("All campaigns")}
                        maxLength={240}
                      />
                    </label>
                    <Button submit>{t("Apply filters")}</Button>
                    <Button
                      onClick={() =>
                        change({ source: "", medium: "", campaign: "" })
                      }
                    >
                      {t("Clear filters")}
                    </Button>
                    <div className="gp-toggle" aria-label={t("Audience")}>
                      {["all", "active"].map((value) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={filters.audience === value}
                          onClick={() => change({ audience: value })}
                        >
                          {t(value === "all" ? "All" : "Active")}
                        </button>
                      ))}
                    </div>
                  </Form>
                  <p className="gp-muted" style={{ marginTop: 12 }}>
                    {t(
                      "Filters change your report, never which visitors are collected.",
                    )}
                  </p>
                </Card>
                {selected.customerSnapshot &&
                  !selected.customerSnapshot.captureAllSources &&
                  !selected.storeSnapshotId && (
                    <Banner tone="info">
                      {t(
                        "This historical measurement only contains its originally selected source. New measurements collect all sources.",
                      )}
                    </Banner>
                  )}
                {(selected.snapshot?.usesAcquisitionSessions === false ||
                  selected.storeSnapshot?.usesAcquisitionSessions ===
                    false) && (
                  <Banner tone="info">
                    {t(
                      "Historical measurements use their original session identifiers. Separate visits by the same browser may be grouped together; new measurements distinguish each acquisition session.",
                    )}
                  </Banner>
                )}
                <GrowthMeasurementResults
                  key={`${project.id}:${selected.id}:${comparison?.id || ""}:${JSON.stringify(filters)}`}
                  shop={shop}
                  projectId={project.id}
                  measurementId={selected.id}
                  comparisonId={comparison?.id || ""}
                  filters={filters}
                />
                {project.journeyTracking && selected.customerSnapshotId && (
                  <GrowthProjectJourneys
                    key={`${selected.id}:${JSON.stringify(filters)}`}
                    shop={shop}
                    projectId={project.id}
                    measurementId={selected.id}
                    filters={filters}
                  />
                )}
                <div className="gp-actions">
                  <Button url={selected.reportUrl}>
                    {t("Open detailed engagement report")}
                  </Button>
                  {selected.journeyUrl && (
                    <Button url={selected.journeyUrl}>
                      {t("Explore journeys")}
                    </Button>
                  )}
                </div>
                <p className="gp-muted">
                  {t(
                    "Detailed legacy reports retain their original reporting definitions and filters.",
                  )}
                </p>
              </>
            ) : (
              <Card>
                <div className="gp-empty">
                  {t("Start a measurement to see results for this Project.")}
                </div>
              </Card>
            )}
          </>
        )}
        {tab === "measurements" && (
          <Card>
            <Text as="h2" variant="headingMd">
              {t("Measurements")}
            </Text>
            <div className="gp-table-wrap">
              <table className="gp-table">
                <thead>
                  <tr>
                    {[
                      "Measurement",
                      "Status",
                      "Completion",
                      "Started",
                      "Actions",
                    ].map((label) => (
                      <th key={label}>{t(label)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {project.measurements
                    .slice(sliceStart, sliceStart + 10)
                    .map((item) => (
                      <tr key={item.id}>
                        <td>
                          <Link
                            to={href({
                              tab: "overview",
                              measurement: item.id,
                              compare: "",
                            })}
                          >
                            {item.name}
                          </Link>
                        </td>
                        <td>
                          <Badge>{status(item.status)}</Badge>
                        </td>
                        <td>
                          {item.completionMode === "DURATION"
                            ? t("{days} days", { days: item.durationDays || 0 })
                            : t("{count} visitors", {
                                count: formatNumber(item.targetVisitors || 0),
                              })}
                        </td>
                        <td>
                          {formatDate(item.startedAt || item.createdAt, {
                            dateStyle: "medium",
                          })}
                        </td>
                        <td>
                          <div className="gp-actions">
                            {item.status !== "COMPLETED" && (
                              <>
                                <Button
                                  disabled={mutations.state !== "idle"}
                                  onClick={() =>
                                    mutations.submit(
                                      {
                                        intent: "transition",
                                        measurementId: item.id,
                                        transition:
                                          item.status === "PAUSED"
                                            ? "resume"
                                            : "pause",
                                      },
                                      { method: "post" },
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
                                  disabled={mutations.state !== "idle"}
                                  onClick={() =>
                                    mutations.submit(
                                      {
                                        intent: "transition",
                                        measurementId: item.id,
                                        transition: "complete",
                                      },
                                      { method: "post" },
                                    )
                                  }
                                >
                                  {t("Complete")}
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        {tab === "tests" && (
          <Card>
            <div className="gp-heading">
              <Text as="h2" variant="headingMd">
                {t("A/B tests")}
              </Text>
              <Button
                url={`/app/ab-tests?create=1&projectId=${project.id}`}
                variant="primary"
              >
                {t("Create A/B test")}
              </Button>
            </div>
            {!project.abTests.length ? (
              <div className="gp-empty">
                {t(
                  "No experiments yet. Test an idea against your Project goal.",
                )}
              </div>
            ) : (
              <div className="gp-table-wrap">
                <table className="gp-table">
                  <thead>
                    <tr>
                      {["Test", "Status", "Success metric", "Created"].map(
                        (label) => (
                          <th key={label}>{t(label)}</th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {project.abTests
                      .slice(sliceStart, sliceStart + 10)
                      .map((test) => (
                        <tr key={test.id}>
                          <td>
                            <Link to={`/app/ab-tests/${test.id}`}>
                              {test.name}
                            </Link>
                          </td>
                          <td>
                            <Badge>{status(test.status)}</Badge>
                          </td>
                          <td>
                            {t(
                              (
                                {
                                  CONVERSION: "Conversion rate",
                                  REVENUE: "Revenue per visitor",
                                  ADD_TO_CART: "Add-to-cart rate",
                                  CLICK_THROUGH: "Clickthrough rate",
                                  ENGAGEMENT: "Engagement",
                                } as Record<string, string>
                              )[test.goal] || test.goal,
                            )}
                          </td>
                          <td>
                            {formatDate(test.createdAt, {
                              dateStyle: "medium",
                            })}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
        {tab === "activity" && (
          <Card>
            <Text as="h2" variant="headingMd">
              {t("Optimization activity")}
            </Text>
            <mutations.Form
              method="post"
              className="gp-filters"
              style={{ marginTop: 16 }}
            >
              <input type="hidden" name="intent" value="log-activity" />
              <label>
                {t("Optimization title")}
                <input
                  required
                  maxLength={120}
                  name="title"
                  className="gp-input"
                />
              </label>
              <label>
                {t("Notes")}
                <input
                  name="description"
                  maxLength={2000}
                  className="gp-input"
                />
              </label>
              <Button submit loading={mutations.state !== "idle"}>
                {t("Log optimization")}
              </Button>
            </mutations.Form>
            {project.activities
              .slice(sliceStart, sliceStart + 10)
              .map((item) => (
                <div key={item.id} className="gp-activity">
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                  <span className="gp-muted">
                    {formatDate(item.createdAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
              ))}
            {!project.activities.length && (
              <div className="gp-empty">
                {t(
                  "Only changes you log appear here. Measurements and tests are not automatically called optimizations.",
                )}
              </div>
            )}
          </Card>
        )}
        {tab !== "overview" && (
          <div className="gp-pagination">
            <Button
              disabled={currentPage <= 1}
              onClick={() => change({ listPage: String(currentPage - 1) })}
            >
              {t("Previous")}
            </Button>
            <span>
              {t("Page {page} of {pages}", { page: currentPage, pages })}
            </span>
            <Button
              disabled={currentPage >= pages}
              onClick={() => change({ listPage: String(currentPage + 1) })}
            >
              {t("Next")}
            </Button>
          </div>
        )}
      </div>
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
