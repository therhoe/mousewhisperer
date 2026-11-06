// Pure navigation rules for the redesigned screens (spec sections 4.3–4.4).
// No React or browser globals here, so node --test can call every function.

export type BackTarget = { kind: "pop" } | { kind: "replace"; to: string };

/**
 * React Router keeps each in-app history entry's position in
 * `history.state.idx`: 0 for the entry the app opened on, +1 for every push,
 * unchanged on replace. A positive index means an earlier in-app entry exists,
 * so Back pops to it. Otherwise (a bookmark, a fresh link, a reload of the
 * first entry) Back replaces this entry with the screen's parent.
 */
export function backTarget(historyIndex: unknown, parentPath: string): BackTarget {
  return typeof historyIndex === "number" &&
    Number.isInteger(historyIndex) &&
    historyIndex > 0
    ? { kind: "pop" }
    : { kind: "replace", to: parentPath };
}

// Signed launch values must never be replayed.
const TRANSIENT_PARAMS = ["id_token", "hmac", "timestamp", "session"];
// A returnTo never nests.
const DROPPED_PARAMS = [...TRANSIENT_PARAMS, "returnTo"];

/** An in-app path (`/app` or below) with its query, or null for anything else. */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 2000) return null;
  if (!value.startsWith("/app")) return null;
  // URL parsing would quietly drop newlines and turn \ into /, so refuse both.
  const forbidden = (char: string) => {
    const code = char.charCodeAt(0);
    return char === "\\" || code < 0x20 || code === 0x7f;
  };
  if (Array.from(value).some(forbidden)) return null;
  let url: URL;
  try {
    url = new URL(value, "https://snapshot.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://snapshot.invalid") return null;
  if (url.pathname !== "/app" && !url.pathname.startsWith("/app/")) return null;
  for (const key of DROPPED_PARAMS) url.searchParams.delete(key);
  const search = url.searchParams.toString();
  return search ? `${url.pathname}?${search}` : url.pathname;
}

/** Link to Plans that brings the merchant back to `from` after upgrading (rule 5). */
export function plansHref(from?: string | null): string {
  const returnTo = safeReturnTo(from);
  if (!returnTo || returnTo === "/app/plans" || returnTo.startsWith("/app/plans?"))
    return "/app/plans";
  return `/app/plans?returnTo=${encodeURIComponent(returnTo)}`;
}

/**
 * Search params after a list filter or page change. A filter change resets the
 * page, an empty value removes its key, and signed launch values are dropped.
 * Callers apply it with `{ replace: true }`: filters never add Back steps.
 */
export function listParams(
  current: URLSearchParams,
  changes: Record<string, string | null>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const key of TRANSIENT_PARAMS) next.delete(key);
  for (const [key, value] of Object.entries(changes)) {
    if (value == null || value === "") next.delete(key);
    else next.set(key, value);
  }
  if (!("page" in changes)) next.delete("page");
  return next;
}

export const BACK_LINK_SELECTOR = "[data-snapshot-back]";

type NavigateEventLike = {
  target: unknown;
  stopImmediatePropagation(): void;
  preventDefault(): void;
};
type LinkLike = { getAttribute(name: string): string | null };

/**
 * Polaris reports a click on a Back link (in the page or in the admin title
 * bar) as a `shopify:navigate` event on that link. For Back links this stops
 * the event, so the AppProvider does not push the parent as a new entry, and
 * returns what Back should do. Every other navigation returns null untouched.
 */
export function interceptBackNavigation(
  event: NavigateEventLike,
  historyIndex: unknown,
): BackTarget | null {
  const target = event.target as { closest?: (selector: string) => LinkLike | null } | null;
  const link = typeof target?.closest === "function" ? target.closest(BACK_LINK_SELECTOR) : null;
  const parent = safeReturnTo(link?.getAttribute("href"));
  if (!parent) return null;
  event.stopImmediatePropagation();
  event.preventDefault();
  return backTarget(historyIndex, parent);
}
