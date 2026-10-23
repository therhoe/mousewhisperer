import { useState } from "react";
import { useI18n } from "../utils/i18n";
import type {
  EngagementOutcomeItem,
  EngagementOutcomes as OutcomeData,
} from "../utils/click-engagement";

const colors: Record<string, string> = {
  Image: "#0ea5e9",
  Button: "#f59e0b",
  Link: "#10b981",
  Widget: "#8b5cf6",
  Header: "#6366f1",
  Footer: "#64748b",
};
const series = ["#3989ff", "#eea12b", "#15996f"];
function Metrics({
  item,
  maximum,
}: {
  item: EngagementOutcomeItem;
  maximum: number;
}) {
  const { t, formatNumber } = useI18n();
  const number = (value: number | null) =>
    value === null ? t("Unavailable") : formatNumber(value);
  const outcome = (value: number | null, total: number | null) =>
    value === null || total === null
      ? t("Unavailable")
      : `${number(value)} (${formatNumber(total ? value / total : 0, { style: "percent", maximumFractionDigits: 1 })})`;
  const values = [item.sessions, item.carts, item.purchases];
  return (
    <>
      <div className="eo-bars" aria-hidden="true">
        {values.map((value, i) => (
          <div key={i} className="eo-track">
            <div
              style={{
                width: `${value === null ? 0 : (value / maximum) * 100}%`,
                background: series[i],
              }}
            />
          </div>
        ))}
      </div>
      <div
        className="eo-number"
        aria-label={`${t("Clicked sessions")}: ${number(item.sessions)}`}
      >
        <span className="eo-mobile-label">{t("Clicked sessions")}</span>
        {number(item.sessions)}
      </div>
      <div
        className="eo-number"
        aria-label={`${t("Added to cart")}: ${outcome(item.carts, item.sessions)}`}
      >
        <span className="eo-mobile-label">{t("Added to cart")}</span>
        {outcome(item.carts, item.sessions)}
      </div>
      <div
        className="eo-number"
        aria-label={`${t("Purchased")}: ${outcome(item.purchases, item.sessions)}`}
      >
        <span className="eo-mobile-label">{t("Purchased")}</span>
        {outcome(item.purchases, item.sessions)}
      </div>
    </>
  );
}
function Group({
  category,
  items,
  maximum,
}: {
  category: string;
  items: EngagementOutcomeItem[];
  maximum: number;
}) {
  const { t, formatNumber } = useI18n();
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(items.length / 5);
  const current = Math.min(page, pageCount - 1);
  return (
    <section
      className="eo-group"
      aria-label={t("{category} engagement outcomes", {
        category: t(category),
      })}
    >
      <h3>
        <span style={{ background: colors[category] }} />
        {t(category)}
      </h3>
      <div className="eo-row eo-head" aria-hidden="true">
        <span>{t("Element · tracked clicks")}</span>
        <span />
        <span>{t("Clicked sessions")}</span>
        <span>{t("Added to cart")}</span>
        <span>{t("Purchased")}</span>
      </div>
      {items.slice(current * 5, current * 5 + 5).map((item) => (
        <div className="eo-row" key={item.key}>
          <div className="eo-label">
            <strong>{item.label}</strong>
            <span>
              {t("{count} clicks", { count: formatNumber(item.clicks) })}
            </span>
          </div>
          <Metrics item={item} maximum={maximum} />
        </div>
      ))}
      {pageCount > 1 && (
        <nav
          className="eo-pagination"
          aria-label={t("{category} elements", { category: t(category) })}
        >
          <button
            type="button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            {t("Previous")}
          </button>
          <span>
            {t("Page {page} of {count}", {
              page: formatNumber(current + 1),
              count: formatNumber(pageCount),
            })}
          </span>
          <button
            type="button"
            disabled={current + 1 === pageCount}
            onClick={() => setPage(current + 1)}
          >
            {t("Next")}
          </button>
        </nav>
      )}
    </section>
  );
}
function ImageCard({
  item,
  maximum,
}: {
  item: EngagementOutcomeItem;
  maximum: number;
}) {
  const { t, formatNumber } = useI18n();
  const [failed, setFailed] = useState(false);
  const safeImage =
    item.imageUrl && /^https?:\/\//i.test(item.imageUrl) ? item.imageUrl : null;
  return (
    <div className="eo-image-card">
      <div className="eo-image">
        {safeImage && !failed ? (
          <img
            src={safeImage}
            alt={item.label}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        ) : (
          <span>{t("Image preview unavailable")}</span>
        )}
      </div>
      <strong>{item.label}</strong>
      <span>{t("{count} clicks", { count: formatNumber(item.clicks) })}</span>
      <div className="eo-image-metrics">
        <Metrics item={item} maximum={maximum} />
      </div>
    </div>
  );
}
export function EngagementOutcomesView({
  data,
  totals,
  audience = "Real and Zombie sessions",
}: {
  data?: OutcomeData | null;
  totals: Record<string, number>;
  audience?: string;
}) {
  const { t, formatNumber } = useI18n();
  if (!data)
    return (
      <p role="status">
        {t(
          "Outcome data is not available for this report yet. Refresh to load it.",
        )}
      </p>
    );
  if (!data.groups.length)
    return <p>{t("No eligible clicked sessions recorded yet.")}</p>;
  const body = ["Image", "Button", "Link", "Widget"].filter(
    (key) => totals[key] > 0,
  );
  const total = body.reduce((sum, key) => sum + totals[key], 0);
  let offset = 0;
  const images = data.groups.find((group) => group.category === "Image");
  return (
    <div className="eo">
      <style>{`
      .eo { color:var(--p-color-text); min-width:0; }
      .eo-layout { display:grid; grid-template-columns:180px minmax(0,1fr); gap:28px; }
      .eo-donut { text-align:center; }
      .eo-donut ul { list-style:none; padding:0; text-align:left; }
      .eo-donut li { display:flex; gap:8px; align-items:center; margin:9px 0; }
      .eo-dot,.eo-group h3>span { width:9px; height:9px; border-radius:50%; display:inline-block; flex-shrink:0; }
      .eo-key { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:14px; font-size:12px; }
      .eo-key span { display:flex; align-items:center; gap:6px; }
      .eo-group { min-width:0; margin-bottom:24px; }
      .eo-group h3 { font-size:16px; display:flex; align-items:center; gap:8px; margin:8px 0; }
      .eo-row { display:grid; grid-template-columns:minmax(120px,1.2fr) minmax(80px,1fr) repeat(3,minmax(84px,.55fr)); gap:12px; align-items:center; padding:12px 0; border-bottom:1px solid var(--p-color-border-secondary,#eee); }
      .eo-head { font-size:11px; color:var(--p-color-text-secondary,#666); }
      .eo-head>span:nth-child(n+3) { text-align:center; }
      .eo-label { min-width:0; display:flex; flex-direction:column; gap:4px; overflow-wrap:anywhere; }
      .eo-label span,.eo-image-card>span { font-size:12px; color:var(--p-color-text-secondary,#666); }
      .eo-number { text-align:center; font-size:12px; font-variant-numeric:tabular-nums; }
      .eo-mobile-label { display:none; }
      .eo-bars { display:flex; flex-direction:column; gap:6px; }
      .eo-track { height:10px; border-radius:4px; background:var(--p-color-bg-surface-secondary,#eee); overflow:hidden; }
      .eo-track>div { height:100%; border-radius:4px; }
      .eo-pagination { display:flex; justify-content:flex-end; align-items:center; gap:12px; margin-top:10px; font-size:12px; }
      .eo-pagination button { padding:5px 10px; border:1px solid #ccc; border-radius:6px; background:var(--p-color-bg-surface,#fff); color:inherit; cursor:pointer; }
      .eo-pagination button:disabled { opacity:.45; cursor:default; }
      .eo-images { display:flex; overflow-x:auto; gap:16px; padding:4px 0 16px; }
      .eo-image-card { flex:0 0 220px; display:flex; flex-direction:column; gap:8px; overflow-wrap:anywhere; }
      .eo-image { height:155px; border-radius:9px; background:var(--p-color-bg-surface-secondary,#eee); display:flex; align-items:center; justify-content:center; text-align:center; }
      .eo-image img { height:100%; width:100%; object-fit:contain; }
      .eo-image-metrics .eo-number { display:flex; justify-content:space-between; gap:8px; margin-top:6px; }
      .eo-image-metrics .eo-mobile-label { display:block; }
      .eo-note { color:var(--p-color-text-secondary,#666); font-size:12px; line-height:1.5; margin-top:14px; }
      @media(max-width:1100px) { .eo-layout {grid-template-columns:1fr;} .eo-donut {display:none;} }
      @media(max-width:700px) { .eo-row {grid-template-columns:repeat(3,minmax(0,1fr));} .eo-label,.eo-bars {grid-column:1/-1;} .eo-head{display:none;} .eo-mobile-label{display:block;font-size:10px;color:#666;margin-bottom:4px;} .eo-number{text-align:left;} }
    `}</style>
      <div className="eo-key">
        {["Clicked sessions", "Added to cart", "Purchased"].map((label, i) => (
          <span key={label}>
            <i className="eo-dot" style={{ background: series[i] }} />
            {t(label)}
          </span>
        ))}
      </div>
      <div className="eo-layout">
        <aside
          className="eo-donut"
          aria-label={t("{count} body clicks", { count: formatNumber(total) })}
        >
          <svg
            viewBox="0 0 180 180"
            width="180"
            height="180"
            role="img"
            aria-label={t("Original click distribution")}
          >
            {body.map((key) => {
              const length = total ? (totals[key] / total) * 440 : 0;
              const start = offset;
              offset += length;
              return (
                <circle
                  key={key}
                  cx="90"
                  cy="90"
                  r="70"
                  fill="none"
                  stroke={colors[key]}
                  strokeWidth="24"
                  strokeDasharray={`${length} ${440 - length}`}
                  strokeDashoffset={-start}
                  transform="rotate(-90 90 90)"
                />
              );
            })}
            <text
              x="90"
              y="86"
              textAnchor="middle"
              fontSize="23"
              fontWeight="700"
              fill="currentColor"
            >
              {formatNumber(total)}
            </text>
            <text
              x="90"
              y="106"
              textAnchor="middle"
              fontSize="12"
              fill="currentColor"
            >
              {t("body clicks")}
            </text>
          </svg>
          <ul>
            {body.map((key) => (
              <li key={key}>
                <i className="eo-dot" style={{ background: colors[key] }} />
                <span>
                  {t(key)} {formatNumber(totals[key])} (
                  {formatNumber(totals[key] / total, {
                    style: "percent",
                    maximumFractionDigits: 0,
                  })}
                  )
                </span>
              </li>
            ))}
          </ul>
        </aside>
        <div style={{ minWidth: 0 }}>
          {data.groups
            .filter(
              (group) =>
                !["Image", "Header", "Footer"].includes(group.category),
            )
            .map((group) => (
              <Group
                key={group.category}
                {...group}
                maximum={data.maxSessions}
              />
            ))}
        </div>
      </div>
      {images && (
        <section
          className="eo-group"
          aria-label={t("{category} engagement outcomes", {
            category: t("Image"),
          })}
        >
          <h3>
            <span style={{ background: colors.Image }} />
            {t("Image")}
          </h3>
          <div className="eo-images">
            {images.items.map((item) => (
              <ImageCard
                key={item.key}
                item={item}
                maximum={data.maxSessions}
              />
            ))}
          </div>
        </section>
      )}
      {data.groups
        .filter((group) => ["Header", "Footer"].includes(group.category))
        .map((group) => (
          <Group key={group.category} {...group} maximum={data.maxSessions} />
        ))}
      <p className="eo-note">
        {t(
          "{audience} only. Percentages are among sessions that clicked that element; repeat clicks count once. All bars share one session-count scale. Outcomes can overlap across elements—do not add them together.",
          { audience: t(audience) },
        )}
      </p>
      <p className="eo-note">
        {t(
          "Same-session association within this report, not proof of sequence or causation. Uses recorded session IDs, not cross-device people. Missing tracking can hide outcomes; unavailable means the records could not be linked. The donut retains the original click totals.",
        )}
      </p>
    </div>
  );
}
