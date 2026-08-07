import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getCROActivityTimeline } from "../utils/optimization-timeline.server";
import {
  getShopifyConversionProgress,
  isConversionPeriod,
} from "../utils/shopify-analytics.server";

const EVENT_CATEGORIES = new Set([
  "DESIGN",
  "COPY",
  "MERCHANDISING",
  "PRICING",
  "PROMOTION",
  "NAVIGATION",
  "PERFORMANCE",
  "OTHER",
]);

function parseEventDate(value: FormDataEntryValue | null, fallback?: Date) {
  const raw = String(value || "").trim();
  if (!raw) return fallback || null;
  const date = new Date(raw.length === 10 ? `${raw}T12:00:00.000Z` : raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const requestedPeriod = new URL(request.url).searchParams.get("period");
  const period = isConversionPeriod(requestedPeriod)
    ? requestedPeriod
    : "month";
  const progress = await getShopifyConversionProgress({
    admin,
    shop: session.shop,
    sessionScope: session.scope,
    period,
  });
  const events = await getCROActivityTimeline(
    session.shop,
    progress.rangeStart,
    progress.rangeEnd,
  );

  return json({ progress, events });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = String(formData.get("action") || "");

  if (actionType === "delete-optimization") {
    const id = String(formData.get("id") || "");
    if (!id)
      return json(
        { ok: false, error: "Missing optimization ID" },
        { status: 400 },
      );
    const result = await prisma.optimizationEvent.deleteMany({
      where: { id, shop: session.shop, sourceType: "MANUAL" },
    });
    return result.count
      ? json({ ok: true })
      : json({ ok: false, error: "Optimization not found" }, { status: 404 });
  }

  if (
    actionType !== "create-optimization" &&
    actionType !== "update-optimization"
  ) {
    return json({ ok: false, error: "Invalid action" }, { status: 400 });
  }

  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const categoryValue = String(
    formData.get("category") || "OTHER",
  ).toUpperCase();
  const category = EVENT_CATEGORIES.has(categoryValue)
    ? categoryValue
    : "OTHER";
  const scope =
    String(formData.get("scope") || "STORE").toUpperCase() === "PAGE"
      ? "PAGE"
      : "STORE";
  const pagePath = String(formData.get("pagePath") || "").trim();
  const implementedAt = parseEventDate(
    formData.get("implementedAt"),
    new Date(),
  );
  const endedAt = parseEventDate(formData.get("endedAt"));

  if (!title || title.length > 120) {
    return json(
      {
        ok: false,
        error: "Enter an optimization title of 120 characters or fewer.",
      },
      { status: 400 },
    );
  }
  if (!implementedAt) {
    return json(
      { ok: false, error: "Enter a valid implementation date." },
      { status: 400 },
    );
  }
  if (endedAt && endedAt < implementedAt) {
    return json(
      {
        ok: false,
        error: "End date cannot be before the implementation date.",
      },
      { status: 400 },
    );
  }

  const data = {
    title,
    description: description || null,
    category,
    status: endedAt ? "ENDED" : "IMPLEMENTED",
    scope,
    pagePath: scope === "PAGE" && pagePath ? pagePath : null,
    sourceType: "MANUAL",
    implementedAt,
    endedAt,
  };

  if (actionType === "update-optimization") {
    const id = String(formData.get("id") || "");
    const result = await prisma.optimizationEvent.updateMany({
      where: { id, shop: session.shop, sourceType: "MANUAL" },
      data,
    });
    return result.count
      ? json({ ok: true })
      : json({ ok: false, error: "Optimization not found" }, { status: 404 });
  }

  await prisma.optimizationEvent.create({
    data: { ...data, shop: session.shop },
  });
  return json({ ok: true });
};
