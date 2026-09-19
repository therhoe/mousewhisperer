export const PAGE_SNAPSHOTS_PATH = "/app/page-snapshots";

export const PAGE_SNAPSHOT_CATEGORIES = [
  { key: "products", label: "Products" },
  { key: "collections", label: "Collections" },
  { key: "homepage", label: "Homepage" },
  { key: "pages", label: "Pages" },
  { key: "blogs", label: "Blogs" },
] as const;

export function getPageSnapshotCategoryPath(category: string) {
  return `${PAGE_SNAPSHOTS_PATH}/${category}`;
}

export function getPageSnapshotResourcePath(resourceType: string) {
  const categories: Record<string, string> = {
    PRODUCT: "products",
    COLLECTION: "collections",
    HOMEPAGE: "homepage",
    PAGE: "pages",
    BLOG: "blogs",
  };
  return getPageSnapshotCategoryPath(categories[resourceType] || "products");
}

export function isPageSnapshotsPath(pathname: string) {
  return (
    pathname === PAGE_SNAPSHOTS_PATH ||
    pathname.startsWith(`${PAGE_SNAPSHOTS_PATH}/`) ||
    pathname.startsWith("/app/audits/") ||
    pathname.startsWith("/app/project/")
  );
}
