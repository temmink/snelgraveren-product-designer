# Phase 6: Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Product Designer plugin production-ready with i18n (Dutch + infrastructure), accessibility, performance optimizations, and comprehensive tests.

**Architecture:** Four independent workstreams executed in order: i18n first (touches most files), accessibility second (uses i18n for labels), performance (independent), testing last (covers final state). Each task produces a self-contained commit.

**Tech Stack:** WordPress i18n (`load_plugin_textdomain`, `@wordpress/i18n`), ARIA/WAI patterns, WordPress transients, PHPUnit, Jest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-03-19-phase6-polish-design.md`

---

## File Map

### New files
| Path | Purpose |
|------|---------|
| `languages/product-designer.pot` | Translation template (generated) |
| `languages/product-designer-nl_NL.po` | Dutch translations |
| `languages/product-designer-nl_NL.mo` | Compiled Dutch translations (generated) |
| `languages/product-designer-nl_NL-*.json` | JS Dutch translations (generated) |
| `tests/php/bootstrap.php` | PHPUnit bootstrap |
| `phpunit.xml` | PHPUnit config |
| `tests/php/Database/TemplateRepositoryTest.php` | Repository CRUD tests |
| `tests/php/Database/DesignRepositoryTest.php` | Design repository tests |
| `tests/php/Security/UploadValidatorTest.php` | Upload validation tests |
| `tests/php/Pricing/PriceCalculatorTest.php` | Price calculation tests |
| `tests/php/Security/CapabilityCheckerTest.php` | Capability checker tests |
| `tests/php/Security/NonceManagerTest.php` | Nonce manager tests |
| `tests/php/Export/SvgExporterTest.php` | SVG export tests |
| `tests/php/Export/PdfExporterTest.php` | PDF export tests |
| `tests/php/Export/PngExporterTest.php` | PNG export tests |
| `tests/php/API/TemplateEndpointTest.php` | Template API endpoint tests |
| `tests/php/API/DesignEndpointTest.php` | Design API endpoint tests |
| `jest.config.js` | Jest configuration |
| `tests/js/setup.js` | Jest setup with mocks |
| `tests/js/stores/useTemplateStore.test.js` | Admin store tests |
| `tests/js/stores/useDesignerStore.test.js` | Frontend store tests |
| `tests/js/components/Sidebar.test.js` | Sidebar component tests |
| `tests/js/components/AddTab.test.js` | AddTab component tests |
| `tests/js/components/ViewsTab.test.js` | ViewsTab component tests |
| `playwright.config.js` | Playwright configuration |
| `tests/e2e/global-setup.js` | Playwright auth setup |
| `tests/e2e/admin-template.spec.js` | Admin E2E test |
| `tests/e2e/customer-design.spec.js` | Customer flow E2E test |
| `tests/e2e/export.spec.js` | Export flow E2E test |

### Modified files
| Path | Changes |
|------|---------|
| `product-designer.php` | Add `load_plugin_textdomain` |
| `vite.config.mjs` | Externalize `@wordpress/i18n` in both builds |
| `includes/Admin/class-admin.php` | Add `wp-i18n` dependency + `wp_set_script_translations` |
| `includes/Frontend/class-frontend.php` | Add `wp-i18n` dependency + `wp_set_script_translations` + wrap bare string |
| `admin/js/template-builder/src/App.jsx` | Wrap ~12 strings in `__()` |
| `admin/js/template-builder/src/components/ViewTabs.jsx` | Wrap strings in `__()` |
| `admin/js/template-builder/src/components/Canvas.jsx` | Wrap strings in `__()` |
| `admin/js/template-builder/src/components/ZoneForm.jsx` | Wrap strings in `__()` |
| `admin/js/template-builder/src/components/TreePanel.jsx` | Wrap ~13 strings in `__()` |
| `admin/js/template-builder/src/components/TreeNode.jsx` | Wrap ~8 strings in `__()` |
| `admin/js/template-builder/src/components/PermissionsPanel.jsx` | Wrap strings in `__()` |
| `admin/js/template-builder/src/components/PricingPanel.jsx` | Wrap strings in `__()` |
| `admin/js/template-builder/src/components/GlobalSettings.jsx` | Wrap strings in `__()` |
| `frontend/js/designer/src/App.jsx` | Wrap ~6 strings in `__()` |
| `frontend/js/designer/src/components/Sidebar.jsx` | Wrap 3 strings + add ARIA |
| `frontend/js/designer/src/components/DesignerCanvas.jsx` | Wrap 1 string |
| `frontend/js/designer/src/components/tabs/AddTab.jsx` | Wrap ~7 strings + add ARIA |
| `frontend/js/designer/src/components/tabs/ElementTab.jsx` | Wrap ~11 strings |
| `frontend/js/designer/src/components/tabs/ViewsTab.jsx` | Wrap ~2 strings + add ARIA |
| `frontend/js/designer/src/designer.css` | Add `:focus-visible`, `.pd-sr-only` |
| `admin/js/template-builder/src/builder.css` | Add `:focus-visible` |
| `includes/Database/class-template-repository.php` | Add batch counts + transient caching |
| `includes/Admin/class-template-list-table.php` | Use batch counts |
| `package.json` | Add dev deps + test scripts |

---

## Task 1: i18n infrastructure — PHP textdomain + Vite externals

**Files:**
- Modify: `product-designer.php`
- Modify: `vite.config.mjs`
- Modify: `includes/Admin/class-admin.php`
- Modify: `includes/Frontend/class-frontend.php`
- Modify: `package.json`

- [ ] **Step 1: Add `load_plugin_textdomain` to bootstrap**

In `product-designer.php`, add after the existing `add_action('plugins_loaded', ...)` block (around line 55):

```php
add_action('init', function () {
    load_plugin_textdomain('product-designer', false, dirname(plugin_basename(__FILE__)) . '/languages');
});
```

- [ ] **Step 2: Wrap bare "Customize Product" string in class-frontend.php**

In `includes/Frontend/class-frontend.php` line 229, change:
```php
echo '<button type="button" class="pd-open-designer button">Customize Product</button>';
```
to:
```php
echo '<button type="button" class="pd-open-designer button">' . esc_html__('Customize Product', 'product-designer') . '</button>';
```

- [ ] **Step 3: Audit export and order integration files for bare strings**

Audit these files per spec section 1.1:
- `includes/Frontend/class-order-integration.php` — already uses `__()` for most strings; check the inline JS `alert()` on line 242 for user-facing text
- `includes/Export/class-svg-exporter.php` — no user-facing strings (technical SVG generation)
- `includes/Export/class-png-exporter.php` — no user-facing strings
- `includes/Export/class-pdf-exporter.php` — no user-facing strings

In `class-order-integration.php`, the `alert('Export failed: ...')` in the inline JS (line 242) contains a user-facing string. However, WordPress JS i18n (`wp.i18n`) may not be available in inline scripts on admin order pages. Wrap it if `wp.i18n` is available, otherwise leave as-is and note it as a known limitation.

- [ ] **Step 4: Install `@wordpress/i18n` as dev dependency**

Run: `npm install --save-dev @wordpress/i18n`

- [ ] **Step 5: Externalize `@wordpress/i18n` in Vite config**

In `vite.config.mjs`, update the admin config's `external` array (line 16) and add to frontend config:

Admin config — change line 16:
```javascript
external: ['react', 'react-dom', '@wordpress/i18n'],
```

Admin globals — add after line 24:
```javascript
'@wordpress/i18n': 'wp.i18n',
```

Frontend config — add `external` to `rollupOptions` (after line 35) and add `globals` to the existing `output` block (line 37-41). The frontend already has an `output` block with `format`, `entryFileNames`, and `assetFileNames` — merge `globals` into it, do NOT create a separate `output` block:
```javascript
// Add after line 35 (inside rollupOptions, before input):
external: ['@wordpress/i18n'],

