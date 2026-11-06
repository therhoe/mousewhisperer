import type { SAppNavAttributes } from "@shopify/app-bridge-types";
import type { ReactNode } from "react";

// App Bridge declares its elements on the global JSX namespace, but React 19's
// TSX reads React.JSX, so the app menu element is declared there too.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": SAppNavAttributes & { children?: ReactNode };
    }
  }
}
