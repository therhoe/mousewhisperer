// Type-only fixture: proves the Polaris web component types are installed.
export function PolarisTypesFixture() {
  return (
    <s-page heading="Projects">
      <s-button slot="primary-action" variant="primary">
        Create project
      </s-button>
      <s-section heading="Latest measurement">
        <s-badge tone="success">Completed</s-badge>
      </s-section>
    </s-page>
  );
}

// App Bridge's menu element and its home link (Task 5 of plan 2a).
const HOME_LINK = { rel: "home" } as const;
export function AppNavFixture() {
  return (
    <s-app-nav>
      <s-link href="/app" {...HOME_LINK}>
        Snapshot
      </s-link>
      <s-link href="/app/projects">Projects</s-link>
    </s-app-nav>
  );
}
