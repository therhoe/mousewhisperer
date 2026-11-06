import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  savedTrackerState,
} from "../utils/snapshot-setup.server";

const noStoreHeaders = { "Cache-Control": "private, no-store" };
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  return Response.json({ tracker: await savedTrackerState(admin) }, { headers: noStoreHeaders });
};
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  return Response.json(
    { error: "Create a Project to start collecting data.", redirectUrl: "/app/projects?create=1" },
    { status: 409, headers: noStoreHeaders },
  );
};

// Fetchers reach this route as a single-fetch .data request; Shopify needs
// these headers there so App Bridge can re-authenticate an expired session.
export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
