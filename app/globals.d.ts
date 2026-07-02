import type { AnchorHTMLAttributes, DetailedHTMLProps, HTMLAttributes } from "react";

declare module "*.css";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
      "s-link": DetailedHTMLProps<AnchorHTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export {};
