// ══════════════════════════════════════════════════════
// SHARED MOCK DATA — used by index-page and audits-page
// ══════════════════════════════════════════════════════

export type ResourceType = "PRODUCT" | "COLLECTION" | "PAGE" | "BLOG";

export type Project = {
  id: string;
  productTitle: string;
  resourceType: ResourceType;
  status: string;
  snapshotName: string;
  snapshotCount: number;
  targetVisitors: number;
  realCount: number;
  zombieCount: number;
  botCount: number;
  progress: number;
  // Products use ATC, everyone else uses CTR
  atcRate?: number;
  ctrRate?: number;
  cvrRate: number;
  revenue: number;
};

export const PROJECTS: Project[] = [
  // ── Collections ──
  {
    id: "p1",
    productTitle: "Footwear",
    resourceType: "COLLECTION",
    status: "COMPLETED",
    snapshotName: "Baseline",
    snapshotCount: 1,
    targetVisitors: 500,
    realCount: 500,
    zombieCount: 129,
    botCount: 13,
    progress: 100,
    ctrRate: 12.4,
    cvrRate: 3.2,
    revenue: 4850,
  },
  {
    id: "p3",
    productTitle: "Correct Toes\u00AE The Original",
    resourceType: "COLLECTION",
    status: "COMPLETED",
    snapshotName: "Testing",
    snapshotCount: 2,
    targetVisitors: 100,
    realCount: 100,
    zombieCount: 51,
    botCount: 2,
    progress: 100,
    ctrRate: 8.1,
    cvrRate: 2.1,
    revenue: 1520,
  },
  {
    id: "p4",
    productTitle: "Accessories",
    resourceType: "COLLECTION",
    status: "COMPLETED",
    snapshotName: "Test",
    snapshotCount: 1,
    targetVisitors: 100,
    realCount: 100,
    zombieCount: 43,
    botCount: 5,
    progress: 100,
    ctrRate: 15.3,
    cvrRate: 4.5,
    revenue: 2100,
  },
  // ── Products ──
  {
    id: "p2",
    productTitle: "Correct Toes\u00AE The Original Toe Spacer",
    resourceType: "PRODUCT",
    status: "COMPLETED",
    snapshotName: "Numero tres",
    snapshotCount: 3,
    targetVisitors: 250,
    realCount: 250,
    zombieCount: 80,
    botCount: 3,
    progress: 100,
    atcRate: 18.5,
    cvrRate: 6.8,
    revenue: 12340,
  },
  {
    id: "p5",
    productTitle: "Closeout Sale | The Original Toe Spacer",
    resourceType: "PRODUCT",
    status: "COMPLETED",
    snapshotName: "Test",
    snapshotCount: 1,
    targetVisitors: 100,
    realCount: 100,
    zombieCount: 25,
    botCount: 7,
    progress: 100,
    atcRate: 9.2,
    cvrRate: 2.8,
    revenue: 890,
  },
  {
    id: "p6",
    productTitle: "Correct Toes StableToe\u00AE",
    resourceType: "PRODUCT",
    status: "COMPLETED",
    snapshotName: "Testing Conversion",
    snapshotCount: 3,
    targetVisitors: 250,
    realCount: 250,
    zombieCount: 76,
    botCount: 9,
    progress: 100,
    atcRate: 14.2,
    cvrRate: 5.1,
    revenue: 8750,
  },
  {
    id: "p7",
    productTitle: "Correct Toes SPORT\u00AE",
    resourceType: "PRODUCT",
    status: "COMPLETED",
    snapshotName: "+VidLibrary",
    snapshotCount: 4,
    targetVisitors: 500,
    realCount: 500,
    zombieCount: 10,
    botCount: 13,
    progress: 100,
    atcRate: 22.1,
    cvrRate: 8.4,
    revenue: 28900,
  },
  // ── Pages ──
  {
    id: "pg1",
    productTitle: "About Us",
    resourceType: "PAGE",
    status: "COMPLETED",
    snapshotName: "Redesign launch",
    snapshotCount: 2,
    targetVisitors: 300,
    realCount: 300,
    zombieCount: 64,
    botCount: 8,
    progress: 100,
    ctrRate: 6.8,
    cvrRate: 1.4,
    revenue: 1120,
  },
  {
    id: "pg2",
    productTitle: "Our Foot Health Mission",
    resourceType: "PAGE",
    status: "COMPLETED",
    snapshotName: "Baseline",
    snapshotCount: 1,
    targetVisitors: 200,
    realCount: 200,
    zombieCount: 41,
    botCount: 4,
    progress: 100,
    ctrRate: 11.2,
    cvrRate: 2.6,
    revenue: 1980,
  },
  {
    id: "pg3",
    productTitle: "Size & Fit Guide",
    resourceType: "PAGE",
    status: "ACTIVE",
    snapshotName: "Post-update",
    snapshotCount: 1,
    targetVisitors: 400,
    realCount: 287,
    zombieCount: 58,
    botCount: 6,
    progress: 72,
    ctrRate: 18.9,
    cvrRate: 5.7,
    revenue: 3420,
  },
  // ── Blogs ──
  {
    id: "bl1",
    productTitle: "Why Toe Spacers Work",
    resourceType: "BLOG",
    status: "COMPLETED",
    snapshotName: "Evergreen",
    snapshotCount: 2,
    targetVisitors: 500,
    realCount: 500,
    zombieCount: 112,
    botCount: 15,
    progress: 100,
    ctrRate: 9.4,
    cvrRate: 2.2,
    revenue: 2480,
  },
  {
    id: "bl2",
    productTitle: "Running Form Myths, Debunked",
    resourceType: "BLOG",
    status: "COMPLETED",
    snapshotName: "Baseline",
    snapshotCount: 1,
    targetVisitors: 250,
    realCount: 250,
    zombieCount: 73,
    botCount: 9,
    progress: 100,
    ctrRate: 7.1,
    cvrRate: 1.8,
    revenue: 910,
  },
  {
    id: "bl3",
    productTitle: "The Case Against Narrow Shoes",
    resourceType: "BLOG",
    status: "COMPLETED",
    snapshotName: "Viral push",
    snapshotCount: 3,
    targetVisitors: 1000,
    realCount: 1000,
    zombieCount: 248,
    botCount: 41,
    progress: 100,
    ctrRate: 14.8,
    cvrRate: 4.1,
    revenue: 7640,
  },
];

export type Category = "products" | "collections" | "pages" | "blogs";

export const CATEGORY_RESOURCE: Record<Category, ResourceType> = {
  products: "PRODUCT",
  collections: "COLLECTION",
  pages: "PAGE",
  blogs: "BLOG",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  products: "Products",
  collections: "Collections",
  pages: "Pages",
  blogs: "Blogs",
};

// Products use ATC; everyone else uses CTR
export function rateMetric(p: Project): { label: string; value: number | undefined } {
  if (p.resourceType === "PRODUCT") return { label: "ATC", value: p.atcRate };
  return { label: "CTR", value: p.ctrRate };
}
