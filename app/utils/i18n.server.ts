import { createHash } from "node:crypto";
import { createCookie } from "@remix-run/node";
import { normalizeLocale, preferredLocale, type AppLocale } from "./i18n-core";

export function localeCookie(shop: string) {
  return createCookie(
    `snapshot_locale_${createHash("sha256").update(shop.toLowerCase()).digest("hex").slice(0, 16)}`,
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    },
  );
}

export async function resolveRequestLocale(
  request: Request,
  shop: string,
): Promise<AppLocale> {
  let saved: unknown = null;
  try {
    saved = await localeCookie(shop).parse(request.headers.get("Cookie"));
  } catch {
    /* Ignore malformed preferences. */
  }
  return (
    normalizeLocale(saved) ||
    normalizeLocale(new URL(request.url).searchParams.get("locale")) ||
    preferredLocale(request.headers.get("Accept-Language"))
  );
}
