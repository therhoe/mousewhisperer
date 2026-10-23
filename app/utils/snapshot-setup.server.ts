import { createHash } from "node:crypto";
import { Prisma, type ResourceType } from "@prisma/client";
import prisma from "../db.server";
import { getBillingAccess, PlanLimitError } from "./billing.server";
import { ensureWebPixel } from "./web-pixel.server";
import { assertPublishedOnlineStoreProduct } from "./storefront-product.server";
import {
  setupCustomerLink,
  setupTarget,
  trackerSettingsState,
  type TrackerState,
} from "./snapshot-setup";
import {
  clearCacheKey,
  clearCachePrefix,
  loaderCacheKeys,
} from "./loader-cache.server";

type Admin = { graphql: (query: string, options?: any) => Promise<Response> };
export class SetupError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

async function query(
  admin: Admin,
  source: string,
  variables?: Record<string, unknown>,
) {
  const response = await admin.graphql(source, { variables });
  const result = await response.json();
  if (!response.ok || result.errors?.length || !result.data)
    throw new SetupError(
      "Shopify could not verify setup. Please try again.",
      503,
    );
  return result.data;
}

export async function savedTrackerState(admin: Admin): Promise<TrackerState> {
  try {
    const data = await query(
      admin,
      `query SetupTrackerStatus {
      themes(first: 1, roles: [MAIN]) { nodes {
        files(first: 1, filenames: ["config/settings_data.json"]) { nodes {
          body { ... on OnlineStoreThemeFileBodyText { content } }
        } }
      } }
    }`,
    );
    const content = data.themes?.nodes?.[0]?.files?.nodes?.[0]?.body?.content;
    return typeof content === "string"
      ? trackerSettingsState(content)
      : "unknown";
  } catch {
    return "unknown";
  }
}

export async function resolveSetupPage(
  admin: Admin,
  type: string,
  id: string,
  options: { requirePublishedProduct?: boolean } = {},
) {
  if (type === "HOMEPAGE")
    return {
      id: "gid://shopify/Homepage/__homepage__",
      title: "Homepage",
      handle: "__homepage__",
    };
  if (
    !["PRODUCT", "COLLECTION", "PAGE", "BLOG"].includes(type) ||
    !/^gid:\/\/shopify\/(Product|Collection|Page|Blog|Article)\/\d+$/.test(id)
  )
    throw new SetupError("Choose a storefront page.");
  const data = await query(
    admin,
    `query SetupPage($id: ID!) { node(id: $id) {
    __typename
    ... on Product { id title handle status publishedAt }
    ... on Collection { id title handle }
    ... on Page { id title handle }
    ... on Blog { id title handle }
    ... on Article { id title handle blog { handle } }
  } }`,
    { id },
  );
  const node = data.node;
  if (type === "PRODUCT" && options.requirePublishedProduct) {
    assertPublishedOnlineStoreProduct(node);
  }
  const expected: Record<string, string[]> = {
    PRODUCT: ["Product"],
    COLLECTION: ["Collection"],
    PAGE: ["Page"],
    BLOG: ["Blog", "Article"],
  };
  if (
    !node ||
    !expected[type].includes(node.__typename) ||
    (type === "PRODUCT" && node.status !== "ACTIVE")
  )
    throw new SetupError("This page is unavailable. Choose another page.");
  return {
    id: node.id as string,
    title: node.title as string,
    handle:
      node.__typename === "Article"
        ? `${node.blog.handle}/${node.handle}`
        : (node.handle as string),
  };
}

