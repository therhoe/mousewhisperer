// Resource routes that need an admin session cannot be opened as plain links
// in the embedded app; fetch them with the App Bridge token and save the blob.
export async function downloadAuthenticatedFile({
  url,
  filename,
  getIdToken,
}: {
  url: string;
  filename: string;
  getIdToken: () => Promise<string>;
}) {
  const token = await getIdToken();
  if (!token) throw new Error("App authentication is unavailable.");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Download failed (${response.status}).`);
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Give the browser time to consume the blob before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}
