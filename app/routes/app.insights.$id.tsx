import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation, useFetcher } from "@remix-run/react";
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
        orderBy: { upvoteCount: "desc" },
        include: {
          profile: {
            select: { id: true, displayName: true, avatarEmoji: true, shop: true },
          },
        },
      },
    },
  });

  if (!insight) {
    throw new Response("Insight not found", { status: 404 });
  }

  // Compute hasVoted for each answer
  let votedAnswerIds = new Set<string>();
  if (profile) {
    const votes = await prisma.insightVote.findMany({
      where: {
        profileId: profile.id,
        answerId: { in: insight.answers.map((a) => a.id) },
      },
      select: { answerId: true },
    });
    votedAnswerIds = new Set(votes.map((v) => v.answerId));
  }

  const answers = insight.answers.map((a) => ({
    ...a,
    hasVoted: votedAnswerIds.has(a.id),
    isOwner: a.profile.shop === shop,
  }));

  return json({
    insight: {
      ...insight,
      isOwner: insight.profile.shop === shop,
    },
    answers,
    hasProfile: !!profile,
    profileId: profile?.id,
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
      ]);

      return json({ ok: true });
    }

    case "toggle-vote": {
      const answerId = formData.get("answerId") as string;
      const hasVoted = formData.get("hasVoted") === "true";

      if (hasVoted) {
        // Remove vote
        await prisma.$transaction([
          prisma.insightVote.delete({
            where: { answerId_profileId: { answerId, profileId: profile.id } },
          }),
          prisma.insightAnswer.update({
            where: { id: answerId },
            data: { upvoteCount: { decrement: 1 } },
          }),
        ]);
      } else {
        // Add vote
        await prisma.$transaction([
          prisma.insightVote.create({
            data: { answerId, profileId: profile.id },
          }),
          prisma.insightAnswer.update({
            where: { id: answerId },
            data: { upvoteCount: { increment: 1 } },
          }),
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
  const { insight, answers, hasProfile } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const deleteFetcher = useFetcher();

  const isSubmitting = navigation.state === "submitting";

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
                    <Text as="span" variant="bodySm" tone="subdued">
                      {timeAgo(insight.createdAt)}
                    </Text>
                  </InlineStack>
                </InlineStack>

                <RichTextDisplay html={insight.content} />

                {insight.isOwner && (
                  <deleteFetcher.Form method="post">
                    <input type="hidden" name="_action" value="delete-insight" />
                    <Button
                      submit
                      variant="plain"
                      tone="critical"
                      size="slim"
                    >
                      Delete insight
                    </Button>
                  </deleteFetcher.Form>
                )}
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
                createdAt={answer.createdAt}
                isOwner={answer.isOwner}
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
                title="Create a profile to answer"
                tone="info"
                action={{
                  content: "Create profile",
                  url: `/app/insights/profile?returnTo=/app/insights/${insight.id}`,
                }}
              >
                <p>Set up your community profile to post answers and vote.</p>
              </Banner>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>

      <Box paddingBlockEnd="800" />
    </Page>
  );
}
