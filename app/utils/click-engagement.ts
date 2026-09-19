export type ImageEngagementItem = {
  key: string;
  label: string;
  imageUrl: string | null;
  clickCount: number;
  sessionCount: number;
  sessionPercent: number;
  averageClickTimeSeconds: number | null;
};

type ClickEngagementRow = {
  ctaClicks: string | null;
  sessionId?: string | null;
};

type TrackedClick = {
  label?: string;
  tag?: string;
  href?: string | null;
  time?: number;
  zone?: string;
};

function parseTrackedClicks(
  raw: string | null,
): TrackedClick[] | Record<string, unknown> | null {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}

  return null;
}

function categorizeClick(click: TrackedClick): string {
  const zone = (click.zone || "").toLowerCase();
  if (zone === "header") return "Header";
  if (zone === "footer") return "Footer";
  if (zone === "widget") return "Widget";

  const label = (click.label || "").toLowerCase();
  const tag = (click.tag || "").toLowerCase();

  if (
    tag === "img" ||
    /image|gallery|zoom|slide|photo|thumbnail|lightbox|carousel/i.test(label)
  ) {
    return "Image";
  }
  if (/review|rating|star|testimonial|recommend/i.test(label)) {
    return "Widget";
  }
  if (
    tag === "a" &&
    click.href &&
    !/add to cart|buy|next|prev|subscribe|more/i.test(label)
  ) {
    return "Link";
  }
  return "Button";
}

function canonicalImageKey(value?: string | null) {
  if (!value) return null;

  try {
    const url = new URL(value);
    url.hash = "";
    ["width", "height", "crop", "pad_color"].forEach((key) =>
      url.searchParams.delete(key),
    );
    url.pathname = url.pathname
      .replace(
        /_(?:pico|icon|thumb|small|compact|medium|large|grande|original|master)(?=\.[^./]+$)/i,
        "",
      )
      .replace(/_(?:\d+x\d+|\d+x|x\d+)(?:_crop_[a-z]+)?(?=\.[^./]+$)/i, "");
    return url.toString();
  } catch {
    return value;
  }
}

function imageLabel(click: TrackedClick, imageUrl: string | null) {
  const label = (click.label || "").trim();
  if (label && label.toLowerCase() !== "image") return label;

  if (imageUrl) {
    try {
      const filename = decodeURIComponent(
        new URL(imageUrl).pathname.split("/").pop() || "",
      )
        .replace(/\.[a-z0-9]+$/i, "")
        .replace(/[-_]+/g, " ")
        .trim();
      if (filename) return filename;
    } catch {}
  }

  return label || "Storefront image";
}

