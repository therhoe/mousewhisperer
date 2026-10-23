import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Shop redaction webhook handler
 *
 * This webhook is triggered 48 hours after a merchant uninstalls the app,
 * requesting that all shop data be permanently deleted.
 *
 * We must delete:
 * - All Sessions for this shop
 * - All Projects for this shop (cascades to Snapshots and Visits)
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  let shop: string;

  try {
    const authResult = await authenticate.webhook(request);
    shop = authResult.shop;
    console.log(`Received ${authResult.topic} webhook for ${shop}`);
  } catch (error) {
    // Return 401 for HMAC verification failures (required by Shopify)
    if (error instanceof Response) {
      return new Response("Unauthorized", { status: 401 });
    }
    throw error;
  }

  console.log(`Deleting all data for shop: ${shop}`);

  try {
    // Project links deliberately restrict individual legacy report deletion.
    // Redaction removes the merchant's containers first, then every capture in
    // one transaction; no partially redacted tenant or orphaned projects remain.
    await db.$transaction(async (tx) => {
      await tx.growthProject.deleteMany({ where: { shop } });
      await tx.abTest.deleteMany({ where: { shop } });
      await tx.storeSnapshot.deleteMany({ where: { shop } });
      await tx.channelSnapshot.deleteMany({ where: { shop } });
      await tx.customerSnapshot.deleteMany({ where: { shop } });
      await tx.project.deleteMany({ where: { shop } });
      await tx.optimizationEvent.deleteMany({ where: { shop } });
      await tx.notification.deleteMany({ where: { shop } });
      await tx.shopSettings.deleteMany({ where: { shop } });
      await tx.shopBilling.deleteMany({ where: { shop } });
      await tx.insightProfile.deleteMany({ where: { shop } });
      await tx.session.deleteMany({ where: { shop } });
    }, { timeout: 30_000 });

    console.log(`Shop redaction complete for ${shop}`);
  } catch (error) {
    console.error(`Error during shop redaction for ${shop}:`, error);
    return new Response("Shop data deletion failed", { status: 500 });
  }

  return new Response(null, { status: 200 });
};
