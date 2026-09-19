import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSearchParams,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Modal,
  Page,
  Pagination,
  ProgressBar,
  Select,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  ChannelSnapshotError,
  getChannelSnapshotReport,
  transitionChannelSnapshot,
} from "../utils/channel-snapshot.server";
import { isPlanLimitError, planLimitPayload } from "../utils/billing.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!params.id)
    throw new Response("Channel snapshot ID required", { status: 400 });
  const url = new URL(request.url);
  const filters = {
    channel: url.searchParams.get("channel") || "",
    source: url.searchParams.get("source") || "",
    campaign: url.searchParams.get("campaign") || "",
  };
  const requestedPage = Number(url.searchParams.get("page"));
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const report = await getChannelSnapshotReport(session.shop, params.id, {
    ...filters,
    page,
  });
  if (!report)
    throw new Response("Channel snapshot not found", { status: 404 });
  return json({ report, filters });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!params.id)
    return json({ error: "Channel snapshot ID required." }, { status: 400 });
  const formData = await request.formData();
  const actionType = formData.get("action");
  if (
    actionType !== "pause" &&
    actionType !== "resume" &&
    actionType !== "complete"
  ) {
    return json({ error: "Invalid action." }, { status: 400 });
  }
  try {
    await transitionChannelSnapshot(session.shop, params.id, actionType);
    return json({ success: true });
  } catch (error) {
    if (isPlanLimitError(error))
      return json(planLimitPayload(error), { status: error.status });
    if (error instanceof ChannelSnapshotError)
      return json({ error: error.message }, { status: error.status });
    throw error;
  }
};

