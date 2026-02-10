import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation, useFetcher } from "@remix-run/react";
import { useEffect, useRef } from "react";
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
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sanitizeHTML } from "../utils/sanitize.server";
import { RichTextDisplay } from "../components/insights/RichTextDisplay";
import { RichTextEditor } from "../components/insights/RichTextEditor";
import { CategoryBadge } from "../components/insights/CategoryBadge";
import { AnswerCard } from "../components/insights/AnswerCard";
import { SnapshotStatsDisplay } from "../components/insights/SnapshotStatsDisplay";

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
  const shop = session.shop;

  const profile = await prisma.insightProfile.findUnique({ where: { shop } });

  const insight = await prisma.insight.findUnique({
    where: { id: params.id },
    include: {
      profile: {
        select: { id: true, displayName: true, avatarEmoji: true, storeCategory: true, shop: true },
      },
      answers: {
        orderBy: [{ isAccepted: "desc" }, { upvoteCount: "desc" }],
        include: {
          profile: {
            select: { id: true, displayName: true, avatarEmoji: true, shop: true, reputation: true },
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

      await prisma.$transaction([
        prisma.insightAnswer.create({
          data: {
            insightId: params.id!,
            profileId: profile.id,
            content: sanitizedContent,
          },
        }),
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

      return json({ ok: true });
    }

    case "toggle-vote": {
      const answerId = formData.get("answerId") as string;
      const hasVoted = formData.get("hasVoted") === "true";

      const answer = await prisma.insightAnswer.findUnique({
        where: { id: answerId },
        select: { profileId: true },
      });

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
        await prisma.$transaction([
          prisma.insightMeToo.create({
            data: { insightId: params.id!, profileId: profile.id },
          }),
          prisma.insight.update({
            where: { id: params.id },
            data: { meTooCount: { increment: 1 } },
          }),
        ]);
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
      const insight = await prisma.insight.findUnique({
        where: { id: params.id },
        include: { profile: { select: { shop: true } } },
      });
      if (!insight || insight.profile.shop !== shop) {
        return json({ error: "Unauthorized" }, { status: 403 });
      }

      const answer = await prisma.insightAnswer.findUnique({
        where: { id: answerId },
        select: { profileId: true },
      });

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
      return redirect("/app/insights");
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

  return (
    <Page
      backAction={{ content: "Insights", url: "/app/insights" }}
      title={insight.title}
    >
      <TitleBar title={insight.title} />

      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* Insight header */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" variant="headingLg">
                      {insight.profile.avatarEmoji || "🐭"}
                    </Text>
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
                  </InlineStack>

                  <InlineStack gap="200" blockAlign="center">
                    <CategoryBadge category={insight.category} />
                    {insight.hasAcceptedAnswer && (
                      <Badge tone="success">Solved</Badge>
                    )}
                    <Text as="span" variant="bodySm" tone="subdued">
                      {timeAgo(insight.createdAt)}
                    </Text>
                  </InlineStack>
                </InlineStack>

                <RichTextDisplay html={insight.content} />

                {/* Engagement bar */}
                <Divider />
                <InlineStack gap="300" blockAlign="center" wrap>
                  {/* Me too */}
                  {hasProfile && (
                    <meTooFetcher.Form method="post">
                      <input type="hidden" name="_action" value="toggle-metoo" />
                      <input type="hidden" name="hasMeTooed" value={String(hasMeTooed)} />
                      <Button
                        submit
                        variant={optimisticMeTooed ? "primary" : "secondary"}
                        size="slim"
                      >
                        🙋 I have this too {optimisticMeTooCount > 0 ? `(${optimisticMeTooCount})` : ""}
                      </Button>
                    </meTooFetcher.Form>
                  )}

                  {/* Bookmark */}
                  {hasProfile && (
                    <bookmarkFetcher.Form method="post">
                      <input type="hidden" name="_action" value="toggle-bookmark" />
                      <input type="hidden" name="hasBookmarked" value={String(hasBookmarked)} />
                      <Button submit variant="plain" size="slim">
                        {optimisticBookmarked ? "🔖 Bookmarked" : "☆ Bookmark"}
                      </Button>
                    </bookmarkFetcher.Form>
                  )}

                  <Text as="span" variant="bodySm" tone="subdued">
                    👁 {insight.viewCount} views
                  </Text>

                  <Text as="span" variant="bodySm" tone="subdued">
                    💬 {insight.answerCount} answers
                  </Text>

                  {insight.isOwner && (
                    <deleteFetcher.Form method="post">
                      <input type="hidden" name="_action" value="delete-insight" />
                      <Button submit variant="plain" tone="critical" size="slim">
                        Delete
                      </Button>
                    </deleteFetcher.Form>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Snapshot stats */}
            {insight.snapshotStats && (
              <SnapshotStatsDisplay stats={insight.snapshotStats as any} />
            )}

            <Divider />

            {/* Answers */}
            <Text as="h2" variant="headingMd">
              {insight.answerCount} {insight.answerCount === 1 ? "Answer" : "Answers"}
            </Text>

            {answers.length === 0 && (
              <Text as="p" tone="subdued">
                No answers yet. Be the first to help!
              </Text>
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
                  url: `/app/insights/profile?returnTo=/app/insights/${insight.id}`,
                }}
              >
                <p>Set up your community profile to post answers, vote, and more.</p>
              </Banner>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>

      <Box paddingBlockEnd="800" />
    </Page>
  );
}
