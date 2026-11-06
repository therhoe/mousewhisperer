import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import type { AppProvider } from "@shopify/polaris";

type LinkLikeComponent = NonNullable<
  ComponentProps<typeof AppProvider>["linkComponent"]
>;

type PolarisLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  url: string;
  external?: boolean;
  children?: ReactNode;
};

/**
 * The link Polaris React renders for every `url`, so in-app links navigate
 * with React Router instead of reloading the embedded app. With a custom
 * link component Polaris passes `external` through untouched, so external
 * links get target/rel here (Polaris's own <a> would add them otherwise).
 */
const PolarisLinkComponent = forwardRef<HTMLAnchorElement, PolarisLinkProps>(
  function PolarisLink({ url, external, target, rel, children, ...rest }, ref) {
    return (
      <Link
        {...rest}
        to={url}
        ref={ref}
        target={external ? "_blank" : target}
        rel={external ? "noopener noreferrer" : rel}
      >
        {children}
      </Link>
    );
  },
);

// Polaris types its link props as React.HTMLProps (string refs allowed), which a
// forwardRef component can't declare; the runtime contract is the same.
export const PolarisLink = PolarisLinkComponent as unknown as LinkLikeComponent;