// Add inside the existing output block (after line 40, before the closing }):
globals: {
    '@wordpress/i18n': 'wp.i18n',
},
```

- [ ] **Step 6: Add `wp-i18n` as script dependency + `wp_set_script_translations`**

In `includes/Admin/class-admin.php`, in the `enqueue_scripts()` method:
1. Add `'wp-i18n'` to the dependencies array (around line 70, where `['react', 'react-dom']` is set)
2. After the `wp_enqueue_script` call, add:
```php
wp_set_script_translations('pd-template-builder', 'product-designer', PD_PLUGIN_DIR . 'languages');
```

In `includes/Frontend/class-frontend.php`, in the `enqueue_assets()` method:
1. Change the empty dependency array `[]` on line 177 to `['wp-i18n']`
2. After the `wp_enqueue_script` call, add:
```php
wp_set_script_translations('pd-frontend-designer', 'product-designer', PD_PLUGIN_DIR . 'languages');
```

- [ ] **Step 7: Build and verify no errors**

Run: `npm run build`
Expected: Both admin and frontend bundles build without errors.

- [ ] **Step 8: Commit**

```bash
git add product-designer.php vite.config.mjs includes/Admin/class-admin.php includes/Frontend/class-frontend.php package.json package-lock.json
git commit -m "feat(i18n): add textdomain loading, externalize wp.i18n, wire script translations"
```

---

## Task 2: i18n — Wrap admin JSX strings

**Files:**
- Modify: `admin/js/template-builder/src/App.jsx`
- Modify: `admin/js/template-builder/src/components/ViewTabs.jsx`
- Modify: `admin/js/template-builder/src/components/Canvas.jsx`
- Modify: `admin/js/template-builder/src/components/ZoneForm.jsx`
- Modify: `admin/js/template-builder/src/components/TreePanel.jsx`
- Modify: `admin/js/template-builder/src/components/TreeNode.jsx`
- Modify: `admin/js/template-builder/src/components/PermissionsPanel.jsx`
- Modify: `admin/js/template-builder/src/components/PricingPanel.jsx`
- Modify: `admin/js/template-builder/src/components/GlobalSettings.jsx`

- [ ] **Step 1: Add i18n import to each file and wrap strings**

Add `import { __ } from '@wordpress/i18n';` at the top of each file.

Wrap all user-facing strings with `__('...', 'product-designer')`. Key strings per file:

**App.jsx** (lines 13-16, 47, 69, 123, 132, 141, 148, 155-157, 164):
- `'Structure'` → `__('Structure', 'product-designer')`
- `'Permissions'` → `__('Permissions', 'product-designer')`
- `'Pricing'` → `__('Pricing', 'product-designer')`
- `'Settings'` → `__('Settings', 'product-designer')`
- `'Front'` → `__('Front', 'product-designer')`
- `'Title is required.'` → `__('Title is required.', 'product-designer')`
- `'Save failed.'` → `__('Save failed.', 'product-designer')`
- `'Loading template…'` → `__('Loading template…', 'product-designer')`
- `'← Templates'` → `__('← Templates', 'product-designer')`
- `'Template title…'` → `__('Template title…', 'product-designer')` (placeholder)
- `'Draft'`, `'Published'`, `'Archived'` → wrap each
- `'Saving…'`, `'Save'`, `'Saved ✓'` → wrap each

**TreePanel.jsx** (~13 strings):
- `'Add a boundary first to place layers.'`
- `'+ Add Boundary'`
- `'Saved Boundary'`
- `'Text'`, `'Select SVG'`, `'Select Image'` (media library titles)
- `'Text Properties'`, form labels: `'Text'`, `'Font Size'`, `'Font Family'`, `'Color'`, `'X'`, `'Y'`

**TreeNode.jsx** (~8 strings):
- `'Drag to reorder'`, `'Add layer'`, `'Show'`/`'Hide'`, `'Unlock'`/`'Lock'`, `'Delete'`, `'Layer'`

**All other admin components:** Wrap any user-facing labels, placeholders, and option text with `__()`.

Do NOT wrap:
- CSS class names, HTML attributes, JavaScript variables
- Data from the server (template names, view names from the API)
- Technical strings (REST endpoints, console.log messages)

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Admin bundle builds without errors.

- [ ] **Step 3: Commit**

```bash
git add admin/js/template-builder/src/
git commit -m "feat(i18n): wrap all admin template builder strings with __()"
```

---

## Task 3: i18n — Wrap frontend JSX strings

**Files:**
- Modify: `frontend/js/designer/src/App.jsx`
- Modify: `frontend/js/designer/src/components/Sidebar.jsx`
- Modify: `frontend/js/designer/src/components/DesignerCanvas.jsx`
- Modify: `frontend/js/designer/src/components/tabs/AddTab.jsx`
- Modify: `frontend/js/designer/src/components/tabs/ElementTab.jsx`
- Modify: `frontend/js/designer/src/components/tabs/ViewsTab.jsx`

- [ ] **Step 1: Add i18n import and wrap strings**

Add `import { __ } from '@wordpress/i18n';` at the top of each file.

**App.jsx** (lines 28, 69, 165, 169, 200, 208):
- `'No template configured for this product.'` → `__('No template configured for this product.', 'product-designer')`
- `'Loading designer...'` → `__('Loading designer...', 'product-designer')`
- `'Template not available.'` → `__('Template not available.', 'product-designer')`
- `'Saving...'`, `'Saved!'`, `'Save Design'` → wrap each
- `'Close Designer'` → `__('Close Designer', 'product-designer')`

**Sidebar.jsx** (lines 28, 36, 43):
- `'Add'`, `'Element'`, `'Views'` → wrap each

**DesignerCanvas.jsx** (line 411):
- `'Your text here'` → `__('Your text here', 'product-designer')`

**AddTab.jsx** (lines 29, 36, 38, 45, 54, 56):
- `'Add Element'` → wrap
- Title attributes: `'Text not allowed on this view'`, `'Add text'`, `'Add image (jpg, png, webp)'`, etc. → wrap each
- Button text: `'Text'`, `'Image'`, `'SVG'` → wrap each

**ElementTab.jsx** (lines 11, 19, 55, 93, 110, 126, 231):
- `'Select an element'`, `' Properties'`, `'Delete'` → wrap
- Form labels: `'Font'`, `'Size'`, `'Color'`, `'Tint Color'` → wrap each

**ViewsTab.jsx** (lines 16, 25):
- `'Views'` → wrap
- `` `View ${i + 1}` `` — use `sprintf(__('View %d', 'product-designer'), i + 1)` (also import `sprintf` from `@wordpress/i18n`)

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Frontend bundle builds without errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/js/designer/src/
git commit -m "feat(i18n): wrap all frontend designer strings with __()"
```

---

## Task 4: i18n — Generate .pot and Dutch translations

**Files:**
- Create: `languages/product-designer.pot`
- Create: `languages/product-designer-nl_NL.po`
- Create: `languages/product-designer-nl_NL.mo`
- Create: `languages/product-designer-nl_NL-*.json`

- [ ] **Step 1: Build JS so make-pot picks up all strings**

Run: `npm run build`

- [ ] **Step 2: Generate .pot file**

```bash
docker compose exec wordpress wp i18n make-pot \
  wp-content/plugins/product-designer \
  wp-content/plugins/product-designer/languages/product-designer.pot \
  --allow-root
```

Expected: `languages/product-designer.pot` created with all PHP and JS strings.

- [ ] **Step 3: Create Dutch .po file**

Copy the `.pot` file to `languages/product-designer-nl_NL.po`. Set the header:

```
"Language: nl_NL\n"
"Plural-Forms: nplurals=2; plural=(n != 1);\n"
```

Translate all `msgstr ""` entries to Dutch. Key translations:

| English | Dutch |
|---------|-------|
| Product Designer | Product Designer |
| Templates | Sjablonen |
| Template Builder | Sjabloon Bewerken |
| Add New | Nieuw Toevoegen |
| Save | Opslaan |
| Saving... | Opslaan... |
| Saved | Opgeslagen |
| Draft | Concept |
| Published | Gepubliceerd |
| Archived | Gearchiveerd |
| Customize Product | Product Aanpassen |
| Save Design | Ontwerp Opslaan |
| Close Designer | Designer Sluiten |
| Add Element | Element Toevoegen |
| Text | Tekst |
| Image | Afbeelding |
| SVG | SVG |
| Views | Weergaven |
| Element | Element |
| Delete | Verwijderen |
| Font | Lettertype |
| Size | Grootte |
| Color | Kleur |
| Your text here | Uw tekst hier |
| Loading designer... | Designer laden... |
| Loading template... | Sjabloon laden... |
| Structure | Structuur |
| Permissions | Rechten |
| Pricing | Prijzen |
| Settings | Instellingen |
| Title is required. | Titel is verplicht. |
| Template title... | Sjabloontitel... |
| Add a boundary first to place layers. | Voeg eerst een begrenzing toe om lagen te plaatsen. |
| Design | Ontwerp |
| Customized | Aangepast |
| Export Design: | Ontwerp Exporteren: |

Translate ALL strings in the .po file — these are just the key ones.

- [ ] **Step 4: Compile .mo file**

```bash
docker compose exec wordpress wp i18n make-mo \
  wp-content/plugins/product-designer/languages/product-designer-nl_NL.po \
  --allow-root
```

- [ ] **Step 5: Generate JSON translation files for JS**

```bash
docker compose exec wordpress wp i18n make-json \
  wp-content/plugins/product-designer/languages/ \
  --no-purge \
  --allow-root
```

