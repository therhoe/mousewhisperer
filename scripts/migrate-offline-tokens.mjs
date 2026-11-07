// One-time upgrade of every stored non-expiring offline access token to an expiring
// one (Shopify rejects non-expiring tokens for public apps from 2027-04-01). Stores
// whose merchants open the app are upgraded there already (ensureExpiringOfflineToken);
// this covers stores that only use tracking and webhooks.
//
// Usage (against the database in DATABASE_URL; the local .env is PRODUCTION):
//   node --env-file=.env scripts/migrate-offline-tokens.mjs --dry-run
//   node --env-file=.env scripts/migrate-offline-tokens.mjs
//
// Each upgrade invalidates the old token at once. For seven days Shopify returns
// the same expiring token for the old one again, so re-running after a failed save
// recovers it. Prints shop domains and outcomes only, never tokens.
import "@shopify/shopify-api/adapters/node";
import { LogSeverity, shopifyApi } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { PrismaClient } from "@prisma/client";

const dryRun = process.argv.includes("--dry-run");
for (const name of ["DATABASE_URL", "SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL"]) {
  if (!process.env[name]) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
}

const prisma = new PrismaClient();
const storage = new PrismaSessionStorage(prisma);
const api = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  apiVersion: "2026-01",
  hostName: new URL(process.env.SHOPIFY_APP_URL).host,
  isEmbeddedApp: true,
  logger: { level: LogSeverity.Error },
});

try {
  const rows = await prisma.session.findMany({
    where: { isOnline: false, expires: null },
    select: { id: true, shop: true },
    orderBy: { shop: "asc" },
  });
  console.log(`${rows.length} store(s) on a non-expiring offline token${dryRun ? " (dry run)" : ""}`);
  const outcome = { upgraded: 0, failed: 0 };
  for (const row of rows) {
    if (dryRun) {
      console.log(`- ${row.shop}: would upgrade`);
      continue;
    }
    // Load through the session storage so the stored shape matches the app's.
    const session = await storage.loadSession(row.id);
    if (!session?.accessToken || session.expires) {
      console.log(`- ${row.shop}: skipped (already changed)`);
      continue;
    }
    try {
      const { session: expiring } = await api.auth.migrateToExpiringToken({
        shop: session.shop,
        nonExpiringOfflineAccessToken: session.accessToken,
      });
      await storage.storeSession(expiring);
      outcome.upgraded += 1;
      console.log(`- ${row.shop}: upgraded (expires ${expiring.expires?.toISOString() ?? "?"})`);
    } catch (error) {
      outcome.failed += 1;
      const status = error?.response?.code ?? "no response";
      // 401/403 usually means the store uninstalled or the token was already replaced.
      console.log(`- ${row.shop}: failed (${error?.name ?? "Error"}, status ${status})`);
    }
  }
  if (!dryRun) console.log(`Done: ${outcome.upgraded} upgraded, ${outcome.failed} failed`);
  process.exitCode = outcome.failed ? 1 : 0;
} finally {
  await prisma.$disconnect();
}
