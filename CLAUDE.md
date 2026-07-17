# ProductForge for WooCommerce

## What is this?

A WooCommerce plugin that lets customers design text, images, and SVGs onto products using a drag-and-drop Fabric.js editor. Built as a secure replacement for Fancy Product Designer (FPD).

## Key Documents

- **Current status:** `current_status.md` — what's done, what's next, how to run the environment.
- **Admin builder redesign:** `docs/superpowers/specs/2026-03-18-admin-builder-redesign-design.md` — 3-phase redesign (zone enforcement, tree UI, SVG boundaries)
- **Freemius integration:** `docs/superpowers/specs/2026-03-21-freemius-integration-design.md` — premium feature gating spec
- **Code audit:** `CODE_AUDIT.md` — 81 findings across security, performance, dead code, and frontend correctness

## Architecture

- **Approach B: Pure custom database tables** (11 tables, no CPTs). All data in `wp_pf_*` tables.
- **Frontend canvas:** Fabric.js 6.x
- **UI framework:** React 18 + Zustand state management
- **Build system:** Vite (single config, four entry points: admin, design-templates, clipart, frontend) + CSS copy step for Safari compatibility
- **Licensing:** Freemius SDK for premium feature gating; `is_premium()` helper in main `ProductForge` class
- **Export:** Local only — browser-rendered source (Fabric.js `toDataURL` at 3× PNG, or `toSVG`) is captured client-side during save and stored in `wp_pf_design_views.export_svg`. Server then emits PDF (TCPDF), PNG (direct or `rsvg-convert`/Imagick from SVG), or SVG. Multi-view exports stream as ZIP.
- **PHP autoloading:** PSR-4 via custom autoloader. Namespace `ProductForge\` maps to `includes/`.

## Development Environment

```bash
docker compose up -d                    # Start WordPress + MariaDB + phpMyAdmin
docker compose exec wordpress wp ...    # Run WP-CLI commands
npm run dev                             # Vite dev server (HMR)
npm run build                           # Production build → dist/
```

- WordPress: http://localhost:8080 (admin / admin)
- phpMyAdmin: http://localhost:8081

## Coding Standards

### PHP
- **Namespace:** `ProductForge\` with sub-namespaces for each directory (Admin, Frontend, API, Database, Security, Export, Pricing)
- **File naming:** `class-{name}.php` where name is lowercase-hyphenated (e.g., `DbManager` → `class-db-manager.php`)
- **Namespace before ABSPATH check:** In every PHP file, `namespace` must come before `defined('ABSPATH') || exit;`
- **All DB queries via `$wpdb->prepare()`** — no exceptions, no raw interpolation
- **All DB access via Repository classes** — never use `$wpdb` directly outside `includes/Database/`
- **File uploads validated via `UploadValidator`** — MIME check with `finfo_file()`, SVG sanitized with `enshrined/svg-sanitize`
- **Prices always calculated server-side** — never trust client-sent price values
- **Design IDs are hashes** — public-facing design identifiers use `bin2hex(random_bytes(16))`, never sequential IDs

### JavaScript
- **React 18** with functional components and hooks
- **Zustand** for state management (not Redux, not Context)
- **CSS scoping:** All frontend classes use `pf-` prefix with BEM naming. Designer wrapper uses `all: initial` to isolate from theme styles. Always set explicit `color` on buttons/inputs to prevent theme overrides.
- **Fabric.js JSON serialization:** Always use `canvas.toJSON(['data'])` — never bare `toJSON()` — to preserve custom `data` properties (e.g. `elementType`, `zoneIndex`)
- **Fabric.js JSON validation:** Whitelist allowed object types before `loadFromJSON`
- **Fabric.js 6.x type names:** Runtime types are lowercase hyphenated (`'i-text'`, `'image'`, `'path'`), but JSON serialization uses PascalCase (`'IText'`, `'Image'`). Use case-insensitive comparison when matching types at runtime.
- **No `stopPropagation` on `#pf-designer-root`:** The designer renders inside a WooCommerce product tab via `[productforge]` shortcode. Never add blanket `stopPropagation` on the designer root — it blocks Fabric.js's `document`-level `pointerup` listener, causing dragged objects to stick to the cursor.
- **Verify hook imports:** When adding React components that use hooks (`useRef`, `useState`, etc.), always verify the hook is imported. Missing hook imports cause `ReferenceError` that crashes the entire React tree with no visible error on the page.
- **Fabric.js canvas scaling:** Use `canvas.setZoom(scale)` + `canvas.setDimensions({ width, height })` (NOT `cssOnly: true`). Using `cssOnly` causes double-scaling: zoom shrinks objects in the backing buffer, then CSS shrinks the buffer again. Always change backing canvas dimensions alongside zoom.
- **Mobile detection:** Use `matchMedia` (not `window.innerWidth`) for breakpoint detection. Safari iOS briefly reports `innerWidth` as 980px before viewport meta tag is applied. Use `screen.width` as fallback for initial state. Never evaluate `matchMedia` at module level — Safari can misreport before DOM ready.
- **CSS delivery:** Build outputs CSS as both JS-injected (via Vite bundle) and separate `dist/frontend-designer.css` file (via `cp` in build script). Safari has issues with media queries in JS-injected `<style>` tags. The PHP already enqueues the CSS file via `<link>` tag if it exists.
- **Zustand stale closures:** In async handlers or callbacks that run later (e.g. `handleSave`), always read Zustand state fresh via `useDesignerStore.getState()` instead of using closure variables from the React component. Closure variables capture state at render time and go stale by the time the callback executes.
- **Pre-rendered export data:** On every design save the designer renders a 3× PNG via `fabricCanvasRef.toDataURL({ format: 'png', multiplier: 3 })` (live view) or an offscreen Fabric canvas (non-active views) and passes it as `export_svg` to `POST /designs/{hash}/views`. Reason: server-side SVG rendering cannot reproduce text exactly without all the client fonts. Accepted payloads: SVG markup (`<…>`) or `data:image/png;base64,` URLs — sanitized in `RestDesigns::sanitize_export_blob` (SVG runs through `enshrined/svg-sanitize`; PNG data URLs are base64 + magic-byte validated; anything over 10 MB is rejected). The column is stripped from `sanitize_for_customer` responses so autosave payloads don't echo multi-MB blobs back to the client.
- **Engraving text (Hershey fonts):** `utils/hersheyFonts.js` contains single-stroke path data used for laser/CNC engraving output. Objects have `data.elementType = 'engraving-text'` and carry `engravingText`, `engravingFontId`, `engravingFontSize`. They render as Fabric `Path` with stroke only (no fill), so engrave machines see a single-line tool path.
- **Undo/redo guard:** `useCanvasHistory` keeps an `isRestoring` ref — `pushHistory` early-returns while a snapshot is being applied. Without this, `loadFromJSON` triggers object events that schedule a new history entry, polluting the stack. Always clear the flag in `.finally()` so a rejected `loadFromJSON` (bad JSON, failed image load) doesn't leave the flag stuck and break undo/redo for the rest of the session.
- **Designer config via `data-config` attribute (not `wp_localize_script`):** PHP emits the designer config as a JSON string on `<div id="pf-designer-root" data-config="…">`. JS reads it via `utils/config.js#getDesignerConfig()`. **Why not a `window.pfDesigner` global:** LiteSpeed / WP Rocket / Autoptimize can reorder the inline `<script>var pfDesigner=…</script>` emitted by `wp_localize_script` so it lands AFTER the bundle — observed on iOS Safari where the global was undefined at bundle execution time. The DOM-attribute approach binds config to the element itself, immune to script reordering.
- **Config read retry loop (`App.jsx`):** On first render the helper may return `{}` — seen in the wild on Safari with LiteSpeed's Delay JS, and in private-mode browsers. `App.jsx` therefore stores config in `useState`, and an effect polls `getDesignerConfig()` every 50 ms; after 40 attempts (~2 s) it shows a "could not load, please reload" error but KEEPS polling at 1 s intervals so a late config still recovers (never show "No template configured" here — PHP only enqueues the bundle when a template exists, so that message is always a false diagnosis). Every config consumer must handle late arrival: the template-loading effect and the modal effect depend on `config.template_id` (not `[]`), and a sync effect re-derives `designerOpen`/`designSaved` when `template_id` transitions empty → set. Never revert to a single synchronous module-level read or `[]`-dep effects reading config — it breaks on real Safari even when the DOM inspector shows the attribute. `getDesignerConfig()` only caches a config containing `template_id`; partial parses are returned uncached so retries keep re-reading the DOM.

