import { json } from "../utils/route-data";
import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect, useRef, useState } from "react";
import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import {
  createGrowthProject,
  listGrowthProjects,
} from "../utils/growth-projects.server";
import {
  GrowthProjectError,
  parseProjectListFilters,
  PROJECT_LIST_STATUSES,
  syncProjectFilterControls,
  type ProjectFilterControls,
  type ProjectListStatus,
} from "../utils/growth-projects";
import { isPlanLimitError } from "../utils/billing.server";
import { GrowthProjectForm } from "../components/GrowthProjectForm";
import { ProjectsTable } from "../components/ProjectsTable";
import { listParams } from "../utils/navigation";
import { useI18n } from "../utils/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const filters = parseProjectListFilters(new URL(request.url).searchParams);
  const list = await listGrowthProjects(session.shop, filters);
  return json(
    { ...list, filters, shop: session.shop },
    { headers: { "Cache-Control": "private, no-store" } },
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  try {
    if (form.get("intent") !== "create-project")
      throw new GrowthProjectError("Invalid action.");
    const continueToAbTest = form.get("next") === "ab-test";
    const created = await createGrowthProject(session.shop, admin, form, {
      startMeasurement: !continueToAbTest,
    });
    return redirect(
      continueToAbTest
        ? `/app/ab-tests?create=1&projectId=${encodeURIComponent(created.projectId)}`
        : `/app/projects/${created.projectId}`,
    );
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
      "Project creation failed",
      error instanceof Error ? error.name : "unknown",
    );
    return json(
      { error: "Project could not be created. Please retry." },
      { status: 503 },
    );
  }
};

const STATUS_LABELS: Record<ProjectListStatus, string> = {
  ALL: "All",
  MEASURING: "Measuring",
  IDLE: "Idle",
  COMPLETED: "Completed",
};
const valueOf = (event: { currentTarget: unknown }) =>
  String((event.currentTarget as { value?: unknown } | null)?.value ?? "");

