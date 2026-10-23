import { useEffect, useState } from "react";
import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import {
  BlockStack,
  InlineStack,
  Layout,
  Page,
  Pagination,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import {
  createGrowthProject,
  listGrowthProjects,
} from "../utils/growth-projects.server";
import { GrowthProjectError } from "../utils/growth-projects";
import { isPlanLimitError } from "../utils/billing.server";
import { GrowthProjectForm } from "../components/GrowthProjectForm";
import { GrowthProjectList } from "../components/GrowthProjectList";
import { useLanguageActionGroup } from "../components/LanguageMenu";
import { useI18n } from "../utils/i18n";
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const page = Number(new URL(request.url).searchParams.get("page")) || 1;
  const list = await listGrowthProjects(session.shop, page);
  return json(
    { ...list, shop: session.shop },
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
export default function Projects() {
  const data = useLoaderData<typeof loader>();
  const { t, formatNumber } = useI18n();
  const language = useLanguageActionGroup();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get("create") === "1");
  const requestedCreate = params.get("create");
  useEffect(() => {
    if (requestedCreate === "1") setOpen(true);
  }, [requestedCreate]);
  function close() {
    setOpen(false);
    const next = new URLSearchParams(params);
    next.delete("create");
    next.delete("next");
    setParams(next, { replace: true });
  }
  return (
    <Page
      title={t("Projects")}
      primaryAction={{
        content: t("Create project"),
        onAction: () => setOpen(true),
      }}
      secondaryActions={[
        { content: t("Create A/B test"), url: "/app/ab-tests?create=1" },
      ]}
      actionGroups={[language]}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <GrowthProjectList
              projects={data.projects}
              onCreate={() => setOpen(true)}
            />
            {data.pageCount > 1 && (
              <InlineStack align="center">
                <Pagination
                  hasPrevious={data.page > 1}
                  previousURL={`?page=${data.page - 1}`}
                  hasNext={data.page < data.pageCount}
                  nextURL={`?page=${data.page + 1}`}
                  label={t("Page {page} of {pages}", {
                    page: formatNumber(data.page),
                    pages: formatNumber(data.pageCount),
                  })}
                />
              </InlineStack>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
      {open && (
        <GrowthProjectForm
          open
          onClose={close}
          shop={data.shop}
          next={params.get("next") || undefined}
        />
      )}
    </Page>
  );
}