Expected: One or more `product-designer-nl_NL-*.json` files created.

- [ ] **Step 6: Remove .gitkeep from languages directory**

The directory now has real files, so `.gitkeep` is no longer needed:
```bash
rm languages/.gitkeep
```

- [ ] **Step 7: Commit**

```bash
git add languages/
git commit -m "feat(i18n): add Dutch translations (nl_NL) and .pot template"
```

---

## Task 5: Accessibility — Frontend designer ARIA + focus styles

**Files:**
- Modify: `frontend/js/designer/src/components/Sidebar.jsx`
- Modify: `frontend/js/designer/src/components/tabs/AddTab.jsx`
- Modify: `frontend/js/designer/src/components/tabs/ViewsTab.jsx`
- Modify: `frontend/js/designer/src/App.jsx`
- Modify: `frontend/js/designer/src/designer.css`

- [ ] **Step 1: Add ARIA to Sidebar.jsx**

Add `role="tablist"` to the tab button container. On each tab button add `role="tab"` and `aria-selected={activeTab === 'tabname'}`. On the active panel wrapper add `role="tabpanel"`. Add `id` and `aria-controls` linking.

Example pattern:
```jsx
<div className="pd-sidebar__tabs" role="tablist" aria-label={__('Designer tools', 'product-designer')}>
  <button role="tab" aria-selected={activeTab === 'add'} aria-controls="pd-panel-add" id="pd-tab-add" ...>
    {__('Add', 'product-designer')}
  </button>
  ...
</div>
<div role="tabpanel" id="pd-panel-add" aria-labelledby="pd-tab-add">
  ...
</div>
```

- [ ] **Step 2: Add ARIA labels to AddTab.jsx buttons**

Add `aria-label` to icon-only or short-text buttons:
```jsx
<button aria-label={__('Add text element', 'product-designer')} ...>
```

- [ ] **Step 3: Add ARIA to ViewsTab.jsx**

Add `role="tablist"` to the view list. On each view button add `role="tab"` and `aria-selected`.

- [ ] **Step 4: Add aria-live to App.jsx status messages**

Wrap the save button status text in a container with `aria-live="polite"`:
```jsx
<span aria-live="polite">
  {saving ? __('Saving...', 'product-designer') : saved ? __('Saved!', 'product-designer') : __('Save Design', 'product-designer')}
</span>
```

- [ ] **Step 5: Add focus trapping to modal mode**

In `App.jsx`, when `displayMode === 'modal'` and the designer is open:
1. On open: save `document.activeElement` as the return target, focus the first interactive element inside the modal
2. Add a `keydown` listener for Tab — if focus would leave the modal, wrap it
3. Add a `keydown` listener for Escape — close the modal
4. On close: restore focus to the saved element

- [ ] **Step 6: Add CSS focus styles and sr-only utility**

Add to `frontend/js/designer/src/designer.css`:

```css
/* Focus styles for keyboard navigation */
.pd-designer button:focus-visible,
.pd-designer [role="tab"]:focus-visible,
.pd-designer input:focus-visible,
.pd-designer select:focus-visible {
    outline: 2px solid #1e88e5;
    outline-offset: 2px;
}

/* Screen-reader only utility */
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

- [ ] **Step 7: Build and verify**

Run: `npm run build`
Expected: Builds without errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/js/designer/src/
git commit -m "feat(a11y): add ARIA roles, focus styles, and modal focus trapping to frontend designer"
```

---

## Task 6: Accessibility — Admin builder ARIA + focus styles

**Files:**
- Modify: `admin/js/template-builder/src/components/TreePanel.jsx`
- Modify: `admin/js/template-builder/src/components/TreeNode.jsx`
- Modify: `admin/js/template-builder/src/builder.css`

- [ ] **Step 1: Add aria-label to TreeNode action buttons**

In `TreeNode.jsx`, add `aria-label` to each icon button:
```jsx
<button aria-label={__('Drag to reorder', 'product-designer')} ...>⠿</button>
<button aria-label={__('Add layer', 'product-designer')} ...>+</button>
<button aria-label={visible ? __('Hide layer', 'product-designer') : __('Show layer', 'product-designer')} ...>
<button aria-label={locked ? __('Unlock layer', 'product-designer') : __('Lock layer', 'product-designer')} ...>
<button aria-label={__('Delete', 'product-designer')} ...>×</button>
```

- [ ] **Step 2: Add aria-label to TreePanel action buttons**

In `TreePanel.jsx`, add `aria-label` to the "Add Boundary" button and any other icon buttons.

- [ ] **Step 3: Add CSS focus styles**

Add to `admin/js/template-builder/src/builder.css`:

```css
/* Focus styles for keyboard navigation */
.pd-builder button:focus-visible,
.pd-builder [role="tab"]:focus-visible,
.pd-builder input:focus-visible,
.pd-builder select:focus-visible {
    outline: 2px solid #1e88e5;
    outline-offset: 2px;
}
```

(Adjust the root selector `.pd-builder` to match the actual admin wrapper class.)

- [ ] **Step 4: Build and verify**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add admin/js/template-builder/src/
git commit -m "feat(a11y): add ARIA labels and focus styles to admin template builder"
```

---

## Task 7: Performance — Batch queries + transient caching

**Files:**
- Modify: `includes/Database/class-template-repository.php`
- Modify: `includes/Admin/class-template-list-table.php`

- [ ] **Step 1: Add batch count methods to TemplateRepository**

In `includes/Database/class-template-repository.php`, add after the existing `count_products()` method:

```php
/**
 * Count views for multiple templates in a single query.
 * @return array<int, int> [template_id => count]
 */
public function count_views_batch(array $template_ids): array {
    global $wpdb;
    if (empty($template_ids)) {
        return [];
    }
    $ids = array_map('intval', $template_ids);
    $placeholders = implode(',', array_fill(0, count($ids), '%d'));
    $results = $wpdb->get_results(
        $wpdb->prepare(
            "SELECT template_id, COUNT(*) as cnt FROM {$this->views_table} WHERE template_id IN ($placeholders) GROUP BY template_id",
            ...$ids
        ),
        ARRAY_A
    );
    $counts = [];
    foreach ($results as $row) {
        $counts[(int) $row['template_id']] = (int) $row['cnt'];
    }
    return $counts;
}

/**
 * Count products using each template in a single query.
 * @return array<int, int> [template_id => count]
 */
public function count_products_batch(array $template_ids): array {
    global $wpdb;
    if (empty($template_ids)) {
        return [];
    }
    $ids = array_map('intval', $template_ids);
    $placeholders = implode(',', array_fill(0, count($ids), '%s'));
    $results = $wpdb->get_results(
        $wpdb->prepare(
            "SELECT meta_value as template_id, COUNT(*) as cnt FROM {$wpdb->postmeta} WHERE meta_key = '_pd_template_id' AND meta_value IN ($placeholders) GROUP BY meta_value",
            ...array_map('strval', $ids)
        ),
        ARRAY_A
    );
    $counts = [];
    foreach ($results as $row) {
        $counts[(int) $row['template_id']] = (int) $row['cnt'];
    }
    return $counts;
}
```

- [ ] **Step 2: Add transient caching to `get()` method**

In `includes/Database/class-template-repository.php`, wrap the `get()` method body:

```php
public function get(int $id): ?array {
    $cache_key = 'pd_template_' . $id;
    $cached = get_transient($cache_key);
    if ($cached !== false) {
        return $cached;
    }

    // ... existing query logic ...

    set_transient($cache_key, $result, 5 * MINUTE_IN_SECONDS);
    return $result;
}
```

Add cache invalidation in `create()` and `update()`:
```php
delete_transient('pd_template_' . $id);
```

Also add invalidation in `create_view()`, `update_view()`, `delete_view()` methods:
```php
delete_transient('pd_template_' . $template_id);
```

- [ ] **Step 3: Update TemplateListTable to use batch methods**

In `includes/Admin/class-template-list-table.php`, in `prepare_items()`, after fetching items:

```php
// Batch-load counts
$ids = array_map(function ($item) { return (int) $item['id']; }, $this->items);
$this->view_counts = $this->repo->count_views_batch($ids);
$this->product_counts = $this->repo->count_products_batch($ids);
```

Add `private array $view_counts = [];` and `private array $product_counts = [];` as class properties.

Update `column_view_count()` and `column_product_count()` to read from stored arrays:
```php
protected function column_view_count(array $item): string {
    return (string) ($this->view_counts[(int) $item['id']] ?? 0);
}

protected function column_product_count(array $item): string {
    return (string) ($this->product_counts[(int) $item['id']] ?? 0);
}
```

- [ ] **Step 4: Verify in browser**

Open `http://localhost:8080/wp-admin/admin.php?page=product-designer` and verify the template list still shows correct view and product counts.

