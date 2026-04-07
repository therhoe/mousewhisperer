import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Card,
  FormLayout,
  TextField,
  Select,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const STORE_CATEGORIES = [
  { label: "Select a category", value: "" },
  { label: "Fashion & Apparel", value: "Fashion" },
  { label: "Electronics", value: "Electronics" },
  { label: "Food & Drink", value: "Food & Drink" },
  { label: "Home & Garden", value: "Home & Garden" },
  { label: "Health & Beauty", value: "Health & Beauty" },
  { label: "Sports & Outdoors", value: "Sports" },
  { label: "Digital Products", value: "Digital" },
  { label: "Other", value: "Other" },
];

const EMOJI_OPTIONS = [
  "🐭", "🦊", "🐻", "🐼", "🐨", "🦁", "🐸", "🐵",
  "🐶", "🐱", "🐰", "🦄", "🐝", "🦋", "🐙", "🦑",
  "🌟", "🔥", "💎", "🚀", "🎯", "🛒", "📊", "💡",
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const profile = await prisma.insightProfile.findUnique({ where: { shop } });

  const defaultName = session.firstName || shop.replace(".myshopify.com", "");

  const url = new URL(request.url);
  const returnTo = url.searchParams.get("returnTo") || "/app/insights";

  return json({
    profile,
    defaultName,
    returnTo,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const displayName = (formData.get("displayName") as string)?.trim();
  const storeCategory = (formData.get("storeCategory") as string) || null;
  const avatarEmoji = (formData.get("avatarEmoji") as string) || "🐭";
  const bio = (formData.get("bio") as string)?.trim() || null;
  const avatarUrl = (formData.get("avatarUrl") as string)?.trim() || null;
  const returnTo = (formData.get("returnTo") as string) || "/app/insights";

  if (!displayName || displayName.length < 2 || displayName.length > 50) {
    return json(
      { error: "Display name must be between 2 and 50 characters." },
      { status: 400 },
    );
  }

  await prisma.insightProfile.upsert({
    where: { shop },
    create: { shop, displayName, storeCategory, avatarEmoji, bio, avatarUrl },
    update: { displayName, storeCategory, avatarEmoji, bio, avatarUrl },
  });

  return redirect(returnTo);
};

export default function InsightsProfile() {
  const { profile, defaultName, returnTo } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [displayName, setDisplayName] = useState(profile?.displayName || defaultName);
  const [storeCategory, setStoreCategory] = useState(profile?.storeCategory || "");
  const [avatarEmoji, setAvatarEmoji] = useState(profile?.avatarEmoji || "🐭");
  const [bio, setBio] = useState(profile?.bio || "");
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl || "");

  const handleSave = () => {
    submit(
      { displayName, storeCategory, avatarEmoji, bio, avatarUrl, returnTo },
      { method: "post" },
    );
  };

  return (
    <Page
      backAction={{ content: "Insights", url: "/app/insights" }}
      title="Community Profile"
    >
      <TitleBar title="Community Profile" />
      <BlockStack gap="400">
        {actionData?.error && (
          <Card>
            <Text as="p" tone="critical">{actionData.error}</Text>
          </Card>
        )}

        <Card>
          <FormLayout>
            <TextField
              label="Display name"
              value={displayName}
              onChange={setDisplayName}
              autoComplete="off"
              maxLength={50}
              helpText="This is how other merchants will see you."
            />

            <Select
              label="Store category"
              options={STORE_CATEGORIES}
              value={storeCategory}
              onChange={setStoreCategory}
              helpText="Helps others find merchants in similar niches."
            />

            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                Avatar
              </Text>
              <InlineStack gap="200" wrap>
                {EMOJI_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setAvatarEmoji(emoji)}
                    style={{
                      fontSize: "1.5rem",
                      width: 40,
                      height: 40,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 8,
                      border: avatarEmoji === emoji ? "2px solid var(--p-color-border-emphasis)" : "2px solid transparent",
                      background: avatarEmoji === emoji ? "var(--p-color-bg-surface-selected)" : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                Selected: {avatarEmoji}
              </Text>
            </BlockStack>
            <TextField
              label="Bio"
              value={bio}
              onChange={setBio}
              autoComplete="off"
              maxLength={200}
              multiline={2}
              helpText="A short description of your CRO focus (max 200 chars)."
            />

            <TextField
              label="Avatar Image URL"
              value={avatarUrl}
              onChange={setAvatarUrl}
              autoComplete="off"
              placeholder="https://cdn.shopify.com/..."
              helpText="HTTPS URL to a custom avatar image. Leave blank to use the emoji above."
            />
          </FormLayout>
        </Card>

        <Box paddingBlockEnd="400">
          <InlineStack align="end">
            <Button variant="primary" onClick={handleSave} loading={isSubmitting}>
              Save profile
            </Button>
          </InlineStack>
        </Box>
      </BlockStack>
    </Page>
  );
}
