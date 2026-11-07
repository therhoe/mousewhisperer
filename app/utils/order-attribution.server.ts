import type { Prisma, PrismaClient } from "@prisma/client";
import { orderAttributionId } from "./order-id";

// The checkout pixel and the orders/paid webhook (plus its retries) both report every
// paid order. The numeric Shopify order id is what they share, so each capture converts
// at most one row per order. The (capture, orderId) unique indexes back this up when
// both deliveries race.

export { orderAttributionId };

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

type OrderLinkClient = Pick<
  PrismaClient,
  "visit" | "storeSnapshotVisit" | "abTestVisit" | "abTestAssignment"
>;

// Rows of one shop that link a measurement to these orders. An order id can be tied
// to a customer, so GDPR requests cover these rows too.
function orderLinkWhere(shop: string, orderIds: string[]) {
  const orderId = { in: orderIds };
  return {
    visit: { orderId, snapshot: { project: { shop } } },
    storeSnapshotVisit: { orderId, storeSnapshot: { shop } },
    abTestVisit: { orderId, shop },
    abTestAssignment: { orderId, shop },
  };
}

/** How many measurement rows of `shop` hold one of these orders (customers/data_request). */
export async function countOrderLinkedRows(
  db: OrderLinkClient,
  shop: string,
  orderIds: string[],
) {
  if (!orderIds.length) return 0;
  const where = orderLinkWhere(shop, orderIds);
  const counts = await Promise.all([
    db.visit.count({ where: where.visit }),
    db.storeSnapshotVisit.count({ where: where.storeSnapshotVisit }),
    db.abTestVisit.count({ where: where.abTestVisit }),
    db.abTestAssignment.count({ where: where.abTestAssignment }),
  ]);
  return counts.reduce((sum, count) => sum + count, 0);
}

/**
 * Removes the order link from `shop`'s measurement rows (customers/redact), and on
 * visit rows also the fields that can identify a person (IP address, city, region,
 * user agent). Country, device type, the conversion and its amount stay, so reports
 * keep their totals. Assignments hold none of those fields.
 */
export async function redactOrderLinks(
  db: OrderLinkClient,
  shop: string,
  orderIds: string[],
) {
  if (!orderIds.length) return 0;
  const where = orderLinkWhere(shop, orderIds);
  const unlink = { orderId: null };
  const visitData = {
    ...unlink,
    ipAddress: null,
    city: null,
    region: null,
    userAgent: null,
  };
  const results = await Promise.all([
    db.visit.updateMany({ where: where.visit, data: visitData }),
    db.storeSnapshotVisit.updateMany({ where: where.storeSnapshotVisit, data: visitData }),
    db.abTestVisit.updateMany({ where: where.abTestVisit, data: visitData }),
    db.abTestAssignment.updateMany({ where: where.abTestAssignment, data: unlink }),
  ]);
  return results.reduce((sum, result) => sum + result.count, 0);
}
