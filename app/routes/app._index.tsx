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
  Modal,
  TextField,
  FormLayout,
  Banner,
  List,
  Box,
  Icon,
  Divider,
  CalloutCard,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  MinusCircleIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const APP_CLIENT_ID = "be249e7dc1288f980804d0bf5e40cde0";
const THEME_BLOCK_HANDLE = "tracker";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get or create shop settings
  let shopSettings = await prisma.shopSettings.findUnique({
    where: { shop },
  });

  if (!shopSettings) {
    shopSettings = await prisma.shopSettings.create({
      data: { shop },
    });
  }

  const projects = await prisma.project.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    include: {
      snapshots: {
        orderBy: { number: "desc" },
        include: {
          visits: {
            select: {
              visitorType: true,
            },
          },
        },
      },
    },
  });

  // Calculate stats for each project based on active snapshot
  const projectsWithStats = projects.map((project) => {
    const activeSnapshot = project.snapshots.find((s) => s.status === "ACTIVE");
    const latestSnapshot = project.snapshots[0]; // Already ordered by number desc
    const displaySnapshot = activeSnapshot || latestSnapshot;

    // Calculate stats from active/latest snapshot
    const visits = displaySnapshot?.visits || [];
    const realCount = visits.filter((v) => v.visitorType === "REAL").length;
    const zombieCount = visits.filter((v) => v.visitorType === "ZOMBIE").length;
    const botCount = visits.filter((v) => v.visitorType === "BOT").length;
    const targetVisitors = displaySnapshot?.targetVisitors || 1000;
    const progress = Math.min(100, Math.round((realCount / targetVisitors) * 100));

    return {
      id: project.id,
      productTitle: project.productTitle,
      productHandle: project.productHandle,
      status: displaySnapshot?.status || "NO_SNAPSHOT",
      snapshotName: displaySnapshot?.name || `Snapshot ${displaySnapshot?.number || 1}`,
      snapshotCount: project.snapshots.length,
      targetVisitors,
      realCount,
      zombieCount,
      botCount,
      progress,
      createdAt: project.createdAt,
    };
  });

  return json({
    projects: projectsWithStats,
    shop,
    setupGuideDismissed: shopSettings.setupGuideDismissed,
  });
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
    const snapshotName = formData.get("snapshotName") as string | null;
    const targetVisitors = parseInt(formData.get("targetVisitors") as string) || 1000;

    // Check if project already exists for this product with an active snapshot
    const existing = await prisma.project.findFirst({
      where: {
        shop,
        productId,
        snapshots: {
          some: {
            status: "ACTIVE",
          },
        },
      },
    });

    if (existing) {
      return json({ error: "An active audit already exists for this product" }, { status: 400 });
    }

    // Check if project exists (but no active snapshot)
    let project = await prisma.project.findFirst({
      where: { shop, productId },
      include: { _count: { select: { snapshots: true } } },
    });

    if (project) {
      // Create new snapshot for existing project
      await prisma.snapshot.create({
        data: {
          projectId: project.id,
          number: project._count.snapshots + 1,
          name: snapshotName || null,
          targetVisitors,
          status: "ACTIVE",
        },
      });
    } else {
      // Create new project with first snapshot
      await prisma.project.create({
        data: {
          shop,
          productId,
          productTitle,
          productHandle,
          snapshots: {
            create: {
              number: 1,
              name: snapshotName || null,
              targetVisitors,
              status: "ACTIVE",
            },
          },
        },
      });
    }

    return json({ success: true });
  }

  if (actionType === "delete") {
    const projectId = formData.get("projectId") as string;
    await prisma.project.delete({ where: { id: projectId } });
    return json({ success: true });
  }

  if (actionType === "dismissSetup") {
    await prisma.shopSettings.upsert({
      where: { shop },
      update: { setupGuideDismissed: true },
      create: { shop, setupGuideDismissed: true },
    });
    return json({ success: true });
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

export default function Index() {
  const { projects, shop, setupGuideDismissed } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<{
    id: string;
    title: string;
    handle: string;
  } | null>(null);
  const [snapshotName, setSnapshotName] = useState("");
  const [targetVisitors, setTargetVisitors] = useState("1000");

  const isLoading = navigation.state !== "idle";

  // Check if setup is complete (has at least one project)
  const hasProjects = projects.length > 0;
  const showSetupGuide = !setupGuideDismissed;

  // Deeplink to enable theme extension
  const themeEditorDeeplink = `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${APP_CLIENT_ID}/${THEME_BLOCK_HANDLE}`;

  const handleDismissSetup = useCallback(() => {
    const formData = new FormData();
    formData.append("action", "dismissSetup");
    submit(formData, { method: "POST" });
  }, [submit]);

  const resourceName = {
    singular: "project",
    plural: "projects",
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(projects);

  const handleOpenPicker = useCallback(async () => {
    try {
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: false,
        filter: { variants: false, draft: false },
      });

      if (selected && selected.length > 0) {
        const product = selected[0];
        setSelectedProduct({
          id: product.id,
          title: product.title,
          handle: product.handle,
        });
        setSnapshotName("");
        setTargetVisitors("1000");
        setIsModalOpen(true);
      }
    } catch (error) {
      console.error("Resource picker error:", error);
    }
  }, []);

  const handleCreateProject = useCallback(() => {
    if (!selectedProduct) return;

    const formData = new FormData();
    formData.append("action", "create");
    formData.append("productId", selectedProduct.id);
    formData.append("productTitle", selectedProduct.title);
    formData.append("productHandle", selectedProduct.handle);
    formData.append("snapshotName", snapshotName);
    formData.append("targetVisitors", targetVisitors);
    submit(formData, { method: "POST" });
    setIsModalOpen(false);
    setSelectedProduct(null);
  }, [selectedProduct, snapshotName, targetVisitors, submit]);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedProduct(null);
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return <Badge tone="success">Active</Badge>;
      case "COMPLETED":
        return <Badge tone="info">Completed</Badge>;
      case "PAUSED":
        return <Badge tone="warning">Paused</Badge>;
      case "NO_SNAPSHOT":
        return <Badge tone="attention">No Snapshot</Badge>;
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
        <BlockStack gap="100">
          <Text variant="bodyMd" fontWeight="bold" as="span">
            <Link to={`/app/project/${project.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              {project.productTitle}
            </Link>
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {project.snapshotName} {project.snapshotCount > 1 && `(${project.snapshotCount} snapshots)`}
          </Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>{getStatusBadge(project.status)}</IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="100">
          <Text as="span" variant="bodySm">
            {project.realCount} / {project.targetVisitors}
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
        onAction: handleOpenPicker,
      }}
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>Select a product to start tracking visitor engagement and traffic quality.</p>
    </EmptyState>
  );

  // Setup guide component
  const setupGuideMarkup = showSetupGuide ? (
    <Layout.Section>
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="start">
            <Text variant="headingMd" as="h2">
              Get started with Mouse Whisperer
            </Text>
            <Button variant="plain" onClick={handleDismissSetup}>
              Dismiss
            </Button>
          </InlineStack>

          <Text as="p" tone="subdued">
            Follow these steps to start tracking visitor engagement on your product pages.
          </Text>

          <Divider />

          <BlockStack gap="400">
            {/* Step 1 */}
            <InlineStack gap="300" blockAlign="start">
              <Box>
                <Icon source={hasProjects ? CheckCircleIcon : MinusCircleIcon} tone={hasProjects ? "success" : "subdued"} />
              </Box>
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">
                  Step 1: Enable the tracker in your theme
                </Text>
                <Text as="p" tone="subdued">
                  Add the Mouse Whisperer tracker to your online store theme. This invisible script will track visitor engagement on your product pages.
                </Text>
                <Box paddingBlockStart="200">
                  <Button
                    url={themeEditorDeeplink}
                    target="_blank"
                  >
                    Open Theme Editor
                  </Button>
                </Box>
              </BlockStack>
            </InlineStack>

            {/* Step 2 */}
            <InlineStack gap="300" blockAlign="start">
              <Box>
                <Icon source={hasProjects ? CheckCircleIcon : MinusCircleIcon} tone={hasProjects ? "success" : "subdued"} />
              </Box>
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">
                  Step 2: Create your first audit
                </Text>
                <Text as="p" tone="subdued">
                  Select a product to start tracking. Mouse Whisperer will analyze visitor behavior and classify traffic as real users, zombies (low engagement), or bots.
                </Text>
                {!hasProjects && (
                  <Box paddingBlockStart="200">
                    <Button onClick={handleOpenPicker} variant="primary">
                      Create New Audit
                    </Button>
                  </Box>
                )}
              </BlockStack>
            </InlineStack>

            {/* Step 3 */}
            <InlineStack gap="300" blockAlign="start">
              <Box>
                <Icon source={MinusCircleIcon} tone="subdued" />
              </Box>
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">
                  Step 3: Review your analytics
                </Text>
                <Text as="p" tone="subdued">
                  Once visitors start landing on your tracked product pages, you'll see real-time engagement data including time on page, scroll depth, and conversion tracking.
                </Text>
              </BlockStack>
            </InlineStack>
          </BlockStack>

          <Divider />

          <Banner tone="info">
            <p>
              <strong>Tip:</strong> For best results, track products that receive regular traffic. The more visitors, the faster you'll get statistically significant insights.
            </p>
          </Banner>
        </BlockStack>
      </Card>
    </Layout.Section>
  ) : null;

  return (
    <Page>
      <TitleBar title="Mouse Whisperer">
        <button variant="primary" onClick={handleOpenPicker} disabled={isLoading}>
          Create New Audit
        </button>
      </TitleBar>
      <Layout>
        {setupGuideMarkup}
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

      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title={`Create Audit: ${selectedProduct?.title || ""}`}
        primaryAction={{
          content: "Create Audit",
          onAction: handleCreateProject,
          loading: isLoading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: handleCloseModal,
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Snapshot Name"
              value={snapshotName}
              onChange={setSnapshotName}
              placeholder="e.g., Baseline, After Redesign"
              helpText="Optional label for this measurement period"
              autoComplete="off"
            />
            <TextField
              label="Target Visitors"
              type="number"
              value={targetVisitors}
              onChange={setTargetVisitors}
              min={100}
              helpText="Number of real visitors to collect before completing the snapshot"
              autoComplete="off"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
