export type EmbeddedFilterContext = {
  shop: string;
  host: string;
  embedded: "1";
};

/**
 * A GET submission replaces the current query string. Keep the public embedded
 * context so Shopify can refresh authentication after an idle tab resumes.
 * Never copy id_token or other transient signed launch parameters into a form.
 * This is navigation context only; loaders must still authenticate every request.
 */
export function embeddedFilterParams(
  current: URLSearchParams,
  filters: Record<string, string> = {},
  authenticatedContext?: EmbeddedFilterContext | null,
): URLSearchParams {
  const next = new URLSearchParams(filters);
  for (const key of ["shop", "host", "embedded", "locale"]) {
    const value = current.get(key);
    if (value !== null) next.set(key, value);
  }
  // Internal links can already have removed all launch parameters. The parent
  // loader survives those navigations and supplies context from its session,
  // rather than guessing a tenant from the URL or reusing a launch token.
  if (authenticatedContext) {
    next.set("shop", authenticatedContext.shop);
    next.set("host", authenticatedContext.host);
    next.set("embedded", authenticatedContext.embedded);
  }
  return next;
}
