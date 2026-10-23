import { useState } from "react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { BlockStack, Layout, Page } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { listGrowthProjects } from "../utils/growth-projects.server";
import { GrowthProjectList } from "../components/GrowthProjectList";
import { GrowthProjectForm } from "../components/GrowthProjectForm";
import { GrowthOverviewCard } from "../components/GrowthOverviewCard";
import { useLanguageActionGroup } from "../components/LanguageMenu";
import { useI18n } from "../utils/i18n";
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  // Shopify reports load independently, never on the critical navigation path.
  const list = await listGrowthProjects(session.shop);
  return json(
    { shop: session.shop, projects: list.projects.slice(0, 5) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
};
export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const { t } = useI18n();
  const language = useLanguageActionGroup();
  const [create, setCreate] = useState(false);
  return (
    <Page
      title={t("Dashboard")}
      primaryAction={{
        content: t("Create project"),
        onAction: () => setCreate(true),
      }}
      secondaryActions={[
        { content: t("Create A/B test"), url: "/app/ab-tests?create=1" },
      ]}
      actionGroups={[language]}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <GrowthOverviewCard shop={data.shop} />
            <GrowthProjectList
              projects={data.projects}
              recent
              onCreate={() => setCreate(true)}
            />
          </BlockStack>
        </Layout.Section>
      </Layout>
      {create && (
        <GrowthProjectForm
          open
          onClose={() => setCreate(false)}
          shop={data.shop}
        />
      )}
    </Page>
  );
}
