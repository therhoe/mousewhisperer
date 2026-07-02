import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation, useFetcher } from "@remix-run/react";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Divider,
  Button,
  Banner,
  Box,
  Layout,
  Popover,
  ActionList,
  Modal,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sanitizeHTML } from "../utils/sanitize.server";
import { createNotification } from "../utils/notifications.server";
import { COMMUNITY_FEATURES_ENABLED } from "../utils/features";
import { RichTextDisplay } from "../components/challenges/RichTextDisplay";
import { RichTextEditor } from "../components/challenges/RichTextEditor";
import { CategoryBadge } from "../components/challenges/CategoryBadge";
import { AnswerCard } from "../components/challenges/AnswerCard";
import { SnapshotStatsDisplay } from "../components/challenges/SnapshotStatsDisplay";

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

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!COMMUNITY_FEATURES_ENABLED) {
    return redirect("/app");
  }

  const shop = session.shop;

  const profile = await prisma.insightProfile.findUnique({ where: { shop } });

  const insight = await prisma.insight.findUnique({
    where: { id: params.id },
    include: {
      profile: {
        select: { id: true, displayName: true, avatarEmoji: true, avatarUrl: true, storeCategory: true, shop: true },
      },
      answers: {
        orderBy: [{ isAccepted: "desc" }, { upvoteCount: "desc" }],
        include: {
          profile: {
            select: { id: true, displayName: true, avatarEmoji: true, avatarUrl: true, shop: true, reputation: true },
          },
        },
      },
    },
  });

  if (!insight) {
    throw new Response("Insight not found", { status: 404 });
  }

  // Fetch user-specific state
  let votedAnswerIds = new Set<string>();
  let hasMeTooed = false;
  let hasBookmarked = false;

  if (profile) {
    const [votes, meToo, bookmark] = await Promise.all([
      prisma.insightVote.findMany({
        where: {
          profileId: profile.id,
          answerId: { in: insight.answers.map((a) => a.id) },
        },
        select: { answerId: true },
      }),
      prisma.insightMeToo.findFirst({
        where: { insightId: params.id!, profileId: profile.id },
      }),
      prisma.insightBookmark.findFirst({
        where: { insightId: params.id!, profileId: profile.id },
      }),
    ]);
    votedAnswerIds = new Set(votes.map((v) => v.answerId));
    hasMeTooed = !!meToo;
    hasBookmarked = !!bookmark;
  }

  const isInsightOwner = insight.profile.shop === shop;

  const answers = insight.answers.map((a) => ({
    ...a,
    hasVoted: votedAnswerIds.has(a.id),
    isOwner: a.profile.shop === shop,
    isInsightOwner,
  }));

  return json({
    insight: { ...insight, isOwner: isInsightOwner },
    answers,
    hasProfile: !!profile,
    profileId: profile?.id,
    hasMeTooed,
    hasBookmarked,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!COMMUNITY_FEATURES_ENABLED) {
    return redirect("/app");
  }

  const shop = session.shop;

  const profile = await prisma.insightProfile.findUnique({ where: { shop } });
  if (!profile) {
    return json({ error: "Profile required" }, { status: 403 });
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  switch (actionType) {
    case "increment-view": {
      await prisma.insight.update({
        where: { id: params.id },
        data: { viewCount: { increment: 1 } },
      });
      return json({ ok: true });
    }

    case "post-answer": {
      const content = formData.get("content") as string;
      if (!content || content === "<p></p>" || content.trim().length === 0) {
        return json({ error: "Answer cannot be empty." }, { status: 400 });
      }

      const sanitizedContent = sanitizeHTML(content);

      const insight = await prisma.insight.findUnique({
        where: { id: params.id },
        include: { profile: { select: { shop: true, displayName: true } } },
      });

      const newAnswer = await prisma.insightAnswer.create({
        data: {
          insightId: params.id!,
          profileId: profile.id,
          content: sanitizedContent,
        },
      });

      await prisma.$transaction([
        prisma.insight.update({
          where: { id: params.id },
          data: { answerCount: { increment: 1 } },
        }),
        // +1 reputation for posting an answer
        prisma.insightProfile.update({
          where: { id: profile.id },
          data: { reputation: { increment: 1 } },
        }),
      ]);

      // Notify insight owner (not self)
      if (insight && insight.profile.shop !== shop) {
        await createNotification({
          shop: insight.profile.shop,
          type: "INSIGHT_ANSWERED",
          title: "New answer on your insight",
          message: `${profile.displayName} answered "${insight.title}"`,
          linkUrl: `/app/challenges/${params.id}#answer-${newAnswer.id}`,
        });
      }

      return json({ ok: true });
    }

    case "toggle-vote": {
      const answerId = formData.get("answerId") as string;
      const hasVoted = formData.get("hasVoted") === "true";

      const answer = await prisma.insightAnswer.findUnique({
        where: { id: answerId },
        select: { profileId: true, insightId: true },
        });
      const answerAuthorProfile = answer
        ? await prisma.insightProfile.findUnique({
            where: { id: answer.profileId },
            select: { shop: true },
          })
        : null;

      if (hasVoted) {
        await prisma.$transaction([
          prisma.insightVote.delete({
            where: { answerId_profileId: { answerId, profileId: profile.id } },
          }),
          prisma.insightAnswer.update({
            where: { id: answerId },
            data: { upvoteCount: { decrement: 1 } },
          }),
          // -5 reputation from answer author
          ...(answer
            ? [
                prisma.insightProfile.update({
                  where: { id: answer.profileId },
                  data: { reputation: { decrement: 5 } },
                }),
              ]
            : []),
        ]);
      } else {
        await prisma.$transaction([
          prisma.insightVote.create({
            data: { answerId, profileId: profile.id },
          }),
          prisma.insightAnswer.update({
            where: { id: answerId },
            data: { upvoteCount: { increment: 1 } },
          }),
          // +5 reputation to answer author
          ...(answer
            ? [
                prisma.insightProfile.update({
                  where: { id: answer.profileId },
                  data: { reputation: { increment: 5 } },
                }),
              ]
            : []),
        ]);

        // Notify answer author (not self)
        if (answerAuthorProfile && answerAuthorProfile.shop !== shop) {
          await createNotification({
            shop: answerAuthorProfile.shop,
            type: "ANSWER_UPVOTED",
            title: "Your answer was upvoted",
            message: `${profile.displayName} upvoted your answer`,
            linkUrl: `/app/challenges/${params.id}#answer-${answerId}`,
          });
        }
      }

      return json({ ok: true });
    }

    case "toggle-metoo": {
      const hasMeTooed = formData.get("hasMeTooed") === "true";

      if (hasMeTooed) {
        await prisma.$transaction([
          prisma.insightMeToo.delete({
            where: { insightId_profileId: { insightId: params.id!, profileId: profile.id } },
          }),
          prisma.insight.update({
            where: { id: params.id },
            data: { meTooCount: { decrement: 1 } },
          }),
        ]);
      } else {
        const meTooInsight = await prisma.insight.findUnique({
          where: { id: params.id },
          include: { profile: { select: { shop: true } } },
        });

        await prisma.$transaction([
          prisma.insightMeToo.create({
            data: { insightId: params.id!, profileId: profile.id },
          }),
          prisma.insight.update({
            where: { id: params.id },
            data: { meTooCount: { increment: 1 } },
          }),
        ]);

        // Notify insight owner (not self)
        if (meTooInsight && meTooInsight.profile.shop !== shop) {
          await createNotification({
            shop: meTooInsight.profile.shop,
            type: "INSIGHT_METOOED",
            title: "Someone relates to your insight",
            message: `${profile.displayName} said "me too" on "${meTooInsight.title}"`,
            linkUrl: `/app/challenges/${params.id}`,
          });
        }
      }

      return json({ ok: true });
    }

    case "toggle-bookmark": {
      const hasBookmarked = formData.get("hasBookmarked") === "true";

      if (hasBookmarked) {
        await prisma.insightBookmark.delete({
          where: { insightId_profileId: { insightId: params.id!, profileId: profile.id } },
        });
      } else {
        await prisma.insightBookmark.create({
          data: { insightId: params.id!, profileId: profile.id },
        });
      }

      return json({ ok: true });
    }

    case "accept-answer": {
      const answerId = formData.get("answerId") as string;
      const isAccepted = formData.get("isAccepted") === "true";

      // Only insight owner can accept
      const acceptInsight = await prisma.insight.findUnique({
        where: { id: params.id },
        include: { profile: { select: { shop: true } } },
      });
      if (!acceptInsight || acceptInsight.profile.shop !== shop) {
        return json({ error: "Unauthorized" }, { status: 403 });
      }

      const answer = await prisma.insightAnswer.findUnique({
        where: { id: answerId },
        select: { profileId: true },
      });
      const acceptAnswerAuthor = answer
        ? await prisma.insightProfile.findUnique({
            where: { id: answer.profileId },
            select: { shop: true },
          })
        : null;

      if (isAccepted) {
        // Un-accept
        await prisma.$transaction([
          prisma.insightAnswer.update({
            where: { id: answerId },
            data: { isAccepted: false },
          }),
          prisma.insight.update({
            where: { id: params.id },
            data: { hasAcceptedAnswer: false },
          }),
          // -10 reputation from answer author
          ...(answer
            ? [
                prisma.insightProfile.update({
                  where: { id: answer.profileId },
                  data: { reputation: { decrement: 10 } },
                }),
              ]
            : []),
        ]);
      } else {
        // Un-accept any previously accepted answer first
        await prisma.insightAnswer.updateMany({
          where: { insightId: params.id!, isAccepted: true },
          data: { isAccepted: false },
        });

        await prisma.$transaction([
          prisma.insightAnswer.update({
            where: { id: answerId },
            data: { isAccepted: true },
          }),
          prisma.insight.update({
            where: { id: params.id },
            data: { hasAcceptedAnswer: true },
          }),
          // +10 reputation to answer author
          ...(answer
            ? [
                prisma.insightProfile.update({
                  where: { id: answer.profileId },
                  data: { reputation: { increment: 10 } },
                }),
              ]
            : []),
        ]);

        // Notify answer author (not self)
        if (acceptAnswerAuthor && acceptAnswerAuthor.shop !== shop) {
          await createNotification({
            shop: acceptAnswerAuthor.shop,
            type: "ANSWER_ACCEPTED",
            title: "Your answer was accepted!",
            message: `Your answer on "${acceptInsight.title}" was marked as the solution`,
            linkUrl: `/app/challenges/${params.id}#answer-${answerId}`,
          });
        }
      }

      return json({ ok: true });
    }

    case "delete-insight": {
      const insight = await prisma.insight.findUnique({
        where: { id: params.id },
        include: { profile: { select: { shop: true } } },
      });
      if (!insight || insight.profile.shop !== shop) {
        return json({ error: "Unauthorized" }, { status: 403 });
      }

      await prisma.insight.delete({ where: { id: params.id } });
      return redirect("/app/challenges");
    }

    case "delete-answer": {
      const answerId = formData.get("answerId") as string;
      const answer = await prisma.insightAnswer.findUnique({
        where: { id: answerId },
        include: { profile: { select: { shop: true } } },
      });
      if (!answer || answer.profile.shop !== shop) {
        return json({ error: "Unauthorized" }, { status: 403 });
      }

      await prisma.$transaction([
        prisma.insightAnswer.delete({ where: { id: answerId } }),
        prisma.insight.update({
          where: { id: params.id },
          data: { answerCount: { decrement: 1 } },
        }),
      ]);

      return json({ ok: true });
    }

    default:
      return json({ error: "Unknown action" }, { status: 400 });
  }
};

function SolvedStamp() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 10px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        color: "#1a7b3d",
        background: "#e3f5eb",
        border: "1.5px solid #b0dfc2",
      }}
    >
      <span style={{ fontSize: 14 }}>&#10003;</span> Solved
    </span>
  );
}

