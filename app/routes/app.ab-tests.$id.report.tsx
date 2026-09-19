import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  getAbTestStats,
  getAbVariantSnapshotStats,
} from "../utils/ab-tests.server";
import { cachedValue } from "../utils/loader-cache.server";

const AB_REPORT_CACHE_TTL_MS = 10_000;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const test = await prisma.abTest.findFirst({
    where: { id: params.id, shop },
    select: { id: true, targetPageType: true, goal: true },
  });

  if (!test) {
    throw new Response("Not found", { status: 404 });
  }

  const searchParams = new URL(request.url).searchParams;
  const variantId = searchParams.get("variantId")?.trim();
  if (variantId) {
    const loadSnapshot = () =>
      getAbVariantSnapshotStats({
        shop,
        testId: test.id,
        variantId,
        targetPageType: test.targetPageType,
      });
    const snapshot = searchParams.has("refresh")
      ? await loadSnapshot()
      : await cachedValue(
          `ab-test-variant-report:${shop}:${test.id}:${variantId}`,
          AB_REPORT_CACHE_TTL_MS,
          loadSnapshot,
        );
    if (!snapshot) {
      throw new Response("Variant not found", { status: 404 });
    }
    return json({ testId: test.id, variantId, snapshot });
  }

  const stats = await cachedValue(
    `ab-test-report:${shop}:${test.id}`,
    AB_REPORT_CACHE_TTL_MS,
    () => getAbTestStats(test.id, test.goal),
  );
  return json({ testId: test.id, stats });
};
