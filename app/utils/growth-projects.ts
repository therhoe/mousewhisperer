/** Browser-safe validation shared by the project form and server. */
export const GROWTH_PROJECT_PAGE_SIZE = 10;
export type GrowthScope = "STORE" | "PAGE";
export type MeasurementMode = "VISITORS" | "DURATION";

export class GrowthProjectError extends Error {
  constructor(message: string, public status = 400, public translationKey = message, public translationValues: Record<string, string | number> = {}) {
    super(message);
    this.name = "GrowthProjectError";
  }
}

export function projectText(value: unknown, maximum: number) {
  if (value == null) return "";
  const text = String(value).replace(/\p{Cc}/gu, "").trim();
  if (text.length > maximum)
    throw new GrowthProjectError(`Use no more than ${maximum} characters.`, 400, "Use no more than {maximum} characters.", { maximum });
  return text;
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  const number = value == null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max)
    throw new GrowthProjectError(`Enter a whole number between ${min} and ${max}.`, 400, "Enter a whole number between {min} and {max}.", { min, max });
  return number;
}

export function parseMeasurementInput(form: FormData) {
  const mode = String(form.get("completionMode") || "VISITORS");
  if (mode !== "VISITORS" && mode !== "DURATION")
    throw new GrowthProjectError("Choose duration or visitor target.");
  const target = form.get("targetVisitors");
  const days = form.get("durationDays");
  if ((mode === "VISITORS" && days != null && days !== "") ||
      (mode === "DURATION" && target != null && target !== ""))
    throw new GrowthProjectError("Choose only one completion method: duration or visitor target.");
  return {
    name: projectText(form.get("measurementName") || form.get("name"), 120) || "Measurement",
    completionMode: mode as MeasurementMode,
    targetVisitors: mode === "VISITORS" ? integer(target, 100, 1, 1_000_000) : null,
    durationDays: mode === "DURATION" ? integer(days, 7, 1, 90) : null,
  };
}

export function parseGrowthProjectInput(form: FormData) {
  const title = projectText(form.get("title"), 120);
  const goal = projectText(form.get("goal"), 1000);
  const scope = String(form.get("scope") || "");
  const journeyTracking = ["true", "on", "1"].includes(String(form.get("journeyTracking") || ""));
  if (!title || !goal) throw new GrowthProjectError("Enter a project title and goal.");
  if (scope !== "STORE" && scope !== "PAGE") throw new GrowthProjectError("Choose store-level or page-level.");
  if (scope === "PAGE" && journeyTracking)
    throw new GrowthProjectError("Journey tracking is available for store-level projects only.");
  const source = projectText(form.get("source"), 160);
  return {
    title,
    goal,
    scope: scope as GrowthScope,
    journeyTracking,
    defaultSource: source === "all" || source === "*" ? null : source || null,
    defaultMedium: projectText(form.get("medium"), 100) || null,
    defaultCampaign: projectText(form.get("campaign"), 240) || null,
  };
}

export function growthRequestKey(form: FormData) {
  const key = String(form.get("requestKey") || "");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(key))
    throw new GrowthProjectError("Refresh the form and try again.");
  return key;
}

export function growthResourcePath(resource: { resourceType: string; productHandle: string }) {
  if (resource.resourceType === "HOMEPAGE") return "/";
  const prefix: Record<string, string> = { PRODUCT: "/products/", COLLECTION: "/collections/", PAGE: "/pages/", BLOG: "/blogs/" };
  if (!prefix[resource.resourceType]) throw new GrowthProjectError("Unsupported storefront page.");
  return prefix[resource.resourceType] + resource.productHandle.split("/").map(encodeURIComponent).join("/");
}

export function growthMeasurementStatus(measurement: {
  snapshot?: { status: string } | null;
  storeSnapshot?: { status: string } | null;
  channelSnapshot?: { status: string } | null;
  customerSnapshot?: { status: string } | null;
}) {
  return (measurement.snapshot || measurement.storeSnapshot || measurement.channelSnapshot || measurement.customerSnapshot)?.status || "COMPLETED";
}

export const PROJECT_LIST_STATUSES = ["ALL", "MEASURING", "IDLE", "COMPLETED"] as const;
export type ProjectListStatus = (typeof PROJECT_LIST_STATUSES)[number];
export type ProjectListScope = "ALL" | "STORE" | "PAGE";
export type ProjectListFilters = {
  status: ProjectListStatus;
  scope: ProjectListScope;
  query: string;
  page: number;
};

/** Reads the Projects filters from the address; anything unknown means "all". */
export function parseProjectListFilters(params: URLSearchParams): ProjectListFilters {
  const status = String(params.get("status") || "ALL").toUpperCase();
  const scope = String(params.get("scope") || "ALL").toUpperCase();
  const page = Math.floor(Number(params.get("page")));
  return {
    status: (PROJECT_LIST_STATUSES as readonly string[]).includes(status)
      ? (status as ProjectListStatus)
      : "ALL",
    scope: scope === "STORE" || scope === "PAGE" ? scope : "ALL",
    query: (params.get("q") || "").replace(/\p{Cc}/gu, "").trim().slice(0, 120),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/**
 * Measuring: the latest measurement's capture is running. Completed: it
 * finished. Idle: nothing started yet, or it is paused. Never overlapping.
 */
export function projectListStatus(
  latest: Parameters<typeof growthMeasurementStatus>[0] | null | undefined,
): Exclude<ProjectListStatus, "ALL"> {
  if (!latest) return "IDLE";
  const status = growthMeasurementStatus(latest);
  if (status === "ACTIVE") return "MEASURING";
  if (status === "COMPLETED") return "COMPLETED";
  return "IDLE";
}

/** Counts every status, keeps the chosen one, clamps the page and slices it. */
export function selectProjectPage<Row extends { status: Exclude<ProjectListStatus, "ALL"> }>(
  rows: Row[],
  status: ProjectListStatus,
  requestedPage: number,
  pageSize = GROWTH_PROJECT_PAGE_SIZE,
) {
  const counts: Record<ProjectListStatus, number> = { ALL: rows.length, MEASURING: 0, IDLE: 0, COMPLETED: 0 };
  for (const row of rows) counts[row.status] += 1;
  const matching = status === "ALL" ? rows : rows.filter((row) => row.status === status);
  const pageCount = Math.max(1, Math.ceil(matching.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(requestedPage) || 1));
  return {
    counts,
    total: matching.length,
    page,
    pageCount,
    rows: matching.slice((page - 1) * pageSize, page * pageSize),
  };
}
