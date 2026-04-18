import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link, useSubmit, useNavigation } from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Modal,
  TextField,
  FormLayout,
  Select,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const CATEGORY_CONFIG: Record<string, { label: string; resourceType: string; rateLabel: string; singular: string }> = {
  products: { label: "Products", resourceType: "PRODUCT", rateLabel: "ATC", singular: "product" },
  collections: { label: "Collections", resourceType: "COLLECTION", rateLabel: "CTR", singular: "collection" },
  pages: { label: "Pages", resourceType: "PAGE", rateLabel: "CTR", singular: "page" },
  blogs: { label: "Blogs", resourceType: "BLOG", rateLabel: "CTR", singular: "blog" },
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const category = params.category || "products";
  const config = CATEGORY_CONFIG[category];

  if (!config) {
    throw new Response("Invalid category", { status: 404 });
  }

  const projects = await prisma.project.findMany({
    where: { shop, resourceType: config.resourceType },
    orderBy: { createdAt: "desc" },
    include: {
      snapshots: {
        orderBy: { number: "desc" },
        take: 1,
        select: {
          id: true,
          number: true,
          name: true,
          status: true,
          targetVisitors: true,
        },
      },
    },
  });

  const snapshotIds = projects.map((p) => p.snapshots[0]?.id).filter(Boolean) as string[];

  const [visitorCounts, atcCounts, convCounts, revenueSums, productClickCounts] =
    snapshotIds.length > 0
      ? await Promise.all([
          prisma.visit.groupBy({ by: ["snapshotId", "visitorType"], where: { snapshotId: { in: snapshotIds } }, _count: true }),
          prisma.visit.groupBy({ by: ["snapshotId"], where: { snapshotId: { in: snapshotIds }, addedToCart: true }, _count: true }),
          prisma.visit.groupBy({ by: ["snapshotId"], where: { snapshotId: { in: snapshotIds }, converted: true }, _count: true }),
          prisma.visit.groupBy({ by: ["snapshotId"], where: { snapshotId: { in: snapshotIds }, converted: true, orderValue: { not: null } }, _sum: { orderValue: true } }),
          (config.resourceType === "COLLECTION" || config.resourceType === "PAGE" || config.resourceType === "BLOG")
            ? prisma.visit.groupBy({ by: ["snapshotId"], where: { snapshotId: { in: snapshotIds }, exitUrl: { contains: "/products/" } }, _count: true })
            : Promise.resolve([]),
        ])
      : [[], [], [], [], []];

  const metricsMap = new Map<string, { real: number; atc: number; conv: number; revenue: number; productClicks: number }>();
  for (const row of visitorCounts) {
    if (row.visitorType !== "REAL") continue;
    const m = metricsMap.get(row.snapshotId) || { real: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 };
    m.real = row._count;
    metricsMap.set(row.snapshotId, m);
  }
  for (const row of atcCounts) { const m = metricsMap.get(row.snapshotId) || { real: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 }; m.atc = row._count; metricsMap.set(row.snapshotId, m); }
  for (const row of convCounts) { const m = metricsMap.get(row.snapshotId) || { real: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 }; m.conv = row._count; metricsMap.set(row.snapshotId, m); }
  for (const row of revenueSums) { const m = metricsMap.get(row.snapshotId) || { real: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 }; m.revenue = row._sum.orderValue || 0; metricsMap.set(row.snapshotId, m); }
  for (const row of productClickCounts as any[]) { const m = metricsMap.get(row.snapshotId) || { real: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 }; m.productClicks = row._count; metricsMap.set(row.snapshotId, m); }

  const audits = projects.map((project) => {
    const snap = project.snapshots[0];
    const sid = snap?.id;
    const m = sid ? metricsMap.get(sid) || { real: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 } : { real: 0, atc: 0, conv: 0, revenue: 0, productClicks: 0 };
    const rate = config.resourceType === "PRODUCT"
      ? (m.real > 0 ? Math.round((m.atc / m.real) * 1000) / 10 : 0)
      : (m.real > 0 ? Math.round((m.productClicks / m.real) * 1000) / 10 : 0);
    const cvrRate = m.real > 0 ? Math.round((m.conv / m.real) * 1000) / 10 : 0;
    return {
      id: project.id, productTitle: project.productTitle,
      snapshotName: snap?.name || `Snapshot ${snap?.number || 1}`,
      snapshotCount: project.snapshots.length, status: snap?.status || "NO_SNAPSHOT",
      realCount: m.real, targetVisitors: snap?.targetVisitors || 1000,
      rate, cvrRate, revenue: m.revenue,
    };
  });

  const rates = audits.map((a) => a.rate).filter((r) => r > 0);
  const cvrs = audits.map((a) => a.cvrRate).filter((r) => r > 0);
  const revs = audits.map((a) => a.revenue);
  const baseline = {
    avgRate: rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10 : 0,
    avgCvr: cvrs.length ? Math.round((cvrs.reduce((a, b) => a + b, 0) / cvrs.length) * 10) / 10 : 0,
    totalRevenue: revs.reduce((a, b) => a + b, 0),
    avgRevenue: revs.length ? Math.round(revs.reduce((a, b) => a + b, 0) / revs.length) : 0,
    count: audits.length,
  };

  // For pages/blogs: fetch available resources from Shopify for the picker
  let availableResources: Array<{ id: string; title: string; handle: string }> = [];
  if (category === "pages") {
    try {
      const resp = await admin.graphql(`{ pages(first: 50) { edges { node { id title handle } } } }`);
      const data = await resp.json();
      availableResources = (data.data?.pages?.edges || []).map((e: any) => ({ id: e.node.id, title: e.node.title, handle: e.node.handle }));
    } catch {}
  } else if (category === "blogs") {
    try {
      const resp = await admin.graphql(`{ blogs(first: 20) { edges { node { id title handle articles(first: 30) { edges { node { id title handle } } } } } } }`);
      const data = await resp.json();
      const blogs = data.data?.blogs?.edges || [];
      // Add blog index pages
      blogs.forEach((b: any) => {
        availableResources.push({ id: b.node.id, title: `${b.node.title} (Blog Index)`, handle: b.node.handle });
        // Add individual articles
        (b.node.articles?.edges || []).forEach((a: any) => {
          availableResources.push({ id: a.node.id, title: a.node.title, handle: `${b.node.handle}/${a.node.handle}` });
        });
      });
    } catch {}
  }

  return json({ category, config, audits, baseline, availableResources });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "create") {
    const category = params.category || "products";
    const config = CATEGORY_CONFIG[category];
    if (!config) return json({ error: "Invalid category" }, { status: 400 });

    const productId = formData.get("productId") as string;
    const productTitle = formData.get("productTitle") as string;
    const productHandle = formData.get("productHandle") as string;
    const snapshotName = formData.get("snapshotName") as string | null;
    const targetVisitors = parseInt(formData.get("targetVisitors") as string) || 1000;
    const resourceType = config.resourceType;

    const existing = await prisma.project.findFirst({
      where: { shop, productHandle, resourceType, snapshots: { some: { status: "ACTIVE" } } },
    });
    if (existing) return json({ error: `An active audit already exists for this ${config.singular}` }, { status: 400 });

    let project = await prisma.project.findFirst({
      where: { shop, productHandle, resourceType },
      include: { _count: { select: { snapshots: true } } },
    });

    if (project) {
      await prisma.snapshot.create({
        data: { projectId: project.id, number: project._count.snapshots + 1, name: snapshotName || null, targetVisitors, status: "ACTIVE" },
      });
    } else {
      await prisma.project.create({
        data: {
          shop, resourceType: resourceType as any, productId, productTitle, productHandle,
          snapshots: { create: { number: 1, name: snapshotName || null, targetVisitors, status: "ACTIVE" } },
        },
      });
    }
    return json({ success: true });
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

function DiffTag({ value, baseline }: { value: number; baseline: number }) {
  if (baseline === 0 || value === 0) return null;
  const pct = Math.round(((value - baseline) / baseline) * 100);
  if (pct === 0) return null;
  const up = pct > 0;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: up ? "#1a7f5a" : "#bf0711", marginLeft: 6, whiteSpace: "nowrap" }}>
      {up ? "\u2197" : "\u2198"} {Math.abs(pct)}%
    </span>
  );
}

