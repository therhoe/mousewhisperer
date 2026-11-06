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
