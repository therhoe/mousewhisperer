import { useEffect, useRef, useState } from "react";
import { useFetcher, useRouteLoaderData } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  Banner,
  BlockStack,
  Button,
  Checkbox,
  ChoiceList,
  FormLayout,
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
  const [customSource, setCustomSource] = useState(false);
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
  const knownSources = sourceFetcher.data?.sources || sources;
  const OTHER = "__other__";
  const sourceOptions = [
    { label: t("All sources"), value: "" },
    ...knownSources.map((item) => ({ label: item, value: item })),
    { label: t("Other source…"), value: OTHER },
  ];
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
        <FormLayout>
          {fetcher.data?.error && (
            <Banner tone="critical">
              <BlockStack gap="200">
                <p>
                  {t(
                    fetcher.data.errorKey || fetcher.data.error,
                    fetcher.data.errorValues,
                  )}
                </p>
                {editorUrl && !projectOnly && (
                  <div>
                    <Button url={editorUrl} external>
                      {t("Open theme editor")}
                    </Button>
                  </div>
                )}
              </BlockStack>
            </Banner>
          )}
          <TextField
            label={t(projectId ? "Measurement name" : "Project title")}
            value={title}
            onChange={setTitle}
            autoComplete="off"
            maxLength={120}
            placeholder={t(
              projectId ? "e.g. After new hero image" : "e.g. Lift product page sales",
            )}
          />
          {!projectId && (
            <>
              <TextField
                label={t("Goal")}
                value={goal}
                onChange={setGoal}
                autoComplete="off"
                maxLength={1000}
                multiline={2}
                placeholder={t("What do you want to improve?")}
              />
              <ChoiceList
                title={t("What do you want to measure?")}
                choices={[
                  {
                    label: t("Store-level"),
                    value: "STORE",
                    helpText: t("Every page of your store."),
                  },
                  {
                    label: t("Page-level"),
                    value: "PAGE",
                    helpText: t("One product, collection, page or blog."),
                  },
                ]}
                selected={[scope]}
                onChange={(value) => setScope(value[0] || "STORE")}
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
                    <BlockStack gap="100">
                      <InlineStack gap="300" blockAlign="center">
                        <Button onClick={pickResource}>
                          {t(page ? "Change page" : "Choose page")}
                        </Button>
                        <Text as="span" tone={page ? undefined : "subdued"}>
                          {page?.title || t("No page selected")}
                        </Text>
                      </InlineStack>
                      {pageType === "PRODUCT" && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          {t(
                            "Only products published to the Online Store are shown.",
                          )}
                        </Text>
                      )}
                    </BlockStack>
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
              <BlockStack gap="200">
                <Select
                  label={t("Source")}
                  options={sourceOptions}
                  value={
                    customSource || (source && !knownSources.includes(source))
                      ? OTHER
                      : source
                  }
                  onChange={(value) => {
                    setCustomSource(value === OTHER);
                    setSource(value === OTHER ? "" : value);
                  }}
                  helpText={t(
                    "Opens your results filtered to this source. Every source is still tracked.",
                  )}
                />
                {customSource && (
                  <TextField
                    label={t("Source name")}
                    value={source}
                    onChange={setSource}
                    autoComplete="off"
                    maxLength={160}
                    placeholder="facebook"
                  />
                )}
                <div>
                  <Button
                    variant="plain"
                    disclosure={advanced ? "up" : "down"}
                    onClick={() => setAdvanced(!advanced)}
                    ariaExpanded={advanced}
                  >
                    {t("Medium and campaign")}
                  </Button>
                </div>
                {advanced && (
                  <FormLayout.Group>
                    <TextField
                      label={t("Medium")}
                      value={medium}
                      onChange={setMedium}
                      autoComplete="off"
                      placeholder="cpc"
                    />
                    <TextField
                      label={t("Campaign")}
                      value={campaign}
                      onChange={setCampaign}
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                )}
              </BlockStack>
            </>
          )}
          {projectOnly ? (
            <Text as="p" tone="subdued">
              {t(
                "Create your project first, then configure its A/B test. No measurement starts yet.",
              )}
            </Text>
          ) : (
            <BlockStack gap="200">
              <ChoiceList
                title={t("Complete measurement by")}
                choices={[
                  {
                    label: t("Visitor target"),
                    value: "VISITORS",
                    helpText: t("Stops after this many visits from real people."),
                  },
                  {
                    label: t("Duration"),
                    value: "DURATION",
                    helpText: t("Stops after a fixed number of days."),
                  },
                ]}
                selected={[mode]}
                onChange={(value) => setMode(value[0] || "VISITORS")}
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
            </BlockStack>
          )}
          {!projectId && scope === "STORE" && (
            <Checkbox
              label={t("Enable journey tracking")}
              helpText={t(
                "Records the path each visitor takes through your store. Uses one extra measurement from your plan.",
              )}
              checked={journey}
              onChange={setJourney}
            />
          )}
          {editorUrl && !projectOnly && !projectId && (
            <Text as="p" variant="bodySm" tone="subdued">
              {t("Snapshot Tracker must be turned on in your theme.")}{" "}
              <Button url={editorUrl} external variant="plain">
                {t("Open theme editor")}
              </Button>
            </Text>
          )}
        </FormLayout>
      </Modal.Section>
    </Modal>
  );
}
