# ProductForge — Current Status

**Last updated:** 2026-07-17
**Plugin version:** 1.0.0
**Docker environment:** Running (WordPress 6.7, WooCommerce 10.6.1, MariaDB 11)

> **Since 2026-03-22:** Freemius premium gating, Clipart Manager admin, Design Templates admin, redesigned Add Layer panel with clipart picker, engraving text (Hershey single-line fonts), pre-rendered browser export pipeline with multi-view ZIP downloads, migration 700 (`export_svg` column), clipart upload rate-limit, history restore-rejection guard, and input sanitization + size-cap for export blobs.

## 2026-07-17 — Eight-feature expansion

Branch `feature/eight-feature-expansion`, 12 tasks (T1–T12). Eight customer/admin-facing features, fully Dutch-translated:

1. **Live price preview** — non-persisting `pf/v1/pricing/preview` REST endpoint (`RestPricing`) computes a price from element counts without saving; the designer shows a live "Design surcharge:" line as the customer edits (`App.jsx`, `utils/priceCounts.js`).
2. **DPI / image-quality warning** — `utils/imageQuality.js` flags images scaled beyond their native resolution; `ElementTab.jsx` shows an inline warning so customers pick a sharper source image before ordering.
3. **Order status flip** — `DesignRepository::mark_ordered_by_hash()` flips a design's `status` to `ordered` when its hash lands on a paid order item (`OrderIntegration`). Powers feature 8's conversion stat and the Production dashboard's default filter. Not back-filled for designs saved before this shipped.
4. **Guest design cleanup cron** — `Cleanup` (`pf_daily_maintenance`, self-healing schedule registered on `init`) deletes abandoned guest designs (and their thumbnail files) older than `pf_guest_design_retention_days` (default 30, 0 disables). Ordered designs and logged-in customers' designs are never touched.
5. **Health e-mail alert** — same daily cron mails `admin_email` when a critical `SystemStatus` check starts failing, deduped via a stored failure-set hash (`pf_health_email_alerts` toggle, on by default).
6. **"My designs" account tab** — `AccountDesigns` adds a `pf-designs` WooCommerce My Account endpoint listing a customer's saved designs with a one-click reopen link. Rewrite rules self-heal via a `PF_VERSION` guard (ZIP-upload updates skip the activation hook).
7. **Vector-only templates** — `global_config.vector_only` (template builder → Settings → Uploads) blocks photo uploads in the frontend designer for engraving-only products while still allowing SVG/clip art. `DesignInspector::contains_raster()` flags any design that has raster images anyway (e.g. saved before the flag was enabled), surfaced as a warning in both the WooCommerce order admin and the Production dashboard.
8. **Production dashboard + funnel stats** — new "Production" admin page (`pf-export-dashboard`) lists recent orders with designs, filterable by status/days, with per-design raster warnings and a bulk "download selection as ZIP" action. Settings page gained a "Design statistics (last 30 days)" panel (saved / ordered / conversion / top products) via `DesignRepository::funnel_stats()`.

German translation (originally scoped as a ninth item) was intentionally dropped per product decision — Dutch only for this expansion.

Docs, `.po`/`.pot`/`.mo`, and the two JS translation JSONs (frontend-designer bundle + admin template-builder bundle) were updated in T12 to cover every new string from T1–T11.

---

## 2026-07-17 — Starter templates

4-task plan, `templates/starter/` ships 10 hand-authored starter templates (engrave/print/basic sets) as a manifest + SVG assets, importable one-click from the Templates admin page. `Admin\StarterTemplates` copies assets into `uploads/pf-template-assets/` (re-sanitized on import), rewrites `asset:` placeholders, and creates the template + views via the existing repositories — slug `starter-{id}` doubles as the imported-detection key. REST: `GET /pf/v1/starter-templates`, `POST /pf/v1/starter-templates/{id}/import`, both `edit_pf_templates`-gated. The importer enforces the same free-tier limit as manual template creation (`unlimited_templates` — 1 template on free). Gallery panel is plain server-rendered PHP/JS (no React) on the Templates list page. Dutch strings added, `bin/package.sh` now bundles `templates/`, verified end-to-end on a fresh install (free-tier import + upsell on second import, template opens in the builder).

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
  "cd /var/www/html/wp-content/plugins/productforge && composer install --no-dev --optimize-autoloader"

