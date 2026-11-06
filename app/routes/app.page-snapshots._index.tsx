import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getPageSnapshotCategoryPath } from "../utils/page-snapshot-navigation";

export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  url.searchParams.delete("_data");
  return redirect(`${getPageSnapshotCategoryPath("products")}${url.search}`);
};
