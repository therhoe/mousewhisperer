import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Link,
  useActionData,
  useLoaderData,
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
import {
  getBillingDisplayAccess,
  isPlanLimitError,
} from "../utils/billing.server";
import { planUsagePillLabel } from "../components/PremiumGate";
import { ensureWebPixel } from "../utils/web-pixel.server";
import {
  CustomerSnapshotError,
  createCustomerSnapshot,
  listCustomerSnapshots,
} from "../utils/customer-journey.server";
import {
  buildJourneyLink,
  inspectJourneyLink,
  validateJourneyDestination,
} from "../utils/customer-journey";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [history, billing] = await Promise.all([
    listCustomerSnapshots(
      session.shop,
      new URL(request.url).searchParams.get("page"),
    ),
    getBillingDisplayAccess(session.shop),
  ]);
  return json({ ...history, billing });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const text = (key: string) => String(form.get(key) || "").trim();
  if (text("action") !== "create")
    return json({ error: "Invalid action." }, { status: 400 });
  try {
    const destination = validateJourneyDestination(text("destinationUrl"));
    const response = await admin.graphql(
      `query CustomerJourneyStoreDomain { shop { primaryDomain { host } } }`,
    );
    const data = await response.json();
    const hosts = [session.shop, data.data?.shop?.primaryDomain?.host].filter(
      Boolean,
    );
    if (!hosts.includes(destination.hostname))
      throw new CustomerSnapshotError(
        "Use a landing page on this store's domain.",
      );
    const scope = text("scope");
    if (!["source", "campaign", "ad"].includes(scope))
      throw new CustomerSnapshotError("Choose which visitors to follow.");
    if (scope === "campaign" && !text("campaign"))
      throw new CustomerSnapshotError(
        "Enter the campaign name or ID used in the link.",
      );
    if (scope === "ad" && !text("adId"))
      throw new CustomerSnapshotError("Enter the ad ID used in the link.");
    const pixel = await ensureWebPixel(admin, session.shop);
    if (pixel?.ready === false)
      throw new CustomerSnapshotError(
        "Checkout tracking could not be configured. Please retry.",
        503,
      );
    const snapshot = await createCustomerSnapshot({
      shop: session.shop,
      name: text("name"),
      source: text("source"),
      medium: text("medium"),
      campaign: scope === "source" ? null : text("campaign"),
      adId: scope === "ad" ? text("adId") : null,
      destinationUrl: destination.toString(),
      durationDays: Number(text("durationDays")),
      targetSessions: text("targetSessions")
        ? Number(text("targetSessions"))
        : null,
    });
    return redirect(`/app/customer-snapshots/${snapshot.id}`);
  } catch (error) {
    if (error instanceof CustomerSnapshotError || isPlanLimitError(error))
      return json({ error: error.message }, { status: error.status });
    if (error instanceof TypeError)
      return json(
        { error: "Enter a valid HTTPS storefront URL." },
        { status: 400 },
      );
    throw error;
  }
};

