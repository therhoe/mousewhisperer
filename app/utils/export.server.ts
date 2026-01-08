import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
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

interface SnapshotInfo {
  name: string;
  number: number;
  targetVisitors: number;
}

export function generateCSV(
  visits: Visit[],
  project: Pick<Project, "productTitle" | "productHandle">,
  snapshotInfo?: SnapshotInfo
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
    "Exit Type",
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
    visit.country || "",
    visit.city || "",
    visit.region || "",
    visit.deviceType || "",
    (visit.botScore || 0).toString(),
    visit.datacenterIP ? "Yes" : "No",
    visit.exitType || "",
  ]);

  // Escape CSV values
  const escapeCSV = (value: string): string => {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  // Build metadata header
  const metadataLines = [
    `# Product: ${project.productTitle}`,
    `# Handle: ${project.productHandle}`,
  ];

  if (snapshotInfo) {
    metadataLines.push(`# Snapshot: ${snapshotInfo.name} (#${snapshotInfo.number})`);
    metadataLines.push(`# Target Visitors: ${snapshotInfo.targetVisitors}`);
  }

  metadataLines.push(`# Generated: ${new Date().toISOString()}`);
  metadataLines.push("");

  const csvContent = [
    ...metadataLines,
    headers.map(escapeCSV).join(","),
    ...rows.map((row) => row.map(escapeCSV).join(",")),
  ].join("\n");

  return csvContent;
}

export async function generatePDF(
  project: Pick<Project, "productTitle" | "productHandle" | "createdAt">,
  stats: ProjectStats,
  sourceStats: SourceStats[],
  snapshotInfo?: SnapshotInfo
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const { height } = page.getSize();

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = height - 50;
  const leftMargin = 50;

  // Helper function to draw text
  const drawText = (text: string, x: number, yPos: number, options: { size?: number; font?: typeof font; color?: ReturnType<typeof rgb> } = {}) => {
    const { size = 10, font: textFont = font, color = rgb(0, 0, 0) } = options;
    page.drawText(text, { x, y: yPos, size, font: textFont, color });
  };

  // Title
  drawText("Traffic Quality Report", 200, y, { size: 24, font: boldFont });
  y -= 40;

  // Product Info
  drawText(project.productTitle, leftMargin, y, { size: 16, font: boldFont });
  y -= 20;
  drawText(`Product: ${project.productHandle}`, leftMargin, y, { size: 10, color: rgb(0.4, 0.4, 0.4) });
  y -= 15;

  if (snapshotInfo) {
    drawText(`Snapshot: ${snapshotInfo.name} (#${snapshotInfo.number})`, leftMargin, y, { size: 10, color: rgb(0.4, 0.4, 0.4) });
    y -= 15;
    drawText(`Target: ${snapshotInfo.targetVisitors} real visitors`, leftMargin, y, { size: 10, color: rgb(0.4, 0.4, 0.4) });
    y -= 15;
  }

  drawText(`Generated: ${new Date().toLocaleDateString()}`, leftMargin, y, { size: 10, color: rgb(0.4, 0.4, 0.4) });
  y -= 40;

  // Overall Stats Section
  drawText("Overall Statistics", leftMargin, y, { size: 14, font: boldFont });
  y -= 5;
  page.drawLine({ start: { x: leftMargin, y }, end: { x: leftMargin + 150, y }, thickness: 1, color: rgb(0, 0, 0) });
  y -= 20;

  const statsData = [
    ["Total Sessions", stats.totalSessions.toString()],
    ["Real Users", `${stats.realCount} (${stats.realPercent}%)`],
    ["Zombies", `${stats.zombieCount} (${stats.zombiePercent}%)`],
    ["Bots", `${stats.botCount} (${stats.botPercent}%)`],
    ["Add to Cart", stats.addToCartCount.toString()],
    ["Conversions", stats.conversionCount.toString()],
    ["Avg Time on Page", formatTime(stats.avgTimeOnPage)],
    ["Avg Scroll Depth", `${stats.avgScrollDepth}%`],
  ];

  statsData.forEach(([label, value]) => {
    drawText(`${label}: ${value}`, leftMargin, y);
    y -= 15;
  });
  y -= 20;

  // Conversion Funnel
  drawText("Conversion Funnel", leftMargin, y, { size: 14, font: boldFont });
  y -= 5;
  page.drawLine({ start: { x: leftMargin, y }, end: { x: leftMargin + 130, y }, thickness: 1, color: rgb(0, 0, 0) });
  y -= 20;

  const funnelData = [
    { label: "All Sessions", value: stats.totalSessions, pct: 100 },
    { label: "Real Users", value: stats.realCount, pct: stats.realPercent },
    { label: "Added to Cart", value: stats.addToCartCount, pct: stats.totalSessions > 0 ? Math.round((stats.addToCartCount / stats.totalSessions) * 100) : 0 },
    { label: "Conversions", value: stats.conversionCount, pct: stats.totalSessions > 0 ? Math.round((stats.conversionCount / stats.totalSessions) * 100) : 0 },
  ];

  funnelData.forEach((item) => {
    drawText(`${item.label}: ${item.value} (${item.pct}%)`, leftMargin, y);
    y -= 15;
  });
  y -= 20;

  // Traffic by Source
  drawText("Traffic Quality by Source", leftMargin, y, { size: 14, font: boldFont });
  y -= 5;
  page.drawLine({ start: { x: leftMargin, y }, end: { x: leftMargin + 170, y }, thickness: 1, color: rgb(0, 0, 0) });
  y -= 20;

  if (sourceStats.length === 0) {
    drawText("No traffic data available.", leftMargin, y);
    y -= 20;
  } else {
    // Table header
    const colWidths = [100, 50, 40, 45, 35, 50, 45, 40, 40];
    const headers = ["Source", "Sessions", "Real", "Zombie", "Bot", "Avg Time", "Scroll", "ATC%", "Conv%"];
    let x = leftMargin;

    headers.forEach((header, i) => {
      drawText(header, x, y, { size: 9, font: boldFont });
      x += colWidths[i];
    });
    y -= 15;

    // Table rows (limit to fit on page)
    const maxRows = Math.min(sourceStats.length, 10);
    sourceStats.slice(0, maxRows).forEach((source) => {
      x = leftMargin;
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
        drawText(cell, x, y, { size: 9 });
        x += colWidths[i];
      });
      y -= 12;
    });
  }

  // Footer
  drawText(
    `Report generated by MouseWhisperer - ${new Date().toISOString()}`,
    150,
    30,
    { size: 8, color: rgb(0.6, 0.6, 0.6) }
  );

  return pdfDoc.save();
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
