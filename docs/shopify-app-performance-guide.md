# Shopify App Performance Guide

This guide documents the practical standard for making embedded Shopify apps feel fast. It is written for Remix/React Shopify apps, but the principles apply to React Router, Next.js, Rails, Laravel, and other iframe-based Shopify Admin apps.

The target user experience is:

- Main navigation feels instant: click, screen changes immediately.
- Heavy private data can continue loading after the destination screen appears.
- The app does not freeze on the previous page while waiting for the next route.
- Production navigation stays consistently fast after the first app load.

## Why Shopify Apps Feel Slow

An embedded Shopify app has extra work that a normal website does not have:

- It runs inside Shopify Admin in an iframe.
- App Bridge coordinates navigation and authenticated iframe behavior.
- Each protected route usually calls `authenticate.admin(request)`.
- Server loaders often call a database, Shopify Admin API, or both.
- Remix/React Router waits for the next route loader before swapping to the final route UI unless you design around that.

Because of this, the goal is not only to reduce server time. The bigger goal is to make the destination screen appear immediately, then fill in non-critical data after paint.

## Baseline Rules

### 1. Test Production, Not The Dev Tunnel

Shopify CLI dev mode is useful for development, but it is not a performance benchmark.

Dev mode adds:

- Vite development overhead.
- Hot module reload work.
- Tunnel latency.
- Extra logging and sourcemaps.
- Non-optimized bundles.

Always measure the production app inside Shopify Admin before judging navigation speed.

Use local dev only to identify obvious problems. Use production to judge real click speed.

### 2. Keep Shopify-Side Navigation Native

Use Shopify App Bridge navigation for the Admin sidebar. Shopify's app nav is designed to navigate app routes without a full page reload.

Recommended React pattern:

```tsx
import { NavMenu } from "@shopify/app-bridge-react";
import { Link } from "@remix-run/react";

export function AppBridgeNav() {
  return (
    <NavMenu>
      <Link to="/app" rel="home" prefetch="render">
        Dashboard
      </Link>
      <Link to="/app/products" prefetch="render">
        Products
      </Link>
      <Link to="/app/settings" prefetch="render">
        Settings
      </Link>
    </NavMenu>
  );
}
```

For non-React apps, use the matching App Bridge web component navigation, but make sure route clicks are not causing full document reloads.

Avoid:

- Plain links that escape the iframe unexpectedly.
- Manually forcing `window.location.href` for internal app navigation.
- Separate custom navigation systems that fight App Bridge.
- Registering nav items that do not match real app routes.

## Route Loading Strategy

### 3. Split Every Page Into Shell Data And Heavy Data

Fast Shopify apps do not wait for everything before showing the page.

Design every route loader in two layers:

1. Shell loader: auth, title, IDs, small metadata, tabs, first visible rows.
2. After-paint fetchers: charts, analytics, notifications, recommendations, large tables, export data, Shopify Admin API enrichment.

Bad pattern:

```ts
export const loader = async ({ request, params }) => {
  await authenticate.admin(request);

  const page = await getPageMetadata(params.id);
  const stats = await getExpensiveStats(params.id);
  const chart = await getChartData(params.id);
  const notifications = await getNotifications();
  const externalData = await callShopifyAdminApi();

  return json({ page, stats, chart, notifications, externalData });
};
```

Better pattern:

```ts
export const loader = async ({ request, params }) => {
  await authenticate.admin(request);

  const page = await getPageShell(params.id);

  return json({
    page,
    stats: null,
    chart: null,
    statsPending: true,
  });
};
```

Then fetch heavy data after render:

```tsx
import { useEffect } from "react";
import { useFetcher, useLoaderData } from "@remix-run/react";

export default function Page() {
  const data = useLoaderData<typeof loader>();
  const statsFetcher = useFetcher<typeof statsLoader>();

  useEffect(() => {
    if (!data.statsPending) return;

    const timeoutId = window.setTimeout(() => {
      statsFetcher.load(`/app/page/${data.page.id}?_stats=1`);
    }, 100);

    return () => window.clearTimeout(timeoutId);
  }, [data.page.id, data.statsPending, statsFetcher]);

  return (
    <>
      <PageHeader page={data.page} />
      {statsFetcher.data ? (
        <StatsPanel stats={statsFetcher.data.stats} />
      ) : (
        <StatsSkeleton />
      )}
    </>
  );
}
```

This makes navigation feel instant because the destination page can render before analytics finish.

### 4. Do Not Put Background Work In Layout Loaders

Parent app layout routes should do the minimum:

