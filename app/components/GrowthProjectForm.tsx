import { useEffect, useRef, useState } from "react";
import { useFetcher, useRouteLoaderData } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  Banner,
  BlockStack,
  Button,
  Checkbox,
  InlineStack,
  Modal,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useI18n } from "../utils/i18n";
import { trackerEditorUrl } from "../utils/snapshot-setup";

type Resource = { id: string; title: string; handle: string };
export function GrowthProjectForm({
  open,
  onClose,
  shop,
  sources = [],
  projectId,
  next,
}: {
  open: boolean;
  onClose: () => void;
  shop: string;
  sources?: string[];
  projectId?: string;
  next?: string;
}) {
  const { t } = useI18n();
  const bridge = useAppBridge();
  const app = useRouteLoaderData("routes/app") as
    | { apiKey: string }
    | undefined;
  const fetcher = useFetcher<{
    error?: string;
    errorKey?: string;
    errorValues?: Record<string, string | number>;
  }>();
  const sourceFetcher = useFetcher<{ sources: string[] }>();
  const sourceLoad = useRef(sourceFetcher.load);
  useEffect(() => {
    if (open && !projectId) sourceLoad.current("/api/project-sources");
  }, [open, projectId]);
  const resources = useFetcher<{ category: string; resources: Resource[] }>();
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [scope, setScope] = useState("STORE");
  const [pageType, setPageType] = useState("HOMEPAGE");
  const [page, setPage] = useState<Resource | null>(null);
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("");
  const [campaign, setCampaign] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [journey, setJourney] = useState(false);
  const [mode, setMode] = useState("VISITORS");
  const [target, setTarget] = useState("100");
  const [duration, setDuration] = useState("7");
  const [pickerError, setPickerError] = useState("");
  const projectOnly = !projectId && next === "ab-test";
  const requestKey = useRef("");
  useEffect(() => {
    if (open && !requestKey.current) requestKey.current = crypto.randomUUID();
  }, [open]);
  const busy = fetcher.state !== "idle";
  function selectType(value: string) {
    setPageType(value);
    setPage(null);
    setPickerError("");
    if (value === "PAGE" || value === "BLOG")
      resources.load(`/api/resources/${value === "PAGE" ? "pages" : "blogs"}`);
  }
  async function pickResource() {
    try {
      const result = await bridge.resourcePicker({
        type: pageType === "COLLECTION" ? "collection" : "product",
        multiple: false,
        ...(pageType === "PRODUCT"
          ? {
              filter: {
                variants: false,
                draft: false,
                archived: false,
                hidden: false,
                query: "status:active AND published_status:published",
              },
            }
          : {}),
      });
      if (result?.[0])
        setPage({
          id: result[0].id,
          title: result[0].title,
          handle: result[0].handle,
        });
    } catch {
      setPickerError(t("The page picker could not open. Please retry."));
    }
  }
  function submit() {
    const data: Record<string, string> = {
      intent: projectId ? "start-measurement" : "create-project",
      title,
      goal,
      scope,
      pageType,
      pageId:
        pageType === "HOMEPAGE"
          ? "gid://shopify/Homepage/__homepage__"
          : page?.id || "",
      source,
      medium,
      campaign,
      journeyTracking: String(scope === "STORE" && journey),
      requestKey: requestKey.current || crypto.randomUUID(),
      next: next || "",
    };
    if (!projectOnly) {
      data.completionMode = mode;
      data.measurementName = projectId ? title : t("Baseline");
      if (mode === "VISITORS") data.targetVisitors = target;
      else data.durationDays = duration;
    }
    fetcher.submit(data, {
      method: "post",
      action: projectId ? `/app/projects/${projectId}` : "/app/projects",
    });
  }
  const editorUrl = trackerEditorUrl(shop, app?.apiKey || "");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t(projectId ? "Start measurement" : "Create project")}
      primaryAction={{
        content: t(
          projectId
            ? "Start measurement"
            : projectOnly
              ? "Create project & continue"
              : "Create project",
        ),
        onAction: submit,
        loading: busy,
        disabled:
          !title.trim() ||
          (!projectId &&
            (!goal.trim() ||
              (scope === "PAGE" && pageType !== "HOMEPAGE" && !page))),
      }}
      secondaryActions={[
        { content: t("Cancel"), onAction: onClose, disabled: busy },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {fetcher.data?.error && (
            <Banner tone="critical">
              <p>
                {t(
                  fetcher.data.errorKey || fetcher.data.error,
                  fetcher.data.errorValues,
                )}
              </p>
              {editorUrl && !projectOnly && (
                <Button url={editorUrl} external variant="primary">
                  {t("Open theme editor")}
                </Button>
              )}
            </Banner>
          )}
          <TextField
            label={t(projectId ? "Measurement name" : "Project title")}
            value={title}
            onChange={setTitle}
            autoComplete="off"
            maxLength={120}
          />
          {!projectId && (
            <>
              {editorUrl && !projectOnly && (
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span">{t("Snapshot Tracker")}</Text>
                  <Button url={editorUrl} external variant="primary">
                    {t("Open theme editor")}
                  </Button>
                </InlineStack>
              )}
              <TextField
                label={t("Goal")}
                value={goal}
                onChange={setGoal}
                autoComplete="off"
                maxLength={1000}
                placeholder={t("What do you want to improve?")}
              />
              <Select
                label={t("Scope")}
                options={[
                  { label: t("Store-level"), value: "STORE" },
                  { label: t("Page-level"), value: "PAGE" },
                ]}
                value={scope}
                onChange={setScope}
              />
              {scope === "PAGE" && (
                <BlockStack gap="300">
                  <Select
                    label={t("Page type")}
                    value={pageType}
                    onChange={selectType}
                    options={[
                      { label: t("Homepage"), value: "HOMEPAGE" },
                      { label: t("Product"), value: "PRODUCT" },
                      { label: t("Collection"), value: "COLLECTION" },
                      { label: t("Page"), value: "PAGE" },
                      { label: t("Blog or article"), value: "BLOG" },
                    ]}
                  />
                  {(pageType === "PRODUCT" || pageType === "COLLECTION") && (
                    <InlineStack gap="300" blockAlign="center">
                      <Button onClick={pickResource}>{t("Choose page")}</Button>
                      <Text as="span">
                        {page?.title || t("No page selected")}
                      </Text>
                    </InlineStack>
                  )}
                  {pageType === "PRODUCT" && (
                    <Text as="p" tone="subdued">
                      {t("Only products published to the Online Store are shown.")}
                    </Text>
                  )}
                  {(pageType === "PAGE" || pageType === "BLOG") && (
                    <Select
                      label={t("Page")}
                      value={page?.id || ""}
                      disabled={resources.state !== "idle"}
                      options={[
                        { label: t("Choose page"), value: "" },
                        ...(resources.data?.category ===
                        (pageType === "PAGE" ? "pages" : "blogs")
                          ? resources.data.resources
                          : []
                        ).map((item) => ({
                          label: item.title,
                          value: item.id,
                        })),
                      ]}
                      onChange={(value) =>
                        setPage(
                          resources.data?.resources.find(
                            (item) => item.id === value,
                          ) || null,
                        )
                      }
                    />
                  )}
                  {pickerError && <Banner tone="warning">{pickerError}</Banner>}
                </BlockStack>
              )}
              <label style={{ display: "grid", gap: 6 }}>
                {t("Source")}
                <input
                  className="gp-input"
                  list="project-sources"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder={t("All sources")}
                  maxLength={160}
                />
                <datalist id="project-sources">
                  {(sourceFetcher.data?.sources || sources).map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </label>
              <Text as="p" tone="subdued">
                {t(
                  "Sets your initial results filter. All sources are still collected.",
                )}
              </Text>
              <Button
                variant="plain"
                onClick={() => setAdvanced(!advanced)}
                ariaExpanded={advanced}
              >
                {t(advanced ? "Hide advanced filters" : "Advanced filters")}
              </Button>
              {advanced && (
                <InlineStack gap="400">
                  <TextField
                    label={t("Medium")}
                    value={medium}
                    onChange={setMedium}
                    autoComplete="off"
                  />
                  <TextField
                    label={t("Campaign")}
                    value={campaign}
                    onChange={setCampaign}
                    autoComplete="off"
                  />
                </InlineStack>
              )}
              {scope === "STORE" && (
                <Checkbox
                  label={t("Enable journey tracking")}
                  helpText={t(
                    "Follow recorded sessions across your store. Uses one additional journey measurement allowance.",
                  )}
                  checked={journey}
                  onChange={setJourney}
                />
              )}
            </>
          )}
          {projectOnly ? (
            <Text as="p" tone="subdued">
              {t(
                "Create your project first, then configure its A/B test. No measurement starts yet.",
              )}
            </Text>
          ) : (
            <>
              <Select
                label={t("Complete measurement by")}
                value={mode}
                onChange={setMode}
                options={[
                  { label: t("Visitor target"), value: "VISITORS" },
                  { label: t("Duration"), value: "DURATION" },
                ]}
              />
              {mode === "VISITORS" ? (
                <TextField
                  label={t("Target visitors")}
                  type="number"
                  value={target}
                  onChange={setTarget}
                  min={1}
                  autoComplete="off"
                />
              ) : (
                <TextField
                  label={t("Duration (days)")}
                  type="number"
                  value={duration}
                  onChange={setDuration}
                  min={1}
                  max={90}
                  autoComplete="off"
                />
              )}
              <Text as="p" tone="subdued">
                {t(
                  "The measurement ends at the selected limit. Your Project stays open.",
                )}
              </Text>
              {mode === "VISITORS" && (
                <Text as="p" tone="subdued">
                  {t(
                    "The target counts human acquisition sessions, not page views or unique people.",
                  )}
                </Text>
              )}
            </>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
