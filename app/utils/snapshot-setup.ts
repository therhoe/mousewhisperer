import {
  journeyText,
  normalizeJourneySource,
  validateJourneyDestination,
} from "./customer-journey";

export type TrackerState = "active" | "missing" | "unknown";
// Published block UUID; Shopify's theme settings do not use the local CLI uid.
export const TRACKER_EXTENSION_ID = "019b7bbb-e14f-701e-9c00-6be4ba8c522a";

export function trackerEditorUrl(shop: string, apiKey: string) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop) || !apiKey)
    return null;
  const url = new URL(`https://${shop}/admin/themes/current/editor`);
  url.searchParams.set("context", "apps");
  url.searchParams.set("activateAppId", `${apiKey}/tracker`);
  return url.toString();
}

// App Bridge's older bundled typings do not yet describe theme activations.
export function trackerActivationState(extensions: unknown): TrackerState {
  if (!Array.isArray(extensions)) return "unknown";
  for (const extension of extensions) {
    if (extension.type !== "theme_app_extension") continue;
    const block = extension.activations?.find(
      (item: any) =>
        item.handle === "tracker" &&
        ["head", "body", "compliance_head"].includes(item.target),
    );
    if (block?.status === "active") return "active";
    if (["available", "unavailable"].includes(block?.status)) return "missing";
  }
  return "unknown";
}

export function trackerSettingsState(content: string): TrackerState {
  try {
    // Shopify theme settings can begin with a generated comment header.
    const settings = JSON.parse(content.replace(/^\s*\/\*[\s\S]*?\*\//, ""));
    if (!settings.current || typeof settings.current !== "object")
      return "unknown";
    const blocks = Object.values(settings.current.blocks || {}) as any[];
    return blocks.some(
      (block) =>
        typeof block.type === "string" &&
        block.type.endsWith(`/blocks/tracker/${TRACKER_EXTENSION_ID}`) &&
        block.disabled === false,
    )
      ? "active"
      : "missing";
  } catch {
    return "unknown";
  }
}

export function setupTarget(value: unknown, minimum = 25) {
  const target = Number(value);
  if (!Number.isInteger(target) || target < minimum || target > 1_000_000)
    throw new Error(
      `Enter a whole-number target between ${minimum} and 1,000,000.`,
    );
  return target;
}

export function setupCustomerLink(value: string) {
  const url = validateJourneyDestination(value);
  const p = url.searchParams;
  const fields = {
    source: p.get("utm_source") || "",
    medium: p.get("utm_medium"),
    campaign: p.get("utm_id") || p.get("campaign_id") || p.get("utm_campaign"),
    adId: p.get("ad_id") || p.get("utm_content"),
  };
  if (
    !fields.source ||
    Object.values(fields).some(
      (v) =>
        v && (!journeyText(v, 240) || v.length > 160 || /\{\{|\}\}/.test(v)),
    )
  )
    throw new Error(
      "Use a final campaign link with utm_source and actual tag values, without personal data.",
    );
  // Store only the destination and allowlisted attribution values, never arbitrary URL parameters.
  if (/\/(?:account|accounts|checkouts|orders)(?:\/|$)/i.test(url.pathname))
    throw new Error("Use a public storefront landing page.");
  url.search = "";
  url.hash = "";
  return {
    ...fields,
    source: normalizeJourneySource(fields.source),
    medium: fields.medium?.toLowerCase() || null,
    destinationUrl: url.toString(),
  };
}