# Create distributable zip
bash bin/package.sh
# → productforge-1.0.0.zip (install via WP admin → Plugins → Upload)
```

---

## What's complete

### Phase 0 — Project scaffold ✅
- Docker: `docker-compose.yml`, `docker/Dockerfile`, `docker/setup.sh`
  - Dockerfile permanently sets `chown -R www-data:www-data /var/www/html/wp-content` to prevent upgrade-dir permission errors
- Build: `vite.config.mjs` with three entry points (`admin-template-builder`, `admin-design-templates`, `frontend-designer`)
- Dependencies: `composer.json` (tcpdf, enshrined/svg-sanitize, intervention/image), `package.json` (fabric 6.x, react 18, zustand 4, vite 5)
- `bin/package.sh` — builds JS, runs composer via Docker fallback, zips for distribution

### Phase 1 — PHP backend ✅
- **Bootstrap:** `productforge.php` — plugin header, constants, HPOS declaration, update-protection filter (blocks WP.org false-positive update for same-slug public plugin), boots on `plugins_loaded`
- **Autoloader:** `includes/class-autoloader.php` — PSR-4 with `class-{name}.php` WordPress naming convention
- **Activation:** `includes/class-activator.php` → `includes/class-deactivator.php`
- **Database migration:** `includes/Database/class-db-manager.php` + `includes/Database/class-migration100.php`
  - ⚠️ Migration class is `Migration100` → file is `class-migration100.php` (NOT `class-migration-1-0-0.php` — autoloader can't handle that)
  - Creates 6 InnoDB tables: `wp_pf_templates`, `wp_pf_template_views`, `wp_pf_designs`, `wp_pf_design_views`, `wp_pf_exports`, `wp_pf_price_log`
- **Repositories:** TemplateRepository, DesignRepository, ExportRepository, PriceRepository
- **Security:** CapabilityChecker (session ID cookie, CSPRNG), UploadValidator (finfo MIME + enshrined SVG sanitizer, rate-limited 10/min)
- **REST API** (`pf/v1`): RestTemplates (10 routes), RestDesigns (8 routes), RestUploads, RestFonts, RestExports (4 routes), RestDesignTemplates (CRUD + import/export)
- **Admin:** class-admin.php (menus, enqueue, `user_has_cap` filter granting `edit_pf_templates` to `manage_woocommerce` users), TemplateListTable (WP_List_Table with status tabs + bulk actions), TemplateBuilder
- **Design Templates admin:** React CRUD app (`admin/js/design-templates/`) with list view, create/edit form, JSON import/export

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
- ~~ZoneList.jsx and LayerPanel.jsx~~ — removed, replaced by TreePanel + TreeNode
- **PermissionsPanel.jsx** — text extras include `recolor` and `change_font`
- **PricingPanel.jsx** — currency symbol from `window.pfTemplateBuilder?.currency_symbol || '€'`
- **GlobalSettings.jsx** — `pendingColor` state + explicit Add button (no drag-fire)

### Known issues fixed
- `TemplateListTable::column_default` — removed PHP type hints from parameters to match parent `WP_List_Table` signature (PHP 8 strict override compatibility)
- `class-migration-1-0-0.php` renamed to `class-migration100.php` — autoloader maps `Migration100` → `class-migration100.php`
- WordPress.org false-positive update blocked via `site_transient_update_plugins` filter in `productforge.php`
- **Theme CSS overrides:** Buttons/inputs in designer sidebar appeared empty (white text on white) because theme applied `color: white`. Fixed with explicit `color: #1f2937` on all designer interactive elements.
- **Tab text overflow:** Theme applied `text-transform: uppercase` and `letter-spacing: 2px` to buttons, truncating tab labels. Fixed with `text-transform: none` and `letter-spacing: normal`.
- **Design reload race condition:** `setTemplate()` triggered canvas re-render before `loadDesign()` completed, overwriting snapshots. Fixed by loading design BEFORE setting template.
- **View ID type mismatch:** API returned `view_id` as string, template `id` as number. `===` comparison failed. Fixed with `String()` coercion.
- **Fabric.js `data` not serialized:** `canvas.toJSON()` didn't include custom `data` property. Fixed by using `canvas.toJSON(['data'])` everywhere.
- **"Unknown Properties" display:** `inferElementType()` checked for `'IText'` (PascalCase) but Fabric.js 6.x runtime type is `'i-text'` (lowercase hyphenated). Fixed with case-insensitive comparison.
- **Thumbnail overwrite on save:** `upsert_view()` always overwrote thumbnail column even with empty string, clearing previously saved thumbnails for non-active views. Fixed by only including thumbnail in update when non-empty.
- **Alignment position resets after use (admin):** `handleAlign` in admin Canvas.jsx called `pushHistory` but not `updateLayer`, so the Zustand layer-sync effect reverted aligned positions. Fixed by calling `updateLayer()` after `alignElement()`.
- **Designer crashes on text element click (live site):** `ElementTab.jsx` used `useRef` in the `AlignmentButtons` component without importing it, causing a `ReferenceError` that unmounted the entire React component tree when selecting a text element. Fixed by adding `useRef` to the import. Root cause was diagnosed via Playwright MCP browser debugging on the live site.