export function buildClickEngagement(
  rows: ClickEngagementRow[],
  totalSessions: number,
) {
  const categoryMap = new Map<string, Map<string, number>>();
  const imageMap = new Map<
    string,
    {
      key: string;
      label: string;
      imageUrl: string | null;
      clickCount: number;
      sessionCount: number;
      clickTimeTotal: number;
      clickTimeSamples: number;
    }
  >();

  const addCategoryCount = (category: string, label: string, count: number) => {
    if (!categoryMap.has(category)) categoryMap.set(category, new Map());
    const categoryItems = categoryMap.get(category)!;
    categoryItems.set(label, (categoryItems.get(label) || 0) + count);
  };

  const imageKeysSeenBySession = new Map<string, Set<string>>();

  rows.forEach((row, rowIndex) => {
    const sessionKey = row.sessionId || `row:${rowIndex}`;
    const imageKeysSeenThisSession =
      imageKeysSeenBySession.get(sessionKey) || new Set<string>();
    imageKeysSeenBySession.set(sessionKey, imageKeysSeenThisSession);
    const clickPayload = parseTrackedClicks(row.ctaClicks);

    if (!clickPayload) return;
    if (!Array.isArray(clickPayload)) {
      Object.entries(clickPayload).forEach(([label, count]) => {
        const numericCount = Number(count);
        if (!Number.isFinite(numericCount) || numericCount <= 0) return;
        addCategoryCount("Button", label, Math.floor(numericCount));
      });
      return;
    }

    clickPayload.forEach((click) => {
      if (!click.label) return;
      const category = categorizeClick(click);
      const label = (click.label || category).trim() || category;
      addCategoryCount(category, label, 1);

      if (category !== "Image") return;

      const capturedUrl = click.href || null;
      const canonicalUrl = canonicalImageKey(capturedUrl);
      const key = canonicalUrl || `label:${label.toLowerCase()}`;
      const existing = imageMap.get(key) || {
        key,
        label: imageLabel(click, capturedUrl),
        imageUrl: capturedUrl,
        clickCount: 0,
        sessionCount: 0,
        clickTimeTotal: 0,
        clickTimeSamples: 0,
      };

      existing.clickCount += 1;
      if (!imageKeysSeenThisSession.has(key)) {
        existing.sessionCount += 1;
        imageKeysSeenThisSession.add(key);
      }
      if (Number.isFinite(click.time) && Number(click.time) >= 0) {
        existing.clickTimeTotal += Number(click.time);
        existing.clickTimeSamples += 1;
      }
      imageMap.set(key, existing);
    });
  });

  const ctaByCategory: Record<
    string,
    Array<{ label: string; count: number }>
  > = {};
  const categoryTotals: Record<string, number> = {};
  categoryMap.forEach((entries, category) => {
    categoryTotals[category] = Array.from(entries.values()).reduce(
      (sum, count) => sum + count,
      0,
    );
    ctaByCategory[category] = Array.from(entries.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  });

  const imageEngagement: ImageEngagementItem[] = Array.from(imageMap.values())
    .map((item) => ({
      key: item.key,
      label: item.label,
      imageUrl: item.imageUrl,
      clickCount: item.clickCount,
      sessionCount: item.sessionCount,
      sessionPercent:
        totalSessions > 0
          ? Math.round((item.sessionCount / totalSessions) * 1000) / 10
          : 0,
      averageClickTimeSeconds:
        item.clickTimeSamples > 0
          ? Math.round(item.clickTimeTotal / item.clickTimeSamples / 1000)
          : null,
    }))
    .sort(
      (a, b) =>
        b.clickCount - a.clickCount ||
        b.sessionCount - a.sessionCount ||
        a.label.localeCompare(b.label),
    );

  return { ctaByCategory, categoryTotals, imageEngagement };
}

export type EngagementOutcomeItem = {
  key: string;
  label: string;
  imageUrl: string | null;
  clicks: number;
  sessions: number | null;
  carts: number | null;
  purchases: number | null;
};
export type EngagementOutcomes = {
  version: 1;
  groups: Array<{ category: string; items: EngagementOutcomeItem[] }>;
  maxSessions: number;
};
type OutcomeRow = {
  sessionId?: string | null;
  ctaClicks?: string | null;
  addedToCart?: boolean;
  converted?: boolean;
};

// Callers supply ONE tenant/capture/filter (and, for A/B, ONE variant).
// Commerce is deliberately not inferred from button names or click timing.
export function buildEngagementOutcomes(
  clickRows: OutcomeRow[],
  commerceRows: OutcomeRow[] = clickRows,
): EngagementOutcomes {
  const commerce = new Map<
    string,
    { cart: boolean; purchase: boolean; known: boolean }
  >();
  for (const row of commerceRows) {
    if (!row.sessionId) continue;
    const prior = commerce.get(row.sessionId);
    commerce.set(row.sessionId, {
      cart: Boolean(prior?.cart || row.addedToCart),
      purchase: Boolean(prior?.purchase || row.converted),
      known: Boolean(
        prior?.known ||
        (typeof row.addedToCart === "boolean" &&
          typeof row.converted === "boolean"),
      ),
    });
  }
  const groups = new Map<
    string,
    Map<
      string,
      {
        label: string;
        imageUrl: string | null;
        clicks: number;
        sessions: Set<string>;
        missingId: boolean;
      }
    >
  >();
  for (const row of clickRows) {
    const payload = parseTrackedClicks(row.ctaClicks || null);
    if (!payload) continue;
    const clicks: Array<{ click: TrackedClick; count: number }> = Array.isArray(
      payload,
    )
      ? payload
          .filter((click) => click && typeof click.label === "string")
          .map((click) => ({
            click: {
              label: click.label,
              tag: typeof click.tag === "string" ? click.tag : undefined,
              zone: typeof click.zone === "string" ? click.zone : undefined,
              href: typeof click.href === "string" ? click.href : null,
            },
            count: 1,
          }))
      : Object.entries(payload)
          .filter(
            ([, count]) => Number.isFinite(Number(count)) && Number(count) >= 1,
          )
          .map(([label, count]) => ({
            click: { label, tag: "button" },
            count: Math.floor(Number(count)),
          }));
    for (const { click, count } of clicks) {
      if (!click.label?.trim()) continue;
      const category = categorizeClick(click);
      const imageUrl =
        category === "Image" && typeof click.href === "string"
          ? click.href
          : null;
      const label =
        category === "Image" ? imageLabel(click, imageUrl) : click.label.trim();
      const key =
        category === "Image"
          ? canonicalImageKey(imageUrl) || `label:${label}`
          : JSON.stringify([label, click.href || ""]);
      const items = groups.get(category) || new Map();
      groups.set(category, items);
      const item = items.get(key) || {
        label,
        imageUrl,
        clicks: 0,
        sessions: new Set<string>(),
        missingId: false,
      };
      item.clicks += count;
      if (row.sessionId) item.sessions.add(row.sessionId);
      else item.missingId = true;
      items.set(key, item);
    }
  }
  let maxSessions = 1;
  const order = ["Button", "Link", "Widget", "Image", "Header", "Footer"];
  return {
    version: 1,
    groups: Array.from(groups, ([category, items]) => ({
      category,
      items: Array.from(items, ([key, item]) => {
        const sessions = item.missingId ? null : item.sessions.size;
        const known =
          sessions !== null &&
          [...item.sessions].every((id) => commerce.get(id)?.known);
        if (sessions !== null) maxSessions = Math.max(maxSessions, sessions);
        return {
          key,
          label: item.label,
          imageUrl: item.imageUrl,
          clicks: item.clicks,
          sessions,
          carts: known
            ? [...item.sessions].filter((id) => commerce.get(id)?.cart).length
            : null,
          purchases: known
            ? [...item.sessions].filter((id) => commerce.get(id)?.purchase)
                .length
            : null,
        };
      }).sort((a, b) => b.clicks - a.clicks || a.label.localeCompare(b.label)),
    })).sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category)),
    // Getter avoided: return plain serializable data after the map above runs.
    maxSessions,
  };
}