export default function CustomerSnapshots() {
  const { snapshots, billing, page, pageCount, total, activeId } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const [, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [source, setSource] = useState("facebook");
  const [medium, setMedium] = useState("paid_social");
  const [scope, setScope] = useState("source");
  const [campaign, setCampaign] = useState("");
  const [adId, setAdId] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [durationDays, setDurationDays] = useState("7");
  const [targetSessions, setTargetSessions] = useState(
    String(Math.min(1000, billing.limits.maxSnapshotTargetVisitors)),
  );
  const [testUrl, setTestUrl] = useState("");
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const busy = navigation.state !== "idle";
  const filter = {
    source,
    medium,
    campaign: scope !== "source" ? campaign : null,
    adId: scope === "ad" ? adId : null,
  };
  let generatedLink = "";
  try {
    generatedLink = buildJourneyLink(destinationUrl, filter);
  } catch {
    /* Wait for a complete URL. */
  }

  function importLink(value: string) {
    setDestinationUrl(value);
    setCheck(null);
    try {
      const p = new URL(value).searchParams;
      if (p.get("utm_source")) setSource(p.get("utm_source")!);
      if (p.get("utm_medium")) setMedium(p.get("utm_medium")!);
      const importedCampaign =
        p.get("utm_id") || p.get("campaign_id") || p.get("utm_campaign");
      const importedAd = p.get("ad_id") || p.get("utm_content");
      if (importedCampaign) {
        setCampaign(importedCampaign);
        setScope("campaign");
      }
      if (importedAd) {
        setAdId(importedAd);
        setScope("ad");
      }
    } catch {
      /* Partial input. */
    }
  }

  return (
    <Page
      title="Customer Snapshots"
      subtitle="Follow visitors from a chosen source, campaign, or ad through their store session."
      backAction={{ content: "Dashboard", url: "/app" }}
      primaryAction={
        activeId
          ? {
              content: "View active snapshot",
              url: `/app/customer-snapshots/${activeId}`,
            }
          : billing.canCreateNormalSnapshot
            ? {
                content: "Start customer snapshot",
                onAction: () => setOpen(true),
              }
            : { content: "Upgrade to start snapshot", url: "/app/upgrade" }
      }
      secondaryActions={[
        {
          content: planUsagePillLabel(billing, "normalSnapshots"),
          url: "/app/upgrade",
        },
      ]}
    >
      <TitleBar title="Customer Snapshots" />
      <div style={{ paddingBottom: 48 }}>
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200">
                <Badge tone="info">Source → journey → outcome</Badge>
                <Badge>Anonymous sessions</Badge>
              </InlineStack>
              <Text as="h2" variant="headingLg">
                See what happens after the click
              </Text>
              <Text as="p">
                Choose the arrivals to follow, then explore their pages, clicks,
                cart actions, and purchases in order.
              </Text>
              <Text as="p" tone="subdued">
                New arrivals are collected after a snapshot starts. A session
                ends after 30 minutes of inactivity. Collection depends on
                storefront tracking and visitor consent.
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Snapshot history
                </Text>
                <Text as="span" tone="subdued">
                  {total} snapshots
                </Text>
              </InlineStack>
              {!snapshots.length ? (
                <BlockStack gap="200">
                  <Text as="p">No customer snapshots yet.</Text>
                  <Text as="p" tone="subdued">
                    Start with one campaign to see which paths lead to a
                    purchase and where visitors leave.
                  </Text>
                </BlockStack>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      borderCollapse: "collapse",
                      width: "100%",
                      textAlign: "left",
                    }}
                  >
                    <thead>
                      <tr>
                        {[
                          "Snapshot",
                          "Audience",
                          "Status",
                          "Sessions",
                          "Started",
                        ].map((label) => (
                          <th
                            key={label}
                            style={{
                              padding: "12px 16px",
                              background: "var(--p-color-bg-surface-secondary)",
                            }}
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {snapshots.map((s) => (
                        <tr key={s.id}>
                          <td style={cell}>
                            <Link to={`/app/customer-snapshots/${s.id}`}>
                              {s.name}
                            </Link>
                          </td>
                          <td style={cell}>
                            {s.source}
                            {s.campaign ? ` · ${s.campaign}` : ""}
                            {s.adId ? ` · Ad ${s.adId}` : ""}
                          </td>
                          <td style={cell}>
                            <Badge
                              tone={
                                s.status === "ACTIVE"
                                  ? "success"
                                  : s.status === "PAUSED"
                                    ? "warning"
                                    : "info"
                              }
                            >
                              {s.status === "ACTIVE"
                                ? "Active"
                                : s.status === "PAUSED"
                                  ? "Paused"
                                  : "Completed"}
                            </Badge>
                          </td>
                          <td style={cell}>
                            {s._count.sessions.toLocaleString()}
                          </td>
                          <td style={cell}>
                            {new Date(s.startedAt).toLocaleDateString("en", {
                              timeZone: "UTC",
                            })}
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
                  onPrevious={() =>
                    setParams((p) => {
                      p.set("page", String(page - 1));
                      return p;
                    })
                  }
                  onNext={() =>
                    setParams((p) => {
                      p.set("page", String(page + 1));
                      return p;
                    })
                  }
                />
              )}
            </BlockStack>
          </Card>
        </BlockStack>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Start customer snapshot"
        primaryAction={{
          content: "Start snapshot",
          loading: busy,
          onAction: () =>
            submit(
              {
                action: "create",
                name,
                source,
                medium,
                scope,
                campaign,
                adId,
                destinationUrl,
                durationDays,
                targetSessions,
              },
              { method: "POST" },
            ),
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setOpen(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {actionData?.error && (
              <Banner tone="critical">
                <p>{actionData.error}</p>
              </Banner>
            )}
            <FormLayout>
              <TextField
                label="Snapshot name"
                value={name}
                onChange={setName}
                autoComplete="off"
                placeholder="Summer sale journeys"
              />
              <TextField
                label="Landing page or existing campaign link"
                value={destinationUrl}
                onChange={importLink}
                autoComplete="off"
                placeholder="https://yourstore.com/products/shoe"
                helpText="Paste a tagged link to fill the source, campaign, and ad automatically."
              />
              <FormLayout.Group>
                <TextField
                  label="Source"
                  value={source}
                  onChange={setSource}
                  autoComplete="off"
                  helpText="For example: facebook, instagram, google, newsletter."
                />
                <TextField
                  label="Medium (optional)"
                  value={medium}
                  onChange={setMedium}
                  autoComplete="off"
                  helpText="For example: paid_social, cpc, email. Leave blank for any."
                />
              </FormLayout.Group>
              <Select
                label="Which visitors?"
                value={scope}
                onChange={setScope}
                options={[
                  { label: "Everyone from this source", value: "source" },
                  { label: "A particular campaign", value: "campaign" },
                  { label: "A particular ad", value: "ad" },
                ]}
              />
              {scope !== "source" && (
                <TextField
                  label={
                    scope === "ad"
                      ? "Campaign name or ID (optional)"
                      : "Campaign name or ID"
                  }
                  value={campaign}
                  onChange={setCampaign}
                  autoComplete="off"
                  helpText="Must match utm_campaign, utm_id, or campaign_id in the arriving link."
                />
              )}
              {scope === "ad" && (
                <TextField
                  label="Ad ID"
                  value={adId}
                  onChange={setAdId}
                  autoComplete="off"
                  helpText="Must match ad_id or utm_content. A click ID is not an ad ID."
                />
              )}
              <FormLayout.Group>
                <TextField
                  label="Capture window (days)"
                  type="number"
                  min={1}
                  max={90}
                  value={durationDays}
                  onChange={setDurationDays}
                  autoComplete="off"
                />
                <TextField
                  label="Maximum matching sessions"
                  type="number"
                  min={1}
                  max={billing.limits.maxSnapshotTargetVisitors}
                  value={targetSessions}
                  onChange={setTargetSessions}
                  autoComplete="off"
                  helpText="At the target, new arrivals stop joining; existing journeys can finish within the capture window."
                />
              </FormLayout.Group>
            </FormLayout>
            {generatedLink && (
              <TextField
                label="Link to use in your ad or campaign"
                value={generatedLink}
                readOnly
                autoComplete="off"
                multiline={3}
                helpText="Existing query parameters are preserved. Use this destination link in your campaign, then test a real arrival."
              />
            )}
            <TextField
              label="Test tracking link"
              value={testUrl}
              onChange={(v) => {
                setTestUrl(v);
                setCheck(null);
              }}
              autoComplete="off"
              placeholder="Paste the final landing URL"
            />
            <Button
              onClick={() =>
                setCheck(inspectJourneyLink(testUrl || generatedLink, filter))
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
              Customer Snapshots share your page and channel snapshot allowance.
              No names, emails, or typed form values are collected.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

const cell = {
  padding: "16px",
  borderBottom: "1px solid var(--p-color-border-secondary)",
  verticalAlign: "top",
} as const;
