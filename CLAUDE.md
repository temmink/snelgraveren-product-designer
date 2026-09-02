# ProductForge for WooCommerce

_"ProductForge" is the internal project name; the user-facing plugin (menu, plugin list, wp.org) is
**Snelgraveren Product Designer**. Use "Product Designer" when talking to Martin about admin
screens._

## What is this?

A WooCommerce plugin that lets customers design text, images, and SVGs onto products using a drag-and-drop Fabric.js editor. Built as a secure replacement for Fancy Product Designer (FPD).

## Key Documents

- **Current status:** `current_status.md` — what's done, what's next, how to run the environment.
- **Admin builder redesign:** `docs/superpowers/specs/2026-03-18-admin-builder-redesign-design.md` — 3-phase redesign (zone enforcement, tree UI, SVG boundaries)
- **Freemius integration:** `docs/superpowers/specs/2026-03-21-freemius-integration-design.md` — premium feature gating spec
- **Session handoff:** `HANDOFF.md` — where the wp.org release stands, what's uncommitted, exact next commands.
- **Code audit:** `CODE_AUDIT.md` — 81 findings across security, performance, dead code, and frontend correctness

## Architecture

- **Approach B: Pure custom database tables** (11 tables, no CPTs). All data in `wp_pf_*` tables.
- **Frontend canvas:** Fabric.js 6.x
- **UI framework:** React 18 + Zustand state management
- **Build system:** Vite (single config, five entry points: admin, design-templates, clipart, fonts, frontend) + CSS copy step for Safari compatibility
- **Licensing:** Freemius SDK for premium feature gating; `is_premium()` helper in main `Plugin` class (`Snelgraveren\ProductDesigner\Plugin`, file `includes/class-plugin.php`)
- **Export:** Local only — everything a format needs is captured client-side during save (only the browser has the fonts and the live Fabric objects) and stored per view; the server emits files from those columns. Four formats: PNG (3× raster), PDF (TCPDF), SVG, and **LightBurn `.lbrn2`** (Pro, 1.11.0). Multi-view exports stream as ZIP. The production-SVG pipeline lives in `frontend/js/designer/src/utils/productionSvg.js` + `exportRender.js` + `textOutline.js` and exists because of a silent failure that reached a laser (memory `project_fabric_tspan_svg_bug`): Fabric 6.9.1 emits malformed XML for a rotated+styled tspan character, which the sanitizer rejected without a trace, so every curved-text design exported as a bitmap. Rules that must hold: repair + `parseSvgOrThrow` BEFORE anything consumes Fabric's markup; strip zone overlays, clipPaths and curved-text baseline paths (LightBurn burns all three as lines); the "SVG" variant outlines every glyph at measured position AND rotation (per-character output forced via a hairline charSpacing — Fabric's `timeToRender` collapses to one tspan per line otherwise, handing letter placement to the consumer); the "SVG + fonts" variant writes curved text as `<textPath>` (the one form LightBurn imports correctly — it re-flows per-character tspans into garbage); never detach `obj.path` before `toSVG()` (destroys the per-character layout for charSpacing-0 text); real mm on the root, geometry untouched (Imagick chokes on extra transforms). Failures are LOUD end to end: `buildExportVectors` collects errors instead of falling back to raw markup, and the server logs every rejected blob (`sanitize_export_blob`/`sanitize_lbrn_blob`). Verify any export change with `npx vite --config tools/export-check/vite.config.js` — it runs the real pipeline on a saved design JSON.
- **LightBurn export (`utils/lbrnWriter.js`):** the inverse of the template builder's `lbrnParser` and round-trip-tested through it. Text ships as native, editable LightBurn Text shapes; the placement model was CALIBRATED against LightBurn's own SVG re-exports, not assumed — the full model (anchor formula, arc fit on the laid ink segment, per-line shapes for straight text, single-char tangent rule, Av/Ah semantics incl. "Av0 + Bend scatters glyphs") is in memory `project_lbrn_export`. Requires the view's `width_mm`; designs saved before 1.11.0 have no data until re-saved (reopen link → save).
- **PHP autoloading:** PSR-4 via custom autoloader. Namespace `Snelgraveren\ProductDesigner\` maps to `includes/`. (Renamed from `ProductForge\` in v1.7.6 for the wp.org review — the reviewer's tool flagged `product_forge` as a non-distinctive prefix; the main class `ProductForge` became `Plugin`.)
- **LightBurn import (Pro):** `admin/js/template-builder/src/utils/lbrnParser.js` parses a `.lbrn2` (plain XML) into editable text/`svg` layer descriptors; `ImportLightBurn.jsx` is the button. Geometry uses shared VertList/PrimID pools + composed Group XForms; the "double image" is design-inherent, not a bug (memory `project_lightburn_double_image`).
- **LightBurn bitmap sizing:** a `<Shape Type="Bitmap" W H>` stores its **local** size; the
  `<XForm>` carries the scale. The real size is `W * sx`, never `W / sx` — on a real file
  `211.64021 * 1.89 = 400.000 mm` exactly, and the round number is the giveaway. Getting this
  backwards imported bitmaps at 53% (fixed 1.8.5). The parser keeps `localWMm`/`localHMm` and
  `finalWMm`/`finalHMm` as separate fields precisely because one name for two meanings caused it.
  Scale factors round to **6** decimals (`nScale` in the parser, `rScale` in `ImportLightBurn`),
  never `n`'s 3 or `r`'s 2 — a scale MULTIPLIES the source pixel count, so one rounding rule costs
  more the larger the image, and rounding the bitmap differently from the vector layers makes them
  stop registering, which is the only reason the bitmap is imported at all (1.8.6).
- **SVG-shape boundaries:** a zone with `boundary_type: 'svg'` renders its outline from an uploaded media `svg_url` **or** inline `svg_markup`. Merchants build inline boundaries from existing vector layers — the canvas "Use as Boundary" toolbar action (`Canvas.jsx`) and the ZoneForm "From layers" source — via the pure `utils/mergeLayersToBoundary.js` (bakes each layer's translate+scale into the path `d`, so the merged group renders at `scaleX:1`; a `<g transform>` would be hoisted then clobbered by the render). Zone/layer `svg_markup` is admin-authored but served to customers, so it MUST be sanitised on view save (`RestTemplates::sanitize_zone_layers`, which cleans both layer-level and zone-level markup, dropping it when the Sanitizer class is absent).

## Development Environment

```bash
docker compose up -d                    # Start WordPress + MariaDB + phpMyAdmin
docker compose exec wordpress wp ...    # Run WP-CLI commands
npm run dev                             # Vite dev server (HMR)
npm run build                           # Production build → dist/
```

- WordPress: http://localhost:8080. **TWO compose stacks exist and they have DIFFERENT databases**
  (verified 2026-08-31): `docker compose up` from the repo runs as project **`productforge`**
  (containers `productforge-wordpress-1` etc., own volume — NOT the live-shop copy; admin is the
  throwaway `pf-dev-test` / `pf-dev-test-2026`, and its wp-config carries `SGPD_LICENSE_KEY` set to
  the dev hash so premium gates pass). The **live-DB copy** lives in the separate
  **`productdesigner`** stack (`productdesigner-wordpress-1`, admin `martin.temmink`) — when that
  one is running, address it via `docker exec productdesigner-wordpress-1 …`; starting the other
  stack alongside it fails on port 3306. Check `docker ps` first to see which stack is up.
  Both stacks share ONE compose file — only the project name differs: start the live-copy with
  `docker compose -p productdesigner up -d` (both serve WordPress on :8080). Gotcha: `wp` in the
  container runs as root, so files it creates under `uploads/` (e.g. a test export in
  `pf-exports/`) become root-owned and www-data can no longer overwrite them from the browser —
  `chown -R www-data:www-data` the dir after CLI experiments. Cookie-login for curl tests without
  a password: `wp eval` + `wp_generate_auth_cookie($id, $exp, 'auth')` / `'logged_in'` under the
  `AUTH_COOKIE` / `LOGGED_IN_COOKIE` names.
  `pf-dev-test` exists only locally and must never be created on the live site.
- phpMyAdmin: http://localhost:8081
- **In-container plugin path is `productforge`, not the slug** — the source is bind-mounted at `/var/www/html/wp-content/plugins/productforge/`. Use it for `php -l` / `wp eval`, e.g. `docker compose exec -T wordpress php -l /var/www/html/wp-content/plugins/productforge/includes/....php`.

## Coding Standards

### PHP
- **Namespace:** `Snelgraveren\ProductDesigner\` with sub-namespaces for each directory (Admin, Frontend, API, Database, Security, Export, Pricing). Main class is `Snelgraveren\ProductDesigner\Plugin`.
- **File naming:** `class-{name}.php` where name is lowercase-hyphenated (e.g., `DbManager` → `class-db-manager.php`)
- **Namespace before ABSPATH check:** In every PHP file, `namespace` must come before `defined('ABSPATH') || exit;`
- **All DB queries via `$wpdb->prepare()`** — no exceptions, no raw interpolation
- **All DB access via Repository classes** — never use `$wpdb` directly outside `includes/Database/`
- **File uploads validated via `UploadValidator`** — MIME check with `finfo_file()`, SVG sanitized with `enshrined/svg-sanitize`
- **Prices always calculated server-side** — never trust client-sent price values
- **Design IDs are hashes** — public-facing design identifiers use `bin2hex(random_bytes(16))`, never sequential IDs. `DesignRepository::create()` generates the hash ITSELF and ignores any `design_hash` in `$data` — when seeding test designs, read the real hash back via `get($id)`

### Shared browser modules (`shared/js/`)

Rules the Template Builder and the customer designer must agree on live here and are imported by
BOTH — never copied. Ten duplications were consolidated in the 1.8.x cycle after each copy drifted
from its twin; an eleventh is a defect, not a shortcut.

| Module | Rule it owns |
|--------|--------------|
| `zoneRectClamp.js` | bounding-box clamp. **An object that does not fit an axis is NOT clamped on it** — a constraint with no valid position only traps the user (1.8.1) |
| `zoneClamp.js` | which zone enforces what: lenient rect clamp while dragging, true outline enforced on `object:modified`, nothing enforced when nothing fits. `keepInsideRect` keeps a zone-less object on the canvas |
| `zoneSelection.js` | `findFirstZoneForType` / `findZoneForPoint` — **first clipping zone that allows the type wins**, so zone ORDER decides where new customer elements land |
| `zoneContainment.js` | SVG-outline containment + shape-aware placement |
| `atLogicalCanvasSize.js` | every live-canvas capture renders at zoom 1 and the view's logical size, so the customer's window cannot decide the export resolution |
| `textPlaceholder.js` | an emptied text layer stays as a dashed, never-exported placeholder |
| `textAnchor.js`, `fontSizeLimits.js`, `layerLockForCustomer.js`, `MmRuler.jsx`, `rulerTicks.js`, `ensureFontMeasured.js`, `googleFontLoader.js` | text anchoring, the mm font floor, the padlock's meaning for customers, the ruler, font measurement |

**Governing rule for every constraint in this codebase:** a constraint that leaves the user no way
to correct their situation is worse than no constraint. Both clamp bugs (`0d4c69b`, `9921cda`) were
constraints that pinned an object to a single position; both were design decisions, not slips.

### JavaScript
- **React 18** with functional components and hooks
- **Zustand** for state management (not Redux, not Context)
- **CSS scoping:** All frontend classes use `pf-` prefix with BEM naming. Designer wrapper uses `all: initial` to isolate from theme styles. Always set explicit `color` on buttons/inputs to prevent theme overrides.
- **Template-layer flags are opt-IN — read them `=== true`, never `!== false`:** `template_art` and `exclude_from_export` on a zone layer are written by the LightBurn import alone, and only ever as `true`. Reading them as `!== false` made "locked background art, excluded from the export" the default for EVERY image layer, so a merchant's logo (Add Layer → Image writes neither key) was pinned behind the canvas, unselectable, and stripped from both export renders — the plank came out blank (1.8.6). Any flag that no code path ever writes `false` must be read as opt-in.
- **Billable = what actually engraves, and both counters must agree:** `utils/priceCounts.js` and `Pricing\PriceCalculator::classify_object()` classify the same Fabric objects, and the server recalculates authoritatively — change one without the other and the designer shows one price while the cart charges another. Empty and whitespace-only text is NOT billable: template text layers are seeded empty on purpose and `shared/js/textPlaceholder.js` keeps a text the customer cleared on the canvas (1.8.6).
- **Fabric.js JSON serialization:** Always use `canvas.toObject(['data'])` — never `canvas.toJSON(['data'])`. In Fabric 6, `Canvas.prototype.toJSON()` takes no arguments and just calls `this.toObject()` with no arguments internally, so a `propertiesToInclude` array passed to `toJSON()` is silently dropped and custom `data` properties (e.g. `elementType`, `zoneIndex`) never make it into the snapshot. `toObject(['data'])` returns the identical plain-object shape `loadFromJSON` accepts, so it's a drop-in fix.
- **Fabric.js JSON validation:** Whitelist allowed object types before `loadFromJSON`
- **Fabric.js 6.x type names:** Runtime types are lowercase hyphenated (`'i-text'`, `'image'`, `'path'`), but JSON serialization uses PascalCase (`'IText'`, `'Image'`). Use case-insensitive comparison when matching types at runtime.
- **No `stopPropagation` on `#pf-designer-root`:** The designer renders inside a WooCommerce product tab via the `[sgpd_designer]` shortcode. Never add blanket `stopPropagation` on the designer root — it blocks Fabric.js's `document`-level `pointerup` listener, causing dragged objects to stick to the cursor.
- **Verify hook imports:** When adding React components that use hooks (`useRef`, `useState`, etc.), always verify the hook is imported. Missing hook imports cause `ReferenceError` that crashes the entire React tree with no visible error on the page.
- **Fabric.js canvas scaling:** Use `canvas.setZoom(scale)` + `canvas.setDimensions({ width, height })` (NOT `cssOnly: true`). Using `cssOnly` causes double-scaling: zoom shrinks objects in the backing buffer, then CSS shrinks the buffer again. Always change backing canvas dimensions alongside zoom.
- **Canvas scale ceiling:** `useCanvasScale` caps at `MAX_SCALE = 2` (was a hard `1`, which meant
  the designer never rendered larger than the template's own size). Template background photos are
  ~800px wide, so past 2x a big blurry plank looks worse than a smaller sharp one. On the live shop
  Astra caps the product-tab column at ~790px, so 2x is only reachable in the modal display mode.
  `.pf-canvas-cell`/`.pf-canvas-grid` need `min-width: 0` — a grid item's automatic minimum is its
  min-content, so without it the container reports MORE room after each pass and the canvas creeps
  to the ceiling on every window size.
- **Builder canvas resize:** the Fabric canvas is created in an effect keyed on `[currentViewIndex]`,
  so a change to `canvas_width`/`canvas_height` for the SAME view (what a LightBurn import does) does
  NOT rebuild it. A separate effect calls `setDimensions()`. Never widen the init effect's deps to
  include the sizes — recreating the canvas drops objects, undo history and selection.
- **Mobile detection:** Use `matchMedia` (not `window.innerWidth`) for breakpoint detection. Safari iOS briefly reports `innerWidth` as 980px before viewport meta tag is applied. Use `screen.width` as fallback for initial state. Never evaluate `matchMedia` at module level — Safari can misreport before DOM ready.
- **CSS delivery:** Build outputs CSS as both JS-injected (via Vite bundle) and separate `dist/frontend-designer.css` file (via `cp` in build script). Safari has issues with media queries in JS-injected `<style>` tags. The PHP already enqueues the CSS file via `<link>` tag if it exists.
- **Zustand stale closures:** In async handlers or callbacks that run later (e.g. `handleSave`), always read Zustand state fresh via `useDesignerStore.getState()` instead of using closure variables from the React component. Closure variables capture state at render time and go stale by the time the callback executes. **A `getState()` snapshot taken before an `await` is exactly as stale as a closure** — read the store where the values are USED, not at the top of the handler. `ImportLightBurn` read it first and then awaited one media upload per bitmap, so a zone the merchant added meanwhile was invisible and the import stacked a second full-canvas zone on it (1.8.6).
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
- `grant_template_cap` filter lives in `Plugin` main class (not Admin) so it applies in REST API context too
- List endpoints support pagination (`per_page`, `page`) with `X-WP-Total` headers
- Clipart and font GET endpoints are intentionally public (`__return_true`) — guest customers need them in the frontend designer. The SVG files are public uploads anyway. Mutation endpoints require `edit_pf_templates` + premium feature gate.

## Zones and where customer elements land

`findFirstZoneForType` (in `shared/js/zoneSelection.js`) returns the **first** zone that clips or
restricts AND lists the element type in `allowed_types`. Zone ORDER therefore decides where a
customer's clip art, upload or new text is placed.

The LightBurn import creates a container zone named `Imported` spanning the whole canvas. Until
1.8.5 it was created with `allowed_types: ['text','image','svg']`, so it always won over the
merchant's real boundary and every customer element was effectively unconstrained. It now claims
nothing (`allowed_types: []`, `admin/js/template-builder/src/utils/importedZone.js`).

**Templates imported before 1.8.5 are NOT migrated** — deliberately, since zone config is the
merchant's own setup. Fix by hand: open the `Imported` zone and untick text/image/svg.

`behavior: 'clip'` only MASKS what falls outside the shape; it does not stop the customer moving an
element out. Only `restrict` constrains movement. A zone meant as a real engraving boundary must be
`restrict`.

## Handing a design to a customer

The shop owner designs something FOR a customer, then hands it over. Ownership is the whole
mechanism, and it is checked in two mirrored places — `RestDesigns::owns_design()` and
`Frontend::owns_design()`: the design's `customer_id` matches the logged-in user, OR its
`session_id` matches the guest cookie, OR the requester has `edit_sgpd_templates`.

`RestDesigns::create_design` stamps `customer_id = get_current_user_id()`, so an admin-drawn design
belongs to the ADMIN. Until it is reassigned the customer cannot see it under My designs
(`list_by_customer` filters on `customer_id`) and — the part that bites — **`add_cart_item_data`
drops the hash SILENTLY** when ownership fails, so the product lands in the cart with no design and
no error at all.

`Admin\DesignsPage` (`includes/Admin/class-designs-page.php`) is the route: assign by user ID,
e-mail or username, and copy the `?pf_design=HASH` reopen link from the row.
`DesignRepository::assign_customer()` also CLEARS `session_id` — ownership is customer OR session,
so leaving the guest session behind would keep the design reachable from the browser it was drawn
in. One design, one owner.

Two things this does NOT do, deliberately: the customer must be logged in before opening the link
(the REST fetch 403s otherwise and they see an empty default design, which reads as a failure), and
the designer itself is still an EDITOR — reopening a design via `?pf_design=HASH` lets the customer
change it before ordering, proof or no proof. The proof flow below (Pro) is the read-only path; the
editor hand-off above is still the only path when there is no proof.

**Result reporting is on the row, not in an admin notice.** Notice-collector plugins (this shop runs
Admin Site Enhancements) sweep every `.notice` in `.wrap` into a hidden drawer — including
`notice-error`, which their selector list does not exempt even with `.inline` — so a mistyped
address would look like nothing happened. Do not "fix" this back to `add_settings_error`.

### Proof and approval flow (Pro, 1.10.0)

A proof is a read-only alternative to handing over the editor: the merchant sends a link to the
saved render, the customer approves it (or asks for a change) without ever touching Fabric. Full
design in `docs/superpowers/specs/2026-08-26-proof-approval-flow-design.md`.

- **Every transition lives in `Proof\ProofWorkflow`.** Send, resend, withdraw, approve, request
  changes — one state machine, one place that has an opinion about what's allowed. The proof page
  and `Admin\DesignsPage` call into it (there are no REST proof endpoints — the proof page renders
  server-side); neither contains its own `if` chains over `proof_status`. If a rule about proofs
  needs to change, it changes in one file.
- **`proof_token` is generated separately from `design_hash`** (same `bin2hex(random_bytes(16))`
  source, different value) because `design_hash` leaks into cart URLs and order item meta — a value
  that already leaks that widely must never also grant access to anything.
- **`Frontend::owns_design()` has one clause its REST mirror deliberately does not** (factored out as
  the shared private helper `is_proof_only_owner()`, used by both `owns_design()` and
  `proof_permalink()`): a hash the visitor approved in this WooCommerce session
  (`sgpd_proof_approved[]`) AND the design's own `proof_status` is still `'approved'`. Both halves
  are required — the session proves this visitor is the one who clicked approve; the column proves
  the merchant hasn't withdrawn the proof since. Session alone would mean withdrawing a proof does
  nothing for someone who already approved it. This clause is NOT what keeps the approve-to-cart
  step working — `ProofPage::add_design_to_cart()` hands the hash straight to
  `WC_Cart::add_to_cart()` as `$cart_item_data`, bypassing `add_cart_item_data()` (and therefore
  `owns_design()`) entirely. What it actually buys: it lets a proof-only visitor be recognised as an
  owner by other server-rendered frontend code — the gallery thumbnail override, the
  proof-vs-`?pf_design=` permalink choice. `RestDesigns::owns_design()` does NOT get this clause —
  the proof page is rendered server-side and never touches the REST layer, so REST ownership stays
  exactly as strict as it always was. This asymmetry is intentional and documented in both methods'
  docblocks.
- **The proof page is routed by a query parameter (`?sgpd_proof=<token>`), never a rewrite
  endpoint.** A rewrite endpoint needs `flush_rewrite_rules()`, and a version-triggered flush has
  already 404'd this shop's category pages once (see Deployment). A query param needs no rewrite
  rules and can't repeat that mistake.
- **`find_stale_guest_drafts()` skips any design with a proof** (`proof_status <> 'none'`). "No
  account needed" is a stated goal of the proof flow, so a proof sent to someone without an account
  IS the normal case here, not an edge case — the cleanup cron must not delete the design out from
  under a customer who still has the link in their inbox.
- **Approving is not ordering.** The design's `status` column stays `draft` through `sent`,
  `changes_requested`, and `approved` alike; it only flips to `ordered` when an order item actually
  carries the hash (`OrderIntegration`). A proof can be approved and then abandoned in the cart.
- **The full-size render is streamed, not embedded, and it's re-sanitised on the way out.** The
  proof page shows a thumbnail; "view full size" streams the stored `export_svg` behind a sandbox
  CSP with remote references stripped. A stored SVG served as a top-level document would otherwise
  be free to make its own network requests, and any of those would carry the proof token in the
  `Referer` header — the one thing this whole token design exists to keep contained.

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
| `wp_pf_designs` | Customer designs: hash ID, product/template link, status, price. Also carries proof state (Pro, 1.10.0): `proof_status`, `proof_token`, `proof_sent_at`, `proof_note`, `proof_email` — see "Proof and approval flow" below |
| `wp_pf_design_views` | Per-view Fabric.js canvas JSON + thumbnail + the per-format export sources, all browser-generated at save time: `export_svg` (3× PNG data URL), `export_vector` (outlined production SVG), `export_vector_embed` (editable SVG, curved text as textPath, fonts inlined), `export_lbrn` (native LightBurn project XML, 1.11.0) |
| `wp_pf_design_templates` | Pre-made design templates that customers can apply in the designer |
| `wp_pf_design_template_views` | Per-view Fabric.js canvas JSON for design templates |
| `wp_pf_exports` | Export records: format, file path, status per order. **Multi-view formats (PNG, SVG) store paths as a comma-separated list** in `file_path` — any cleanup code (`ExportManager::generate_export`, `RestExports::delete_export`, `get_download_paths`) must `explode(',', $file_path)` and iterate, never treat it as a single path |
| `wp_pf_price_log` | Pricing audit trail per design element |
| `wp_pf_fonts` | Custom font uploads (family name, file URL, format) |
| `wp_pf_clipart_collections` | Clipart collections (name, slug) |
| `wp_pf_clipart` | Clipart items (SVG file URL, collection FK) |
| `wp_pf_font_groups` | Font groups (name) — named sets of fonts the merchant selects per template |
| `wp_pf_font_group_members` | Group membership as **family-name strings** (not FKs to `wp_pf_fonts` — web-safe/Google fonts have no row there), UNIQUE (group_id, family), FK cascade on group delete |

All tables use InnoDB engine for foreign key and transaction support. Total: 13 tables.

**Font groups resolve at READ time, never at save time.** Templates store only group ids in
`global_config.allowed_font_groups` (alongside the individual `allowed_fonts`);
`RestTemplates::get_public_template()` expands them into the flat `allowed_fonts` list (union,
deduplicated, deleted group ids silently skipped, the ids themselves stripped from the response) —
the same spot where color palettes are resolved. That is the whole "add a font to a group later and
every template picks it up" mechanism: never bake the expanded list into a stored template. The
builder mirrors this client-side via `utils/fonts.js#resolveAllowedFonts` (the admin template
endpoint returns the RAW config on purpose). Group management lives on the `sgpd-fonts` admin page
(React app `admin/js/fonts/`); mutations sit in `RestFontsAdmin` (premium, `custom_fonts` gate),
the public `GET /pf/v1/font-groups` in `RestFonts`. `FontRepository::delete_family()` also removes
the family from every group.

## Prefix Rename (wp.org review round 2)

The reviewer flagged `pf`/`productforge` as too short/generic for globally-namespaced identifiers. Everything **except** the items below was renamed from `pf`/`PF_`/`productforge` to `sgpd`/`SGPD_` in v1.2.0. `Includes\LegacyMigration::maybe_migrate()` (`includes/class-legacy-migration.php`) runs once per install (gated by the `sgpd_migrated_from_pf` flag option, called as the first line of `ProductForge::init()`) and copies every old option/transient value to its new name before anything else boots, then clears the old cron schedule. Old option is deleted after a successful copy either way (even if the new key already existed) to avoid orphaned `pf_*` rows.

**NOT renamed** (breaking to change / no real collision risk): DB tables `wp_pf_*`, REST namespace `pf/v1`, CSS classes `pf-*`, DOM id `pf-designer-root`, the `$_POST` field `pf_design_hash` and order item meta `_pf_design_hash`, the `pf_design` cart/product-permalink query var, the `pf_session_id` guest-session cookie, the WC cart-item key `pf_surcharge`, uploads subdirectories (`pf-thumbnails`, `pf-exports`, `pf-fonts`, `pf-clipart`, `pf-cache` — renaming would orphan files already referenced in the DB on the live site), the WC My Account endpoint slug `pf-designs`, the WC product-data-tab id `pf_productforge_data` / tab key `productforge`, WP_Error codes (`pf_premium_required`, `pf_not_found`, `pf_starter_*`, `pf_svg_sanitizer_missing`), export filename prefixes (`pf-svg-`, `pf-pdf-`), and the Freemius product `slug` (`snelgraveren-product-designer` — a Freemius dashboard identifier, unrelated to this rename). The `[productforge]` shortcode alias was REMOVED in v1.7.6, and the unprefixed `[productdesigner]` tag was REMOVED in v1.7.7 (the wp.org reviewer's tool flagged it as a non-distinctive, unprefixed plugin-owned shortcode); the designer now registers **only** `[sgpd_designer]`. Leftover `[productdesigner]`/`[productforge]` tags in existing content are intentionally NOT re-registered and NOT detected by `has_shortcode_in_content()` — they fall through to the product-page auto-render, so the designer still shows (no bare tag, no `#pf-designer-root` duplicate). On the live site the 6 products that used the old tags were migrated to `[sgpd_designer]` in v1.7.7.

Constants: `PF_VERSION` → `SGPD_VERSION`, `PF_PLUGIN_DIR` → `SGPD_PLUGIN_DIR`, `PF_PLUGIN_URL` → `SGPD_PLUGIN_URL`, `PF_PLUGIN_FILE` → `SGPD_PLUGIN_FILE`, `PF_LICENSE_KEY` → `SGPD_LICENSE_KEY`.

Options/transients migrated by `LegacyMigration::OPTION_MAP` / `TRANSIENT_MAP`:

| Old | New |
|-----|-----|
| `pf_plugin_version` | `sgpd_plugin_version` |
| `pf_frontend_js_hash` | `sgpd_frontend_js_hash` |
| `pf_endpoint_registered` | `sgpd_endpoint_registered` |
| `pf_export_trigger_status` | `sgpd_export_trigger_status` |
| `pf_export_default_format` | `sgpd_export_default_format` |
| `pf_delete_data_on_uninstall` | `sgpd_delete_data_on_uninstall` |
| `pf_guest_design_retention_days` | `sgpd_guest_design_retention_days` |
| `pf_health_email_alerts` | `sgpd_health_email_alerts` |
| `pf_health_last_alert_hash` | `sgpd_health_last_alert_hash` |
| `pf_ordered_backfill_done` | `sgpd_ordered_backfill_done` |
| `pf_db_version` | `sgpd_db_version` |
| `pf_color_palettes` | `sgpd_color_palettes` (premium) |
| transient `pf_system_status_critical` | transient `sgpd_system_status_critical` |

Not migrated (rate-limit transients with a per-session/per-user dynamic suffix, cheap to just start fresh under the new key): `pf_upload_count_{md5(session)}` → `sgpd_upload_count_{md5(session)}`, `pf_clipart_upload_{user_id}` → `sgpd_clipart_upload_{user_id}`.

Other renames: Freemius helper `pf_fs()` → `sgpd_fs()`, global `$pf_fs` → `$sgpd_fs`, action `pf_fs_loaded` → `sgpd_fs_loaded`; cron hook `pf_daily_maintenance` → `sgpd_daily_maintenance` (`Cleanup::HOOK`, old schedule cleared by the migration); capability `edit_pf_templates` → `edit_sgpd_templates` (granted dynamically, never stored — no migration needed); script/style handles `pf-*` → `sgpd-*` (`pf-frontend-designer`, `pf-template-builder`, `pf-design-templates`, `pf-clipart`, `pf-starter-gallery`, `pf-order-export-actions`); JS globals `pfTemplateBuilder`/`pfDesignTemplates`/`pfClipart` → `sgpdTemplateBuilder`/`sgpdDesignTemplates`/`sgpdClipart`; admin menu slugs `productforge` → `sgpd-templates`, `pf-template-builder` → `sgpd-template-builder`, `pf-design-templates` → `sgpd-design-templates`, `pf-clipart` → `sgpd-clipart`, `pf-settings` → `sgpd-settings`, `pf-export-dashboard` → `sgpd-export-dashboard` (hook-name string comparisons in `class-admin.php`/`class-settings-page.php` derive from these and were updated in lockstep); admin-post action `pf_bulk_export` → `sgpd_bulk_export`; settings API option group `pf_settings` → `sgpd_settings`.

## Admin Pages

| Menu Item | Page Slug | Purpose |
|-----------|-----------|---------|
| Templates | `productforge` | Template list (WP_List_Table with status tabs + bulk actions), plus a starter-templates gallery panel (see below) |
| Add New | `pf-template-builder` | Template builder React app (canvas, zones, layers, permissions, pricing) |
| Design Templates | `pf-design-templates` | Design template CRUD React app (list, create, edit, delete, import/export JSON) |
| Clipart | `pf-clipart` | Clipart manager React app (collections CRUD, bulk SVG upload, drag & drop) |
| Fonts | `sgpd-fonts` | `admin/js/fonts/` React app: custom-font upload + **font groups** (create/rename/delete, tick fonts per group — web-safe, Google and custom alike). Groups are selected per template in the builder (Settings → Fonts) and resolved server-side at read time — see "Font groups resolve at READ time" under Database Tables |
| Designs | `sgpd-designs` | `Admin\DesignsPage` — every saved design, newest first, with the one action WP admin had no route for: **assigning a design to a customer**. Also **send, resend and withdraw a proof** (Pro, 1.10.0) — see "Handing a design to a customer" below. **Delete design** (1.11.2) removes a design + thumbnails + export files behind a confirm; ordered designs are refused (their hash lives in order item meta) and file deletion is realpath-contained to uploads/. **Download SVG/LightBurn per row** (Pro, 1.12.1, `admin_post_sgpd_download_design`): reuses `ExportManager::generate_export()` with `order_id 0`, so drafts without an order export too — always regenerated (a cached export of a draft goes stale on the next edit); missing export data reports on the row ("reopen and re-save once"). Product name + thumbnail open the design itself (reopen link, new tab); the WC edit screen sits behind a small "(edit product)" link |
| Settings | `pf-settings` | Export options (`pf_export_trigger_status`, `pf_export_default_format`), `pf_delete_data_on_uninstall` toggle, guest design retention (`pf_guest_design_retention_days`), health e-mail alert toggle (`pf_health_email_alerts`), a design-statistics panel (saved/ordered/conversion, last 30 days), and system status checks (`Admin\SystemStatus`: PHP ≥ 8.1, finfo, rsvg-convert/Imagick-SVG, writable `pf-thumbnails`/`pf-exports`/`pf-fonts`/`pf-clipart`/`pf-cache`, DB tables, LiteSpeed detection). Critical failures also show as an admin notice on every ProductForge screen (cached 5 min in the `pf_system_status_critical` transient) |
| Production | `pf-export-dashboard` | `Admin\ExportDashboard` — lists recent orders (filterable by status/days) that contain designs, flags designs containing raster images via `DesignInspector::contains_raster()`, and bulk-downloads the selection as one ZIP via `admin_post_pf_bulk_export`. Since 1.11.1 the ZIP carries EVERY format the build's gates allow (PNG/PDF/SVG/lbrn) per design; a format that cannot be generated lands in a `LEESMIJ-ontbrekend.txt` inside the ZIP instead of sinking the download. The Settings default format only governs the automatic on-status-change export |

- **Starter templates:** `templates/starter/manifest.json` + `templates/starter/assets/*.svg` ship 10 ready-made templates (engrave/print/basic sets — hand-authored, no CPTs, no DB rows until import). `Admin\StarterTemplates` (`includes/Admin/class-starter-templates.php`) parses the catalog, imports a chosen entry by copying its assets into `uploads/pf-template-assets/` (re-sanitized via `enshrined\svgSanitize\Sanitizer` even though they're our own files), rewriting `asset:` URLs, and creating the template + views through `TemplateRepository`. Imported templates use slug `starter-{id}` — that slug doubles as the "already imported" detection key, no extra DB column. REST: `GET /pf/v1/starter-templates` (catalog with `imported` flags) and `POST /pf/v1/starter-templates/{id}/import`, both gated on `edit_pf_templates`. There is NO template-count quota in the free build (wp.org guideline 5 forbids code-level quotas; `Plugin::has_feature()` fails open for anything not in its premium list) — free users can import every starter. **SVG-boundary convention (v1.7.8):** both renderers place the boundary group's *bounding box* at `zone.x/y` (Fabric group `left/top`), not the SVG origin. Starter zones with `boundary_type: 'svg'` therefore store the shape's bbox (bone: 60,190,680×220 on an 800×600 canvas) in `x/y/width/height` + `svg_intrinsic_*`, and the asset SVGs carry explicit `width`/`height` next to the `viewBox` (without them the background scales wrong). Never "fix" this in the renderer — live-site boundaries made with From layers / Use as Boundary were saved under the bbox convention. The gallery panel renders server-side (no React) on the Templates list page (`includes/Admin/views/template-list.php`), always visible while an un-imported starter remains, with extra-prominent copy when the template list is empty; `includes/Admin/class-admin.php` enqueues the inline JS that wires Import buttons to the REST endpoint.

## WooCommerce Integration Points

- Product meta: `_pf_designer_enabled`, `_pf_template_id`, `_pf_display_mode`
- Cart: `pf_design_hash` in cart item data via hidden input + `woocommerce_add_cart_item_data` filter; auto-save-before-cart intercepts form submit if design is dirty
- Cart thumbnails: `woocommerce_cart_item_thumbnail` (classic) + `woocommerce_store_api_cart_item_images` (block cart) — shows **all views** side by side, not just the first
- Cart permalinks: `woocommerce_cart_item_permalink` appends `?pf_design=HASH` for design reload
- Product gallery: `woocommerce_single_product_image_thumbnail_html` replaces image when `pf_design` query param present
- Thumbnails: Saved as PNG files in `wp-content/uploads/pf-thumbnails/` (block cart requires real URLs, not data URIs). Non-active views generate thumbnails via offscreen Fabric canvas during save.
- Shortcode: `[sgpd_designer]` renders the designer inline on product pages (auto-detects product context) and is detected by `has_shortcode_in_content()` for the auto-render dedup. (The unprefixed `[productdesigner]` and legacy `[productforge]` tags were removed in v1.7.7/v1.7.6 for the wp.org listing — leftover instances fall through to the auto-render instead of being detected, so they never leave a bare tag on the page.)
- Gutenberg block: `productforge/designer` (`blocks/designer/`, registered by `Frontend\DesignerBlock` in both contexts) — the block-theme equivalent of the shortcode. Dynamic block; `render_callback` delegates to the shortcode pipeline so all checks live in one place. Editor shows a plain-JS placeholder (no build step; deps declared in `editor.asset.php`). Duplicate-render prevention: `Frontend::has_shortcode_in_content()` checks shortcode + `has_block()` on post content + `template_has_designer_block()` (scans `$_wp_current_template_content` for Site Editor template placements) — the before-add-to-cart auto-render skips whenever the merchant placed the designer explicitly. Testing gotcha: fresh WooCommerce installs default to Coming Soon mode (`woocommerce_coming_soon` option = yes), which replaces ALL product pages with a coming-soon template — set it to `no` before frontend testing or every designer test falsely fails.
- Surcharge: via `woocommerce_before_calculate_totals`
- Order: design_hash in order item meta, export triggered on configurable order status
- Order status flip: `OrderIntegration::save_order_item_meta()` and `assign_design_hashes()` call `DesignRepository::mark_ordered_by_hash()` when an order item's design hash is saved, flipping the design's `status` column to `ordered`. This backs the "Designs ordered" stat and the Production dashboard filter — designs saved before this feature shipped are not back-filled.
- Account tab: `Frontend\AccountDesigns` registers a `pf-designs` WooCommerce My Account endpoint (`add_rewrite_endpoint`) listing the logged-in customer's saved designs with a reopen link (`?pf_design=HASH` on the product page). Rewrite rules self-heal via a version guard — `get_option('sgpd_endpoint_registered') !== SGPD_VERSION` — because ZIP-upload plugin updates never re-run the activation hook. **The flush is deferred to `shutdown`, never called mid-`init`:** `flush_rewrite_rules()` regenerates the WHOLE ruleset from what's registered at call time, so flushing on `init` can capture an incomplete set and drop WooCommerce's empty-base product-category rules → shop category pages 404 after a version bump. By `shutdown` every rewrite is registered. (Symptom + fix in memory `feedback_deploy_flush_rewrite`.)
- HPOS: Compatibility declared in `productforge.php`

## Scheduled Tasks & Maintenance

- **`pf_daily_maintenance` cron** (`class-cleanup.php`, `Cleanup::HOOK`): runs daily, deletes abandoned guest designs (never ordered, no logged-in customer) older than `pf_guest_design_retention_days` (default 30; 0 disables cleanup) along with their thumbnail files. Ordered designs and designs belonging to logged-in customers are never deleted. Also triggers the health e-mail alert check on every run.
- **Self-heal scheduling pattern:** `Cleanup::init()` hooks `wp_next_scheduled()` on `init` instead of relying solely on the activation hook — the same reasoning as the account-endpoint rewrite flush: ZIP-upload updates skip `register_activation_hook`, so cron and rewrite state must repair themselves on every request instead of only at install time.
- **Health e-mail alert:** gated by option `pf_health_email_alerts` (default on). Mails `admin_email` when a critical `SystemStatus` check starts failing; the failing-checks set is hashed and stored in `pf_health_last_alert_hash` so a persistent failure doesn't re-mail daily, but a newly-failing check does. Recovery resets the stored hash silently (no "all clear" e-mail).
- **`global_config.vector_only`** (template builder → Settings → Uploads, `SettingsUploads.jsx`): per-template flag for engraving-only products. When set, the frontend designer disables the image-upload tool (`AddTab.jsx` checks `globalConfig.vector_only`) and `DesignerCanvas.jsx` blocks image drops/paste with an error message — SVGs and clip art remain allowed. Order admin (`OrderIntegration`) and the Production dashboard (`ExportDashboard`) both surface a warning via `Export\DesignInspector::contains_raster()` when a design was saved with raster images anyway (e.g. added before the flag was enabled).

## Deployment

- **Live site:** snelgraveren.nl (LiteSpeed Cache — flush after deploy). LiteSpeed on this host is aggressive: it caused the shop-category 404 (rewrite flush, above) AND caused customers to see the wrong/default design (see next bullet). Debug caching **as a guest** (`fetch(url, {credentials:'omit'})`, twice, to catch a HIT) — logged-in admins are never cached, so the bug is invisible when you're logged in. For logged-in live verification (admin pages, downloads): Martin's Chrome usually carries a live wp-admin session — drive it via the chrome-devtools MCP (`new_page` to the wp-admin URL; a page title without "Log In" confirms the session) instead of asking for credentials.
- **Designer pages must NEVER be full-page cached.** They embed a per-session WordPress nonce and load/save session-specific designs over REST; a cached copy freezes one visitor's nonce for everyone (breaks saves → default image) and leaks one customer's design to another (also breaks the return-from-cart design reload). `Frontend::enqueue_assets()` calls `prevent_page_cache()` (`DONOTCACHEPAGE` + `litespeed_control_set_nocache`) on every page where the designer renders. Do not remove it. (Full symptom map in memory `feedback_designer_page_nocache`.)
- **One plugin folder on the live site: `snelgraveren-product-designer/`** (measured as a guest,
  2026-08-26 — `wp-content/plugins/snelgraveren-product-designer/dist/frontend-designer.css` returns
  200, and both `productforge/` and `snelgraveren-product-designer-premium/` return 404). The
  duplicate-folder hazard that dominated earlier releases is GONE: `bin/package.sh` names its ZIP
  folder `snelgraveren-product-designer`, which is now the folder that runs, so an upload lands on
  the live copy. Earlier notes said `productforge/` was active — true on 2026-08-25, not any more.
  Still worth doing after every upload: check which row on `plugins.php` shows "Deactiveren" and
  what version it reports. Not because a second folder can swallow it, but because verifying a
  deploy is cheaper than assuming one.
  **Checking the live version without logging in:** the active folder's `readme.txt` is public —
  `curl -s https://www.snelgraveren.nl/wp-content/plugins/snelgraveren-product-designer/readme.txt | grep -i "^Stable tag"`.
  Probing a known path for 200 vs 404 also tells you which folders exist, and whether one specific
  file made it into the build that is actually live.
- **Plugin ZIP:** run `bash bin/package.sh` (does `npm run build` + `composer install --no-dev` + stages + zips to `snelgraveren-product-designer-<version>.zip` in the project dir). Manual ZIP must include: main plugin file, `freemius-init.php`, `includes/`, `dist/`, `vendor/`, `freemius/`, `blocks/`, `templates/`, `readme.txt` (NOT `node_modules/`, `.git/`, `frontend/js/*/src/`, `languages/`). Deploy = WP-admin → Plugins → Upload → "Huidige vervangen door de geüploade", then LiteSpeed Purge All. Always upload the ZIP from the project dir (folder `snelgraveren-product-designer`); the ZIP downloaded from Freemius is named `…-premium.zip`, so WordPress installs it as a SECOND folder instead of updating the live one — that is how the site sat on 1.7.5 while 1.7.7 lay dormant next to it, and it is the one way the duplicate-folder problem can come BACK now that live is down to a single folder. Check the active row on `plugins.php` before assuming which version is live. Bump the version in `snelgraveren-product-designer.php` (header + `SGPD_VERSION`) AND `readme.txt` Stable tag + changelog. **Rebuilding a ZIP under a version number that already exists produces two different archives with one name** — done deliberately for an unreleased 1.10.0 on 2026-08-26, and the only way to tell afterwards which one was live was probing the site for a file that existed in just one of them. If a version may already have been uploaded, bump instead of rebuilding.
- **JS cache busting (hash in filename, not `?ver=`):** `Frontend::enqueue_assets()` copies `dist/frontend-designer.js` to `uploads/pf-cache/frontend-designer.<md5>.js` on the first pageview after a build and enqueues the hashed URL. **Never written inside the plugin directory** — wp.org disallows plugins writing to their own directory, and `uploads/` is also the correct place for runtime-generated files anyway. The copy is written via temp file + atomic `$wp_filesystem->move()` (WP_Filesystem initialized on demand; a concurrent request must never serve a half-written bundle — Safari would cache it for a year). The **previous build's hashed copy is kept** (only older copies are deleted, via `wp_delete_file()`): LiteSpeed page-cached HTML still references the old hashed URL until the cache is flushed, and deleting it would 404 the bundle on every cached page. The md5 hash is cached in the `pf_frontend_js_hash` option keyed on `filemtime`, so the full bundle isn't hashed on every pageview. **Why not `?ver=<hash>` alone:** LiteSpeed's Delay JS feature strips query strings from `<script>` tags it marks with `data-deferred="1"`, so Safari (which caches JS with `max-age=31557600` ≈ 1 year) keeps serving stale bundles after deploys. Changing the path itself is the only reliable invalidator. If `uploads/pf-cache/` is not writable (`wp_is_writable()` check), we fall back to the un-hashed `dist/` URL. `Admin\SystemStatus` checks `uploads/pf-cache/` writability under check id `dir_pf_cache` (warning-level, not critical). **LiteSpeed JS-optimize exclude must stay hash-agnostic:** the filter excludes the substring `frontend-designer.` (with trailing dot, no `.js`) so it matches both the plain and the hashed filename — excluding the literal `frontend-designer.js` would NOT match the hashed copy and LiteSpeed would concatenate the React bundle, breaking it.
- **wordpress.org release (approved 2026-08, slug `snelgraveren-product-designer`):** SVN `https://plugins.svn.wordpress.org/snelgraveren-product-designer`, listing `https://wordpress.org/plugins/snelgraveren-product-designer/`. Published 2026-08-20 as r3657251 (1.7.8); listing, banner/icon/screenshots and readme all verified. Run `bash bin/wporg-release.sh` (`--dry-run` to stage only) on the Mac: it runs `package.sh` + `free-build.sh`, sanity-checks the FREE zip (no premium paths, no gettext files, gatekeeper stripped, `is_premium => false`), syncs it into `trunk/`, copies `wporg-assets/` (icon/banner/`screenshot-N.png`) into SVN `assets/`, copies `trunk` → `tags/<version>/` and commits. Checkout lives in `.svn-wporg/` (git-ignored). wp.org gets the **free** build only; the premium zip still goes to Freemius → Deployment. Tags are immutable — bump the version for any fix, never re-tag. SVN username = wordpress.org username (`snelgraveren`, now the script's default), password = the separate SVN password from the wp.org profile. **Run it in a real terminal, one at a time** — it needs a tty for the confirmation + password, and refuses a second concurrent run via a `.svn-wporg.lock` mkdir lock (two parallel runs interleave their prompts and finish neither). macOS ships bash 3.2, so the release path must stay free of empty-array expansion under `set -u` and of `cmd | head` under `set -o pipefail` — both silently killed this script mid-run before.
- **Deleting an old plugin folder can drop the live data:** every copy of this plugin shares the `wp_pf_*` tables, and WordPress runs the uninstall routine of whichever folder you delete. `Uninstaller::uninstall()` drops all 11 tables when its opt-in flag is set — `sgpd_delete_data_on_uninstall` (readable in Settings) for current folders, the pre-rename `pf_delete_data_on_uninstall` (readable nowhere) for v1.0.x ones. Verify the flag first; for a pre-rename folder, blank its `includes/class-uninstaller.php` via the plugin file editor before deleting. Confirm afterwards via Settings → System status ("All 11 tables present").
- **Three places encode what is premium, and they must be edited together, by hand, every time.** (1) The `@fs_premium_only` header comment in `snelgraveren-product-designer.php` — read by Freemius's own deployment processor when the PREMIUM zip goes through Freemius → Deployment. (2) `bin/free-build.sh`'s hardcoded `rm -f`/`rm -rf` "Premium-only paths" block — greps nothing from the header, and is what actually strips Pro code out of the wp.org build. (3) The sanity-check `chk` lines in `bin/wporg-release.sh` (around line 84) — these exist specifically to catch (1) and (2) drifting apart, by asserting the built free ZIP contains none of the premium paths. Adding a path to the `@fs_premium_only` comment alone strips it from the Freemius-served free build but does **nothing** to the wp.org build. Lists (1) and (2) drifted apart silently once during this project: `includes/Proof/`, `includes/Emails/` and `templates/proof/`+`templates/emails/proof-*.php` were added to the header but not to `free-build.sh`, and the entire Pro proof feature would have shipped inside the free wordpress.org build if a strip test hadn't caught it before release. List (3) is only as good as what it actually checks, though — it must carry a `chk` line for every path in (2), or a future drift between (1)/(2) ships silent. Never assume the header is authoritative for either build — check `bin/free-build.sh`'s "Premium-only paths" block AND `bin/wporg-release.sh`'s `chk` lines directly.
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