---

### Phase 3 — Frontend customer designer ✅
- **PHP:** `includes/Frontend/class-frontend.php` — hooks WooCommerce product page, enqueues assets, renders designer container, emits designer config as `data-config` JSON attribute on `#pf-designer-root` (read via `utils/config.js`; `wp_localize_script` was removed because LiteSpeed can reorder the inline global), `[productforge]` shortcode with duplicate-render prevention
- **REST:** `GET /pf/v1/templates/{id}/public` — unauthenticated public endpoint, published templates only, sanitized response
- **Security:** `RestDesigns::create_design()` validates template_id references a published template
- **State:** `useDesignerStore.js` (Zustand) — template, design hash, canvas snapshots, tool mode, selected object, error state, fabricCanvasRef
- **API:** `designerApi.js` — loadTemplate, loadDesign, createDesign, saveDesignView, uploadFile helpers
- **Canvas:** `DesignerCanvas.jsx` — Fabric.js 6.x canvas with zone rendering (restrict/suggest styles), zone enforcement (clamp on move/scale), tool modes (add-text via click, add-image/add-svg via file upload), permissions enforcement, Fabric JSON whitelisting, `inferElementType()` for Fabric.js 6.x type detection
- **Sidebar:** Three-tab sidebar (Views / Element / Add) with auto-switch on selection
  - `AddTab.jsx` — Text/Image/SVG tool buttons with zone-aware disabling
  - `ElementTab.jsx` — Text properties (font, size, color, bold/italic), image/SVG properties (scale, recolor), alignment buttons, delete
  - `ViewsTab.jsx` — View switcher with snapshot persistence across view switches
- **App:** `App.jsx` — template loading, design reload from cart (load design BEFORE setting template to avoid race condition), save flow with offscreen thumbnail generation for all views, auto-save-before-cart, customization-required gate, display modes (embedded/modal), hidden design_hash input
- **CSS:** `designer.css` — isolation (`all: initial`), layout, modal overlay, BEM naming with `pf-` prefix, explicit text colors to prevent theme overrides, tab text overflow protection, mobile responsive (stacked layout, fullscreen modal, touch-sized controls)
- **Mobile responsive:**
  - `useIsMobile` hook — reactive breakpoint detection via `matchMedia` + `screen.width` fallback (Safari iOS compatibility)
  - `useCanvasScale` hook — ResizeObserver-based canvas scaling, applies zoom directly to Fabric.js canvas (no React state in the loop for instant resize)
  - Mobile forces modal display mode regardless of template config
  - Canvas scales to fit container (width and height constrained)
  - Sidebar starts collapsed on mobile, auto-expands on element selection
  - Touch-optimized controls: 44px+ touch targets, circle corner style, larger cornerSize/touchCornerSize
  - Zone boundaries rendered with stronger visibility on mobile (higher opacity fill, thicker stroke)
  - Viewport zoom lock (prevents pinch-to-zoom interference) via `pf:designer-open`/`pf:designer-close` custom events
  - PHP injects inline script for viewport meta manipulation
