import { useEffect, type RefObject } from "react";

/** Adds a listener and returns its cleanup. A missing target is a no-op. */
export function listen(
  target: EventTarget | null | undefined,
  name: string,
  handler: (event: Event) => void,
) {
  if (!target) return () => {};
  target.addEventListener(name, handler);
  return () => target.removeEventListener(name, handler);
}

/**
 * Subscribes to a Polaris element's own event, such as s-table's `nextpage`.
 * React 19 turns an `onNextPage` prop into a listener for "NextPage", which
 * never fires, so these events go through a ref instead.
 */
export function useElementEvent(
  ref: RefObject<EventTarget | null>,
  name: string,
  handler: (event: Event) => void,
) {
  useEffect(() => listen(ref.current, name, handler), [ref, name, handler]);
}
