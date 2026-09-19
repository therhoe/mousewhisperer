import { useCallback, useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

type JsonRequestOptions<T> = {
  getIdToken: () => Promise<string>;
  signal: AbortSignal;
  isData: (value: unknown) => value is T;
};

function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
}

// Only for standalone background JSON resources. Interactive route forms and
// framework loaders continue to use Remix's normal navigation/revalidation.
export async function fetchBackgroundJson<T>(
  path: string,
  { getIdToken, signal, isData }: JsonRequestOptions<T>,
): Promise<T> {
  // Validate before requesting a token, and never follow a redirect with it.
  const invalidCharacter = Array.from(path).some(
    (character) =>
      character === "\\" ||
      character.charCodeAt(0) < 0x20 ||
      character.charCodeAt(0) === 0x7f,
  );
  if (!path.startsWith("/api/") || invalidCharacter) {
    throw new Error("Background requests must use an app API path.");
  }
  const url = new URL(path, window.location.origin);
  if (
    url.origin !== window.location.origin ||
    !url.pathname.startsWith("/api/") ||
    url.hash
  ) {
    throw new Error("Background requests must use an app API path.");
  }
  checkAbort(signal);
  const token = await getIdToken();
  checkAbort(signal);
  if (!token) throw new Error("App authentication is unavailable.");
  const response = await fetch(path, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal,
  });
  checkAbort(signal);
  if (
    !response.ok ||
    !/^application\/(?:[a-z0-9.-]+\+)?json(?:\s*;|$)/i.test(
      response.headers.get("content-type") || "",
    )
  ) {
    throw new Error("The background report is unavailable.");
  }
  const value: unknown = await response.json();
  checkAbort(signal);
  if (!isData(value)) throw new Error("The background report is invalid.");
  return value;
}

type BackgroundJsonState<T> = {
  resourceKey: string;
  data: T | undefined;
  loading: boolean;
  error: string | null;
};

export function useBackgroundJson<T>({
  path,
  isData,
  errorMessage,
  delayMs = 0,
  scopeKey = "",
}: {
  path: string;
  isData: (value: unknown) => value is T;
  errorMessage: string;
  delayMs?: number;
  scopeKey?: string;
}) {
  const appBridge = useAppBridge();
  const resourceKey = `${scopeKey}\u0000${path}`;
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<BackgroundJsonState<T>>({
    resourceKey,
    data: undefined,
    loading: true,
    error: null,
  });

  const reload = useCallback(() => {
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setState((previous) => ({
      resourceKey,
      data: previous.resourceKey === resourceKey ? previous.data : undefined,
      error: previous.resourceKey === resourceKey ? previous.error : null,
      loading: true,
    }));
    void (async () => {
      try {
        const data = await fetchBackgroundJson(path, {
          getIdToken: () => appBridge.idToken(),
          signal: pending.signal,
          isData,
        });
        if (!pending.signal.aborted && controller.current === pending) {
          setState({ resourceKey, data, loading: false, error: null });
        }
      } catch {
        if (!pending.signal.aborted && controller.current === pending) {
          // Do not expose transport errors, response bodies, or auth tokens.
          setState((previous) => ({
            resourceKey,
            data:
              previous.resourceKey === resourceKey ? previous.data : undefined,
            loading: false,
            error: errorMessage,
          }));
        }
      }
    })();
  }, [appBridge, errorMessage, isData, path, resourceKey]);

  useEffect(() => {
    const timer = window.setTimeout(reload, delayMs);
    return () => {
      window.clearTimeout(timer);
      controller.current?.abort();
      controller.current = null;
    };
  }, [delayMs, reload]);

  // A changed tenant/resource never flashes the previous resource's data while
  // its effect is being replaced. Refreshes of the same resource retain data.
  const current =
    state.resourceKey === resourceKey
      ? state
      : { data: undefined, loading: true, error: null };
  return {
    data: current.data,
    loading: current.loading,
    error: current.error,
    reload,
  };
}