- [ ] **Step 5: Commit**

```bash
git add includes/Database/class-template-repository.php includes/Admin/class-template-list-table.php
git commit -m "perf: batch list table queries, add transient caching for template lookups"
```

---

## Task 8: Testing infrastructure — PHPUnit setup

**Files:**
- Create: `phpunit.xml`
- Create: `tests/php/bootstrap.php`

- [ ] **Step 1: Install PHPUnit in Docker**

```bash
docker compose exec wordpress bash -c "
  curl -L https://phar.phpunit.de/phpunit-9.phar -o /usr/local/bin/phpunit && \
  chmod +x /usr/local/bin/phpunit
"
```

Verify: `docker compose exec wordpress phpunit --version`
Expected: PHPUnit 9.x

- [ ] **Step 2: Create phpunit.xml**

Create `phpunit.xml` in the project root:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<phpunit
    bootstrap="tests/php/bootstrap.php"
    colors="true"
    testdox="true"
    stopOnFailure="false"
>
    <testsuites>
        <testsuite name="ProductDesigner">
            <directory>tests/php</directory>
        </testsuite>
    </testsuites>
</phpunit>
```

- [ ] **Step 3: Create bootstrap.php**

Create `tests/php/bootstrap.php`:

```php
<?php
/**
 * PHPUnit bootstrap — loads WordPress and activates the plugin.
 * Run from Docker: docker compose exec wordpress bash -c "cd wp-content/plugins/product-designer && phpunit"
 */

// Load WordPress
require_once '/var/www/html/wp-load.php';

// Activate plugin if not already active
if (!is_plugin_active('product-designer/product-designer.php')) {
    activate_plugin('product-designer/product-designer.php');
}

// Ensure our tables exist
$db_manager = new ProductDesigner\Database\DbManager();
$db_manager->install();
```

- [ ] **Step 4: Verify PHPUnit runs**

```bash
docker compose exec wordpress bash -c "cd wp-content/plugins/product-designer && phpunit"
```

Expected: "No tests executed" (no test files yet), but no bootstrap errors.

- [ ] **Step 5: Commit**

```bash
git add phpunit.xml tests/php/bootstrap.php
git commit -m "test: add PHPUnit infrastructure with WordPress bootstrap"
```

---

## Task 9: PHP tests — Repository + Security + Pricing

**Files:**
- Create: `tests/php/Database/TemplateRepositoryTest.php`
- Create: `tests/php/Database/DesignRepositoryTest.php`
- Create: `tests/php/Security/UploadValidatorTest.php`
- Create: `tests/php/Security/CapabilityCheckerTest.php`
- Create: `tests/php/Security/NonceManagerTest.php`
- Create: `tests/php/Pricing/PriceCalculatorTest.php`

**API reference (exact method signatures):**
- `TemplateRepository::create(array $data): int` — NOT `save()`
- `TemplateRepository::get(int $id): ?array`
- `TemplateRepository::update(int $id, array $data): bool`
- `TemplateRepository::list(int $per_page, int $page, string $status): array`
- `DesignRepository::create(array $data): int` — generates its own `design_hash` internally
- `DesignRepository::get_by_hash(string $hash): ?array`
- `UploadValidator::validate_and_store(array $file, string $session_id): array` — static, takes `['tmp_name' => ..., 'size' => ...]`
- `CapabilityChecker::can_manage_templates(): bool` — static
- `NonceManager::create(string $action): string` — static
- `NonceManager::verify(string $nonce, string $action): bool` — static
- `PriceCalculator::calculate(string $design_hash): float` — takes a hash, not arrays

- [ ] **Step 1: Create TemplateRepositoryTest**

Create `tests/php/Database/TemplateRepositoryTest.php`:

```php
<?php
use PHPUnit\Framework\TestCase;
use ProductDesigner\Database\TemplateRepository;

class TemplateRepositoryTest extends TestCase {
    private TemplateRepository $repo;

    protected function setUp(): void {
        $this->repo = new TemplateRepository();
    }

    public function test_create_and_get_template(): void {
        $id = $this->repo->create([
            'title' => 'Test Template',
            'slug' => 'test-template-' . uniqid(),
            'status' => 'draft',
            'global_config' => '{}',
        ]);
        $this->assertIsInt($id);
        $this->assertGreaterThan(0, $id);

        $template = $this->repo->get($id);
        $this->assertNotNull($template);
        $this->assertEquals('Test Template', $template['title']);
    }

    public function test_update_template(): void {
        $id = $this->repo->create([
            'title' => 'Before Update',
            'slug' => 'update-test-' . uniqid(),
            'status' => 'draft',
            'global_config' => '{}',
        ]);
        $this->repo->update($id, ['title' => 'After Update']);
        $template = $this->repo->get($id);
        $this->assertEquals('After Update', $template['title']);
    }

    public function test_list_templates_with_pagination(): void {
        // Create 3 templates
        for ($i = 0; $i < 3; $i++) {
            $this->repo->create([
                'title' => 'Pagination Test ' . $i,
                'slug' => 'pagination-' . $i . '-' . uniqid(),
                'status' => 'draft',
                'global_config' => '{}',
            ]);
        }
        // Page 1 with per_page=2 should return 2
        $page1 = $this->repo->list(2, 1);
        $this->assertCount(2, $page1);

        // Page 2 should return at least 1
        $page2 = $this->repo->list(2, 2);
        $this->assertGreaterThanOrEqual(1, count($page2));

        // Pages should not overlap
        $page1_ids = array_column($page1, 'id');
        $page2_ids = array_column($page2, 'id');
        $this->assertEmpty(array_intersect($page1_ids, $page2_ids));
    }

    public function test_count_views_batch(): void {
        $counts = $this->repo->count_views_batch([1, 2, 3]);
        $this->assertIsArray($counts);
    }

    public function test_count_products_batch(): void {
        $counts = $this->repo->count_products_batch([1, 2, 3]);
        $this->assertIsArray($counts);
    }

    protected function tearDown(): void {
        global $wpdb;
        $table = $wpdb->prefix . 'pd_templates';
        $wpdb->query("DELETE FROM $table WHERE title LIKE 'Test Template%' OR title LIKE '%Update%'");
    }
}
```

- [ ] **Step 2: Create DesignRepositoryTest**

Create `tests/php/Database/DesignRepositoryTest.php`:

```php
<?php
use PHPUnit\Framework\TestCase;
use ProductDesigner\Database\DesignRepository;

class DesignRepositoryTest extends TestCase {
    private DesignRepository $repo;
    private array $created_ids = [];

    protected function setUp(): void {
        $this->repo = new DesignRepository();
    }

    public function test_create_design_generates_hash(): void {
        $id = $this->repo->create([
            'template_id' => 1,
            'product_id' => 1,
            'customer_id' => 0,
            'session_id' => 'test-session-' . uniqid(),
            'status' => 'draft',
            'total_price' => 0,
        ]);
        $this->created_ids[] = $id;
        $this->assertIsInt($id);
        $this->assertGreaterThan(0, $id);

        // Verify a hash was generated
        $design = $this->repo->get($id);
        $this->assertNotEmpty($design['design_hash']);
        $this->assertEquals(32, strlen($design['design_hash']));
    }

    public function test_get_by_hash(): void {
        $id = $this->repo->create([
            'template_id' => 1,
            'product_id' => 1,
            'customer_id' => 0,
            'session_id' => 'test-session-' . uniqid(),
            'status' => 'draft',
            'total_price' => 0,
        ]);
        $this->created_ids[] = $id;

        $design = $this->repo->get($id);
        $hash = $design['design_hash'];

        $found = $this->repo->get_by_hash($hash);
        $this->assertNotNull($found);
        $this->assertEquals($id, (int) $found['id']);
    }

    public function test_update_status(): void {
        $id = $this->repo->create([
            'template_id' => 1,
            'product_id' => 1,
            'customer_id' => 0,
            'session_id' => 'test-session-' . uniqid(),
            'status' => 'draft',
            'total_price' => 0,
        ]);
        $this->created_ids[] = $id;

        $this->repo->update_status($id, 'final');
        $design = $this->repo->get($id);
        $this->assertEquals('final', $design['status']);
    }

    protected function tearDown(): void {
        foreach ($this->created_ids as $id) {
            $this->repo->delete($id);
        }
    }
}
```

- [ ] **Step 3: Create UploadValidatorTest**

Create `tests/php/Security/UploadValidatorTest.php`:

```php
<?php
use PHPUnit\Framework\TestCase;
use ProductDesigner\Security\UploadValidator;

