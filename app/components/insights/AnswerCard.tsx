import { Card, BlockStack, InlineStack, Text, Button, Popover, ActionList, Modal } from "@shopify/polaris";
import { useState, useCallback } from "react";
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

// Stack Overflow style large checkmark
function AcceptedCheckmark({ accepted, clickable, onClick }: { accepted: boolean; clickable: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        borderRadius: "50%",
        border: "none",
        background: accepted ? "#e3f5eb" : "transparent",
        cursor: clickable ? "pointer" : "default",
        fontSize: 22,
        color: accepted ? "#1a7b3d" : "#c4c4c4",
        transition: "all 0.15s ease",
        flexShrink: 0,
      }}
      title={
        clickable
          ? accepted
            ? "Unmark as accepted"
            : "Accept this answer"
          : accepted
            ? "Accepted answer"
            : ""
      }
    >
      ✓
    </button>
  );
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

  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [acceptConfirm, setAcceptConfirm] = useState(false);

  const toggleMenu = useCallback(() => setMenuOpen((o) => !o), []);

  const isVoting = voteFetcher.state !== "idle";

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

  const hasMenu = isOwner || isInsightOwner;

  const menuActions = [];
  if (isInsightOwner) {
    menuActions.push({
      content: optimisticAccepted ? "Unmark accepted answer" : "Accept this answer",
      onAction: () => {
        setMenuOpen(false);
        setAcceptConfirm(true);
      },
    });
  }
  if (isOwner) {
    menuActions.push({
      content: "Delete answer",
      destructive: true,
      onAction: () => {
        setMenuOpen(false);
        setDeleteConfirm(true);
      },
    });
  }

  const handleAccept = () => {
    acceptFetcher.submit(
      { _action: "accept-answer", answerId: id, isAccepted: String(isAccepted) },
      { method: "post" },
    );
    setAcceptConfirm(false);
  };

  const handleDelete = () => {
    deleteFetcher.submit(
      { _action: "delete-answer", answerId: id },
      { method: "post" },
    );
    setDeleteConfirm(false);
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        {/* Left gutter: vote + checkmark (Stack Overflow style) */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            paddingTop: 16,
            minWidth: 44,
          }}
        >
          {/* Upvote */}
          <voteFetcher.Form method="post">
            <input type="hidden" name="_action" value="toggle-vote" />
            <input type="hidden" name="answerId" value={id} />
            <input type="hidden" name="hasVoted" value={String(hasVoted)} />
            <button
              type="submit"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 4,
                color: optimisticVoted ? "var(--p-color-text-emphasis)" : "var(--p-color-text-secondary)",
              }}
            >
              <span style={{ fontSize: 20, lineHeight: 1 }}>
                {optimisticVoted ? "▲" : "△"}
              </span>
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                {optimisticCount}
              </span>
            </button>
          </voteFetcher.Form>

          {/* Accepted checkmark */}
          {(optimisticAccepted || isInsightOwner) && (
            <AcceptedCheckmark
              accepted={optimisticAccepted}
              clickable={isInsightOwner}
              onClick={() => setAcceptConfirm(true)}
            />
          )}
        </div>

        {/* Answer content */}
        <div style={{ flexGrow: 1 }}>
          <Card
            background={optimisticAccepted ? "bg-surface-success" : undefined}
          >
            <BlockStack gap="200">
              {/* Header */}
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <span style={{ fontSize: "1.2rem" }}>{profile.avatarEmoji || "🐭"}</span>
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {profile.displayName}
                  </Text>
                  {profile.reputation != null && profile.reputation > 0 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {profile.reputation} pts
                    </Text>
                  )}
                  <Text as="span" variant="bodySm" tone="subdued">
                    {timeAgo(createdAt)}
                  </Text>
                </InlineStack>

                {/* Action menu */}
                {hasMenu && (
                  <Popover
                    active={menuOpen}
                    activator={
                      <Button variant="plain" size="slim" onClick={toggleMenu}>
                        ···
                      </Button>
                    }
                    onClose={() => setMenuOpen(false)}
                  >
                    <ActionList items={menuActions} />
                  </Popover>
                )}
              </InlineStack>

              <RichTextDisplay html={content} />
            </BlockStack>
          </Card>
        </div>
      </div>

      {/* Accept confirmation */}
      <Modal
        open={acceptConfirm}
        onClose={() => setAcceptConfirm(false)}
        title={optimisticAccepted ? "Unmark accepted answer?" : "Accept this answer?"}
        primaryAction={{
          content: optimisticAccepted ? "Unmark" : "Accept",
          onAction: handleAccept,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setAcceptConfirm(false) }]}
      >
        <Modal.Section>
          <Text as="p">
            {optimisticAccepted
              ? "This will remove the accepted status from this answer."
              : "This will mark this answer as the accepted solution. Only one answer can be accepted per insight."}
          </Text>
        </Modal.Section>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        title="Delete this answer?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDelete,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteConfirm(false) }]}
      >
        <Modal.Section>
          <Text as="p">
            This action cannot be undone. The answer and its votes will be permanently removed.
          </Text>
        </Modal.Section>
      </Modal>
    </>
  );
}
