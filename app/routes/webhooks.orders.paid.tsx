import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { payload, shop, topic } = await authenticate.webhook(request);

    console.log(`[MW Webhook] Received ${topic} for ${shop}`);

    const order = payload as any;
    const lineItems = order.line_items || [];
    const orderCreatedAt = order.created_at ? new Date(order.created_at) : new Date();
    const orderTotal = order.total_price ? parseFloat(order.total_price) : null;
    const orderCurrency = order.currency || null;

    if (lineItems.length === 0) {
      console.log("[MW Webhook] Order has no line items, skipping");
      return new Response();
    }

    // Extract unique product IDs from line items
    const productIds = new Set<string>();
    for (const item of lineItems) {
      if (item.product_id) {
        // Convert numeric Shopify ID to GID format used in our DB
        const gid = `gid://shopify/Product/${item.product_id}`;
        productIds.add(gid);
      }
    }

    console.log(`[MW Webhook] Order #${order.order_number || order.name} — ${productIds.size} unique products, total: ${orderTotal} ${orderCurrency}`);

    if (productIds.size === 0) {
      console.log("[MW Webhook] No product IDs found in line items, skipping");
      return new Response();
    }

    // Calculate per-product revenue share (split order total evenly across tracked products)
    const perProductRevenue = orderTotal && productIds.size > 0 ? orderTotal / productIds.size : null;

    let conversionsTracked = 0;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    for (const productGid of productIds) {
      // Find project tracking this product with an active/recently completed snapshot
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
        // Product not being tracked — this is normal, skip silently
        continue;
      }

      const snapshot = project.snapshots[0];

      // Only attribute conversion to a visit that actually added to cart
      // (no fallback to random visits — a missed conversion beats a false one)
      const visit = await prisma.visit.findFirst({
        where: {
          snapshotId: snapshot.id,
          addedToCart: true,
          converted: false,
        },
        orderBy: { startedAt: "desc" },
      });

      if (visit) {
        // Skip if already converted (dedup pixel + webhook)
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
        console.log(`[MW Webhook] Converted visit ${visit.id} for product ${productGid} (snapshot: ${snapshot.id}, revenue: ${perProductRevenue})`);
      } else {
        console.log(`[MW Webhook] No unconverted visit found for product ${productGid} in snapshot ${snapshot.id}`);
      }
    }

    console.log(`[MW Webhook] Order processing complete — ${conversionsTracked} conversions tracked`);

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
