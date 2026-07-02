import type {
  AbTestGoal,
  AbTestPageType,
  AbTestStatus,
  ResourceType,
  VisitorType,
} from "@prisma/client";
import { createHmac, timingSafeEqual } from "node:crypto";
import prisma from "../db.server";

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

type ThemeTemplateVariantKind = "duplicate" | "recommendation";

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
}: {
  admin: ShopifyAdminClient;
  control: ThemeTemplateOption;
  kind: ThemeTemplateVariantKind;
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

  await upsertThemeFile(admin, control.themeId, targetFilename, sourceContent);

  const previewPageUrl = replacePreviewUrlSuffix(
    control.previewPageUrl,
    targetSuffix,
  );
  const templateName =
    kind === "recommendation"
      ? `Recommended ${getAbTestPageTypeLabel(control.pageType).toLowerCase()} variant`
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
  };
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
  const marker = kind === "recommendation" ? "rec" : "copy";
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

export async function createTemplateAbTest({
  shop,
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
}: {
  shop: string;
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
}) {
  const split = Math.min(95, Math.max(5, Math.round(trafficSplit || 50)));
  return prisma.abTest.create({
    data: {
      shop,
      name: name.trim() || "Untitled template test",
      targetPageType,
      goal,
      notes: notes || null,
      themeId: themeId || null,
      themeName: themeName || null,
      themeRole: themeRole || null,
      trafficSplit: split,
      variants: {
        create: [
          {
            key: "A",
            name: "Control",
            templateName: controlTemplateName || "Default",
            templateSuffix: controlTemplateSuffix || null,
            templateFileName: controlTemplateFileName || null,
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
    },
    orderBy: [{ launchedAt: "desc" }, { createdAt: "desc" }],
    include: { variants: { orderBy: { sortOrder: "asc" } } },
  });

  if (!test || test.variants.length < 2) {
    return { assigned: false as const, reason: "no_live_test" };
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
  if (variantId && existing.variantId !== variantId) return false;

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
      source: source || existing.source,
      medium: medium || existing.medium,
      campaign: campaign || existing.campaign,
      referrer: referrer || existing.referrer,
      sourceCategory: sourceCategory || existing.sourceCategory,
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

export async function getAbTestStats(testId: string) {
  const variants = await prisma.abTestVariant.findMany({
    where: { testId },
    orderBy: { sortOrder: "asc" },
    include: {
      assignments: true,
      visits: true,
    },
  });

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

  function countCtaClicks(value: string | null) {
    if (!value) return 0;
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
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

  return variants.map((variant) => {
    const assignments = variant.assignments;
    const assignmentHumans = assignments.filter(
      (assignment) => assignment.visitorType === "REAL",
    );
    const visitHumans = variant.visits.filter(
      (visit) => visit.visitorType === "REAL",
    );
    const metricRows = visitHumans.length ? visitHumans : assignmentHumans;
    const landingMetricRows = visitHumans.length
      ? visitHumans.filter((visit) => visit.isLandingPage)
      : [];
    const pageBreakdownRows =
      landingMetricRows.length || !visitHumans.length
        ? landingMetricRows.length
          ? landingMetricRows
          : assignmentHumans
        : visitHumans;
    const sourceBreakdownRows = assignmentHumans.length
      ? assignmentHumans
      : pageBreakdownRows;
    const qualityRows = variant.visits.length ? variant.visits : assignments;
    const commerceRows = assignmentHumans.length
      ? assignmentHumans
      : metricRows;
    const visitors = assignmentHumans.length
      ? assignmentHumans.length
      : new Set(visitHumans.map((visit) => visit.sessionId)).size;
    const atc = commerceRows.filter((row) => row.addedToCart).length;
    const conversions = commerceRows.filter((row) => row.converted).length;
    const revenue = commerceRows.reduce(
      (sum, row) => sum + Number(row.orderValue || 0),
      0,
    );
    const ctaClicks = metricRows.reduce(
      (sum, row) => sum + countCtaClicks(row.ctaClicks),
      0,
    );
    const ctaVisitors = metricRows.filter(
      (row) => countCtaClicks(row.ctaClicks) > 0,
    ).length;
    const searches = visitHumans.filter((row) =>
      row.searchQuery?.trim(),
    ).length;
    const filterInteractions = visitHumans.reduce(
      (sum, row) => sum + (row.filterInteractions || 0),
      0,
    );
    const exits = visitHumans.filter((row) => row.exitType?.trim()).length;

    return {
      variantId: variant.id,
      key: variant.key,
      name: variant.name,
      templateName: variant.templateName,
      templateSuffix: variant.templateSuffix,
      assignedVisitors: assignments.length,
      visitors,
      realVisitors: visitors,
      humanPageViews: visitHumans.length || visitors,
      zombies: qualityRows.filter((row) => row.visitorType === "ZOMBIE").length,
      bots: qualityRows.filter((row) => row.visitorType === "BOT").length,
      pending: qualityRows.filter((row) => row.visitorType === "PENDING")
        .length,
      addToCarts: atc,
      addToCartRate: visitors ? (atc / visitors) * 100 : 0,
      conversionRate: visitors ? (conversions / visitors) * 100 : 0,
      conversions,
      orders: conversions,
      revenue,
      revenuePerVisitor: visitors ? revenue / visitors : 0,
      avgTimeOnPage: average(metricRows, (row) => row.timeOnPage),
      avgScrollDepth: average(metricRows, (row) => row.scrollDepth),
      ctaClicks,
      ctaClickRate: visitors ? (ctaVisitors / visitors) * 100 : 0,
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
        (row) =>
          row.pagePath || row.resourceHandle || row.pageTitle || "Unknown page",
        (row) =>
          row.pageTitle || row.pagePath || row.resourceHandle || "Unknown page",
      ),
      deviceBreakdown: topBreakdown(
        visitHumans,
        (row) => row.deviceType || "Unknown device",
      ),
      countryBreakdown: topBreakdown(
        visitHumans,
        (row) => row.country || row.countryCode || "Unknown country",
      ),
      exitBreakdown: topBreakdown(
        visitHumans.filter((row) => row.exitType),
        (row) => row.exitType || "Unknown exit",
        (row) =>
          row.exitType ? row.exitType.replaceAll("_", " ") : "Unknown exit",
      ),
    };
  });
}
