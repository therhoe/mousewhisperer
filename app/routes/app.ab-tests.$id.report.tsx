import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  getAbTestStats,
  getAbVariantSnapshotStats,
} from "../utils/ab-tests.server";
import { cachedValue } from "../utils/loader-cache.server";
import {
  parseAbReportFilters,
  abReportFilterQuery,
} from "../utils/ab-project-targeting";

const AB_REPORT_CACHE_TTL_MS = 10_000;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const test = await prisma.abTest.findFirst({
    where: { id: params.id, shop },
    select: {
      id: true,
      targetPageType: true,
      targetPagePath: true,
      goal: true,
      growthProject: true,
    },
  });

  if (!test) {
    throw new Response("Not found", { status: 404 });
  }

  const searchParams = new URL(request.url).searchParams;
  const filters = parseAbReportFilters(searchParams, test.growthProject);
  const filterQuery = abReportFilterQuery(filters);
  const variantId = searchParams.get("variantId")?.trim();
  if (variantId) {
    const loadSnapshot = () =>
      getAbVariantSnapshotStats({
        shop,
        testId: test.id,
        variantId,
        targetPageType: test.targetPageType,
        targetPagePath: test.targetPagePath,
        filters,
      });
    const snapshot = searchParams.has("refresh")
      ? await loadSnapshot()
      : await cachedValue(
          `ab-test-variant-report:${shop}:${test.id}:${variantId}:${filterQuery}`,
          AB_REPORT_CACHE_TTL_MS,
          loadSnapshot,
        );
    if (!snapshot) {
      throw new Response("Variant not found", { status: 404 });
    }
    return Response.json({ testId: test.id, variantId, snapshot, filterQuery });
  }

  const stats = await cachedValue(
    `ab-test-report:${shop}:${test.id}:${filterQuery}`,
    AB_REPORT_CACHE_TTL_MS,
    () => getAbTestStats(test.id, test.goal, filters),
  );
  return Response.json({ testId: test.id, stats, filterQuery });
};

// Fetchers reach this route as a single-fetch .data request; Shopify needs
// these headers there so App Bridge can re-authenticate an expired session.
export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
