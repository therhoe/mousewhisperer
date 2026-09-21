import { Component, lazy, Suspense, type ReactNode } from "react";
import { Banner, BlockStack, Button, Card, Text } from "@shopify/polaris";
import type { ConversionDashboardPayload } from "../types/conversion-progress";
import { useBackgroundJson } from "../utils/background-json";

const ConversionProgressCard = lazy(() =>
  import("./ConversionProgressCard").then((module) => ({
    default: module.ConversionProgressCard,
  })),
);

class ConversionPanelBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              Conversion progress
            </Text>
            <Banner tone="warning" title="The conversion graph couldn’t open" />
            <Button onClick={() => window.location.reload()}>
              Reload dashboard
            </Button>
          </BlockStack>
        </Card>
      );
    }
    return this.props.children;
  }
}

export function ConversionProgressSkeleton() {
  return (
    <Card>
      <div
        role="status"
        aria-label="Loading conversion progress"
        aria-busy="true"
      >
        <BlockStack gap="400">
          <Text as="h2" variant="headingLg">
            Conversion progress
          </Text>
          <Text as="p" tone="subdued">
            Loading Shopify Analytics…
          </Text>
          <div
            aria-hidden="true"
            style={{
              minHeight: 420,
              borderRadius: 20,
              background: "#e8f3ff",
              padding: 24,
            }}
          >
            <div
              style={{
                height: 24,
                width: "40%",
                borderRadius: 6,
                background: "#d2e6f7",
                marginBottom: 24,
              }}
            />
            <div
              style={{
                height: 44,
                width: 140,
                borderRadius: 6,
                background: "#d2e6f7",
              }}
            />
            {[0, 1, 2, 3].map((line) => (
              <div
                key={line}
                style={{ height: 1, marginTop: 60, background: "#d2e6f7" }}
              />
            ))}
          </div>
        </BlockStack>
      </div>
    </Card>
  );
}

function isConversionPayload(
  value: unknown,
): value is ConversionDashboardPayload {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<ConversionDashboardPayload>;
  return Boolean(
    data.progress &&
    typeof data.progress === "object" &&
    Array.isArray(data.progress.currentSeries) &&
    Array.isArray(data.progress.previousSeries) &&
    Array.isArray(data.events),
  );
}

export function DashboardConversionPanel({ shop }: { shop: string }) {
  const { data, loading, error, reload } = useBackgroundJson({
    path: "/api/dashboard-conversion?period=month",
    scopeKey: shop,
    isData: isConversionPayload,
    errorMessage:
      "The conversion report is temporarily unavailable. Please retry.",
  });

  if (data) {
    return (
      <BlockStack gap="300">
        {error && (
          <Banner tone="warning" title="Conversion report couldn’t refresh">
            <p>{error} Your last loaded report is still shown.</p>
            <Button onClick={reload} loading={loading}>
              Retry conversion report
            </Button>
          </Banner>
        )}
        <ConversionPanelBoundary>
          <Suspense fallback={<ConversionProgressSkeleton />}>
            <ConversionProgressCard initialData={data} shop={shop} />
          </Suspense>
        </ConversionPanelBoundary>
      </BlockStack>
    );
  }

  if (error) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingLg">
            Conversion progress
          </Text>
          <Banner tone="warning" title="Conversion report couldn’t load">
            <p>{error}</p>
          </Banner>
          <Button onClick={reload} loading={loading}>
            Retry conversion report
          </Button>
        </BlockStack>
      </Card>
    );
  }
  return <ConversionProgressSkeleton />;
}
