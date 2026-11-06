import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

// Retired address (spec 4.2): bookmarks and older links land on Plans with
// their query (billing status, embedded params) kept.
export const loader = ({ request }: LoaderFunctionArgs) =>
  redirect(`/app/plans${new URL(request.url).search}`);