- **Build:** Vite outputs `dist/frontend-designer.js` + `dist/frontend-designer.css` (CSS also copied as separate file for Safari compatibility)

### Phase 4 — WooCommerce cart integration ✅
- **Add to cart:** `pf_design_hash` attached to cart item data via hidden input + `woocommerce_add_cart_item_data` filter
- **Auto-save before cart:** Form submit intercepted if design is dirty — auto-saves, sets hash, then re-submits
- **Customization required:** `customization_required` template config blocks add-to-cart when no design exists
- **Cart thumbnails (classic):** `woocommerce_cart_item_thumbnail` filter replaces product thumbnail with **all view thumbnails** side by side (flex layout)
- **Cart thumbnails (block):** `woocommerce_store_api_cart_item_images` filter returns all view images for WooCommerce Store API block cart
- **Cart item label:** `woocommerce_get_item_data` filter shows "Design: Customized" in cart
- **Multi-view thumbnail generation:** Active view captured from live canvas; non-active views rendered via offscreen Fabric canvas (`renderOffscreenThumbnail()`)
- **Thumbnail storage:** Base64 data URL thumbnails saved as PNG files in `wp-content/uploads/pf-thumbnails/` (block cart requires real URLs, not data URIs). `upsert_view()` preserves existing thumbnails when saving with empty thumbnail string.
- **Product image update:** After saving, product gallery image on the page updates to show the design thumbnail
- **Cart → product link:** `woocommerce_cart_item_permalink` filter appends `?pf_design=HASH` to cart item URLs
- **Design reload from cart:** When returning to product page via cart link, the saved design loads automatically:
  - PHP detects `pf_design` query param, passes `existing_design_hash` + `auto_open` to JS config
  - `loadDesign()` API function fetches saved design via `GET /pf/v1/designs/{hash}`
  - Design loaded BEFORE setting template (avoids race condition where canvas re-renders with empty snapshots)
  - View ID comparison uses `String()` coercion (API returns strings, template has numbers)
  - Canvas snapshots populated from saved `canvas_json` per view
  - Designer auto-opens in modal mode
- **Product gallery override:** `woocommerce_single_product_image_thumbnail_html` filter replaces product gallery image with design thumbnail when `pf_design` is in the URL (no flash of default product image)
- **Close button:** "Close Designer" button in sidebar for modal mode (replaces floating × button)
- **Save UX:** "Save Design" → "Saving..." → "Saved!" (green, 2s) → back to normal

---

### Phase 4b — Order integration ✅
- **Order item meta:** `_pf_design_hash` saved to order items via `woocommerce_checkout_create_order_line_item` (classic) + `woocommerce_store_api_checkout_update_order_meta` (block checkout safety net)
- **Order thumbnails:** Custom design replaces stock product image in admin order view (`woocommerce_admin_order_item_thumbnail`), order confirmation page, and emails (`woocommerce_order_item_thumbnail`)
- **Order meta label:** Hidden `_pf_design_hash` meta exposed as "Design: Customized" via `woocommerce_order_item_get_formatted_meta_data`
- **Refactored:** Order hooks extracted to `Frontend\OrderIntegration` class, registered in both admin and frontend contexts

---

