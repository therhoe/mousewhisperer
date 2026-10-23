import { Link } from "@remix-run/react";
import { Badge, Card, Text } from "@shopify/polaris";
import { useI18n } from "../utils/i18n";
export type ProjectListItem = {
  id: string;
  title: string;
  goal: string;
  scope: string;
  updatedAt: Date | string;
  _count?: { measurements?: number; abTests?: number };
};
export function GrowthProjectList({
  projects,
  recent = false,
}: {
  projects: ProjectListItem[];
  recent?: boolean;
}) {
  const { t, formatDate, formatNumber } = useI18n();
  return (
    <Card>
      <div className="gp-heading">
        <Text as="h2" variant="headingMd">
          {t(recent ? "Recent projects" : "Projects")}
        </Text>
        {recent && <Link to="/app/projects">{t("View all projects")}</Link>}
      </div>
      {!projects.length ? (
        <div className="gp-empty">
          <p>{t("Your next improvement starts with a Project.")}</p>
          <p>
            {t(
              "Set a goal, collect measurements, and test your ideas in one place.",
            )}
          </p>
        </div>
      ) : (
        <div className="gp-table-wrap">
          <table className="gp-table">
            <thead>
              <tr>
                <th>{t("Project")}</th>
                <th>{t("Scope")}</th>
                <th>{t("Measurements")}</th>
                <th>{t("A/B tests")}</th>
                <th>{t("Updated")}</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <Link to={`/app/projects/${project.id}`} prefetch="intent">
                      {project.title}
                    </Link>
                    <div className="gp-muted">
                      {project.goal || t("Imported project")}
                    </div>
                  </td>
                  <td>
                    <Badge>
                      {t(
                        project.scope === "PAGE" ? "Page-level" : "Store-level",
                      )}
                    </Badge>
                  </td>
                  <td>{formatNumber(project._count?.measurements || 0)}</td>
                  <td>{formatNumber(project._count?.abTests || 0)}</td>
                  <td>
                    {formatDate(project.updatedAt, { dateStyle: "medium" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
