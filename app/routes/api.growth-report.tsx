import { json, type LoaderFunctionArgs } from "@remix-run/node";
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
    return json(
      { report, comparison },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof GrowthProjectError)
      throw new Response(error.message, { status: error.status });
    throw error;
  }
};
