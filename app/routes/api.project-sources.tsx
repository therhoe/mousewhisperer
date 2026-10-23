import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { listProjectSources } from "../utils/growth-projects.server";
import { cachedValue } from "../utils/loader-cache.server";
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const sources = await cachedValue(
    `project-source-options:${session.shop}`,
    300_000,
    () => listProjectSources(session.shop),
  );
  return json(
    { sources },
    { headers: { "Cache-Control": "private, no-store" } },
  );
};
