import { Banner } from "@shopify/polaris";
import { useNavigate } from "@remix-run/react";

export function ProfileSetupBanner() {
  const navigate = useNavigate();

  return (
    <Banner
      title="Set up your community profile"
      tone="info"
      action={{
        content: "Create profile",
        onAction: () => navigate("/app/insights/profile?returnTo=/app/insights"),
      }}
    >
      <p>
        Create a display name and avatar to start posting insights and helping
        fellow merchants.
      </p>
    </Banner>
  );
}