### Phase 4c — Surcharge calculation ✅
- **PriceCalculator:** Server-side surcharge from canvas_json — counts text/image/svg elements, applies per-element or tier pricing, min/max caps
- **CartSurcharge:** `woocommerce_before_calculate_totals` hook adds surcharge to product price; `woocommerce_get_item_data` shows "Design surcharge: €X.XX" in cart
- **Audit trail:** Element-level pricing logged to `wp_pf_price_log`, design `total_price` updated in `wp_pf_designs`

---

### Phase 5 — Export ✅
- **SVG Exporter:** Reconstructs SVG from Fabric.js canvas JSON (text, images, paths, groups, rects, circles)
- **PNG Exporter:** Renders via Intervention Image with configurable DPI (default 300)
- **PDF Exporter:** Multi-page PDF via TCPDF, one page per view sized to canvas dimensions
- **Export Manager:** Orchestrates exports, auto-triggers on configurable order status (`pf_export_trigger_status` option, default: `completed`)
- **REST API:** `POST /exports/{hash}` (trigger), `GET /exports/{id}/download`, `GET /orders/{order_id}/exports`, `DELETE /exports/{id}`
- **Admin order UI:** Export buttons (PDF/PNG/SVG) per order item with design, download links for completed exports
- **File storage:** `wp-content/uploads/pf-exports/{format}/` with `index.php` guards
- **Options:** `pf_export_trigger_status` (default: completed), `pf_export_default_format` (default: pdf)

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
- **CSS:** `:focus-visible` outlines on all interactive elements (both admin and frontend), `.pf-sr-only` screen-reader utility class

#### 6.3 Performance
- **Batch queries:** `count_views_batch()` and `count_products_batch()` in `TemplateRepository` — 2 queries instead of 2N for template list
- **Transient caching:** `get()` method in `TemplateRepository` uses 5-minute WordPress transients, invalidated on create/update/delete

#### 6.4 Testing
- **PHPUnit** (Docker): 44+ tests across 11 test files — repositories (CRUD, batch counts), security (upload validation, capabilities, nonces), pricing (per-element, empty designs), exporters (SVG/PDF/PNG rendering), API endpoints (templates, designs)
- **Jest** (local): 71 tests — Zustand store tests (useTemplateStore, useDesignerStore), component tests (Sidebar, AddTab, ViewsTab)
- **Playwright E2E** (local): 9 tests — admin template list/builder, customer design flow, export flow
- **Config files:** `phpunit.xml`, `jest.config.js`, `babel.config.js`, `playwright.config.js`
- **Test commands:** `npm test` (Jest), `npm run test:e2e` (Playwright), `docker compose exec wordpress bash -c "cd wp-content/plugins/productforge && phpunit"` (PHPUnit)

---

### Admin Builder Redesign ✅

All 3 phases from the redesign spec (`docs/superpowers/specs/2026-03-18-admin-builder-redesign-design.md`) are complete:

#### Phase 1: Zone Enforcement ✅
- **ClipPath on layers:** `applyZoneClip()` in Canvas.jsx — supports both rect and SVG boundaries
- **Clamp-to-zone:** `clampToZone()` on `object:moving` event
- **Scale clamping:** `clampScaleToZone()` on `object:scaling` — enforces min/max scale from permissions
- **Snap-to-grid:** `snapToGrid()` rounds position to `permissions.grid_size`
- **Max chars:** `text:changed` event handler truncates to `permissions.max_chars`
- **Free Move toggle:** `isFreeMove` state in store, toolbar button, bypasses all enforcement when on

#### Phase 2: Tree UI ✅
- **TreePanel.jsx + TreeNode.jsx:** Replace old ZoneList + LayerPanel
- **Nested store shape:** Layers stored inside `zones_config[].layers` (not flat `layers_config`)
- **Migration:** `migrateViewToNestedLayers()` converts old flat templates on load (idempotent)
- **Store actions:** `addLayer(viewIndex, zoneIndex, layer)`, `moveLayer()` with cross-zone support
- **Drag-and-drop:** `@dnd-kit` for reordering within/between zones with `allowed_types` validation
- **Old files removed:** `ZoneList.jsx` and `LayerPanel.jsx` deleted

