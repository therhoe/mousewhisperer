import { Card, BlockStack, InlineStack, Text, Button, Badge, Box } from "@shopify/polaris";
import { useFetcher } from "@remix-run/react";
import { RichTextDisplay } from "./RichTextDisplay";

interface AnswerCardProps {
  id: string;
  content: string;
  upvoteCount: number;
  hasVoted: boolean;
  isAccepted: boolean;
  createdAt: string;
  isOwner: boolean;
  isInsightOwner: boolean;
  profile: {
    displayName: string;
    avatarEmoji: string | null;
    reputation?: number;
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
  isAccepted,
  createdAt,
  isOwner,
  isInsightOwner,
  profile,
}: AnswerCardProps) {
  const voteFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const acceptFetcher = useFetcher();

  const isVoting = voteFetcher.state !== "idle";
  const isDeleting = deleteFetcher.state !== "idle";

  // Optimistic vote
  const optimisticVoted = voteFetcher.formData
    ? voteFetcher.formData.get("hasVoted") === "false"
    : hasVoted;
  const optimisticCount = voteFetcher.formData
    ? upvoteCount + (voteFetcher.formData.get("hasVoted") === "false" ? 1 : -1)
    : upvoteCount;

  // Optimistic accept
  const optimisticAccepted = acceptFetcher.formData
    ? acceptFetcher.formData.get("isAccepted") === "false"
    : isAccepted;

  return (
    <div
      style={
        optimisticAccepted
          ? {
              borderLeft: "3px solid var(--p-color-bg-fill-success)",
              paddingLeft: 0,
              borderRadius: "var(--p-border-radius-200)",
            }
          : {}
      }
    >
      <Card>
        <BlockStack gap="200">
          {/* Accepted badge */}
          {optimisticAccepted && (
            <Badge tone="success">Accepted Answer</Badge>
          )}

          {/* Author */}
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <Text as="span" variant="bodyLg">{profile.avatarEmoji || "🐭"}</Text>
              <BlockStack gap="0">
                <InlineStack gap="100" blockAlign="center">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {profile.displayName}
                  </Text>
                  {profile.reputation != null && profile.reputation > 0 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      ({profile.reputation} pts)
                    </Text>
                  )}
                </InlineStack>
              </BlockStack>
            </InlineStack>
            <Text as="span" variant="bodySm" tone="subdued">
              {timeAgo(createdAt)}
            </Text>
          </InlineStack>

          <RichTextDisplay html={content} />

          {/* Actions */}
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

            {/* Accept answer — only insight owner can do this */}
            {isInsightOwner && (
              <acceptFetcher.Form method="post">
                <input type="hidden" name="_action" value="accept-answer" />
                <input type="hidden" name="answerId" value={id} />
                <input type="hidden" name="isAccepted" value={String(isAccepted)} />
                <Button submit variant="plain" size="slim" tone={optimisticAccepted ? "success" : undefined}>
                  {optimisticAccepted ? "✓ Accepted" : "Accept answer"}
                </Button>
              </acceptFetcher.Form>
            )}

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
    </div>
  );
}
