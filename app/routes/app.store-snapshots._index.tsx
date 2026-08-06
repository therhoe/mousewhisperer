import { useCallback, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Link,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  ChoiceList,
  FormLayout,
  InlineStack,
  Modal,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureWebPixel } from "../utils/web-pixel.server";
import { createStoreSnapshot } from "../utils/store-snapshot.server";
import {
  planUsagePillLabel,
  PremiumGateCard,
  TargetLimitText,
} from "../components/PremiumGate";
import {
  assertCanCreateStoreSnapshot,
  assertSnapshotTargetAllowed,
  getBillingAccess,
  isPlanLimitError,
  planLimitPayload,
} from "../utils/billing.server";
import {
  getStorefrontTrackerStatus,
  type StorefrontTrackerStatus,
} from "../utils/storefront-tracker-status.server";

type StoreSnapshotRow = {
  id: string;
  name: string | null;
  status: string;
  completionMode: string;
  targetHumanVisitors: number | null;
  targetTotalVisits: number | null;
  durationDays: number | null;
  startedAt: string;
  completedAt: string | null;
  _count: { visits: number };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const [snapshots, trackerStatus, billingAccess] = await Promise.all([
    prisma.storeSnapshot.findMany({
      where: { shop },
      orderBy: { startedAt: "desc" },
      take: 50,
      select: {
        id: true,
        name: true,
        status: true,
        completionMode: true,
        targetHumanVisitors: true,
        targetTotalVisits: true,
        durationDays: true,
        startedAt: true,
        completedAt: true,
        _count: { select: { visits: true } },
      },
    }),
    getStorefrontTrackerStatus(admin, shop),
    getBillingAccess(shop),
  ]);

  return json({
    trackerStatus,
    billingAccess,
    snapshots: snapshots.map((snapshot) => ({
      ...snapshot,
      startedAt: snapshot.startedAt.toISOString(),
      completedAt: snapshot.completedAt?.toISOString() ?? null,
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType !== "create-store-snapshot") {
    return json({ error: "Invalid action" }, { status: 400 });
  }

  const rawMode = String(formData.get("completionMode") || "HUMAN_VISITORS");
  const completionMode =
    rawMode === "TOTAL_VISITS" || rawMode === "TIME_WINDOW"
      ? rawMode
      : "HUMAN_VISITORS";

  const targetHumanVisitors = parseInt(
    String(formData.get("targetHumanVisitors") || "1000"),
    10,
  );
  const targetTotalVisits = parseInt(
    String(formData.get("targetTotalVisits") || "2500"),
    10,
  );
  const durationDays = parseInt(String(formData.get("durationDays") || "7"), 10);

  try {
    await assertCanCreateStoreSnapshot(shop);
    if (completionMode === "HUMAN_VISITORS") {
      await assertSnapshotTargetAllowed(shop, targetHumanVisitors);
    }
    if (completionMode === "TOTAL_VISITS") {
      await assertSnapshotTargetAllowed(shop, targetTotalVisits);
    }
  } catch (error) {
    if (isPlanLimitError(error)) {
      return json(planLimitPayload(error), { status: error.status });
    }
    throw error;
  }

  await ensureWebPixel(admin, shop);

  const snapshot = await createStoreSnapshot({
    shop,
    name: formData.get("name") as string | null,
    completionMode,
    targetHumanVisitors,
    targetTotalVisits,
    durationDays,
  });

  return redirect(`/app/store-snapshots/${snapshot.id}`);
};

export default function StoreSnapshotsIndex() {
  const { snapshots, trackerStatus, billingAccess } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const submit = useSubmit();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState("HUMAN_VISITORS");
  const [humanTarget, setHumanTarget] = useState("1000");
  const [visitTarget, setVisitTarget] = useState("2500");
  const [durationDays, setDurationDays] = useState("7");
  const isLoading = navigation.state !== "idle";

  const handleCreate = useCallback(() => {
    const formData = new FormData();
    formData.append("action", "create-store-snapshot");
    formData.append("name", name);
    formData.append("completionMode", mode);
    formData.append("targetHumanVisitors", humanTarget);
    formData.append("targetTotalVisits", visitTarget);
    formData.append("durationDays", durationDays);
    submit(formData, { method: "POST" });
    setIsModalOpen(false);
  }, [durationDays, humanTarget, mode, name, submit, visitTarget]);

  const activeSnapshot = (snapshots as StoreSnapshotRow[]).find(
    (snapshot) => snapshot.status === "ACTIVE",
  );

  return (
    <Page
      title="Store snapshots"
      subtitle="Run one store-wide snapshot to find weak pages and choose the next focused audits."
      primaryAction={{
        content: activeSnapshot
          ? "View active snapshot"
          : billingAccess.canCreateStoreSnapshot
            ? "Start store snapshot"
            : "Upgrade to start snapshot",
        onAction: () => {
          if (activeSnapshot) {
            navigate(`/app/store-snapshots/${activeSnapshot.id}`);
            return;
          }
          if (!billingAccess.canCreateStoreSnapshot) {
            navigate("/app/upgrade");
            return;
          }
          setIsModalOpen(true);
        },
      }}
    >
      <TitleBar title="Store snapshots" />

      <BlockStack gap="400">
        <InlineStack align="end">
          <Button url="/app/upgrade" size="slim">
            {planUsagePillLabel(billingAccess, "storeSnapshots")}
          </Button>
        </InlineStack>

        <TrackingStatusBanner trackerStatus={trackerStatus} />

        {!billingAccess.canCreateStoreSnapshot && !activeSnapshot ? (
          <PremiumGateCard
            title="Store snapshots are limited on the free plan"
            message="Free stores can run one store-wide snapshot. Upgrade to keep monitoring the whole storefront."
          />
        ) : null}

        <Card padding="0">
          <div
            style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--p-color-border-subdued)",
            }}
          >
            <Text as="h2" variant="headingMd">
              Snapshot history
            </Text>
          </div>
          {(snapshots as StoreSnapshotRow[]).length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: 760,
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: "var(--p-color-bg-surface-secondary)",
                    }}
                  >
                    {[
                      "Snapshot",
                      "Status",
                      "Sessions",
                      "Page Views",
                      "Started",
                      "",
                    ].map((header) => (
                      <th
                        key={header || "actions"}
                        style={{
                          padding: "10px 20px",
                          textAlign: header === "Snapshot" ? "left" : "right",
                          borderBottom:
                            "1px solid var(--p-color-border-subdued)",
                        }}
                      >
                        <Text as="span" tone="subdued" fontWeight="semibold">
                          {header}
                        </Text>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(snapshots as StoreSnapshotRow[]).map((snapshot) => (
                    <tr key={snapshot.id}>
                      <td style={tableTextStyle}>
                        <BlockStack gap="050">
                          <Link
                            to={`/app/store-snapshots/${snapshot.id}`}
                            prefetch="intent"
                            style={{ color: "inherit", textDecoration: "none" }}
                          >
                            <Text as="span" fontWeight="semibold">
                              {snapshot.name || "Store snapshot"}
                            </Text>
                          </Link>
                          <Text as="span" tone="subdued">
                            {snapshot.id.slice(0, 8)}
                          </Text>
                        </BlockStack>
                      </td>
                      <td style={tableNumStyle}>
                        <StatusBadge status={snapshot.status} />
                      </td>
                      <td style={tableNumStyle}>{completionLabel(snapshot)}</td>
                      <td style={tableNumStyle}>
                        {snapshot._count.visits.toLocaleString()}
                      </td>
                      <td style={tableNumStyle}>
                        {new Date(snapshot.startedAt).toLocaleDateString()}
                      </td>
                      <td style={tableNumStyle}>
                        <Button
                          onClick={() =>
                            navigate(`/app/store-snapshots/${snapshot.id}`)
                          }
                          size="slim"
                        >
                          Open
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 20 }}>
              <Text as="p" tone="subdued">
                No store snapshots yet.
              </Text>
            </div>
          )}
        </Card>
      </BlockStack>

      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Start store snapshot"
        primaryAction={{
          content: "Start snapshot",
          onAction: handleCreate,
          loading: isLoading,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setIsModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Snapshot name"
              value={name}
              onChange={setName}
              autoComplete="off"
              placeholder="June store engagement"
            />
            <ChoiceList
              title="Sessions"
              choices={[
                {
                  label: "Count 1,000 engaged humans",
                  value: "HUMAN_VISITORS",
                },
                { label: "Count total sessions", value: "TOTAL_VISITS" },
                { label: "Run for a fixed time window", value: "TIME_WINDOW" },
              ]}
              selected={[mode]}
              onChange={(selected) => setMode(selected[0] || "HUMAN_VISITORS")}
            />
            {mode === "HUMAN_VISITORS" && (
              <TextField
                label="Human visitors"
                type="number"
                min={25}
                max={billingAccess.limits.maxSnapshotTargetVisitors}
                value={humanTarget}
                onChange={setHumanTarget}
                autoComplete="off"
              />
            )}
            {mode === "TOTAL_VISITS" && (
              <TextField
                label="Total sessions"
                type="number"
                min={25}
                max={billingAccess.limits.maxSnapshotTargetVisitors}
                value={visitTarget}
                onChange={setVisitTarget}
                autoComplete="off"
              />
            )}
            {mode === "TIME_WINDOW" && (
              <TextField
                label="Days"
                type="number"
                min={1}
                max={90}
                value={durationDays}
                onChange={setDurationDays}
                autoComplete="off"
              />
            )}
            {mode !== "TIME_WINDOW" ? (
              <TargetLimitText
                max={billingAccess.limits.maxSnapshotTargetVisitors}
              />
            ) : null}
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function TrackingStatusBanner({
  trackerStatus,
}: {
  trackerStatus: StorefrontTrackerStatus;
}) {
  const isActive = trackerStatus.status === "active";
  return (
    <InlineStack align="space-between" blockAlign="center" gap="300">
      <InlineStack gap="200" blockAlign="center">
        <Text as="span" variant="bodyMd" tone="subdued">
          Rich storefront tracking
        </Text>
        <Badge tone={isActive ? "success" : undefined}>
          {isActive ? "Active" : "Not active"}
        </Badge>
      </InlineStack>
      <Text as="span" tone="subdued">
        {formatStorefrontHost(trackerStatus.storefrontUrl)}
      </Text>
    </InlineStack>
  );
}

function formatStorefrontHost(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

const tableTextStyle = {
  padding: "14px 20px",
  borderBottom: "1px solid var(--p-color-border-subdued)",
  textAlign: "left" as const,
};

const tableNumStyle = {
  padding: "14px 20px",
  borderBottom: "1px solid var(--p-color-border-subdued)",
  textAlign: "right" as const,
  whiteSpace: "nowrap" as const,
};

function StatusBadge({ status }: { status: string }) {
  if (status === "ACTIVE") return <Badge tone="success">Active</Badge>;
  if (status === "PAUSED") return <Badge tone="warning">Paused</Badge>;
  return <Badge tone="info">Completed</Badge>;
}

function completionLabel(snapshot: StoreSnapshotRow) {
  if (snapshot.completionMode === "TOTAL_VISITS") {
    return `${snapshot.targetTotalVisits?.toLocaleString() || "Total"} sessions`;
  }
  if (snapshot.completionMode === "TIME_WINDOW") {
    return `${snapshot.durationDays || 7} days`;
  }
  return `${snapshot.targetHumanVisitors?.toLocaleString() || "Human"} humans`;
}
