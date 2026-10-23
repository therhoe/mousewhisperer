import type {
  AbTestGoal,
  AbTestPageType,
  AbTestStatus,
  Prisma,
  ResourceType,
  VisitorType,
} from "@prisma/client";
import { createHmac, timingSafeEqual } from "node:crypto";
import prisma from "../db.server";
import {
  abTargetPathForResource,
  abTargetPathMatchesType,
  normalizeAbTargetPath,
  type AbReportFilters,
} from "./ab-project-targeting";
import {
  buildClickEngagement,
  buildEngagementOutcomes,
} from "./click-engagement";
import {
  buildCumulativeAbTestTrend,
  buildSourceQualityBreakdown,
  hasTrackedInteraction,
} from "./ab-test-report";

export type ThemeTemplateOption = {
  themeId: string;
  themeName: string;
  themeRole: string;
  pageType: AbTestPageType;
  filename: string;
  templateName: string;
  templateSuffix: string | null;
  isDefault: boolean;
  previewPageUrl: string | null;
  previewImageUrl: string | null;
  previewTitle: string | null;
  assignedCount: number | null;
  assignedLabel: string | null;
};

export type ThemeTemplateDiscoveryResult = {
  ok: boolean;
  needsThemeScope: boolean;
  message: string | null;
  templates: ThemeTemplateOption[];
};

const TEMPLATE_BASE_TO_PAGE_TYPE: Record<string, AbTestPageType | undefined> = {
  product: "PRODUCT",
  collection: "COLLECTION",
  page: "PAGE",
  blog: "BLOG",
  article: "BLOG",
  index: "HOMEPAGE",
  cart: "CART",
};

const PAGE_TYPE_LABELS: Record<AbTestPageType, string> = {
  PRODUCT: "Product",
  COLLECTION: "Collection",
  PAGE: "Page",
  BLOG: "Blog",
  HOMEPAGE: "Homepage",
  CART: "Cart",
};

type ShopifyAdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type PreviewResource = {
  title: string;
  handle: string;
  templateSuffix: string | null;
  blogHandle?: string | null;
};

type PreviewResourceMap = Partial<Record<AbTestPageType, PreviewResource[]>>;

const PREVIEW_SIGNATURE_LENGTH = 48;
const PREVIEW_RESOURCE_PAGE_SIZE = 250;
const PREVIEW_RESOURCE_LIMITS: Partial<Record<AbTestPageType, number>> = {
  PRODUCT: 5000,
  COLLECTION: 2500,
  PAGE: 2500,
  BLOG: 2500,
};

type ThemeTemplateVariantKind = "duplicate" | "recommendation" | "snapshot";

export type SnapshotTemplateIntervention = {
  id: string;
  label: string;
  reason: string;
  sectionTitle: string;
  sectionBody: string;
  priority: number;
};

export type SnapshotTemplateTransformation = {
  primaryWeakness: string;
  evidence: string;
  intervention: SnapshotTemplateIntervention;
  sectionType?: string | null;
  insertedSectionId?: string | null;
  insertionPoint?: string | null;
  changedFiles?: string[];
  status?: "applied" | "not_applicable";
  notes?: string[];
};

export type SnapshotTemplateGenerationPlan = {
  transformation?: SnapshotTemplateTransformation | null;
  [key: string]: unknown;
};

function previewSecret() {
  return (
    process.env.SHOPIFY_API_SECRET ||
    process.env.SESSION_SECRET ||
    "mouse-whisperer-dev-preview-secret"
  );
}

export function signTemplatePreviewUrl(targetUrl: string) {
  return createHmac("sha256", previewSecret())
    .update(targetUrl)
    .digest("hex")
    .slice(0, PREVIEW_SIGNATURE_LENGTH);
}

export function verifyTemplatePreviewSignature(
  targetUrl: string,
  signature: string,
) {
  const expected = signTemplatePreviewUrl(targetUrl);
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ""));
  } catch {
    return false;
  }
}

export function signedTemplatePreviewPath(targetUrl?: string | null) {
  if (!targetUrl) return null;
  const signature = signTemplatePreviewUrl(targetUrl);
  return `/api/template-preview?u=${encodeURIComponent(targetUrl)}&s=${signature}`;
}

export async function createThemeTemplateVariant({
  admin,
  control,
  kind,
  generationPlan,
}: {
  admin: ShopifyAdminClient;
  control: ThemeTemplateOption;
  kind: ThemeTemplateVariantKind;
  generationPlan?: SnapshotTemplateGenerationPlan | null;
}) {
  if (!control.themeId || !control.filename) {
    throw new Error("Select an original template before creating a variant.");
  }

  const sourceContent = await readThemeFileContent(
    admin,
    control.themeId,
    control.filename,
  );
  const templateBase = templateBaseFromFilename(control.filename);
  const extension = templateExtensionFromFilename(control.filename);
  const sourceSuffix = control.templateSuffix || templateBase;
  const targetSuffix = buildGeneratedTemplateSuffix(kind, sourceSuffix);
  const targetFilename = `templates/${templateBase}.${targetSuffix}.${extension}`;
  const transformation =
    kind === "snapshot" && generationPlan?.transformation
      ? generationPlan.transformation
      : null;
  const sectionType =
    transformation && extension === "json"
      ? await findSnapshotSectionType(admin, control.themeId)
      : null;
  const transformed = transformation
    ? transformSnapshotTemplateContent({
        content: sourceContent,
        extension,
        targetFilename,
        targetSuffix,
        pageType: control.pageType,
        transformation: {
          ...transformation,
          sectionType,
        },
      })
    : { content: sourceContent, transformation };

  await upsertThemeFile(
    admin,
    control.themeId,
    targetFilename,
    transformed.content,
  );

  const previewPageUrl = replacePreviewUrlSuffix(
    control.previewPageUrl,
    targetSuffix,
  );
  const templateName =
    kind === "recommendation"
      ? `Recommended ${getAbTestPageTypeLabel(control.pageType).toLowerCase()} variant`
      : kind === "snapshot"
        ? `Snapshot-guided ${getAbTestPageTypeLabel(control.pageType).toLowerCase()} variant`
        : `${control.templateName} copy`;

  return {
    ...control,
    filename: targetFilename,
    templateName,
    templateSuffix: targetSuffix,
    isDefault: false,
    previewPageUrl,
    previewImageUrl: signedTemplatePreviewPath(previewPageUrl),
    assignedCount: 0,
    assignedLabel: "New template",
    transformation: transformed.transformation,
  };
}

async function findSnapshotSectionType(
  admin: ShopifyAdminClient,
  themeId: string,
) {
  const candidates = [
    "sections/custom-liquid.liquid",
    "sections/rich-text.liquid",
    "sections/image-with-text.liquid",
  ];
  const response = await admin.graphql(
    `#graphql
      query MouseWhispererSnapshotSectionFiles($themeId: ID!, $filenames: [String!]!) {
        theme(id: $themeId) {
          files(filenames: $filenames, first: 10) {
            nodes {
              filename
            }
          }
        }
      }
    `,
    { variables: { themeId, filenames: candidates } },
  );
  const payload = await response.json();
  const errors = payload.errors || [];
  if (errors.length) return null;
  const available = new Set(
    (payload?.data?.theme?.files?.nodes || []).map(
      (file: { filename?: string }) => file.filename,
    ),
  );
  if (available.has("sections/custom-liquid.liquid")) return "custom-liquid";
  if (available.has("sections/rich-text.liquid")) return "rich-text";
  if (available.has("sections/image-with-text.liquid"))
    return "image-with-text";
  return null;
}

function transformSnapshotTemplateContent({
  content,
  extension,
  targetFilename,
  targetSuffix,
  pageType,
  transformation,
}: {
  content: string;
  extension: string;
  targetFilename: string;
  targetSuffix: string;
  pageType: AbTestPageType;
  transformation: SnapshotTemplateTransformation;
}) {
  const notes: string[] = [];
  if (extension !== "json") {
    return {
      content,
      transformation: {
        ...transformation,
        status: "not_applicable" as const,
        changedFiles: [targetFilename],
        notes: [
          "The selected template is Liquid, so Snapshot copied the template and attached the snapshot plan without editing theme structure.",
        ],
      },
    };
  }

  if (!transformation.sectionType) {
    return {
      content,
      transformation: {
        ...transformation,
        status: "not_applicable" as const,
        changedFiles: [targetFilename],
        notes: [
          "No compatible theme section file was detected for automatic insertion, so Snapshot copied the template and attached the snapshot plan.",
        ],
      },
    };
  }

  let template: any;
  try {
    template = JSON.parse(stripShopifyJsonTemplateComment(content));
  } catch {
    return {
      content,
      transformation: {
        ...transformation,
        status: "not_applicable" as const,
        changedFiles: [targetFilename],
        notes: [
          "The source JSON template could not be parsed, so Snapshot copied the template and attached the snapshot plan.",
        ],
      },
    };
  }

  if (!template || typeof template !== "object") {
    return {
      content,
      transformation: {
        ...transformation,
        status: "not_applicable" as const,
        changedFiles: [targetFilename],
        notes: ["The source template was not a Shopify JSON template object."],
      },
    };
  }

  template.sections = template.sections || {};
  template.order = Array.isArray(template.order) ? template.order : [];
  const sectionId =
    `mw_snapshot_${targetSuffix.replace(/[^a-z0-9_]/gi, "_")}`.slice(0, 48);
  const sourceOrder = [...template.order];
  const insertionIndex = findSnapshotInsertionIndex(template, pageType);
  template.sections[sectionId] = buildSnapshotSection(
    transformation.sectionType,
    transformation,
  );
  if (!template.order.includes(sectionId)) {
    template.order.splice(insertionIndex, 0, sectionId);
  }
  notes.push(
    `Inserted ${transformation.sectionType} section ${sectionId} at order position ${insertionIndex + 1}.`,
  );

  return {
    content: `${JSON.stringify(template, null, 2)}\n`,
    transformation: {
      ...transformation,
      status: "applied" as const,
      sectionType: transformation.sectionType,
      insertedSectionId: sectionId,
      insertionPoint:
        sourceOrder[insertionIndex - 1] ||
        sourceOrder[insertionIndex] ||
        "template-start",
      changedFiles: [targetFilename],
      notes,
    },
  };
}

