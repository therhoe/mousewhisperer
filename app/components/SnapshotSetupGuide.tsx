import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useFetcher, useRouteLoaderData } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  Badge,
  Banner,
  Button,
  Card,
  Icon,
  Select,
  Text,
  TextField,
  Tooltip,
} from "@shopify/polaris";
import { ChevronDownIcon, ExitIcon, InfoIcon } from "@shopify/polaris-icons";
import {
  trackerActivationState,
  trackerEditorUrl,
  setupCustomerLink,
  type TrackerState,
} from "../utils/snapshot-setup";

type Resource = { id: string; title: string; handle: string };
type Result = {
  success?: boolean;
  error?: string;
  pageUrl?: string;
  snapshotUrl?: string;
};

export function SnapshotSetupGuide({
  shop,
  maxTarget,
  visible = true,
  onExit,
  visibilitySaving = false,
}: {
  shop: string;
  maxTarget: number;
  visible?: boolean;
  onExit: () => void;
  visibilitySaving?: boolean;
}) {
  const bridge = useAppBridge();
  const app = useRouteLoaderData("routes/app") as
    | { apiKey: string }
    | undefined;
  const editorUrl = trackerEditorUrl(shop, app?.apiKey || "");
  const [expanded, setExpanded] = useState(true);
  const [tracker, setTracker] = useState<TrackerState>("unknown");
  const [kind, setKind] = useState("");
  const [target, setTarget] = useState(String(Math.min(100, maxTarget)));
  const [pageTarget, setPageTarget] = useState(
    String(Math.min(100, maxTarget)),
  );
  const [pageType, setPageType] = useState("");
  const [page, setPage] = useState<Resource | null>(null);
  const [campaignLink, setCampaignLink] = useState("");
  const [pickerError, setPickerError] = useState("");
  const [picking, setPicking] = useState(false);
  const requestKey = useRef<string>();
  const mounted = useRef(true);
  const checkInFlight = useRef(false);
  const statusFetcher = useFetcher<{ tracker: TrackerState }>();
  const resourceFetcher = useFetcher<{
    category: string;
    resources: Resource[];
  }>();
  const submitFetcher = useFetcher<Result>();
  const statusLoad = useRef(statusFetcher.load);
  statusLoad.current = statusFetcher.load;
  const statusLoading = useRef(false);
  statusLoading.current = statusFetcher.state !== "idle";
  const busy = submitFetcher.state !== "idle";
  const result = submitFetcher.data;

  const checkTracker = useCallback(async () => {
    if (checkInFlight.current || statusLoading.current) return;
    checkInFlight.current = true;
    let timeout: number | undefined;
    try {
      const state = trackerActivationState(
        await Promise.race([
          bridge.app.extensions(),
          new Promise((_, reject) => {
            timeout = window.setTimeout(
              () => reject(new Error("timeout")),
              5000,
            );
          }),
        ]),
      );
      if (!mounted.current) return;
      if (state !== "unknown") setTracker(state);
      else statusLoad.current("/api/snapshot-setup");
    } catch {
      if (mounted.current) statusLoad.current("/api/snapshot-setup");
    } finally {
      window.clearTimeout(timeout);
      checkInFlight.current = false;
    }
  }, [bridge]);

  useEffect(() => {
    if (statusFetcher.data) setTracker(statusFetcher.data.tracker);
  }, [statusFetcher.data]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!visible) return;
    setExpanded(true);
    const timer = window.setTimeout(() => void checkTracker(), 100);
    const onReturn = () => {
      if (document.visibilityState === "visible") void checkTracker();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [visible, checkTracker]);

  function selectPageType(value: string) {
    setPageType(value);
    setPage(
      value === "HOMEPAGE"
        ? {
            id: "gid://shopify/Homepage/__homepage__",
            title: "Homepage",
            handle: "__homepage__",
          }
        : null,
    );
    setPickerError("");
    if (value === "PAGE" || value === "BLOG")
      resourceFetcher.load(
        `/api/resources/${value === "PAGE" ? "pages" : "blogs"}`,
      );
  }

  async function chooseResource() {
    setPicking(true);
    setPickerError("");
    const selectedType = pageType;
    try {
      const selected = await bridge.resourcePicker({
        type: selectedType === "COLLECTION" ? "collection" : "product",
        multiple: false,
        ...(selectedType === "PRODUCT"
          ? { filter: { variants: false, draft: false, archived: false } }
          : {}),
      });
      if (selected?.[0])
        setPage({
          id: selected[0].id,
          title: selected[0].title,
          handle: selected[0].handle,
        });
    } catch {
      setPickerError("The page picker could not open. Please retry.");
    } finally {
      setPicking(false);
    }
  }

  const validTarget = (value: string, min: number) =>
    Number.isInteger(Number(value)) &&
    Number(value) >= min &&
    Number(value) <= maxTarget;
  let validLink = kind !== "customer";
  if (kind === "customer") {
    try {
      setupCustomerLink(campaignLink);
      validLink = true;
    } catch {
      /* incomplete link */
    }
  }
  const ready = [
    tracker === "active",
    Boolean(kind) && validTarget(target, 25) && validLink,
    Boolean(page) && validTarget(pageTarget, 1),
  ];
  const count = ready.filter(Boolean).length;
  const category = pageType === "PAGE" ? "pages" : "blogs";
  const resources =
    resourceFetcher.data?.category === category
      ? resourceFetcher.data.resources
      : [];

  function start() {
    if (count !== 3 || busy || result?.success) return;
    requestKey.current ||= crypto.randomUUID();
    submitFetcher.submit(
      {
        requestKey: requestKey.current,
        kind,
        target,
        pageTarget,
        pageType,
        pageId: page!.id,
        campaignLink,
      },
      { method: "POST", action: "/api/snapshot-setup" },
    );
  }

  return (
    <div hidden={!visible}>
      <Card>
        <style>{`
      .snapshot-setup-heading{display:flex;align-items:center;gap:10px}
      .snapshot-setup-tools{margin-left:auto;display:flex;align-items:center;gap:8px}
      .snapshot-setup-icon,.snapshot-setup-exit{display:inline-flex;align-items:center;justify-content:center;height:32px;border:0;background:transparent;color:var(--p-color-text);cursor:pointer;padding:6px;font:inherit;line-height:20px;border-radius:6px;text-decoration:none;flex-shrink:0}
      .snapshot-setup-icon{width:32px}
      .snapshot-setup-exit{gap:4px;padding:6px 8px;white-space:nowrap}
      .snapshot-setup-chevron{display:flex;width:20px;height:20px}
      .snapshot-setup-icon:hover,.snapshot-setup-exit:hover{background:var(--p-color-bg-surface-hover)}
      .snapshot-setup-exit:disabled{opacity:.5;cursor:default}
      .snapshot-setup-icon:focus-visible,.snapshot-setup-exit:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
      @media(max-width:480px){.snapshot-setup-heading{flex-wrap:wrap}.snapshot-setup-tools{gap:2px}}
      .snapshot-setup-task{display:flex;gap:12px;border-top:1px solid #ebebeb;padding:18px 0;align-items:flex-start}
      .snapshot-setup-task:first-child{margin-top:16px}
      .snapshot-setup-number{display:grid;place-items:center;width:24px;height:24px;border:1px solid #ccc;border-radius:50%;flex-shrink:0;font-size:12px}
      .snapshot-setup-number[data-ready=true]{background:#e3f1df;border-color:#c1d9b9;color:#215b19}
      .snapshot-setup-fields{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px;margin-top:12px}
      .snapshot-setup-field{width:180px;max-width:100%}
      .snapshot-setup-target{width:120px;max-width:100%}
      .snapshot-setup-page{width:250px;max-width:100%}
      .snapshot-setup-link{width:420px;max-width:100%}
      .snapshot-setup-task-content{flex:1;min-width:0}
      .snapshot-setup-tracker{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
      .snapshot-setup-footer{display:flex;justify-content:flex-end;padding-top:8px}
      .snapshot-setup-status{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
      .snapshot-setup-picker{margin-top:4px;overflow:hidden;text-overflow:ellipsis}
    `}</style>
        <div className="snapshot-setup-heading">
          <Text as="h2" variant="headingMd">
            Setup guide
          </Text>
          <span
            aria-label={
              result?.success ? "Setup complete" : `${count} of 3 steps ready`
            }
          >
            <Badge tone={result?.success ? "success" : undefined}>
              {result?.success ? "Complete" : `${count}/3`}
            </Badge>
          </span>
          <div className="snapshot-setup-tools">
            <button
              className="snapshot-setup-exit"
              type="button"
              onClick={onExit}
              disabled={busy || visibilitySaving}
            >
              <Icon source={ExitIcon} />
              Exit setup
            </button>
            <Tooltip content="Open the theme editor, enable Snapshot Tracker and save. Choose a snapshot and page, then start both together. Targets count human visitors (Store/Page) or human sessions (Channel/Customer). Customer needs a tagged campaign link and ends after 7 days or its target. Plan limits apply. Collection also depends on visitor consent.">
              <button
                className="snapshot-setup-icon"
                aria-label="About setup"
                type="button"
              >
                <Icon source={InfoIcon} />
              </button>
            </Tooltip>
            <button
              className="snapshot-setup-icon"
              type="button"
              onClick={() => setExpanded(!expanded)}
              aria-label={
                expanded ? "Collapse setup guide" : "Expand setup guide"
              }
              aria-expanded={expanded}
              aria-controls="snapshot-setup-body"
            >
              <span
                className="snapshot-setup-chevron"
                style={{ transform: expanded ? "rotate(180deg)" : undefined }}
              >
                <Icon source={ChevronDownIcon} />
              </span>
            </button>
          </div>
        </div>
        {expanded && (
          <div id="snapshot-setup-body">
            {result?.success ? (
              <div style={{ paddingTop: 16 }}>
                <Banner tone="success" title="Both snapshots are running">
                  <div className="snapshot-setup-status">
                    {result.snapshotUrl && (
                      <Link to={result.snapshotUrl}>Open {kind} snapshot</Link>
                    )}
                    {result.pageUrl && (
                      <Link to={result.pageUrl}>Open page snapshot</Link>
                    )}
                  </div>
                </Banner>
              </div>
            ) : (
              <>
                <div className="snapshot-setup-task">
                  <span
                    className="snapshot-setup-number"
                    data-ready={ready[0]}
                    aria-label={
                      ready[0] ? "Tracker enabled" : "Tracker not yet verified"
                    }
                  >
                    {ready[0] ? "✓" : "1"}
                  </span>
                  <div className="snapshot-setup-task-content snapshot-setup-tracker">
                    <Text as="h3" variant="headingSm">
                      Turn on Snapshot Tracker
                    </Text>
                    <div className="snapshot-setup-status">
                      {editorUrl && (
                        <Button
                          variant="primary"
                          url={editorUrl}
                          target="_blank"
                          external
                        >
                          Open theme editor
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="snapshot-setup-task">
                  <span className="snapshot-setup-number" data-ready={ready[1]}>
                    {ready[1] ? "✓" : "2"}
                  </span>
                  <div className="snapshot-setup-task-content">
                    <Text as="h3" variant="headingSm">
                      Choose a snapshot
                    </Text>
                    <div className="snapshot-setup-fields">
                      <div className="snapshot-setup-field">
                        <Select
                          label="Snapshot type"
                          value={kind}
                          onChange={setKind}
                          disabled={busy}
                          options={[
                            { label: "Select type", value: "" },
                            { label: "Store", value: "store" },
                            { label: "Channel", value: "channel" },
                            { label: "Customer", value: "customer" },
                          ]}
                        />
                      </div>
                      <div className="snapshot-setup-target">
                        <TextField
                          label={kind === "store" ? "Visitors" : "Sessions"}
                          type="number"
                          value={target}
                          onChange={setTarget}
                          min={25}
                          max={maxTarget}
                          step={1}
                          autoComplete="off"
                          disabled={busy}
                        />
                      </div>
                      {kind === "customer" && (
                        <div className="snapshot-setup-link">
                          <TextField
                            label="Campaign link (with utm_source)"
                            type="url"
                            value={campaignLink}
                            onChange={setCampaignLink}
                            autoComplete="off"
                            disabled={busy}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="snapshot-setup-task">
                  <span className="snapshot-setup-number" data-ready={ready[2]}>
                    {ready[2] ? "✓" : "3"}
                  </span>
                  <div className="snapshot-setup-task-content">
                    <Text as="h3" variant="headingSm">
                      Choose a page
                    </Text>
                    <div className="snapshot-setup-fields">
                      <div className="snapshot-setup-field">
                        <Select
                          label="Page type"
                          value={pageType}
                          onChange={selectPageType}
                          disabled={busy || picking}
                          options={[
                            { label: "Select type", value: "" },
                            { label: "Product", value: "PRODUCT" },
                            { label: "Collection", value: "COLLECTION" },
                            { label: "Homepage", value: "HOMEPAGE" },
                            { label: "Page", value: "PAGE" },
                            { label: "Blog", value: "BLOG" },
                          ]}
                        />
                      </div>
                      <div className="snapshot-setup-page">
                        {pageType === "PRODUCT" || pageType === "COLLECTION" ? (
                          <>
                            <Text as="p" variant="bodySm">
                              Page
                            </Text>
                            <div className="snapshot-setup-picker">
                              <Button
                                onClick={() => void chooseResource()}
                                disabled={busy}
                                loading={picking}
                              >
                                {page?.title || "Select page"}
                              </Button>
                            </div>
                          </>
                        ) : (
                          <Select
                            label="Page"
                            value={page?.id || ""}
                            disabled={
                              busy ||
                              !pageType ||
                              pageType === "HOMEPAGE" ||
                              resourceFetcher.state !== "idle"
                            }
                            onChange={(id) =>
                              setPage(
                                resources.find((r) => r.id === id) || null,
                              )
                            }
                            options={
                              pageType === "HOMEPAGE"
                                ? [{ label: "Homepage", value: page!.id }]
                                : [
                                    {
                                      label:
                                        resourceFetcher.state !== "idle"
                                          ? "Loading…"
                                          : "Select page",
                                      value: "",
                                    },
                                    ...resources.map((r) => ({
                                      label: r.title,
                                      value: r.id,
                                    })),
                                  ]
                            }
                          />
                        )}
                      </div>
                      <div className="snapshot-setup-target">
                        <TextField
                          label="Visitors"
                          type="number"
                          value={pageTarget}
                          onChange={setPageTarget}
                          min={1}
                          max={maxTarget}
                          step={1}
                          autoComplete="off"
                          disabled={busy}
                        />
                      </div>
                    </div>
                    {(pageType === "PAGE" || pageType === "BLOG") &&
                      resourceFetcher.state === "idle" &&
                      !resources.length && (
                        <Text as="p" tone="subdued">
                          No pages loaded.{" "}
                          <button
                            type="button"
                            onClick={() =>
                              resourceFetcher.load(`/api/resources/${category}`)
                            }
                          >
                            Retry
                          </button>
                        </Text>
                      )}
                  </div>
                </div>
                {pickerError && <Banner tone="warning">{pickerError}</Banner>}
                {result?.error && (
                  <Banner tone="critical">{result.error}</Banner>
                )}
                <div className="snapshot-setup-footer">
                  <Button
                    variant="primary"
                    onClick={start}
                    loading={busy}
                    disabled={count !== 3}
                  >
                    Start snapshots
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
