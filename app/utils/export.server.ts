import PDFDocument from "pdfkit";
import type { Visit, Project } from "@prisma/client";

interface SourceStats {
  category: string;
  sessions: number;
  real: number;
  zombie: number;
  bot: number;
  avgTime: number;
  avgScroll: number;
  atcRate: number;
  convRate: number;
}

interface ProjectStats {
  totalSessions: number;
  realCount: number;
  zombieCount: number;
  botCount: number;
  realPercent: number;
  zombiePercent: number;
  botPercent: number;
  addToCartCount: number;
  conversionCount: number;
  avgTimeOnPage: number;
  avgScrollDepth: number;
}

export function generateCSV(
  visits: Visit[],
  project: Pick<Project, "productTitle" | "productHandle">
): string {
  const headers = [
    "Date",
    "Session ID",
    "Visitor Type",
    "Source Category",
    "Source",
    "Medium",
    "Campaign",
    "Time on Page (s)",
    "Scroll Depth (%)",
    "Added to Cart",
    "Converted",
    "Country",
    "City",
    "Region",
    "Device Type",
    "Bot Score",
    "Datacenter IP",
  ];

  const rows = visits.map((visit) => [
    visit.startedAt ? new Date(visit.startedAt).toISOString() : "",
    visit.sessionId,
    visit.visitorType,
    visit.sourceCategory || "",
    visit.source || "",
    visit.medium || "",
    visit.campaign || "",
    Math.round(visit.timeOnPage / 1000).toString(),
    visit.scrollDepth.toString(),
    visit.addedToCart ? "Yes" : "No",
    visit.converted ? "Yes" : "No",
    (visit as any).country || "",
    (visit as any).city || "",
    (visit as any).region || "",
    visit.deviceType || "",
    ((visit as any).botScore || 0).toString(),
    (visit as any).datacenterIP ? "Yes" : "No",
  ]);

  // Escape CSV values
  const escapeCSV = (value: string): string => {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const csvContent = [
    headers.map(escapeCSV).join(","),
    ...rows.map((row) => row.map(escapeCSV).join(",")),
  ].join("\n");

  return csvContent;
}

export async function generatePDF(
  project: Pick<Project, "productTitle" | "productHandle" | "status" | "targetVisitors" | "createdAt">,
  stats: ProjectStats,
  sourceStats: SourceStats[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Title
    doc.fontSize(24).text("Traffic Quality Report", { align: "center" });
    doc.moveDown();

    // Product Info
    doc.fontSize(16).text(project.productTitle, { align: "center" });
    doc.fontSize(10).fillColor("#666").text(`Product: ${project.productHandle}`, { align: "center" });
    doc.text(`Status: ${project.status}`, { align: "center" });
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, { align: "center" });
    doc.fillColor("#000");
    doc.moveDown(2);

    // Overall Stats Section
    doc.fontSize(14).text("Overall Statistics", { underline: true });
    doc.moveDown(0.5);

    const statsTable = [
      ["Total Sessions", stats.totalSessions.toString()],
      ["Real Users", `${stats.realCount} (${stats.realPercent}%)`],
      ["Zombies", `${stats.zombieCount} (${stats.zombiePercent}%)`],
      ["Bots", `${stats.botCount} (${stats.botPercent}%)`],
      ["Add to Cart", stats.addToCartCount.toString()],
      ["Conversions", stats.conversionCount.toString()],
      ["Avg Time on Page", formatTime(stats.avgTimeOnPage)],
      ["Avg Scroll Depth", `${stats.avgScrollDepth}%`],
    ];

    doc.fontSize(10);
    statsTable.forEach(([label, value]) => {
      doc.text(`${label}: ${value}`);
    });
    doc.moveDown(2);

    // Conversion Funnel
    doc.fontSize(14).text("Conversion Funnel", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10);

    const funnelData = [
      { label: "All Sessions", value: stats.totalSessions, pct: 100 },
      { label: "Real Users", value: stats.realCount, pct: stats.realPercent },
      { label: "Added to Cart", value: stats.addToCartCount, pct: stats.totalSessions > 0 ? Math.round((stats.addToCartCount / stats.totalSessions) * 100) : 0 },
      { label: "Conversions", value: stats.conversionCount, pct: stats.totalSessions > 0 ? Math.round((stats.conversionCount / stats.totalSessions) * 100) : 0 },
    ];

    funnelData.forEach((item) => {
      doc.text(`${item.label}: ${item.value} (${item.pct}%)`);
    });
    doc.moveDown(2);

    // Traffic by Source
    doc.fontSize(14).text("Traffic Quality by Source", { underline: true });
    doc.moveDown(0.5);

    if (sourceStats.length === 0) {
      doc.fontSize(10).text("No traffic data available.");
    } else {
      // Table header
      const colWidths = [100, 50, 40, 45, 35, 50, 45, 40, 40];
      const headers = ["Source", "Sessions", "Real", "Zombie", "Bot", "Avg Time", "Scroll", "ATC%", "Conv%"];
      let x = 50;

      doc.fontSize(9).font("Helvetica-Bold");
      headers.forEach((header, i) => {
        doc.text(header, x, doc.y, { width: colWidths[i], continued: i < headers.length - 1 });
        x += colWidths[i];
      });
      doc.font("Helvetica");
      doc.moveDown(0.5);

      // Table rows
      sourceStats.forEach((source) => {
        x = 50;
        const rowData = [
          source.category.substring(0, 15),
          source.sessions.toString(),
          source.real.toString(),
          source.zombie.toString(),
          source.bot.toString(),
          formatTime(source.avgTime),
          `${source.avgScroll}%`,
          `${source.atcRate}%`,
          `${source.convRate}%`,
        ];

        rowData.forEach((cell, i) => {
          doc.text(cell, x, doc.y, { width: colWidths[i], continued: i < rowData.length - 1 });
          x += colWidths[i];
        });
        doc.moveDown(0.3);
      });
    }

    doc.moveDown(2);

    // Footer
    doc.fontSize(8).fillColor("#999").text(
      `Report generated by Crofly - ${new Date().toISOString()}`,
      { align: "center" }
    );

    doc.end();
  });
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
