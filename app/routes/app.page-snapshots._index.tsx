import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { getPageSnapshotCategoryPath } from "../utils/page-snapshot-navigation";

export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  url.searchParams.delete("_data");
  return redirect(`${getPageSnapshotCategoryPath("products")}${url.search}`);
};
