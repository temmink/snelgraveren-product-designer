# Phase 6: Polish — Design Spec

**Date:** 2026-03-19
**Status:** Planned
**Depends on:** Phases 0-5 (scaffold, backend, admin builder, frontend designer, WooCommerce integration, export)

Phase 6 covers four areas: internationalization, accessibility, performance, and testing. The goal is production-readiness without scope creep.

---

## 1. Internationalization / Localization

### 1.1 PHP text domain loading

Add `load_plugin_textdomain` in `product-designer.php` on the `init` hook:

```php
add_action('init', function () {
    load_plugin_textdomain('product-designer', false, 'product-designer/languages');
});
```

Audit these files for any remaining unwrapped strings:
- `includes/Frontend/class-order-integration.php`
- `includes/Export/class-svg-exporter.php`
- `includes/Export/class-png-exporter.php`
- `includes/Export/class-pdf-exporter.php`
- `includes/Frontend/class-frontend.php` — bare "Customize Product" button text in `render_designer()`
- Any admin notice or error message that currently uses bare strings

The 7 PHP files that already use `__('...', 'product-designer')` are correct and need no changes.

### 1.2 JavaScript i18n

**Dependency:** Add `@wordpress/i18n` as a dev dependency (`npm install --save-dev @wordpress/i18n`). It must NOT be bundled — WordPress ships its own copy at runtime.

**Vite config** (`vite.config.mjs`): Add `@wordpress/i18n` to the `external` array for both admin and frontend builds so Vite treats it as a global. Map it to `wp.i18n` in the `output.globals` config. Note: the frontend build currently has no `external` array — one must be added. The frontend intentionally bundles its own React (not externalized) because WordPress doesn't load React on product pages; only `@wordpress/i18n` should be externalized. The admin build already externalizes React via WordPress globals.

**Script dependencies:** Add `'wp-i18n'` to the dependency arrays in both `wp_enqueue_script` calls (admin in `class-admin.php`, frontend in `class-frontend.php`) so WordPress loads the i18n runtime before the plugin scripts.

**Admin scripts** (`includes/Admin/class-admin.php`): After `wp_enqueue_script`, call:

```php
wp_set_script_translations('pd-template-builder', 'product-designer', PD_PLUGIN_DIR . 'languages');
```

**Frontend scripts** (`includes/Frontend/class-frontend.php`): Same pattern:

```php
wp_set_script_translations('pd-frontend-designer', 'product-designer', PD_PLUGIN_DIR . 'languages');
```

**JSX files to wrap:** Every user-facing string in these directories gets `__()` or `_x()`:

Admin (`admin/js/template-builder/src/`):
- `App.jsx` — page titles, save button labels, status messages
- `components/ViewTabs.jsx` — tab names, add/delete button labels
- `components/Canvas.jsx` — placeholder text, tooltips
- `components/ZoneForm.jsx` — input labels
- `components/TreePanel.jsx` — tree/layer panel labels
- `components/TreeNode.jsx` — node action button labels
- `components/PermissionsPanel.jsx` — permission labels, option text
- `components/PricingPanel.jsx` — pricing labels
- `components/GlobalSettings.jsx` — setting labels, descriptions

Frontend (`frontend/js/designer/src/`):
- `App.jsx` — modal title, save/close button labels
- `components/Sidebar.jsx` — tab labels
- `components/DesignerCanvas.jsx` — canvas status messages
- `components/tabs/AddTab.jsx` — tool names, button text
- `components/tabs/ElementTab.jsx` — property labels, input labels
- `components/tabs/ViewsTab.jsx` — view names

Import pattern for each file:

```js
import { __, _x } from '@wordpress/i18n';
```

### 1.3 Translation files

Generate the `.pot` file from the project root:

```bash
docker compose exec wordpress wp i18n make-pot \
  wp-content/plugins/product-designer \
  wp-content/plugins/product-designer/languages/product-designer.pot
```

Create `languages/product-designer-nl_NL.po` with Dutch translations for all extracted strings. Compile to `.mo`:

```bash
docker compose exec wordpress wp i18n make-mo \
  wp-content/plugins/product-designer/languages/product-designer-nl_NL.po
```

For JS strings, also generate the JSON translation file:

