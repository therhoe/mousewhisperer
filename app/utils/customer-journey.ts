// Shared, browser-safe rules. Only allowlisted campaign fields and paths are stored.
export const JOURNEY_PAGE_SIZE = 10;
export const JOURNEY_EVENT_PAGE_SIZE = 30;
export const JOURNEY_TIMEOUT = 30 * 60_000;
export const JOURNEY_EVENT_LIMIT = 5000;

export type JourneyFilter = {
  source: string;
  medium?: string | null;
  campaign?: string | null;
  adId?: string | null;
};

export function journeyText(value: unknown, max = 160): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/\p{Cc}/gu, "")
    .trim()
    .slice(0, max);
  // Campaign and UI labels must not become an accidental email collector.
  return text && !/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text) ? text : null;
}

export function normalizeJourneySource(value: unknown) {
  const source = journeyText(value)?.toLowerCase() || "";
  return (
    ({ fb: "facebook", ig: "instagram" } as Record<string, string>)[source] ||
    source
  );
}

export function journeyPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, "https://store.invalid");
    if (!["https:", "http:"].includes(url.protocol)) return null;
    // Exclude account/checkout token paths and all query strings/fragments.
    if (/\/(?:account|accounts|checkouts|orders)(?:\/|$)/i.test(url.pathname))
      return "/private-page";
    return journeyText(url.pathname, 600);
  } catch {
    return null;
  }
}

export function matchesJourney(filter: JourneyFilter, arrival: JourneyFilter) {
  return (
    normalizeJourneySource(filter.source) ===
      normalizeJourneySource(arrival.source) &&
    (!filter.medium ||
      filter.medium.toLowerCase() === arrival.medium?.toLowerCase()) &&
    (!filter.campaign || filter.campaign === arrival.campaign) &&
    (!filter.adId || filter.adId === arrival.adId)
  );
}

export function validateJourneyDestination(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Use an HTTPS storefront URL.");
  return url;
}

export function buildJourneyLink(destination: string, filter: JourneyFilter) {
  const url = validateJourneyDestination(destination);
  url.searchParams.set("utm_source", filter.source);
  if (filter.medium) url.searchParams.set("utm_medium", filter.medium);
  if (filter.campaign) url.searchParams.set("utm_campaign", filter.campaign);
  // A separate ad_id preserves existing utm_content used by other analytics tools.
  if (filter.adId) url.searchParams.set("ad_id", filter.adId);
  return url.toString();
}

export function inspectJourneyLink(value: string, filter: JourneyFilter) {
  try {
    const url = validateJourneyDestination(value);
    const p = url.searchParams;
    const arrival = {
      source: p.get("utm_source") || "",
      medium: p.get("utm_medium"),
      campaign:
        p.get("utm_id") || p.get("campaign_id") || p.get("utm_campaign"),
      adId: p.get("ad_id") || p.get("utm_content"),
    };
    if ([...p.values()].some((item) => /\{\{.*\}\}/.test(item)))
      return {
        ok: false,
        message:
          "This link contains ad-platform placeholders. Test the final landing URL from an actual ad click.",
      };
    // A human-readable campaign may also be selected when an ID is present.
    const matched =
      matchesJourney(filter, arrival) ||
      matchesJourney(filter, { ...arrival, campaign: p.get("utm_campaign") });
    return {
      ok: matched,
      message: matched
        ? "The link matches this snapshot. This checks the tags only; a consented storefront visit confirms collection."
        : "The link does not match the selected source, medium, campaign, or ad. Check its tags.",
    };
  } catch {
    return { ok: false, message: "Enter a valid HTTPS storefront URL." };
  }
}

export function normalizeOrderId(value: unknown) {
  const raw =
    typeof value === "number" ? String(value) : journeyText(value, 100);
  return raw?.match(/^(?:gid:\/\/shopify\/Order\/)?(\d+)$/)?.[1] || null;
}

const EVENT_TYPES = new Set([
  "page_view",
  "click",
  "search",
  "filter_change",
  "page_hidden",
]);
export function readJourneyEvents(value: unknown, acquiredAt: Date, now: Date) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((item) => {
    if (!item || typeof item !== "object" || !EVENT_TYPES.has(item.type))
      return [];
    const eventKey = journeyText(item.id, 160);
    const occurredAt = new Date(Number(item.at));
    if (
      !eventKey ||
      !/^[a-zA-Z0-9_:.-]+$/.test(eventKey) ||
      !Number.isFinite(occurredAt.getTime()) ||
      occurredAt < acquiredAt ||
      occurredAt.getTime() > now.getTime() + 60_000
    )
      return [];
    return [
      {
        eventKey,
        type: String(item.type),
        occurredAt,
        pagePath: journeyPath(item.path),
        label: journeyText(item.label, 120),
        targetPath: journeyPath(item.target),
      },
    ];
  });
}
