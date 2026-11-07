/**
 * The numeric Shopify order id, the one key every writer shares for an order: the
 * checkout pixel's `checkout.order.id` (the bare numeric string in production, or a
 * GID), the orders/paid webhook's `id` / `admin_graphql_api_id`, and the ids in GDPR
 * webhooks. Anything else is no id.
 */
export function orderAttributionId(value: unknown): string | null {
  const raw =
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  return (
    raw.match(/^(?:gid:\/\/shopify\/(?:Order|OrderIdentity)\/)?(\d{1,30})$/)?.[1] ??
    null
  );
}