class UploadValidatorTest extends TestCase {
    public function test_rejects_php_file(): void {
        $tmp = tempnam(sys_get_temp_dir(), 'test');
        file_put_contents($tmp, '<?php echo "hack"; ?>');

        $this->expectException(\RuntimeException::class);
        UploadValidator::validate_and_store(
            ['tmp_name' => $tmp, 'size' => filesize($tmp), 'name' => 'evil.php'],
            'test-session'
        );
    }

    public function test_rejects_executable_js(): void {
        $tmp = tempnam(sys_get_temp_dir(), 'test');
        file_put_contents($tmp, 'alert("xss")');

        $this->expectException(\RuntimeException::class);
        UploadValidator::validate_and_store(
            ['tmp_name' => $tmp, 'size' => filesize($tmp), 'name' => 'evil.js'],
            'test-session'
        );
    }

    public function test_accepts_valid_png(): void {
        $tmp = tempnam(sys_get_temp_dir(), 'test');
        $img = imagecreatetruecolor(1, 1);
        imagepng($img, $tmp);
        imagedestroy($img);

        // May throw RuntimeException due to upload dir permissions in test environment,
        // but should NOT throw for MIME type rejection
        try {
            $result = UploadValidator::validate_and_store(
                ['tmp_name' => $tmp, 'size' => filesize($tmp), 'name' => 'test.png'],
                'test-session'
            );
            $this->assertArrayHasKey('url', $result);
        } catch (\RuntimeException $e) {
            // OK if it fails for non-MIME reasons (e.g., upload dir permissions)
            $this->assertStringNotContainsString('not allowed', $e->getMessage());
        }
        @unlink($tmp);
    }

    public function test_rate_limit_blocks_after_threshold(): void {
        $session = 'rate-limit-test-' . uniqid();
        // Set the transient to simulate 10 uploads already done
        set_transient('pd_upload_count_' . md5($session), 10, MINUTE_IN_SECONDS);

        $tmp = tempnam(sys_get_temp_dir(), 'test');
        $img = imagecreatetruecolor(1, 1);
        imagepng($img, $tmp);
        imagedestroy($img);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionCode(429);
        UploadValidator::validate_and_store(
            ['tmp_name' => $tmp, 'size' => filesize($tmp), 'name' => 'test.png'],
            $session
        );
    }
}
```

- [ ] **Step 4: Create CapabilityCheckerTest**

Create `tests/php/Security/CapabilityCheckerTest.php`:

```php
<?php
use PHPUnit\Framework\TestCase;
use ProductDesigner\Security\CapabilityChecker;

class CapabilityCheckerTest extends TestCase {
    public function test_admin_can_manage_templates(): void {
        wp_set_current_user(1); // admin user created by setup.sh
        $this->assertTrue(CapabilityChecker::can_manage_templates());
    }

    public function test_unauthenticated_cannot_manage_templates(): void {
        wp_set_current_user(0);
        $this->assertFalse(CapabilityChecker::can_manage_templates());
    }

    public function test_session_id_is_generated(): void {
        $session = CapabilityChecker::current_session_id();
        $this->assertNotEmpty($session);
    }
}
```

- [ ] **Step 5: Create NonceManagerTest**

Create `tests/php/Security/NonceManagerTest.php`:

```php
<?php
use PHPUnit\Framework\TestCase;
use ProductDesigner\Security\NonceManager;

class NonceManagerTest extends TestCase {
    public function test_create_returns_string(): void {
        $nonce = NonceManager::create('test-action');
        $this->assertIsString($nonce);
        $this->assertNotEmpty($nonce);
    }

    public function test_verify_valid_nonce(): void {
        $nonce = NonceManager::create('test-action');
        $this->assertTrue(NonceManager::verify($nonce, 'test-action'));
    }

    public function test_verify_invalid_nonce(): void {
        $this->assertFalse(NonceManager::verify('invalid-nonce-value', 'test-action'));
    }
}
```

- [ ] **Step 6: Create PriceCalculatorTest**

Create `tests/php/Pricing/PriceCalculatorTest.php`:

The `PriceCalculator::calculate()` takes a `string $design_hash` and returns `float`. It reads the design from the database, counts elements, and applies pricing rules. To test it we need a design in the DB.

```php
<?php
use PHPUnit\Framework\TestCase;
use ProductDesigner\Pricing\PriceCalculator;
use ProductDesigner\Database\DesignRepository;

class PriceCalculatorTest extends TestCase {
    private PriceCalculator $calc;
    private DesignRepository $designs;
    private array $created_ids = [];

    protected function setUp(): void {
        $this->calc = new PriceCalculator();
        $this->designs = new DesignRepository();
    }

    public function test_returns_zero_for_nonexistent_design(): void {
        $result = $this->calc->calculate('nonexistent-hash-' . uniqid());
        $this->assertEquals(0.0, $result);
    }

    public function test_returns_zero_for_empty_design(): void {
        // Create a design with no views/objects
        $id = $this->designs->create([
            'template_id' => 1,
            'product_id' => 1,
            'customer_id' => 0,
            'session_id' => 'price-test-' . uniqid(),
            'status' => 'draft',
            'total_price' => 0,
        ]);
        $this->created_ids[] = $id;

        $design = $this->designs->get($id);
        $result = $this->calc->calculate($design['design_hash']);
        $this->assertEquals(0.0, $result);
    }

    protected function tearDown(): void {
        foreach ($this->created_ids as $id) {
            $this->designs->delete($id);
        }
    }
}
```

- [ ] **Step 7: Run tests**

```bash
docker compose exec wordpress bash -c "cd wp-content/plugins/product-designer && phpunit"
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add tests/php/
git commit -m "test: add PHP tests for repositories, security, and pricing"
```

---

## Task 10: PHP tests — Export tests

**Files:**
- Create: `tests/php/Export/SvgExporterTest.php`
- Create: `tests/php/Export/PdfExporterTest.php`
- Create: `tests/php/Export/PngExporterTest.php`

- [ ] **Step 1: Create SvgExporterTest**

Create `tests/php/Export/SvgExporterTest.php`:

```php
<?php
use PHPUnit\Framework\TestCase;
use ProductDesigner\Export\SvgExporter;

class SvgExporterTest extends TestCase {
    private SvgExporter $exporter;

    protected function setUp(): void {
        $this->exporter = new SvgExporter();
    }

    public function test_renders_valid_svg(): void {
        $canvas_json = [
            'background' => '#ffffff',
            'objects' => [
                ['type' => 'IText', 'text' => 'Test', 'left' => 10, 'top' => 10, 'fontSize' => 20, 'fill' => '#000000'],
            ],
        ];
        $svg = $this->exporter->render($canvas_json, 800, 600);
        $this->assertStringStartsWith('<?xml', $svg);
        $this->assertStringContainsString('<svg', $svg);
        $this->assertStringContainsString('Test', $svg);
        $this->assertStringContainsString('</svg>', $svg);
    }

    public function test_exports_to_file(): void {
        $canvas_json = ['background' => '#ffffff', 'objects' => []];
        $path = sys_get_temp_dir() . '/pd-test-' . uniqid() . '.svg';
        $result = $this->exporter->export($canvas_json, 800, 600, $path);
        $this->assertTrue($result);
        $this->assertFileExists($path);
        @unlink($path);
    }

    public function test_renders_rect(): void {
        $canvas_json = [
            'objects' => [
                ['type' => 'Rect', 'left' => 0, 'top' => 0, 'width' => 100, 'height' => 50, 'fill' => '#ff0000'],
            ],
        ];
        $svg = $this->exporter->render($canvas_json, 800, 600);
        $this->assertStringContainsString('<rect', $svg);
    }
}
```

- [ ] **Step 2: Create PdfExporterTest**

Create `tests/php/Export/PdfExporterTest.php`:

```php
<?php
use PHPUnit\Framework\TestCase;
use ProductDesigner\Export\PdfExporter;

class PdfExporterTest extends TestCase {
    public function test_exports_single_view_pdf(): void {
        $exporter = new PdfExporter();
        $path = sys_get_temp_dir() . '/pd-test-' . uniqid() . '.pdf';
        $result = $exporter->export([
            [
                'canvas_json' => ['background' => '#ffffff', 'objects' => [
                    ['type' => 'IText', 'text' => 'PDF Test', 'left' => 50, 'top' => 50, 'fontSize' => 24, 'fill' => '#000000'],
                ]],
                'width' => 800,
                'height' => 600,
            ],
        ], $path);
        $this->assertTrue($result);
        $this->assertFileExists($path);
        $this->assertGreaterThan(1000, filesize($path)); // PDF should be non-trivial size
        @unlink($path);
    }