```bash
docker compose exec wordpress wp i18n make-json \
  wp-content/plugins/product-designer/languages/ \
  --no-purge
```

This produces `product-designer-nl_NL-<hash>.json` files that `wp_set_script_translations` picks up automatically.

All strings must be translated to Dutch. Other languages can be added later by contributors creating new `.po` files — the infrastructure supports it without code changes.

### 1.4 Deliverables

| File | Action |
|------|--------|
| `product-designer.php` | Add `load_plugin_textdomain` |
| `vite.config.mjs` | Externalize `@wordpress/i18n` |
| `includes/Admin/class-admin.php` | Add `wp_set_script_translations` |
| `includes/Frontend/class-frontend.php` | Add `wp_set_script_translations` |
| ~15 JSX files | Wrap strings in `__()` / `_x()` |
| Remaining PHP files | Wrap any bare strings |
| `languages/product-designer.pot` | Generated |
| `languages/product-designer-nl_NL.po` | Dutch translations |
| `languages/product-designer-nl_NL.mo` | Compiled Dutch translations |
| `languages/product-designer-nl_NL-*.json` | JS Dutch translations |

---

## 2. Accessibility

### 2.1 Frontend designer

The frontend designer currently has no ARIA attributes or keyboard support. Fix these specific gaps:

**Sidebar tabs:** Add `role="tablist"` on the tab container, `role="tab"` on each tab button, `aria-selected="true|false"` on tabs, `role="tabpanel"` on the active panel, and `aria-controls`/`id` linking. Match the pattern already used in the admin `ViewTabs.jsx`.

**Buttons:** Add `aria-label` to every icon-only button:
- "Add text element"
- "Upload image"
- "Save design"
- "Close designer"
- "Undo", "Redo"
- "Zoom in", "Zoom out", "Reset zoom"
- "Delete element"

**Focus styles:** Add `:focus-visible` outlines to all interactive elements in `frontend/js/designer/src/designer.css`:

```css
.pd-designer button:focus-visible,
.pd-designer [role="tab"]:focus-visible,
.pd-designer input:focus-visible,
.pd-designer select:focus-visible {
    outline: 2px solid #1e88e5;
    outline-offset: 2px;
}
```

**Screen-reader utility:** Add to `frontend/js/designer/src/designer.css`:

```css
.pd-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}
```

**Status announcements:** Add `aria-live="polite"` to status message containers (save status "Saving..."/"Saved!", error messages) so screen readers announce state changes.

**Focus management:**
- When switching views, move focus to the newly active view tab.
- When the designer modal opens, trap focus inside it and move focus to the first interactive element.
- When the designer modal closes, return focus to the element that opened it (the "Customize" button on the product page).

### 2.2 Admin template builder

The admin builder already has `role="tab"` and `aria-selected` on ViewTabs. Add:
- `aria-label` to tree panel action buttons (add, delete, reorder zones/layers in `TreePanel.jsx` and `TreeNode.jsx`)
- `:focus-visible` styles in `admin/js/template-builder/src/builder.css`, same pattern as frontend

### 2.3 Canvas

No keyboard controls for the Fabric.js canvas. This is a visual drag-and-drop tool — mouse/touch interaction is the expected input method. Canvas accessibility is explicitly out of scope.

### 2.4 Deliverables

| File | Action |
|------|--------|
| Frontend sidebar/tabs components | Add ARIA roles and attributes |
| Frontend button components | Add `aria-label` to all icon buttons |
| `frontend/js/designer/src/designer.css` | Add `:focus-visible` styles, `.pd-sr-only` |
| Frontend modal component | Add focus trapping and focus restore |
| Admin zone/layer button components | Add `aria-label` |
| `admin/js/template-builder/src/builder.css` | Add `:focus-visible` styles |

---

## 3. Performance

### 3.1 Batch admin list table queries

**Problem:** `includes/Admin/class-template-list-table.php` calls `count_views()` and `count_products()` per row when rendering the template list. On a page with 20 templates, that is 40 extra queries.

**Fix:** In `TemplateRepository`, add two batch methods:

```php
public function count_views_batch(array $template_ids): array
```

Returns `[template_id => count, ...]` using a single query with `GROUP BY template_id`.

