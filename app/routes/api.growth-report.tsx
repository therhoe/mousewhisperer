import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getGrowthMeasurementReport } from "../utils/growth-report.server";
import { growthReportFilters } from "../utils/growth-report";
import { GrowthProjectError } from "../utils/growth-projects";
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const project = await prisma.growthProject.findFirst({
    where: { id: params.get("projectId") || "", shop: session.shop },
  });
  if (!project) throw new Response("Not found", { status: 404 });
  try {
    const filters = growthReportFilters(params, project);
    const [report, comparison] = await Promise.all([
      getGrowthMeasurementReport(
        session.shop,
        project.id,
        params.get("measurement") || "",
        filters,
      ),
      params.get("compare")
        ? getGrowthMeasurementReport(
            session.shop,
            project.id,
            params.get("compare")!,
            filters,
          )
        : Promise.resolve(null),
    ]);
    return Response.json(
      { report, comparison },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof GrowthProjectError)
      throw new Response(error.message, { status: error.status });
    throw error;
  }
};

// Fetchers reach this route as a single-fetch .data request; Shopify needs
// these headers there so App Bridge can re-authenticate an expired session.
export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
