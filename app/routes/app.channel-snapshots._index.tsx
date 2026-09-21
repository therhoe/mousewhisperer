import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Link,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  FormLayout,
  InlineStack,
  Modal,
  Page,
  Pagination,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ensureWebPixel } from "../utils/web-pixel.server";
import {
  ChannelSnapshotError,
  createChannelSnapshot,
  listChannelSnapshots,
} from "../utils/channel-snapshot.server";
import {
  getBillingDisplayAccess,
  isPlanLimitError,
  planLimitPayload,
} from "../utils/billing.server";
import { planUsagePillLabel, TargetLimitText } from "../components/PremiumGate";
import { ChannelPerformanceCard } from "../components/ChannelPerformanceCard";
import {
  getChannelOverview,
  type ChannelOverview,
} from "../utils/channel-overview.server";

import { clearCacheKey, loaderCacheKeys } from "../utils/loader-cache.server";

type OverviewResponse = { overview?: ChannelOverview; error?: string };

async function getChannelIndexShell(shop: string, page: number) {
  const [history, billingAccess] = await Promise.all([
    listChannelSnapshots(shop, page),
    getBillingDisplayAccess(shop),
  ]);
  return { ...history, billingAccess };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  if (url.searchParams.get("_overview") === "1") {
    try {
      const overview = await getChannelOverview(session.shop, {
        force: url.searchParams.get("_refresh") === "1",
      });
      return json(
        { overview },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    } catch (error) {
      console.error("Channel performance could not be loaded", error);
      return json(
        {
          error:
            "Channel performance could not be loaded. Please retry the graph.",
        },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    }
  }
  const requestedPage = Number(url.searchParams.get("page"));
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  return json(await getChannelIndexShell(session.shop, page));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("action") !== "create-channel-snapshot") {
    return json({ error: "Invalid action." }, { status: 400 });
  }

  const completionMode = String(formData.get("completionMode") || "");
  if (
    completionMode !== "HUMAN_SESSIONS" &&
    completionMode !== "TOTAL_SESSIONS" &&
    completionMode !== "TIME_WINDOW"
  ) {
    return json(
      { error: "Choose how this snapshot should finish." },
      { status: 400 },
    );
  }

  try {
    const pixelSetup = await ensureWebPixel(admin, session.shop);
    if (pixelSetup?.ready === false) {
      return json(
        {
          error:
            "Checkout tracking could not be configured. No snapshot was started. Please retry in a moment.",
        },
        { status: 503 },
      );
    }
    const snapshot = await createChannelSnapshot({
      shop: session.shop,
      name: String(formData.get("name") || "").trim() || "Channel snapshot",
      completionMode,
      targetSessions:
        completionMode === "TIME_WINDOW"
          ? undefined
          : Number(formData.get("targetSessions")),
      durationDays:
        completionMode === "TIME_WINDOW"
          ? Number(formData.get("durationDays"))
          : undefined,
    });
    clearCacheKey(loaderCacheKeys.billingDisplay(session.shop));
    return redirect(`/app/channel-snapshots/${snapshot.id}`);
  } catch (error) {
    if (isPlanLimitError(error)) {
      return json(planLimitPayload(error), { status: error.status });
    }
    if (error instanceof ChannelSnapshotError) {
      return json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
};

export default function ChannelSnapshotsIndex() {
  const { snapshots, page, pageCount, total, activeSnapshotId, billingAccess } =
    useLoaderData<Awaited<ReturnType<typeof getChannelIndexShell>>>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const submit = useSubmit();
  const [, setSearchParams] = useSearchParams();
  const overviewFetcher = useFetcher<OverviewResponse>();
  const overviewLoadRef = useRef(overviewFetcher.load);
  const [overview, setOverview] = useState<ChannelOverview | null>(null);
  useEffect(() => {
    overviewLoadRef.current = overviewFetcher.load;
  }, [overviewFetcher.load]);
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      overviewLoadRef.current("/app/channel-snapshots?_overview=1");
    }, 100);
    return () => window.clearTimeout(timeoutId);
  }, [activeSnapshotId]);
  useEffect(() => {
    if (overviewFetcher.data?.overview)
      setOverview(overviewFetcher.data.overview);
  }, [overviewFetcher.data]);
  const chartData = overviewFetcher.data?.overview || overview;
  const chartError = overviewFetcher.data?.error;
  const chartLoading =
    overviewFetcher.state !== "idle" || (!chartData && !chartError);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState("HUMAN_SESSIONS");
  const [targetSessions, setTargetSessions] = useState(
    String(Math.min(1000, billingAccess.limits.maxSnapshotTargetVisitors)),
  );
  const [durationDays, setDurationDays] = useState("7");
  const isSubmitting =
    navigation.state !== "idle" &&
    navigation.formMethod?.toUpperCase() === "POST";
  const errorMessage =
    actionData && "error" in actionData ? actionData.error : null;

  function changePage(nextPage: number) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("page", String(nextPage));
        return next;
      },
      { preventScrollReset: true },
    );
  }

  function startSnapshot() {
    const formData = new FormData();
    formData.set("action", "create-channel-snapshot");
    formData.set("name", name);
    formData.set("completionMode", mode);
    formData.set("targetSessions", targetSessions);
    formData.set("durationDays", durationDays);
    // Keep the form open on a validation/plan error. Success redirects to the report.
    submit(formData, { method: "POST" });
  }

  return (
    <Page
      title="Channel Snapshots"
      backAction={{ content: "Dashboard", url: "/app" }}
      primaryAction={{
        content: activeSnapshotId
          ? "View active snapshot"
          : billingAccess.canCreateNormalSnapshot
            ? "Start channel snapshot"
            : "Upgrade to start snapshot",
        onAction: () => {
          if (activeSnapshotId)
            navigate(`/app/channel-snapshots/${activeSnapshotId}`);
          else if (!billingAccess.canCreateNormalSnapshot)
            navigate("/app/upgrade");
          else setIsModalOpen(true);
        },
      }}
      secondaryActions={[
        {
          content: planUsagePillLabel(billingAccess, "normalSnapshots"),
          url: "/app/upgrade",
        },
      ]}
    >
      <TitleBar title="Channel Snapshots" />
      <div style={{ paddingBottom: 48 }}>
        <BlockStack gap="400">
          {errorMessage && !isModalOpen ? (
            <Banner tone="critical" title="Snapshot could not be started">
              <p>{errorMessage}</p>
            </Banner>
          ) : null}
          <ChannelPerformanceCard
            data={chartData}
            loading={chartLoading}
            error={chartError}
            onRefresh={() =>
              overviewLoadRef.current(
                "/app/channel-snapshots?_overview=1&_refresh=1",
              )
            }
          />
          <Card padding="0">
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--p-color-border-subdued)",
              }}
            >
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <Text as="h2" variant="headingMd">
                  Snapshot history
                </Text>
                <Text as="span" tone="subdued">
                  {total.toLocaleString()}{" "}
                  {total === 1 ? "snapshot" : "snapshots"}
                </Text>
              </InlineStack>
            </div>
            {snapshots.length > 0 ? (
              <div
                style={{ overflowX: "auto" }}
                aria-busy={navigation.state !== "idle"}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: 760,
                  }}
                  aria-label="Channel snapshot history"
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
                        "Captured sessions",
                        "Completion",
                        "Started",
                        "",
                      ].map((header) => (
                        <th
                          key={header || "actions"}
                          scope="col"
                          style={{
                            ...tableCellStyle,
                            textAlign:
                              header === "Captured sessions" ? "right" : "left",
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
                    {snapshots.map((snapshot) => (
                      <tr key={snapshot.id}>
                        <td style={tableCellStyle}>
                          <Link
                            to={`/app/channel-snapshots/${snapshot.id}`}
                            prefetch="intent"
                            style={{ color: "inherit" }}
                          >
                            <Text as="span" fontWeight="semibold">
                              {snapshot.name || "Channel snapshot"}
                            </Text>
                          </Link>
                        </td>
                        <td style={tableCellStyle}>
                          <StatusBadge status={snapshot.status} />
                        </td>
                        <td style={{ ...tableCellStyle, textAlign: "right" }}>
                          {snapshot._count.sessions.toLocaleString()}
                        </td>
                        <td style={tableCellStyle}>
                          {snapshot.completionMode === "TIME_WINDOW"
                            ? `${snapshot.durationDays ?? 0} days`
                            : `${(snapshot.targetSessions ?? 0).toLocaleString()} ${snapshot.completionMode === "HUMAN_SESSIONS" ? "human sessions" : "total sessions"}`}
                        </td>
                        <td style={tableCellStyle}>
                          {formatDate(snapshot.startedAt)}
                        </td>
                        <td style={tableCellStyle}>
                          <Button
                            url={`/app/channel-snapshots/${snapshot.id}`}
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
              <div style={{ padding: 24 }}>
                <BlockStack gap="200" inlineAlign="center">
                  <Text as="h3" variant="headingSm">
                    No channel snapshots yet
                  </Text>
                  <Text as="p" tone="subdued">
                    Start a snapshot to compare new arrivals by channel, source,
                    and campaign.
                  </Text>
                </BlockStack>
              </div>
            )}
            {pageCount > 1 ? (
              <div style={{ padding: "16px 20px" }}>
                <InlineStack align="center">
                  <Pagination
                    label={`Page ${page} of ${pageCount}`}
                    hasPrevious={page > 1 && navigation.state === "idle"}
                    onPrevious={() => changePage(page - 1)}
                    hasNext={page < pageCount && navigation.state === "idle"}
                    onNext={() => changePage(page + 1)}
                  />
                </InlineStack>
              </div>
            ) : null}
          </Card>
          <Text as="p" tone="subdued" variant="bodySm">
            Dates are shown in UTC.
          </Text>
          <details
            style={{ color: "var(--p-color-text-subdued)", fontSize: 12 }}
          >
            <summary style={{ cursor: "pointer" }}>
              How channel traffic is measured
            </summary>
            <p>
              Snapshot tracking counts an acquisition session once and keeps its
              arrival channel across internal page views. A fresh external or
              campaign arrival, or 30 minutes of inactivity, starts a new
              session. Historical traffic is not imported.
            </p>
            <p>
              Human sessions are Real + Zombie. Conversion rate uses converted
              human sessions ÷ human sessions; real traffic share uses Real ÷
              all sessions. These are Snapshot metrics, not Shopify Analytics.
              The graph shows one capture only, with conversions assigned to the
              session’s first captured time bucket. Channel and page snapshots
              share the existing snapshot allowance.
            </p>
          </details>
        </BlockStack>
      </div>
      <Modal
        open={isModalOpen}
        onClose={() => {
          if (!isSubmitting) setIsModalOpen(false);
        }}
        title="Start channel snapshot"
        primaryAction={{
          content: "Start snapshot",
          onAction: startSnapshot,
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setIsModalOpen(false),
            disabled: isSubmitting,
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            {errorMessage ? (
              <Banner tone="critical">
                <p>{errorMessage}</p>
              </Banner>
            ) : null}
            <TextField
              label="Snapshot name"
              value={name}
              onChange={setName}
              autoComplete="off"
              maxLength={100}
              placeholder="August traffic quality"
              disabled={isSubmitting}
            />
            <Select
              label="Finish the snapshot when"
              options={[
                {
                  label: "A human-session target is reached",
                  value: "HUMAN_SESSIONS",
                },
                {
                  label: "A total-session target is reached",
                  value: "TOTAL_SESSIONS",
                },
                { label: "A fixed time window ends", value: "TIME_WINDOW" },
              ]}
              value={mode}
              onChange={setMode}
              disabled={isSubmitting}
            />
            {mode === "TIME_WINDOW" ? (
              <TextField
                label="Days"
                type="number"
                min={1}
                max={90}
                value={durationDays}
                onChange={setDurationDays}
                autoComplete="off"
                disabled={isSubmitting}
                helpText="The snapshot closes at the end of this window."
              />
            ) : (
              <>
                <TextField
                  label={
                    mode === "HUMAN_SESSIONS"
                      ? "Human sessions"
                      : "Total sessions"
                  }
                  type="number"
                  min={25}
                  max={billingAccess.limits.maxSnapshotTargetVisitors}
                  value={targetSessions}
                  onChange={setTargetSessions}
                  autoComplete="off"
                  disabled={isSubmitting}
                  helpText={
                    mode === "HUMAN_SESSIONS"
                      ? "Real + Zombie sessions; bots and unclassified sessions do not count toward this target."
                      : "Every recorded acquisition session, including bots and sessions awaiting classification."
                  }
                />
                <TargetLimitText
                  max={billingAccess.limits.maxSnapshotTargetVisitors}
                />
              </>
            )}
            <Text as="p" tone="subdued" variant="bodySm">
              Starting this snapshot uses one of your existing snapshot
              credits.
            </Text>
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

const tableCellStyle = {
  padding: "14px 20px",
  textAlign: "left" as const,
  borderBottom: "1px solid var(--p-color-border-subdued)",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      tone={
        status === "ACTIVE"
          ? "success"
          : status === "PAUSED"
            ? "warning"
            : "info"
      }
    >
      {status === "ACTIVE"
        ? "Active"
        : status === "PAUSED"
          ? "Paused"
          : "Completed"}
    </Badge>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
