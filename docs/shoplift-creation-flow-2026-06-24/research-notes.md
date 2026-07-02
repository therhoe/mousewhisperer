# Shoplift Creation Flow Reference

Observed in Safari on June 24, 2026.

## Capture Limitation

The visible Safari flow was inspected through Computer Use screenshots and the accessibility tree. Saving PNG files from the Mac was blocked in this session:

- `screencapture` hung without producing a file.
- Safari WebDriver could not start because Safari remote automation is disabled.
- Python Quartz bindings are not installed.
- The older CoreGraphics window capture API is unavailable on the current macOS SDK.

## Flow Screens

1. Tests list
   - Left app sidebar with Tests, Lift Assist, Settings, and Create a test.
   - Main header: "Welcome, Correct Toes".
   - Status tabs: Live, Paused, Draft, Ended.
   - Test table uses visual thumbnails, name, type, dates, visitors, lift, and progress.

2. Draft list
   - Same status-tab layout.
   - Draft rows show thumbnail, name, type, created date, and last modified date.
   - Draft names are opened from the table.

3. First draft setup
   - Sticky top bar with back arrow, test title, Draft badge, calendar icon, disabled Launch now, and menu.
   - First section asks: "What do you want to test?"
   - Initial choices are content, price testing, or custom API.
   - Price testing is gated by plan and shows upgrade language.

4. Content test type selection
   - Same page changes to three large action cards:
     - Test a template: "Test homepages, landing pages, product pages, and more"
     - Test a theme: "Test your navigation menu, mini cart, or entirely new themes"
     - Test a URL: "Test a single page in your store by targeting a specific URL"
   - A "Change test type" action appears after the choice is made.

5. A template selection
   - Header: "Select your A template".
   - Large title: "Select the template you want to test".
   - Helper text explains that the selected template determines which pages are tested.
   - Live theme badge shows the theme name and "Live theme".
   - Page-type tabs: Homepage, Collection pages, Products, Pages, Cart, Other templates.
   - Search field: "Search for templates".
   - Template cards use real thumbnails, template name, template file handle, and assignment count.
   - Product examples observed:
     - not-for-sale, `product.not-for-sale.json`, assigned to 1632 products.
     - Default product, `product.json`, assigned to 322 products.
     - ct-closeout, `product.ct-closeout.json`.
     - original, `product.original.json`.
     - sport, `product.sport.json`.
     - stable, `product.stable.json`.

6. Main A/B builder canvas
   - After selecting A, title changes to "Untitled product page test".
   - Main card contains A and B side-by-side.
   - A panel:
     - Label: A.
     - Title: Original.
     - Action: Swap template.
     - Product/page preview image.
     - Compare view action.
     - Template name and file handle.
   - B panel:
     - Label: B.
     - Title: Untitled variant.
     - Three large action tiles:
       - Duplicate: "Test a variant based on your original template".
       - Select: "Test against an existing template from your theme".
       - Create with Lift Assist: "Test a recommendation from our library".

7. B existing-template picker
   - Opens under the B panel after clicking Select.
   - Header: "Select your B template".
   - Title: "Select your variant template".
   - Helper explains the B template will be tested against the original and can be launched or edited in Shopify Theme Editor.
   - Shows the same live theme badge, tabs, search, and visual template cards.
   - The original A template is marked "Original" and is visually differentiated.

8. Lift Assist recommendations
   - Appears in the B area as an alternative to existing templates.
   - Browse by categories: All, Recommended, Quick Wins, Value, Urgency, Trust, Discovery, Evergreen.
   - Recommendation cards include preview thumbnails, category labels, title, description, and page type.
   - Examples observed:
     - Buy now, pay later bar.
     - Free shipping bar.
     - Product benefits bar.
     - Promo code offer bar.
     - Related products navigation.
     - SMS discount bar.
     - Timed product discount bar.

9. Page targeting
   - Wide setup card below the visual builder.
   - Text: "This test will run on the pages assigned to your Original (A) template."
   - Example badge text: "Targeting 1632 products assigned to your Original (A) template."

10. Traffic allocation
    - Wide setup card.
    - Large horizontal A/B slider.
    - A and B traffic labels at opposite ends.
    - Numeric percentage inputs under the slider.
    - Default observed: 50% / 50%.

11. Measurement goal
    - Wide setup card.
    - Goal buttons with icons:
      - Average order value.
      - Conversion rate.
      - Revenue per visitor.
      - Clickthrough rate.
      - Add-to-cart rate.

12. Hypothesis
    - Wide setup card.
    - Optional text field for describing the expected outcome.

13. Device targeting
    - Wide setup card.
    - Large segmented options:
      - All devices.
      - Mobile only.
      - Desktop only.

14. Visitor targeting
    - Wide setup card.
    - Large segmented options:
      - New and returning visitors.
      - New visitors.
      - Returning visitors.

15. Audience targeting
    - Wide setup card with empty-state illustration.
    - Button: Add audiences.
    - Opens a large right-side overlay panel titled "My audiences".
    - Panel includes custom audiences, common audiences, clear selections, and Done.

## UI Direction For Mouse Whisperer

- Use a full-screen draft creation workspace, not a compact form.
- Keep a sticky top bar with back, title, status, launch action, and menu.
- Make test type selection visual and staged.
- Use visual template picker cards with thumbnails and assignment counts.
- Make the A/B test itself the center of the screen: two large side-by-side variant panels.
- Keep settings below as separate wide cards.
- Use sliders and segmented controls instead of dense select/input rows.
- Keep advanced targeting optional and isolated in a large overlay.
- Launch should stay disabled until required A and B setup is complete.