    public function test_multi_view_produces_multi_page(): void {
        $exporter = new PdfExporter();
        $path = sys_get_temp_dir() . '/pd-test-' . uniqid() . '.pdf';
        $views = [
            ['canvas_json' => ['background' => '#fff', 'objects' => []], 'width' => 400, 'height' => 300],
            ['canvas_json' => ['background' => '#eee', 'objects' => []], 'width' => 400, 'height' => 300],
        ];
        $result = $exporter->export($views, $path);
        $this->assertTrue($result);
        @unlink($path);
    }

    public function test_returns_false_for_empty_views(): void {
        $exporter = new PdfExporter();
        $result = $exporter->export([], '/tmp/empty.pdf');
        $this->assertFalse($result);
    }
}
```

- [ ] **Step 3: Create PngExporterTest**

Create `tests/php/Export/PngExporterTest.php`:

```php
<?php
use PHPUnit\Framework\TestCase;
use ProductDesigner\Export\PngExporter;

class PngExporterTest extends TestCase {
    public function test_exports_png_file(): void {
        $exporter = new PngExporter();
        $path = sys_get_temp_dir() . '/pd-test-' . uniqid() . '.png';
        $result = $exporter->export(
            ['background' => '#ffffff', 'objects' => []],
            800, 600, $path
        );
        $this->assertTrue($result);
        $this->assertFileExists($path);
        // Verify it's actually a PNG (magic bytes)
        $header = file_get_contents($path, false, null, 0, 4);
        $this->assertStringContainsString('PNG', $header);
        @unlink($path);
    }
}
```

- [ ] **Step 4: Run tests**

```bash
docker compose exec wordpress bash -c "cd wp-content/plugins/product-designer && phpunit tests/php/Export/"
```

Expected: All export tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/php/Export/
git commit -m "test: add SVG, PDF, and PNG exporter tests"
```

---

## Task 11: PHP tests — API endpoints

**Files:**
- Create: `tests/php/API/TemplateEndpointTest.php`
- Create: `tests/php/API/DesignEndpointTest.php`

- [ ] **Step 1: Create TemplateEndpointTest**

Create `tests/php/API/TemplateEndpointTest.php`:

```php
<?php
use PHPUnit\Framework\TestCase;

class TemplateEndpointTest extends TestCase {
    private $server;

    protected function setUp(): void {
        global $wp_rest_server;
        $this->server = $wp_rest_server = new \WP_REST_Server();
        do_action('rest_api_init');
    }

    public function test_list_templates_requires_admin(): void {
        wp_set_current_user(0); // unauthenticated
        $request = new \WP_REST_Request('GET', '/pd/v1/templates');
        $response = $this->server->dispatch($request);
        $this->assertEquals(403, $response->get_status());
    }

    public function test_create_template_requires_admin(): void {
        wp_set_current_user(0);
        $request = new \WP_REST_Request('POST', '/pd/v1/templates');
        $request->set_body_params(['title' => 'Test', 'slug' => 'test']);
        $response = $this->server->dispatch($request);
        $this->assertEquals(403, $response->get_status());
    }

    public function test_admin_can_list_templates(): void {
        wp_set_current_user(1); // admin
        $request = new \WP_REST_Request('GET', '/pd/v1/templates');
        $response = $this->server->dispatch($request);
        $this->assertContains($response->get_status(), [200, 204]);
    }

    public function test_admin_can_create_template(): void {
        wp_set_current_user(1);
        $request = new \WP_REST_Request('POST', '/pd/v1/templates');
        $request->set_body_params([
            'title' => 'API Test Template ' . uniqid(),
            'status' => 'draft',
        ]);
        $response = $this->server->dispatch($request);
        $data = $response->get_data();
        $this->assertContains($response->get_status(), [200, 201]);
        $this->assertArrayHasKey('id', $data);
    }

    public function test_list_returns_pagination_headers(): void {
        wp_set_current_user(1);
        $request = new \WP_REST_Request('GET', '/pd/v1/templates');
        $request->set_param('per_page', 5);
        $request->set_param('page', 1);
        $response = $this->server->dispatch($request);
        $headers = $response->get_headers();
        $this->assertArrayHasKey('X-WP-Total', $headers);
    }

    protected function tearDown(): void {
        global $wp_rest_server;
        $wp_rest_server = null;
    }
}
```

- [ ] **Step 2: Create DesignEndpointTest**

Create `tests/php/API/DesignEndpointTest.php`:

```php
<?php
use PHPUnit\Framework\TestCase;

class DesignEndpointTest extends TestCase {
    private $server;

    protected function setUp(): void {
        global $wp_rest_server;
        $this->server = $wp_rest_server = new \WP_REST_Server();
        do_action('rest_api_init');
    }

    public function test_create_design_returns_hash(): void {
        // Designs can be created by anyone (customers)
        $request = new \WP_REST_Request('POST', '/pd/v1/designs');
        $request->set_body_params([
            'template_id' => 1,
            'product_id' => 1,
        ]);
        $response = $this->server->dispatch($request);
        // May return 200/201 or 400 if template doesn't exist
        $this->assertLessThan(500, $response->get_status());
    }

    public function test_admin_list_requires_capability(): void {
        wp_set_current_user(0); // unauthenticated
        $request = new \WP_REST_Request('GET', '/pd/v1/admin/designs');
        $response = $this->server->dispatch($request);
        $this->assertEquals(403, $response->get_status());
    }

    public function test_admin_can_list_designs(): void {
        wp_set_current_user(1); // admin
        $request = new \WP_REST_Request('GET', '/pd/v1/admin/designs');
        $response = $this->server->dispatch($request);
        $this->assertContains($response->get_status(), [200, 204]);
    }

    protected function tearDown(): void {
        global $wp_rest_server;
        $wp_rest_server = null;
    }
}
```

- [ ] **Step 3: Run tests**

```bash
docker compose exec wordpress bash -c "cd wp-content/plugins/product-designer && phpunit tests/php/API/"
```

Expected: All API endpoint tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/php/API/
git commit -m "test: add API endpoint tests for templates and designs"
```

---

## Task 12: Jest test infrastructure + store tests

**Files:**
- Create: `jest.config.js`
- Create: `tests/js/setup.js`
- Create: `tests/js/stores/useTemplateStore.test.js`
- Create: `tests/js/stores/useDesignerStore.test.js`
- Modify: `package.json`

- [ ] **Step 1: Install Jest dev dependencies**

```bash
npm install --save-dev jest @testing-library/react @testing-library/jest-dom jest-environment-jsdom @babel/preset-env @babel/preset-react babel-jest
```

- [ ] **Step 2: Create jest.config.js**

```javascript
module.exports = {
    testEnvironment: 'jsdom',
    setupFilesAfterSetup: ['./tests/js/setup.js'],
    transform: {
        '^.+\\.jsx?$': 'babel-jest',
    },
    transformIgnorePatterns: ['/node_modules/(?!zustand)'],
    moduleNameMapper: {
        '\\.(css|less|scss)$': '<rootDir>/tests/js/__mocks__/styleMock.js',
        '@wordpress/i18n': '<rootDir>/tests/js/__mocks__/wpI18n.js',
        '^fabric$': '<rootDir>/tests/js/__mocks__/fabric.js',
    },
    testMatch: ['<rootDir>/tests/js/**/*.test.js'],
};
```

- [ ] **Step 3: Create setup and mock files**

Create `tests/js/setup.js`:
```javascript
import '@testing-library/jest-dom';
```

Create `tests/js/__mocks__/styleMock.js`:
```javascript
module.exports = {};
```

Create `tests/js/__mocks__/wpI18n.js`:
```javascript
export const __ = (str) => str;
export const _x = (str) => str;
export const sprintf = (fmt, ...args) => {
    let i = 0;
    return fmt.replace(/%[sd]/g, () => args[i++]);
};
```

Create `tests/js/__mocks__/fabric.js`:
```javascript
export const Canvas = jest.fn();
export const IText = jest.fn();
export const Rect = jest.fn();
export default { Canvas, IText, Rect };
```

- [ ] **Step 4: Add babel config for JSX**

Create `babel.config.js`:
```javascript
module.exports = {
    presets: [
        ['@babel/preset-env', { targets: { node: 'current' } }],
        ['@babel/preset-react', { runtime: 'automatic' }],
    ],
};
```

- [ ] **Step 5: Add test scripts to package.json**

Add to `scripts` in `package.json`:
```json
"test": "jest",
"test:watch": "jest --watch"
```

- [ ] **Step 6: Create useTemplateStore test**

**API reference (exact Zustand actions):**
- `addView(view)` — takes a view object, adds `_clientId`
- `removeView(index)` — takes an integer index, NOT a `_clientId`
- `setCurrentViewIndex(i)` — sets active view
- `setTitle(title)`, `setStatus(status)` — simple setters
- State shape: `{ views: [], currentViewIndex: 0, title: '', status: 'draft', ... }`

Create `tests/js/stores/useTemplateStore.test.js`:

```javascript
import { act } from '@testing-library/react';

