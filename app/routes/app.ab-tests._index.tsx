import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  useFetcher,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { Modal as AppBridgeModal, TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  AbTestDetailReport,
  type AbTestReportStatsRow,
} from "../components/AbTestDetailReport";
import {
  createThemeTemplateVariant,
  createTemplateAbTest,
  getThemeTemplateOptions,
  normalizeAbTestGoal,
  normalizeAbTestPageType,
  type SnapshotTemplateTransformation,
  type ThemeTemplateOption,
} from "../utils/ab-tests.server";
import {
  cachedValue,
  clearCacheKey,
  loaderCacheKeys,
} from "../utils/loader-cache.server";
import { planUsagePillLabel, PremiumGateCard } from "../components/PremiumGate";
import {
  assertCanCreateAbTest,
  getBillingAccess,
  isPlanLimitError,
  planLimitPayload,
} from "../utils/billing.server";

const PAGE_TYPE_OPTIONS = [
  { label: "Homepage", value: "HOMEPAGE", noun: "homepage" },
  { label: "Collection pages", value: "COLLECTION", noun: "collection page" },
  { label: "Product pages", value: "PRODUCT", noun: "product page" },
  { label: "Pages", value: "PAGE", noun: "page" },
  { label: "Blogs and articles", value: "BLOG", noun: "blog page" },
  { label: "Cart", value: "CART", noun: "cart page" },
];

const GOAL_OPTIONS = [
  {
    label: "Conversion rate",
    value: "CONVERSION",
    description: "Orders divided by assigned real visitors.",
  },
  {
    label: "Revenue per visitor",
    value: "REVENUE",
    description: "Revenue attributed to each assigned visitor.",
  },
  {
    label: "Add-to-cart rate",
    value: "ADD_TO_CART",
    description: "Visitors who add at least one item to cart.",
  },
  {
    label: "Clickthrough rate",
    value: "CLICK_THROUGH",
    description: "Visitors who click through to the next buying step.",
  },
  {
    label: "Engagement",
    value: "ENGAGEMENT",
    description: "Visitor quality based on scroll and time on page.",
  },
];

const STATUS_TABS = [
  { label: "Live", value: "LIVE", icon: "play" },
  { label: "Paused", value: "PAUSED", icon: "pause" },
  { label: "Draft", value: "DRAFT", icon: "edit" },
  { label: "Ended", value: "ENDED", icon: "archive" },
];

const PAGE_TYPE_LABELS: Record<string, string> = {
  PRODUCT: "Product page",
  COLLECTION: "Collection page",
  PAGE: "Page",
  BLOG: "Blog page",
  HOMEPAGE: "Homepage",
  CART: "Cart",
};

type AbTestRow = {
  id: string;
  name: string;
  status: string;
  targetPageType: string;
  goal: string;
  trafficSplit: number;
  createdAt: string;
  launchedAt: string | null;
  endedAt: string | null;
  variants: Array<{
    id: string;
    key: string;
    name: string;
    templateName: string;
    templateSuffix: string | null;
    templateFileName: string | null;
    isControl: boolean;
  }>;
};

type AbTestListVariantStats = {
  visitors: number;
  conversions: number;
  conversionRate: number;
  revenue: number;
};

type AbTestReportData = {
  testId: string;
  stats: AbTestReportStatsRow[];
};

type AbTestDashboardItem = {
  test: AbTestRow;
  control?: AbTestRow["variants"][number];
  variant?: AbTestRow["variants"][number];
  preview?: ThemeTemplateOption;
  controlStats?: AbTestListVariantStats;
  variantStats?: AbTestListVariantStats;
  totalVisitors: number;
  lift: number | null;
  liftLabel: string;
  liftDetail: string;
  liftTone: "positive" | "negative" | "neutral";
  decisionLabel: string;
  decisionTone: "success" | "warning" | "critical" | "neutral";
  progressLabel: string;
  progressPercent: number;
  searchableText: string;
};

type DashboardSort = "newest" | "visitors" | "lift" | "progress";

const MIN_VISITORS_FOR_SIGNAL = 100;
const MIN_VISITORS_PER_VARIANT_FOR_SIGNAL = 20;

type VariantCreateAction =
  | "duplicate-template-variant"
  | "snapshot-template-variant";
type CreateWizardStep = "setup" | "settings";
type VariantBuildMode = "existing" | "duplicate" | "snapshot" | null;
type DuplicateTemplateState = "idle" | "pending" | "created";

type SnapshotOption = {
  id: string;
  name: string;
  number: number;
  resourceType: string;
  resourceTitle: string;
  resourceHandle: string;
  targetVisitors: number;
  realCount: number;
  totalSessions: number;
  atcRate: number;
  convRate: number;
  revenue: number;
  avgScrollDepth: number;
  exitRate: number;
  bodyCtaCtrRate: number;
  createdAt: string;
  completedAt: string | null;
};

type VariantCreateActionData =
  | {
      ok: true;
      templateOption: string;
      templateName: string;
      templateSuffix: string;
      message: string;
      snapshotPlan?: TemplateSnapshotPlan | null;
    }
  | {
      ok: false;
      error: string;
    };

type TemplateSnapshotPlan = {
  title: string;
  summary: string;
  sourceLabel: string;
  snapshotId?: string | null;
  snapshotName?: string | null;
  snapshotResourceTitle?: string | null;
  confidence: number | null;
  metrics?: Record<string, number | string | null>;
  focusAreas: Array<{
    label: string;
    detail: string;
  }>;
  transformation?: SnapshotTemplateTransformation | null;
};

type ParsedTemplateOption = {
  themeId?: string | null;
  themeName?: string | null;
  themeRole?: string | null;
  templateName?: string | null;
  templateSuffix?: string | null;
  templateFileName?: string | null;
  pageType?: string | null;
  previewPageUrl?: string | null;
  previewImageUrl?: string | null;
  previewTitle?: string | null;
  assignedCount?: number | null;
  assignedLabel?: string | null;
};

function statusTone(status: string) {
  if (status === "LIVE") return "success" as const;
  if (status === "PAUSED") return "warning" as const;
  if (status === "ENDED") return "info" as const;
  return undefined;
}

function formatCompactDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function goalLabel(goal: string) {
  return GOAL_OPTIONS.find((option) => option.value === goal)?.label || goal;
}

function variantTrafficLabel(test: AbTestRow) {
  const control = test.variants.find((variant) => variant.key === "A");
  const variant = test.variants.find((item) => item.key === "B");
  const controlTraffic = control?.trafficPercent || test.trafficSplit || 50;
  const variantTraffic = variant?.trafficPercent || 100 - controlTraffic;
  return `${controlTraffic}/${variantTraffic}`;
}

function progressLabelForTest(test: AbTestRow, totalVisitors: number) {
  if (test.status === "DRAFT") {
    return { label: "Ready to launch", percent: 0 };
  }
  if (test.status === "PAUSED") {
    return { label: "Paused", percent: Math.min(100, totalVisitors / 10) };
  }
  if (test.status === "ENDED") {
    return { label: "Ended", percent: 100 };
  }
  if (totalVisitors < MIN_VISITORS_FOR_SIGNAL) {
    return {
      label: `${totalVisitors.toLocaleString()} / ${MIN_VISITORS_FOR_SIGNAL.toLocaleString()} early visitors`,
      percent: Math.min(
        100,
        Math.round((totalVisitors / MIN_VISITORS_FOR_SIGNAL) * 100),
      ),
    };
  }
  return {
    label: `${totalVisitors.toLocaleString()} visitors collected`,
    percent: 100,
  };
}

function getTestDashboardItem({
  test,
  rowStatsByVariant,
  templates,
}: {
  test: AbTestRow;
  rowStatsByVariant: Record<string, AbTestListVariantStats>;
  templates: ThemeTemplateOption[];
}): AbTestDashboardItem {
  const control = test.variants.find((variant) => variant.key === "A");
  const variant = test.variants.find((item) => item.key === "B");
  const preview = templates.find(
    (template) =>
      template.filename === control?.templateFileName ||
      (template.pageType === test.targetPageType &&
        template.templateSuffix === control?.templateSuffix),
  );
  const controlStats = control ? rowStatsByVariant[control.id] : undefined;
  const variantStats = variant ? rowStatsByVariant[variant.id] : undefined;
  const controlVisitors = controlStats?.visitors || 0;
  const variantVisitors = variantStats?.visitors || 0;
  const totalVisitors = controlVisitors + variantVisitors;
  const controlRate = controlStats?.conversionRate ?? null;
  const variantRate = variantStats?.conversionRate ?? null;
  const pointDifference =
    controlRate !== null && variantRate !== null
      ? variantRate - controlRate
      : null;
  const lift =
    controlRate !== null && variantRate !== null
      ? controlRate > 0
        ? ((variantRate - controlRate) / controlRate) * 100
        : variantRate === 0
          ? 0
          : null
      : null;
  const hasEnoughSignal =
    totalVisitors >= MIN_VISITORS_FOR_SIGNAL &&
    controlVisitors >= MIN_VISITORS_PER_VARIANT_FOR_SIGNAL &&
    variantVisitors >= MIN_VISITORS_PER_VARIANT_FOR_SIGNAL;
  const progress = progressLabelForTest(test, totalVisitors);

  let liftLabel = "-";
  let liftDetail = "Needs data";
  let liftTone: AbTestDashboardItem["liftTone"] = "neutral";
  let decisionLabel = "Needs data";
  let decisionTone: AbTestDashboardItem["decisionTone"] = "neutral";

  if (test.status === "DRAFT") {
    liftLabel = "Draft";
    liftDetail = "Setup saved";
    decisionLabel = "Setup saved";
    decisionTone = "neutral";
  } else if (!hasEnoughSignal) {
    liftLabel = "Too early";
    decisionLabel = test.status === "ENDED" ? "Inconclusive" : "Collecting";
    liftDetail = decisionLabel;
    decisionTone = test.status === "ENDED" ? "warning" : "neutral";
  } else if (controlRate === 0 && variantRate !== null && variantRate > 0) {
    liftLabel = "No baseline";
    liftDetail = `+${variantRate.toFixed(1)} pts · B leading`;
    liftTone = "positive";
    decisionLabel = "B leading";
    decisionTone = "success";
  } else if (lift !== null) {
    liftLabel = `${lift > 0 ? "+" : ""}${lift.toFixed(1)}%`;
    if (lift > 0) {
      liftTone = "positive";
      decisionLabel = "B leading";
      decisionTone = "success";
    } else if (lift < 0) {
      liftTone = "negative";
      decisionLabel = "A leading";
      decisionTone = "critical";
    } else {
      decisionLabel = "No lift yet";
      decisionTone = "warning";
    }
    liftDetail = `${pointDifference && pointDifference > 0 ? "+" : ""}${(
      pointDifference || 0
    ).toFixed(1)} pts · ${decisionLabel}`;
  }

  return {
    test,
    control,
    variant,
    preview,
    controlStats,
    variantStats,
    totalVisitors,
    lift,
    liftLabel,
    liftDetail,
    liftTone,
    decisionLabel,
    decisionTone,
    progressLabel: progress.label,
    progressPercent: progress.percent,
    searchableText: [
      test.name,
      PAGE_TYPE_LABELS[test.targetPageType] || test.targetPageType,
      goalLabel(test.goal),
      control?.templateName,
      variant?.templateName,
      test.status,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  };
}

function serializeOption(option: ThemeTemplateOption) {
  return JSON.stringify({
    themeId: option.themeId,
    themeName: option.themeName,
    themeRole: option.themeRole,
    pageType: option.pageType,
    templateName: option.templateName,
    templateSuffix: option.templateSuffix,
    templateFileName: option.filename,
    previewPageUrl: option.previewPageUrl,
    previewImageUrl: option.previewImageUrl,
    previewTitle: option.previewTitle,
    assignedCount: option.assignedCount,
    assignedLabel: option.assignedLabel,
  });
}

function parseOptionValue(value: string): ParsedTemplateOption | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as ParsedTemplateOption;
  } catch {
    return null;
  }
}

function shopAdminStoreHandle(shop: string) {
  return shop.replace(".myshopify.com", "");
}

function numericThemeId(themeId?: string | null) {
  return themeId?.split("/").pop() || "";
}

