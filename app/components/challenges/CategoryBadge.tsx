import { Badge } from "@shopify/polaris";
import type { InsightCategory } from "@prisma/client";

const CATEGORY_MAP: Record<InsightCategory, { label: string; tone: "info" | "warning" | "critical" | "attention" | "success" }> = {
  HIGH_BOT_TRAFFIC: { label: "High Bot Traffic", tone: "critical" },
  LOW_ENGAGEMENT: { label: "Low Engagement", tone: "warning" },
  SOURCE_QUALITY: { label: "Source Quality", tone: "info" },
  CONVERSION_DROP: { label: "Conversion Drop", tone: "attention" },
  GENERAL: { label: "General", tone: "info" },
};

export function CategoryBadge({ category }: { category: InsightCategory }) {
  const config = CATEGORY_MAP[category] || CATEGORY_MAP.GENERAL;
  return <Badge tone={config.tone}>{config.label}</Badge>;
}