export default function ChannelSnapshotDetail() {
  const { report, filters } = useLoaderData<typeof loader>();
  const {
    snapshot,
    summary,
    rows,
    options,
    page,
    pageCount,
    totalRows,
    capturedSessions,
    progress,
  } = report;
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const transition = useFetcher<{ success?: boolean; error?: string }>();
  const [, setSearchParams] = useSearchParams();
  const [showPercentages, setShowPercentages] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const isBusy =
    navigation.state !== "idle" ||
    transition.state !== "idle" ||
    revalidator.state !== "idle";
  const hasFilters = Boolean(
    filters.channel || filters.source || filters.campaign,
  );
  const errorMessage = transition.data?.error;

  useEffect(() => {
    if (transition.state === "idle" && transition.data?.success)
      setConfirmComplete(false);
  }, [transition.state, transition.data]);

  function changeFilter(key: "channel" | "source" | "campaign", value: string) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete("page");
        return next;
      },
      { preventScrollReset: true },
    );
  }

  function clearFilters() {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        ["channel", "source", "campaign", "page"].forEach((key) =>
          next.delete(key),
        );
        return next;
      },
      { preventScrollReset: true },
    );
  }

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

  function changeStatus(actionType: "pause" | "resume" | "complete") {
    transition.submit({ action: actionType }, { method: "POST" });
  }

  return (
    <Page
      title={snapshot.name || "Channel snapshot"}
      subtitle="Snapshot acquisition sessions across your store"
      backAction={{
        content: "Channel Snapshots",
        url: "/app/channel-snapshots",
      }}
      titleMetadata={
        <Badge
          tone={
            snapshot.status === "ACTIVE"
              ? "success"
              : snapshot.status === "PAUSED"
                ? "warning"
                : "info"
          }
        >
          {snapshot.status === "ACTIVE"
            ? "Active"
            : snapshot.status === "PAUSED"
              ? "Paused"
              : "Completed"}
        </Badge>
      }
      primaryAction={
        snapshot.status === "COMPLETED"
          ? undefined
          : {
              content:
                snapshot.status === "PAUSED"
                  ? "Resume snapshot"
                  : "Pause snapshot",
              onAction: () =>
                changeStatus(snapshot.status === "PAUSED" ? "resume" : "pause"),
              disabled: isBusy,
            }
      }
      secondaryActions={[
        {
          content: "Refresh",
          onAction: () => revalidator.revalidate(),
          disabled: isBusy,
        },
        ...(snapshot.status !== "COMPLETED"
          ? [
              {
                content: "Complete snapshot",
                onAction: () => setConfirmComplete(true),
                disabled: isBusy,
              },
            ]
          : []),
      ]}
    >
      <TitleBar title="Channel Snapshots" />
      <div style={{ paddingBottom: 48 }}>
        <BlockStack gap="400">
          {errorMessage ? (
            <Banner tone="critical" title="Snapshot could not be updated">
              <p>{errorMessage}</p>
            </Banner>
          ) : null}
          {snapshot.status === "PAUSED" ? (
            <Banner tone="info">
              <p>
                Collection is paused. Existing results remain available; resume
                the snapshot to collect new sessions.
              </p>
            </Banner>
          ) : null}
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center" gap="300">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    {progress.label}
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Started {formatDate(snapshot.startedAt)}
                    {snapshot.completedAt
                      ? ` · Completed ${formatDate(snapshot.completedAt)}`
                      : snapshot.endsAt
                        ? ` · Ends ${formatDate(snapshot.endsAt)}`
                        : ""}
                    {" · UTC"}
                  </Text>
                </BlockStack>
                <BlockStack gap="100" inlineAlign="end">
                  <Text as="span" fontWeight="semibold">
                    {snapshot.completionMode === "TIME_WINDOW"
                      ? `${formatPercent(progress.percent)} of the window elapsed`
                      : `${formatCount(progress.current)} / ${formatCount(progress.target ?? 0)}`}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {formatCount(capturedSessions)} captured sessions in total
                  </Text>
                </BlockStack>
              </InlineStack>
              <ProgressBar
                progress={Math.max(0, Math.min(100, progress.percent))}
                size="small"
              />
              <Text as="p" tone="subdued" variant="bodySm">
                Each session keeps its arrival channel across internal page
                views. A fresh external or campaign arrival, or 30 minutes of
                inactivity, starts a new acquisition session.
              </Text>
            </BlockStack>
          </Card>
          <Card padding="0">
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--p-color-border-subdued)",
              }}
            >
              <BlockStack gap="300">
                <InlineStack
                  align="space-between"
                  blockAlign="center"
                  gap="300"
                >
                  <Text as="h2" variant="headingMd">
                    Traffic quality by source
                  </Text>
                  <Button
                    variant="plain"
                    pressed={showPercentages}
                    onClick={() => setShowPercentages((value) => !value)}
                  >
                    {showPercentages ? "Hide percentages" : "Show percentages"}
                  </Button>
                </InlineStack>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 16,
                  }}
                >
                  <Select
                    label="Channel"
                    options={filterOptions(
                      options.channels,
                      "All channels",
                      filters.channel,
                    )}
                    value={filters.channel}
                    onChange={(value) => changeFilter("channel", value)}
                    disabled={isBusy}
                  />
                  <Select
                    label="Source"
                    options={filterOptions(
                      options.sources,
                      "All sources",
                      filters.source,
                      "No source",
                    )}
                    value={filters.source}
                    onChange={(value) => changeFilter("source", value)}
                    disabled={isBusy}
                  />
                  <Select
                    label="Campaign"
                    options={filterOptions(
                      options.campaigns,
                      "All campaigns",
                      filters.campaign,
                      "No campaign",
                    )}
                    value={filters.campaign}
                    onChange={(value) => changeFilter("campaign", value)}
                    disabled={isBusy}
                  />
                </div>
                {hasFilters ? (
                  <InlineStack
                    align="space-between"
                    blockAlign="center"
                    gap="200"
                  >
                    <Text as="span" tone="subdued" variant="bodySm">
                      Summary and rows reflect the selected filters.
                    </Text>
                    <Button
                      variant="plain"
                      onClick={clearFilters}
                      disabled={isBusy}
                    >
                      Clear filters
                    </Button>
                  </InlineStack>
                ) : null}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                    gap: 20,
                  }}
                  aria-busy={isBusy}
                >
                  <SummaryMetric
                    label="Sessions"
                    value={formatCount(summary.sessions)}
                  />
                  <SummaryMetric
                    label="Human sessions"
                    value={formatCount(summary.humanSessions)}
                  />
                  <SummaryMetric
                    label="Page views"
                    value={formatCount(summary.pageViews)}
                  />
                  <SummaryMetric
                    label="Converted sessions"
                    value={formatCount(summary.conversions)}
                  />
                  <SummaryMetric
                    label="Snapshot conversion rate"
                    value={
                      summary.humanSessions > 0
                        ? formatPercent(summary.conversionRate)
                        : "—"
                    }
                  />
                </div>
              </BlockStack>
            </div>
            {rows.length > 0 ? (
              <div style={{ overflowX: "auto" }} aria-busy={isBusy}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: showPercentages ? 1320 : 1080,
                  }}
                  aria-label="Traffic quality by acquisition channel, source, and campaign"
                >
                  <thead>
                    <tr
                      style={{
                        background: "var(--p-color-bg-surface-secondary)",
                      }}
                    >
                      {[
                        "Channel / source",
                        "Campaign",
                        "Sessions",
                        "Real",
                        "Zombie",
                        "Bot",
                        "Add to cart",
                        "Conversions",
                        "Avg time",
                        "Avg scroll",
                      ].map((header, index) => (
                        <th
                          key={header}
                          scope="col"
                          style={{
                            ...tableCellStyle,
                            textAlign: index < 2 ? "left" : "right",
                          }}
                        >
                          <Text as="span" fontWeight="semibold" tone="subdued">
                            {header}
                          </Text>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key}>
                        <td style={{ ...tableCellStyle, minWidth: 190 }}>
                          <BlockStack gap="050">
                            <Text as="span" fontWeight="semibold">
                              {row.channel}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {row.source || "No source"}
                              {row.medium ? ` / ${row.medium}` : ""}
                            </Text>
                          </BlockStack>
                        </td>
                        <td
                          style={{
                            ...tableCellStyle,
                            maxWidth: 220,
                            overflowWrap: "anywhere",
                          }}
                        >
                          {row.campaign || "No campaign"}
                        </td>
                        <td style={numberCellStyle}>
                          {formatCount(row.sessions)}
                        </td>
                        <td
                          style={{
                            ...numberCellStyle,
                            color: "var(--p-color-text-success)",
                          }}
                        >
                          {countAndPercent(
                            row.real,
                            row.sessions,
                            showPercentages,
                          )}
                        </td>
                        <td
                          style={{
                            ...numberCellStyle,
                            color: "var(--p-color-text-caution)",
                          }}
                        >
                          {countAndPercent(
                            row.zombies,
                            row.sessions,
                            showPercentages,
                          )}
                        </td>
                        <td
                          style={{
                            ...numberCellStyle,
                            color: "var(--p-color-text-critical)",
                          }}
                        >
                          {countAndPercent(
                            row.bots,
                            row.sessions,
                            showPercentages,
                          )}
                        </td>
                        <td style={numberCellStyle}>
                          {formatCount(row.addedToCart)}
                          {showPercentages && row.humanSessions > 0
                            ? ` (${formatPercent(row.atcRate)})`
                            : ""}
                        </td>
                        <td style={numberCellStyle}>
                          {formatCount(row.conversions)}
                          {showPercentages && row.humanSessions > 0
                            ? ` (${formatPercent(row.conversionRate)})`
                            : ""}
                        </td>
                        <td style={numberCellStyle}>
                          {row.humanSessions > 0
                            ? formatDuration(row.averageTimeSeconds)
                            : "—"}
                        </td>
                        <td style={numberCellStyle}>
                          {row.humanSessions > 0
                            ? formatPercent(row.averageScrollDepth)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: "32px 20px" }}>
                <BlockStack gap="200" inlineAlign="center">
                  <Text as="h3" variant="headingSm">
                    {capturedSessions === 0
                      ? "No sessions captured yet"
                      : "No traffic matches these filters"}
                  </Text>
                  <Text as="p" tone="subdued">
                    {capturedSessions === 0
                      ? snapshot.status === "ACTIVE"
                        ? "New tracked visits will appear here. This snapshot does not import historical traffic."
                        : "This snapshot has no recorded acquisition sessions."
                      : "Choose another channel, source, or campaign, or clear the filters."}
                  </Text>
                </BlockStack>
              </div>
            )}
            <div style={{ padding: "16px 20px" }}>
              <BlockStack gap="300">
                {pageCount > 1 ? (
                  <InlineStack
                    align="space-between"
                    blockAlign="center"
                    gap="200"
                  >
                    <Text as="span" tone="subdued" variant="bodySm">
                      {formatCount((page - 1) * 10 + 1)}–
                      {formatCount(Math.min(page * 10, totalRows))} of{" "}
                      {formatCount(totalRows)} source groups
                    </Text>
                    <Pagination
                      label={`Page ${page} of ${pageCount}`}
                      hasPrevious={page > 1 && !isBusy}
                      onPrevious={() => changePage(page - 1)}
                      hasNext={page < pageCount && !isBusy}
                      onNext={() => changePage(page + 1)}
                    />
                  </InlineStack>
                ) : null}
                <Text as="p" tone="subdued" variant="bodySm">
                  Quality percentages use all sessions in that row. Add-to-cart
                  and conversion rates use human sessions (Real + Zombie).
                  Conversions count sessions that converted, not the number of
                  orders.
                </Text>
              </BlockStack>
            </div>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                About these numbers
              </Text>
              <Text as="p" tone="subdued">
                CVR = converted human sessions ÷ human sessions (Real + Zombie).
                Snapshot session rules differ from Shopify Analytics, so this
                report should not be treated as the same metric as the
                dashboard’s Shopify CVR.
              </Text>
              <Text as="p" tone="subdued">
                Unknown means the arrival source was not available. It is not
                assumed to be Direct. Pending sessions have not yet received a
                traffic-quality classification.
              </Text>
              {summary.unknownSessions > 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  {formatCount(summary.unknownSessions)}{" "}
                  {summary.unknownSessions === 1
                    ? "session has"
                    : "sessions have"}{" "}
                  an unknown arrival channel
                  {hasFilters ? " in the selected traffic" : ""}.
                </Text>
              ) : null}
            </BlockStack>
          </Card>
        </BlockStack>
      </div>
      <Modal
        open={confirmComplete}
        onClose={() => {
          if (transition.state === "idle") setConfirmComplete(false);
        }}
        title="Complete this snapshot?"
        primaryAction={{
          content: "Complete snapshot",
          onAction: () => changeStatus("complete"),
          loading: transition.state !== "idle",
        }}
        secondaryActions={[
          {
            content: "Keep collecting",
            onAction: () => setConfirmComplete(false),
            disabled: transition.state !== "idle",
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            {errorMessage ? (
              <Banner tone="critical">
                <p>{errorMessage}</p>
              </Banner>
            ) : null}
            <Text as="p">
              This stops collecting new sessions. The report stays available and
              may still receive checkout updates for sessions already captured.
              A completed snapshot cannot be resumed.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

const tableCellStyle = {
  padding: "14px 16px",
  borderBottom: "1px solid var(--p-color-border-subdued)",
  textAlign: "left" as const,
};
const numberCellStyle = {
  ...tableCellStyle,
  textAlign: "right" as const,
  whiteSpace: "nowrap" as const,
};

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <BlockStack gap="100">
      <Text as="p" variant="bodySm" tone="subdued">
        {label}
      </Text>
      <Text as="p" variant="headingLg">
        {value}
      </Text>
    </BlockStack>
  );
}

function filterOptions(
  values: string[],
  allLabel: string,
  current: string,
  missingLabel = "Unknown",
) {
  const available =
    current && !values.includes(current) ? [...values, current] : values;
  return [
    { label: allLabel, value: "" },
    ...available.map((value) => ({
      label: value === "__none__" ? missingLabel : value,
      value,
    })),
  ];
}

function formatCount(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function formatPercent(value: number) {
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

function countAndPercent(count: number, sessions: number, expanded: boolean) {
  return `${formatCount(count)}${expanded ? ` (${formatPercent(sessions > 0 ? (count / sessions) * 100 : 0)})` : ""}`;
}

function formatDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