#### Phase 3: SVG Zone Boundaries ✅
- **ZoneForm.jsx:** Boundary type toggle (Rectangle/SVG Shape), media library SVG picker
- **svgPathUtils.js:** `parseSvgToFabric()`, `extractSvgBoundingBox()`, backward-compat `extractClosedPath()`
- **Canvas rendering:** SVG zones loaded as Fabric groups with proper styling and metadata
- **SVG clipPath:** Both admin Canvas.jsx and frontend DesignerCanvas.jsx clone SVG zone overlays for clipping

---

### Code Review Fixes ✅

Full code review performed 2026-03-19 (17 findings, all resolved):

#### Critical (3)
- **Nonce verification on design write endpoints** — POST/PUT/DELETE require `X-WP-Nonce` via `verify_nonce()` permission callback
- **Nonce verification on upload endpoint** — Same pattern prevents unauthenticated uploads
- **Export download hardened** — Filename sanitized, `nocache_headers()`, `X-Content-Type-Options: nosniff`

#### Important (8)
- **Sale price respected** — `get_price()` instead of `get_regular_price()` in CartSurcharge
- **SQL prepare policy** — `$wpdb->prepare()` for all queries, phpcs comments where no user input
- **Block checkout duplicate product attribution** — Tracks assigned hashes to prevent duplication
- **Fabric.js whitelist case-insensitive** — `Set` with both PascalCase and lowercase forms
- **Cart recursion guard** — Static `$running` flag instead of `did_action()` counter
- **Price log refresh** — `PriceRepository::delete_for_design()` clears stale logs before re-logging
- **`$format` arrays** — All `$wpdb->insert()/update()/delete()` across 4 repositories
- **TOCTOU on thumbnail dir** — `wp_mkdir_p()` always called, `.htaccess` guard added

#### Suggestions (6)
- **ENUM includes 'trashed'** — Migration schema matches `trash()` method
- **Shared `FileUtils::url_to_local_path()`** — Extracted from 3 exporters into `Export\FileUtils`
- **Repository pattern in `admin_list()`** — Uses `DesignRepository::list()/count()` instead of raw `$wpdb`
- **Offscreen thumbnail errors logged** — `console.warn` in dev mode
- **N+1 query fixed** — `list_templates` uses `count_views_batch()`
- **Build order-independent** — `rm -rf dist` before builds, both entries use `emptyOutDir: false`

---

### Freemius Integration ✅
- **SDK:** Freemius SDK v2.13.0 bundled, initialized in `productforge.php` via `pf_fs()` global
- **Premium gating:** `ProductForge::is_premium()` helper checks Freemius paying status (+ dev license bypass via `PF_LICENSE_KEY` constant)
- **Feature gates (PHP):** Template/view creation limits, SVG boundaries, font/palette/clipart endpoints, PDF/SVG export formats, auto-export, multiple views, permissions tab, pricing tab
- **Feature gates (JS):** Admin template builder skips font/palette/clipart API calls on free plan; frontend designer conditionally loads premium features via `isPremium` flag
- **Admin menu:** Freemius adds "Contacteer Ons" and "Upgrade ➤" menu items under ProductForge
- **Performance optimization:** DB migrations run only when `pf_plugin_version` option differs from `PF_VERSION` (not on every admin page load)

---

### Design Templates Admin ✅
- **React app:** `admin/js/design-templates/src/` — full CRUD interface for managing pre-made design templates
- **Features:** List table (Name, Category, Product Template, Views, Status, Actions), create/edit form, JSON export per template, JSON import, delete with confirmation
- **Vite entry:** `admin-design-templates` in `vite.config.mjs`, included in `npm run build`
- **PHP enqueue:** `enqueue_design_templates_scripts()` in `class-admin.php`, loads on `productforge_page_pf-design-templates` hook
- **Data model:** Design templates link to product templates, have per-view Fabric.js canvas JSON, stored in `wp_pf_design_templates` + `wp_pf_design_template_views` tables