### REST API
- Namespace: `pf/v1`
- All endpoints require nonce verification
- Admin endpoints require `edit_pf_templates` or `manage_woocommerce` capability
- Customer design endpoints verify ownership (customer_id or session_id)
- `grant_template_cap` filter lives in `ProductForge` main class (not Admin) so it applies in REST API context too
- List endpoints support pagination (`per_page`, `page`) with `X-WP-Total` headers
- Clipart and font GET endpoints are intentionally public (`__return_true`) — guest customers need them in the frontend designer. The SVG files are public uploads anyway. Mutation endpoints require `edit_pf_templates` + premium feature gate.

## Security Rules (Critical)

These exist because FPD had CVE-2024-51919 (arbitrary file upload → RCE) and CVE-2024-51818 (SQL injection):

1. **Never concatenate user input into SQL** — always `$wpdb->prepare()`
2. **Never trust file extensions** — validate MIME via `finfo_file()`
3. **Always sanitize SVGs** — strip `<script>`, `on*` attrs, `<use>` with external refs, `foreignObject`, `data:` URIs
4. **Never expose sequential IDs** — designs use CSPRNG hashes
5. **Never trust client-sent prices** — recalculate server-side on every cart/order operation
6. **Rate limit uploads** — max 10/minute per session (customer uploads); clipart admin uploads rate-limited to 20/minute per user
7. **Validate Fabric.js JSON** — whitelist allowed object types before serving to other users