- Authenticate.
- Return the API key/config required by App Bridge.
- Render persistent nav and outlet.

Avoid doing this in the app layout loader:

- Creating web pixels.
- Registering webhooks.
- Fetching notifications.
- Querying dashboard counts.
- Calling Shopify Admin API.
- Loading user profile details.

The app layout is shared by many routes. If it becomes slow, every navigation inherits the delay.

For Remix, use `shouldRevalidate` on stable parent layout routes when appropriate:

```ts
import type { ShouldRevalidateFunction } from "@remix-run/react";

export const shouldRevalidate: ShouldRevalidateFunction = () => false;
```

Only do this when the layout data is stable and child routes can handle their own revalidation.

## Prefetching

### 5. Prefetch Main Navigation Routes

Use Remix `Link` prefetching for routes that users are likely to click.

Options:

- `prefetch="render"`: fetch as soon as the link renders. Use for small, high-probability routes like primary nav.
- `prefetch="intent"`: fetch on hover/focus. Use for many links where not all are likely.
- `prefetch="viewport"`: fetch when visible. Use for lists/cards that enter the viewport.

Example:

```tsx
<Link to="/app/products" prefetch="render">
  Products
</Link>

<Link to={`/app/project/${project.id}`} prefetch="viewport">
  {project.title}
</Link>
```

### 6. Prefetch Routes That Are Not Rendered As Links

For routes the user is likely to click but that are not normal `Link` components, use `PrefetchPageLinks`.

```tsx
import { PrefetchPageLinks } from "@remix-run/react";

function AppRoutePrefetcher() {
  return (
    <>
      <PrefetchPageLinks page="/app" />
      <PrefetchPageLinks page="/app/products" />
      <PrefetchPageLinks page="/app/settings" />
    </>
  );
}
```

Use absolute app paths. Do not use relative paths.

### 7. Stage Prefetches Instead Of Firing Everything At Once

Prefetching too much can slow the page you are currently viewing.

Good rule:

- First 300-700 ms: let the current page paint.
- Then prefetch primary nav routes one by one.
- Then prefetch the first visible detail routes.
- Do not prefetch hundreds of rows.

Example:

```tsx
function StagedPrefetcher({ pages }: { pages: string[] }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const timers: number[] = [];
    const startTimer = window.setTimeout(() => {
      pages.forEach((_, index) => {
        timers.push(
          window.setTimeout(() => {
            setCount((current) => Math.max(current, index + 1));
          }, index * 180),
        );
      });
    }, 450);

    return () => {
      window.clearTimeout(startTimer);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [pages]);

  return (
    <>
      {pages.slice(0, count).map((page) => (
        <PrefetchPageLinks key={page} page={page} />
      ))}
    </>
  );
}
```

## Perceived Instant Navigation

### 8. Show The Destination Shell Immediately

If the user clicks a route and the browser has not finished loading the route data, do not leave the old page frozen.

Use `useNavigation()` to detect the pending destination and render a destination skeleton.

```tsx
import { Outlet, useLocation, useNavigation } from "@remix-run/react";

export default function AppLayout() {
  const location = useLocation();
  const navigation = useNavigation();
  const pendingPathname = navigation.location?.pathname;

  const isRouteTransition =
    navigation.state === "loading" &&
    pendingPathname?.startsWith("/app") &&
    pendingPathname !== location.pathname;

  return (
    <>
      <AppNav activePathname={pendingPathname || location.pathname} />
      {isRouteTransition ? (
        <DestinationShell pathname={pendingPathname} />
      ) : (
        <Outlet />
      )}
    </>
  );
}
```

This changes the feel from:

```text
click -> wait on old page -> new page appears
```

to:

```text
click -> destination appears immediately -> data fills in
```

That is the difference merchants feel.

### 9. Keep Skeletons Structural, Not Decorative

Skeletons should match the page shape:

- Page title area.
- Primary cards.
- Table/list rows.
- Chart area.

Avoid full-screen spinners. A spinner says "nothing is ready." A shell says "you are already here."

## Backend And Database Standards

### 10. Make Loader Queries Small

Primary route loaders should:

- Select only fields needed for first paint.
- Use `take`/limits on lists.
- Use aggregate tables or cached summary rows.
- Avoid loading large child relations.
- Avoid calling external APIs unless the result is required for first paint.

Bad:

```ts
await prisma.project.findMany({
  include: {
    snapshots: {
      include: {
        visits: true,
      },
    },
  },
});
```

Better:

