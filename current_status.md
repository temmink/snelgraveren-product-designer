# Product Designer — Current Status

**Last updated:** 2026-03-19
**Plugin version:** 1.0.0
**Docker environment:** Running (WordPress 6.7, WooCommerce 10.6.1, MariaDB 11)

---

## Environment

```bash
# Start Docker environment
docker compose up -d

# Open WordPress admin
open http://localhost:8080/wp-admin   # admin / admin
open http://localhost:8081            # phpMyAdmin

# Build JS assets
npm run build

# Install PHP deps (via Docker, composer not installed on host)
docker compose exec wordpress bash -c \
  "cd /var/www/html/wp-content/plugins/product-designer && composer install --no-dev --optimize-autoloader"

# Create distributable zip
bash bin/package.sh
# → product-designer-1.0.0.zip (install via WP admin → Plugins → Upload)
```

---

## What's complete

### Phase 0 — Project scaffold ✅
- Docker: `docker-compose.yml`, `docker/wordpress/Dockerfile`, `docker/setup.sh`
  - Dockerfile permanently sets `chown -R www-data:www-data /var/www/html/wp-content` to prevent upgrade-dir permission errors
- Build: `vite.config.js` with dual entry points (`admin-template-builder`, `frontend-designer`)
- Dependencies: `composer.json` (tcpdf, enshrined/svg-sanitize, intervention/image), `package.json` (fabric 6.x, react 18, zustand 4, vite 5)
- `bin/package.sh` — builds JS, runs composer via Docker fallback, zips for distribution