export default function Projects() {
  const data = useLoaderData<typeof loader>();
  const { t, formatNumber } = useI18n();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get("create") === "1");
  const requestedCreate = params.get("create");
  useEffect(() => {
    if (requestedCreate === "1") setOpen(true);
  }, [requestedCreate]);
  const [query, setQuery] = useState(data.filters.query);

  // The most recently requested address. `params` stays on the old address
  // until the loader finishes, so every change builds on this ref instead.
  const latest = useRef(params);
  // Addresses this screen requested that have not arrived yet, oldest first.
  const pending = useRef<string[]>([]);
  // The status buttons and Scope select, so their state can follow the request.
  const controls = useRef<ProjectFilterControls>({ statuses: {}, scope: null });
  const syncControls = (from: URLSearchParams) =>
    syncProjectFilterControls(controls.current, from);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancelSearch() {
    if (searchTimer.current !== null) clearTimeout(searchTimer.current);
    searchTimer.current = null;
  }
  useEffect(() => {
    const at = pending.current.indexOf(params.toString());
    if (at >= 0) {
      // Our own request arrived: keep what the merchant typed since.
      pending.current.splice(0, at + 1);
      if (!pending.current.length) latest.current = params;
      // A later request may still be on its way: show that one, not this one.
      syncControls(latest.current);
      return;
    }
    // Back/Forward or a link: the address wins.
    pending.current = [];
    latest.current = params;
    cancelSearch();
    setQuery(data.filters.query);
    syncControls(params);
    // Deliberate: `data` and `params` arrive together, and the rest only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // Filters and pages never add Back steps (rule 2).
  function request(next: URLSearchParams) {
    if (next.toString() !== latest.current.toString()) pending.current.push(next.toString());
    latest.current = next;
    // Runs inside the click, after Polaris's own handler, so it corrects its self-toggle.
    syncControls(next);
    setParams(next, { replace: true, preventScrollReset: true });
  }
  function update(changes: Record<string, string | null>) {
    request(listParams(latest.current, changes));
  }
  useEffect(() => {
    const next = query.trim();
    cancelSearch();
    if (next === (latest.current.get("q") ?? "")) return;
    searchTimer.current = setTimeout(() => {
      searchTimer.current = null;
      update({ q: next || null });
    }, 300);
    return cancelSearch;
    // Deliberate: `update` only reads refs and the latest request, so it never goes stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, params]);

  function close() {
    setOpen(false);
    const next = new URLSearchParams(latest.current);
    next.delete("create");
    next.delete("next");
    request(next);
  }
  function clearFilters() {
    cancelSearch();
    setQuery("");
    update({ status: null, scope: null, q: null });
  }

  const filtered =
    data.filters.status !== "ALL" || data.filters.scope !== "ALL" || data.filters.query !== "";
  return (
    <s-page heading={t("Projects")}>
      <s-button slot="secondary-actions" href="/app/ab-tests?create=1">
        {t("Create A/B test")}
      </s-button>
      <s-button slot="primary-action" variant="primary" onClick={() => setOpen(true)}>
        {t("Create project")}
      </s-button>
      {data.counts.ALL === 0 && !filtered ? (
        <s-section>
          <s-stack gap="base" alignItems="center" padding="large">
            <s-heading>{t("Start your first project")}</s-heading>
            <s-paragraph>
              {t("A project tracks one goal. Measure a page or your whole store, test ideas and see what moved the numbers.")}
            </s-paragraph>
            <s-button variant="secondary" onClick={() => setOpen(true)}>
              {t("Create project")}
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section padding="none" accessibilityLabel={t("Projects")}>
          <s-box padding="base">
            <s-stack direction="inline" gap="base" alignItems="end">
              <s-button-group gap="none" accessibilityLabel={t("Status")}>
                {PROJECT_LIST_STATUSES.map((status) => (
                  <s-press-button
                    key={status}
                    slot="secondary-actions"
                    ref={(element: unknown) => {
                      controls.current.statuses[status] = element as { pressed: boolean } | null;
                    }}
                    pressed={data.filters.status === status}
                    onClick={() => update({ status: status === "ALL" ? null : status })}
                  >
                    {`${t(STATUS_LABELS[status])} ${formatNumber(data.counts[status])}`}
                  </s-press-button>
                ))}
              </s-button-group>
              <s-select
                label={t("Scope")}
                ref={(element: unknown) => {
                  controls.current.scope = element as { value: string } | null;
                }}
                value={data.filters.scope}
                onChange={(event) => {
                  const value = valueOf(event);
                  update({ scope: value === "ALL" ? null : value });
                }}
              >
                <s-option value="ALL">{t("Store and page")}</s-option>
                <s-option value="STORE">{t("Store-level")}</s-option>
                <s-option value="PAGE">{t("Page-level")}</s-option>
              </s-select>
              <s-search-field
                label={t("Search projects")}
                labelAccessibilityVisibility="exclusive"
                placeholder={t("Search projects")}
                value={query}
                onInput={(event) => setQuery(valueOf(event))}
              />
            </s-stack>
          </s-box>
          {data.projects.length ? (
            <ProjectsTable
              projects={data.projects}
              page={data.page}
              pageCount={data.pageCount}
              onPage={(page) => update({ page: page > 1 ? String(page) : null })}
            />
          ) : (
            <s-box padding="large">
              <s-stack gap="base" alignItems="center">
                <s-paragraph>{t("No projects match these filters.")}</s-paragraph>
                <s-button onClick={clearFilters}>{t("Clear filters")}</s-button>
              </s-stack>
            </s-box>
          )}
        </s-section>
      )}
      {open && (
        <GrowthProjectForm
          open
          onClose={close}
          shop={data.shop}
          next={params.get("next") || undefined}
        />
      )}
    </s-page>
  );
}

// Single fetch applies route headers to data requests too; Shopify needs
// them so App Bridge can re-authenticate an expired session.
export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