## Database Tables

| Table | Purpose |
|-------|---------|
| `wp_pf_templates` | Template definitions (title, slug, status, global config) |
| `wp_pf_template_views` | Per-view config: canvas size, background, zones, layers, permissions. Columns use `name` (not `view_name`) and `background_url` (not `background_image_url`) |
| `wp_pf_designs` | Customer designs: hash ID, product/template link, status, price |
| `wp_pf_design_views` | Per-view Fabric.js canvas JSON + thumbnail + `export_svg` (browser-rendered PNG data URL or SVG markup, used by export pipeline) |
| `wp_pf_design_templates` | Pre-made design templates that customers can apply in the designer |
| `wp_pf_design_template_views` | Per-view Fabric.js canvas JSON for design templates |
| `wp_pf_exports` | Export records: format, file path, status per order. **Multi-view formats (PNG, SVG) store paths as a comma-separated list** in `file_path` — any cleanup code (`ExportManager::generate_export`, `RestExports::delete_export`, `get_download_paths`) must `explode(',', $file_path)` and iterate, never treat it as a single path |
| `wp_pf_price_log` | Pricing audit trail per design element |
| `wp_pf_fonts` | Custom font uploads (family name, file URL, format) |
| `wp_pf_clipart_collections` | Clipart collections (name, slug) |
| `wp_pf_clipart` | Clipart items (SVG file URL, collection FK) |

All tables use InnoDB engine for foreign key and transaction support. Total: 11 tables.

## Admin Pages

| Menu Item | Page Slug | Purpose |
|-----------|-----------|---------|
| Templates | `productforge` | Template list (WP_List_Table with status tabs + bulk actions), plus a starter-templates gallery panel (see below) |
| Add New | `pf-template-builder` | Template builder React app (canvas, zones, layers, permissions, pricing) |
| Design Templates | `pf-design-templates` | Design template CRUD React app (list, create, edit, delete, import/export JSON) |
| Clipart | `pf-clipart` | Clipart manager React app (collections CRUD, bulk SVG upload, drag & drop) |
| Settings | `pf-settings` | Export options (`pf_export_trigger_status`, `pf_export_default_format`), `pf_delete_data_on_uninstall` toggle, guest design retention (`pf_guest_design_retention_days`), health e-mail alert toggle (`pf_health_email_alerts`), a design-statistics panel (saved/ordered/conversion, last 30 days), and system status checks (`Admin\SystemStatus`: PHP ≥ 8.1, finfo, rsvg-convert/Imagick-SVG, writable `pf-thumbnails`/`pf-exports`/`pf-fonts`/`pf-clipart`/`pf-cache`, DB tables, LiteSpeed detection). Critical failures also show as an admin notice on every ProductForge screen (cached 5 min in the `pf_system_status_critical` transient) |
| Production | `pf-export-dashboard` | `Admin\ExportDashboard` — lists recent orders (filterable by status/days) that contain designs, flags designs containing raster images via `DesignInspector::contains_raster()`, and bulk-downloads the selection as one ZIP via `admin_post_pf_bulk_export` |

