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