```ts
await prisma.$queryRaw`
  SELECT
    p.id,
    p."productTitle",
    s.id AS "snapshotId",
    COALESCE((stats_cache.stats->>'realCount')::int, 0) AS "realCount"
  FROM "Project" p
  JOIN "Snapshot" s ON s."projectId" = p.id
  LEFT JOIN "SnapshotStatsCache" stats_cache ON stats_cache."snapshotId" = s.id
  WHERE p.shop = ${shop}
  ORDER BY p."createdAt" DESC
`;
```

### 11. Cache Expensive Loader Results

Cache data that is expensive and does not need second-by-second freshness:

- Dashboard summaries.
- Category summaries.
- Project metadata.
- Snapshot stats.
- Shopify Admin API enrichment like product images.

Typical TTLs:

- Session cache: 1-5 minutes.
- Dashboard/category shell: 1-5 minutes.
- Heavy analytics summaries: 30-120 seconds.
- Shopify Admin API resource enrichment: 5-15 minutes.

Invalidate caches after actions that mutate the related data.

### 12. Use The Database Pool Carefully

Increasing the database pool is not always faster. If the database or remote pooler is small, too many parallel queries can make every request wait.

Use more connections only when the database can actually handle them. Otherwise:

- Keep page loaders small.
- Run background analytics after paint.
- Limit expensive background jobs.
- Avoid running many heavy aggregations in parallel.
- Prefer cached summary tables for high-traffic routes.

For serverless deployments, keep pool settings conservative and test under real navigation load.

### 13. Cache Shopify Sessions

`authenticate.admin(request)` is necessary for protected Admin routes, but session lookup should not become a database bottleneck.

Use a short server-side session cache around your session storage if your framework allows it.

Keep the TTL short enough to avoid stale auth problems, usually a few minutes.

### 14. Use Shopify's Newer Embedded Auth Strategy

For Shopify Remix apps, enable the newer embedded auth strategy when your app setup supports it.

```ts
const shopify = shopifyApp({
  // ...
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
});
```

This is intended to reduce embedded auth friction compared with older redirect-heavy flows.

## Frontend Bundle Standards

### 15. Keep The App Shell Small

The authenticated app layout should not import heavy page-only code.

Avoid importing these in the layout:

- Rich text editors.
- Chart libraries.
- PDF/export libraries.
- Large icon packs.
- Heavy admin-only components.

Let route-level code splitting keep those costs on the pages that need them.

### 16. Lazy Load Heavy UI

Good candidates for delayed/lazy loading:

- Rich text editors.
- Large chart panels.
- CSV/PDF preview tools.
- Modals that are rarely opened.
- Advanced filters.
- Large secondary tables.

If a component is not needed for first paint, it should not block first paint.

## Shopify Admin API Standards

### 17. Do Not Call Admin API For First Paint Unless Necessary

Admin API requests add network and Shopify processing time.

For first paint:

- Prefer app database data.
- Use cached Shopify resource metadata.
- Fetch Admin API enrichment after the page appears.

Examples of after-paint Admin API work:

- Product images.
- Resource pickers.
- Product titles for secondary lists.
- Store metadata not needed for the page title.

### 18. Use App Bridge APIs For Native Workflows

Use Shopify-native surfaces when they are available:

- Resource picker.
- Toasts.
- Modals.
- Save bar.
- Admin navigation URLs.

Native flows are usually faster and more familiar than rebuilding the same workflow inside your iframe.

## Observability

### 19. Measure The Right Things

Track these separately:

- Cold production load.
- Warm production load.
- Main nav click to first visual change.
- Main nav click to full data loaded.
- Detail click to destination shell.
- Detail click to analytics loaded.
- Loader duration by route.
- Auth duration by route.
- Database query duration.
- Admin API duration.

If you only measure total page load, you will miss the difference between "feels instant" and "fully loaded."

### 20. Add Lightweight Loader Timing

In development, log route loader timings:

```ts
export const loader = async ({ request }) => {
  const startedAt = Date.now();
  await authenticate.admin(request);
  const authMs = Date.now() - startedAt;

  const data = await loadData();

  if (process.env.NODE_ENV === "development") {
    console.info("[Perf] route loader", {
      path: new URL(request.url).pathname,
      authMs,
      durationMs: Date.now() - startedAt,
    });
  }

  return json(data);
};
```

Do not spam production logs unless you have sampling.

## Deployment Standards

### 21. Deploy App Code Separately From Shopify Config

There are two different deploy concepts:

