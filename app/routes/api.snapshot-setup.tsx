import { type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  savedTrackerState,
} from "../utils/snapshot-setup.server";

const headers = { "Cache-Control": "private, no-store" };
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  return Response.json({ tracker: await savedTrackerState(admin) }, { headers });
};
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  return Response.json(
    { error: "Create a Project to start collecting data.", redirectUrl: "/app/projects?create=1" },
    { status: 409, headers },
  );
};
