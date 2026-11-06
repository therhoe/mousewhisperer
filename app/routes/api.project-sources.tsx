import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { type LoaderFunctionArgs } from "react-router";
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
  return Response.json(
    { sources },
    { headers: { "Cache-Control": "private, no-store" } },
  );
};

// Fetchers reach this route as a single-fetch .data request; Shopify needs
// these headers there so App Bridge can re-authenticate an expired session.
export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