function themeEditorTemplateParam(filename?: string | null) {
  if (!filename) return "";
  return filename
    .replace(/^templates\//, "")
    .replace(/\.(json|liquid)$/i, "");
}

function buildThemeEditorUrl(
  shop: string,
  template?: ParsedTemplateOption | null,
) {
  const themeId = numericThemeId(template?.themeId);
  const templateParam = themeEditorTemplateParam(template?.templateFileName);
  if (!shop || !themeId || !templateParam) return null;
  const url = new URL(
    `https://admin.shopify.com/store/${shopAdminStoreHandle(shop)}/themes/${themeId}/editor`,
  );
  url.searchParams.set("template", templateParam);
  return url.toString();
}

function abPageTypeToResourceType(pageType?: string | null) {
  if (
    pageType === "PRODUCT" ||
    pageType === "COLLECTION" ||
    pageType === "PAGE" ||
    pageType === "BLOG" ||
    pageType === "HOMEPAGE"
  ) {
    return pageType;
  }
  return null;
}

function pathFromPreviewUrl(value?: string | null) {
  if (!value) return null;
  try {
    return new URL(value).pathname || null;
  } catch {
    return null;
  }
}

function handleFromPreviewPath(
  pageType?: string | null,
  pagePath?: string | null,
) {
  if (!pagePath) return null;
  const patterns: Partial<Record<string, RegExp>> = {
    PRODUCT: /^\/products\/([^/?#]+)/,
    COLLECTION: /^\/collections\/([^/?#]+)/,
    PAGE: /^\/pages\/([^/?#]+)/,
    BLOG: /^\/blogs\/([^/?#]+)(?:\/([^/?#]+))?/,
  };
  const match = pagePath.match(patterns[pageType || ""] || /$a/);
  if (!match) return null;
  return match[2] || match[1] || null;
}

function defaultRecommendationFocusAreas(pageType?: string | null) {
  if (pageType === "PRODUCT") {
    return [
      {
        label: "Strengthen the buying path",
        detail:
          "Make the primary add-to-cart area easier to find and support it with shipping, returns, sizing, and trust cues close to the action.",
      },
      {
        label: "Reduce product-page hesitation",
        detail:
          "Move fit, comparison, guarantee, and proof content above or near the first decision point so visitors do not need to hunt for reassurance.",
      },
      {
        label: "Make variant B measurable",
        detail:
          "Change one meaningful conversion lever in the copied template so the A/B result is attributable.",
      },
    ];
  }
  if (pageType === "COLLECTION") {
    return [
      {
        label: "Improve product discovery",
        detail:
          "Use the variant to test stronger collection intro copy, clearer sorting/filter defaults, or more scannable product cards.",
      },
      {
        label: "Increase product click-through",
        detail:
          "Expose decision-making details on cards such as price, reviews, benefits, or quick actions where the theme supports it.",
      },
      {
        label: "Keep the test focused",
        detail:
          "Avoid changing navigation and product-card behavior at the same time unless the whole collection journey is the hypothesis.",
      },
    ];
  }
  if (pageType === "HOMEPAGE") {
    return [
      {
        label: "Clarify the first action",
        detail:
          "Use the variant to make the main next step obvious above the fold and reduce competing calls to action.",
      },
      {
        label: "Improve pathing",
        detail:
          "Push visitors toward the most valuable collection, product, or quiz path with clearer content hierarchy.",
      },
      {
        label: "Separate message from layout",
        detail:
          "Test one major homepage hypothesis, such as hero offer, category routing, or trust proof placement.",
      },
    ];
  }
  return [
    {
      label: "Clarify the next step",
      detail:
        "Use the variant to make the page's primary action easier to understand and easier to reach.",
    },
    {
      label: "Improve engagement depth",
      detail:
        "Move the strongest proof, explanation, or offer higher on the page so visitors do not abandon before reaching it.",
    },
    {
      label: "Keep the variant clean",
      detail:
        "Make one meaningful page-template change before launch so the test result has a clear interpretation.",
    },
  ];
}

function numberMetric(stats: any, key: string) {
  const value = Number(stats?.[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function snapshotPlanConfidence(realCount: number, signals: number) {
  const sampleScore = Math.min(55, Math.round(realCount / 4));
  return Math.max(35, Math.min(92, sampleScore + signals * 9));
}

function buildSnapshotTemplateTransformation({
  pageType,
  realCount,
  atcRate,
  convRate,
  exitRate,
  avgScrollDepth,
  bodyCtaCtrRate,
  resourceTitle,
}: {
  pageType: string;
  realCount: number;
  atcRate: number;
  convRate: number;
  exitRate: number;
  avgScrollDepth: number;
  bodyCtaCtrRate: number;
  resourceTitle: string;
}): SnapshotTemplateTransformation {
  const interventions = [
    {
      id: "low_product_confidence",
      applies: pageType === "PRODUCT" && atcRate < 4,
      priority: 95,
      label: "Low add-to-cart confidence",
      reason: `${atcRate.toFixed(1)}% add-to-cart rate from ${realCount.toLocaleString()} real visitors.`,
      sectionTitle: "Make the buying decision easier",
      sectionBody:
        "This variant adds purchase reassurance near the buying area so visitors see fit, shipping, returns, and support cues before they decide whether to add to cart.",
    },
    {
      id: "high_exit_rate",
      applies: exitRate > 35,
      priority: 85,
      label: "High exit rate",
      reason: `${exitRate.toFixed(1)}% exit rate from the selected snapshot.`,
      sectionTitle: "Still deciding?",
      sectionBody:
        "This variant adds a clearer next step and reassurance block near the top of the page to reduce early exits and give uncertain visitors a reason to continue.",
    },
    {
      id: "low_scroll_depth",
      applies: avgScrollDepth > 0 && avgScrollDepth < 55,
      priority: 75,
      label: "Low scroll depth",
      reason: `${avgScrollDepth.toFixed(1)}% average scroll depth means visitors may not reach important proof or buying guidance.`,
      sectionTitle: "Key details before you scroll",
      sectionBody:
        "This variant moves the most important proof and decision cues higher on the page so visitors do not need to scroll deeply before understanding the offer.",
    },
    {
      id: "low_cta_clickthrough",
      applies: bodyCtaCtrRate > 0 && bodyCtaCtrRate < 12,
      priority: 70,
      label: "Low CTA clickthrough",
      reason: `${bodyCtaCtrRate.toFixed(1)}% body CTA clickthrough from the selected snapshot.`,
      sectionTitle: "Choose your next step",
      sectionBody:
        "This variant adds a focused action block to reduce competing choices and make the next buying step easier to find.",
    },
    {
      id: "low_conversion_rate",
      applies: ["PRODUCT", "CART"].includes(pageType) && convRate < 2,
      priority: 65,
      label: "Low conversion rate",
      reason: `${convRate.toFixed(1)}% conversion rate from the selected snapshot.`,
      sectionTitle: "Checkout with confidence",
      sectionBody:
        "This variant adds conversion reassurance before checkout so visitors can resolve final concerns around value, delivery, returns, and support.",
    },
    {
      id: "collection_discovery",
      applies: pageType === "COLLECTION",
      priority: 55,
      label: "Collection discovery needs clearer routing",
      reason:
        "Collection snapshots benefit from clearer browse guidance and stronger routing into product detail pages.",
      sectionTitle: "Find the right option faster",
      sectionBody:
        "This variant adds collection guidance that helps visitors compare options and move from browsing into the most relevant product page.",
    },
  ]
    .filter((intervention) => intervention.applies)
    .sort((left, right) => right.priority - left.priority);

  const selected = interventions[0] || {
    id: "baseline_snapshot_learning",
    priority: 40,
    label: "Snapshot-informed baseline refinement",
    reason: `${realCount.toLocaleString()} real visitors were reviewed for ${resourceTitle}.`,
    sectionTitle: "What shoppers need to know",
    sectionBody:
      "This variant adds a concise decision-support block based on the selected snapshot so the test has a clear page-level change to evaluate.",
  };

  return {
    primaryWeakness: selected.label,
    evidence: selected.reason,
    intervention: {
      id: selected.id,
      label: selected.label,
      reason: selected.reason,
      sectionTitle: selected.sectionTitle,
      sectionBody: selected.sectionBody,
      priority: selected.priority,
    },
    status: "not_applicable",
    changedFiles: [],
    notes: [
      "Generated before theme-file creation. The final inserted section details are added after the B template is written.",
    ],
  };
}

async function buildTemplateSnapshotPlan({
  shop,
  controlTemplate,
  snapshotId,
}: {
  shop: string;
  controlTemplate: ThemeTemplateOption;
  snapshotId: string;
}): Promise<TemplateSnapshotPlan> {
  const recommendedType = abPageTypeToResourceType(controlTemplate.pageType);
  if (!recommendedType) {
    throw new Error(
      "Snapshot-generated variants are not available for this page type yet.",
    );
  }

  const snapshot = await prisma.snapshot.findFirst({
    where: {
      id: snapshotId,
      status: "COMPLETED",
      project: {
        shop,
        resourceType: recommendedType,
      },
    },
    include: {
      project: true,
      statsCache: true,
      _count: { select: { visits: true } },
    },
  });

  if (!snapshot) {
    throw new Error(
      "Select a completed snapshot that matches this A/B test page type.",
    );
  }

  const stats = (snapshot.statsCache?.stats || {}) as any;
  const totalSessions =
    numberMetric(stats, "totalSessions") || snapshot._count.visits || 0;
  const realCount = numberMetric(stats, "realCount");
  const addToCartCount = numberMetric(stats, "addToCartCount");
  const conversionCount = numberMetric(stats, "conversionCount");
  const atcRate = numberMetric(stats, "atcRate");
  const convRate = numberMetric(stats, "convRate");
  const exitRate = numberMetric(stats, "exitRate");
  const avgScrollDepth = numberMetric(stats, "avgScrollDepth");
  const bodyCtaCtrRate = numberMetric(stats, "bodyCtaCtrRate");
  const revenue = numberMetric(stats, "totalRevenue");
  const focusAreas = defaultRecommendationFocusAreas(controlTemplate.pageType);
  const detected: TemplateSnapshotPlan["focusAreas"] = [];

  if (realCount < 25) {
    detected.push({
      label: "Collect more signal before making heavy edits",
      detail: `${realCount.toLocaleString()} real visitors were captured, so use this generated template as a cautious first variant and review it manually before launch.`,
    });
  }

  if (atcRate < 4 && controlTemplate.pageType === "PRODUCT") {
    detected.push({
      label: "Improve add-to-cart confidence",
      detail: `${addToCartCount.toLocaleString()} add-to-carts from ${realCount.toLocaleString()} real visitors (${atcRate.toFixed(1)}%). Build B around stronger CTA visibility, sizing/support reassurance, and purchase confidence near the buying area.`,
    });
  }

  if (convRate < 2 && ["PRODUCT", "CART"].includes(controlTemplate.pageType)) {
    detected.push({
      label: "Reduce purchase hesitation",
      detail: `${conversionCount.toLocaleString()} orders were attributed (${convRate.toFixed(1)}% CVR). Keep the variant focused on removing uncertainty before checkout.`,
    });
  }

  if (bodyCtaCtrRate < 12) {
    detected.push({
      label: "Make the next action easier to find",
      detail: `Body CTA CTR is ${bodyCtaCtrRate.toFixed(1)}%. Use the copied template to make primary actions more visible and reduce competing content before the next step.`,
    });
  }

  if (exitRate > 35) {
    detected.push({
      label: "Lower early exits",
      detail: `Exit rate is ${exitRate.toFixed(1)}%. Variant B should clarify the page promise and next action before visitors abandon or go idle.`,
    });
  }

  if (avgScrollDepth < 55) {
    detected.push({
      label: "Move important content higher",
      detail: `Average scroll depth is ${avgScrollDepth.toFixed(1)}%. Move proof, offer, fit, or discovery content closer to the top instead of relying on deep scroll.`,
    });
  }

  if (controlTemplate.pageType === "COLLECTION" && atcRate < 3) {
    detected.push({
      label: "Improve product discovery from the listing",
      detail:
        "Use this collection variant to test clearer collection copy, product-card decision cues, sorting/filter defaults, or stronger product routing.",
    });
  }

  const signals = detected.filter(
    (area) => !area.label.toLowerCase().includes("collect more"),
  ).length;
  const appliedFocusAreas = [...detected, ...focusAreas].slice(0, 5);
  const transformation = buildSnapshotTemplateTransformation({
    pageType: controlTemplate.pageType,
    realCount,
    atcRate,
    convRate,
    exitRate,
    avgScrollDepth,
    bodyCtaCtrRate,
    resourceTitle: snapshot.project.productTitle,
  });
  const confidence = snapshotPlanConfidence(realCount, signals);
  const metricSummary = [
    `${realCount.toLocaleString()} real visitors`,
    `${atcRate.toFixed(1)}% ATC`,
    `${convRate.toFixed(1)}% CVR`,
    `${exitRate.toFixed(1)}% exit`,
    `${avgScrollDepth.toFixed(1)}% scroll`,
  ].join(" · ");

  return {
    title: `Snapshot-guided ${selectedPageTypeName(controlTemplate.pageType)} variant`,
    summary: `${snapshot.project.productTitle} snapshot found ${metricSummary}. Variant B will apply a ${transformation.primaryWeakness.toLowerCase()} intervention so the template change can be traced back to this snapshot.`,
    sourceLabel: `${snapshot.name || `Snapshot ${snapshot.number}`} · ${snapshot.project.productTitle}`,
    snapshotId: snapshot.id,
    snapshotName: snapshot.name || `Snapshot ${snapshot.number}`,
    snapshotResourceTitle: snapshot.project.productTitle,
    confidence,
    metrics: {
      realVisitors: realCount,
      totalVisits: totalSessions,
      addToCartRate: atcRate,
      conversionRate: convRate,
      revenue,
      exitRate,
      avgScrollDepth,
      bodyCtaCtrRate,
    },
    focusAreas: appliedFocusAreas,
    transformation,
  };
}

function selectedPageTypeName(pageType?: string | null) {
  return (PAGE_TYPE_LABELS[pageType || ""] || "template").toLowerCase();
}

function templateIdentity(option?: ParsedTemplateOption | null) {
  if (!option) return "";
  return [
    option.themeId || "",
    option.pageType || "",
    option.templateFileName || "",
    option.templateSuffix || "",
  ].join("::");
}

function isSameTemplateOption(
  left?: ParsedTemplateOption | null,
  right?: ParsedTemplateOption | null,
) {
  const leftKey = templateIdentity(left);
  const rightKey = templateIdentity(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function isSameTemplateSelection({
  controlOption,
  variantOption,
  targetPageType,
  controlSuffix,
  variantSuffix,
  controlFilename,
  variantFilename,
}: {
  controlOption?: ParsedTemplateOption | null;
  variantOption?: ParsedTemplateOption | null;
  targetPageType: string;
  controlSuffix?: string | null;
  variantSuffix?: string | null;
  controlFilename?: string | null;
  variantFilename?: string | null;
}) {
  if (isSameTemplateOption(controlOption, variantOption)) return true;
  const normalizedControlFilename = controlFilename || "";
  const normalizedVariantFilename = variantFilename || "";
  if (
    normalizedControlFilename &&
    normalizedVariantFilename &&
    normalizedControlFilename === normalizedVariantFilename
  ) {
    return true;
  }

  return (
    !variantOption &&
    normalizeTemplateSelectionSuffix(controlSuffix) ===
      normalizeTemplateSelectionSuffix(variantSuffix) &&
    buildManualFilename(targetPageType, controlSuffix || "") ===
      buildManualFilename(targetPageType, variantSuffix || "")
  );
}

function normalizeTemplateSelectionSuffix(value?: string | null) {
  return (value || "").trim();
}

function parsedOptionToThemeTemplate(
  option: ParsedTemplateOption | null,
): ThemeTemplateOption | null {
  const pageType = normalizeAbTestPageType(option?.pageType);
  if (
    !option?.themeId ||
    !option.themeName ||
    !option.themeRole ||
    !pageType ||
    !option.templateFileName ||
    !option.templateName
  ) {
    return null;
  }

  return {
    themeId: option.themeId,
    themeName: option.themeName,
    themeRole: option.themeRole,
    pageType,
    filename: option.templateFileName,
    templateName: option.templateName,
    templateSuffix: option.templateSuffix || null,
    isDefault: !option.templateSuffix,
    previewPageUrl: option.previewPageUrl || null,
    previewImageUrl: option.previewImageUrl || null,
    previewTitle: option.previewTitle || null,
    assignedCount: option.assignedCount ?? null,
    assignedLabel: option.assignedLabel || null,
  };
}

function themeWriteErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (
    lower.includes("access denied") ||
    lower.includes("write_themes") ||
    lower.includes("exemption")
  ) {
    return "Shopify denied theme-file creation. The app needs write_themes access and Shopify's theme-file exemption before Duplicate and Recommendations can create real templates.";
  }
  return message || "Could not create the variant template.";
}

function untitledNameForPageType(pageType: string) {
  const option = PAGE_TYPE_OPTIONS.find((item) => item.value === pageType);
  return `Untitled ${option?.noun || "template"} test`;
}

function getTemplateName(
  optionValue: string,
  manualName: string,
  fallback: string,
) {
  return parseOptionValue(optionValue)?.templateName || manualName || fallback;
}

function getTemplateSuffix(optionValue: string, manualSuffix: string) {
  const parsed = parseOptionValue(optionValue);
  if (parsed) return parsed.templateSuffix || "";
  return manualSuffix;
}

function buildManualFilename(pageType: string, suffix: string) {
  const baseByType: Record<string, string> = {
    PRODUCT: "product",
    COLLECTION: "collection",
    PAGE: "page",
    BLOG: "article",
    HOMEPAGE: "index",
    CART: "cart",
  };
  const base = baseByType[pageType] || "product";
  return suffix ? `${base}.${suffix}.json` : `${base}.json`;
}

function pageTargetNoun(pageType: string, count?: number | null) {
  const plural = !count || count !== 1;
  const nounByType: Record<string, [string, string]> = {
    PRODUCT: ["product", "products"],
    COLLECTION: ["collection", "collections"],
    PAGE: ["page", "pages"],
    BLOG: ["article", "articles"],
    HOMEPAGE: ["homepage", "homepage"],
    CART: ["cart page", "cart page"],
  };
  const nouns = nounByType[pageType] || ["page", "pages"];
  return plural ? nouns[1] : nouns[0];
}

function clampTrafficPercent(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.min(95, Math.max(5, Math.round(value)));
}

function TemplatePreview({
  label,
  imageUrl,
  pageUrl,
  muted,
  height = 280,
}: {
  label?: string | null;
  imageUrl?: string | null;
  pageUrl?: string | null;
  muted?: boolean;
  height?: number;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(imageUrl && !failed);

  return (
    <div
      style={{
        height,
        borderBottom: "1px solid var(--p-color-border-secondary)",
        background: muted
          ? "linear-gradient(135deg, #f3f3f3, #e5e5e5)"
          : "linear-gradient(135deg, #eaf5ff, #f7fbff 48%, #fff4e8)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {showImage ? (
        <img
          src={imageUrl || ""}
          alt={label ? `${label} template preview` : "Template preview"}
          loading="lazy"
          onError={() => setFailed(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "top center",
            display: "block",
            filter: muted ? "grayscale(1) opacity(0.72)" : undefined,
          }}
        />
      ) : (
        <>
          <div
            style={{
              position: "absolute",
              inset: 16,
              borderRadius: 8,
              background: "rgba(255,255,255,0.72)",
              border: "1px solid rgba(0,0,0,0.08)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 34,
              top: 36,
              width: 86,
              height: 86,
              borderRadius: 10,
              background: muted
                ? "linear-gradient(135deg, #d8d8d8, #efefef)"
                : "linear-gradient(135deg, #c7e9f4, #f6fbff)",
              border: "1px solid rgba(0,0,0,0.08)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 138,
              top: 40,
              right: 34,
              display: "grid",
              gap: 10,
            }}
          >
            <div
              style={{
                height: 13,
                width: "72%",
                borderRadius: 999,
                background: "#1f2933",
              }}
            />
            <div
              style={{
                height: 9,
                width: "92%",
                borderRadius: 999,
                background: "#c8c8c8",
              }}
            />
            <div
              style={{
                height: 9,
                width: "80%",
                borderRadius: 999,
                background: "#d7d7d7",
              }}
            />
            <div
              style={{
                height: 22,
                width: 108,
                borderRadius: 6,
                background: muted ? "#bdbdbd" : "#101010",
              }}
            />
          </div>
        </>
      )}
      {!showImage ? (
        <div
          style={{
            position: "absolute",
            right: 14,
            bottom: 12,
            padding: "4px 8px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.82)",
            border: "1px solid rgba(0,0,0,0.06)",
            fontSize: 12,
            color: "#5f6368",
          }}
        >
          {label || "Theme preview"}
        </div>
      ) : null}
      {!showImage && pageUrl ? (
        <div
          style={{
            position: "absolute",
            left: 14,
            bottom: 12,
            maxWidth: "65%",
            padding: "4px 8px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.84)",
            border: "1px solid rgba(0,0,0,0.06)",
            fontSize: 11,
            color: "#5f6368",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {new URL(pageUrl).pathname}
        </div>
      ) : null}
    </div>
  );
}

function VariantBadge({
  label,
  tone,
}: {
  label: string;
  tone: "blue" | "yellow";
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        minHeight: 30,
        borderRadius: 999,
        padding: "4px 12px",
        fontWeight: 700,
        background: tone === "blue" ? "#d7ebff" : "#fff080",
        color: tone === "blue" ? "#063b5f" : "#4b3f00",
      }}
    >
      {label}
    </span>
  );
}

function TinyIcon({ type }: { type: string }) {
  const symbolByType: Record<string, string> = {
    play: "▷",
    pause: "Ⅱ",
    edit: "✎",
    archive: "▣",
    swap: "⇄",
    select: "▦",
    duplicate: "▣",
    spark: "✦",
    search: "⌕",
  };
  return (
    <span aria-hidden="true" style={{ fontWeight: 700, lineHeight: 1 }}>
      {symbolByType[type] || "•"}
    </span>
  );
}

function MiniProgressBar({
  percent,
  tone = "neutral",
}: {
  percent: number;
  tone?: "success" | "warning" | "critical" | "neutral";
}) {
  const fillByTone = {
    success: "#008060",
    warning: "#b7791f",
    critical: "#d72c0d",
    neutral: "#2c6ecb",
  };

  return (
    <div
      style={{
        height: 8,
        borderRadius: 999,
        background: "#e4e5e7",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.max(3, Math.min(100, percent))}%`,
          height: "100%",
          borderRadius: 999,
          background: fillByTone[tone],
        }}
      />
    </div>
  );
}

function MetricBlock({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const colorByTone = {
    positive: "#008060",
    negative: "#d72c0d",
    neutral: "#303030",
  };

  return (
    <div>
      <Text as="span" tone="subdued">
        {label}
      </Text>
      <div
        style={{
          marginTop: 4,
          color: colorByTone[tone],
          fontSize: 20,
          fontWeight: 750,
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      <Text as="span" tone="subdued">
        {detail}
      </Text>
    </div>
  );
}

function DashboardTestCard({
  item,
  isLoading,
  onOpenDetails,
  onSubmitStatus,
}: {
  item: AbTestDashboardItem;
  isLoading: boolean;
  onOpenDetails: (testId: string) => void;
  onSubmitStatus: (action: string, testId: string) => void;
}) {
  const { test, control, variant, controlStats, variantStats } = item;
  const controlVisitors = controlStats?.visitors || 0;
  const variantVisitors = variantStats?.visitors || 0;
  const controlRate = controlStats?.conversionRate || 0;
  const variantRate = variantStats?.conversionRate || 0;
  const progressTone =
    item.decisionTone === "success"
      ? "success"
      : item.decisionTone === "critical"
        ? "critical"
        : item.decisionTone === "warning"
          ? "warning"
          : "neutral";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenDetails(test.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetails(test.id);
        }
      }}
      style={{
        border: "1px solid var(--p-color-border-secondary)",
        borderRadius: 12,
        background: "var(--p-color-bg-surface)",
        boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
        cursor: "pointer",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.35fr) minmax(360px, 0.95fr)",
          gap: "12px 18px",
          alignItems: "start",
          padding: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: 104,
              flex: "0 0 104px",
              borderRadius: 8,
              overflow: "hidden",
              border: "1px solid var(--p-color-border-secondary)",
              background: "#fff",
            }}
          >
            <TemplatePreview
              imageUrl={item.preview?.previewImageUrl}
              pageUrl={item.preview?.previewPageUrl}
              label={control?.templateSuffix || "A/B"}
              muted={test.status === "ENDED"}
              height={72}
            />
          </div>

          <BlockStack gap="100">
            <InlineStack gap="150" blockAlign="center" wrap>
              <Badge tone={statusTone(test.status)}>
                {test.status.toLowerCase()}
              </Badge>
              <Badge>
                {PAGE_TYPE_LABELS[test.targetPageType] || test.targetPageType}
              </Badge>
              <Badge tone="info">{goalLabel(test.goal)}</Badge>
              <Badge>{variantTrafficLabel(test)} split</Badge>
            </InlineStack>
            <Text as="h3" variant="headingMd">
              {test.name}
            </Text>
            <Text as="p" tone="subdued">
              {control?.templateName || "Original"} vs{" "}
              {variant?.templateName || "Variant"} · Started{" "}
              {formatCompactDate(test.launchedAt || test.createdAt)}
              {test.endedAt
                ? ` · Ended ${formatCompactDate(test.endedAt)}`
                : ""}
            </Text>
          </BlockStack>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(104px, 1fr))",
            gap: 14,
            alignItems: "start",
          }}
        >
          <MetricBlock
            label="Visitors"
            value={item.totalVisitors.toLocaleString()}
            detail={`A ${controlVisitors.toLocaleString()} · B ${variantVisitors.toLocaleString()}`}
          />
          <MetricBlock
            label="CVR"
            value={`${variantRate.toFixed(1)}%`}
            detail={`A ${controlRate.toFixed(1)}%`}
          />
          <MetricBlock
            label="Lift"
            value={item.liftLabel}
            detail={item.liftDetail}
            tone={item.liftTone}
          />
        </div>

        <div
          style={{
            gridColumn: "1 / -1",
            display: "grid",
            gridTemplateColumns: "minmax(260px, 1fr) auto",
            gap: 16,
            alignItems: "end",
            paddingTop: 2,
          }}
        >
          <div>
            <Text as="span" tone="subdued">
              Progress
            </Text>
            <div style={{ marginTop: 8 }}>
              <MiniProgressBar
                percent={item.progressPercent}
                tone={progressTone}
              />
            </div>
            <div style={{ marginTop: 6 }}>
              <Text as="span" tone="subdued">
                {item.progressLabel}
              </Text>
            </div>
          </div>
          <div onClick={(event) => event.stopPropagation()}>
            <InlineStack gap="150" align="end" wrap>
              <Button size="slim" onClick={() => onOpenDetails(test.id)}>
                View details
              </Button>
              {test.status === "DRAFT" ? (
                <Button
                  size="slim"
                  variant="primary"
                  onClick={() => onSubmitStatus("launch-test", test.id)}
                  loading={isLoading}
                >
                  Launch
                </Button>
              ) : null}
              {test.status === "LIVE" ? (
                <Button
                  size="slim"
                  onClick={() => onSubmitStatus("pause-test", test.id)}
                  loading={isLoading}
                >
                  Pause
                </Button>
              ) : null}
              {test.status === "PAUSED" ? (
                <Button
                  size="slim"
                  variant="primary"
                  onClick={() => onSubmitStatus("launch-test", test.id)}
                  loading={isLoading}
                >
                  Resume
                </Button>
              ) : null}
              {test.status === "LIVE" || test.status === "PAUSED" ? (
                <Button
                  size="slim"
                  onClick={() => onSubmitStatus("end-test", test.id)}
                  loading={isLoading}
                >
                  End
                </Button>
              ) : null}
            </InlineStack>
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplateSummaryCard({
  side,
  title,
  templateName,
  filename,
  suffix,
  previewImageUrl,
  previewPageUrl,
  assignedLabel,
  onSwap,
  showAction = true,
  disabled,
}: {
  side: "A" | "B";
  title: string;
  templateName: string;
  filename: string;
  suffix?: string | null;
  previewImageUrl?: string | null;
  previewPageUrl?: string | null;
  assignedLabel?: string | null;
  onSwap: () => void;
  showAction?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        minHeight: 538,
        border: "1px solid var(--p-color-border)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--p-color-bg-surface)",
      }}
    >
      <div
        style={{
          padding: 18,
          borderBottom: "1px solid var(--p-color-border-secondary)",
        }}
      >
        <InlineStack align="space-between" blockAlign="center" gap="300">
          <InlineStack gap="200" blockAlign="center">
            <VariantBadge
              label={`${side} · ${title}`}
              tone={side === "A" ? "blue" : "yellow"}
            />
          </InlineStack>
          {showAction ? (
            <Button onClick={onSwap} disabled={disabled}>
              {side === "A" ? "Swap template" : "Select template"}
            </Button>
          ) : null}
        </InlineStack>
      </div>
      <TemplatePreview
        imageUrl={previewImageUrl}
        pageUrl={previewPageUrl}
        label={suffix ? `?view=${suffix}` : "Default view"}
        height={360}
      />
      <div style={{ padding: 20 }}>
        <BlockStack gap="100">
          <Text as="h3" variant="headingLg">
            {templateName}
          </Text>
          <Text as="p" tone="subdued">
            {filename}
          </Text>
          <InlineStack gap="150" wrap>
            {suffix ? (
              <Badge tone="info">{`Uses ?view=${suffix}`}</Badge>
            ) : (
              <Badge>Default template</Badge>
            )}
            {assignedLabel ? (
              <Badge tone="success">{assignedLabel}</Badge>
            ) : null}
          </InlineStack>
        </BlockStack>
      </div>
    </div>
  );
}

function VariantChoiceCard({
  icon,
  title,
  description,
  onClick,
  disabled,
  selected,
  accent = "neutral",
  disabledReason,
}: {
  icon: string;
  title: string;
  description: string;
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
  accent?: "neutral" | "amber" | "blue";
  disabledReason?: string;
}) {
  const accentStyles = {
    neutral: {
      border: "var(--p-color-border)",
      background: "var(--p-color-bg-surface)",
      iconBackground: "#f4f4f4",
      iconColor: "#303030",
    },
    amber: {
      border: "#a16b16",
      background: "#fbf3e1",
      iconBackground: "#fff",
      iconColor: "#8a6116",
    },
    blue: {
      border: "#2c6ecb",
      background: "#ebf2fc",
      iconBackground: "#fff",
      iconColor: "#2c6ecb",
    },
  }[selected ? accent : "neutral"];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        textAlign: "left",
        display: "flex",
        gap: 18,
        alignItems: "center",
        padding: "18px 20px",
        borderRadius: 8,
        border: `1px solid ${
          disabled ? "var(--p-color-border)" : accentStyles.border
        }`,
        background: disabled ? "#f2f2f2" : accentStyles.background,
        color: disabled ? "#8a8a8a" : "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          display: "grid",
          placeItems: "center",
          background: disabled ? "#e4e4e4" : accentStyles.iconBackground,
          color: disabled ? "#8a8a8a" : accentStyles.iconColor,
          fontSize: 22,
        }}
      >
        <TinyIcon type={icon} />
      </span>
      <span>
        <Text as="span" variant="headingMd">
          {title}
        </Text>
        <Text as="p" tone="subdued">
          {description}
        </Text>
        {disabledReason ? (
          <Text as="p" tone="critical">
            {disabledReason}
          </Text>
        ) : null}
      </span>
    </button>
  );
}

function PageTypeRail({
  activeType,
  templateCounts,
  onSelect,
}: {
  activeType: string;
  templateCounts: Record<string, number>;
  onSelect: (value: string) => void;
}) {
  return (
    <div
      style={{
        borderRight: "1px solid var(--p-color-border-secondary)",
        padding: "16px 12px",
        background: "#fbfbfb",
      }}
    >
      <Text as="p" variant="bodySm" tone="subdued" fontWeight="semibold">
        Page type
      </Text>
      <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
        {PAGE_TYPE_OPTIONS.map((option) => {
          const active = option.value === activeType;
          const count = templateCounts[option.value] || 0;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                border: 0,
                borderRadius: 8,
                padding: "10px 12px",
                background: active ? "#ebf2fc" : "transparent",
                color: active ? "#2c6ecb" : "#303030",
                fontWeight: active ? 700 : 500,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: active ? "#2c6ecb" : "#c9cccf",
                  flex: "0 0 auto",
                }}
              />
              <span style={{ flex: 1 }}>{option.label}</span>
              {count > 0 ? (
                <span style={{ color: active ? "#2c6ecb" : "#6d7175" }}>
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TemplateListOption({
  template,
  side,
  selected,
  disabled,
  disabledReason,
  onSelect,
}: {
  template: ThemeTemplateOption;
  side: "A" | "B";
  selected: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: () => void;
}) {
  function handleSelect() {
    if (!disabled) onSelect();
  }

  return (
    <button
      type="button"
      onClick={handleSelect}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        handleSelect();
      }}
      disabled={disabled}
      aria-pressed={selected}
      data-ab-template-side={side}
      data-ab-template-file={template.filename}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderRadius: 10,
        border: selected ? "1.5px solid #2c6ecb" : "1px solid #e1e1e1",
        background: selected ? "#ebf2fc" : disabled ? "#f6f6f7" : "#fff",
        color: disabled ? "#8a8a8a" : "inherit",
        opacity: disabled ? 0.68 : 1,
        padding: "12px 14px",
        cursor: disabled ? "not-allowed" : "pointer",
        textAlign: "left",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          border: selected ? "2px solid #2c6ecb" : "2px solid #c9cccf",
          display: "grid",
          placeItems: "center",
          flex: "0 0 auto",
        }}
      >
        {selected ? (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "#2c6ecb",
            }}
          />
        ) : null}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <Text as="span" variant="headingMd">
          {template.templateName}
        </Text>
        <Text as="p" tone="subdued">
          {template.filename}
        </Text>
        {disabledReason ? (
          <Text as="p" tone="critical">
            {disabledReason}
          </Text>
        ) : null}
      </span>
      <span style={{ flex: "0 0 auto" }}>
        <Badge tone={template.isDefault ? "success" : undefined}>
          {template.isDefault ? "Default" : "Alternate"}
        </Badge>
      </span>
      {template.assignedCount !== null &&
      template.assignedCount !== undefined ? (
        <span style={{ flex: "0 0 auto" }}>
          <Badge tone="info">
            {template.assignedCount.toLocaleString()}{" "}
            {pageTargetNoun(template.pageType, template.assignedCount)}
          </Badge>
        </span>
      ) : null}
    </button>
  );
}

function formatPercentValue(value: number) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function SnapshotListOption({
  snapshot,
  selected,
  onSelect,
}: {
  snapshot: SnapshotOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        width: "100%",
        textAlign: "left",
        borderRadius: 10,
        border: selected ? "1.5px solid #a16b16" : "1px solid #e1e1e1",
        background: selected ? "#fbf3e1" : "#fff",
        padding: 14,
        cursor: "pointer",
      }}
    >
      <BlockStack gap="250">
        <InlineStack align="space-between" gap="300" blockAlign="start">
          <BlockStack gap="050">
            <Text as="span" variant="headingMd">
              {snapshot.resourceTitle}
            </Text>
            <Text as="span" tone="subdued">
              {snapshot.name || `Snapshot ${snapshot.number}`} ·{" "}
              {snapshot.realCount.toLocaleString()}/
              {snapshot.targetVisitors.toLocaleString()} real visitors
            </Text>
          </BlockStack>
          <Badge tone="success">Completed</Badge>
        </InlineStack>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 8,
          }}
        >
          <MetricBlock
            label="ATC"
            value={formatPercentValue(snapshot.atcRate)}
            detail="add-to-cart"
          />
          <MetricBlock
            label="CVR"
            value={formatPercentValue(snapshot.convRate)}
            detail="conversion"
          />
          <MetricBlock
            label="Exit"
            value={formatPercentValue(snapshot.exitRate)}
            detail="leaving"
            tone={snapshot.exitRate > 35 ? "negative" : "neutral"}
          />
          <MetricBlock
            label="Scroll"
            value={formatPercentValue(snapshot.avgScrollDepth)}
            detail="avg depth"
          />
        </div>
      </BlockStack>
    </button>
  );
}

function ManualTemplateFields({
  side,
  pageType,
  templateName,
  templateSuffix,
  setTemplateName,
  setTemplateSuffix,
  onApply,
}: {
  side: "A" | "B";
  pageType: string;
  templateName: string;
  templateSuffix: string;
  setTemplateName: (value: string) => void;
  setTemplateSuffix: (value: string) => void;
  onApply: () => void;
}) {
  return (
    <details style={{ marginTop: 12 }}>
      <summary
        style={{
          cursor: "pointer",
          color: "#5f6368",
          fontWeight: 600,
          marginBottom: 10,
        }}
      >
        Advanced manual {side} template
      </summary>
      <BlockStack gap="250">
        <TextField
          label="Template name"
          value={templateName}
          onChange={setTemplateName}
          autoComplete="off"
        />
        <TextField
          label="Template suffix"
          value={templateSuffix}
          onChange={setTemplateSuffix}
          autoComplete="off"
          helpText={`File: ${buildManualFilename(pageType, templateSuffix)}`}
        />
        <InlineStack align="end">
          <Button onClick={onApply}>Use manual template</Button>
        </InlineStack>
      </BlockStack>
    </details>
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const [tests, themeTemplates, completedSnapshots, billingAccess] =
    await Promise.all([
    prisma.abTest.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        variants: {
          orderBy: { sortOrder: "asc" },
        },
      },
    }),
    cachedValue(loaderCacheKeys.abTestTemplates(shop), 60_000, () =>
      getThemeTemplateOptions(admin),
    ),
      prisma.snapshot.findMany({
        where: {
          status: "COMPLETED",
          project: { shop },
        },
        orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
        take: 120,
        include: {
          project: true,
          statsCache: true,
          _count: { select: { visits: true } },
        },
      }),
      getBillingAccess(shop),
    ]);
  const assignmentGroups = tests.length
    ? await prisma.abTestAssignment.groupBy({
        by: ["testId", "variantId", "visitorType", "converted"],
        where: {
          shop,
          testId: { in: tests.map((test) => test.id) },
        },
        _count: { _all: true },
        _sum: { orderValue: true },
      })
    : [];
  const rowStatsByVariant: Record<string, AbTestListVariantStats> = {};

  for (const group of assignmentGroups) {
    if (group.visitorType !== "REAL") continue;
    const existing = rowStatsByVariant[group.variantId] || {
      visitors: 0,
      conversions: 0,
      conversionRate: 0,
      revenue: 0,
    };
    existing.visitors += group._count._all;
    if (group.converted) {
      existing.conversions += group._count._all;
      existing.revenue += Number(group._sum.orderValue || 0);
    }
    rowStatsByVariant[group.variantId] = existing;
  }

  for (const stats of Object.values(rowStatsByVariant)) {
    stats.conversionRate = stats.visitors
      ? (stats.conversions / stats.visitors) * 100
      : 0;
  }

  return json({
    shop,
    billingAccess,
    themeTemplates,
    rowStatsByVariant,
    completedSnapshots: completedSnapshots.map((snapshot) => {
      const stats = (snapshot.statsCache?.stats || {}) as any;
      return {
        id: snapshot.id,
        name: snapshot.name || `Snapshot ${snapshot.number}`,
        number: snapshot.number,
        resourceType: snapshot.project.resourceType,
        resourceTitle: snapshot.project.productTitle,
        resourceHandle: snapshot.project.productHandle,
        targetVisitors: snapshot.targetVisitors,
        realCount: numberMetric(stats, "realCount"),
        totalSessions:
          numberMetric(stats, "totalSessions") || snapshot._count.visits || 0,
        atcRate: numberMetric(stats, "atcRate"),
        convRate: numberMetric(stats, "convRate"),
        revenue: numberMetric(stats, "totalRevenue"),
        avgScrollDepth: numberMetric(stats, "avgScrollDepth"),
        exitRate: numberMetric(stats, "exitRate"),
        bodyCtaCtrRate: numberMetric(stats, "bodyCtaCtrRate"),
        createdAt: snapshot.createdAt.toISOString(),
        completedAt: snapshot.completedAt?.toISOString() ?? null,
      };
    }),
    canWriteThemes:
      session.scope
        ?.split(",")
        .map((scope) => scope.trim())
        .includes("write_themes") || false,
    tests: tests.map((test) => ({
      ...test,
      createdAt: test.createdAt.toISOString(),
      launchedAt: test.launchedAt?.toISOString() ?? null,
      pausedAt: test.pausedAt?.toISOString() ?? null,
      endedAt: test.endedAt?.toISOString() ?? null,
      variants: test.variants.map((variant) => ({
        ...variant,
        createdAt: variant.createdAt.toISOString(),
        updatedAt: variant.updatedAt.toISOString(),
      })),
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = String(formData.get("action") || "");

  if (
    actionType === "duplicate-template-variant" ||
    actionType === "snapshot-template-variant"
  ) {
    const controlTemplate = parsedOptionToThemeTemplate(
      parseOptionValue(String(formData.get("controlOption") || "")),
    );
    if (!controlTemplate) {
      return json<VariantCreateActionData>(
        {
          ok: false,
          error: "Select an original template before creating a variant.",
        },
        { status: 400 },
      );
    }

    try {
      const isSnapshotAction = actionType === "snapshot-template-variant";
      const snapshotId = String(formData.get("snapshotId") || "");
      const snapshotPlan = isSnapshotAction
        ? await buildTemplateSnapshotPlan({
            shop,
            controlTemplate,
            snapshotId,
          })
        : null;
      const template = await createThemeTemplateVariant({
        admin,
        control: controlTemplate,
        kind: isSnapshotAction ? "snapshot" : "duplicate",
        generationPlan: snapshotPlan,
      });
      const appliedSnapshotPlan =
        snapshotPlan && template.transformation
          ? {
              ...snapshotPlan,
              transformation: template.transformation,
              summary:
                template.transformation.status === "applied"
                  ? `${snapshotPlan.summary} Mouse Whisperer inserted section ${template.transformation.insertedSectionId} into ${template.filename}.`
                  : snapshotPlan.summary,
            }
          : snapshotPlan;

      return json<VariantCreateActionData>({
        ok: true,
        templateOption: serializeOption(template),
        templateName: template.templateName,
        templateSuffix: template.templateSuffix || "",
        message: isSnapshotAction
          ? "Snapshot-guided variant template created."
          : "Duplicate variant template created.",
        snapshotPlan: appliedSnapshotPlan,
      });
    } catch (error) {
      return json<VariantCreateActionData>(
        {
          ok: false,
          error: themeWriteErrorMessage(error),
        },
        { status: 400 },
      );
    }
  }

  if (actionType === "create-template-test") {
    try {
      await assertCanCreateAbTest(shop);
    } catch (error) {
      if (isPlanLimitError(error)) {
        return json(planLimitPayload(error), { status: error.status });
      }
      throw error;
    }

    const targetPageType = normalizeAbTestPageType(
      formData.get("targetPageType"),
    );
    if (!targetPageType) {
      return json(
        { error: "Choose what template type to test." },
        { status: 400 },
      );
    }

    const controlOption = parseOptionValue(
      String(formData.get("controlOption") || ""),
    );
    let variantOption = parseOptionValue(
      String(formData.get("variantOption") || ""),
    );
    const variantBuildMode = String(formData.get("variantBuildMode") || "");

    const controlTemplateSuffix =
      controlOption?.templateSuffix ||
      String(formData.get("controlTemplateSuffix") || "") ||
      null;
    let variantTemplateSuffix =
      variantOption?.templateSuffix ||
      String(formData.get("variantTemplateSuffix") || "") ||
      null;
    const controlTemplateFileName =
      controlOption?.templateFileName ||
      String(formData.get("controlTemplateFileName") || "") ||
      null;
    let variantTemplateFileName =
      variantOption?.templateFileName ||
      String(formData.get("variantTemplateFileName") || "") ||
      null;
    let variantTemplateName =
      variantOption?.templateName ||
      String(formData.get("variantTemplateName") || "Variant");

    if (variantBuildMode === "duplicate" && !variantOption) {
      const controlTemplate = parsedOptionToThemeTemplate(controlOption);
      if (!controlTemplate) {
        return json(
          { error: "Select an original template before duplicating it." },
          { status: 400 },
        );
      }

      try {
        const duplicateTemplate = await createThemeTemplateVariant({
          admin,
          control: controlTemplate,
          kind: "duplicate",
        });
        variantOption = parseOptionValue(serializeOption(duplicateTemplate));
        variantTemplateName = duplicateTemplate.templateName;
        variantTemplateSuffix = duplicateTemplate.templateSuffix || null;
        variantTemplateFileName = duplicateTemplate.filename || null;
      } catch (error) {
        return json(
          { error: themeWriteErrorMessage(error) },
          { status: 400 },
        );
      }
    }
    const snapshotPlanRaw =
      String(formData.get("snapshotPlan") || "").trim() || null;
    const sourceSnapshotId =
      String(formData.get("sourceSnapshotId") || "").trim() || null;
    const snapshotPlan = snapshotPlanRaw ? JSON.parse(snapshotPlanRaw) : null;

    if (
      isSameTemplateSelection({
        controlOption,
        variantOption,
        targetPageType,
        controlSuffix: controlTemplateSuffix,
        variantSuffix: variantTemplateSuffix,
        controlFilename: controlTemplateFileName,
        variantFilename: variantTemplateFileName,
      })
    ) {
      return json(
        {
          error:
            "Choose a different variant template. A and B cannot use the exact same Shopify template.",
        },
        { status: 400 },
      );
    }

    const test = await createTemplateAbTest({
      shop,
      name: String(formData.get("name") || "Untitled template test"),
      targetPageType,
      goal: normalizeAbTestGoal(formData.get("goal")),
      notes: snapshotPlanRaw ? snapshotPlanRaw.slice(0, 10000) : null,
      sourceSnapshotId,
      sourceSnapshotKind: sourceSnapshotId ? "FOCUSED" : null,
      generationPlan: snapshotPlan,
      themeId: controlOption?.themeId || variantOption?.themeId || null,
      themeName: controlOption?.themeName || variantOption?.themeName || null,
      themeRole: controlOption?.themeRole || variantOption?.themeRole || null,
      trafficSplit: parseInt(String(formData.get("trafficSplit") || "50"), 10),
      controlTemplateName:
        controlOption?.templateName ||
        String(formData.get("controlTemplateName") || "Default"),
      controlTemplateSuffix,
      controlTemplateFileName,
      variantTemplateName:
        variantTemplateName,
      variantTemplateSuffix,
      variantTemplateFileName,
    });

    clearCacheKey(loaderCacheKeys.dashboard(shop));
    return redirect(`/app/ab-tests/${test.id}`);
  }

  const testId = String(formData.get("testId") || "");
  const test = testId
    ? await prisma.abTest.findFirst({ where: { id: testId, shop } })
    : null;
  if (!test) return json({ error: "Test not found" }, { status: 404 });

  if (actionType === "launch-test") {
    await prisma.abTest.updateMany({
      where: {
        shop,
        targetPageType: test.targetPageType,
        status: "LIVE",
        id: { not: test.id },
      },
      data: { status: "PAUSED", pausedAt: new Date() },
    });
    await prisma.abTest.update({
      where: { id: test.id },
      data: { status: "LIVE", launchedAt: new Date(), pausedAt: null },
    });
    clearCacheKey(loaderCacheKeys.dashboard(shop));
    return redirect("/app/ab-tests");
  }

  if (actionType === "pause-test") {
    await prisma.abTest.update({
      where: { id: test.id },
      data: { status: "PAUSED", pausedAt: new Date() },
    });
    clearCacheKey(loaderCacheKeys.dashboard(shop));
    return redirect("/app/ab-tests");
  }

  if (actionType === "end-test") {
    await prisma.abTest.update({
      where: { id: test.id },
      data: { status: "ENDED", endedAt: new Date() },
    });
    clearCacheKey(loaderCacheKeys.dashboard(shop));
    return redirect("/app/ab-tests");
  }

  if (actionType === "delete-test") {
    await prisma.abTest.delete({ where: { id: test.id } });
    clearCacheKey(loaderCacheKeys.dashboard(shop));
    return redirect("/app/ab-tests");
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

export default function AbTestsIndex() {
  const {
    shop,
    tests,
    themeTemplates,
    canWriteThemes,
    rowStatsByVariant,
    completedSnapshots,
    billingAccess,
  } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const variantCreateFetcher = useFetcher<VariantCreateActionData>();
  const reportFetcher = useFetcher<AbTestReportData>();
  const isLoading = navigation.state !== "idle";
  const isCreatingVariant = variantCreateFetcher.state !== "idle";
  const [createOpen, setCreateOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("LIVE");
  const [dashboardSearch, setDashboardSearch] = useState("");
  const [dashboardSort, setDashboardSort] = useState<DashboardSort>("newest");
  const [name, setName] = useState(untitledNameForPageType("PRODUCT"));
  const [targetPageType, setTargetPageType] = useState("PRODUCT");
  const [goal, setGoal] = useState("CONVERSION");
  const [trafficSplit, setTrafficSplit] = useState("50");
  const [controlOption, setControlOption] = useState("");
  const [variantOption, setVariantOption] = useState("");
  const [controlTemplateName, setControlTemplateName] =
    useState("Default product");
  const [controlTemplateSuffix, setControlTemplateSuffix] = useState("");
  const [variantTemplateName, setVariantTemplateName] = useState("");
  const [variantTemplateSuffix, setVariantTemplateSuffix] = useState("");
  const [wizardStep, setWizardStep] = useState<CreateWizardStep>("setup");
  const [variantBuildMode, setVariantBuildMode] =
    useState<VariantBuildMode>(null);
  const [duplicateTemplateState, setDuplicateTemplateState] =
    useState<DuplicateTemplateState>("idle");
  const [snapshotPlan, setSnapshotPlan] = useState<TemplateSnapshotPlan | null>(
    null,
  );
  const [snapshotSearch, setSnapshotSearch] = useState("");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");
  const [detailTestId, setDetailTestId] = useState<string | null>(null);
  const [loadingReportTestId, setLoadingReportTestId] = useState<string | null>(
    null,
  );
  const [reportStatsByTestId, setReportStatsByTestId] = useState<
    Record<string, AbTestReportStatsRow[]>
  >({});
  const variantCreateError =
    variantCreateFetcher.data && !variantCreateFetcher.data.ok
      ? variantCreateFetcher.data.error
      : null;
  const showVariantCreateError = Boolean(
    variantCreateError &&
    (variantBuildMode === "duplicate" || variantBuildMode === "snapshot"),
  );

  const filteredTemplates = useMemo(() => {
    return (themeTemplates.templates || []).filter(
      (template) => template.pageType === targetPageType,
    ) as ThemeTemplateOption[];
  }, [targetPageType, themeTemplates.templates]);

  const searchedTemplates = useMemo(() => {
    return filteredTemplates;
  }, [filteredTemplates]);
  const searchedVariantTemplates = useMemo(() => {
    return filteredTemplates;
  }, [filteredTemplates]);
  const templateCountsByType = useMemo(() => {
    return (themeTemplates.templates || []).reduce<Record<string, number>>(
      (counts, template) => {
        counts[template.pageType] = (counts[template.pageType] || 0) + 1;
        return counts;
      },
      {},
    );
  }, [themeTemplates.templates]);
  const matchingSnapshots = useMemo(() => {
    const query = snapshotSearch.trim().toLowerCase();
    return (completedSnapshots as SnapshotOption[])
      .filter((snapshot) => snapshot.resourceType === targetPageType)
      .filter((snapshot) => {
        if (!query) return true;
        return `${snapshot.name} ${snapshot.resourceTitle} ${snapshot.resourceHandle}`
          .toLowerCase()
          .includes(query);
      });
  }, [completedSnapshots, snapshotSearch, targetPageType]);

  const selectedControl = parseOptionValue(controlOption);
  const selectedVariant = parseOptionValue(variantOption);
  const controlName = getTemplateName(
    controlOption,
    controlTemplateName,
    "Default product",
  );
  const controlSuffix = getTemplateSuffix(controlOption, controlTemplateSuffix);
  const variantName = getTemplateName(variantOption, variantTemplateName, "");
  const variantSuffix = getTemplateSuffix(variantOption, variantTemplateSuffix);
  const hasPendingDuplicate =
    variantBuildMode === "duplicate" && duplicateTemplateState === "pending";
  const rawSameTemplateSelected = isSameTemplateSelection({
    controlOption: selectedControl,
    variantOption: selectedVariant,
    targetPageType,
    controlSuffix,
    variantSuffix,
    controlFilename: selectedControl?.templateFileName,
    variantFilename: selectedVariant?.templateFileName,
  });
  const sameTemplateSelected = hasPendingDuplicate
    ? false
    : rawSameTemplateSelected;
  const canSave =
    Boolean(controlOption || controlTemplateName.trim()) &&
    Boolean(variantOption || variantTemplateName.trim() || hasPendingDuplicate) &&
    !sameTemplateSelected;
  const canContinueToSettings = canSave;
  const dashboardItems = useMemo(() => {
    return (tests as AbTestRow[]).map((test) =>
      getTestDashboardItem({
        test,
        rowStatsByVariant: rowStatsByVariant as Record<
          string,
          AbTestListVariantStats
        >,
        templates: (themeTemplates.templates || []) as ThemeTemplateOption[],
      }),
    );
  }, [rowStatsByVariant, tests, themeTemplates.templates]);
  const activeTests = useMemo(() => {
    const query = dashboardSearch.trim().toLowerCase();
    const filtered = dashboardItems.filter((item) => {
      if (item.test.status !== statusFilter) return false;
      if (!query) return true;
      return item.searchableText.includes(query);
    });
    return [...filtered].sort((left, right) => {
      if (dashboardSort === "visitors") {
        return right.totalVisitors - left.totalVisitors;
      }
      if (dashboardSort === "lift") {
        return (right.lift ?? -Infinity) - (left.lift ?? -Infinity);
      }
      if (dashboardSort === "progress") {
        return right.progressPercent - left.progressPercent;
      }
      return (
        new Date(right.test.launchedAt || right.test.createdAt).getTime() -
        new Date(left.test.launchedAt || left.test.createdAt).getTime()
      );
    });
  }, [dashboardItems, dashboardSearch, dashboardSort, statusFilter]);
  const detailTest = detailTestId
    ? (tests as AbTestRow[]).find((test) => test.id === detailTestId) || null
    : null;
  const detailStats = detailTest
    ? reportStatsByTestId[detailTest.id] || []
    : [];
  const isDetailReportLoading = Boolean(
    detailTest &&
    loadingReportTestId === detailTest.id &&
    !reportStatsByTestId[detailTest.id],
  );
  const trafficA = clampTrafficPercent(Number(trafficSplit || 50));
  const trafficB = 100 - trafficA;
  const controlAssignedCount =
    selectedControl?.assignedCount !== undefined
      ? selectedControl.assignedCount
      : null;
  const targetingNoun = pageTargetNoun(targetPageType, controlAssignedCount);
  const targetingSummary =
    typeof controlAssignedCount === "number"
      ? `Targeting ${controlAssignedCount.toLocaleString()} ${targetingNoun} assigned to your Original (A) template.`
      : `Targeting ${targetingNoun} assigned to your Original (A) template.`;
  const selectedPageTypeLabel =
    PAGE_TYPE_LABELS[targetPageType] || targetPageType;
  const currentThemeName =
    themeTemplates.templates?.[0]?.themeName || "Live theme";
  const variantEditorUrl = buildThemeEditorUrl(
    shop,
    parseOptionValue(variantOption),
  );

  useEffect(() => {
    if (!createOpen || controlOption) return;
    const defaultTemplate =
      filteredTemplates.find((template) => template.isDefault) ||
      filteredTemplates[0];
    if (defaultTemplate) {
      setControlOption(serializeOption(defaultTemplate));
      setControlTemplateName(defaultTemplate.templateName);
      setControlTemplateSuffix(defaultTemplate.templateSuffix || "");
    }
  }, [createOpen, controlOption, filteredTemplates]);

  useEffect(() => {
    if (!loadingReportTestId || reportFetcher.state !== "idle") return;
    if (reportFetcher.data?.testId !== loadingReportTestId) {
      setLoadingReportTestId(null);
      return;
    }
    setReportStatsByTestId((current) => ({
      ...current,
      [loadingReportTestId]: reportFetcher.data.stats,
    }));
    setLoadingReportTestId(null);
  }, [loadingReportTestId, reportFetcher.data, reportFetcher.state]);

  useEffect(() => {
    const data = variantCreateFetcher.data;
    if (!data?.ok) return;
    setVariantOption(data.templateOption);
    setVariantTemplateName(data.templateName);
    setVariantTemplateSuffix(data.templateSuffix);
    setDuplicateTemplateState(
      variantBuildMode === "duplicate" ? "created" : "idle",
    );
    setSnapshotPlan(data.snapshotPlan || null);
    setSelectedSnapshotId(data.snapshotPlan?.snapshotId || selectedSnapshotId);
    setWizardStep("settings");
  }, [selectedSnapshotId, variantBuildMode, variantCreateFetcher.data]);

  function updateTargetPageType(value: string) {
    setTargetPageType(value);
    setControlOption("");
    setControlTemplateName("");
    setControlTemplateSuffix("");
    setVariantOption("");
    setVariantTemplateName("");
    setVariantTemplateSuffix("");
    setVariantBuildMode(null);
    setDuplicateTemplateState("idle");
    setSnapshotPlan(null);
    setSelectedSnapshotId("");
    setSnapshotSearch("");
    setWizardStep("setup");
    setName((current) => {
      if (
        current.startsWith("Untitled ") ||
        current === "Untitled template test"
      ) {
        return untitledNameForPageType(value);
      }
      return current;
    });
  }

  function openTestDetails(testId: string) {
    setDetailTestId(testId);
    if (reportStatsByTestId[testId]) return;
    setLoadingReportTestId(testId);
    reportFetcher.load(`/app/ab-tests/${testId}/report`);
  }

  function selectControlTemplate(template: ThemeTemplateOption) {
    const value = serializeOption(template);
    setControlOption(value);
    setControlTemplateName(template.templateName);
    setControlTemplateSuffix(template.templateSuffix || "");
    if (isSameTemplateOption(parseOptionValue(value), selectedVariant)) {
      setVariantOption("");
      setVariantTemplateName("");
      setVariantTemplateSuffix("");
      setVariantBuildMode(null);
      setDuplicateTemplateState("idle");
      setSnapshotPlan(null);
      setSelectedSnapshotId("");
    }
  }

  function openExistingTemplatePicker() {
    setVariantBuildMode("existing");
    setDuplicateTemplateState("idle");
  }

  function returnToVariantBuildOptions() {
    setVariantBuildMode(null);
    setDuplicateTemplateState("idle");
    setSnapshotPlan(null);
    setSelectedSnapshotId("");
    setSnapshotSearch("");
    setVariantOption("");
    setVariantTemplateName("");
    setVariantTemplateSuffix("");
  }

  function selectVariantTemplate(template: ThemeTemplateOption) {
    const value = serializeOption(template);
    if (isSameTemplateOption(selectedControl, parseOptionValue(value))) return;
    setVariantBuildMode("existing");
    setDuplicateTemplateState("idle");
    setSnapshotPlan(null);
    setSelectedSnapshotId("");
    setVariantOption(value);
    setVariantTemplateName(template.templateName);
    setVariantTemplateSuffix(template.templateSuffix || "");
  }

  function selectDuplicateTemplate() {
    if (!controlOption || !canWriteThemes || isCreatingVariant) return;
    setVariantBuildMode("duplicate");
    setDuplicateTemplateState("pending");
    setVariantOption("");
    setVariantTemplateName(`${controlName} copy`);
    setVariantTemplateSuffix("");
    setSnapshotPlan(null);
    setSelectedSnapshotId("");
    setWizardStep("settings");
  }

  function createVariantFromControl(action: VariantCreateAction) {
    if (!controlOption || isCreatingVariant) return;
    setVariantBuildMode(
      action === "snapshot-template-variant" ? "snapshot" : "duplicate",
    );
    setDuplicateTemplateState(
      action === "duplicate-template-variant" ? "pending" : "idle",
    );
    const formData = new FormData();
    formData.append("action", action);
    formData.append("controlOption", controlOption);
    if (action === "snapshot-template-variant") {
      formData.append("snapshotId", selectedSnapshotId);
    }
    variantCreateFetcher.submit(formData, { method: "POST" });
  }

  function applyManualTemplate(side: "A" | "B") {
    if (side === "A") {
      setControlOption("");
      setControlTemplateName(controlTemplateName.trim() || "Manual template");
      if (!variantOption && variantTemplateName.trim()) return;
      if (
        variantOption &&
        isSameTemplateSelection({
          controlOption: null,
          variantOption: selectedVariant,
          targetPageType,
          controlSuffix: controlTemplateSuffix,
          variantSuffix,
          variantFilename: selectedVariant?.templateFileName,
        })
      ) {
        setVariantOption("");
        setVariantTemplateName("");
        setVariantTemplateSuffix("");
        setSnapshotPlan(null);
        setSelectedSnapshotId("");
      }
    } else {
      setVariantOption("");
      setVariantTemplateName(variantTemplateName.trim() || "Manual variant");
      setVariantBuildMode("existing");
      setDuplicateTemplateState("idle");
      setSnapshotPlan(null);
      setSelectedSnapshotId("");
    }
  }

  function submitCreate() {
    if (!canSave) return;
    const formData = new FormData();
    formData.append("action", "create-template-test");
    formData.append("name", name);
    formData.append("targetPageType", targetPageType);
    formData.append("goal", goal);
    formData.append("trafficSplit", trafficSplit);
    formData.append("controlOption", controlOption);
    formData.append("variantOption", variantOption);
    formData.append("variantBuildMode", variantBuildMode || "");
    formData.append("controlTemplateName", controlTemplateName);
    formData.append("controlTemplateSuffix", controlTemplateSuffix);
    formData.append("variantTemplateName", variantTemplateName);
    formData.append("variantTemplateSuffix", variantTemplateSuffix);
    if (snapshotPlan) {
      formData.append("snapshotPlan", JSON.stringify(snapshotPlan));
      if (snapshotPlan.snapshotId) {
        formData.append("sourceSnapshotId", snapshotPlan.snapshotId);
      }
    }
    submit(formData, { method: "POST" });
    setCreateOpen(false);
  }

  function submitStatus(action: string, testId: string) {
    const formData = new FormData();
    formData.append("action", action);
    formData.append("testId", testId);
    submit(formData, { method: "POST" });
  }

  function updateTrafficA(value: string) {
    setTrafficSplit(String(clampTrafficPercent(Number(value))));
  }

  function updateTrafficB(value: string) {
    setTrafficSplit(String(clampTrafficPercent(100 - Number(value))));
  }

  function openCreateWizard() {
    if (!billingAccess.canCreateAbTest) {
      window.location.href = "/app/upgrade";
      return;
    }
    setWizardStep("setup");
    setSnapshotPlan(null);
    setSelectedSnapshotId("");
    setSnapshotSearch("");
    setDuplicateTemplateState("idle");
    setCreateOpen(true);
  }

  function closeCreateWizard() {
    setCreateOpen(false);
    setWizardStep("setup");
    setSnapshotPlan(null);
    setSelectedSnapshotId("");
    setSnapshotSearch("");
    setDuplicateTemplateState("idle");
  }

  return (
    <Page
      title="A/B tests"
      subtitle="Test Shopify templates against each other and measure the winning storefront experience."
      primaryAction={{
        content: billingAccess.canCreateAbTest ? "Create a test" : "Upgrade to create A/B test",
        ...(billingAccess.canCreateAbTest
          ? { onAction: openCreateWizard }
          : { url: "/app/upgrade" }),
      }}
    >
      <TitleBar title="A/B tests" />
      <BlockStack gap="500">
        {themeTemplates.needsThemeScope ? (
          <Banner
            tone="warning"
            title="Theme template discovery needs theme access"
          >
            <Text as="p">
              The app could not read live theme templates. You can still create
              drafts manually by entering template suffixes. Live template
              discovery requires Shopify theme scope to be deployed and
              approved.
            </Text>
          </Banner>
        ) : null}

        {!billingAccess.canCreateAbTest ? (
          <PremiumGateCard
            title="A/B testing is available on paid plans"
            message="Free stores can run audits and one store snapshot. Upgrade to compare Shopify templates and measure winners."
          />
        ) : null}

        <Card padding="400">
          <BlockStack gap="400">
            <InlineStack align="space-between" gap="400" blockAlign="center">
              <InlineStack gap="150" wrap>
                {STATUS_TABS.map((tab) => {
                  const active = statusFilter === tab.value;
                  const count = dashboardItems.filter(
                    (item) => item.test.status === tab.value,
                  ).length;
                  return (
                    <button
                      key={tab.value}
                      type="button"
                      onClick={() => setStatusFilter(tab.value)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        border: active
                          ? "1px solid #303030"
                          : "1px solid var(--p-color-border-secondary)",
                        borderRadius: 999,
                        background: active ? "#303030" : "#fff",
                        color: active ? "#fff" : "#5f6368",
                        padding: "8px 13px",
                        cursor: "pointer",
                        fontSize: 14,
                        fontWeight: 700,
                      }}
                    >
                      <TinyIcon type={tab.icon} />
                      <span>{tab.label}</span>
                      <span
                        style={{
                          borderRadius: 999,
                          padding: "1px 7px",
                          background: active
                            ? "rgba(255,255,255,0.16)"
                            : "#f1f2f3",
                        }}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </InlineStack>

              <InlineStack gap="200" blockAlign="center" wrap>
                <Button url="/app/upgrade" size="slim">
                  {planUsagePillLabel(billingAccess, "abTests")}
                </Button>
                <div style={{ width: 260 }}>
                  <TextField
                    label="Search tests"
                    labelHidden
                    value={dashboardSearch}
                    onChange={setDashboardSearch}
                    autoComplete="off"
                    prefix="Search"
                  />
                </div>
                <select
                  aria-label="Sort tests"
                  value={dashboardSort}
                  onChange={(event) =>
                    setDashboardSort(event.currentTarget.value as DashboardSort)
                  }
                  style={{
                    minWidth: 140,
                    height: 36,
                    borderRadius: 8,
                    border: "1px solid var(--p-color-border)",
                    padding: "0 10px",
                    background: "#fff",
                    color: "#303030",
                  }}
                >
                  <option value="newest">Newest</option>
                  <option value="visitors">Visitors</option>
                  <option value="lift">Lift</option>
                  <option value="progress">Progress</option>
                </select>
              </InlineStack>
            </InlineStack>

            {activeTests.length > 0 ? (
              <div style={{ display: "grid", gap: 12 }}>
                {activeTests.map((item) => (
                  <DashboardTestCard
                    key={item.test.id}
                    item={item}
                    isLoading={isLoading}
                    onOpenDetails={openTestDetails}
                    onSubmitStatus={submitStatus}
                  />
                ))}
              </div>
            ) : (
              <div style={{ padding: "32px 16px" }}>
                <BlockStack gap="300" inlineAlign="center">
                  <div
                    style={{
                      width: 180,
                      borderRadius: 8,
                      overflow: "hidden",
                      border: "1px dashed var(--p-color-border)",
                    }}
                  >
                    <TemplatePreview muted label="No tests" height={110} />
                  </div>
                  <Text as="h2" variant="headingMd">
                    No {statusFilter.toLowerCase()} A/B tests
                  </Text>
                  <Text as="p" tone="subdued" alignment="center">
                    Create a template test to compare the original page against
                    a different Shopify template.
                  </Text>
                  {billingAccess.canCreateAbTest ? (
                    <Button variant="primary" onClick={openCreateWizard}>
                      Create a test
                    </Button>
                  ) : (
                    <Button variant="primary" url="/app/upgrade">
                      Upgrade to create A/B test
                    </Button>
                  )}
                </BlockStack>
              </div>
            )}
          </BlockStack>
        </Card>
      </BlockStack>

      {detailTest ? (
        <AbTestDetailReport
          open={Boolean(detailTest)}
          onClose={() => setDetailTestId(null)}
          test={detailTest}
          stats={detailStats}
          loading={isDetailReportLoading}
        />
      ) : null}

      <AppBridgeModal
        id="create-ab-test"
        open={createOpen}
        variant="max"
        onHide={closeCreateWizard}
      >
        <TitleBar title="Create New A/B Test" />
        <div
          style={{
            minHeight: "calc(100vh - 72px)",
            background: "var(--p-color-bg)",
            padding: "32px 28px 88px",
          }}
        >
          <div style={{ maxWidth: 1240, margin: "0 auto" }}>
            <BlockStack gap="500">
              <InlineStack align="space-between" blockAlign="start" gap="400">
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="h2" variant="heading2xl">
                      Create New A/B Test
                    </Text>
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    Pick a page type, choose the original template, then set up
                    the variant to test against it.
                  </Text>
                </BlockStack>
                <InlineStack gap="200" blockAlign="center">
                  {wizardStep === "settings" ? (
                    <Button onClick={() => setWizardStep("setup")}>Back</Button>
                  ) : null}
                </InlineStack>
              </InlineStack>

              {wizardStep === "setup" ? (
                <div
                  style={{
                    background: "var(--p-color-bg-surface)",
                    border: "1px solid var(--p-color-border)",
                    borderRadius: 12,
                    boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      padding: "20px 24px",
                      borderBottom: "1px solid var(--p-color-border-secondary)",
                    }}
                  >
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingLg">
                        What do you want to test?
                      </Text>
                      <Text as="p" tone="subdued">
                        A and B always compare templates of the same page type.
                      </Text>
                    </BlockStack>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "210px minmax(340px, 1fr) 56px minmax(360px, 1fr)",
                      minHeight: 560,
                    }}
                  >
                    <PageTypeRail
                      activeType={targetPageType}
                      templateCounts={templateCountsByType}
                      onSelect={updateTargetPageType}
                    />

                    <div style={{ padding: "24px 24px 28px" }}>
                      <div
                        style={{
                          display: "grid",
                          gap: 16,
                          alignContent: "start",
                        }}
                      >
                        <InlineStack
                          align="space-between"
                          blockAlign="center"
                          gap="300"
                        >
                          <VariantBadge label="A · Original" tone="blue" />
                          <Text as="span" tone="subdued">
                            {selectedPageTypeLabel} templates
                          </Text>
                        </InlineStack>
                        <div
                          style={{
                            display: "grid",
                            gap: 12,
                            maxHeight: 360,
                            overflowY: "auto",
                            paddingRight: 2,
                          }}
                        >
                          {searchedTemplates.length > 0 ? (
                            searchedTemplates.map((template) => {
                              const optionValue = serializeOption(template);
                              return (
                                <TemplateListOption
                                  key={`${template.themeId}:${template.filename}`}
                                  template={template}
                                  side="A"
                                  selected={controlOption === optionValue}
                                  onSelect={() =>
                                    selectControlTemplate(template)
                                  }
                                />
                              );
                            })
                          ) : (
                            <div
                              style={{
                                border: "1px dashed var(--p-color-border)",
                                borderRadius: 10,
                                padding: 24,
                                textAlign: "center",
                              }}
                            >
                              <Text as="p" tone="subdued">
                                No {selectedPageTypeLabel.toLowerCase()}{" "}
                                templates found.
                              </Text>
                            </div>
                          )}
                        </div>
                        {themeTemplates.needsThemeScope ? (
                          <ManualTemplateFields
                            side="A"
                            pageType={targetPageType}
                            templateName={controlTemplateName}
                            templateSuffix={controlTemplateSuffix}
                            setTemplateName={setControlTemplateName}
                            setTemplateSuffix={setControlTemplateSuffix}
                            onApply={() => applyManualTemplate("A")}
                          />
                        ) : null}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        placeItems: "center",
                        borderLeft: "1px solid var(--p-color-border-secondary)",
                        borderRight:
                          "1px solid var(--p-color-border-secondary)",
                        background: "#fafafa",
                      }}
                    >
                      <span
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 999,
                          border: "1px solid var(--p-color-border)",
                          background: "#fff",
                          display: "grid",
                          placeItems: "center",
                          fontWeight: 800,
                          fontStyle: "italic",
                          color: "#6d7175",
                        }}
                      >
                        vs
                      </span>
                    </div>

                    <div style={{ padding: "24px 24px 28px" }}>
                      <div
                        style={{
                          display: "grid",
                          gap: 16,
                          alignContent: "start",
                        }}
                      >
                        {variantBuildMode === "existing" ? (
                          <>
                            <InlineStack
                              align="space-between"
                              blockAlign="center"
                              gap="300"
                              wrap
                            >
                              <BlockStack gap="100">
                                <VariantBadge
                                  label="B · Variant"
                                  tone="yellow"
                                />
                                <Text as="span" tone="subdued">
                                  Choose an existing{" "}
                                  {selectedPageTypeLabel.toLowerCase()}{" "}
                                  template.
                                </Text>
                              </BlockStack>
                              <Button onClick={returnToVariantBuildOptions}>
                                Back
                              </Button>
                            </InlineStack>

                            <div
                              style={{
                                display: "grid",
                                gap: 12,
                                maxHeight: 360,
                                overflowY: "auto",
                                paddingRight: 2,
                              }}
                            >
                              {searchedVariantTemplates.length > 0 ? (
                                searchedVariantTemplates.map((template) => {
                                  const optionValue = serializeOption(template);
                                  const isSameAsControl = isSameTemplateOption(
                                    selectedControl,
                                    parseOptionValue(optionValue),
                                  );
                                  return (
                                    <TemplateListOption
                                      key={`${template.themeId}:${template.filename}`}
                                      template={template}
                                      side="B"
                                      selected={variantOption === optionValue}
                                      disabled={isSameAsControl}
                                      disabledReason={
                                        isSameAsControl
                                          ? "Already selected as Original (A)"
                                          : undefined
                                      }
                                      onSelect={() =>
                                        selectVariantTemplate(template)
                                      }
                                    />
                                  );
                                })
                              ) : (
                                <div
                                  style={{
                                    border: "1px dashed var(--p-color-border)",
                                    borderRadius: 10,
                                    padding: 20,
                                    textAlign: "center",
                                  }}
                                >
                                  <Text as="p" tone="subdued">
                                    No matching variant templates found.
                                  </Text>
                                </div>
                              )}
                            </div>
                            {themeTemplates.needsThemeScope ? (
                              <ManualTemplateFields
                                side="B"
                                pageType={targetPageType}
                                templateName={variantTemplateName}
                                templateSuffix={variantTemplateSuffix}
                                setTemplateName={setVariantTemplateName}
                                setTemplateSuffix={setVariantTemplateSuffix}
                                onApply={() => applyManualTemplate("B")}
                              />
                            ) : null}
                          </>
                        ) : variantBuildMode === "snapshot" ? (
                          <>
                            <InlineStack
                              align="space-between"
                              blockAlign="center"
                              gap="300"
                              wrap
                            >
                              <BlockStack gap="100">
                                <VariantBadge
                                  label="B · Variant"
                                  tone="yellow"
                                />
                                <Text as="span" tone="subdued">
                                  Select a completed{" "}
                                  {selectedPageTypeLabel.toLowerCase()} snapshot
                                  to guide the B template.
                                </Text>
                              </BlockStack>
                              <Button onClick={returnToVariantBuildOptions}>
                                Back
                              </Button>
                            </InlineStack>

                            {showVariantCreateError ? (
                              <Banner
                                tone="critical"
                                title="Could not create variant"
                              >
                                <Text as="p">{variantCreateError}</Text>
                              </Banner>
                            ) : null}

                            <TextField
                              label="Search completed snapshots"
                              labelHidden
                              value={snapshotSearch}
                              onChange={setSnapshotSearch}
                              autoComplete="off"
                              prefix="Search"
                            />
                            <div
                              style={{
                                display: "grid",
                                gap: 12,
                                maxHeight: 410,
                                overflowY: "auto",
                                paddingRight: 2,
                              }}
                            >
                              {matchingSnapshots.length > 0 ? (
                                matchingSnapshots.map((snapshot) => (
                                  <SnapshotListOption
                                    key={snapshot.id}
                                    snapshot={snapshot}
                                    selected={
                                      selectedSnapshotId === snapshot.id
                                    }
                                    onSelect={() =>
                                      setSelectedSnapshotId(snapshot.id)
                                    }
                                  />
                                ))
                              ) : (
                                <div
                                  style={{
                                    border: "1px dashed var(--p-color-border)",
                                    borderRadius: 10,
                                    padding: 24,
                                    textAlign: "center",
                                  }}
                                >
                                  <BlockStack gap="150" inlineAlign="center">
                                    <Text as="p" fontWeight="semibold">
                                      No completed snapshots found
                                    </Text>
                                    <Text as="p" tone="subdued">
                                      Complete a{" "}
                                      {selectedPageTypeLabel.toLowerCase()}{" "}
                                      snapshot first, then use it to generate a
                                      focused B template.
                                    </Text>
                                  </BlockStack>
                                </div>
                              )}
                            </div>
                            <InlineStack align="end" gap="200">
                              <Button onClick={returnToVariantBuildOptions}>
                                Cancel
                              </Button>
                              <Button
                                variant="primary"
                                onClick={() =>
                                  createVariantFromControl(
                                    "snapshot-template-variant",
                                  )
                                }
                                loading={isCreatingVariant}
                                disabled={
                                  !controlOption ||
                                  !selectedSnapshotId ||
                                  !canWriteThemes ||
                                  isCreatingVariant
                                }
                              >
                                Create B from snapshot
                              </Button>
                            </InlineStack>
                          </>
                        ) : (
                          <>
                            <InlineStack
                              align="space-between"
                              blockAlign="center"
                              gap="300"
                            >
                              <VariantBadge label="B · Variant" tone="yellow" />
                              <Text as="span" tone="subdued">
                                How to build it
                              </Text>
                            </InlineStack>

                            {showVariantCreateError ? (
                              <Banner
                                tone="critical"
                                title="Could not create variant"
                              >
                                <Text as="p">{variantCreateError}</Text>
                              </Banner>
                            ) : null}

                            <div
                              style={{
                                display: "grid",
                                gap: 12,
                              }}
                            >
                              <VariantChoiceCard
                                icon="select"
                                title="Select an existing template"
                                description={`Test against another ${selectedPageTypeLabel.toLowerCase()} template already in your theme.`}
                                accent="amber"
                                onClick={openExistingTemplatePicker}
                                disabled={isCreatingVariant}
                              />
                              <VariantChoiceCard
                                icon="duplicate"
                                title="Duplicate template"
                                description="Copy the original template into a fresh variant you can edit before launch."
                                selected={variantBuildMode === "duplicate"}
                                accent="amber"
                                onClick={selectDuplicateTemplate}
                                disabled={
                                  !controlOption ||
                                  !canWriteThemes ||
                                  isCreatingVariant
                                }
                                disabledReason={
                                  !controlOption
                                    ? "Choose Original (A) first."
                                    : !canWriteThemes
                                      ? "Requires write_themes access and Shopify theme-file approval."
                                      : undefined
                                }
                              />
                            </div>
                          </>
                        )}

                        {snapshotPlan ? (
                                <div
                                  style={{
                                    marginTop: 10,
                                    border:
                                      "1px solid var(--p-color-border-secondary)",
                                    borderRadius: 10,
                                    padding: 12,
                                    background: "#fffaf0",
                                  }}
                                >
                                  <BlockStack gap="200">
                                    <InlineStack
                                      align="space-between"
                                      blockAlign="center"
                                      gap="200"
                                      wrap
                                    >
                                      <Text as="span" fontWeight="semibold">
                                        {snapshotPlan.title}
                                      </Text>
                                      {snapshotPlan.confidence !== null ? (
                                        <Badge tone="info">
                                          {snapshotPlan.confidence}% confidence
                                        </Badge>
                                      ) : (
                                        <Badge>Snapshot plan</Badge>
                                      )}
                                    </InlineStack>
                                    <Text as="p" tone="subdued">
                                      {snapshotPlan.summary}
                                    </Text>
                                    <Text as="span" tone="subdued">
                                      Source: {snapshotPlan.sourceLabel}
                                    </Text>
                                    {snapshotPlan.transformation ? (
                                      <div
                                        style={{
                                          border:
                                            "1px solid var(--p-color-border-secondary)",
                                          borderRadius: 8,
                                          padding: 10,
                                          background: "#ffffff",
                                        }}
                                      >
                                        <BlockStack gap="100">
                                          <Text as="span" fontWeight="semibold">
                                            Applied change:{" "}
                                            {
                                              snapshotPlan.transformation
                                                .primaryWeakness
                                            }
                                          </Text>
                                          <Text as="span" tone="subdued">
                                            Evidence:{" "}
                                            {
                                              snapshotPlan.transformation
                                                .evidence
                                            }
                                          </Text>
                                          {snapshotPlan.transformation
                                            .insertedSectionId ? (
                                            <Text as="span" tone="subdued">
                                              Inserted section:{" "}
                                              {
                                                snapshotPlan.transformation
                                                  .insertedSectionId
                                              }{" "}
                                              (
                                              {
                                                snapshotPlan.transformation
                                                  .sectionType
                                              }
                                              )
                                            </Text>
                                          ) : null}
                                          {snapshotPlan.transformation.notes
                                            ?.length ? (
                                            <Text as="span" tone="subdued">
                                              {
                                                snapshotPlan.transformation
                                                  .notes[0]
                                              }
                                            </Text>
                                          ) : null}
                                        </BlockStack>
                                      </div>
                                    ) : null}
                                    <div
                                      style={{
                                        display: "grid",
                                        gap: 8,
                                      }}
                                    >
                                      {snapshotPlan.focusAreas.map((area) => (
                                        <div
                                          key={area.label}
                                          style={{
                                            borderTop:
                                              "1px solid var(--p-color-border-secondary)",
                                            paddingTop: 8,
                                          }}
                                        >
                                          <BlockStack gap="050">
                                            <Text
                                              as="span"
                                              fontWeight="semibold"
                                            >
                                              {area.label}
                                            </Text>
                                            <Text as="span" tone="subdued">
                                              {area.detail}
                                            </Text>
                                          </BlockStack>
                                        </div>
                                      ))}
                                    </div>
                                  </BlockStack>
                                </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "16px 24px",
                      borderTop: "1px solid var(--p-color-border-secondary)",
                      background: "#fbfbfb",
                    }}
                  >
                    <Text
                      as="p"
                      tone={sameTemplateSelected ? "critical" : "subdued"}
                    >
                      {!controlOption && !controlTemplateName.trim() ? (
                        <>
                          Select an <strong>A</strong> template to continue.
                        </>
                      ) : !variantOption && !variantTemplateName.trim() && !hasPendingDuplicate ? (
                        <>
                          <strong>A:</strong> {controlName} · choose how to
                          build <strong>B</strong>.
                        </>
                      ) : sameTemplateSelected ? (
                        <>A and B cannot use the exact same Shopify template.</>
                      ) : (
                        <>
                          <strong>A:</strong> {controlName}{" "}
                          <span style={{ fontStyle: "italic" }}>vs</span>{" "}
                          <strong>B:</strong>{" "}
                          {hasPendingDuplicate
                            ? `${controlName} copy`
                            : variantName || "Manual variant"}
                        </>
                      )}
                    </Text>
                    <div style={{ marginLeft: "auto" }} />
                    <Button onClick={closeCreateWizard}>Cancel</Button>
                    <Button
                      variant="primary"
                      onClick={() => setWizardStep("settings")}
                      disabled={!canContinueToSettings}
                    >
                      Next: Traffic & Goal
                    </Button>
                  </div>
                </div>
              ) : (
                <BlockStack gap="500">
                  <InlineStack align="space-between" gap="400" wrap>
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingLg">
                        Traffic & Goal
                      </Text>
                      <Text as="p" tone="subdued">
                        Review the templates, name the test, then choose how to
                        split traffic and judge the result.
                      </Text>
                    </BlockStack>
                    <Button onClick={() => setWizardStep("setup")}>
                      Change setup
                    </Button>
                  </InlineStack>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(420px, 1fr) minmax(360px, 0.88fr)",
                      gap: 20,
                      alignItems: "start",
                    }}
                  >
                    <Card>
                      <BlockStack gap="400">
                        <BlockStack gap="100">
                          <Text as="h3" variant="headingMd">
                            Template previews
                          </Text>
                          <Text as="p" tone="subdued">
                            {selectedPageTypeLabel} test on {currentThemeName}.
                          </Text>
                        </BlockStack>
                        <TemplateSummaryCard
                          side="A"
                          title="Original"
                          templateName={controlName}
                          filename={
                            selectedControl?.templateFileName ||
                            buildManualFilename(targetPageType, controlSuffix)
                          }
                          suffix={controlSuffix}
                          previewImageUrl={selectedControl?.previewImageUrl}
                          previewPageUrl={selectedControl?.previewPageUrl}
                          assignedLabel={selectedControl?.assignedLabel}
                          onSwap={() => setWizardStep("setup")}
                          showAction={false}
                        />
                        <TemplateSummaryCard
                          side="B"
                          title="Variant"
                          templateName={
                            hasPendingDuplicate
                              ? `${controlName} copy`
                              : variantName || "Selected variant"
                          }
                          filename={
                            hasPendingDuplicate
                              ? "Duplicate will be created when you save this draft."
                              : selectedVariant?.templateFileName ||
                                buildManualFilename(targetPageType, variantSuffix)
                          }
                          suffix={hasPendingDuplicate ? null : variantSuffix}
                          previewImageUrl={
                            hasPendingDuplicate
                              ? selectedControl?.previewImageUrl
                              : selectedVariant?.previewImageUrl
                          }
                          previewPageUrl={
                            hasPendingDuplicate
                              ? selectedControl?.previewPageUrl
                              : selectedVariant?.previewPageUrl
                          }
                          assignedLabel={
                            hasPendingDuplicate
                              ? "Pending duplicate"
                              : selectedVariant?.assignedLabel
                          }
                          onSwap={() => setWizardStep("setup")}
                          showAction={false}
                        />
                      </BlockStack>
                    </Card>

                    <BlockStack gap="400">
                      <Card>
                        <BlockStack gap="300">
                          <Text as="h3" variant="headingMd">
                            Test name
                          </Text>
                          <TextField
                            label="Test name"
                            labelHidden
                            value={name}
                            onChange={setName}
                            autoComplete="off"
                          />
                        </BlockStack>
                      </Card>

                      <Card>
                        <BlockStack gap="300">
                          <Text as="h3" variant="headingMd">
                            Page targeting
                          </Text>
                          <Text as="p" tone="subdued">
                            This test runs on pages assigned to Original (A).
                          </Text>
                          <div
                            style={{
                              border: "1px solid var(--p-color-border)",
                              borderRadius: 8,
                              padding: "14px 16px",
                              background:
                                "var(--p-color-bg-surface-secondary)",
                            }}
                          >
                            <Text as="p">
                              {typeof controlAssignedCount === "number" ? (
                                <>
                                  Targeting{" "}
                                  <span
                                    style={{
                                      color: "#008060",
                                      fontWeight: 700,
                                    }}
                                  >
                                    {controlAssignedCount.toLocaleString()}{" "}
                                    {targetingNoun}
                                  </span>{" "}
                                  assigned to your{" "}
                                  <strong>Original (A)</strong> template.
                                </>
                              ) : (
                                <>{targetingSummary}</>
                              )}
                            </Text>
                          </div>
                        </BlockStack>
                      </Card>

                      <Card>
                        <BlockStack gap="400">
                          <BlockStack gap="100">
                            <Text as="h3" variant="headingMd">
                              Traffic split
                            </Text>
                            <Text as="p" tone="subdued">
                              Allocate traffic between Original (A) and Variant
                              (B).
                            </Text>
                          </BlockStack>

                          <div style={{ display: "grid", gap: 18 }}>
                            <InlineStack
                              align="space-between"
                              blockAlign="center"
                            >
                              <InlineStack gap="200" blockAlign="center">
                                <span
                                  style={{
                                    width: 34,
                                    height: 34,
                                    borderRadius: 999,
                                    display: "grid",
                                    placeItems: "center",
                                    background: "#d7ebff",
                                    color: "#1f6feb",
                                    fontWeight: 800,
                                  }}
                                >
                                  A
                                </span>
                                <Text as="span" fontWeight="semibold">
                                  {trafficA}% traffic
                                </Text>
                              </InlineStack>
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="span" fontWeight="semibold">
                                  {trafficB}% traffic
                                </Text>
                                <span
                                  style={{
                                    width: 34,
                                    height: 34,
                                    borderRadius: 999,
                                    display: "grid",
                                    placeItems: "center",
                                    background: "#2563eb",
                                    color: "#fff",
                                    fontWeight: 800,
                                  }}
                                >
                                  B
                                </span>
                              </InlineStack>
                            </InlineStack>

                            <div style={{ position: "relative", height: 34 }}>
                              <div
                                style={{
                                  position: "absolute",
                                  left: 0,
                                  right: 0,
                                  top: 13,
                                  height: 10,
                                  borderRadius: 999,
                                  background: `linear-gradient(to right, #b9dcff 0%, #b9dcff ${trafficA}%, #2563eb ${trafficA}%, #2563eb 100%)`,
                                }}
                              />
                              <span
                                aria-hidden="true"
                                style={{
                                  position: "absolute",
                                  top: 1,
                                  left: `${trafficA}%`,
                                  transform: "translateX(-50%)",
                                  width: 32,
                                  height: 32,
                                  borderRadius: 999,
                                  display: "grid",
                                  placeItems: "center",
                                  background: "#fff",
                                  border: "1px solid var(--p-color-border)",
                                  boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
                                  color: "#8c9196",
                                  fontWeight: 700,
                                }}
                              >
                                ||
                              </span>
                              <input
                                aria-label="A traffic percent"
                                type="range"
                                min={5}
                                max={95}
                                value={trafficA}
                                onChange={(event) =>
                                  updateTrafficA(event.currentTarget.value)
                                }
                                style={{
                                  position: "absolute",
                                  inset: 0,
                                  width: "100%",
                                  opacity: 0,
                                  cursor: "pointer",
                                }}
                              />
                            </div>

                            <InlineStack
                              align="space-between"
                              blockAlign="center"
                              gap="400"
                            >
                              <div style={{ width: 120 }}>
                                <TextField
                                  label="A traffic percentage"
                                  labelHidden
                                  type="number"
                                  min={5}
                                  max={95}
                                  value={String(trafficA)}
                                  onChange={updateTrafficA}
                                  suffix="%"
                                  autoComplete="off"
                                />
                              </div>
                              <div style={{ width: 120 }}>
                                <TextField
                                  label="B traffic percentage"
                                  labelHidden
                                  type="number"
                                  min={5}
                                  max={95}
                                  value={String(trafficB)}
                                  onChange={updateTrafficB}
                                  suffix="%"
                                  autoComplete="off"
                                />
                              </div>
                            </InlineStack>
                          </div>
                        </BlockStack>
                      </Card>

                      <Card>
                        <BlockStack gap="300">
                          <BlockStack gap="100">
                            <Text as="h3" variant="headingMd">
                              Goal
                            </Text>
                            <Text as="p" tone="subdued">
                              Choose the primary metric used to judge the
                              winner.
                            </Text>
                          </BlockStack>
                          <div
                            style={{
                              display: "grid",
                              gap: 10,
                            }}
                          >
                            {GOAL_OPTIONS.map((option) => {
                              const active = goal === option.value;
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => setGoal(option.value)}
                                  style={{
                                    textAlign: "left",
                                    padding: 14,
                                    borderRadius: 8,
                                    border: active
                                      ? "2px solid #111"
                                      : "1px solid var(--p-color-border)",
                                    background: active
                                      ? "#f7f7f7"
                                      : "transparent",
                                    cursor: "pointer",
                                  }}
                                >
                                  <BlockStack gap="050">
                                    <Text as="span" variant="headingMd">
                                      {option.label}
                                    </Text>
                                    <Text as="span" tone="subdued">
                                      {option.description}
                                    </Text>
                                  </BlockStack>
                                </button>
                              );
                            })}
                          </div>
                        </BlockStack>
                      </Card>

                      {variantBuildMode === "duplicate" ? (
                        <Card>
                          <BlockStack gap="300">
                            <Text as="h3" variant="headingMd">
                              Duplicate editing
                            </Text>
                            <Text as="p" tone="subdued">
                              The duplicate template is only created when you
                              save the draft, unless you create it here to edit
                              it first.
                            </Text>
                            {variantEditorUrl ? (
                              <Button url={variantEditorUrl} target="_blank">
                                Edit in Theme Customizer
                              </Button>
                            ) : (
                              <Button
                                onClick={() =>
                                  createVariantFromControl(
                                    "duplicate-template-variant",
                                  )
                                }
                                loading={isCreatingVariant}
                                disabled={!controlOption || isCreatingVariant}
                              >
                                Create duplicate template
                              </Button>
                            )}
                            {showVariantCreateError ? (
                              <Text as="p" tone="critical">
                                {variantCreateError}
                              </Text>
                            ) : null}
                          </BlockStack>
                        </Card>
                      ) : null}
                    </BlockStack>
                  </div>

                  <InlineStack align="end" gap="200">
                    <Button onClick={() => setWizardStep("setup")}>Back</Button>
                    <Button onClick={closeCreateWizard}>Cancel</Button>
                    <Button
                      variant="primary"
                      onClick={submitCreate}
                      loading={isLoading}
                      disabled={!canSave}
                    >
                      Save draft
                    </Button>
                  </InlineStack>
                </BlockStack>
              )}
            </BlockStack>
          </div>
        </div>
      </AppBridgeModal>
    </Page>
  );
}
