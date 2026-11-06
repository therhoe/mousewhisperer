import { useEffect } from "react";
import { useNavigate } from "react-router";
import { interceptBackNavigation } from "../../utils/navigation";
import { useI18n } from "../../utils/i18n";

/**
 * The screen's Back control, shown in the admin title bar by s-page.
 * `parentPath` is where Back goes when the screen was opened fresh; the
 * interceptor below decides between that and a real Back step.
 */
export function BackAction({ parentPath }: { parentPath: string }) {
  const { t } = useI18n();
  return (
    <s-link slot="breadcrumb-actions" href={parentPath} data-snapshot-back="">
      {t("Back")}
    </s-link>
  );
}

function historyIndex(): unknown {
  try {
    return window.history.state?.idx;
  } catch {
    return null;
  }
}

/**
 * Polaris turns a click on an in-app link into a `shopify:navigate` event and
 * the AppProvider pushes its href. For Back links this capture listener runs
 * first, stops that push and steps back instead. Install once, in the app frame.
 */
export function useBackInterceptor() {
  const navigate = useNavigate();
  useEffect(() => {
    const onNavigate = (event: Event) => {
      const target = interceptBackNavigation(event, historyIndex());
      if (!target) return;
      if (target.kind === "pop") navigate(-1);
      else navigate(target.to, { replace: true });
    };
    document.addEventListener("shopify:navigate", onNavigate, true);
    return () => document.removeEventListener("shopify:navigate", onNavigate, true);
  }, [navigate]);
}
