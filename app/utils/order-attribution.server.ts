import type { Prisma, PrismaClient } from "@prisma/client";

// The checkout pixel and the orders/paid webhook (plus its retries) both report every
// paid order. The numeric Shopify order id is what they share, so each capture converts
// at most one row per order. The (capture, orderId) unique indexes back this up when
// both deliveries race.

/**
 * The numeric Shopify order id, from a webhook `id`, its `admin_graphql_api_id`, or the
 * pixel's `checkout.order.id` (a GID string). Anything else is no id.
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

export function orderAmount(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(amount) ? amount : null;
}

/**
 * A conversion write that lost to another delivery of the same order: the row was
 * converted meanwhile (P2025 on a `converted: false` update) or the capture already
 * holds this order (P2002 on the orderId unique index).
 */
export function isLostOrderWrite(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "P2002" || code === "P2025";
}

type PricedRow = { orderValue: number | null; currency: string | null };

/**
 * The orders/paid webhook is HMAC-verified and carries the shop-currency total; the
 * pixel's amount is client-reported (and in the presentment currency). So on rows that
 * hold its order, the webhook's amount and currency always replace what is there. Null
 * when the webhook has no amount, or the row already holds exactly its values.
 */
export function webhookAmount(
  row: PricedRow,
  amount: number | null,
  currency: string | null,
): { orderValue: number; currency: string } | null {
  if (amount == null || !currency) return null;
  if (row.orderValue === amount && row.currency === currency) return null;
  return { orderValue: amount, currency };
}

type VisitClient = Pick<PrismaClient, "visit" | "snapshotStatsCache">;

/**
 * Converts one product capture's visit for an order. Captures in `scope` that already
 * hold the order are passed to `findVisit` to leave out; it picks the visit with the
 * caller's tiers among the rest.
 */
export async function attributeProductVisitOrder(
  db: VisitClient,
  input: {
    orderId: string | null;
    scope: Prisma.VisitWhereInput;
    findVisit: (
      attributedSnapshotIds: string[],
    ) => Promise<{ id: string; snapshotId: string } | null>;
    convertedAt: Date;
    orderValue: number | null;
    currency: string | null;
    // Only the webhook passes true: its HMAC-verified shop-currency amount replaces the pixel's.
    authoritativeAmount?: boolean;
  },
): Promise<
  | { outcome: "converted"; visitId: string }
  | { outcome: "already"; visitId: string | null }
  | { outcome: "none" }
> {
  const attributed = input.orderId
    ? await db.visit.findMany({
        where: { ...input.scope, orderId: input.orderId },
        select: { id: true, snapshotId: true },
      })
    : [];

  let result:
    | { outcome: "converted"; visitId: string }
    | { outcome: "already"; visitId: string | null }
    | { outcome: "none" } = attributed.length
    ? { outcome: "already", visitId: attributed[0].id }
    : { outcome: "none" };
  const visit = await input.findVisit(attributed.map((row) => row.snapshotId));
  if (visit) {
    try {
      await db.visit.update({
        where: { id: visit.id, converted: false },
        data: {
          converted: true,
          convertedAt: input.convertedAt,
          ...(input.orderValue != null ? { orderValue: input.orderValue } : {}),
          ...(input.currency ? { currency: input.currency } : {}),
          ...(input.orderId ? { orderId: input.orderId } : {}),
        },
      });
      await clearSnapshotStats(db, visit.snapshotId);
      result = { outcome: "converted", visitId: visit.id };
    } catch (error) {
      // Another delivery of this order converted the row or the capture first.
      if (!isLostOrderWrite(error)) throw error;
      result = { outcome: "already", visitId: null };
    }
  }

  // Last, so it also covers a pixel row committed while this webhook was choosing.
  if (input.authoritativeAmount && input.orderId) {
    const rows = await db.visit.findMany({
      where: { ...input.scope, orderId: input.orderId },
      select: { id: true, snapshotId: true, orderValue: true, currency: true },
    });
    for (const row of rows) {
      const fill = webhookAmount(row, input.orderValue, input.currency);
      if (!fill) continue;
      await db.visit.update({ where: { id: row.id }, data: fill });
      await clearSnapshotStats(db, row.snapshotId);
    }
  }
  return result;
}

async function clearSnapshotStats(db: VisitClient, snapshotId: string) {
  await db.snapshotStatsCache
    .deleteMany({ where: { snapshotId } })
    .catch(() => {});
}
