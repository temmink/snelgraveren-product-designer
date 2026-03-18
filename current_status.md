# Product Designer — Current Status

**Last updated:** 2026-03-18
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

---

### Phase 3 — Frontend customer designer ✅
- **PHP:** `includes/Frontend/class-frontend.php` — hooks WooCommerce product page, enqueues assets, renders designer container, localizes `window.pdDesigner` config
- **REST:** `GET /pd/v1/templates/{id}/public` — unauthenticated public endpoint, published templates only, sanitized response
- **Security:** `RestDesigns::create_design()` validates template_id references a published template
- **State:** `useDesignerStore.js` (Zustand) — template, design hash, canvas snapshots, tool mode, selected object, error state
- **API:** `designerApi.js` — loadTemplate, createDesign, saveDesignView, uploadFile helpers
- **Canvas:** `DesignerCanvas.jsx` — Fabric.js 6.x canvas with zone rendering (restrict/suggest styles), zone enforcement (clamp on move/scale), tool modes (add-text via click, add-image/add-svg via file upload), permissions enforcement, Fabric JSON whitelisting
- **Sidebar:** Three-tab sidebar (Add / Element / Views) with auto-switch on selection
  - `AddTab.jsx` — Text/Image/SVG tool buttons with zone-aware disabling
  - `ElementTab.jsx` — Text properties (font, size, color, bold/italic), image/SVG properties (scale, recolor), delete
  - `ViewsTab.jsx` — View switcher with snapshot persistence across view switches
- **App:** `App.jsx` — template loading, save flow (create design + save views), display modes (embedded/modal), hidden design_hash input
- **CSS:** `designer.css` — isolation (`all: initial`), layout, modal overlay, BEM naming with `pd-` prefix
- **Build:** Vite outputs `dist/frontend-designer.js` + `dist/frontend-designer.css`

---

## What's next

### Phase 4 — WooCommerce integration
- Product meta: `_pd_designer_enabled`, `_pd_template_id`
- Add to cart with design_hash in cart item data
- Surcharge calculation via `woocommerce_before_calculate_totals`
- Order item meta storage

### Phase 5 — Export
- PDF via TCPDF, PNG via Imagick, SVG via Fabric.js toSVG
- Triggered on configurable order status hook

### Phase 6 — Polish
- i18n/l10n, accessibility, performance, end-to-end tests

---

## File map (source only, excluding build artifacts)

```
product-designer/
├── product-designer.php          # Plugin bootstrap + HPOS + update-protection filter
├── uninstall.php                 # Drops all wp_pd_* tables
├── composer.json / composer.lock
├── package.json / vite.config.js
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
│   │   └── class-frontend.php       # WooCommerce product page hooks, asset enqueue
│   ├── API/
│   │   ├── class-rest-templates.php  # 11 routes (incl. public endpoint)
│   │   ├── class-rest-designs.php    # 8 routes (with template validation)
│   │   ├── class-rest-uploads.php
│   │   ├── class-rest-fonts.php      # stub
│   │   └── class-rest-exports.php    # stub
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
└── frontend/js/designer/src/
    ├── index.jsx
    ├── App.jsx                   # Template loading, save flow, display modes
    ├── designer.css              # Isolated styles, layout, modal, components
    ├── api/designerApi.js        # REST API helpers
    ├── store/useDesignerStore.js  # Zustand state management
    └── components/
        ├── DesignerCanvas.jsx    # Fabric.js canvas, zones, tools, permissions
        ├── Sidebar.jsx           # Three-tab sidebar wrapper
        └── tabs/
            ├── AddTab.jsx        # Text/Image/SVG tool buttons
            ├── ElementTab.jsx    # Element property controls
            └── ViewsTab.jsx      # View switcher
```
