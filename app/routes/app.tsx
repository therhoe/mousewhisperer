import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Ensure the web pixel is activated with the correct apiEndpoint setting.
  // This is required for conversion tracking (checkout_completed events).
  // The mutation is idempotent — if the pixel already exists, we ignore the error.
  const appUrl = process.env.SHOPIFY_APP_URL || "https://mousewhisperer.vercel.app";
  const trackingEndpoint = `${appUrl}/api/track`;

  try {
    await admin.graphql(
      `#graphql
        mutation webPixelCreate($webPixel: WebPixelInput!) {
          webPixelCreate(webPixel: $webPixel) {
            userErrors {
              code
              field
              message
            }
            webPixel {
              id
              settings
            }
          }
        }
      `,
      {
        variables: {
          webPixel: {
            settings: JSON.stringify({ apiEndpoint: trackingEndpoint }),
          },
        },
      },
    );
  } catch {
    // Pixel already exists or other non-critical error — safe to ignore
  }

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        <Link to="/app/insights">Insights Board</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