export async function startSetupSnapshots(
  shop: string,
  admin: Admin,
  form: FormData,
) {
  const text = (key: string) => String(form.get(key) || "").trim();
  const kind = text("kind");
  const key = text("requestKey");
  if (
    !["store", "channel", "customer"].includes(kind) ||
    !/^[a-f0-9-]{36}$/i.test(key)
  )
    throw new SetupError("Choose a snapshot type and try again.");
  const target = setupTarget(text("target"));
  const pageTarget = setupTarget(text("pageTarget"), 1);
  const type = text("pageType") as ResourceType;
  // A retry after a dropped response returns the same pair, never creates another.
  const id = `setup_${createHash("sha256").update(`${shop}:${kind}:${key}`).digest("hex").slice(0, 32)}`;
  const existing = await prisma.snapshot.findFirst({
    where: { id, project: { shop } },
  });
  if (existing)
    return {
      pageUrl: `/app/project/${existing.projectId}`,
      snapshotUrl: `/app/${kind}-snapshots/${id}`,
    };
  const [page, access, tracker] = await Promise.all([
    resolveSetupPage(admin, type, text("pageId")),
    getBillingAccess(shop),
    savedTrackerState(admin),
  ]);
  if (tracker !== "active")
    throw new SetupError(
      tracker === "missing"
        ? "Enable Snapshot Tracker in the theme editor, save, then return here."
        : "Tracker activation could not be verified. Save your live theme and retry.",
      409,
    );
  if (
    target > access.limits.maxSnapshotTargetVisitors ||
    pageTarget > access.limits.maxSnapshotTargetVisitors
  )
    throw new PlanLimitError(
      `Your plan supports up to ${access.limits.maxSnapshotTargetVisitors.toLocaleString()} per snapshot.`,
    );
  const customer =
    kind === "customer" ? setupCustomerLink(text("campaignLink")) : null;
  if (customer) {
    const data = await query(
      admin,
      "query SetupDomain { shop { primaryDomain { host } } }",
    );
    if (
      ![shop, data.shop?.primaryDomain?.host].includes(
        new URL(customer.destinationUrl).hostname,
      )
    )
      throw new SetupError("Use a campaign link on this store's domain.");
  }
  const pixel = await ensureWebPixel(admin, shop);
  if (!pixel.ready)
    throw new SetupError(
      "Checkout tracking could not be configured. No snapshots were started. Please retry.",
      503,
    );

  try {
    const result = await prisma.$transaction(
      async (db) => {
        // Serialize setup submissions per merchant, including different browser tabs.
        // This function returns PostgreSQL void; execute without deserializing it.
        await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`snapshot-setup:${shop}`}))`;
        const retry = await db.snapshot.findFirst({
          where: { id, project: { shop } },
        });
        if (retry) return { projectId: retry.projectId };
        const [storeCount, pages, channels, customers] = await Promise.all([
          db.storeSnapshot.count({ where: { shop } }),
          db.snapshot.count({ where: { project: { shop } } }),
          db.channelSnapshot.count({ where: { shop } }),
          db.customerSnapshot.count({ where: { shop } }),
        ]);
        if (
          pages + channels + customers + (kind === "store" ? 1 : 2) >
            access.limits.normalSnapshots ||
          (kind === "store" && storeCount + 1 > access.limits.storeSnapshots)
        )
          throw new PlanLimitError(
            "Your plan does not have room for both snapshots. Upgrade or change the snapshot type.",
          );
        const where = { shop, status: "ACTIVE" as const };
        const active =
          kind === "store"
            ? await db.storeSnapshot.findFirst({ where })
            : kind === "channel"
              ? await db.channelSnapshot.findFirst({ where })
              : await db.customerSnapshot.findFirst({ where });
        if (active)
          throw new SetupError(
            `A ${kind} snapshot is already running. Pause or finish it before starting this pair.`,
            409,
          );
        if (
          await db.project.findFirst({
            where: {
              shop,
              resourceType: type,
              productId: page.id,
              snapshots: { some: { status: "ACTIVE" } },
            },
          })
        )
          throw new SetupError(
            "This page already has an active snapshot. Choose another page or finish that snapshot first.",
            409,
          );
        let project = await db.project.findFirst({
          where: { shop, productId: page.id, resourceType: type },
        });
        if (!project)
          project = await db.project.create({
            data: {
              shop,
              resourceType: type,
              productId: page.id,
              productTitle: page.title,
              productHandle: page.handle,
            },
          });
        const latest = await db.snapshot.findFirst({
          where: { projectId: project.id },
          orderBy: { number: "desc" },
        });
        await db.snapshot.create({
          data: {
            id,
            projectId: project.id,
            number: (latest?.number || 0) + 1,
            name: "Setup baseline",
            targetVisitors: pageTarget,
          },
        });
        if (kind === "store")
          await db.storeSnapshot.create({
            data: {
              id,
              shop,
              name: "Setup baseline",
              completionMode: "HUMAN_VISITORS",
              targetHumanVisitors: target,
            },
          });
        else if (kind === "channel")
          await db.channelSnapshot.create({
            data: {
              id,
              shop,
              name: "Setup baseline",
              completionMode: "HUMAN_SESSIONS",
              targetSessions: target,
            },
          });
        else
          await db.customerSnapshot.create({
            data: {
              id,
              shop,
              name: "Setup baseline",
              ...customer!,
              targetSessions: target,
              endsAt: new Date(Date.now() + 7 * 86_400_000),
            },
          });
        await db.shopSettings.upsert({
          where: { shop },
          create: { shop, setupGuideDismissed: true },
          update: { setupGuideDismissed: true },
        });
        return { projectId: project.id };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15_000,
      },
    );
    clearCacheKey(loaderCacheKeys.dashboard(shop));
    clearCacheKey(loaderCacheKeys.billingDisplay(shop));
    clearCachePrefix(loaderCacheKeys.categoryPrefix(shop));
    clearCachePrefix(loaderCacheKeys.categoryFastPrefix(shop));
    return {
      pageUrl: `/app/project/${result.projectId}`,
      snapshotUrl: `/app/${kind}-snapshots/${id}`,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2002", "P2034"].includes(error.code)
    )
      throw new SetupError(
        "Another setup request is finishing. Retry safely; snapshots will not be duplicated.",
        409,
      );
    throw error;
  }
}