export default function AuditsCategory() {
  const { category, config, audits, baseline, availableResources } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [snapshotName, setSnapshotName] = useState("");
  const [targetVisitors, setTargetVisitors] = useState("1000");
  // For products/collections — set by Shopify resource picker
  const [selectedResource, setSelectedResource] = useState<{ id: string; title: string; handle: string } | null>(null);
  // For pages/blogs — selected from dropdown
  const [selectedResourceId, setSelectedResourceId] = useState("");

  const handleOpenCreate = useCallback(async () => {
    if (category === "products" || category === "collections") {
      try {
        const pickerType = category === "collections" ? "collection" : "product";
        const selected = await shopify.resourcePicker({
          type: pickerType,
          multiple: false,
          ...(pickerType === "product" ? { filter: { variants: false, draft: false } } : {}),
        });
        if (selected && selected.length > 0) {
          setSelectedResource({ id: selected[0].id, title: selected[0].title, handle: selected[0].handle });
          setSnapshotName("");
          setTargetVisitors("1000");
          setIsCreateModalOpen(true);
        }
      } catch (e) {
        console.error("Resource picker error:", e);
      }
    } else {
      // Pages/blogs — show modal with dropdown
      setSelectedResource(null);
      setSelectedResourceId("");
      setSnapshotName("");
      setTargetVisitors("1000");
      setIsCreateModalOpen(true);
    }
  }, [category]);

  const handleCreate = useCallback(() => {
    let id = "", title = "", handle = "";
    if (category === "products" || category === "collections") {
      if (!selectedResource) return;
      id = selectedResource.id;
      title = selectedResource.title;
      handle = selectedResource.handle;
    } else {
      const res = availableResources.find((r: any) => r.id === selectedResourceId);
      if (!res) return;
      id = res.id;
      title = res.title;
      handle = res.handle;
    }

    const fd = new FormData();
    fd.append("action", "create");
    fd.append("productId", id);
    fd.append("productTitle", title);
    fd.append("productHandle", handle);
    fd.append("snapshotName", snapshotName);
    fd.append("targetVisitors", targetVisitors);
    submit(fd, { method: "POST" });
    setIsCreateModalOpen(false);
  }, [category, selectedResource, selectedResourceId, availableResources, snapshotName, targetVisitors, submit]);

  const modalTitle = (category === "products" || category === "collections")
    ? `Create Audit: ${selectedResource?.title || ""}`
    : `Create ${config.singular} Audit`;

  const canSubmit = (category === "products" || category === "collections")
    ? !!selectedResource
    : !!selectedResourceId;

  return (
    <Page
      title={config.label}
      subtitle="Audit baselines and per-page comparison"
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <TitleBar title={config.label}>
        <button variant="primary" onClick={handleOpenCreate}>
          + New {config.singular} Audit
        </button>
      </TitleBar>
      <Layout>
        <Layout.Section>
          {audits.length === 0 ? (
            <Card>
              <BlockStack gap="300" inlineAlign="center">
                <Text as="p" variant="bodyMd" tone="subdued">No {category} audits yet.</Text>
                <Button onClick={handleOpenCreate}>Create your first {config.singular} audit</Button>
              </BlockStack>
            </Card>
          ) : (
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">{config.label} baseline</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Average across {baseline.count} audit{baseline.count === 1 ? "" : "s"}</Text>
                </InlineStack>
                <div style={{ display: "flex", gap: 32, flexWrap: "wrap", marginTop: 8 }}>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <Text as="p" variant="bodySm" tone="subdued">Avg {config.rateLabel}</Text>
                    <Text as="p" variant="headingLg" fontWeight="semibold">{baseline.avgRate}%</Text>
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <Text as="p" variant="bodySm" tone="subdued">Avg CVR</Text>
                    <Text as="p" variant="headingLg" fontWeight="semibold">{baseline.avgCvr}%</Text>
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <Text as="p" variant="bodySm" tone="subdued">Avg revenue</Text>
                    <Text as="p" variant="headingLg" fontWeight="semibold">${baseline.avgRevenue.toLocaleString()}</Text>
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <Text as="p" variant="bodySm" tone="subdued">Total revenue</Text>
                    <Text as="p" variant="headingLg" fontWeight="semibold">${Math.round(baseline.totalRevenue).toLocaleString()}</Text>
                  </div>
                </div>
              </BlockStack>
            </Card>
          )}
        </Layout.Section>

        {audits.length > 0 && (
          <Layout.Section>
            <Card padding="0">
              {audits.map((p: any, idx: number) => {
                const progressPct = Math.min(100, Math.round((p.realCount / p.targetVisitors) * 100));
                const isDone = progressPct >= 100;
                return (
                  <Link key={p.id} to={`/app/project/${p.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                    <div
                      style={{ padding: "14px 20px", borderBottom: idx < audits.length - 1 ? "1px solid #ebebeb" : "none", cursor: "pointer", transition: "background 0.15s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--p-color-bg-surface-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                          <Text variant="bodyMd" fontWeight="bold" as="span">{p.productTitle}</Text>
                          <Text as="p" variant="bodySm" tone="subdued">{p.snapshotName}{p.snapshotCount > 1 ? ` \u00B7 ${p.snapshotCount} snapshots` : ""}</Text>
                        </div>
                        <div style={{ flex: "1 1 180px", maxWidth: 220 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <Text as="span" variant="bodySm" tone="subdued">{p.realCount}/{p.targetVisitors}</Text>
                          </div>
                          <div style={{ height: 6, background: "#e4e5e7", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${progressPct}%`, background: isDone ? "#29845a" : "#2c6ecb", borderRadius: 3, transition: "width 0.3s" }} />
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 28, flexShrink: 0 }}>
                          <div style={{ textAlign: "center", minWidth: 88 }}>
                            <Text as="p" variant="bodySm" tone="subdued">{config.rateLabel}</Text>
                            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center" }}>
                              <Text as="span" variant="bodyMd" fontWeight="semibold">{p.rate}%</Text>
                              <DiffTag value={p.rate} baseline={baseline.avgRate} />
                            </div>
                          </div>
                          <div style={{ textAlign: "center", minWidth: 88 }}>
                            <Text as="p" variant="bodySm" tone="subdued">CVR</Text>
                            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center" }}>
                              <Text as="span" variant="bodyMd" fontWeight="semibold">{p.cvrRate}%</Text>
                              <DiffTag value={p.cvrRate} baseline={baseline.avgCvr} />
                            </div>
                          </div>
                          <div style={{ textAlign: "center", minWidth: 112 }}>
                            <Text as="p" variant="bodySm" tone="subdued">REV</Text>
                            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center" }}>
                              <Text as="span" variant="bodyMd" fontWeight="semibold">${Math.round(p.revenue).toLocaleString()}</Text>
                              <DiffTag value={p.revenue} baseline={baseline.avgRevenue} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </Card>
          </Layout.Section>
        )}
      </Layout>

      {/* Create Audit Modal */}
      <Modal
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title={modalTitle}
        primaryAction={{ content: "Create Audit", onAction: handleCreate, loading: isLoading, disabled: !canSubmit }}
        secondaryActions={[{ content: "Cancel", onAction: () => setIsCreateModalOpen(false) }]}
      >
        <Modal.Section>
          <FormLayout>
            {(category === "pages" || category === "blogs") && (
              <Select
                label={`Select ${config.singular}`}
                options={[
                  { label: `Choose a ${config.singular}...`, value: "" },
                  ...(availableResources as any[]).map((r: any) => ({ label: r.title, value: r.id })),
                ]}
                value={selectedResourceId}
                onChange={setSelectedResourceId}
              />
            )}
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
              helpText="Number of real visitors to collect before completing"
              autoComplete="off"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