```php
public function count_products_batch(array $template_ids): array
```

Same pattern — single query with `IN (...)` clause (still via `$wpdb->prepare`).

In `class-template-list-table.php`, after fetching the page of templates in `prepare_items()`, call both batch methods and store the results. The `column_views()` and `column_products()` methods read from the stored array instead of making per-row queries.

**Result:** 2 queries instead of 40 for a full page.

### 3.2 Transient caching for public template lookups

**Problem:** Every product page load queries the template and its views from the database, even though templates change rarely.

**Fix:** In `TemplateRepository`, wrap the `get($template_id)` method (which fetches the template and its views, used by the frontend public endpoint) with a WordPress transient:

```php
$cache_key = 'pd_template_' . $template_id;
$cached = get_transient($cache_key);
if ($cached !== false) {
    return $cached;
}
// ... fetch from DB ...
set_transient($cache_key, $result, 5 * MINUTE_IN_SECONDS);
return $result;
```

Invalidate the transient whenever a template is saved or updated:

```php
delete_transient('pd_template_' . $template_id);
```

Add this call in the `save()` and `update()` methods of `TemplateRepository`, and in the REST API's template update endpoint.

### 3.3 Deliverables

| File | Action |
|------|--------|
| `includes/Database/class-template-repository.php` | Add `count_views_batch()`, `count_products_batch()`, transient caching |
| `includes/Admin/class-template-list-table.php` | Use batch methods in `prepare_items()` |
| REST template update endpoint | Invalidate transient on save |

---

## 4. Testing

### 4.1 PHP unit tests

**Runner:** PHPUnit, executed inside Docker: `docker compose exec wordpress phpunit`

**Bootstrap:** Create `tests/php/bootstrap.php` that loads WordPress test libraries and activates the plugin. Uses the existing Docker MariaDB instance with a separate `wp_tests` database (created in bootstrap) to avoid polluting the development database. Each test class wraps its operations in transactions that roll back after each test.

**Test files and scope:**

`tests/php/Security/UploadValidatorTest.php`:
- Rejects executable MIME types (PHP, JS)
- Accepts allowed MIME types (PNG, JPEG, SVG, PDF)
- Sanitizes SVG: strips `<script>`, `on*` attributes, `<use>` with external refs, `foreignObject`, `data:` URIs
- Rate limits: allows 10 uploads, blocks the 11th within 60 seconds

`tests/php/Security/CapabilityCheckerTest.php`:
- Admin user has `edit_pd_templates`
- Shop manager has `edit_pd_templates`
- Customer does not have `edit_pd_templates`

`tests/php/Security/NonceManagerTest.php`:
- Valid nonce passes verification
- Expired/invalid nonce fails verification

`tests/php/Pricing/PriceCalculatorTest.php`:
- Calculates per-element pricing (text, image, SVG each with different rates)
- Applies tier-based quantity discounts
- Enforces minimum and maximum price caps
- Returns 0 for empty designs

`tests/php/Export/SvgExporterTest.php`:
- Renders valid SVG output from Fabric.js JSON
- Output file is created in expected location

`tests/php/Export/PngExporterTest.php`:
- Renders PNG from canvas data
- Output has correct dimensions

`tests/php/Export/PdfExporterTest.php`:
- Generates valid PDF
- Multi-view designs produce multi-page PDF

`tests/php/Database/TemplateRepositoryTest.php`:
- Create, read, update, delete template
- List with pagination
- Batch view/product counts return correct values

`tests/php/Database/DesignRepositoryTest.php`:
- Create design with hash ID
- Retrieve by hash
- Update status
- Delete cascades to design views

`tests/php/API/TemplateEndpointTest.php`:
- `POST pd/v1/templates` creates template (admin only)
- `GET pd/v1/templates` lists templates with pagination headers
- Unauthenticated requests are rejected
- Missing nonce returns 403

`tests/php/API/DesignEndpointTest.php`:
- Customer can create and retrieve own design
- Customer cannot access another customer's design
- Export trigger requires admin capability

### 4.2 Jest tests

**Runner:** Jest with `@testing-library/react`. Config in `jest.config.js`.

