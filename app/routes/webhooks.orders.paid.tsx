import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { attributeAbTestConversion } from "../utils/ab-tests.server";
import { attributeStoreSnapshotOrder } from "../utils/store-snapshot.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { payload, shop, topic } = await authenticate.webhook(request);

    console.log(`[MW Webhook] Received ${topic} for ${shop}`);

    const order = payload as any;
    const lineItems = order.line_items || [];
    const orderCreatedAt = order.created_at ? new Date(order.created_at) : new Date();
    const orderTotal = order.total_price ? parseFloat(order.total_price) : null;
    const orderCurrency = order.currency || null;

    const getAttributeValue = (attributes: any[] | undefined, key: string) => {
      if (!Array.isArray(attributes)) return null;
      return attributes.find((attribute: any) => {
        return attribute?.name === key || attribute?.key === key;
      })?.value || null;
    };

    // Extract session ID from cart/note attributes (written by tracker.js)
    const sessionId =
      getAttributeValue(order.note_attributes, '_mw_sid') ||
      getAttributeValue(order.custom_attributes, '_mw_sid');

    console.log(`[MW Webhook] Order #${order.order_number || order.name} — session: ${sessionId || "none"}, total: ${orderTotal} ${orderCurrency}`);

    let storeSnapshotConversionsTracked = 0;
    let abTestConversionsTracked = 0;
    if (sessionId) {
      storeSnapshotConversionsTracked = await attributeStoreSnapshotOrder({
        shop,
        sessionId,
        timestamp: orderCreatedAt,
        totalPrice: orderTotal,
        currency: orderCurrency,
      });
      abTestConversionsTracked = await attributeAbTestConversion({
        shop,
        sessionId,
        timestamp: orderCreatedAt,
        totalPrice: orderTotal,
        currency: orderCurrency,
      });
    }

    if (lineItems.length === 0) {
      console.log(
        `[MW Webhook] Order has no line items, focused snapshot tracking skipped; store snapshot conversions: ${storeSnapshotConversionsTracked}; A/B conversions: ${abTestConversionsTracked}`,
      );
      return new Response();
    }

    // Extract unique product IDs from line items
    const productIds = new Set<string>();
    for (const item of lineItems) {
      if (item.product_id) {
        const gid = `gid://shopify/Product/${item.product_id}`;
        productIds.add(gid);
      }
    }

    if (productIds.size === 0) {
      console.log(
        `[MW Webhook] No product IDs found in line items, focused snapshot tracking skipped; store snapshot conversions: ${storeSnapshotConversionsTracked}; A/B conversions: ${abTestConversionsTracked}`,
      );
      return new Response();
    }

    // Calculate per-product revenue share
    const perProductRevenue = orderTotal && productIds.size > 0 ? orderTotal / productIds.size : null;

    let conversionsTracked = 0;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    for (const productGid of productIds) {
      const project = await prisma.project.findFirst({
        where: {
          shop,
          productId: productGid,
          snapshots: {
            some: {
              status: { in: ["ACTIVE", "COMPLETED"] },
              createdAt: { gte: thirtyDaysAgo },
            },
          },
        },
        include: {
          snapshots: {
            where: {
              status: { in: ["ACTIVE", "COMPLETED"] },
              createdAt: { gte: thirtyDaysAgo },
            },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      if (!project || project.snapshots.length === 0) {
        continue;
      }

      const snapshot = project.snapshots[0];
      let visit = null;
      let matchTier = "";

      // Tier 1: Exact session match with ATC (most accurate)
      if (sessionId) {
        visit = await prisma.visit.findFirst({
          where: {
            snapshotId: snapshot.id,
            sessionId,
            addedToCart: true,
            converted: false,
          },
          orderBy: { startedAt: "desc" },
        });
        if (visit) matchTier = "session+ATC";
      }

      // Tier 2: Exact session match without ATC (Buy Now / direct checkout)
      if (!visit && sessionId) {
        visit = await prisma.visit.findFirst({
          where: {
            snapshotId: snapshot.id,
            sessionId,
            converted: false,
          },
          orderBy: { startedAt: "desc" },
        });
        if (visit) matchTier = "session";
      }

      // Tier 3: No session ID available — match by ATC only (best effort)
      if (!visit) {
        visit = await prisma.visit.findFirst({
          where: {
            snapshotId: snapshot.id,
            addedToCart: true,
            converted: false,
          },
          orderBy: { startedAt: "desc" },
        });
        if (visit) matchTier = "ATC-only";
      }

      // No fallback beyond this — a missed conversion beats a false one

      if (visit) {
        if (visit.converted) {
          console.log(`[MW Webhook] Visit ${visit.id} already converted, skipping`);
          continue;
        }

        await prisma.visit.update({
          where: { id: visit.id },
          data: {
            converted: true,
            convertedAt: orderCreatedAt,
            ...(perProductRevenue ? { orderValue: perProductRevenue } : {}),
            ...(orderCurrency ? { currency: orderCurrency } : {}),
          },
        });
        conversionsTracked++;
        console.log(`[MW Webhook] Converted visit ${visit.id} via ${matchTier} (product: ${productGid}, revenue: ${perProductRevenue})`);
      } else {
        console.log(`[MW Webhook] No match for product ${productGid} in snapshot ${snapshot.id} (session: ${sessionId || "none"})`);
      }
    }

    console.log(
      `[MW Webhook] Order processing complete — focused conversions: ${conversionsTracked}, store snapshot conversions: ${storeSnapshotConversionsTracked}, A/B conversions: ${abTestConversionsTracked}`,
    );

    return new Response();
  } catch (error) {
    // Return 401 for HMAC verification failures (required by Shopify)
    if (error instanceof Response) {
      return new Response("Unauthorized", { status: 401 });
    }
    console.error("[MW Webhook] Error processing orders/paid:", error);
    throw error;
  }
};