- **Starter templates:** `templates/starter/manifest.json` + `templates/starter/assets/*.svg` ship 10 ready-made templates (engrave/print/basic sets — hand-authored, no CPTs, no DB rows until import). `Admin\StarterTemplates` (`includes/Admin/class-starter-templates.php`) parses the catalog, imports a chosen entry by copying its assets into `uploads/pf-template-assets/` (re-sanitized via `enshrined\svgSanitize\Sanitizer` even though they're our own files), rewriting `asset:` URLs, and creating the template + views through `TemplateRepository`. Imported templates use slug `starter-{id}` — that slug doubles as the "already imported" detection key, no extra DB column. REST: `GET /pf/v1/starter-templates` (catalog with `imported` flags) and `POST /pf/v1/starter-templates/{id}/import`, both gated on `edit_pf_templates`. The importer enforces the same free-tier limit as manual template creation (`ProductForge::has_feature('unlimited_templates')` — free accounts may import 1 template total, counting drafts/published/archived, before hitting `pf_premium_required`). The gallery panel renders server-side (no React) on the Templates list page (`includes/Admin/views/template-list.php`), always visible while an un-imported starter remains, with extra-prominent copy when the template list is empty; `includes/Admin/class-admin.php` enqueues the inline JS that wires Import buttons to the REST endpoint.

## WooCommerce Integration Points

- Product meta: `_pf_designer_enabled`, `_pf_template_id`, `_pf_display_mode`
- Cart: `pf_design_hash` in cart item data via hidden input + `woocommerce_add_cart_item_data` filter; auto-save-before-cart intercepts form submit if design is dirty
- Cart thumbnails: `woocommerce_cart_item_thumbnail` (classic) + `woocommerce_store_api_cart_item_images` (block cart) — shows **all views** side by side, not just the first
- Cart permalinks: `woocommerce_cart_item_permalink` appends `?pf_design=HASH` for design reload
- Product gallery: `woocommerce_single_product_image_thumbnail_html` replaces image when `pf_design` query param present
- Thumbnails: Saved as PNG files in `wp-content/uploads/pf-thumbnails/` (block cart requires real URLs, not data URIs). Non-active views generate thumbnails via offscreen Fabric canvas during save.
- Shortcode: `[productforge]` renders the designer inline on product pages (auto-detects product context)
- Gutenberg block: `productforge/designer` (`blocks/designer/`, registered by `Frontend\DesignerBlock` in both contexts) — the block-theme equivalent of the shortcode. Dynamic block; `render_callback` delegates to the shortcode pipeline so all checks live in one place. Editor shows a plain-JS placeholder (no build step; deps declared in `editor.asset.php`). Duplicate-render prevention: `Frontend::has_shortcode_in_content()` checks shortcode + `has_block()` on post content + `template_has_designer_block()` (scans `$_wp_current_template_content` for Site Editor template placements) — the before-add-to-cart auto-render skips whenever the merchant placed the designer explicitly. Testing gotcha: fresh WooCommerce installs default to Coming Soon mode (`woocommerce_coming_soon` option = yes), which replaces ALL product pages with a coming-soon template — set it to `no` before frontend testing or every designer test falsely fails.
- Surcharge: via `woocommerce_before_calculate_totals`
- Order: design_hash in order item meta, export triggered on configurable order status
- Order status flip: `OrderIntegration::save_order_item_meta()` and `assign_design_hashes()` call `DesignRepository::mark_ordered_by_hash()` when an order item's design hash is saved, flipping the design's `status` column to `ordered`. This backs the "Designs ordered" stat and the Production dashboard filter — designs saved before this feature shipped are not back-filled.
- Account tab: `Frontend\AccountDesigns` registers a `pf-designs` WooCommerce My Account endpoint (`add_rewrite_endpoint`) listing the logged-in customer's saved designs with a reopen link (`?pf_design=HASH` on the product page). Rewrite rules self-heal via a version guard — `get_option('pf_endpoint_registered') !== PF_VERSION` triggers `flush_rewrite_rules()` — because ZIP-upload plugin updates never re-run the activation hook.
- HPOS: Compatibility declared in `productforge.php`

## Scheduled Tasks & Maintenance

- **`pf_daily_maintenance` cron** (`class-cleanup.php`, `Cleanup::HOOK`): runs daily, deletes abandoned guest designs (never ordered, no logged-in customer) older than `pf_guest_design_retention_days` (default 30; 0 disables cleanup) along with their thumbnail files. Ordered designs and designs belonging to logged-in customers are never deleted. Also triggers the health e-mail alert check on every run.
- **Self-heal scheduling pattern:** `Cleanup::init()` hooks `wp_next_scheduled()` on `init` instead of relying solely on the activation hook — the same reasoning as the account-endpoint rewrite flush: ZIP-upload updates skip `register_activation_hook`, so cron and rewrite state must repair themselves on every request instead of only at install time.
- **Health e-mail alert:** gated by option `pf_health_email_alerts` (default on). Mails `admin_email` when a critical `SystemStatus` check starts failing; the failing-checks set is hashed and stored in `pf_health_last_alert_hash` so a persistent failure doesn't re-mail daily, but a newly-failing check does. Recovery resets the stored hash silently (no "all clear" e-mail).
- **`global_config.vector_only`** (template builder → Settings → Uploads, `SettingsUploads.jsx`): per-template flag for engraving-only products. When set, the frontend designer disables the image-upload tool (`AddTab.jsx` checks `globalConfig.vector_only`) and `DesignerCanvas.jsx` blocks image drops/paste with an error message — SVGs and clip art remain allowed. Order admin (`OrderIntegration`) and the Production dashboard (`ExportDashboard`) both surface a warning via `Export\DesignInspector::contains_raster()` when a design was saved with raster images anyway (e.g. added before the flag was enabled).

## Deployment

- **Live site:** snelgraveren.nl (LiteSpeed Cache — flush after deploy)
- **Plugin ZIP:** Build with `npm run build` first, then create ZIP including: `productforge.php`, `freemius-init.php`, `includes/`, `dist/`, `vendor/`, `languages/`, `admin/` (but NOT `node_modules/`, `.git/`, `frontend/js/*/src/`). Output ZIP to project directory (not `/tmp/`).
- **JS cache busting (hash in filename, not `?ver=`):** `Frontend::enqueue_assets()` copies `dist/frontend-designer.js` to `uploads/pf-cache/frontend-designer.<md5>.js` on the first pageview after a build and enqueues the hashed URL. **Never written inside the plugin directory** — wp.org disallows plugins writing to their own directory, and `uploads/` is also the correct place for runtime-generated files anyway. The copy is written via temp file + atomic `$wp_filesystem->move()` (WP_Filesystem initialized on demand; a concurrent request must never serve a half-written bundle — Safari would cache it for a year). The **previous build's hashed copy is kept** (only older copies are deleted, via `wp_delete_file()`): LiteSpeed page-cached HTML still references the old hashed URL until the cache is flushed, and deleting it would 404 the bundle on every cached page. The md5 hash is cached in the `pf_frontend_js_hash` option keyed on `filemtime`, so the full bundle isn't hashed on every pageview. **Why not `?ver=<hash>` alone:** LiteSpeed's Delay JS feature strips query strings from `<script>` tags it marks with `data-deferred="1"`, so Safari (which caches JS with `max-age=31557600` ≈ 1 year) keeps serving stale bundles after deploys. Changing the path itself is the only reliable invalidator. If `uploads/pf-cache/` is not writable (`wp_is_writable()` check), we fall back to the un-hashed `dist/` URL. `Admin\SystemStatus` checks `uploads/pf-cache/` writability under check id `dir_pf_cache` (warning-level, not critical). **LiteSpeed JS-optimize exclude must stay hash-agnostic:** the filter excludes the substring `frontend-designer.` (with trailing dot, no `.js`) so it matches both the plain and the hashed filename — excluding the literal `frontend-designer.js` would NOT match the hashed copy and LiteSpeed would concatenate the React bundle, breaking it.
- **Freemius SDK guard:** `productforge.php` conditionally loads `freemius-init.php` only if the file exists. The plugin works fine without Freemius — all premium gates gracefully degrade.
- **SVG→PNG conversion:** Export pipeline prefers `/usr/bin/rsvg-convert`; falls back to Imagick with SVG support. Host must have at least one of the two — the ProductForge → Settings system status page shows which one is active. Dev Docker image installs `librsvg2-bin` (rebuild with `docker compose build wordpress` if the check reports it missing); the live server (snelgraveren.nl) has no rsvg-convert and uses Imagick.

## Don't

- Don't use Custom Post Types for any plugin data
- Don't load plugin assets on non-designer pages
- Don't use jQuery (pure React + Fabric.js)
- Don't store images as data URIs in Fabric.js JSON (use URLs)
- Don't skip SVG sanitization for any uploaded SVG
- Don't add cloud export features (explicitly out of scope)
- Don't add social media image imports (out of scope)
- Don't add 3D preview, QR codes, or AI image generation (out of scope)