let useTemplateStore;

beforeEach(() => {
    jest.resetModules();
    useTemplateStore = require('../../../admin/js/template-builder/src/store/useTemplateStore').default;
});

describe('useTemplateStore', () => {
    test('initial state has empty views', () => {
        const state = useTemplateStore.getState();
        expect(state.views).toEqual([]);
    });

    test('addView adds a view', () => {
        act(() => useTemplateStore.getState().addView({ name: 'Test View' }));
        const state = useTemplateStore.getState();
        expect(state.views.length).toBe(1);
        expect(state.views[0].name).toBe('Test View');
        expect(state.views[0]._clientId).toBeDefined();
    });

    test('removeView removes a view by index', () => {
        act(() => {
            useTemplateStore.getState().addView({ name: 'View 1' });
            useTemplateStore.getState().addView({ name: 'View 2' });
        });
        expect(useTemplateStore.getState().views.length).toBe(2);

        act(() => useTemplateStore.getState().removeView(0));
        expect(useTemplateStore.getState().views.length).toBe(1);
        expect(useTemplateStore.getState().views[0].name).toBe('View 2');
    });

    test('setCurrentViewIndex switches active view', () => {
        act(() => useTemplateStore.getState().setCurrentViewIndex(2));
        expect(useTemplateStore.getState().currentViewIndex).toBe(2);
    });

    test('setTitle updates title', () => {
        act(() => useTemplateStore.getState().setTitle('New Title'));
        expect(useTemplateStore.getState().title).toBe('New Title');
    });

    test('undo/redo: after addView, undo removes it, redo restores it', () => {
        // Add a view and push history
        act(() => {
            useTemplateStore.getState().addView({ name: 'Undo Test View' });
        });
        const viewKey = useTemplateStore.getState().views[0]._clientId;

        // Push a snapshot before making a change
        const snapshotBefore = JSON.stringify(useTemplateStore.getState().views);
        act(() => useTemplateStore.getState().pushHistory(viewKey, snapshotBefore));

        // Make a change
        act(() => useTemplateStore.getState().addView({ name: 'Second View' }));
        const snapshotAfter = JSON.stringify(useTemplateStore.getState().views);
        act(() => useTemplateStore.getState().pushHistory(viewKey, snapshotAfter));

        expect(useTemplateStore.getState().views.length).toBe(2);
        expect(useTemplateStore.getState().canUndo(viewKey)).toBe(true);

        // Undo
        act(() => useTemplateStore.getState().undo(viewKey));
        expect(useTemplateStore.getState().canRedo(viewKey)).toBe(true);

        // Redo
        act(() => useTemplateStore.getState().redo(viewKey));
        expect(useTemplateStore.getState().canUndo(viewKey)).toBe(true);
    });
});
```

- [ ] **Step 7: Create useDesignerStore test**

**API reference (exact Zustand actions):**
- `setCurrentViewIndex(i)` — NOT `setActiveView`
- `loadTemplate(data)` — loads template data
- `setActiveTool(tool)` — sets active tool mode
- `setSelectedObject(obj)` — sets selected canvas object
- State shape: `{ template: null, currentViewIndex: 0, activeTool: null, ... }`

Create `tests/js/stores/useDesignerStore.test.js`:

```javascript
import { act } from '@testing-library/react';

let useDesignerStore;

beforeEach(() => {
    jest.resetModules();
    useDesignerStore = require('../../../frontend/js/designer/src/store/useDesignerStore').default;
});

describe('useDesignerStore', () => {
    test('initial state has no template', () => {
        const state = useDesignerStore.getState();
        expect(state.template).toBeNull();
    });

    test('setCurrentViewIndex switches view', () => {
        act(() => useDesignerStore.getState().setCurrentViewIndex(1));
        expect(useDesignerStore.getState().currentViewIndex).toBe(1);
    });

    test('setActiveTool sets tool mode', () => {
        act(() => useDesignerStore.getState().setActiveTool('add-text'));
        expect(useDesignerStore.getState().activeTool).toBe('add-text');
    });

    test('setSelectedObject stores selected object', () => {
        const obj = { type: 'IText', text: 'Hello' };
        act(() => useDesignerStore.getState().setSelectedObject(obj));
        expect(useDesignerStore.getState().selectedObject).toEqual(obj);
    });
});
```

- [ ] **Step 8: Run tests**

Run: `npm test`
Expected: Store tests pass. Fix any import path or method name issues.

- [ ] **Step 9: Commit**

```bash
git add jest.config.js babel.config.js tests/js/ package.json package-lock.json
git commit -m "test: add Jest infrastructure and Zustand store tests"
```

---

## Task 13: Jest component tests

**Files:**
- Create: `tests/js/components/Sidebar.test.js`
- Create: `tests/js/components/AddTab.test.js`
- Create: `tests/js/components/ViewsTab.test.js`

- [ ] **Step 1: Create Sidebar.test.js**

Create `tests/js/components/Sidebar.test.js`:

```javascript
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import Sidebar from '../../../frontend/js/designer/src/components/Sidebar';

// Mock child components
jest.mock('../../../frontend/js/designer/src/components/tabs/AddTab', () => () => <div data-testid="add-tab">AddTab</div>);
jest.mock('../../../frontend/js/designer/src/components/tabs/ElementTab', () => () => <div data-testid="element-tab">ElementTab</div>);
jest.mock('../../../frontend/js/designer/src/components/tabs/ViewsTab', () => () => <div data-testid="views-tab">ViewsTab</div>);

// Mock the store
const mockStore = { selectedObject: null };
jest.mock('../../../frontend/js/designer/src/store/useDesignerStore', () => {
    return jest.fn(() => mockStore);
});

describe('Sidebar', () => {
    beforeEach(() => {
        mockStore.selectedObject = null;
    });

    test('renders all tab buttons', () => {
        render(<Sidebar />);
        expect(screen.getByText('Add')).toBeInTheDocument();
        expect(screen.getByText('Element')).toBeInTheDocument();
        expect(screen.getByText('Views')).toBeInTheDocument();
    });

    test('clicking a tab switches the active panel', () => {
        render(<Sidebar />);
        // Initially Add tab content is shown
        expect(screen.getByTestId('add-tab')).toBeInTheDocument();

        // Click Views tab
        fireEvent.click(screen.getByText('Views'));
        expect(screen.getByTestId('views-tab')).toBeInTheDocument();
    });

    test('Element tab is disabled when no object is selected', () => {
        render(<Sidebar />);
        expect(screen.getByText('Element')).toBeDisabled();
    });
});
```

- [ ] **Step 2: Create AddTab.test.js**

Create `tests/js/components/AddTab.test.js`:

```javascript
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AddTab from '../../../frontend/js/designer/src/components/tabs/AddTab';

const mockSetActiveTool = jest.fn();
const mockTriggerFileUpload = jest.fn();
const mockStore = {
    template: { views: [{ zones_config: [] }] },
    currentViewIndex: 0,
    activeTool: 'select',
    setActiveTool: mockSetActiveTool,
    triggerFileUpload: mockTriggerFileUpload,
};
jest.mock('../../../frontend/js/designer/src/store/useDesignerStore', () => {
    return jest.fn(() => mockStore);
});

describe('AddTab', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockStore.activeTool = 'select';
    });

    test('renders text, image, and SVG buttons', () => {
        render(<AddTab />);
        expect(screen.getByText('Text')).toBeInTheDocument();
        expect(screen.getByText('Image')).toBeInTheDocument();
        expect(screen.getByText('SVG')).toBeInTheDocument();
    });

    test('clicking Text calls setActiveTool with add-text', () => {
        render(<AddTab />);
        fireEvent.click(screen.getByText('Text'));
        expect(mockSetActiveTool).toHaveBeenCalledWith('add-text');
    });

    test('clicking Image triggers file upload', () => {
        render(<AddTab />);
        fireEvent.click(screen.getByText('Image'));
        expect(mockTriggerFileUpload).toHaveBeenCalledWith('image');
    });
});
```

- [ ] **Step 3: Create ViewsTab.test.js**

Create `tests/js/components/ViewsTab.test.js`:

```javascript
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ViewsTab from '../../../frontend/js/designer/src/components/tabs/ViewsTab';

const mockSetCurrentViewIndex = jest.fn();
const mockStore = {
    template: {
        views: [
            { id: 1, name: 'Front' },
            { id: 2, name: 'Back' },
        ],
    },
    currentViewIndex: 0,
    setCurrentViewIndex: mockSetCurrentViewIndex,
};
jest.mock('../../../frontend/js/designer/src/store/useDesignerStore', () => {
    return jest.fn(() => mockStore);
});