function stripShopifyJsonTemplateComment(content: string) {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("/*")) return content;

  const commentEnd = trimmed.indexOf("*/");
  if (commentEnd < 0) return content;

  const afterComment = trimmed.slice(commentEnd + 2).trimStart();
  return afterComment.startsWith("{") ? afterComment : content;
}

function findSnapshotInsertionIndex(template: any, pageType: AbTestPageType) {
  const order = Array.isArray(template.order) ? template.order : [];
  if (!order.length) return 0;
  const mainIndex = order.findIndex((sectionId: string) => {
    const type = String(
      template.sections?.[sectionId]?.type || "",
    ).toLowerCase();
    if (pageType === "PRODUCT") return type.includes("main-product");
    if (pageType === "COLLECTION") return type.includes("main-collection");
    if (pageType === "CART") return type.includes("main-cart");
    if (pageType === "BLOG")
      return type.includes("main-article") || type.includes("main-blog");
    return type.includes("main-page") || type.includes("main");
  });
  return mainIndex >= 0 ? mainIndex + 1 : Math.min(1, order.length);
}

function buildSnapshotSection(
  sectionType: string,
  transformation: SnapshotTemplateTransformation,
) {
  const heading =
    transformation.intervention?.sectionTitle ||
    transformation.primaryWeakness ||
    "Snapshot-guided improvement";
  const body =
    transformation.intervention?.sectionBody ||
    transformation.evidence ||
    "This variant was generated from the selected Snapshot report.";
  const customLiquid = `<div class="mw-snapshot-variant" data-mw-source="snapshot">
  <h2>${escapeHtml(heading)}</h2>
  <p>${escapeHtml(body)}</p>
</div>`;
  if (sectionType === "custom-liquid") {
    return {
      type: "custom-liquid",
      settings: {
        custom_liquid: customLiquid,
      },
    };
  }
  if (sectionType === "image-with-text") {
    return {
      type: "image-with-text",
      blocks: {
        heading: {
          type: "heading",
          settings: { heading, heading_size: "h2" },
        },
        text: {
          type: "text",
          settings: { text: `<p>${escapeHtml(body)}</p>`, text_style: "body" },
        },
      },
      block_order: ["heading", "text"],
      settings: {
        image_position: "left",
        layout: "text_first",
      },
    };
  }
  return {
    type: "rich-text",
    blocks: {
      heading: {
        type: "heading",
        settings: { heading, heading_size: "h2" },
      },
      text: {
        type: "text",
        settings: { text: `<p>${escapeHtml(body)}</p>` },
      },
    },
    block_order: ["heading", "text"],
    settings: {
      full_width: false,
    },
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function readThemeFileContent(
  admin: ShopifyAdminClient,
  themeId: string,
  filename: string,
) {
  const response = await admin.graphql(
    `#graphql
      query MouseWhispererThemeFileContent($themeId: ID!, $filename: String!) {
        theme(id: $themeId) {
          files(filenames: [$filename], first: 1) {
            nodes {
              filename
              body {
                ... on OnlineStoreThemeFileBodyText {
                  content
                }
              }
            }
          }
        }
      }
    `,
    { variables: { themeId, filename } },
  );
  const payload = await response.json();
  const errors = payload.errors || [];
  if (errors.length) {
    throw new Error(errors[0]?.message || "Could not read the theme template.");
  }

  const file = payload?.data?.theme?.files?.nodes?.[0];
  const content = file?.body?.content;
  if (typeof content !== "string") {
    throw new Error("Could not read the selected template file content.");
  }
  return content;
}

async function upsertThemeFile(
  admin: ShopifyAdminClient,
  themeId: string,
  filename: string,
  content: string,
) {
  const response = await admin.graphql(
    `#graphql
      mutation MouseWhispererThemeFilesUpsert(
        $themeId: ID!
        $files: [OnlineStoreThemeFilesUpsertFileInput!]!
      ) {
        themeFilesUpsert(themeId: $themeId, files: $files) {
          upsertedThemeFiles {
            filename
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        themeId,
        files: [
          {
            filename,
            body: {
              type: "TEXT",
              value: content,
            },
          },
        ],
      },
    },
  );
  const payload = await response.json();
  const apiErrors = payload.errors || [];
  if (apiErrors.length) {
    throw new Error(
      apiErrors[0]?.message ||
        "Could not create the copied theme template. The app may need write_themes access and Shopify theme API exemption.",
    );
  }

  const userErrors = payload?.data?.themeFilesUpsert?.userErrors || [];
  if (userErrors.length) {
    throw new Error(
      userErrors[0]?.message || "Could not create the copied theme template.",
    );
  }
}

function templateBaseFromFilename(filename: string) {
  const match = filename.match(
    /^templates\/([a-z-]+)(?:\.[^.]+)?\.(json|liquid)$/,
  );
  if (!match) {
    throw new Error("Only Shopify theme template files can be duplicated.");
  }
  return match[1];
}

function templateExtensionFromFilename(filename: string) {
  const match = filename.match(/\.(json|liquid)$/);
  if (!match) {
    throw new Error("Only JSON and Liquid templates can be duplicated.");
  }
  return match[1];
}

function buildGeneratedTemplateSuffix(
  kind: ThemeTemplateVariantKind,
  sourceSuffix: string,
) {
  const readableSource =
    sourceSuffix
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 34) || "template";
  const marker =
    kind === "recommendation" ? "rec" : kind === "snapshot" ? "snap" : "copy";
  const unique = Date.now().toString(36).slice(-6);
  return `mw-${marker}-${readableSource}-${unique}`.slice(0, 64);
}

function replacePreviewUrlSuffix(
  previewPageUrl: string | null,
  suffix: string,
) {
  if (!previewPageUrl) return null;
  try {
    const url = new URL(previewPageUrl);
    url.searchParams.set("view", suffix);
    return url.toString();
  } catch {
    return null;
  }
}

export function getAbTestPageTypeLabel(pageType: AbTestPageType) {
  return PAGE_TYPE_LABELS[pageType] || pageType;
}

export function normalizeAbTestPageType(value: unknown): AbTestPageType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "PRODUCT" ||
    normalized === "COLLECTION" ||
    normalized === "PAGE" ||
    normalized === "BLOG" ||
    normalized === "HOMEPAGE" ||
    normalized === "CART"
  ) {
    return normalized;
  }
  return null;
}

export function normalizeAbTestGoal(value: unknown): AbTestGoal {
  if (typeof value !== "string") return "CONVERSION";
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "ADD_TO_CART" ||
    normalized === "CONVERSION" ||
    normalized === "REVENUE" ||
    normalized === "CLICK_THROUGH" ||
    normalized === "ENGAGEMENT"
  ) {
    return normalized;
  }
  return "CONVERSION";
}

export function mapResourceTypeToAbPageType(
  resourceType?: ResourceType | string | null,
  pagePath?: string | null,
): AbTestPageType | null {
  if (pagePath === "/" || pagePath === "") return "HOMEPAGE";
  const normalized =
    typeof resourceType === "string" ? resourceType.toUpperCase() : null;
  if (
    normalized === "PRODUCT" ||
    normalized === "COLLECTION" ||
    normalized === "PAGE" ||
    normalized === "BLOG" ||
    normalized === "HOMEPAGE"
  ) {
    return normalized as AbTestPageType;
  }
  if (pagePath?.startsWith("/cart")) return "CART";
  return null;
}

export function parseTemplateFilename(
  themeId: string,
  themeName: string,
  themeRole: string,
  filename: string,
): ThemeTemplateOption | null {
  const match = filename.match(
    /^templates\/([a-z-]+)(?:\.([^.]+))?\.(json|liquid)$/,
  );
  if (!match) return null;

  const [, templateBase, suffix] = match;
  const pageType = TEMPLATE_BASE_TO_PAGE_TYPE[templateBase];
  if (!pageType) return null;

  const isDefault = !suffix;
  const pageLabel = getAbTestPageTypeLabel(pageType);
  return {
    themeId,
    themeName,
    themeRole,
    pageType,
    filename,
    templateName: isDefault ? `Default ${pageLabel.toLowerCase()}` : suffix,
    templateSuffix: suffix || null,
    isDefault,
    previewPageUrl: null,
    previewImageUrl: null,
    previewTitle: null,
    assignedCount: null,
    assignedLabel: null,
  };
}

export async function getThemeTemplateOptions(
  admin: ShopifyAdminClient,
): Promise<ThemeTemplateDiscoveryResult> {
  try {
    const [response, shopInfo] = await Promise.all([
      admin.graphql(`#graphql
      query MouseWhispererThemeTemplates {
        themes(first: 10, roles: [MAIN]) {
          nodes {
            id
            name
            role
            files(first: 250, filenames: ["templates/*.json", "templates/*.liquid"]) {
              nodes {
                filename
              }
            }
          }
        }
      }
    `),
      getShopPreviewInfo(admin),
    ]);
    const payload = await response.json();

    if (payload.errors?.length) {
      return {
        ok: false,
        needsThemeScope: true,
        message:
          payload.errors[0]?.message ||
          "Could not read theme templates. The app may need read_themes scope.",
        templates: [],
      };
    }

    const templates: ThemeTemplateOption[] = [];
    for (const theme of payload.data?.themes?.nodes || []) {
      for (const file of theme.files?.nodes || []) {
        const option = parseTemplateFilename(
          theme.id,
          theme.name,
          theme.role,
          file.filename,
        );
        if (option) templates.push(option);
      }
    }

    const enrichedTemplates = enrichTemplatePreviews(
      templates,
      shopInfo.storefrontBaseUrl,
      shopInfo.resources,
    );

    return {
      ok: true,
      needsThemeScope: false,
      message: null,
      templates: enrichedTemplates.sort((a, b) => {
        if (a.pageType !== b.pageType)
          return a.pageType.localeCompare(b.pageType);
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return a.templateName.localeCompare(b.templateName);
      }),
    };
  } catch (error) {
    return {
      ok: false,
      needsThemeScope: true,
      message:
        error instanceof Error
          ? error.message
          : "Could not read theme templates.",
      templates: [],
    };
  }
}

async function getShopPreviewInfo(admin: ShopifyAdminClient): Promise<{
  storefrontBaseUrl: string | null;
  resources: PreviewResourceMap;
}> {
  const storefrontBaseUrl = await getStorefrontBaseUrl(admin);
  const resources = await getPreviewResources(admin);
  return { storefrontBaseUrl, resources };
}

async function getStorefrontBaseUrl(admin: ShopifyAdminClient) {
  try {
    const response = await admin.graphql(`#graphql
      query MouseWhispererPreviewShop {
        shop {
          myshopifyDomain
          primaryDomain {
            url
          }
        }
      }
    `);
    const payload = await response.json();
    const primaryUrl = payload?.data?.shop?.primaryDomain?.url;
    const myshopifyDomain = payload?.data?.shop?.myshopifyDomain;
    if (primaryUrl) return primaryUrl;
    if (myshopifyDomain) return `https://${myshopifyDomain}`;
    return null;
  } catch {
    return null;
  }
}

async function getPreviewResources(
  admin: ShopifyAdminClient,
): Promise<PreviewResourceMap> {
  const [products, collections, pages, blogs] = await Promise.all([
    queryPreviewResources(admin, "PRODUCT"),
    queryPreviewResources(admin, "COLLECTION"),
    queryPreviewResources(admin, "PAGE"),
    queryPreviewResources(admin, "BLOG"),
  ]);
  return {
    PRODUCT: products,
    COLLECTION: collections,
    PAGE: pages,
    BLOG: blogs,
  };
}

async function queryPreviewResources(
  admin: ShopifyAdminClient,
  pageType: AbTestPageType,
): Promise<PreviewResource[]> {
  try {
    if (pageType === "PRODUCT") {
      return collectPreviewResources(
        admin,
        `#graphql
          query MouseWhispererPreviewProducts($first: Int!, $after: String) {
            products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
              nodes {
                title
                handle
                templateSuffix
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `,
        (payload) => payload?.data?.products,
        (node) => ({
          title: String(node.title || "Product"),
          handle: String(node.handle || ""),
          templateSuffix: normalizeTemplateSuffix(node.templateSuffix),
        }),
        PREVIEW_RESOURCE_LIMITS.PRODUCT || PREVIEW_RESOURCE_PAGE_SIZE,
      );
    }

    if (pageType === "COLLECTION") {
      return collectPreviewResources(
        admin,
        `#graphql
          query MouseWhispererPreviewCollections($first: Int!, $after: String) {
            collections(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
              nodes {
                title
                handle
                templateSuffix
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `,
        (payload) => payload?.data?.collections,
        (node) => ({
          title: String(node.title || "Collection"),
          handle: String(node.handle || ""),
          templateSuffix: normalizeTemplateSuffix(node.templateSuffix),
        }),
        PREVIEW_RESOURCE_LIMITS.COLLECTION || PREVIEW_RESOURCE_PAGE_SIZE,
      );
    }

    if (pageType === "PAGE") {
      return collectPreviewResources(
        admin,
        `#graphql
          query MouseWhispererPreviewPages($first: Int!, $after: String) {
            pages(first: $first, after: $after) {
              nodes {
                title
                handle
                templateSuffix
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `,
        (payload) => payload?.data?.pages,
        (node) => ({
          title: String(node.title || "Page"),
          handle: String(node.handle || ""),
          templateSuffix: normalizeTemplateSuffix(node.templateSuffix),
        }),
        PREVIEW_RESOURCE_LIMITS.PAGE || PREVIEW_RESOURCE_PAGE_SIZE,
      );
    }

    if (pageType === "BLOG") {
      const response = await admin.graphql(`#graphql
        query MouseWhispererPreviewBlogs {
          blogs(first: 25) {
            nodes {
              title
              handle
              articles(first: 25) {
                nodes {
                  title
                  handle
                  templateSuffix
                }
              }
            }
          }
        }
      `);
      const payload = await response.json();
      return (payload?.data?.blogs?.nodes || [])
        .flatMap((blog: any) => {
          return (blog.articles?.nodes || []).map((article: any) => ({
            title: String(article.title || blog.title || "Article"),
            handle: String(article.handle || ""),
            blogHandle: String(blog.handle || ""),
            templateSuffix: normalizeTemplateSuffix(article.templateSuffix),
          }));
        })
        .filter(
          (resource: PreviewResource) => resource.handle && resource.blogHandle,
        );
    }
  } catch {
    return [];
  }

  return [];
}

async function collectPreviewResources(
  admin: ShopifyAdminClient,
  query: string,
  getConnection: (payload: any) => any,
  mapNode: (node: any) => PreviewResource,
  limit: number,
) {
  const resources: PreviewResource[] = [];
  let after: string | null = null;

  while (resources.length < limit) {
    const response = await admin.graphql(query, {
      variables: {
        first: Math.min(PREVIEW_RESOURCE_PAGE_SIZE, limit - resources.length),
        after,
      },
    });
    const payload = await response.json();
    const connection = getConnection(payload);
    const nodes = connection?.nodes || [];
    resources.push(
      ...nodes
        .map(mapNode)
        .filter((resource: PreviewResource) => resource.handle),
    );

    if (!connection?.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) {
      break;
    }
    after = connection.pageInfo.endCursor;
  }

  return resources;
}

function enrichTemplatePreviews(
  templates: ThemeTemplateOption[],
  storefrontBaseUrl: string | null,
  resources: PreviewResourceMap,
) {
  return templates.map((template) => {
    const previewPageUrl = buildTemplatePreviewPageUrl(
      storefrontBaseUrl,
      template,
      resources[template.pageType] || [],
    );
    const assignedCount = countAssignedResources(
      resources[template.pageType] || [],
      template.templateSuffix,
    );
    return {
      ...template,
      previewPageUrl,
      previewImageUrl: signedTemplatePreviewPath(previewPageUrl),
      previewTitle:
        findRepresentativeResource(
          resources[template.pageType] || [],
          template.templateSuffix,
        )?.title || null,
      assignedCount,
      assignedLabel: formatAssignedLabel(template.pageType, assignedCount),
    };
  });
}

function buildTemplatePreviewPageUrl(
  storefrontBaseUrl: string | null,
  template: ThemeTemplateOption,
  resources: PreviewResource[],
) {
  if (!storefrontBaseUrl) return null;
  const resource = findRepresentativeResource(
    resources,
    template.templateSuffix,
  );
  const suffix = template.templateSuffix;

  if (template.pageType === "HOMEPAGE") {
    return buildStorefrontUrl(storefrontBaseUrl, "/", suffix);
  }

  if (template.pageType === "CART") {
    return buildStorefrontUrl(storefrontBaseUrl, "/cart", suffix);
  }

  if (!resource) return null;

  if (template.pageType === "PRODUCT") {
    return buildStorefrontUrl(
      storefrontBaseUrl,
      `/products/${resource.handle}`,
      suffix,
    );
  }

  if (template.pageType === "COLLECTION") {
    return buildStorefrontUrl(
      storefrontBaseUrl,
      `/collections/${resource.handle}`,
      suffix,
    );
  }

  if (template.pageType === "PAGE") {
    return buildStorefrontUrl(
      storefrontBaseUrl,
      `/pages/${resource.handle}`,
      suffix,
    );
  }

  if (template.pageType === "BLOG" && resource.blogHandle) {
    return buildStorefrontUrl(
      storefrontBaseUrl,
      `/blogs/${resource.blogHandle}/${resource.handle}`,
      suffix,
    );
  }

  return null;
}

function buildStorefrontUrl(
  baseUrl: string,
  pathname: string,
  suffix?: string | null,
) {
  const url = new URL(pathname, baseUrl);
  if (suffix) url.searchParams.set("view", suffix);
  return url.toString();
}

function normalizeTemplateSuffix(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function findRepresentativeResource(
  resources: PreviewResource[],
  suffix?: string | null,
) {
  const normalizedSuffix = normalizeTemplateSuffix(suffix);
  return (
    resources.find(
      (resource) =>
        normalizeTemplateSuffix(resource.templateSuffix) === normalizedSuffix,
    ) ||
    resources[0] ||
    null
  );
}

function countAssignedResources(
  resources: PreviewResource[],
  suffix?: string | null,
) {
  if (!resources.length) return null;
  const normalizedSuffix = normalizeTemplateSuffix(suffix);
  return resources.filter(
    (resource) =>
      normalizeTemplateSuffix(resource.templateSuffix) === normalizedSuffix,
  ).length;
}

function formatAssignedLabel(pageType: AbTestPageType, count: number | null) {
  if (count === null) return null;
  const nounByType: Record<AbTestPageType, string> = {
    PRODUCT: count === 1 ? "product" : "products",
    COLLECTION: count === 1 ? "collection" : "collections",
    PAGE: count === 1 ? "page" : "pages",
    BLOG: count === 1 ? "article" : "articles",
    HOMEPAGE: "homepage",
    CART: "cart",
  };
  if (pageType === "HOMEPAGE" || pageType === "CART") return "Default template";
  return `Assigned to ${count.toLocaleString()} ${nounByType[pageType]}`;
}

export async function requireAbGrowthProject(
  shop: string,
  projectId: string,
  pageType?: string,
) {
  const project = projectId
    ? await prisma.growthProject.findFirst({
        where: { id: projectId, shop },
        include: { resourceProject: true },
      })
    : null;
  if (!project)
    throw new Error("Choose a project before creating an A/B test.");
  if (
    project.scope === "PAGE" &&
    (!project.resourceProject || project.resourceProject.shop !== shop)
  ) {
    throw new Error(
      "This page project has no valid page. Choose a different project.",
    );
  }
  if (
    pageType &&
    project.scope === "PAGE" &&
    project.resourceProject?.resourceType !== pageType
  ) {
    throw new Error("The test page type must match the project's page.");
  }
  return project;
}

export async function createTemplateAbTest({
  shop,
  growthProjectId,
  targetPagePath,
  name,
  targetPageType,
  goal,
  notes,
  themeId,
  themeName,
  themeRole,
  controlTemplateName,
  controlTemplateSuffix,
  controlTemplateFileName,
  variantTemplateName,
  variantTemplateSuffix,
  variantTemplateFileName,
  trafficSplit,
  sourceSnapshotId,
  sourceSnapshotKind,
  generationPlan,
}: {
  shop: string;
  growthProjectId: string;
  targetPagePath: string;
  name: string;
  targetPageType: AbTestPageType;
  goal: AbTestGoal;
  notes?: string | null;
  themeId?: string | null;
  themeName?: string | null;
  themeRole?: string | null;
  controlTemplateName: string;
  controlTemplateSuffix?: string | null;
  controlTemplateFileName?: string | null;
  variantTemplateName: string;
  variantTemplateSuffix?: string | null;
  variantTemplateFileName?: string | null;
  trafficSplit: number;
  sourceSnapshotId?: string | null;
  sourceSnapshotKind?: string | null;
  generationPlan?: unknown;
}) {
  const project = await requireAbGrowthProject(
    shop,
    growthProjectId,
    targetPageType,
  );
  const path = normalizeAbTargetPath(targetPagePath);
  const projectPath = project.resourceProject
    ? abTargetPathForResource(project.resourceProject)
    : null;
  if (
    !abTargetPathMatchesType(path, targetPageType) ||
    (project.scope === "PAGE" && path !== projectPath)
  ) {
    throw new Error(
      "Choose the exact storefront page for this project and test.",
    );
  }
  const split = Math.min(95, Math.max(5, Math.round(trafficSplit || 50)));
  return prisma.abTest.create({
    data: {
      shop,
      growthProjectId: project.id,
      targetPagePath: path,
      name: name.trim() || "Untitled template test",
      targetPageType,
      goal,
      notes: notes || null,
      themeId: themeId || null,
      themeName: themeName || null,
      themeRole: themeRole || null,
      trafficSplit: split,
      sourceSnapshotId: sourceSnapshotId || null,
      sourceSnapshotKind: sourceSnapshotKind || null,
      generationPlan: generationPlan
        ? (JSON.parse(JSON.stringify(generationPlan)) as any)
        : undefined,
      variants: {
        create: [
          {
            key: "A",
            name: "Control",
            templateName: controlTemplateName || "Default",
            templateSuffix: controlTemplateSuffix || null,
            templateFileName: controlTemplateFileName || null,
            generationMode: "ORIGINAL",
            isControl: true,
            trafficPercent: split,
            sortOrder: 0,
          },
          {
            key: "B",
            name: "Variant",
            templateName: variantTemplateName || "Variant",
            templateSuffix: variantTemplateSuffix || null,
            templateFileName: variantTemplateFileName || null,
            generationMode: sourceSnapshotId ? "SNAPSHOT" : "EXISTING",
            sourceSnapshotId: sourceSnapshotId || null,
            sourceSnapshotKind: sourceSnapshotKind || null,
            generationPlan: generationPlan
              ? (JSON.parse(JSON.stringify(generationPlan)) as any)
              : undefined,
            isControl: false,
            trafficPercent: 100 - split,
            sortOrder: 1,
          },
        ],
      },
    },
  });
}

function hashToPercent(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 100;
}

export async function assignTemplateAbVariant({
  shop,
  sessionId,
  pagePath,
  pageUrl,
  pageTitle,
  resourceType,
  resourceHandle,
  templateSuffix,
  urlAbTestId,
  urlAbVariantKey,
}: {
  shop: string;
  sessionId: string;
  pagePath?: string | null;
  pageUrl?: string | null;
  pageTitle?: string | null;
  resourceType?: ResourceType | string | null;
  resourceHandle?: string | null;
  templateSuffix?: string | null;
  urlAbTestId?: string | null;
  urlAbVariantKey?: string | null;
}) {
  const pageType = mapResourceTypeToAbPageType(resourceType, pagePath);
  if (!shop || !sessionId || !pageType) {
    return { assigned: false as const, reason: "not_applicable" };
  }

  const test = await prisma.abTest.findFirst({
    where: {
      shop,
      status: "LIVE",
      testType: "TEMPLATE",
      targetPageType: pageType,
      OR: [
        { targetPagePath: null },
        {
          targetPagePath:
            normalizeAbTargetPath(pagePath || pageUrl) || "__unmatched_page__",
        },
      ],
    },
    orderBy: [{ launchedAt: "desc" }, { createdAt: "desc" }],
    include: { variants: { orderBy: { sortOrder: "asc" } } },
  });

  if (!test || test.variants.length < 2) {
    return { assigned: false as const, reason: "no_live_test" };
  }

  if (
    test.targetPagePath &&
    normalizeAbTargetPath(pagePath || pageUrl) !== test.targetPagePath
  ) {
    return { assigned: false as const, reason: "page_mismatch" };
  }

  const controlVariant =
    test.variants.find((variant) => variant.isControl) || test.variants[0];
  const currentTemplateSuffix = normalizeTemplateSuffix(templateSuffix);
  const controlTemplateSuffix = normalizeTemplateSuffix(
    controlVariant.templateSuffix,
  );
  const currentPageMatchesControlTemplate =
    currentTemplateSuffix === controlTemplateSuffix;

  const existing = await prisma.abTestAssignment.findUnique({
    where: {
      testId_sessionId: {
        testId: test.id,
        sessionId,
      },
    },
    include: { variant: true, test: true },
  });

  if (existing) {
    const urlBelongsToExistingVariant =
      urlAbTestId === test.id &&
      urlAbVariantKey === existing.variant.key &&
      currentTemplateSuffix ===
        normalizeTemplateSuffix(existing.variant.templateSuffix);

    if (!currentPageMatchesControlTemplate && !urlBelongsToExistingVariant) {
      return { assigned: false as const, reason: "template_mismatch" };
    }

    await prisma.abTestAssignment.update({
      where: { id: existing.id },
      data: {
        pagePath: pagePath || existing.pagePath,
        pageUrl: pageUrl || existing.pageUrl,
        pageTitle: pageTitle || existing.pageTitle,
        resourceType: normalizeResourceTypeForAb(resourceType),
        resourceHandle: resourceHandle || existing.resourceHandle,
      },
    });
    return {
      assigned: true as const,
      test,
      variant: existing.variant,
      assignmentId: existing.id,
    };
  }

  if (!currentPageMatchesControlTemplate) {
    return { assigned: false as const, reason: "template_mismatch" };
  }

  const bucket = hashToPercent(`${test.id}:${sessionId}`);
  const selectedKey = bucket < test.trafficSplit ? "A" : "B";
  const selectedVariant =
    test.variants.find((variant) => variant.key === selectedKey) ||
    test.variants[0];

  const assignment = await prisma.abTestAssignment.create({
    data: {
      testId: test.id,
      variantId: selectedVariant.id,
      shop,
      sessionId,
      pagePath: pagePath || null,
      pageUrl: pageUrl || null,
      pageTitle: pageTitle || null,
      resourceType: normalizeResourceTypeForAb(resourceType),
      resourceHandle: resourceHandle || null,
    },
  });

  return {
    assigned: true as const,
    test,
    variant: selectedVariant,
    assignmentId: assignment.id,
  };
}

export function normalizeResourceTypeForAb(
  resourceType?: ResourceType | string | null,
): ResourceType | null {
  if (typeof resourceType !== "string") return resourceType || null;
  const normalized = resourceType.toUpperCase();
  if (
    normalized === "PRODUCT" ||
    normalized === "COLLECTION" ||
    normalized === "PAGE" ||
    normalized === "BLOG" ||
    normalized === "HOMEPAGE"
  ) {
    return normalized as ResourceType;
  }
  return null;
}

export async function recordAbTestEngagement({
  shop,
  sessionId,
  testId,
  variantId,
  pageViewId,
  pagePath,
  pageUrl,
  pageTitle,
  resourceType,
  resourceHandle,
  isLandingPage,
  pageOrder,
  visitorType,
  source,
  medium,
  campaign,
  referrer,
  sourceCategory,
  timeOnPage,
  scrollDepth,
  mouseMovements,
  keyPresses,
  touchEvents,
  hasMouseMoved,
  hasScrolled,
  hasKeyPressed,
  hasTouched,
  isWebdriver,
  suspiciousUA,
  linearMovement,
  datacenterIP,
  botScore,
  addedToCart,
  addedToCartAt,
  userAgent,
  deviceType,
  exitType,
  exitUrl,
  searchQuery,
  appliedFilters,
  sortBy,
  filterInteractions,
  ctaClicks,
  startedAt,
  endedAt,
  ipAddress,
  country,
  countryCode,
  city,
  region,
  timezone,
}: {
  shop: string;
  sessionId: string;
  testId?: string | null;
  variantId?: string | null;
  pageViewId?: string | null;
  pagePath?: string | null;
  pageUrl?: string | null;
  pageTitle?: string | null;
  resourceType?: ResourceType | string | null;
  resourceHandle?: string | null;
  isLandingPage?: boolean | null;
  pageOrder?: number | null;
  visitorType: VisitorType;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  referrer?: string | null;
  sourceCategory?: string | null;
  timeOnPage?: number | null;
  scrollDepth?: number | null;
  mouseMovements?: number | null;
  keyPresses?: number | null;
  touchEvents?: number | null;
  hasMouseMoved?: boolean | null;
  hasScrolled?: boolean | null;
  hasKeyPressed?: boolean | null;
  hasTouched?: boolean | null;
  isWebdriver?: boolean | null;
  suspiciousUA?: boolean | null;
  linearMovement?: boolean | null;
  datacenterIP?: boolean | null;
  botScore?: number | null;
  addedToCart?: boolean | null;
  addedToCartAt?: number | string | Date | null;
  userAgent?: string | null;
  deviceType?: string | null;
  exitType?: string | null;
  exitUrl?: string | null;
  searchQuery?: string | null;
  appliedFilters?: string | null;
  sortBy?: string | null;
  filterInteractions?: number | null;
  ctaClicks?: string | null;
  startedAt?: number | string | Date | null;
  endedAt?: number | string | Date | null;
  ipAddress?: string | null;
  country?: string | null;
  countryCode?: string | null;
  city?: string | null;
  region?: string | null;
  timezone?: string | null;
}) {
  if (!shop || !sessionId || !testId) return false;

  const existing = await prisma.abTestAssignment.findUnique({
    where: { testId_sessionId: { testId, sessionId } },
  });
  if (!existing) return false;
  if (existing.shop !== shop) return false;
  if (variantId && existing.variantId !== variantId) return false;
  const hasRecordedSource = Boolean(
    existing.source ||
    existing.sourceCategory ||
    existing.medium ||
    existing.campaign ||
    existing.referrer,
  );

  await prisma.abTestAssignment.update({
    where: { id: existing.id },
    data: {
      pageViewId: pageViewId || existing.pageViewId,
      pagePath: pagePath || existing.pagePath,
      pageUrl: pageUrl || existing.pageUrl,
      pageTitle: pageTitle || existing.pageTitle,
      resourceType: normalizeResourceTypeForAb(resourceType),
      resourceHandle: resourceHandle || existing.resourceHandle,
      visitorType,
      // Keep one arrival's attribution together; an internal page must not
      // rewrite the acquisition cohort selected in the Project's reports.
      source: hasRecordedSource ? existing.source : source || null,
      medium: hasRecordedSource ? existing.medium : medium || null,
      campaign: hasRecordedSource ? existing.campaign : campaign || null,
      referrer: hasRecordedSource ? existing.referrer : referrer || null,
      sourceCategory: hasRecordedSource
        ? existing.sourceCategory
        : sourceCategory || null,
      timeOnPage: Math.max(existing.timeOnPage || 0, timeOnPage || 0),
      scrollDepth: Math.max(existing.scrollDepth || 0, scrollDepth || 0),
      ...(addedToCart
        ? {
            addedToCart: true,
            addedToCartAt: addedToCartAt ? new Date(addedToCartAt) : new Date(),
          }
        : {}),
      ...(ctaClicks ? { ctaClicks: String(ctaClicks).slice(0, 10000) } : {}),
      startedAt: startedAt ? new Date(startedAt) : existing.startedAt,
      endedAt: endedAt ? new Date(endedAt) : existing.endedAt,
    },
  });

  if (pageViewId) {
    const normalizedResourceType = normalizeResourceTypeForAb(resourceType);
    const safePagePath = pagePath || pageUrl || "/";
    const visitStartedAt = startedAt ? new Date(startedAt) : new Date();
    const visitEndedAt = endedAt ? new Date(endedAt) : null;

    await prisma.abTestVisit.upsert({
      where: {
        testId_pageViewId: {
          testId,
          pageViewId,
        },
      },
      create: {
        testId,
        variantId: existing.variantId,
        assignmentId: existing.id,
        shop,
        sessionId,
        pageViewId,
        pagePath: safePagePath,
        pageUrl: pageUrl || safePagePath,
        pageTitle: pageTitle || null,
        resourceType: normalizedResourceType,
        resourceHandle: resourceHandle || null,
        isLandingPage: Boolean(isLandingPage || pageOrder === 1),
        pageOrder: pageOrder ?? null,
        visitorType,
        source: source || null,
        medium: medium || null,
        campaign: campaign || null,
        referrer: referrer || null,
        sourceCategory: sourceCategory || null,
        timeOnPage: timeOnPage || 0,
        scrollDepth: scrollDepth || 0,
        mouseMovements: mouseMovements || 0,
        keyPresses: keyPresses || 0,
        touchEvents: touchEvents || 0,
        hasMouseMoved: Boolean(hasMouseMoved),
        hasScrolled: Boolean(hasScrolled),
        hasKeyPressed: Boolean(hasKeyPressed),
        hasTouched: Boolean(hasTouched),
        isWebdriver: Boolean(isWebdriver),
        suspiciousUA: Boolean(suspiciousUA),
        linearMovement: Boolean(linearMovement),
        datacenterIP: Boolean(datacenterIP),
        botScore: botScore || 0,
        addedToCart: Boolean(addedToCart),
        addedToCartAt: addedToCartAt ? new Date(addedToCartAt) : null,
        userAgent: userAgent || null,
        deviceType: deviceType || null,
        startedAt: visitStartedAt,
        endedAt: visitEndedAt,
        exitType: exitType || null,
        exitUrl: exitUrl || null,
        searchQuery: searchQuery || null,
        appliedFilters: appliedFilters || null,
        sortBy: sortBy || null,
        filterInteractions: filterInteractions || 0,
        ctaClicks: ctaClicks || null,
        ipAddress: ipAddress || null,
        country: country || null,
        countryCode: countryCode || null,
        city: city || null,
        region: region || null,
        timezone: timezone || null,
      },
      update: {
        pagePath: safePagePath,
        pageUrl: pageUrl || safePagePath,
        pageTitle: pageTitle || undefined,
        resourceType: normalizedResourceType,
        resourceHandle: resourceHandle || undefined,
        ...(isLandingPage || pageOrder === 1 ? { isLandingPage: true } : {}),
        pageOrder: pageOrder ?? undefined,
        visitorType,
        source: source || undefined,
        medium: medium || undefined,
        campaign: campaign || undefined,
        referrer: referrer || undefined,
        sourceCategory: sourceCategory || undefined,
        timeOnPage: timeOnPage || 0,
        scrollDepth: scrollDepth || 0,
        mouseMovements: mouseMovements || 0,
        keyPresses: keyPresses || 0,
        touchEvents: touchEvents || 0,
        hasMouseMoved: Boolean(hasMouseMoved),
        hasScrolled: Boolean(hasScrolled),
        hasKeyPressed: Boolean(hasKeyPressed),
        hasTouched: Boolean(hasTouched),
        isWebdriver: Boolean(isWebdriver),
        suspiciousUA: Boolean(suspiciousUA),
        linearMovement: Boolean(linearMovement),
        datacenterIP: Boolean(datacenterIP),
        botScore: botScore || 0,
        ...(addedToCart
          ? {
              addedToCart: true,
              addedToCartAt: addedToCartAt
                ? new Date(addedToCartAt)
                : undefined,
            }
          : {}),
        userAgent: userAgent || undefined,
        deviceType: deviceType || undefined,
        endedAt: visitEndedAt,
        exitType: exitType || null,
        exitUrl: exitUrl || null,
        searchQuery: searchQuery || undefined,
        appliedFilters: appliedFilters || undefined,
        sortBy: sortBy || undefined,
        filterInteractions: filterInteractions || 0,
        ctaClicks: ctaClicks || undefined,
        ipAddress: ipAddress || undefined,
        country: country || undefined,
        countryCode: countryCode || undefined,
        city: city || undefined,
        region: region || undefined,
        timezone: timezone || undefined,
      },
    });
  }

  return true;
}

export async function attributeAbTestAddToCart({
  sessionId,
  productHandle,
  timestamp,
}: {
  sessionId: string;
  productHandle?: string | null;
  timestamp?: number | string | Date | null;
}) {
  if (!sessionId) return 0;
  const decodedHandle = productHandle
    ? decodeURIComponent(productHandle)
    : null;
  const eventDate = timestamp ? new Date(timestamp) : new Date();

  const result = await prisma.abTestAssignment.updateMany({
    where: {
      sessionId,
      test: { status: "LIVE" },
      addedToCart: false,
    },
    data: {
      addedToCart: true,
      addedToCartAt: eventDate,
    },
  });

  const visits = await prisma.abTestVisit.findMany({
    where: {
      sessionId,
      addedToCart: false,
      test: { status: "LIVE" },
      ...(decodedHandle
        ? { resourceType: "PRODUCT", resourceHandle: decodedHandle }
        : {}),
    },
    orderBy: [{ testId: "asc" }, { startedAt: "desc" }],
  });

  const updatedTestIds = new Set<string>();
  let visitUpdates = 0;
  for (const visit of visits) {
    if (updatedTestIds.has(visit.testId)) continue;
    await prisma.abTestVisit.update({
      where: { id: visit.id },
      data: {
        addedToCart: true,
        addedToCartAt: eventDate,
      },
    });
    updatedTestIds.add(visit.testId);
    visitUpdates += 1;
  }

  return result.count + visitUpdates;
}

export async function attributeAbTestCheckoutStarted({
  shop,
  sessionId,
  timestamp,
}: {
  shop?: string | null;
  sessionId: string;
  timestamp?: number | string | Date | null;
}) {
  if (!sessionId) return 0;
  const eventDate = timestamp ? new Date(timestamp) : new Date();

  const result = await prisma.abTestAssignment.updateMany({
    where: {
      ...(shop ? { shop } : {}),
      sessionId,
      test: { status: { in: ["LIVE", "PAUSED", "ENDED"] as AbTestStatus[] } },
      checkoutStarted: false,
    },
    data: {
      checkoutStarted: true,
      checkoutStartedAt: eventDate,
    },
  });

  const thirtyDaysBeforeEvent = new Date(eventDate);
  thirtyDaysBeforeEvent.setDate(thirtyDaysBeforeEvent.getDate() - 30);

  const visits = await prisma.abTestVisit.findMany({
    where: {
      ...(shop ? { shop } : {}),
      sessionId,
      checkoutStarted: false,
      startedAt: { gte: thirtyDaysBeforeEvent, lte: eventDate },
      test: { status: { in: ["LIVE", "PAUSED", "ENDED"] as AbTestStatus[] } },
    },
    orderBy: [
      { testId: "asc" },
      { isLandingPage: "desc" },
      { pageOrder: "asc" },
      { startedAt: "asc" },
    ],
  });

  const updatedTestIds = new Set<string>();
  let visitUpdates = 0;
  for (const visit of visits) {
    if (updatedTestIds.has(visit.testId)) continue;
    await prisma.abTestVisit.update({
      where: { id: visit.id },
      data: {
        checkoutStarted: true,
        checkoutStartedAt: eventDate,
      },
    });
    updatedTestIds.add(visit.testId);
    visitUpdates += 1;
  }

  return result.count + visitUpdates;
}

export async function attributeAbTestConversion({
  shop,
  sessionId,
  timestamp,
  totalPrice,
  currency,
}: {
  shop?: string | null;
  sessionId: string;
  timestamp?: number | string | Date | null;
  totalPrice?: number | string | null;
  currency?: string | null;
}) {
  if (!sessionId) return 0;
  const orderDate = timestamp ? new Date(timestamp) : new Date();

  const result = await prisma.abTestAssignment.updateMany({
    where: {
      ...(shop ? { shop } : {}),
      sessionId,
      test: { status: { in: ["LIVE", "PAUSED", "ENDED"] as AbTestStatus[] } },
      converted: false,
    },
    data: {
      converted: true,
      convertedAt: orderDate,
      ...(totalPrice != null && totalPrice !== ""
        ? {
            orderValue:
              typeof totalPrice === "number"
                ? totalPrice
                : parseFloat(totalPrice),
          }
        : {}),
      ...(currency ? { currency } : {}),
    },
  });

  const thirtyDaysBeforeOrder = new Date(orderDate);
  thirtyDaysBeforeOrder.setDate(thirtyDaysBeforeOrder.getDate() - 30);

  const visits = await prisma.abTestVisit.findMany({
    where: {
      ...(shop ? { shop } : {}),
      sessionId,
      converted: false,
      startedAt: { gte: thirtyDaysBeforeOrder, lte: orderDate },
      test: { status: { in: ["LIVE", "PAUSED", "ENDED"] as AbTestStatus[] } },
    },
    orderBy: [
      { testId: "asc" },
      { isLandingPage: "desc" },
      { pageOrder: "asc" },
      { startedAt: "asc" },
    ],
  });

  const updatedTestIds = new Set<string>();
  let visitUpdates = 0;
  for (const visit of visits) {
    if (updatedTestIds.has(visit.testId)) continue;
    await prisma.abTestVisit.update({
      where: { id: visit.id },
      data: {
        converted: true,
        convertedAt: orderDate,
        ...(totalPrice != null && totalPrice !== ""
          ? {
              orderValue:
                typeof totalPrice === "number"
                  ? totalPrice
                  : parseFloat(totalPrice),
            }
          : {}),
        ...(currency ? { currency } : {}),
      },
    });
    updatedTestIds.add(visit.testId);
    visitUpdates += 1;
  }

  return result.count + visitUpdates;
}

function abAssignmentFilterWhere(
  filters?: AbReportFilters,
): Prisma.AbTestAssignmentWhereInput {
  if (!filters) return {};
  return {
    ...(filters.audience === "active" ? { visitorType: "REAL" as const } : {}),
    ...(filters.source
      ? {
          OR: [
            {
              source: { equals: filters.source, mode: "insensitive" as const },
            },
            {
              sourceCategory: {
                equals: filters.source,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
    ...(filters.medium
      ? { medium: { equals: filters.medium, mode: "insensitive" as const } }
      : {}),
    ...(filters.campaign
      ? { campaign: { equals: filters.campaign, mode: "insensitive" as const } }
      : {}),
  };
}

export async function getAbTestStats(
  testId: string,
  goal?: AbTestGoal,
  filters?: AbReportFilters,
) {
  const cohortWhere = abAssignmentFilterWhere(filters);
  const isInAudience = (row: { visitorType: string }) =>
    filters?.audience === "all" || row.visitorType === "REAL";
  const variants = await prisma.abTestVariant.findMany({
    where: { testId },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      key: true,
      name: true,
      templateName: true,
      templateSuffix: true,
      assignments: {
        where: cohortWhere,
        select: {
          sessionId: true,
          pagePath: true,
          pageTitle: true,
          resourceType: true,
          resourceHandle: true,
          visitorType: true,
          source: true,
          medium: true,
          sourceCategory: true,
          timeOnPage: true,
          scrollDepth: true,
          addedToCart: true,
          addedToCartAt: true,
          checkoutStarted: true,
          converted: true,
          convertedAt: true,
          orderValue: true,
          ctaClicks: true,
          assignedAt: true,
          endedAt: true,
          updatedAt: true,
        },
      },
    },
  });
  const useVisitEngagementTrend =
    goal === "CLICK_THROUGH" || goal === "ENGAGEMENT";
  const engagementTrendVisits = useVisitEngagementTrend
    ? await prisma.abTestVisit.findMany({
        where: {
          testId,
          sessionId: {
            in: variants.flatMap((variant) =>
              variant.assignments
                .filter(isInAudience)
                .map((row) => row.sessionId),
            ),
          },
          ...(filters ? {} : { visitorType: "REAL" as const }),
        },
        select: {
          variantId: true,
          sessionId: true,
          ctaClicks: true,
          scrollDepth: true,
          startedAt: true,
          endedAt: true,
        },
      })
    : [];

  function average<T>(
    items: T[],
    getValue: (item: T) => number | null | undefined,
  ) {
    const values = items
      .map(getValue)
      .filter((value): value is number => Number.isFinite(value));
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  type TrackedClick = {
    label?: string;
    tag?: string;
    href?: string | null;
    zone?: string;
  };

  function parseTrackedClicks(value: string | null): TrackedClick[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;

      if (parsed && typeof parsed === "object") {
        return Object.entries(parsed).flatMap(([label, count]) => {
          const clickCount = typeof count === "number" ? count : 0;
          return Array.from({ length: clickCount }, () => ({
            label,
            tag: "button",
            zone: "main",
          }));
        });
      }
    } catch {}

    return [];
  }

  function isInteractiveClick(click: TrackedClick) {
    const tag = (click.tag || "").toLowerCase();
    return tag === "a" || tag === "button" || tag === "input" || tag === "img";
  }

  function clickCategory(click: TrackedClick) {
    const zone = (click.zone || "main").toLowerCase();
    if (zone === "header") return "Header";
    if (zone === "footer") return "Footer";
    if (zone === "widget") return "Widget";

    const label = (click.label || "").toLowerCase();
    const tag = (click.tag || "").toLowerCase();

    if (
      tag === "img" ||
      /image|gallery|zoom|slide|photo|thumbnail|lightbox|carousel/i.test(label)
    ) {
      return "Image";
    }

    if (/review|rating|star|testimonial|recommend/i.test(label)) {
      return "Widget";
    }

    if (
      tag === "a" &&
      click.href &&
      !/add to cart|buy|next|prev|previous|subscribe|more|checkout/i.test(label)
    ) {
      return "Link";
    }

    return "Button";
  }

  function countCtaClicks(value: string | null) {
    return parseTrackedClicks(value).filter(isInteractiveClick).length;
  }

  function clickCategoryBreakdown(rows: Array<{ ctaClicks: string | null }>) {
    const categoryMap = new Map<string, Map<string, number>>();
    let totalClicks = 0;

    for (const row of rows) {
      for (const click of parseTrackedClicks(row.ctaClicks).filter(
        isInteractiveClick,
      )) {
        const category = clickCategory(click);
        const label = (click.label || category).trim() || category;
        if (!categoryMap.has(category)) categoryMap.set(category, new Map());
        const categoryItems = categoryMap.get(category)!;
        categoryItems.set(label, (categoryItems.get(label) || 0) + 1);
        totalClicks += 1;
      }
    }

    const categoryOrder = [
      "Image",
      "Button",
      "Link",
      "Widget",
      "Header",
      "Footer",
    ];
    const categoryRank = (key: string) => {
      const index = categoryOrder.indexOf(key);
      return index === -1 ? categoryOrder.length : index;
    };
    return Array.from(categoryMap.entries())
      .map(([category, entries]) => {
        const items = Array.from(entries.entries())
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
        const count = items.reduce((sum, item) => sum + item.count, 0);
        return {
          key: category,
          label: category,
          count,
          percent: totalClicks ? (count / totalClicks) * 100 : 0,
          items,
        };
      })
      .sort((a, b) => {
        const orderDiff = categoryRank(a.key) - categoryRank(b.key);
        if (orderDiff !== 0) return orderDiff;
        return b.count - a.count || a.label.localeCompare(b.label);
      });
  }

  function hasInteractiveClick(value: string | null) {
    return parseTrackedClicks(value).some(isInteractiveClick);
  }

  function normalizeBreakdownPath(path?: string | null) {
    if (!path) return null;
    const cleanPath = path.split("?")[0]?.split("#")[0]?.trim();
    if (!cleanPath) return null;
    if (cleanPath === "/") return "/";
    return cleanPath.replace(/\/+$/, "");
  }

  function productHandleFromPath(path?: string | null) {
    const normalized = normalizeBreakdownPath(path);
    if (!normalized) return null;
    const match = normalized.match(/(?:^|\/)products\/([^/]+)$/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }

  function canonicalPageBreakdownKey(row: {
    pagePath?: string | null;
    resourceType?: ResourceType | null;
    resourceHandle?: string | null;
    pageTitle?: string | null;
  }) {
    const productHandle =
      row.resourceType === "PRODUCT"
        ? row.resourceHandle || productHandleFromPath(row.pagePath)
        : productHandleFromPath(row.pagePath);

    if (productHandle) return `/products/${productHandle}`;

    return (
      normalizeBreakdownPath(row.pagePath) ||
      row.resourceHandle ||
      row.pageTitle ||
      "Unknown page"
    );
  }

  function topBreakdown<T>(
    items: T[],
    getKey: (item: T) => string | null | undefined,
    getLabel?: (item: T) => string | null | undefined,
  ) {
    const groups = new Map<
      string,
      { key: string; label: string; count: number }
    >();

    for (const item of items) {
      const key = (getKey(item) || "Unknown").trim() || "Unknown";
      const label = (getLabel?.(item) || key).trim() || key;
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        groups.set(key, { key, label, count: 1 });
      }
    }

    return Array.from(groups.values())
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 5)
      .map((group) => ({
        ...group,
        percent: items.length ? (group.count / items.length) * 100 : 0,
      }));
  }

  const trendAssignments = variants.flatMap((variant) =>
    variant.assignments.filter(isInAudience),
  );
  const trendStartAt = trendAssignments.reduce<Date | null>(
    (earliest, assignment) =>
      !earliest || assignment.assignedAt < earliest
        ? assignment.assignedAt
        : earliest,
    null,
  );
  const assignmentTrendEndAt = trendAssignments.reduce<Date | null>(
    (latest, assignment) => {
      const candidates = [
        assignment.assignedAt,
        assignment.addedToCartAt,
        assignment.convertedAt,
        assignment.endedAt,
        assignment.updatedAt,
      ].filter((value): value is Date => value instanceof Date);
      const rowLatest = candidates.sort(
        (left, right) => right.getTime() - left.getTime(),
      )[0];
      return !rowLatest || (latest && latest >= rowLatest) ? latest : rowLatest;
    },
    null,
  );
  const visitTrendEndAt = engagementTrendVisits.reduce<Date | null>(
    (latest, visit) => {
      const visitEnd = visit.endedAt || visit.startedAt;
      return !latest || visitEnd > latest ? visitEnd : latest;
    },
    null,
  );
  const trendEndAt =
    !assignmentTrendEndAt ||
    (visitTrendEndAt && visitTrendEndAt > assignmentTrendEndAt)
      ? visitTrendEndAt
      : assignmentTrendEndAt;

  const applyVisitEngagementTrend = (
    trend: ReturnType<typeof buildCumulativeAbTestTrend>,
    variantId: string,
  ) => {
    if (!useVisitEngagementTrend) return trend;
    const variantVisits = engagementTrendVisits
      .filter((visit) => visit.variantId === variantId)
      .map((visit) => ({
        ...visit,
        engagementAt: visit.endedAt || visit.startedAt,
      }))
      .sort(
        (left, right) =>
          left.engagementAt.getTime() - right.engagementAt.getTime(),
      );
    const ctaSessions = new Set<string>();
    let visitIndex = 0;
    let scrollTotal = 0;
    let scrollSamples = 0;

    return trend.map((point) => {
      const bucketEnd = new Date(`${point.date}T23:59:59.999Z`);
      while (
        visitIndex < variantVisits.length &&
        variantVisits[visitIndex].engagementAt <= bucketEnd
      ) {
        const visit = variantVisits[visitIndex];
        if (hasTrackedInteraction(visit.ctaClicks)) {
          ctaSessions.add(visit.sessionId);
        }
        const scrollDepth = Number(visit.scrollDepth || 0);
        if (Number.isFinite(scrollDepth)) {
          scrollTotal += scrollDepth;
          scrollSamples += 1;
        }
        visitIndex += 1;
      }
      const ctaVisitors = ctaSessions.size;

      return {
        ...point,
        ctaVisitors,
        ctaClickRate: point.visitors ? (ctaVisitors / point.visitors) * 100 : 0,
        avgScrollDepth: scrollSamples ? scrollTotal / scrollSamples : 0,
      };
    });
  };

  return variants.map((variant) => {
    const assignments = variant.assignments;
    const assignmentHumans = assignments.filter(isInAudience);
    const metricRows = assignmentHumans;
    const pageBreakdownRows = assignmentHumans;
    const sourceBreakdownRows = assignmentHumans;
    const qualityRows = assignments;
    const commerceRows = assignmentHumans;
    const visitors = assignmentHumans.length;
    const atc = commerceRows.filter((row) => row.addedToCart).length;
    const checkoutStarts = commerceRows.filter(
      (row) => row.checkoutStarted,
    ).length;
    const conversions = commerceRows.filter((row) => row.converted).length;
    const revenue = commerceRows.reduce(
      (sum, row) => sum + Number(row.orderValue || 0),
      0,
    );
    const ctaClicks = metricRows.reduce(
      (sum, row) => sum + countCtaClicks(row.ctaClicks),
      0,
    );
    const ctaVisitorSessions = new Set(
      metricRows
        .filter((row) => hasInteractiveClick(row.ctaClicks))
        .map((row) => row.sessionId),
    );
    const searches = 0;
    const filterInteractions = 0;
    const exits = 0;

    return {
      variantId: variant.id,
      key: variant.key,
      name: variant.name,
      templateName: variant.templateName,
      templateSuffix: variant.templateSuffix,
      assignedVisitors: assignments.length,
      visitors,
      realVisitors: assignments.filter((row) => row.visitorType === "REAL")
        .length,
      audience: filters?.audience || "active",
      totalPageViews: qualityRows.length,
      humanPageViews: visitors,
      zombies: qualityRows.filter((row) => row.visitorType === "ZOMBIE").length,
      bots: qualityRows.filter((row) => row.visitorType === "BOT").length,
      pending: qualityRows.filter((row) => row.visitorType === "PENDING")
        .length,
      addToCarts: atc,
      addToCartRate: visitors ? (atc / visitors) * 100 : 0,
      checkoutStarts,
      conversionRate: visitors ? (conversions / visitors) * 100 : 0,
      conversions,
      orders: conversions,
      revenue,
      revenuePerVisitor: visitors ? revenue / visitors : 0,
      avgTimeOnPage: average(metricRows, (row) => row.timeOnPage),
      avgScrollDepth: average(metricRows, (row) => row.scrollDepth),
      ctaClicks,
      ctaClickRate: visitors ? (ctaVisitorSessions.size / visitors) * 100 : 0,
      searches,
      filterInteractions,
      exits,
      sourceBreakdown: topBreakdown(
        sourceBreakdownRows,
        (row) =>
          row.sourceCategory || row.source || row.medium || "Direct / unknown",
      ),
      pageBreakdown: topBreakdown(
        pageBreakdownRows,
        (row) => canonicalPageBreakdownKey(row),
        (row) =>
          row.pageTitle || row.pagePath || row.resourceHandle || "Unknown page",
      ),
      deviceBreakdown: [],
      countryBreakdown: [],
      exitBreakdown: [],
      zoneBreakdown: clickCategoryBreakdown(metricRows),
      trend: applyVisitEngagementTrend(
        buildCumulativeAbTestTrend(assignments, {
          startAt: trendStartAt,
          endAt: trendEndAt,
          audience: filters?.audience || "active",
        }),
        variant.id,
      ),
    };
  });
}

function targetVariantVisitWhere(
  targetPageType: AbTestPageType,
): Prisma.AbTestVisitWhereInput {
  if (targetPageType === "CART") {
    return { pagePath: { startsWith: "/cart" } };
  }

  const pathPrefix: Partial<Record<AbTestPageType, string>> = {
    PRODUCT: "/products/",
    COLLECTION: "/collections/",
    PAGE: "/pages/",
    BLOG: "/blogs/",
  };
  const resourceType = targetPageType as ResourceType;
  const fallbackPath = pathPrefix[targetPageType];

  return {
    OR: [
      { resourceType },
      ...(targetPageType === "HOMEPAGE" ? [{ pagePath: "/" }] : []),
      ...(fallbackPath ? [{ pagePath: { startsWith: fallbackPath } }] : []),
    ],
  };
}

export async function getAbVariantSnapshotStats({
  shop,
  testId,
  variantId,
  targetPageType,
  targetPagePath,
  filters,
}: {
  shop: string;
  testId: string;
  variantId: string;
  targetPageType: AbTestPageType;
  targetPagePath?: string | null;
  filters?: AbReportFilters;
}) {
  const variant = await prisma.abTestVariant.findFirst({
    where: {
      id: variantId,
      testId,
      test: { shop },
    },
    select: {
      id: true,
      key: true,
      name: true,
      templateName: true,
      templateSuffix: true,
    },
  });

  if (!variant) return null;

  const assignments = await prisma.abTestAssignment.findMany({
    where: { shop, testId, variantId, ...abAssignmentFilterWhere(filters) },
    select: {
      sessionId: true,
      visitorType: true,
      sourceCategory: true,
      source: true,
      medium: true,
      addedToCart: true,
      checkoutStarted: true,
      converted: true,
      orderValue: true,
    },
  });
  const visits = await prisma.abTestVisit.findMany({
    where: {
      shop,
      testId,
      variantId,
      ...targetVariantVisitWhere(targetPageType),
      ...(targetPagePath ? { pagePath: targetPagePath } : {}),
      ...(filters
        ? { sessionId: { in: assignments.map((row) => row.sessionId) } }
        : {}),
    },
    select: {
      sessionId: true,
      pagePath: true,
      pageTitle: true,
      resourceType: true,
      resourceHandle: true,
      visitorType: true,
      sourceCategory: true,
      source: true,
      medium: true,
      timeOnPage: true,
      scrollDepth: true,
      deviceType: true,
      exitType: true,
      exitUrl: true,
      searchQuery: true,
      filterInteractions: true,
      ctaClicks: true,
      country: true,
      countryCode: true,
    },
  });

  const assignmentHumans = assignments.filter(
    (assignment) =>
      filters?.audience === "all" || assignment.visitorType === "REAL",
  );
  const visitHumans = filters
    ? visits
    : visits.filter((visit) => visit.visitorType === "REAL");
  const commerceRows = assignmentHumans;
  const behaviorRows = visitHumans;
  const clickRows = behaviorRows.map((row) => ({
    ctaClicks: row.ctaClicks,
    sessionId: row.sessionId,
  }));
  const clickEngagement = buildClickEngagement(
    clickRows,
    assignmentHumans.length,
  );
  const categoryTotal = Object.values(clickEngagement.categoryTotals).reduce(
    (sum, count) => sum + count,
    0,
  );
  const categoryOrder = [
    "Image",
    "Button",
    "Link",
    "Widget",
    "Header",
    "Footer",
  ];
  const categoryRank = (key: string) => {
    const index = categoryOrder.indexOf(key);
    return index === -1 ? categoryOrder.length : index;
  };
  const zoneBreakdown = Object.entries(clickEngagement.categoryTotals)
    .map(([category, count]) => ({
      key: category,
      label: category,
      count,
      percent: categoryTotal ? (count / categoryTotal) * 100 : 0,
      items: clickEngagement.ctaByCategory[category] || [],
    }))
    .sort(
      (left, right) =>
        categoryRank(left.key) - categoryRank(right.key) ||
        right.count - left.count,
    );

  function average<T>(
    items: T[],
    getValue: (item: T) => number | null | undefined,
  ) {
    const values = items
      .map(getValue)
      .filter((value): value is number => Number.isFinite(value));
    return values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
  }

  function topBreakdown<T>(
    items: T[],
    getKey: (item: T) => string | null | undefined,
    getLabel?: (item: T) => string | null | undefined,
  ) {
    const grouped = new Map<
      string,
      { key: string; label: string; count: number }
    >();
    for (const item of items) {
      const key = (getKey(item) || "Unknown").trim() || "Unknown";
      const label = (getLabel?.(item) || key).trim() || key;
      const existing = grouped.get(key);
      if (existing) existing.count += 1;
      else grouped.set(key, { key, label, count: 1 });
    }
    return Array.from(grouped.values())
      .sort(
        (left, right) =>
          right.count - left.count || left.label.localeCompare(right.label),
      )
      .slice(0, 8)
      .map((group) => ({
        ...group,
        percent: items.length ? (group.count / items.length) * 100 : 0,
      }));
  }

  const canonicalPageKey = (row: {
    pagePath?: string | null;
    resourceHandle?: string | null;
    resourceType?: ResourceType | null;
  }) => {
    if (row.resourceHandle && row.resourceType) {
      return `${row.resourceType}:${row.resourceHandle}`;
    }
    return row.pagePath?.split("?")[0]?.split("#")[0] || "Unknown page";
  };
  const sourceBreakdown = topBreakdown(
    assignmentHumans,
    (row) =>
      row.sourceCategory || row.source || row.medium || "Direct / unknown",
  );
  const pageBreakdown = topBreakdown(
    visitHumans,
    canonicalPageKey,
    (row) =>
      row.pageTitle || row.pagePath || row.resourceHandle || "Unknown page",
  );
  const deviceBreakdown = topBreakdown(
    visitHumans,
    (row) => row.deviceType || "Unknown device",
  );
  const countryBreakdown = topBreakdown(
    visitHumans,
    (row) => row.country || row.countryCode || "Unknown country",
  );
  const exitBreakdown = topBreakdown(
    visitHumans.filter((row) => row.exitType),
    (row) => row.exitType || "Unknown exit",
    (row) => row.exitType?.replaceAll("_", " ") || "Unknown exit",
  );
  const testedPages = topBreakdown(
    visits,
    canonicalPageKey,
    (row) =>
      row.pageTitle || row.pagePath || row.resourceHandle || "Unknown page",
  );
  const sourceQualityBreakdown = buildSourceQualityBreakdown(
    assignments,
    filters?.audience || "active",
  );
  const sourceKeyFor = (row: {
    sourceCategory?: string | null;
    source?: string | null;
    medium?: string | null;
  }) =>
    (row.sourceCategory || row.source || row.medium || "Direct / unknown")
      .trim()
      .toLowerCase() || "direct / unknown";
  const assignmentSourceBySession = new Map(
    assignments.map((row) => [row.sessionId, sourceKeyFor(row)]),
  );
  const sourceVisitEngagement = new Map<
    string,
    { timeOnPage: number; scrollDepth: number; visits: number }
  >();
  for (const row of visitHumans) {
    const sourceKey =
      assignmentSourceBySession.get(row.sessionId) || sourceKeyFor(row);
    const current = sourceVisitEngagement.get(sourceKey) || {
      timeOnPage: 0,
      scrollDepth: 0,
      visits: 0,
    };
    current.timeOnPage += Number(row.timeOnPage || 0);
    current.scrollDepth += Number(row.scrollDepth || 0);
    current.visits += 1;
    sourceVisitEngagement.set(sourceKey, current);
  }
  const sourceQualityWithVisitEngagement = sourceQualityBreakdown.map((row) => {
    const engagement = sourceVisitEngagement.get(row.key);
    if (!engagement?.visits) {
      return { ...row, avgTimeOnPage: 0, avgScrollDepth: 0 };
    }
    return {
      ...row,
      avgTimeOnPage: engagement.timeOnPage / engagement.visits,
      avgScrollDepth: engagement.scrollDepth / engagement.visits,
    };
  });
  type VariantTrackedClick = {
    label?: string;
    tag?: string;
    href?: string | null;
    zone?: string;
  };
  const parseVariantTrackedClicks = (
    raw: string | null,
  ): VariantTrackedClick[] => {
    if (!raw) return [] as VariantTrackedClick[];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as VariantTrackedClick[];
      if (parsed && typeof parsed === "object") {
        return Object.entries(parsed).flatMap(([label, count]) => {
          const clickCount = Number(count);
          if (!Number.isFinite(clickCount) || clickCount <= 0) return [];
          return Array.from(
            { length: Math.floor(clickCount) },
            (): VariantTrackedClick => ({
              label,
              tag: "button",
              zone: "main",
            }),
          );
        });
      }
    } catch {}
    return [] as VariantTrackedClick[];
  };
  const bodyCtaSessions = new Set<string>();
  const productClickSessions = new Set<string>();
  const anyLinkOrButtonClickSessions = new Set<string>();
  const scroll50Sessions = new Set<string>();
  const scroll100Sessions = new Set<string>();
  let linkClickCount = 0;
  let bodyCtaClickCount = 0;
  let productClickCount = 0;
  let anyLinkOrButtonClickCount = 0;

  for (const row of visitHumans) {
    const clicks = parseVariantTrackedClicks(row.ctaClicks);
    const linkClicks = clicks.filter(
      (click) => (click.tag || "").toLowerCase() === "a" && Boolean(click.href),
    );
    const bodyCtaClicks = clicks.filter((click) => {
      const tag = (click.tag || "").toLowerCase();
      return (
        (click.zone || "main").toLowerCase() === "main" &&
        (tag === "button" || tag === "input")
      );
    });
    const linkOrButtonClicks = clicks.filter((click) => {
      const tag = (click.tag || "").toLowerCase();
      return tag === "a" || tag === "button" || tag === "input";
    });
    const trackedProductClicks = linkClicks.filter((click) =>
      /(?:^|\/)products\/[^/?#]+/i.test(click.href || ""),
    ).length;
    const hasProductExit = /(?:^|\/)products\/[^/?#]+/i.test(row.exitUrl || "");
    const rowProductClicks = trackedProductClicks || (hasProductExit ? 1 : 0);

    linkClickCount += linkClicks.length;
    bodyCtaClickCount += bodyCtaClicks.length;
    productClickCount += rowProductClicks;
    anyLinkOrButtonClickCount += linkOrButtonClicks.length;
    if (bodyCtaClicks.length) bodyCtaSessions.add(row.sessionId);
    if (rowProductClicks) productClickSessions.add(row.sessionId);
    if (linkOrButtonClicks.length) {
      anyLinkOrButtonClickSessions.add(row.sessionId);
    }
    if (row.scrollDepth >= 50) scroll50Sessions.add(row.sessionId);
    if (row.scrollDepth >= 100) scroll100Sessions.add(row.sessionId);
  }
  const targetRealSessions = new Set(visitHumans.map((row) => row.sessionId))
    .size;
  const sessionRate = (count: number) =>
    targetRealSessions ? (count / targetRealSessions) * 100 : 0;
  const visitors = assignmentHumans.length;
  const addToCarts = commerceRows.filter((row) => row.addedToCart).length;
  const checkoutStarts = commerceRows.filter(
    (row) => row.checkoutStarted,
  ).length;
  const conversions = commerceRows.filter((row) => row.converted).length;
  const revenue = commerceRows.reduce(
    (sum, row) => sum + Number(row.orderValue || 0),
    0,
  );
  const ctaVisitorSessions = new Set(
    behaviorRows
      .filter((row) => hasTrackedInteraction(row.ctaClicks))
      .map((row) => row.sessionId),
  );

  return {
    variantId: variant.id,
    key: variant.key,
    name: variant.name,
    templateName: variant.templateName,
    templateSuffix: variant.templateSuffix,
    assignedVisitors: assignments.length,
    visitors,
    realVisitors: assignments.filter((row) => row.visitorType === "REAL")
      .length,
    audience: filters?.audience || "active",
    totalPageViews: visits.length,
    humanPageViews: visitHumans.length,
    zombies: assignments.filter((row) => row.visitorType === "ZOMBIE").length,
    bots: assignments.filter((row) => row.visitorType === "BOT").length,
    pending: assignments.filter((row) => row.visitorType === "PENDING").length,
    addToCarts,
    addToCartRate: visitors ? (addToCarts / visitors) * 100 : 0,
    checkoutStarts,
    conversionRate: visitors ? (conversions / visitors) * 100 : 0,
    conversions,
    orders: conversions,
    revenue,
    revenuePerVisitor: visitors ? revenue / visitors : 0,
    avgTimeOnPage: average(behaviorRows, (row) => row.timeOnPage),
    avgScrollDepth: average(behaviorRows, (row) => row.scrollDepth),
    ctaClicks: categoryTotal,
    ctaClickRate: visitors ? (ctaVisitorSessions.size / visitors) * 100 : 0,
    searches: visitHumans.filter((row) => row.searchQuery?.trim()).length,
    filterInteractions: visitHumans.reduce(
      (sum, row) => sum + (row.filterInteractions || 0),
      0,
    ),
    linkClickCount,
    bodyCtaClickCount,
    bodyCtaSessionCount: bodyCtaSessions.size,
    bodyCtaCtrRate: sessionRate(bodyCtaSessions.size),
    productClickCount,
    productClickSessionCount: productClickSessions.size,
    productCtrRate: sessionRate(productClickSessions.size),
    scroll50Count: scroll50Sessions.size,
    scroll50Rate: sessionRate(scroll50Sessions.size),
    scroll100Count: scroll100Sessions.size,
    scroll100Rate: sessionRate(scroll100Sessions.size),
    anyLinkOrButtonClickCount,
    anyLinkOrButtonClickSessionCount: anyLinkOrButtonClickSessions.size,
    anyClickCtrRate: sessionRate(anyLinkOrButtonClickSessions.size),
    exits: visitHumans.filter((row) => row.exitType?.trim()).length,
    sourceBreakdown,
    pageBreakdown,
    deviceBreakdown,
    countryBreakdown,
    exitBreakdown,
    zoneBreakdown,
    imageEngagement: clickEngagement.imageEngagement,
    engagementOutcomes: buildEngagementOutcomes(clickRows, assignmentHumans),
    sourceQualityBreakdown: sourceQualityWithVisitEngagement,
    testedPages,
    scopePageCount: new Set(visits.map(canonicalPageKey)).size,
  };
}
