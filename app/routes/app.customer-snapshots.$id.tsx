import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useFetcher,
  useLoaderData,
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
  Spinner,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { downloadCustomerJourney } from "../utils/customer-journey-download";
import { authenticate } from "../shopify.server";
import {
  CustomerSnapshotError,
  getCustomerSnapshotReport,
  transitionCustomerSnapshot,
} from "../utils/customer-journey.server";
import {
  buildJourneyLink,
  inspectJourneyLink,
} from "../utils/customer-journey";
import type { loader as journeyLoader } from "./app.customer-snapshots.$id_.journey.$sessionId";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const report = await getCustomerSnapshotReport(
    session.shop,
    params.id || "",
    new URL(request.url).searchParams.get("page"),
  );
  if (!report) throw new Response("Snapshot not found", { status: 404 });
  return json(report, { headers: { "Cache-Control": "private, no-store" } });
};
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  try {
    await transitionCustomerSnapshot(
      session.shop,
      params.id || "",
      String(form.get("action")),
    );
    return json({ success: true, error: null });
  } catch (error) {
    if (error instanceof CustomerSnapshotError)
      return json(
        { success: false, error: error.message },
        { status: error.status },
      );
    throw error;
  }
};

export default function CustomerSnapshotDetail() {
  const {
    snapshot,
    sessions,
    total,
    humans,
    carts,
    checkouts,
    conversions,
    page,
    pageCount,
  } = useLoaderData<typeof loader>();
  const transition = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [searchParams, setParams] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(
    searchParams.get("journey"),
  );
  const [confirm, setConfirm] = useState(false);
  const [showSetup, setShowSetup] = useState(total === 0);
  const [testUrl, setTestUrl] = useState("");
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const generatedLink = buildJourneyLink(snapshot.destinationUrl, snapshot);
  const full =
    snapshot.targetSessions != null && total >= snapshot.targetSessions;
  const busy = transition.state !== "idle" || revalidator.state !== "idle";
  const move = (next: number) =>
    setParams(
      (p) => {
        p.set("page", String(next));
        return p;
      },
      { preventScrollReset: true },
    );
  const statusLabel =
    snapshot.status === "ACTIVE"
      ? full
        ? "Following admitted sessions"
        : "Collecting"
      : snapshot.status === "PAUSED"
        ? "Paused"
        : "Completed";

  return (
    <Page
      title={snapshot.name}
      subtitle={`${snapshot.source}${snapshot.campaign ? ` · ${snapshot.campaign}` : ""}${snapshot.adId ? ` · Ad ${snapshot.adId}` : ""}`}
      backAction={{
        content: "Customer Snapshots",
        url: "/app/customer-snapshots",
      }}
      titleMetadata={
        <Badge tone={snapshot.status === "ACTIVE" ? "success" : "info"}>
          {statusLabel}
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
              disabled: busy,
              onAction: () =>
                transition.submit(
                  { action: snapshot.status === "PAUSED" ? "resume" : "pause" },
                  { method: "POST" },
                ),
            }
      }
      secondaryActions={[
        {
          content: "Refresh",
          disabled: busy,
          onAction: () => revalidator.revalidate(),
        },
        ...(snapshot.status !== "COMPLETED"
          ? [
              {
                content: "Complete snapshot",
                disabled: busy,
                onAction: () => setConfirm(true),
              },
            ]
          : []),
      ]}
    >
      <TitleBar title="Customer Snapshots" />
      <div style={{ paddingBottom: 48 }}>
        <BlockStack gap="400">
          {transition.data?.error && (
            <Banner tone="critical">
              <p>{transition.data.error}</p>
            </Banner>
          )}
          {snapshot.status === "PAUSED" && (
            <Banner>
              <p>
                Page and click collection is paused. Already captured checkouts
                can still report their outcome within the session window.
              </p>
            </Banner>
          )}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <Text as="h2" variant="headingMd">
                  Journey overview
                </Text>
                <Text as="span" tone="subdued">
                  {date(snapshot.startedAt)} – {snapshot.endsAt ? date(snapshot.endsAt) : "Until the measurement completes"} · UTC
                </Text>
              </InlineStack>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                  gap: 16,
                }}
              >
                {[
                  ["Captured sessions", total.toLocaleString()],
                  ["Human sessions", humans.toLocaleString()],
                  ["Added to cart", carts.toLocaleString()],
                  ["Started checkout", checkouts.toLocaleString()],
                  ["Purchased", conversions.toLocaleString()],
                  [
                    "Conversion rate",
                    humans
                      ? `${((conversions / humans) * 100).toFixed(1)}%`
                      : "—",
                  ],
                ].map(([label, value]) => (
                  <BlockStack gap="100" key={label}>
                    <Text as="p" tone="subdued">
                      {label}
                    </Text>
                    <Text as="p" variant="headingXl">
                      {value}
                    </Text>
                  </BlockStack>
                ))}
              </div>
              <Text as="p" tone="subdued" variant="bodySm">
                Cart, checkout, and purchase totals count human sessions once.
                Conversion rate = purchasing human sessions ÷ human sessions
                (Real + Zombie).
              </Text>
              <Text as="p" tone="subdued">
                {total.toLocaleString()} /{" "}
                {snapshot.targetSessions?.toLocaleString() || "—"} matching
                sessions
                {full
                  ? " · Enrollment is full. Existing sessions can finish until the capture window ends."
                  : ""}
              </Text>
            </BlockStack>
          </Card>
          {!snapshot.captureAllSources && <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Campaign link
                </Text>
                <Button
                  variant="plain"
                  onClick={() => setShowSetup(!showSetup)}
                >
                  {showSetup ? "Hide setup" : "Show setup"}
                </Button>
              </InlineStack>
              {showSetup && (
                <>
                  <TextField
                    label="Use this link in your campaign"
                    value={generatedLink}
                    autoComplete="off"
                    multiline={2}
                    readOnly
                  />
                  <InlineStack gap="300">
                    <Button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(generatedLink);
                          setCopied(true);
                        } catch {
                          setCopied(false);
                        }
                      }}
                    >
                      {copied ? "Copied" : "Copy link"}
                    </Button>
                  </InlineStack>
                  <TextField
                    label="Test tracking link"
                    value={testUrl}
                    onChange={(value) => {
                      setTestUrl(value);
                      setCheck(null);
                    }}
                    autoComplete="off"
                    placeholder="Paste the final URL after clicking your ad"
                  />
                  <Button
                    onClick={() =>
                      setCheck(
                        inspectJourneyLink(testUrl || generatedLink, snapshot),
                      )
                    }
                  >
                    Check link tags
                  </Button>
                  {check && (
                    <Banner tone={check.ok ? "success" : "warning"}>
                      <p>{check.message}</p>
                    </Banner>
                  )}
                  <Text as="p" tone="subdued">
                    After updating the ad link, open it in a fresh browser
                    session, allow analytics consent, browse the store, and
                    refresh this report. Matching arrivals must start after this
                    snapshot was created. Untagged ad IDs cannot be inferred
                    from a click ID.
                  </Text>
                </>
              )}
            </BlockStack>
          </Card>}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Visitor journeys
                </Text>
                <Text as="span" tone="subdued">
                  {total.toLocaleString()} sessions
                </Text>
              </InlineStack>
              {!sessions.length ? (
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">
                    Waiting for matching arrivals
                  </Text>
                  <Text as="p" tone="subdued">
                    {snapshot.captureAllSources
                      ? "New consented visits from all sources will appear here with a timeline of their actions."
                      : "Use the campaign link above. Each captured visitor will appear here with a timeline of their actions."}
                  </Text>
                </BlockStack>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      textAlign: "left",
                    }}
                  >
                    <thead>
                      <tr>
                        {[
                          "Session · UTC",
                          "Landing page",
                          "Quality",
                          "Pages",
                          "Outcome",
                          "",
                        ].map((label) => (
                          <th
                            key={label}
                            style={{
                              padding: 12,
                              background: "var(--p-color-bg-surface-secondary)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((s) => (
                        <tr key={s.id}>
                          <td style={cell}>{dateTime(s.startedAt)}</td>
                          <td
                            style={{
                              ...cell,
                              maxWidth: 260,
                              overflowWrap: "anywhere",
                            }}
                          >
                            {s.landingPath}
                          </td>
                          <td style={cell}>
                            {s.visitorType === "REAL"
                              ? "Real"
                              : s.visitorType === "ZOMBIE"
                                ? "Zombie"
                                : s.visitorType === "BOT"
                                  ? "Bot"
                                  : "Assessing"}
                          </td>
                          <td style={cell}>{s._count.pages}</td>
                          <td style={cell}>
                            <Badge tone={s.converted ? "success" : "info"}>
                              {s.converted
                                ? "Purchased"
                                : s.checkoutStarted
                                  ? "Checkout"
                                  : s.addedToCart
                                    ? "Added to cart"
                                    : "Browsing"}
                            </Badge>
                          </td>
                          <td style={cell}>
                            <Button onClick={() => setSelected(s.id)}>
                              View journey
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {pageCount > 1 && (
                <Pagination
                  label={`Page ${page} of ${pageCount}`}
                  hasPrevious={page > 1}
                  hasNext={page < pageCount}
                  onPrevious={() => move(page - 1)}
                  onNext={() => move(page + 1)}
                />
              )}
            </BlockStack>
          </Card>
          <Text as="p" tone="subdued">
            Anonymous sessions end after 30 minutes of inactivity. Tracking
            depends on consent and browser delivery. Form contents and private
            account paths are excluded. These are recorded events, not a video
            replay.
          </Text>
        </BlockStack>
      </div>
      {selected && (
        <JourneyTimeline
          key={selected}
          snapshotId={snapshot.id}
          sessionId={selected}
          onClose={() => setSelected(null)}
        />
      )}
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Complete this snapshot?"
        primaryAction={{
          content: "Complete snapshot",
          onAction: () => {
            transition.submit({ action: "complete" }, { method: "POST" });
            setConfirm(false);
          },
        }}
        secondaryActions={[
          { content: "Keep collecting", onAction: () => setConfirm(false) },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Collection will stop, including unfinished journeys. Existing
            results stay available. This cannot be restarted.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function JourneyTimeline({
  snapshotId,
  sessionId,
  onClose,
}: {
  snapshotId: string;
  sessionId: string;
  onClose: () => void;
}) {
  const fetcher = useFetcher<typeof journeyLoader>();
  const appBridge = useAppBridge();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportController = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      exportController.current?.abort();
      exportController.current = null;
    },
    [snapshotId, sessionId],
  );
  const exportJourney = async () => {
    if (exportController.current) return;
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    setExportError(null);
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      await downloadCustomerJourney({
        snapshotId,
        sessionId,
        getIdToken: () => appBridge.idToken(),
        signal: controller.signal,
      });
    } catch {
      if (exportController.current === controller) {
        setExportError("Could not download this journey. Please try again.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (exportController.current === controller) {
        exportController.current = null;
        setExporting(false);
      }
    }
  };
  const loadRef = useRef(fetcher.load);
  loadRef.current = fetcher.load;
  const [page, setPage] = useState(1);
  useEffect(() => {
    loadRef.current(
      `/app/customer-snapshots/${snapshotId}/journey/${sessionId}?page=${page}`,
    );
  }, [snapshotId, sessionId, page]);
  const data = fetcher.data;
  const loading = fetcher.state !== "idle" || !data;
  return (
    <Modal
      open
      onClose={onClose}
      title="Visitor journey"
      size="large"
      secondaryActions={[
        {
          content: "Export journey",
          onAction: exportJourney,
          loading: exporting,
          disabled: exporting,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {exportError && <Banner tone="critical">{exportError}</Banner>}
          {loading ? (
            <InlineStack align="center">
              <Spinner
                accessibilityLabel="Loading visitor journey"
                size="small"
              />
            </InlineStack>
          ) : (
            <>
              <InlineStack gap="200">
                <Badge tone="info">{data.session.source}</Badge>
                {data.session.campaign && (
                  <Badge>{data.session.campaign}</Badge>
                )}
                {data.session.adId && (
                  <Badge>{`Ad ${data.session.adId}`}</Badge>
                )}
              </InlineStack>
              <Text as="p" tone="subdued">
                {dateTime(data.session.startedAt)} · UTC ·{" "}
                {data.session._count.events} recorded events
              </Text>
              {data.session.truncated && (
                <Banner tone="warning">
                  <p>
                    This is a partial timeline: the event limit or offline queue
                    limit was reached.
                  </p>
                </Banner>
              )}
              <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {data.events.map((event) => (
                  <li
                    key={event.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "78px minmax(0, 1fr)",
                      gap: 16,
                      paddingBottom: 22,
                    }}
                  >
                    <Text as="span" tone="subdued">
                      {new Date(event.occurredAt).toLocaleTimeString("en-GB", {
                        timeZone: "UTC",
                      })}
                    </Text>
                    <div
                      style={{
                        borderLeft: "2px solid var(--p-color-border-info)",
                        paddingLeft: 18,
                      }}
                    >
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingSm">
                          {eventLabels[event.type] || event.type}
                        </Text>
                        {event.label && <Text as="p">{event.label}</Text>}
                        {event.engagement && (
                          <Text as="p" tone="subdued">
                            {Math.round(event.engagement.timeOnPage / 1000)}s
                            active · {event.engagement.scrollDepth}% scroll
                          </Text>
                        )}
                        {(event.pagePath || event.targetPath) && (
                          <p
                            style={{
                              margin: 0,
                              overflowWrap: "anywhere",
                              color: "var(--p-color-text-secondary)",
                            }}
                          >
                            {event.pagePath}
                            {event.targetPath ? ` → ${event.targetPath}` : ""}
                          </p>
                        )}
                        {event.amount != null && event.currency && (
                          <Text as="p">
                            {new Intl.NumberFormat("en", {
                              style: "currency",
                              currency: event.currency,
                            }).format(event.amount)}
                          </Text>
                        )}
                      </BlockStack>
                    </div>
                  </li>
                ))}
              </ol>
              {!data.events.length && (
                <Text as="p">
                  No recorded actions yet. Refresh the snapshot after this
                  visitor continues browsing.
                </Text>
              )}
              {data.pageCount > 1 && (
                <Pagination
                  label={`Page ${data.page} of ${data.pageCount}`}
                  hasPrevious={data.page > 1}
                  hasNext={data.page < data.pageCount}
                  onPrevious={() => setPage(data.page - 1)}
                  onNext={() => setPage(data.page + 1)}
                />
              )}
            </>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

const eventLabels: Record<string, string> = {
  page_view: "Viewed page",
  click: "Clicked",
  search: "Searched the store",
  filter_change: "Changed filters",
  page_hidden: "Page hidden",
  add_to_cart: "Added to cart",
  cart_removed: "Removed from cart",
  checkout_started: "Started checkout",
  conversion: "Purchased",
};
const cell = {
  padding: "16px 12px",
  borderBottom: "1px solid var(--p-color-border-secondary)",
  verticalAlign: "top",
} as const;
function date(value: string) {
  return new Date(value).toLocaleDateString("en", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}
function dateTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
