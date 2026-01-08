import type { LoaderFunctionArgs } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";
import { generateCSV, generatePDF } from "../utils/export.server";

// Create a fresh Prisma client for this route
const prisma = new PrismaClient();

// Sanitize filename for Content-Disposition header (remove/replace special chars)
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^\w\s.-]/g, '') // Remove special characters except word chars, spaces, dots, hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .substring(0, 100); // Limit length
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const snapshotId = params.snapshotId;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") || "csv";

  if (!snapshotId) {
    return new Response("Missing snapshot ID", { status: 400 });
  }

  try {
    // Fetch snapshot from database
    const snapshot = await prisma.snapshot.findUnique({
      where: { id: snapshotId },
      include: {
        visits: true,
        project: true,
      },
    });

    if (!snapshot) {
      return new Response(`Snapshot not found: ${snapshotId}`, { status: 404 });
    }

    const snapshotInfo = {
      name: snapshot.name || `Snapshot ${snapshot.number}`,
      number: snapshot.number,
      targetVisitors: snapshot.targetVisitors,
    };

    if (format === "csv") {
      const csv = generateCSV(snapshot.visits, snapshot.project, snapshotInfo);
      const filename = sanitizeFilename(snapshot.project.productHandle);
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}-snapshot-${snapshot.number}-report.csv"`,
        },
      });
    }

    if (format === "pdf") {
      const visits = snapshot.visits;
      const totalSessions = visits.length;
      const realUsers = visits.filter((v) => v.visitorType === "REAL");
      const zombies = visits.filter((v) => v.visitorType === "ZOMBIE");
      const bots = visits.filter((v) => v.visitorType === "BOT");
      const addToCartCount = visits.filter((v) => v.addedToCart).length;
      const conversionCount = visits.filter((v) => v.converted).length;

      const stats = {
        totalSessions,
        realCount: realUsers.length,
        zombieCount: zombies.length,
        botCount: bots.length,
        realPercent: totalSessions > 0 ? Math.round((realUsers.length / totalSessions) * 100) : 0,
        zombiePercent: totalSessions > 0 ? Math.round((zombies.length / totalSessions) * 100) : 0,
        botPercent: totalSessions > 0 ? Math.round((bots.length / totalSessions) * 100) : 0,
        addToCartCount,
        conversionCount,
        avgTimeOnPage: realUsers.length > 0
          ? Math.round(realUsers.reduce((sum, v) => sum + v.timeOnPage, 0) / realUsers.length / 1000)
          : 0,
        avgScrollDepth: realUsers.length > 0
          ? Math.round(realUsers.reduce((sum, v) => sum + v.scrollDepth, 0) / realUsers.length)
          : 0,
      };

      const sourceCategories = new Map<string, {
        sessions: number;
        real: number;
        zombie: number;
        bot: number;
        avgTime: number;
        avgScroll: number;
        atc: number;
        conversions: number;
      }>();

      visits.forEach((visit) => {
        const category = visit.sourceCategory || "Unknown";
        if (!sourceCategories.has(category)) {
          sourceCategories.set(category, {
            sessions: 0,
            real: 0,
            zombie: 0,
            bot: 0,
            avgTime: 0,
            avgScroll: 0,
            atc: 0,
            conversions: 0,
          });
        }
        const s = sourceCategories.get(category)!;
        s.sessions++;
        if (visit.visitorType === "REAL") s.real++;
        else if (visit.visitorType === "ZOMBIE") s.zombie++;
        else if (visit.visitorType === "BOT") s.bot++;
        if (visit.addedToCart) s.atc++;
        if (visit.converted) s.conversions++;
        s.avgTime += visit.timeOnPage;
        s.avgScroll += visit.scrollDepth;
      });

      const sourceStats = Array.from(sourceCategories.entries())
        .map(([category, s]) => ({
          category,
          sessions: s.sessions,
          real: s.real,
          zombie: s.zombie,
          bot: s.bot,
          avgTime: s.sessions > 0 ? Math.round(s.avgTime / s.sessions / 1000) : 0,
          avgScroll: s.sessions > 0 ? Math.round(s.avgScroll / s.sessions) : 0,
          atcRate: s.real > 0 ? Math.round((s.atc / s.real) * 100) : 0,
          convRate: s.real > 0 ? Math.round((s.conversions / s.real) * 100) : 0,
        }))
        .sort((a, b) => b.sessions - a.sessions);

      const pdf = await generatePDF(snapshot.project, stats, sourceStats, snapshotInfo);
      const filename = sanitizeFilename(snapshot.project.productHandle);
      return new Response(Buffer.from(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}-snapshot-${snapshot.number}-report.pdf"`,
        },
      });
    }

    return new Response("Invalid format. Use ?format=csv or ?format=pdf", { status: 400 });
  } catch (error) {
    console.error("Export error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : "";
    return new Response(`Export failed: ${msg}\n\nStack: ${stack}`, {
      status: 500,
      headers: { "Content-Type": "text/plain" }
    });
  } finally {
    await prisma.$disconnect();
  }
};