- Hosted app deploy: Vercel/Fly/Render/etc. This updates your code and performance fixes.
- Shopify app config deploy: `shopify app deploy`. This updates scopes, extensions, webhooks, app config, and Shopify-side settings.

If you only changed Remix app code, deploy the hosted app.

If you changed `shopify.app.toml`, scopes, extensions, or Shopify config, deploy Shopify config too.

### 22. Put The App Near The Database And Users

Latency matters for every loader.

Choose hosting region based on:

- Database region.
- Primary merchant region.
- Shopify Admin user base.

If the app is in the US and the database is in Europe, every protected loader can pay cross-region latency.

## Implementation Checklist

Use this checklist when building or reviewing a Shopify app.

### Navigation

- App uses App Bridge nav (`NavMenu` or `s-app-nav`).
- Internal navigation uses framework links, not full page reloads.
- Primary nav links use prefetch.
- Visible detail links use prefetch.
- App shows a destination shell during pending navigation.
- Active nav state updates immediately from pending pathname.

### Route Loaders

- Parent layout loader is minimal.
- Each page loader returns only first-paint data.
- Heavy stats/charts/notifications load after paint.
- Loaders select specific fields.
- Loaders avoid large relation includes.
- External API calls are not in critical loaders.
- Stable layout routes avoid unnecessary revalidation.

### Caching

- Session storage has a short cache.
- Dashboard/category/project shell data is cached.
- Heavy analytics has a cache or summary table.
- Shopify Admin API enrichment is cached.
- Cache invalidation runs after mutations.

### Database

- Queries are indexed.
- Aggregations use summary/cache tables where possible.
- Connection pool is sized for the database, not guessed.
- Heavy background work cannot starve navigation queries.
- Expensive parallel query batches are limited.

### Frontend

- App shell bundle is small.
- Heavy components are route-level or lazy loaded.
- Skeletons match real page structure.
- No global full-screen spinner for normal route transitions.
- Images and rich assets are not blocking first paint.

### Production

- Performance is tested in production Shopify Admin.
- Cold and warm times are measured separately.
- Direct `/app` checks are not treated as embedded navigation tests.
- Build warnings are understood.
- Config deploy and hosted app deploy are not confused.

## Case Study: What Was Applied In This App

The performance pass in this app followed the general checklist above:

- Production deploy replaced dev tunnel testing for real speed checks.
- The app layout loader was kept minimal and configured not to revalidate unnecessarily.
- Shopify sidebar navigation was changed to `NavMenu` with Remix `Link` routes.
- Main app routes are prefetched after the app has rendered.
- Dashboard/category pages prefetch the first likely detail pages.
- Pending route transitions show an instant destination shell instead of freezing the old page.
- Dashboard notifications were moved out of the blocking dashboard loader.
- Detail page analytics and extras were split into after-paint fetches.
- Expensive analytics were backed by cached/persisted summary data.
- Session lookup was wrapped with a short in-memory cache.
- Database-heavy background refreshes were kept from starving interactive navigation.

The important lesson is that the app did not become fast from one change. It became fast because navigation, loaders, caching, database usage, and production deployment were all aligned around first paint.

## Standard Target

For a polished Shopify embedded app, aim for:

- Click to visible route shell: under 100-200 ms when warm/prefetched.
- Click to useful first content: under 300-700 ms.
- Heavy analytics loaded: under 1-2 seconds, or progressively streamed/fetched.
- No full iframe reload during internal navigation.
- No old-page freeze after click.

If a page cannot load all data quickly, do not block navigation. Render the destination immediately and fill in the expensive parts after paint.

## References

- Shopify App Home: https://shopify.dev/docs/api/app-home
- Shopify App Nav: https://shopify.dev/docs/api/app-home/app-bridge-web-components/app-nav
- Shopify Navigation API: https://shopify.dev/docs/api/app-home/apis/user-interface-and-interactions/navigation-api
- Shopify App package for Remix: https://shopify.dev/docs/api/shopify-app-remix/v2
- Shopify `authenticate.admin`: https://shopify.dev/docs/api/shopify-app-remix/v2/authenticate/admin
- Shopify Resource Fetching API: https://shopify.dev/docs/api/app-home/apis/authentication-and-data/resource-fetching-api
- Remix `Link` prefetch: https://v2.remix.run/docs/components/link/
- Remix `PrefetchPageLinks`: https://v2.remix.run/docs/components/prefetch-page-links/
- Remix pending UI: https://v2.remix.run/docs/discussion/pending-ui/
- Remix `shouldRevalidate`: https://v2.remix.run/docs/route/should-revalidate/
