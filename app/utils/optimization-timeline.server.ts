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
        implementedAt: { lte: end },
        OR: [{ endedAt: null }, { endedAt: { gte: start } }],
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

  const [optimizations, tests, snapshots, storeSnapshots] = await Promise.all([
    optimizationQuery,
    prisma.abTest.findMany({
      where: {
        shop,
        launchedAt: { not: null, lte: end },
        OR: [{ endedAt: null }, { endedAt: { gte: start } }],
      },
      select: {
        id: true,
        name: true,
        goal: true,
        launchedAt: true,
        endedAt: true,
        pausedAt: true,
      },
      orderBy: { launchedAt: "asc" },
    }),
    prisma.snapshot.findMany({
      where: {
        completedAt: { gte: start, lte: end },
        project: { shop },
      },
      select: {
        id: true,
        name: true,
        number: true,
        completedAt: true,
        project: { select: { productTitle: true } },
      },
      orderBy: { completedAt: "asc" },
    }),
    prisma.storeSnapshot.findMany({
      where: { shop, completedAt: { gte: start, lte: end } },
      select: { id: true, name: true, completedAt: true },
      orderBy: { completedAt: "asc" },
    }),
  ]);

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
    ...tests.map((test) => ({
      id: `ab:${test.id}`,
      kind: "AB_TEST" as const,
      title: test.name,
      description: `A/B test · ${test.goal.toLowerCase().replaceAll("_", " ")}`,
      category: "EXPERIMENT",
      scope: "PAGE",
      pagePath: null,
      start: test.launchedAt!.toISOString(),
      end: (test.endedAt || test.pausedAt)?.toISOString() ?? null,
      sourceType: "AB_TEST",
      editable: false,
    })),
    ...snapshots.map((snapshot) => ({
      id: `snapshot:${snapshot.id}`,
      kind: "SNAPSHOT" as const,
      title: `${snapshot.project.productTitle} · ${snapshot.name || `Snapshot ${snapshot.number}`}`,
      description: "Snapshot completed",
      category: "MEASUREMENT",
      scope: "PAGE",
      pagePath: null,
      start: snapshot.completedAt!.toISOString(),
      end: null,
      sourceType: "SNAPSHOT",
      editable: false,
    })),
    ...storeSnapshots.map((snapshot) => ({
      id: `store-snapshot:${snapshot.id}`,
      kind: "STORE_SNAPSHOT" as const,
      title: snapshot.name || "Store snapshot",
      description: "Store snapshot completed",
      category: "MEASUREMENT",
      scope: "STORE",
      pagePath: null,
      start: snapshot.completedAt!.toISOString(),
      end: null,
      sourceType: "STORE_SNAPSHOT",
      editable: false,
    })),
  ];

  return events.sort(
    (left, right) =>
      new Date(left.start).getTime() - new Date(right.start).getTime(),
  );
}
