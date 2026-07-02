Hi Shopify team,

Thank you for the follow-up.

Mouse Whisperer is requesting Asset API / Theme API protected scope access for one specific merchant-initiated feature: Shopify template A/B testing.

The app lets a merchant select an existing Shopify theme template, such as a product, collection, page, homepage, blog, or cart template, and create an A/B test between the original template and a variant template.

The protected scope is needed only when the merchant chooses to create a new variant template from inside Mouse Whisperer. In that case, the app duplicates the selected template into a new alternate template file in the same theme, for example:

`templates/product.json`

to:

`templates/product.mouse-whisperer-[test-id].json`

The merchant can then edit that variant in Shopify's theme editor before launching the test.

Mouse Whisperer does not use Asset API access to inject tracking scripts, install hidden code, publish themes, modify unrelated theme files, or make broad theme changes. Storefront tracking is handled separately through Shopify-supported app embed and web pixel mechanisms.

The Asset API usage is limited to:

- merchant-initiated template variant creation
- copying or creating an alternate template file for A/B testing
- keeping the original template unchanged
- allowing the merchant to edit the variant in Shopify before launch
- using the created template as Variant B during the A/B test

We considered theme app embeds and app blocks, and we already use Shopify-supported extension surfaces for tracking. However, app embeds and blocks cannot create alternate Shopify templates or duplicate a merchant's existing template structure for a true template-level A/B test. Without this scope, merchants would need to manually duplicate template files, which is error-prone and breaks the core A/B testing workflow.

This use case fits the developer tooling and testing functionality use case because the app helps merchants test storefront template experiences and measure performance before deciding which template should win.

We have attached a screencast showing:

1. The merchant opens Mouse Whisperer A/B tests.
2. The merchant starts a new A/B test.
3. The merchant selects the original Shopify template.
4. The merchant chooses the Duplicate template option for Variant B.
5. The app attempts the template-copy flow.
6. Shopify denies theme-file creation because the protected scope exemption is not approved yet.

The denial shown in the video is the exact point where the app needs Asset API / Theme API protected scope access.

Thank you.
