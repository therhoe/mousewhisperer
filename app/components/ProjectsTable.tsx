import { useRef } from "react";
import { useI18n } from "../utils/i18n";
import { useElementEvent } from "./polaris/events";
import type { ProjectListStatus } from "../utils/growth-projects";

export type ProjectsTableRow = {
  id: string;
  title: string;
  goal: string;
  scope: string;
  updatedAt: Date | string;
  listStatus: Exclude<ProjectListStatus, "ALL">;
  resourceProject?: { productTitle?: string | null } | null;
  latestMeasurement?: { name: string } | null;
  _count?: { abTests?: number };
};

const STATUS_BADGES = {
  MEASURING: { label: "Measuring", tone: "info" },
  IDLE: { label: "Idle", tone: "neutral" },
  COMPLETED: { label: "Completed", tone: "success" },
} as const;

export function ProjectsTable({
  projects,
  page,
  pageCount,
  onPage,
}: {
  projects: ProjectsTableRow[];
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  const { t, formatDate, formatNumber } = useI18n();
  const table = useRef<HTMLElementTagNameMap["s-table"]>(null);
  useElementEvent(table, "nextpage", () => onPage(page + 1));
  useElementEvent(table, "previouspage", () => onPage(page - 1));
  return (
    <s-table ref={table} paginate={pageCount > 1} hasPreviousPage={page > 1} hasNextPage={page < pageCount}>
      <s-table-header-row>
        <s-table-header listSlot="primary">{t("Project")}</s-table-header>
        <s-table-header>{t("Scope")}</s-table-header>
        <s-table-header listSlot="secondary">{t("Status")}</s-table-header>
        <s-table-header>{t("Latest measurement")}</s-table-header>
        <s-table-header format="numeric">{t("A/B tests")}</s-table-header>
        <s-table-header>{t("Updated")}</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {projects.map((project) => {
          const status = STATUS_BADGES[project.listStatus];
          return (
            <s-table-row key={project.id} clickDelegate={`project-link-${project.id}`}>
              <s-table-cell>
                <s-stack gap="small-500">
                  <s-link id={`project-link-${project.id}`} href={`/app/projects/${project.id}`}>
                    {project.title}
                  </s-link>
                  <s-text color="subdued">
                    {project.resourceProject?.productTitle || project.goal || t("Imported project")}
                  </s-text>
                </s-stack>
              </s-table-cell>
              <s-table-cell>
                <s-badge>{t(project.scope === "PAGE" ? "Page-level" : "Store-level")}</s-badge>
              </s-table-cell>
              <s-table-cell>
                <s-badge tone={status.tone}>{t(status.label)}</s-badge>
              </s-table-cell>
              <s-table-cell>
                {project.latestMeasurement ? (
                  project.latestMeasurement.name
                ) : (
                  <s-text color="subdued">{t("Not started")}</s-text>
                )}
              </s-table-cell>
              <s-table-cell>{formatNumber(project._count?.abTests ?? 0)}</s-table-cell>
              <s-table-cell>{formatDate(project.updatedAt, { dateStyle: "medium" })}</s-table-cell>
            </s-table-row>
          );
        })}
      </s-table-body>
    </s-table>
  );
}
