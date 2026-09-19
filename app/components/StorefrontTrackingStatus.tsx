import { Badge, Button, InlineStack, Text } from "@shopify/polaris";
import type { StorefrontTrackerStatus } from "../utils/storefront-tracker-status.server";
import { useBackgroundJson } from "../utils/background-json";

function isTrackingPayload(
  value: unknown,
): value is { trackerStatus: StorefrontTrackerStatus } {
  if (!value || typeof value !== "object") return false;
  const data = value as { trackerStatus?: StorefrontTrackerStatus };
  return Boolean(
    data.trackerStatus &&
    ["active", "missing", "unknown"].includes(data.trackerStatus.status) &&
    typeof data.trackerStatus.storefrontUrl === "string" &&
    typeof data.trackerStatus.checkedAt === "string" &&
    typeof data.trackerStatus.message === "string",
  );
}

// Keep the existing small Store Snapshot status row, without blocking the page
// while Shopify and the live storefront respond. Channel pages do not use it.
export function StorefrontTrackingStatus() {
  const { data, loading, error, reload } = useBackgroundJson({
    path: "/api/storefront-tracker-status",
    isData: isTrackingPayload,
    errorMessage: "Tracking status is temporarily unavailable.",
    delayMs: 1000,
  });

  const trackerStatus = data?.trackerStatus;
  const needsRetry = Boolean(error || trackerStatus?.status === "unknown");
  let host = "";
  if (trackerStatus) {
    try {
      host = new URL(trackerStatus.storefrontUrl).hostname;
    } catch {
      host = trackerStatus.storefrontUrl;
    }
  }
  return (
    <InlineStack align="space-between" blockAlign="center" gap="300">
      <InlineStack gap="200" blockAlign="center">
        <Text as="span" variant="bodyMd" tone="subdued">
          Rich storefront tracking
        </Text>
        <div role="status" aria-live="polite">
          <Badge
            tone={trackerStatus?.status === "active" ? "success" : undefined}
          >
            {trackerStatus
              ? trackerStatus.status === "active"
                ? "Active"
                : trackerStatus.status === "missing"
                  ? "Not active"
                  : "Not verified"
              : error
                ? "Unavailable"
                : "Checking…"}
          </Badge>
        </div>
      </InlineStack>
      <InlineStack gap="200" blockAlign="center">
        {host && (
          <Text as="span" tone="subdued">
            {host}
          </Text>
        )}
        {error && (
          <Text as="span" tone="subdued">
            {trackerStatus ? "Couldn’t refresh. Showing last check." : error}
          </Text>
        )}
        {needsRetry && (
          <Button
            variant="plain"
            onClick={reload}
            loading={loading}
            accessibilityLabel="Retry storefront tracking status"
          >
            Retry
          </Button>
        )}
      </InlineStack>
    </InlineStack>
  );
}
