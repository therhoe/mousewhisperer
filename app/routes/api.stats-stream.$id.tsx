import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

// Calculate stats for a project
async function getProjectStats(projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId },
    include: {
      visits: true,
    },
  });

  if (!project) {
    return null;
  }

  const totalSessions = project.visits.length;
  const realUsers = project.visits.filter((v) => v.visitorType === "REAL");
  const zombies = project.visits.filter((v) => v.visitorType === "ZOMBIE");
  const bots = project.visits.filter((v) => v.visitorType === "BOT");

  const realCount = realUsers.length;
  const zombieCount = zombies.length;
  const botCount = bots.length;

  const addToCartCount = project.visits.filter((v) => v.addedToCart).length;
  const conversionCount = project.visits.filter((v) => v.converted).length;

  const avgTimeOnPage = realUsers.length > 0
    ? Math.round(realUsers.reduce((sum, v) => sum + v.timeOnPage, 0) / realUsers.length / 1000)
    : 0;
  const avgScrollDepth = realUsers.length > 0
    ? Math.round(realUsers.reduce((sum, v) => sum + v.scrollDepth, 0) / realUsers.length)
    : 0;

  return {
    totalSessions,
    realCount,
    zombieCount,
    botCount,
    realPercent: totalSessions > 0 ? Math.round((realCount / totalSessions) * 100) : 0,
    zombiePercent: totalSessions > 0 ? Math.round((zombieCount / totalSessions) * 100) : 0,
    botPercent: totalSessions > 0 ? Math.round((botCount / totalSessions) * 100) : 0,
    addToCartCount,
    conversionCount,
    avgTimeOnPage,
    avgScrollDepth,
    atcPercent: totalSessions > 0 ? Math.round((addToCartCount / totalSessions) * 100) : 0,
    convPercent: totalSessions > 0 ? Math.round((conversionCount / totalSessions) * 100) : 0,
  };
}

export async function loader({ params }: LoaderFunctionArgs) {
  const projectId = params.id;

  if (!projectId) {
    return new Response("Project ID required", { status: 400 });
  }

  // Check if project exists
  const project = await prisma.project.findFirst({
    where: { id: projectId },
    select: { id: true, status: true },
  });

  if (!project) {
    return new Response("Project not found", { status: 404 });
  }

  // Only stream for active projects
  if (project.status !== "ACTIVE") {
    return new Response("Project is not active", { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial stats
      const initialStats = await getProjectStats(projectId);
      if (initialStats) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialStats)}\n\n`));
      }

      // Set up polling interval (every 5 seconds)
      const interval = setInterval(async () => {
        try {
          // Check if project is still active
          const currentProject = await prisma.project.findFirst({
            where: { id: projectId },
            select: { status: true },
          });

          if (!currentProject || currentProject.status !== "ACTIVE") {
            clearInterval(interval);
            controller.close();
            return;
          }

          const stats = await getProjectStats(projectId);
          if (stats) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
          }
        } catch (error) {
          console.error("SSE error:", error);
          clearInterval(interval);
          controller.close();
        }
      }, 5000);

      // Cleanup function (not directly callable in ReadableStream, but we handle it via interval check)
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
}
