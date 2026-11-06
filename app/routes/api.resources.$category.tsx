import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

type AvailableResource = {
  id: string;
  title: string;
  handle: string;
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const category = params.category;
  const resources: AvailableResource[] = [];

  if (category === "pages") {
    try {
      const resp = await admin.graphql(`{ pages(first: 50) { edges { node { id title handle } } } }`);
      const data = await resp.json();
      return Response.json({
        category,
        resources: (data.data?.pages?.edges || []).map((edge: any) => ({
          id: edge.node.id,
          title: edge.node.title,
          handle: edge.node.handle,
        })),
      });
    } catch {
      return Response.json({ category, resources });
    }
  }

  if (category === "blogs") {
    try {
      const resp = await admin.graphql(`{ blogs(first: 20) { edges { node { id title handle articles(first: 30) { edges { node { id title handle } } } } } } }`);
      const data = await resp.json();
      const blogs = data.data?.blogs?.edges || [];

      blogs.forEach((blog: any) => {
        resources.push({
          id: blog.node.id,
          title: `${blog.node.title} (Blog Index)`,
          handle: blog.node.handle,
        });

        (blog.node.articles?.edges || []).forEach((article: any) => {
          resources.push({
            id: article.node.id,
            title: article.node.title,
            handle: `${blog.node.handle}/${article.node.handle}`,
          });
        });
      });
    } catch {}

    return Response.json({ category, resources });
  }

  return Response.json({ category, resources }, { status: 404 });
};

// Fetchers reach this route as a single-fetch .data request; Shopify needs
// these headers there so App Bridge can re-authenticate an expired session.
export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
