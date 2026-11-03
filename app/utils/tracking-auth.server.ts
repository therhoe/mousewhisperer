import { authenticate } from "../shopify.server";

// The web pixel cannot post through the app proxy, so its commerce events
// arrive unsigned. They only update visits already matched by unguessable
// browser and acquisition IDs; anything that creates tracking data must carry
// Shopify's app proxy signature.
const UNSIGNED_EVENT_TYPES = new Set([
  "add_to_cart",
  "cart_removed",
  "checkout_started",
  "conversion",
  "customer_commerce",
]);

export type TrackingSignatureMode = "log" | "enforce";

// "log" records unsigned requests without rejecting them, so a rollout can be
// checked in the server logs before switching to "enforce".
export function trackingSignatureMode(): TrackingSignatureMode {
  return process.env.TRACKING_SIGNATURE_MODE === "enforce" ? "enforce" : "log";
}

export async function verifyTrackingRequest(
  request: Request,
  eventType: unknown,
  {
    mode = trackingSignatureMode(),
    warn = console.warn,
  }: {
    mode?: TrackingSignatureMode;
    warn?: (message: string, detail: Record<string, string>) => void;
  } = {},
): Promise<{ allowed: boolean; signed: boolean }> {
  const hasSignature = new URL(request.url).searchParams.has("signature");
  let signed = false;
  if (hasSignature) {
    try {
      await authenticate.public.appProxy(request);
      signed = true;
    } catch {
      signed = false;
    }
  }
  const needsSignature = !(
    typeof eventType === "string" && UNSIGNED_EVENT_TYPES.has(eventType)
  );
  if (signed || !needsSignature) return { allowed: true, signed };
  warn("[MW] Tracking request without a valid app proxy signature", {
    mode,
    eventType: typeof eventType === "string" ? eventType : "page_view",
    reason: hasSignature ? "invalid" : "missing",
  });
  return { allowed: mode !== "enforce", signed };
}