function EngagementPill({ icon, label, active }: { icon: string; label: string; active?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 10px",
        borderRadius: 16,
        fontSize: 13,
        color: active ? "var(--p-color-text-emphasis)" : "var(--p-color-text-secondary)",
        background: active ? "var(--p-color-bg-fill-info-secondary)" : "var(--p-color-bg-surface-secondary)",
        fontWeight: active ? 600 : 400,
      }}
    >
      {icon} {label}
    </span>
  );
}

export default function InsightDetail() {
  const { insight, answers, hasProfile, hasMeTooed, hasBookmarked } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const deleteFetcher = useFetcher();
  const meTooFetcher = useFetcher();
  const bookmarkFetcher = useFetcher();
  const viewFetcher = useFetcher();
  const viewTracked = useRef(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const toggleMenu = useCallback(() => setMenuOpen((o) => !o), []);

  // Increment view count once per page visit
  useEffect(() => {
    if (!viewTracked.current) {
      viewTracked.current = true;
      viewFetcher.submit(
        { _action: "increment-view" },
        { method: "post" },
      );
    }
  }, []);

  // Scroll to and highlight a specific answer when navigated via #answer-{id}
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const timeout = setTimeout(() => {
      const el = document.querySelector(hash);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        (el as HTMLElement).style.transition = "box-shadow 0.3s ease, border-radius 0.3s ease";
        (el as HTMLElement).style.boxShadow = "0 0 0 3px #2c6ecb";
        (el as HTMLElement).style.borderRadius = "12px";
        setTimeout(() => {
          (el as HTMLElement).style.boxShadow = "none";
        }, 3000);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, []);

  const isSubmitting = navigation.state === "submitting";

  // Optimistic me-too
  const optimisticMeTooed = meTooFetcher.formData
    ? meTooFetcher.formData.get("hasMeTooed") === "false"
    : hasMeTooed;
  const optimisticMeTooCount = meTooFetcher.formData
    ? insight.meTooCount + (meTooFetcher.formData.get("hasMeTooed") === "false" ? 1 : -1)
    : insight.meTooCount;

  // Optimistic bookmark
  const optimisticBookmarked = bookmarkFetcher.formData
    ? bookmarkFetcher.formData.get("hasBookmarked") === "false"
    : hasBookmarked;

  const handleDeleteInsight = () => {
    deleteFetcher.submit(
      { _action: "delete-insight" },
      { method: "post" },
    );
    setDeleteConfirm(false);
  };

  return (
    <Page
      backAction={{ content: "Challenges", url: "/app/challenges" }}
      title=""
    >
      <TitleBar title={insight.title} />

      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* Insight header */}
            <Card>
              <BlockStack gap="300">
                {/* Top bar: author info + actions */}
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <InlineStack gap="200" blockAlign="center">
                    {insight.profile.avatarUrl ? (
                      <img src={insight.profile.avatarUrl} alt={insight.profile.displayName} style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", imageRendering: "pixelated" }} />
                    ) : (
                      <span style={{ fontSize: "1.5rem" }}>{insight.profile.avatarEmoji || "\uD83D\uDC2D"}</span>
                    )}
                    <BlockStack gap="0">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {insight.profile.displayName}
                      </Text>
                      {insight.profile.storeCategory && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          {insight.profile.storeCategory}
                        </Text>
                      )}
                    </BlockStack>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {timeAgo(insight.createdAt)}
                    </Text>
                  </InlineStack>

                  <InlineStack gap="200" blockAlign="center">
                    <CategoryBadge category={insight.category} />
                    {insight.hasAcceptedAnswer && <SolvedStamp />}
                    {insight.isOwner && (
                      <Popover
                        active={menuOpen}
                        activator={
                          <Button variant="plain" size="slim" onClick={toggleMenu}>
                            ···
                          </Button>
                        }
                        onClose={() => setMenuOpen(false)}
                      >
                        <ActionList
                          items={[
                            {
                              content: "Delete insight",
                              destructive: true,
                              onAction: () => {
                                setMenuOpen(false);
                                setDeleteConfirm(true);
                              },
                            },
                          ]}
                        />
                      </Popover>
                    )}
                  </InlineStack>
                </InlineStack>

                {/* Title */}
                <Text as="h1" variant="headingLg">
                  {insight.title}
                </Text>

                <RichTextDisplay html={insight.content} />

                {/* Engagement bar */}
                <Divider />
                <InlineStack gap="200" blockAlign="center" wrap>
                  {/* Me too */}
                  {hasProfile && (
                    <meTooFetcher.Form method="post">
                      <input type="hidden" name="_action" value="toggle-metoo" />
                      <input type="hidden" name="hasMeTooed" value={String(hasMeTooed)} />
                      <button
                        type="submit"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "4px 12px",
                          borderRadius: 16,
                          fontSize: 13,
                          fontWeight: optimisticMeTooed ? 600 : 400,
                          color: optimisticMeTooed ? "#fff" : "var(--p-color-text-secondary)",
                          background: optimisticMeTooed
                            ? "var(--p-color-bg-fill-emphasis)"
                            : "var(--p-color-bg-surface-secondary)",
                          border: "none",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        🙋 I have this too{optimisticMeTooCount > 0 ? ` (${optimisticMeTooCount})` : ""}
                      </button>
                    </meTooFetcher.Form>
                  )}

                  {/* Bookmark */}
                  {hasProfile && (
                    <bookmarkFetcher.Form method="post">
                      <input type="hidden" name="_action" value="toggle-bookmark" />
                      <input type="hidden" name="hasBookmarked" value={String(hasBookmarked)} />
                      <button
                        type="submit"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "4px 10px",
                          borderRadius: 16,
                          fontSize: 13,
                          fontWeight: optimisticBookmarked ? 600 : 400,
                          color: optimisticBookmarked ? "var(--p-color-text-emphasis)" : "var(--p-color-text-secondary)",
                          background: optimisticBookmarked
                            ? "var(--p-color-bg-fill-info-secondary)"
                            : "var(--p-color-bg-surface-secondary)",
                          border: "none",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {optimisticBookmarked ? "🔖 Bookmarked" : "☆ Bookmark"}
                      </button>
                    </bookmarkFetcher.Form>
                  )}

                  <EngagementPill icon="👁" label={`${insight.viewCount} views`} />
                  <EngagementPill icon="💬" label={`${insight.answerCount} answers`} />
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Snapshot stats */}
            {insight.snapshotStats && (
              <SnapshotStatsDisplay stats={insight.snapshotStats as any} />
            )}

            <Divider />

            {/* Answers header */}
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                {insight.answerCount} {insight.answerCount === 1 ? "Answer" : "Answers"}
              </Text>
              {insight.hasAcceptedAnswer && (
                <SolvedStamp />
              )}
            </InlineStack>

            {answers.length === 0 && (
              <Card>
                <BlockStack gap="200" inlineAlign="center">
                  <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                    No answers yet. Be the first to help!
                  </Text>
                </BlockStack>
              </Card>
            )}

            {answers.map((answer: any) => (
              <AnswerCard
                key={answer.id}
                id={answer.id}
                content={answer.content}
                upvoteCount={answer.upvoteCount}
                hasVoted={answer.hasVoted}
                isAccepted={answer.isAccepted}
                createdAt={answer.createdAt}
                isOwner={answer.isOwner}
                isInsightOwner={answer.isInsightOwner}
                profile={answer.profile}
              />
            ))}

            <Divider />

            {/* Post answer */}
            {hasProfile ? (
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">Your Answer</Text>
                  {(actionData as any)?.error && (
                    <Banner tone="critical">
                      <p>{(actionData as any).error}</p>
                    </Banner>
                  )}
                  <Form method="post">
                    <input type="hidden" name="_action" value="post-answer" />
                    <BlockStack gap="300">
                      <RichTextEditor
                        name="content"
                        placeholder="Share your experience or solution..."
                      />
                      <InlineStack align="end">
                        <Button variant="primary" submit loading={isSubmitting}>
                          Post answer
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Form>
                </BlockStack>
              </Card>
            ) : (
              <Banner
                title="Create a profile to participate"
                tone="info"
                action={{
                  content: "Create profile",
                  url: `/app/challenges/profile?returnTo=/app/challenges/${insight.id}`,
                }}
              >
                <p>Set up your community profile to post answers, vote, and more.</p>
              </Banner>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* Delete insight confirmation */}
      <Modal
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        title="Delete this insight?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDeleteInsight,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteConfirm(false) }]}
      >
        <Modal.Section>
          <Text as="p">
            This action cannot be undone. The insight, all its answers, and votes will be permanently removed.
          </Text>
        </Modal.Section>
      </Modal>

      <Box paddingBlockEnd="800" />
    </Page>
  );
}