**Setup:** `tests/js/setup.js` mocks `@wordpress/i18n` (returns input string), mocks `fabric` module.

`tests/js/stores/useTemplateStore.test.js`:
- Initial state is empty
- `loadTemplate` populates views and elements
- `addView` / `removeView` updates view list
- `addElement` / `removeElement` updates active view
- `setActiveView` switches view index
- Undo/redo: after element add, undo removes it, redo restores it

`tests/js/stores/useDesignerStore.test.js`:
- Initial state is empty
- `loadDesign` populates from saved JSON
- `setActiveView` switches view
- `addElement` adds to correct view
- Undo/redo state transitions work correctly
- `saveDesign` serializes current state

`tests/js/components/Sidebar.test.js`:
- Renders all tab buttons
- Clicking a tab switches the active panel
- Active tab has `aria-selected="true"`

`tests/js/components/AddTab.test.js`:
- Renders text and image tool buttons
- Clicking "Add Text" calls the correct store action

`tests/js/components/ViewTabs.test.js`:
- Renders one tab per view
- Clicking a tab calls `setActiveView`
- Active tab is visually highlighted

### 4.3 E2E tests (Playwright)

**Runner:** Playwright, targeting `http://localhost:8080`. Config in `playwright.config.js`.

**Setup:** `tests/e2e/global-setup.js` logs in as admin and stores auth state. Tests reuse this session.

`tests/e2e/admin-template.spec.js` — Admin template lifecycle:
1. Navigate to Product Designer admin page
2. Click "Add New Template"
3. Enter template title
4. Add a view, set canvas dimensions
5. Add a design zone to the view
6. Save template
7. Return to template list, verify template appears with correct view count

`tests/e2e/customer-design.spec.js` — Customer design flow:
1. Navigate to a product page with designer enabled
2. Click "Customize" to open the designer modal
3. Add a text element, change the text content
4. Switch to second view, add another element
5. Click "Save Design"
6. Click "Add to Cart"
7. Go to cart page, verify the cart item has a design thumbnail
8. Verify the cart item links back to the designer with the saved design

`tests/e2e/export.spec.js` — Export flow:
1. Log in as admin
2. Navigate to an order that has a designed product
3. Click the export action
4. Verify the export file is generated (check for download link or file existence)
5. Verify export record appears in the exports table

### 4.4 Package.json scripts

Add to `package.json`:

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:e2e": "playwright test",
    "test:e2e:headed": "playwright test --headed"
  }
}
```

PHP tests are run separately via Docker — no npm script needed.

### 4.5 Dev dependencies

```
jest
@testing-library/react
@testing-library/jest-dom
jest-environment-jsdom
@playwright/test
```

### 4.6 Deliverables

| Path | Purpose |
|------|---------|
| `tests/php/bootstrap.php` | PHPUnit bootstrap |
| `tests/php/Security/*.php` | 3 security test files |
| `tests/php/Pricing/PriceCalculatorTest.php` | Pricing tests |
| `tests/php/Export/*.php` | 3 exporter test files |
| `tests/php/Database/*.php` | 2 repository test files |
| `tests/php/API/*.php` | 2 API endpoint test files |
| `phpunit.xml` | PHPUnit config |
| `tests/js/setup.js` | Jest setup with mocks |
| `tests/js/stores/*.test.js` | 2 store test files |
| `tests/js/components/*.test.js` | 3 component test files |
| `jest.config.js` | Jest configuration |
| `tests/e2e/global-setup.js` | Playwright auth setup |
| `tests/e2e/*.spec.js` | 3 E2E test files |
| `playwright.config.js` | Playwright configuration |
| `package.json` | Updated scripts and dev dependencies |

---

## Implementation order

1. **i18n** — do first because it touches many files; later phases should write already-wrapped strings
2. **Accessibility** — do second; some new `aria-label` values will need `__()` wrapping from step 1
3. **Performance** — independent of 1 and 2; can be done in parallel
4. **Testing** — do last so tests cover the final state of the code including i18n and a11y changes

---

## Out of scope

- RTL layout support (can be added later via CSS logical properties)
- WCAG AAA compliance (targeting AA)
- Canvas keyboard navigation
- Load testing / stress testing
- Visual regression testing
- CI/CD pipeline configuration
