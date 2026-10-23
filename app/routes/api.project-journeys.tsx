import { json, type LoaderFunctionArgs } from "@remix-run/node";
import type { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { growthReportFilters } from "../utils/growth-report";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const projectId = params.get("projectId") || "";
  const measurementId = params.get("measurement") || "";
  const measurement = await prisma.growthMeasurement.findFirst({
    where: { id: measurementId, projectId, project: { shop: session.shop } },
    select: {
      customerSnapshotId: true,
      storeSnapshotId: true,
      project: { select: { defaultSource: true, defaultMedium: true, defaultCampaign: true } },
    },
  });
  if (!measurement?.customerSnapshotId) throw new Response("Journey measurement not found.", { status: 404 });
  const filters = growthReportFilters(params, measurement.project);
  const where: Prisma.CustomerJourneySessionWhereInput = {
    snapshotId: measurement.customerSnapshotId,
    snapshot: { shop: session.shop },
    // Pixel commerce can arrive before the first theme heartbeat. Keep those
    // provisional zero-page sessions out until the parent admits a real page.
    ...(measurement.storeSnapshotId ? { pages: { some: {} } } : {}),
    ...(filters.audience === "active" ? { visitorType: "REAL" } : {}),
    ...(filters.source ? { source: { equals: filters.source, mode: "insensitive" } } : {}),
    ...(filters.medium ? { medium: { equals: filters.medium, mode: "insensitive" } } : {}),
    ...(filters.campaign ? { campaign: { equals: filters.campaign, mode: "insensitive" } } : {}),
  };
  const total = await prisma.customerJourneySession.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / 10));
  const requested = Number(params.get("page")) || 1;
  const page = Math.max(1, Math.min(pageCount, Number.isFinite(requested) ? Math.floor(requested) : 1));
  const rows = await prisma.customerJourneySession.findMany({
    where, orderBy: [{ startedAt: "desc" }, { id: "desc" }], skip: (page - 1) * 10, take: 10,
    select: {
      id: true, source: true, medium: true, campaign: true, startedAt: true, lastSeenAt: true,
      visitorType: true, addedToCart: true, converted: true,
      _count: { select: { pages: true, events: true } },
    },
  });
  const sessions = rows.map(({ _count, ...row }) => ({
    ...row,
    pageCount: _count.pages,
    eventCount: _count.events,
    detailUrl: `/app/customer-snapshots/${encodeURIComponent(measurement.customerSnapshotId!)}?journey=${encodeURIComponent(row.id)}`,
  }));
  return json({ sessions, total, page, pageCount }, { headers: { "Cache-Control": "private, no-store" } });
};
