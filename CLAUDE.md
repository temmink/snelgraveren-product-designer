# ProductForge for WooCommerce

## What is this?

A WooCommerce plugin that lets customers design text, images, and SVGs onto products using a drag-and-drop Fabric.js editor. Built as a secure replacement for Fancy Product Designer (FPD).

## Key Documents

- **Current status:** `current_status.md` — what's done, what's next, how to run the environment.
- **Admin builder redesign:** `docs/superpowers/specs/2026-03-18-admin-builder-redesign-design.md` — 3-phase redesign (zone enforcement, tree UI, SVG boundaries)
- **Code audit:** `CODE_AUDIT.md` — 81 findings across security, performance, dead code, and frontend correctness

## Architecture

- **Approach B: Pure custom database tables** (6 tables, no CPTs). All data in `wp_pf_*` tables.
- **Frontend canvas:** Fabric.js 6.x
- **UI framework:** React 18 + Zustand state management
- **Build system:** Vite (single config, dual entry points: admin + frontend)
- **Export:** Local only — PDF (TCPDF), PNG (Imagick), SVG (Fabric.js toSVG)
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

### REST API
- Namespace: `pf/v1`
- All endpoints require nonce verification
- Admin endpoints require `edit_pf_templates` or `manage_woocommerce` capability
- Customer design endpoints verify ownership (customer_id or session_id)
- `grant_template_cap` filter lives in `ProductForge` main class (not Admin) so it applies in REST API context too
- List endpoints support pagination (`per_page`, `page`) with `X-WP-Total` headers

## Security Rules (Critical)

These exist because FPD had CVE-2024-51919 (arbitrary file upload → RCE) and CVE-2024-51818 (SQL injection):

1. **Never concatenate user input into SQL** — always `$wpdb->prepare()`
2. **Never trust file extensions** — validate MIME via `finfo_file()`
3. **Always sanitize SVGs** — strip `<script>`, `on*` attrs, `<use>` with external refs, `foreignObject`, `data:` URIs
4. **Never expose sequential IDs** — designs use CSPRNG hashes
5. **Never trust client-sent prices** — recalculate server-side on every cart/order operation
6. **Rate limit uploads** — max 10/minute per session
7. **Validate Fabric.js JSON** — whitelist allowed object types before serving to other users

## Database Tables

| Table | Purpose |
|-------|---------|
| `wp_pf_templates` | Template definitions (title, slug, status, global config) |
| `wp_pf_template_views` | Per-view config: canvas size, background, zones, layers, permissions. Columns use `name` (not `view_name`) and `background_url` (not `background_image_url`) |
| `wp_pf_designs` | Customer designs: hash ID, product/template link, status, price |
| `wp_pf_design_views` | Per-view Fabric.js canvas JSON + thumbnail |
| `wp_pf_exports` | Export records: format, file path, status per order |
| `wp_pf_price_log` | Pricing audit trail per design element |

All tables use InnoDB engine for foreign key and transaction support.

## WooCommerce Integration Points

- Product meta: `_pf_designer_enabled`, `_pf_template_id`, `_pf_display_mode`
- Cart: `pf_design_hash` in cart item data via hidden input + `woocommerce_add_cart_item_data` filter; auto-save-before-cart intercepts form submit if design is dirty
- Cart thumbnails: `woocommerce_cart_item_thumbnail` (classic) + `woocommerce_store_api_cart_item_images` (block cart) — shows **all views** side by side, not just the first
- Cart permalinks: `woocommerce_cart_item_permalink` appends `?pf_design=HASH` for design reload
- Product gallery: `woocommerce_single_product_image_thumbnail_html` replaces image when `pf_design` query param present
- Thumbnails: Saved as PNG files in `wp-content/uploads/pf-thumbnails/` (block cart requires real URLs, not data URIs). Non-active views generate thumbnails via offscreen Fabric canvas during save.
- Shortcode: `[productforge]` renders the designer inline on product pages (auto-detects product context)
- Surcharge: via `woocommerce_before_calculate_totals`
- Order: design_hash in order item meta, export triggered on configurable order status
- HPOS: Compatibility declared in `productforge.php`

## Don't

- Don't use Custom Post Types for any plugin data
- Don't load plugin assets on non-designer pages
- Don't use jQuery (pure React + Fabric.js)
- Don't store images as data URIs in Fabric.js JSON (use URLs)
- Don't skip SVG sanitization for any uploaded SVG
- Don't add cloud export features (explicitly out of scope)
- Don't add social media image imports (out of scope)
- Don't add 3D preview, QR codes, or AI image generation (out of scope)