### Phase 1 — PHP backend ✅
- **Bootstrap:** `product-designer.php` — plugin header, constants, HPOS declaration, update-protection filter (blocks WP.org false-positive update for same-slug public plugin), boots on `plugins_loaded`
- **Autoloader:** `includes/class-autoloader.php` — PSR-4 with `class-{name}.php` WordPress naming convention
- **Activation:** `includes/class-activator.php` → `includes/class-deactivator.php`
- **Database migration:** `includes/Database/class-db-manager.php` + `includes/Database/class-migration100.php`
  - ⚠️ Migration class is `Migration100` → file is `class-migration100.php` (NOT `class-migration-1-0-0.php` — autoloader can't handle that)
  - Creates 6 InnoDB tables: `wp_pd_templates`, `wp_pd_template_views`, `wp_pd_designs`, `wp_pd_design_views`, `wp_pd_exports`, `wp_pd_price_log`
- **Repositories:** TemplateRepository, DesignRepository, ExportRepository, PriceRepository
- **Security:** CapabilityChecker (session ID cookie, CSPRNG), NonceManager, UploadValidator (finfo MIME + enshrined SVG sanitizer, rate-limited 10/min)
- **REST API** (`pd/v1`): RestTemplates (10 routes), RestDesigns (8 routes), RestUploads, RestFonts (stub), RestExports (stub)
- **Admin:** class-admin.php (menus, enqueue, `user_has_cap` filter granting `edit_pd_templates` to `manage_woocommerce` users), TemplateListTable (WP_List_Table with status tabs + bulk actions), TemplateBuilder

### Phase 2 — Admin template builder React UI ✅
- **State:** `useTemplateStore.js` (Zustand) — views, zones, layers, globalConfig, undo/redo (max 50), removedViewIds tracking
  - Views have stable `_clientId: crypto.randomUUID()` (not Date.now())
  - `removeView` re-keys history after deletion
  - `removeLayer` re-indexes `z_order`
  - `loadFromApi` stamps `_clientId` on server views
- **App.jsx** — loads template on mount, sequential view save loop storing returned `id` via `updateView`, deleteView loop for removedViewIds, error surfacing
- **ViewTabs.jsx** — `cancelledRef` guards Escape cancel vs onBlur race; disabled during save; `key={view.id || view._clientId}`
- **Canvas.jsx** — Fabric.js 6.x; `disposed` flag guards async background-image callbacks; zone draw mode; keyboard undo/redo (INPUT/TEXTAREA guarded)
- **ZoneForm.jsx** — validates width/height ≥ 1; conditional mask_svg_url field
- **ZoneList.jsx** — `editingKey` string (not numeric index); `key={zone._key}`
- **LayerPanel.jsx** — Add Layer disabled when no views; `key={layer._key}`; z_order re-indexed on remove
- **PermissionsPanel.jsx** — text extras include `recolor` and `change_font`
- **PricingPanel.jsx** — currency symbol from `window.pdTemplateBuilder?.currency_symbol || '€'`
- **GlobalSettings.jsx** — `pendingColor` state + explicit Add button (no drag-fire)

### Known issues fixed
- `TemplateListTable::column_default` — removed PHP type hints from parameters to match parent `WP_List_Table` signature (PHP 8 strict override compatibility)
- `class-migration-1-0-0.php` renamed to `class-migration100.php` — autoloader maps `Migration100` → `class-migration100.php`
- WordPress.org false-positive update blocked via `site_transient_update_plugins` filter in `product-designer.php`
- **Theme CSS overrides:** Buttons/inputs in designer sidebar appeared empty (white text on white) because theme applied `color: white`. Fixed with explicit `color: #1f2937` on all designer interactive elements.
- **Tab text overflow:** Theme applied `text-transform: uppercase` and `letter-spacing: 2px` to buttons, truncating tab labels. Fixed with `text-transform: none` and `letter-spacing: normal`.
- **Design reload race condition:** `setTemplate()` triggered canvas re-render before `loadDesign()` completed, overwriting snapshots. Fixed by loading design BEFORE setting template.
- **View ID type mismatch:** API returned `view_id` as string, template `id` as number. `===` comparison failed. Fixed with `String()` coercion.
- **Fabric.js `data` not serialized:** `canvas.toJSON()` didn't include custom `data` property. Fixed by using `canvas.toJSON(['data'])` everywhere.
- **"Unknown Properties" display:** `inferElementType()` checked for `'IText'` (PascalCase) but Fabric.js 6.x runtime type is `'i-text'` (lowercase hyphenated). Fixed with case-insensitive comparison.
- **Thumbnail overwrite on save:** `upsert_view()` always overwrote thumbnail column even with empty string, clearing previously saved thumbnails for non-active views. Fixed by only including thumbnail in update when non-empty.

---

### Phase 3 — Frontend customer designer ✅
- **PHP:** `includes/Frontend/class-frontend.php` — hooks WooCommerce product page, enqueues assets, renders designer container, localizes `window.pdDesigner` config, `[product_designer]` shortcode with duplicate-render prevention
- **REST:** `GET /pd/v1/templates/{id}/public` — unauthenticated public endpoint, published templates only, sanitized response
- **Security:** `RestDesigns::create_design()` validates template_id references a published template
- **State:** `useDesignerStore.js` (Zustand) — template, design hash, canvas snapshots, tool mode, selected object, error state, fabricCanvasRef
- **API:** `designerApi.js` — loadTemplate, loadDesign, createDesign, saveDesignView, uploadFile helpers
- **Canvas:** `DesignerCanvas.jsx` — Fabric.js 6.x canvas with zone rendering (restrict/suggest styles), zone enforcement (clamp on move/scale), tool modes (add-text via click, add-image/add-svg via file upload), permissions enforcement, Fabric JSON whitelisting, `inferElementType()` for Fabric.js 6.x type detection
- **Sidebar:** Three-tab sidebar (Views / Element / Add) with auto-switch on selection
  - `AddTab.jsx` — Text/Image/SVG tool buttons with zone-aware disabling
  - `ElementTab.jsx` — Text properties (font, size, color, bold/italic), image/SVG properties (scale, recolor), delete
  - `ViewsTab.jsx` — View switcher with snapshot persistence across view switches
- **App:** `App.jsx` — template loading, design reload from cart (load design BEFORE setting template to avoid race condition), save flow with offscreen thumbnail generation for all views, auto-save-before-cart, customization-required gate, display modes (embedded/modal), hidden design_hash input
- **CSS:** `designer.css` — isolation (`all: initial`), layout, modal overlay, BEM naming with `pd-` prefix, explicit text colors to prevent theme overrides, tab text overflow protection
- **Build:** Vite outputs `dist/frontend-designer.js` + `dist/frontend-designer.css`

### Phase 4 — WooCommerce cart integration ✅
- **Add to cart:** `pd_design_hash` attached to cart item data via hidden input + `woocommerce_add_cart_item_data` filter
- **Auto-save before cart:** Form submit intercepted if design is dirty — auto-saves, sets hash, then re-submits
- **Customization required:** `customization_required` template config blocks add-to-cart when no design exists
- **Cart thumbnails (classic):** `woocommerce_cart_item_thumbnail` filter replaces product thumbnail with **all view thumbnails** side by side (flex layout)
- **Cart thumbnails (block):** `woocommerce_store_api_cart_item_images` filter returns all view images for WooCommerce Store API block cart
- **Cart item label:** `woocommerce_get_item_data` filter shows "Design: Customized" in cart
- **Multi-view thumbnail generation:** Active view captured from live canvas; non-active views rendered via offscreen Fabric canvas (`renderOffscreenThumbnail()`)
- **Thumbnail storage:** Base64 data URL thumbnails saved as PNG files in `wp-content/uploads/pd-thumbnails/` (block cart requires real URLs, not data URIs). `upsert_view()` preserves existing thumbnails when saving with empty thumbnail string.
- **Product image update:** After saving, product gallery image on the page updates to show the design thumbnail
- **Cart → product link:** `woocommerce_cart_item_permalink` filter appends `?pd_design=HASH` to cart item URLs
- **Design reload from cart:** When returning to product page via cart link, the saved design loads automatically:
  - PHP detects `pd_design` query param, passes `existing_design_hash` + `auto_open` to JS config
  - `loadDesign()` API function fetches saved design via `GET /pd/v1/designs/{hash}`
  - Design loaded BEFORE setting template (avoids race condition where canvas re-renders with empty snapshots)
  - View ID comparison uses `String()` coercion (API returns strings, template has numbers)
  - Canvas snapshots populated from saved `canvas_json` per view
  - Designer auto-opens in modal mode
- **Product gallery override:** `woocommerce_single_product_image_thumbnail_html` filter replaces product gallery image with design thumbnail when `pd_design` is in the URL (no flash of default product image)
- **Close button:** "Close Designer" button in sidebar for modal mode (replaces floating × button)
- **Save UX:** "Save Design" → "Saving..." → "Saved!" (green, 2s) → back to normal

---

### Phase 4b — Order integration ✅
- **Order item meta:** `_pd_design_hash` saved to order items via `woocommerce_checkout_create_order_line_item` (classic) + `woocommerce_store_api_checkout_update_order_meta` (block checkout safety net)
- **Order thumbnails:** Custom design replaces stock product image in admin order view (`woocommerce_admin_order_item_thumbnail`), order confirmation page, and emails (`woocommerce_order_item_thumbnail`)
- **Order meta label:** Hidden `_pd_design_hash` meta exposed as "Design: Customized" via `woocommerce_order_item_get_formatted_meta_data`
- **Refactored:** Order hooks extracted to `Frontend\OrderIntegration` class, registered in both admin and frontend contexts

---

### Phase 4c — Surcharge calculation ✅
- **PriceCalculator:** Server-side surcharge from canvas_json — counts text/image/svg elements, applies per-element or tier pricing, min/max caps
- **CartSurcharge:** `woocommerce_before_calculate_totals` hook adds surcharge to product price; `woocommerce_get_item_data` shows "Design surcharge: €X.XX" in cart
- **Audit trail:** Element-level pricing logged to `wp_pd_price_log`, design `total_price` updated in `wp_pd_designs`

---

### Phase 5 — Export ✅
- **SVG Exporter:** Reconstructs SVG from Fabric.js canvas JSON (text, images, paths, groups, rects, circles)
- **PNG Exporter:** Renders via Intervention Image with configurable DPI (default 300)
- **PDF Exporter:** Multi-page PDF via TCPDF, one page per view sized to canvas dimensions
- **Export Manager:** Orchestrates exports, auto-triggers on configurable order status (`pd_export_trigger_status` option, default: `completed`)
- **REST API:** `POST /exports/{hash}` (trigger), `GET /exports/{id}/download`, `GET /orders/{order_id}/exports`, `DELETE /exports/{id}`
- **Admin order UI:** Export buttons (PDF/PNG/SVG) per order item with design, download links for completed exports
- **File storage:** `wp-content/uploads/pd-exports/{format}/` with `index.php` guards
- **Options:** `pd_export_trigger_status` (default: completed), `pd_export_default_format` (default: pdf)

---

### Phase 6 — Polish ✅

#### 6.1 Internationalization (i18n)
- **PHP:** `load_plugin_textdomain` on `plugins_loaded` (priority 1), all user-facing strings wrapped in `__()` / `esc_html__()`
- **JavaScript:** `@wordpress/i18n` externalized in Vite (both admin and frontend builds), `wp_set_script_translations` for both script handles
- **Admin JSX:** All 9 components wrapped (`App`, `ViewTabs`, `Canvas`, `ZoneForm`, `TreePanel`, `TreeNode`, `PermissionsPanel`, `PricingPanel`, `GlobalSettings`)
- **Frontend JSX:** All 6 components wrapped (`App`, `Sidebar`, `DesignerCanvas`, `AddTab`, `ElementTab`, `ViewsTab`)
- **Translations:** `.pot` file (143 strings), Dutch `.po`/`.mo`/`.json` translation files in `languages/`

#### 6.2 Accessibility (a11y)
- **Frontend:** ARIA roles (`tablist`, `tab`, `tabpanel`) on sidebar tabs and view tabs, `aria-selected`, `aria-label` on icon buttons, `aria-live="polite"` on save status, `role="dialog"` + `aria-modal` on modal, focus trapping (Tab/Shift+Tab wrapping, Escape to close), focus restore on modal close
- **Admin:** `aria-label` on tree panel action buttons (drag, add, visibility, lock, delete)
- **CSS:** `:focus-visible` outlines on all interactive elements (both admin and frontend), `.pd-sr-only` screen-reader utility class

#### 6.3 Performance
- **Batch queries:** `count_views_batch()` and `count_products_batch()` in `TemplateRepository` — 2 queries instead of 2N for template list
- **Transient caching:** `get()` method in `TemplateRepository` uses 5-minute WordPress transients, invalidated on create/update/delete

#### 6.4 Testing
- **PHPUnit** (Docker): 44+ tests across 11 test files — repositories (CRUD, batch counts), security (upload validation, capabilities, nonces), pricing (per-element, empty designs), exporters (SVG/PDF/PNG rendering), API endpoints (templates, designs)
- **Jest** (local): 71 tests — Zustand store tests (useTemplateStore, useDesignerStore), component tests (Sidebar, AddTab, ViewsTab)
- **Playwright E2E** (local): 9 tests — admin template list/builder, customer design flow, export flow
- **Config files:** `phpunit.xml`, `jest.config.js`, `babel.config.js`, `playwright.config.js`
- **Test commands:** `npm test` (Jest), `npm run test:e2e` (Playwright), `docker compose exec wordpress bash -c "cd wp-content/plugins/product-designer && phpunit"` (PHPUnit)

---

## File map (source only, excluding build artifacts)

```
product-designer/
├── product-designer.php          # Plugin bootstrap + HPOS + update-protection filter
├── uninstall.php                 # Drops all wp_pd_* tables
├── composer.json / composer.lock
├── package.json / vite.config.mjs
├── jest.config.js / babel.config.js  # Jest test config
├── playwright.config.js          # E2E test config
├── phpunit.xml                   # PHPUnit config
├── bin/package.sh                # Build + zip for distribution
├── CLAUDE.md                     # Coding standards
├── current_status.md             # This file
├── includes/
│   ├── class-autoloader.php      # PSR-4 with class-{name}.php convention
│   ├── class-product-designer.php # Singleton orchestrator
│   ├── class-activator.php
│   ├── class-deactivator.php
│   ├── Database/
│   │   ├── class-db-manager.php
│   │   ├── class-migration100.php  # ← NOT class-migration-1-0-0.php
│   │   ├── class-template-repository.php
│   │   ├── class-design-repository.php
│   │   ├── class-export-repository.php
│   │   └── class-price-repository.php
│   ├── Security/
│   │   ├── class-capability-checker.php
│   │   ├── class-nonce-manager.php
│   │   └── class-upload-validator.php
│   ├── Frontend/
│   │   ├── class-frontend.php       # WooCommerce product page hooks, asset enqueue
│   │   └── class-order-integration.php  # Order meta, thumbnails, labels (admin+frontend)
│   ├── API/
│   │   ├── class-rest-templates.php  # 11 routes (incl. public endpoint)
│   │   ├── class-rest-designs.php    # 8 routes (with template validation)
│   │   ├── class-rest-uploads.php
│   │   ├── class-rest-fonts.php      # stub
│   │   └── class-rest-exports.php    # trigger, download, list, delete
│   ├── Export/
│   │   ├── class-export-manager.php     # Orchestrator + order status hook
│   │   ├── class-svg-exporter.php       # SVG from Fabric.js JSON
│   │   ├── class-png-exporter.php       # PNG via Intervention Image
│   │   └── class-pdf-exporter.php       # PDF via TCPDF
│   ├── Pricing/
│   │   ├── class-cart-surcharge.php      # WooCommerce cart integration
│   │   └── class-price-calculator.php    # Server-side surcharge calculation
│   └── Admin/
│       ├── class-admin.php
│       ├── class-template-list-table.php
│       ├── class-template-builder.php
│       └── views/
│           ├── template-list.php
│           └── template-builder.php
├── admin/js/template-builder/src/
│   ├── index.jsx
│   ├── App.jsx
│   ├── api/templateApi.js
│   ├── store/useTemplateStore.js
│   └── components/
│       ├── Canvas.jsx
│       ├── ViewTabs.jsx
│       ├── ZoneForm.jsx
│       ├── ZoneList.jsx
│       ├── LayerPanel.jsx
│       ├── PermissionsPanel.jsx
│       ├── PricingPanel.jsx
│       └── GlobalSettings.jsx
├── frontend/js/designer/src/
│   ├── index.jsx
│   ├── App.jsx                   # Template loading, save flow, display modes
│   ├── designer.css              # Isolated styles, layout, modal, components
│   ├── api/designerApi.js        # REST API helpers
│   ├── store/useDesignerStore.js  # Zustand state management
│   └── components/
│       ├── DesignerCanvas.jsx    # Fabric.js canvas, zones, tools, permissions
│       ├── Sidebar.jsx           # Three-tab sidebar wrapper
│       └── tabs/
│           ├── AddTab.jsx        # Text/Image/SVG tool buttons
│           ├── ElementTab.jsx    # Element property controls
│           └── ViewsTab.jsx      # View switcher
├── languages/
│   ├── product-designer.pot          # Translation template (143 strings)
│   ├── product-designer-nl_NL.po     # Dutch translations
│   ├── product-designer-nl_NL.mo     # Compiled Dutch translations
│   └── product-designer-nl_NL-*.json # JS Dutch translations
└── tests/
    ├── php/
    │   ├── bootstrap.php
    │   ├── Database/             # TemplateRepositoryTest, DesignRepositoryTest
    │   ├── Security/             # UploadValidatorTest, CapabilityCheckerTest, NonceManagerTest
    │   ├── Pricing/              # PriceCalculatorTest
    │   ├── Export/               # SvgExporterTest, PdfExporterTest, PngExporterTest
    │   └── API/                  # TemplateEndpointTest, DesignEndpointTest
    ├── js/
    │   ├── setup.js
    │   ├── __mocks__/            # styleMock, wpI18n, fabric
    │   ├── stores/               # useTemplateStore.test.js, useDesignerStore.test.js
    │   └── components/           # Sidebar.test.js, AddTab.test.js, ViewsTab.test.js
    └── e2e/
        ├── global-setup.js
        ├── admin-template.spec.js
        ├── customer-design.spec.js
        └── export.spec.js
```
