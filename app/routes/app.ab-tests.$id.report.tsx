import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getAbTestStats } from "../utils/ab-tests.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const test = await prisma.abTest.findFirst({
    where: { id: params.id, shop },
    select: { id: true },
  });

  if (!test) {
    throw new Response("Not found", { status: 404 });
  }

  const stats = await getAbTestStats(test.id);
  return json({ testId: test.id, stats });
};