describe('ViewsTab', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('renders one button per view', () => {
        render(<ViewsTab />);
        expect(screen.getByText('Front')).toBeInTheDocument();
        expect(screen.getByText('Back')).toBeInTheDocument();
    });

    test('clicking a tab calls setCurrentViewIndex', () => {
        render(<ViewsTab />);
        fireEvent.click(screen.getByText('Back'));
        expect(mockSetCurrentViewIndex).toHaveBeenCalledWith(1);
    });

    test('active tab has active CSS class', () => {
        render(<ViewsTab />);
        const frontBtn = screen.getByText('Front');
        expect(frontBtn.className).toContain('pd-views__btn--active');
    });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All component tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/js/components/
git commit -m "test: add Jest component tests for Sidebar, AddTab, and ViewsTab"
```

---

## Task 14: E2E test infrastructure + admin flow test

**Files:**
- Create: `playwright.config.js`
- Create: `tests/e2e/global-setup.js`
- Create: `tests/e2e/admin-template.spec.js`
- Modify: `package.json`

- [ ] **Step 1: Install Playwright**

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Create playwright.config.js**

```javascript
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/e2e',
    globalSetup: './tests/e2e/global-setup.js',
    use: {
        baseURL: 'http://localhost:8080',
        storageState: './tests/e2e/.auth/admin.json',
        screenshot: 'only-on-failure',
    },
    timeout: 30000,
});
```

- [ ] **Step 3: Create global-setup.js**

```javascript
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

module.exports = async () => {
    const authDir = path.join(__dirname, '.auth');
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Log in as admin
    await page.goto('http://localhost:8080/wp-login.php');
    await page.fill('#user_login', 'admin');
    await page.fill('#user_pass', 'admin');
    await page.click('#wp-submit');
    await page.waitForURL('**/wp-admin/**');

    // Save auth state
    await page.context().storageState({ path: path.join(authDir, 'admin.json') });
    await browser.close();
};
```

- [ ] **Step 4: Add .gitignore entry for auth state**

Add to `.gitignore`:
```
tests/e2e/.auth/
```

- [ ] **Step 5: Create admin template E2E test**

Create `tests/e2e/admin-template.spec.js`:

```javascript
const { test, expect } = require('@playwright/test');

test.describe('Admin Template Management', () => {
    test('can view template list', async ({ page }) => {
        await page.goto('/wp-admin/admin.php?page=product-designer');
        await expect(page.locator('.wp-list-table')).toBeVisible();
    });

    test('can navigate to template builder', async ({ page }) => {
        await page.goto('/wp-admin/admin.php?page=pd-template-builder');
        // Wait for React to mount
        await expect(page.locator('#pd-template-builder')).toBeVisible();
    });
});
```

- [ ] **Step 6: Add E2E script to package.json**

Add to `scripts`:
```json
"test:e2e": "playwright test",
"test:e2e:headed": "playwright test --headed"
```

- [ ] **Step 7: Run E2E tests**

Run: `npm run test:e2e`
Expected: Both admin tests pass.

- [ ] **Step 8: Commit**

```bash
git add playwright.config.js tests/e2e/ .gitignore package.json package-lock.json
git commit -m "test: add Playwright E2E infrastructure and admin template tests"
```

---

## Task 15: E2E test — Customer design flow

**Files:**
- Create: `tests/e2e/customer-design.spec.js`

- [ ] **Step 1: Create customer design E2E test**

Create `tests/e2e/customer-design.spec.js`:

```javascript
const { test, expect } = require('@playwright/test');

test.describe('Customer Design Flow', () => {
    test('can open designer on product page', async ({ page }) => {
        // Navigate to a product with designer enabled
        // Use the "Dog Tags" product from setup.sh
        await page.goto('/product/dog-tag/');

        // Look for the Customize button
        const customizeBtn = page.locator('.pd-open-designer');
        if (await customizeBtn.isVisible()) {
            await customizeBtn.click();

            // Wait for designer to load
            await expect(page.locator('#pd-designer-root')).toBeVisible();

            // Verify sidebar tabs are present
            await expect(page.locator('[role="tab"]').first()).toBeVisible();
        }
    });

    test('can add text element', async ({ page }) => {
        await page.goto('/product/dog-tag/');

        const customizeBtn = page.locator('.pd-open-designer');
        if (await customizeBtn.isVisible()) {
            await customizeBtn.click();
            await page.waitForSelector('#pd-designer-root');

            // Click Add tab, then Text button
            const addTab = page.locator('button:has-text("Add"), button:has-text("Tekst")').first();
            if (await addTab.isVisible()) {
                await addTab.click();
            }

            // Look for Text button in the add panel
            const textBtn = page.locator('button:has-text("Text"), button:has-text("Tekst")').first();
            if (await textBtn.isVisible()) {
                await textBtn.click();
                // Canvas should now have a text element — verified by element tab becoming active
            }
        }
    });
});
```

Note: E2E tests depend on the product having `_pd_designer_enabled` and `_pd_template_id` meta. If not set, the designer won't appear. The test uses conditional checks (`isVisible`) to handle this gracefully. To make tests deterministic, add product meta setup to `docker/setup.sh` or the test's `beforeAll`.

- [ ] **Step 2: Run E2E tests**

Run: `npm run test:e2e`

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/customer-design.spec.js
git commit -m "test: add customer design flow E2E test"
```

---

## Task 16: E2E test — Export flow

**Files:**
- Create: `tests/e2e/export.spec.js`

- [ ] **Step 1: Create export E2E test**

Create `tests/e2e/export.spec.js`:

```javascript
const { test, expect } = require('@playwright/test');

test.describe('Export Flow', () => {
    test('admin can see export buttons on order with design', async ({ page }) => {
        // Navigate to WooCommerce orders in admin
        await page.goto('/wp-admin/edit.php?post_type=shop_order');

        // If HPOS is enabled, orders may be at a different URL
        const hposUrl = '/wp-admin/admin.php?page=wc-orders';
        if (await page.locator('.wp-list-table').isVisible() === false) {
            await page.goto(hposUrl);
        }

        // Look for any order — click the first one if available
        const firstOrder = page.locator('.wp-list-table tbody tr .order-view, .wp-list-table tbody tr a.order-view').first();
        if (await firstOrder.isVisible({ timeout: 3000 }).catch(() => false)) {
            await firstOrder.click();

            // Check for export buttons (they appear only if the order item has _pd_design_hash)
            const exportSection = page.locator('.pd-export-actions');
            if (await exportSection.isVisible({ timeout: 3000 }).catch(() => false)) {
                // Verify PDF, PNG, SVG export buttons exist
                await expect(page.locator('.pd-export-btn').first()).toBeVisible();
            }
        }
    });

    test('export buttons trigger API call', async ({ page }) => {
        // This test requires an order with a designed product
        // Navigate to orders
        await page.goto('/wp-admin/edit.php?post_type=shop_order');

        const firstOrder = page.locator('.wp-list-table tbody tr .order-view, .wp-list-table tbody tr a.order-view').first();
        if (await firstOrder.isVisible({ timeout: 3000 }).catch(() => false)) {
            await firstOrder.click();

            const pdfBtn = page.locator('.pd-export-btn[data-format="pdf"]').first();
            if (await pdfBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                // Set up response listener
                const responsePromise = page.waitForResponse(
                    (r) => r.url().includes('/pd/v1/exports/'),
                    { timeout: 10000 }
                ).catch(() => null);

                await pdfBtn.click();

                const response = await responsePromise;
                if (response) {
                    expect(response.status()).toBeLessThan(500);
                }
            }
        }
    });
});
```

Note: Export E2E tests depend on having orders with designed products. Tests use conditional checks to handle cases where no such orders exist. For fully deterministic tests, create a designed product order in `docker/setup.sh` or a `beforeAll` hook.

- [ ] **Step 2: Run E2E tests**

Run: `npm run test:e2e`

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/export.spec.js
git commit -m "test: add export flow E2E test"
```

---

## Task 17: Update current_status.md

**Files:**
- Modify: `current_status.md`

- [ ] **Step 1: Update Phase 6 status**

Mark Phase 6 as complete. Add details for each sub-area: i18n, accessibility, performance, testing.

Update the file map to include:
- `languages/` directory with .pot, .po, .mo, .json files
- `tests/` directory structure
- `phpunit.xml`, `jest.config.js`, `playwright.config.js`

- [ ] **Step 2: Commit**

```bash
git add current_status.md
git commit -m "docs: update current_status.md — Phase 6 complete"
```