---

## File map (source only, excluding build artifacts)

```
productforge/
├── productforge.php          # Plugin bootstrap + HPOS + update-protection filter
├── uninstall.php                 # Drops all wp_pf_* tables
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
│   ├── class-productforge.php # Singleton orchestrator
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
│   │   └── class-upload-validator.php
│   ├── Frontend/
│   │   ├── class-frontend.php       # WooCommerce product page hooks, asset enqueue
│   │   └── class-order-integration.php  # Order meta, thumbnails, labels (admin+frontend)
│   ├── API/
│   │   ├── class-rest-templates.php  # 11 routes (incl. public endpoint)
│   │   ├── class-rest-designs.php    # 8 routes (with template validation)
│   │   ├── class-rest-uploads.php
│   │   ├── class-rest-fonts.php
│   │   ├── class-rest-design-templates.php  # CRUD + import/export
│   │   └── class-rest-exports.php    # trigger, download, list, delete
│   ├── Export/
│   │   ├── class-export-manager.php     # Orchestrator + order status hook
│   │   ├── class-file-utils.php         # Shared url_to_local_path() utility
│   │   ├── class-svg-exporter.php       # SVG from Fabric.js JSON
│   │   ├── class-png-exporter.php       # PNG via Intervention Image
│   │   └── class-pdf-exporter.php       # PDF via TCPDF
│   ├── Pricing/
│   │   ├── class-cart-surcharge.php      # WooCommerce cart integration
│   │   └── class-price-calculator.php    # Server-side surcharge calculation
│   └── Admin/
│       ├── class-admin.php
│       ├── class-product-integration.php # WooCommerce product editor tab
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
│   └── utils/
│       ├── fonts.js                 # Google Fonts loader
│       └── svgPathUtils.js          # SVG path extraction utilities
│   └── components/
│       ├── Canvas.jsx
│       ├── ViewTabs.jsx
│       ├── ZoneForm.jsx
│       ├── TreePanel.jsx            # Zone/layer tree (replaced ZoneList + LayerPanel)
│       ├── TreeNode.jsx             # Recursive tree node component
│       ├── PermissionsPanel.jsx
│       ├── PricingPanel.jsx
│       └── GlobalSettings.jsx
├── admin/js/design-templates/src/
│   ├── index.jsx                    # React entry point
│   └── App.jsx                      # Design template CRUD UI (list, form, import/export)
├── frontend/js/designer/src/
│   ├── index.jsx
│   ├── App.jsx                   # Template loading, save flow, display modes
│   ├── designer.css              # Isolated styles, layout, modal, mobile responsive
│   ├── api/designerApi.js        # REST API helpers
│   ├── store/useDesignerStore.js  # Zustand state management
│   ├── hooks/
│   │   ├── useIsMobile.js        # Reactive mobile breakpoint (matchMedia + screen.width)
│   │   └── useCanvasScale.js     # ResizeObserver canvas zoom (direct Fabric.js, no React state)
│   └── components/
│       ├── DesignerCanvas.jsx    # Fabric.js canvas, zones, tools, permissions
│       ├── Sidebar.jsx           # Three-tab sidebar wrapper
│       └── tabs/
│           ├── AddTab.jsx        # Text/Image/SVG tool buttons
│           ├── ElementTab.jsx    # Element property controls
│           └── ViewsTab.jsx      # View switcher
├── languages/
│   ├── productforge.pot          # Translation template (143 strings)
│   ├── productforge-nl_NL.po     # Dutch translations
│   ├── productforge-nl_NL.mo     # Compiled Dutch translations
│   └── productforge-nl_NL-*.json # JS Dutch translations
└── tests/
    ├── php/
    │   ├── bootstrap.php
    │   ├── Database/             # TemplateRepositoryTest, DesignRepositoryTest
    │   ├── Security/             # UploadValidatorTest, CapabilityCheckerTest
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
