import {
  Badge,
  BlockStack,
  Box,
  Card,
  EmptyState,
  IndexTable,
  InlineStack,
  Link,
  Text,
} from "@shopify/polaris";
import { useI18n } from "../utils/i18n";

export type ProjectListItem = {
  id: string;
  title: string;
  goal: string;
  scope: string;
  updatedAt: Date | string;
  journeyTracking?: boolean;
  resourceProject?: { productTitle?: string | null } | null;
  latestMeasurement?: { name: string; status: string } | null;
  _count?: { measurements?: number; abTests?: number };
};

type Tone = "success" | "attention" | "info" | undefined;
const STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: "Running", tone: "success" },
  LIVE: { label: "Live", tone: "success" },
  PAUSED: { label: "Paused", tone: "attention" },
  DRAFT: { label: "Draft", tone: "info" },
  COMPLETED: { label: "Completed", tone: undefined },
  ENDED: { label: "Ended", tone: undefined },
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const entry = STATUS[status];
  return <Badge tone={entry?.tone}>{t(entry?.label || status)}</Badge>;
}

export function ScopeBadge({ scope }: { scope: string }) {
  const { t } = useI18n();
  return (
    <Badge tone={scope === "PAGE" ? "info" : undefined}>
      {t(scope === "PAGE" ? "Page-level" : "Store-level")}
    </Badge>
  );
}

export function GrowthProjectList({
  projects,
  recent = false,
  onCreate,
}: {
  projects: ProjectListItem[];
  recent?: boolean;
  onCreate?: () => void;
}) {
  const { t, formatDate } = useI18n();
  if (!projects.length)
    return (
      <Card>
        <EmptyState
          heading={t("Start your first project")}
          action={
            onCreate
              ? { content: t("Create project"), onAction: onCreate }
              : undefined
          }
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>
            {t(
              "A project tracks one goal. Measure a page or your whole store, test ideas and see what moved the numbers.",
            )}
          </p>
        </EmptyState>
      </Card>
    );
  return (
    <Card padding="0">
      <Box padding="400" paddingBlockEnd="200">
        <InlineStack align="space-between" blockAlign="center" gap="400">
          <Text as="h2" variant="headingMd">
            {t(recent ? "Recent projects" : "All projects")}
          </Text>
          {recent && (
            <Link url="/app/projects" removeUnderline>
              {t("View all projects")}
            </Link>
          )}
        </InlineStack>
      </Box>
      <IndexTable
        resourceName={{ singular: t("project"), plural: t("projects") }}
        itemCount={projects.length}
        selectable={false}
        headings={[
          { title: t("Project") },
          { title: t("Scope") },
          { title: t("Latest measurement") },
          { title: t("Updated"), alignment: "end" },
        ]}
      >
        {projects.map((project, index) => (
          <IndexTable.Row id={project.id} key={project.id} position={index}>
            <IndexTable.Cell>
              <BlockStack gap="050">
                <Link
                  url={`/app/projects/${project.id}`}
                  monochrome
                  removeUnderline
                  dataPrimaryLink
                >
                  <Text as="span" fontWeight="semibold">
                    {project.title}
                  </Text>
                </Link>
                <Text as="span" variant="bodySm" tone="subdued" truncate>
                  {project.resourceProject?.productTitle ||
                    project.goal ||
                    t("Imported project")}
                </Text>
              </BlockStack>
            </IndexTable.Cell>
            <IndexTable.Cell>
              <ScopeBadge scope={project.scope} />
            </IndexTable.Cell>
            <IndexTable.Cell>
              {project.latestMeasurement ? (
                <InlineStack gap="200" blockAlign="center" wrap={false}>
                  <StatusBadge status={project.latestMeasurement.status} />
                  <Text as="span" variant="bodySm" tone="subdued" truncate>
                    {project.latestMeasurement.name}
                  </Text>
                </InlineStack>
              ) : (
                <Text as="span" tone="subdued">
                  {t("Not started")}
                </Text>
              )}
            </IndexTable.Cell>
            <IndexTable.Cell>
              <Text as="span" alignment="end" tone="subdued" numeric>
                {formatDate(project.updatedAt, { dateStyle: "medium" })}
              </Text>
            </IndexTable.Cell>
          </IndexTable.Row>
        ))}
      </IndexTable>
    </Card>
  );
}
