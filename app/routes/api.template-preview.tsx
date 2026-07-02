import type { LoaderFunctionArgs } from "@remix-run/node";
import { existsSync } from "node:fs";
import { verifyTemplatePreviewSignature } from "../utils/ab-tests.server";

const VIEWPORT = { width: 1440, height: 1000 };
const SCREENSHOT_HEIGHT = 820;
const SCREENSHOT_TIMEOUT_MS = 18000;
const LOCAL_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

const memoryCache = new Map<
  string,
  { body: Uint8Array; contentType: string; expiresAt: number }
>();
const pendingRenders = new Map<string, Promise<Uint8Array>>();
let previewBrowserPromise: Promise<any> | null = null;
let previewBrowserCloseTimer: NodeJS.Timeout | null = null;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const requestUrl = new URL(request.url);
  const targetUrl = requestUrl.searchParams.get("u") || "";
  const signature = requestUrl.searchParams.get("s") || "";

  if (!targetUrl || !verifyTemplatePreviewSignature(targetUrl, signature)) {
    return fallbackPreview("Preview unavailable", 403);
  }

  const safeUrl = parseSafePreviewUrl(targetUrl);
  if (!safeUrl) {
    return fallbackPreview("Preview URL blocked", 400);
  }

  const cacheKey = safeUrl.toString();
  const cached = memoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return imageResponse(cached.body, cached.contentType, "HIT");
  }

  try {
    let renderPromise = pendingRenders.get(cacheKey);
    if (!renderPromise) {
      renderPromise = renderStorefrontScreenshot(safeUrl.toString()).finally(() => {
        pendingRenders.delete(cacheKey);
      });
      pendingRenders.set(cacheKey, renderPromise);
    }

    const body = await renderPromise;
    memoryCache.set(cacheKey, {
      body,
      contentType: "image/jpeg",
      expiresAt: Date.now() + 1000 * 60 * 60,
    });
    return imageResponse(body, "image/jpeg", "MISS");
  } catch (error) {
    console.error("[MW Template Preview] Screenshot failed", {
      url: safeUrl.toString(),
      error: error instanceof Error ? error.message : String(error),
    });
    return fallbackPreview(safeUrl.hostname, 200);
  }
};

function imageResponse(body: Uint8Array, contentType: string, cacheStatus: string) {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "X-MW-Preview-Cache": cacheStatus,
    },
  });
}

function parseSafePreviewUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;

    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local") ||
      isPrivateIPv4(host)
    ) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

function isPrivateIPv4(host: string) {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 127 ||
    a === 0
  );
}

async function renderStorefrontScreenshot(targetUrl: string) {
  const browser = await getPreviewBrowser();
  const page = await browser.newPage();

  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 MouseWhispererPreview/1.0",
    );
    await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 1 });
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: SCREENSHOT_TIMEOUT_MS,
    });
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      window.scrollTo(0, 0);
    });

    return (await page.screenshot({
      type: "jpeg",
      quality: 82,
      clip: {
        x: 0,
        y: 0,
        width: VIEWPORT.width,
        height: SCREENSHOT_HEIGHT,
      },
    })) as Uint8Array;
  } finally {
    await page.close().catch(() => undefined);
    schedulePreviewBrowserClose(browser);
  }
}

async function getPreviewBrowser() {
  if (previewBrowserCloseTimer) {
    clearTimeout(previewBrowserCloseTimer);
    previewBrowserCloseTimer = null;
  }

  if (previewBrowserPromise) {
    const browser = await previewBrowserPromise.catch(() => null);
    if (browser?.isConnected?.()) return browser;
    previewBrowserPromise = null;
  }

  previewBrowserPromise = launchPreviewBrowser();
  return previewBrowserPromise;
}

async function launchPreviewBrowser() {
  const puppeteer = await import("puppeteer-core");
  const chromium = await import("@sparticuz/chromium");
  const isServerless =
    Boolean(process.env.VERCEL) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
  const executablePath = await resolveChromiumExecutablePath(chromium.default);

  return puppeteer.default.launch({
    args: isServerless
      ? chromium.default.args
      : [
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-setuid-sandbox",
          "--no-sandbox",
        ],
    defaultViewport: VIEWPORT,
    executablePath,
    headless: true,
  });
}

function schedulePreviewBrowserClose(browser: any) {
  if (previewBrowserCloseTimer) clearTimeout(previewBrowserCloseTimer);
  previewBrowserCloseTimer = setTimeout(async () => {
    const currentBrowser = await previewBrowserPromise?.catch(() => null);
    if (currentBrowser === browser) {
      previewBrowserPromise = null;
      await browser.close().catch(() => undefined);
    }
  }, 60000);

  if (typeof previewBrowserCloseTimer.unref === "function") {
    previewBrowserCloseTimer.unref();
  }
}

async function resolveChromiumExecutablePath(chromium: any) {
  if (process.env.CHROME_EXECUTABLE_PATH) {
    return process.env.CHROME_EXECUTABLE_PATH;
  }

  for (const path of LOCAL_CHROME_PATHS) {
    if (existsSync(path)) return path;
  }

  return chromium.executablePath();
}

function fallbackPreview(label: string, status = 200) {
  const safeLabel = escapeSvg(label || "Preview unavailable");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="820" viewBox="0 0 1440 820">
  <rect width="1440" height="820" fill="#f4f6f8"/>
  <rect x="72" y="64" width="1296" height="692" rx="28" fill="#ffffff" stroke="#d9d9d9" stroke-width="2"/>
  <rect x="144" y="146" width="300" height="300" rx="24" fill="#d9edf7"/>
  <rect x="520" y="164" width="680" height="38" rx="19" fill="#1f2933"/>
  <rect x="520" y="246" width="820" height="26" rx="13" fill="#c9c9c9"/>
  <rect x="520" y="318" width="640" height="26" rx="13" fill="#dddddd"/>
  <rect x="520" y="420" width="300" height="62" rx="16" fill="#111111"/>
  <text x="144" y="610" font-family="Inter, Arial, sans-serif" font-size="42" font-weight="700" fill="#202223">Template preview</text>
  <text x="144" y="670" font-family="Inter, Arial, sans-serif" font-size="30" fill="#6d7175">${safeLabel}</text>
</svg>`;

  return new Response(svg, {
    status,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

function escapeSvg(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
