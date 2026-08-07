import prisma from "../db.server";
import type { ProgressTimelineEvent } from "../types/conversion-progress";

export async function getOptimizationTimeline(
  shop: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<ProgressTimelineEvent[]> {
  const start = new Date(`${rangeStart}T00:00:00.000Z`);
  const end = new Date(`${rangeEnd}T23:59:59.999Z`);

  const optimizationQuery = prisma.optimizationEvent
    .findMany({
      where: {
        shop,
        sourceType: "MANUAL",
        implementedAt: { gte: start, lte: end },
      },
      orderBy: { implementedAt: "asc" },
    })
    .catch((error: unknown) => {
      // Keep the dashboard readable during a rolling deploy while the new table
      // is waiting for the migration step. Other database failures still surface.
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2021"
      ) {
        return [];
      }
      throw error;
    });

  const optimizations = await optimizationQuery;

  const events: ProgressTimelineEvent[] = [
    ...optimizations.map((event) => ({
      id: event.id,
      kind: "OPTIMIZATION" as const,
      title: event.title,
      description: event.description,
      category: event.category,
      scope: event.scope,
      pagePath: event.pagePath,
      start: event.implementedAt.toISOString(),
      end: event.endedAt?.toISOString() ?? null,
      sourceType: event.sourceType,
      editable: event.sourceType === "MANUAL",
    })),
  ];

  return events.sort(
    (left, right) =>
      new Date(left.start).getTime() - new Date(right.start).getTime(),
  );
}
