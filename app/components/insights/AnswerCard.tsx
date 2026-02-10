import { Card, BlockStack, InlineStack, Text, Button } from "@shopify/polaris";
import { useFetcher } from "@remix-run/react";
import { RichTextDisplay } from "./RichTextDisplay";

interface AnswerCardProps {
  id: string;
  content: string;
  upvoteCount: number;
  hasVoted: boolean;
  createdAt: string;
  isOwner: boolean;
  profile: {
    displayName: string;
    avatarEmoji: string | null;
  };
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function AnswerCard({
  id,
  content,
  upvoteCount,
  hasVoted,
  createdAt,
  isOwner,
  profile,
}: AnswerCardProps) {
  const voteFetcher = useFetcher();
  const deleteFetcher = useFetcher();

  const isVoting = voteFetcher.state !== "idle";
  const isDeleting = deleteFetcher.state !== "idle";

  // Optimistic vote
  const optimisticVoted = voteFetcher.formData
    ? voteFetcher.formData.get("hasVoted") === "false"
    : hasVoted;
  const optimisticCount = voteFetcher.formData
    ? upvoteCount + (voteFetcher.formData.get("hasVoted") === "false" ? 1 : -1)
    : upvoteCount;

  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="bodyLg">{profile.avatarEmoji || "🐭"}</Text>
            <Text as="span" variant="bodySm" fontWeight="semibold">
              {profile.displayName}
            </Text>
          </InlineStack>
          <Text as="span" variant="bodySm" tone="subdued">
            {timeAgo(createdAt)}
          </Text>
        </InlineStack>

        <RichTextDisplay html={content} />

        <InlineStack gap="300" blockAlign="center">
          <voteFetcher.Form method="post">
            <input type="hidden" name="_action" value="toggle-vote" />
            <input type="hidden" name="answerId" value={id} />
            <input type="hidden" name="hasVoted" value={String(hasVoted)} />
            <Button
              submit
              variant={optimisticVoted ? "primary" : "secondary"}
              size="slim"
              loading={isVoting}
            >
              {optimisticVoted ? "▲" : "△"} {optimisticCount}
            </Button>
          </voteFetcher.Form>

          {isOwner && (
            <deleteFetcher.Form method="post">
              <input type="hidden" name="_action" value="delete-answer" />
              <input type="hidden" name="answerId" value={id} />
              <Button submit variant="plain" tone="critical" size="slim" loading={isDeleting}>
                Delete
              </Button>
            </deleteFetcher.Form>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
