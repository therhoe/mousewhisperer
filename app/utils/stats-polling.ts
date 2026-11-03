export const STATS_POLL_INTERVAL_MS = 30_000;

// Refreshes an active snapshot's stats through the authenticated report
// loader. Skips hidden tabs and overlapping requests; returns a stop function.
export function startStatsPolling({
  url,
  load,
  isVisible,
  isBusy,
  setInterval,
  clearInterval,
}: {
  url: string;
  load: (url: string) => void;
  isVisible: () => boolean;
  isBusy: () => boolean;
  setInterval: (callback: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
}) {
  const id = setInterval(() => {
    if (isVisible() && !isBusy()) load(url);
  }, STATS_POLL_INTERVAL_MS);
  return () => clearInterval(id);
}
