import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

// React Router rejects form posts whose Origin header doesn't match the request
// URL. The Shopify CLI tunnel ends TLS before the dev server, so the browser's
// Origin is https://<host> while React Router sees http://<host>. Allowing the
// app's own host (and only that) keeps the CSRF check for every other origin.
function appHost() {
  try {
    return new URL(process.env.SHOPIFY_APP_URL || process.env.HOST || "").host;
  } catch {
    return "";
  }
}

const host = appHost();

export default {
  ssr: true,
  presets: [vercelPreset()],
  allowedActionOrigins: host ? [host] : [],
} satisfies Config;
