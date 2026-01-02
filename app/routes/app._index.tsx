import { useCallback, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, Link } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  useIndexResourceState,
  EmptyState,
  Button,
  BlockStack,
  InlineStack,
  ProgressBar,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const projects = await prisma.project.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { visits: true },
      },
      visits: {
        select: {
          visitorType: true,
        },
      },
    },
  });

  // Calculate stats for each project
  const projectsWithStats = projects.map((project) => {
    const realCount = project.visits.filter((v) => v.visitorType === "REAL").length;
    const zombieCount = project.visits.filter((v) => v.visitorType === "ZOMBIE").length;
    const botCount = project.visits.filter((v) => v.visitorType === "BOT").length;
    const progress = Math.min(100, Math.round((realCount / project.targetVisitors) * 100));

    return {
      id: project.id,
      productTitle: project.productTitle,
      productHandle: project.productHandle,
      status: project.status,
      targetVisitors: project.targetVisitors,
      realCount,
      zombieCount,
      botCount,
      progress,
      createdAt: project.createdAt,
    };
  });

  return json({ projects: projectsWithStats });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "create") {
    const productId = formData.get("productId") as string;
    const productTitle = formData.get("productTitle") as string;
    const productHandle = formData.get("productHandle") as string;

    // Check if project already exists for this product
    const existing = await prisma.project.findFirst({
      where: {
        shop,
        productId,
        status: "ACTIVE",
      },
    });

    if (existing) {
      return json({ error: "An active project already exists for this product" }, { status: 400 });
    }

    await prisma.project.create({
      data: {
        shop,
        productId,
        productTitle,
        productHandle,
        status: "ACTIVE",
        targetVisitors: 1000,
      },
    });

    return json({ success: true });
  }

  if (actionType === "delete") {
    const projectId = formData.get("projectId") as string;
    await prisma.project.delete({ where: { id: projectId } });
    return json({ success: true });
  }

  if (actionType === "pause") {
    const projectId = formData.get("projectId") as string;
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "PAUSED" },
    });
    return json({ success: true });
  }

  if (actionType === "resume") {
    const projectId = formData.get("projectId") as string;
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "ACTIVE" },
    });
    return json({ success: true });
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

export default function Index() {
  const { projects } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const isLoading = navigation.state !== "idle";

  const resourceName = {
    singular: "project",
    plural: "projects",
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(projects);

  const handleCreateProject = useCallback(async () => {
    try {
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: false,
        filter: { variants: false, draft: false },
      });

      if (selected && selected.length > 0) {
        const product = selected[0];
        const formData = new FormData();
        formData.append("action", "create");
        formData.append("productId", product.id);
        formData.append("productTitle", product.title);
        formData.append("productHandle", product.handle);
        submit(formData, { method: "POST" });
      }
    } catch (error) {
      console.error("Resource picker error:", error);
    }
  }, [submit]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return <Badge tone="success">Active</Badge>;
      case "COMPLETED":
        return <Badge tone="info">Completed</Badge>;
      case "PAUSED":
        return <Badge tone="warning">Paused</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const rowMarkup = projects.map((project, index) => (
    <IndexTable.Row
      id={project.id}
      key={project.id}
      selected={selectedResources.includes(project.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">
          <Link to={`/app/project/${project.id}`} style={{ textDecoration: "none", color: "inherit" }}>
            {project.productTitle}
          </Link>
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{getStatusBadge(project.status)}</IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="100">
          <Text as="span" variant="bodySm">
            {project.progress}%
          </Text>
          <div style={{ width: "100px" }}>
            <ProgressBar progress={project.progress} size="small" tone="primary" />
          </div>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" tone="success">
          {project.realCount}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" tone="caution">
          {project.zombieCount}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" tone="critical">
          {project.botCount}
        </Text>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const emptyStateMarkup = (
    <EmptyState
      heading="Create your first audit"
      action={{
        content: "Create New Audit",
        onAction: handleCreateProject,
      }}
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>Select a product to start tracking visitor engagement and traffic quality.</p>
    </EmptyState>
  );

  return (
    <Page>
      <TitleBar title="Crofly">
        <button variant="primary" onClick={handleCreateProject} disabled={isLoading}>
          Create New Audit
        </button>
      </TitleBar>
      <Layout>
        <Layout.Section>
          <Card padding="0">
            {projects.length === 0 ? (
              emptyStateMarkup
            ) : (
              <IndexTable
                resourceName={resourceName}
                itemCount={projects.length}
                selectedItemsCount={
                  allResourcesSelected ? "All" : selectedResources.length
                }
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: "Product" },
                  { title: "Status" },
                  { title: "Progress" },
                  { title: "Real Users" },
                  { title: "Zombies" },
                  { title: "Bots" },
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
