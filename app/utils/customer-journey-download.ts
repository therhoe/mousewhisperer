// Resource downloads must not navigate through Remix/App Bridge: that would
// render this loader-only route as a blank embedded app page.
export async function downloadCustomerJourney({
  snapshotId,
  sessionId,
  getIdToken,
  signal,
}: {
  snapshotId: string;
  sessionId: string;
  getIdToken: () => Promise<string>;
  signal: AbortSignal;
}) {
  if (![snapshotId, sessionId].every((id) => /^[a-zA-Z0-9_-]+$/.test(id))) {
    throw new Error("Invalid journey identifier.");
  }
  signal.throwIfAborted();
  const token = await getIdToken();
  signal.throwIfAborted();
  if (!token) throw new Error("App authentication is unavailable.");
  const response = await fetch(
    `/app/customer-snapshots/${snapshotId}/journey/${sessionId}/export`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal,
    },
  );
  if (
    !response.ok ||
    !/^application\/json(?:\s*;|$)/i.test(
      response.headers.get("content-type") || "",
    )
  )
    throw new Error("Journey export is unavailable.");
  const data = await response.json();
  signal.throwIfAborted();
  if (
    data?.id !== sessionId ||
    data?.snapshotId !== snapshotId ||
    !Array.isArray(data.pages) ||
    !Array.isArray(data.events)
  ) {
    throw new Error("Journey export is invalid.");
  }
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `customer-journey-${sessionId}.json`;
  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Give the browser time to consume the blob before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
