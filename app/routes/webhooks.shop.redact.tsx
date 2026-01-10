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
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log(`Deleting all data for shop: ${shop}`);

  try {
    // Delete all sessions for this shop
    const deletedSessions = await db.session.deleteMany({
      where: { shop },
    });
    console.log(`Deleted ${deletedSessions.count} sessions for ${shop}`);

    // Delete all projects for this shop (cascades to Snapshots and Visits due to onDelete: Cascade)
    const deletedProjects = await db.project.deleteMany({
      where: { shop },
    });
    console.log(`Deleted ${deletedProjects.count} projects for ${shop}`);

    console.log(`Shop redaction complete for ${shop}`);
  } catch (error) {
    console.error(`Error during shop redaction for ${shop}:`, error);
    // Still return 200 to acknowledge receipt - Shopify will retry if we return an error
    // but we've already attempted deletion
  }

  return new Response(null, { status: 200 });
};
