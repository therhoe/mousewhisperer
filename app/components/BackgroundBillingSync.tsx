import { useEffect, useRef, useState } from "react";
import { useNavigation, useRevalidator } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";

export function BackgroundBillingSync() {
  const appBridge = useAppBridge();
  const navigation = useNavigation();
  const { revalidate, state: revalidationState } = useRevalidator();
  const started = useRef(false);
  const controller = useRef<AbortController>();
  const [refreshNeeded, setRefreshNeeded] = useState(false);

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    if (started.current || navigation.state !== "idle") return;
    // Let the page paint and start its useful report before reconciliation.
    const timer = window.setTimeout(() => {
      started.current = true;
      const requestController = new AbortController();
      controller.current = requestController;
      void (async () => {
        try {
          // Use App Bridge's short-lived session token for this app backend.
          // Keep network/auth failures local; a background fetcher action would
          // otherwise replace the entire app with its route error boundary.
          const token = await appBridge.idToken();
          if (requestController.signal.aborted) return;
          const response = await fetch("/api/billing-sync", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
            credentials: "same-origin",
            redirect: "error",
            signal: requestController.signal,
          });
          if (!response.ok) return;
          const result = await response.json();
          if (
            result.billingReconciled === true &&
            result.changed === true &&
            !requestController.signal.aborted
          ) {
            setRefreshNeeded(true);
          }
        } catch {
          // The next app open retries; creation/upgrade guards remain fresh.
        }
      })();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [appBridge, navigation.state]);

  useEffect(() => {
    if (
      !refreshNeeded ||
      navigation.state !== "idle" ||
      revalidationState !== "idle"
    )
      return;
    setRefreshNeeded(false);
    revalidate();
  }, [refreshNeeded, navigation.state, revalidationState, revalidate]);

  return null;
}
