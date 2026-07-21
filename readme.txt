=== Snelgraveren Product Designer for WooCommerce ===
Contributors: snelgraveren
Tags: woocommerce, product designer, personalization, engraving, customizer
Requires at least: 6.4
Tested up to: 7.0
Requires PHP: 8.1
Stable tag: 1.3.5
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Let customers personalize WooCommerce products with text, images, and SVGs in a fast drag-and-drop designer — built for engraving and print shops.

== Description ==

Snelgraveren Product Designer adds a modern, secure product designer to your WooCommerce store. Customers add text, photos, clip art, and SVG artwork onto your products, see a live price, and their design flows straight into your order and production workflow.

Built from the ground up as a secure alternative to legacy product designers, with server-side price calculation, strict file validation, and SVG sanitization on every upload.

= Designer =

* Drag-and-drop canvas editor (Fabric.js) with multiple product views
* Text, photos, SVG artwork, and curated clip art collections
* Single-stroke engraving fonts for laser/CNC tool paths
* Design zones with boundaries and per-zone permissions
* Live design surcharge preview while the customer edits
* Image resolution warnings before a blurry design reaches production
* Vector-only mode for engraving products (blocks raster photo uploads)
* Works with classic themes (shortcode, auto-render) and block themes (Gutenberg block)
* Mobile-friendly modal designer

= Store owner tools =

* Ready-made starter templates: import one click from the built-in gallery
* Template builder with views, zones, layers, permissions, and pricing rules
* Production dashboard: all orders with designs, bulk ZIP export for a production run
* Automatic design exports (PDF, PNG, SVG) when an order reaches a chosen status
* Design statistics: saved vs. ordered designs and conversion
* "My designs" tab on the customer account page
* Automatic cleanup of abandoned guest designs (configurable retention)
* System status checks with e-mail alerts when something needs attention

= Security first =

* All prices calculated server-side — client values are never trusted
* Every SVG sanitized, every upload MIME-validated
* Design links use unguessable random identifiers
* Rate-limited uploads

== Installation ==

1. Upload the plugin ZIP via Plugins → Add New → Upload Plugin, or unzip into `wp-content/plugins/`.
2. Activate the plugin (WooCommerce must be installed and active).
3. Open Product Designer → Templates and import a starter template, or build your own.
4. Edit a product, enable the designer, and pick a template.
5. Block theme? Place the "Snelgraveren Product Designer" block in your Single Product template or product description.

== Development ==

The full source code (including the un-minified JavaScript sources for the compiled files in `dist/`) and build tooling are publicly available at:

https://github.com/temmink/snelgraveren-product-designer

Build steps: `npm install && npm run build` (Vite) compiles the designer and admin bundles into `dist/`; `composer install --no-dev` installs the PHP dependencies. See the repository README for details.

== Frequently Asked Questions ==

= Does it work with block themes? =

Yes. Classic themes render the designer automatically on the product page (or via the `[productforge]` / `[sgpd_designer]` shortcode). Block themes use the Snelgraveren Product Designer block in the Site Editor or product description.

= Where are the production files? =

Exports (PDF, PNG, SVG) are generated locally on your server — nothing is sent to external services. Download them per order or in bulk from the Production dashboard.

= What does the free version include? =

The free version includes the full designer with unlimited templates and PNG export. Pro unlocks multiple product views, PDF/SVG production export, automatic exports on order status, pricing rules, custom fonts, clip art management, color palettes, and more.

== External Services ==

This plugin uses the Freemius SDK for license validation, plugin update delivery, and optional usage analytics.

**No data is sent anywhere before you act.** On activation, Freemius shows an opt-in screen with two choices:

* **"Skip"** — nothing is sent. The plugin works fully offline; only your Pro license key (if you have one) is validated against Freemius' servers when you activate a license.
* **"Allow & Continue"** — you opt in to license validation, update delivery, and anonymized usage analytics. Only then does the plugin share: your site URL, WordPress and PHP versions, the list of active plugins and theme, and the admin e-mail address, with Freemius (freemius.com), a licensing and analytics service used by many WordPress and WooCommerce plugins.

You can review or withdraw this consent at any time from the plugin's account/opt-in prompts. This service is used for licensing and update delivery — no customer, design, or order data is ever sent to Freemius.

Freemius Privacy Policy: https://freemius.com/privacy/
Freemius Terms of Service: https://freemius.com/terms/

No other external services are used. Design exports (PDF/PNG/SVG) are rendered entirely on your own server — nothing about your customers' designs, uploads, or orders is ever sent off-site.

== Changelog ==

= 1.3.5 =
* Fix: a design whose font family is stored without Google Fonts' canonical spacing (e.g. "BebasNeue" instead of "Bebas Neue") never loaded on the product page, so the canvas — and therefore the export — fell back to a different-width font and centred text drifted out of the middle. The designer now loads Google fonts under the exact family name the design uses via the built-in font proxy (which normalises the name server-side), so the on-screen text and the export both use the real font and sit correctly. This is the real fix for off-centre exports that 1.3.4 could not address (the font never loaded at all, so there was nothing to wait for). Re-open and save an affected design once to regenerate its export.

= 1.3.4 =
* Fix: centered text could be off-centre in the PNG/SVG export while looking correct in the editor. The offscreen render used to lay text out before its web font had loaded, measuring it with a fallback font of a different width; it now waits for the font and re-measures each text object before exporting, so text sits exactly where the design shows it. Re-open and save an affected design once to regenerate its export.

= 1.3.3 =
* Fix: re-opening a saved design and saving it again (e.g. to regenerate the vector export) could, in a load-timing race, store an empty canvas and wipe the design. The save now takes the active view from the live canvas, never overwrites a saved view with an empty (0-object) canvas, and no longer snapshots an incompletely-loaded canvas over a good one.

= 1.3.2 =
* Add: SVG exports now convert text to vector outlines by default, so the design opens correctly (and stays centred) in any program without needing the original font installed. Shapes and clip art were already vectors; text is the last piece.
* Add: an extra "SVG + fonts" export button on the order screen produces an SVG that keeps the text editable, with the fonts embedded in the file.
* Add: a font proxy endpoint that serves the Google fonts used in a design as TTF, so the designer can outline/embed them in the browser.

= 1.3.1 =
* Fix: the admin React apps (template builder, design templates, clip art manager) did not load their scripts after the menu was renamed to "Product Designer", because the asset-enqueue check compared against a hardcoded page-hook string. The plugin now reads the actual hook names back from WordPress, so the builder loads regardless of the menu title.

= 1.3.0 =
* Add: SVG export now produces a real, editable vector (text as `<text>`, shapes and clip art as `<path>`) instead of a raster image wrapped in an SVG. The designer stores the browser-rendered `canvas.toSVG()` output alongside the existing high-res PNG. Designs saved before this update keep working: their SVG export uses a correctly-scaled raster fallback until the design is re-opened and re-saved once.
* Add: optional real-world physical size per view ("Real width (mm)" in the template builder). When set, SVG and PDF exports come out at true physical scale (real mm units) instead of the previous 96-DPI pixel assumption; the height follows the canvas aspect ratio so the export is never distorted. Leaving it empty keeps the previous behaviour.
* Fix: the raster-fallback SVG export now carries correct width/height/viewBox, so it opens at the design's real dimensions instead of collapsing to the 300×150 default SVG viewport.

= 1.2.1 =
* Change: the Plugin URI now points to the public source repository (https://github.com/temmink/snelgraveren-product-designer) instead of a placeholder URL.

= 1.2.0 =
* Change: renamed all globally-namespaced identifiers (constants, options, transients, the Freemius helper function/global, the cron hook, the `edit_pf_templates` capability, script/style handles, JS globals, and admin menu slugs) from the `pf`/`PF_`/`productforge` prefix to `sgpd`/`SGPD_`, per wp.org review feedback that `pf` is too short/generic. A one-time migration copies every existing `pf_*` option/transient to its `sgpd_*` name and clears the old cron schedule on upgrade — no settings are lost. DB tables, the `pf/v1` REST namespace, `pf-` CSS classes, the `pf-designer-root` DOM id, and the `pf_design_hash` cart/order-meta keys are intentionally unchanged (breaking to rename, not a real collision risk). The `[productforge]` shortcode keeps working; `[sgpd_designer]` is now available as an alias. See CLAUDE.md "Prefix Rename" for the full old → new mapping.
* Add: "External Services" section disclosing the optional Freemius licensing/analytics integration and what it shares if you opt in.
* Fix: cart design-hash attachment (`pf_design_hash`) now validates that the requester actually owns the design (matching customer/session id) before attaching it to the cart, instead of only checking the hash format — closes a gap where a guessed or leaked design hash could be attached to someone else's cart. A nonce is also checked as defense-in-depth (not authoritative, since LiteSpeed page-caching can serve a stale nonce to a legitimate customer).
* Fix: SQL prepare-statement hardening across `includes/Database/` — remaining unprepared queries are either wrapped in `$wpdb->prepare()` or documented with a `phpcs:ignore` where only internal table/column names (no user input) are interpolated.

= 1.1.0 =
* Change: plugin renamed to "Snelgraveren Product Designer for WooCommerce" (slug: `snelgraveren-product-designer`). The `[productforge]` shortcode, `pf/v1` REST namespace, `pf-` CSS classes, and `pf_*` option names are unchanged for backward compatibility with existing installs.
* Change: the Gutenberg block is now `snelgraveren/product-designer` (was `productforge/designer`).
* Fix: the public template REST endpoint no longer strips views, colors, pricing, permissions, or SVG zone boundaries for free-tier users — per wp.org guideline 5, the free plugin does not artificially limit functionality server-side.
* Fix: the public design-templates REST endpoints now only ever return published templates to non-admin requests, ignoring any client-supplied status filter.
* Fix: removed inline `<style>`/`<script>` blocks from admin-rendered HTML in favor of `wp_add_inline_style`/`wp_add_inline_script`.
* Fix: file uploads (customer uploads, clip art, fonts) now go through `wp_handle_upload()` instead of a raw `move_uploaded_file()` call.
* Fix: boolean settings now use `rest_sanitize_boolean` as their `sanitize_callback`.
* Fix: removed the manual `load_plugin_textdomain()` call — wp.org loads translations for hosted plugins automatically.
* Maintenance: translation files (`languages/`) are no longer bundled in the distributed ZIP; they remain in the plugin's Subversion/GitHub repository.

= 1.0.4 =
* Change: premium functionality (PDF/SVG export, auto-export, pricing engine, clip art / font / palette management) is no longer bundled in the free version — it now ships only with Pro.
* Change: removed the template and view count limits from the free version; Pro features are presented as upgrades instead.
* Maintenance: slimmed the plugin package (pruned unused PDF fonts, removed unused libraries).

= 1.0.3 =
* Maintenance: WordPress.org Plugin Check compliance — filesystem API usage, output escaping, i18n comments; cache files moved to uploads; removed obsolete update-guard.

= 1.0.2 =
* Maintenance: updated the Freemius SDK to 2.13.4.

= 1.0.1 =
* New: Gutenberg block `productforge/designer` for block themes and the Site Editor.
* New: Starter template gallery — 10 ready-made templates (engraving, print, and basic sets) importable in one click.
* New: WooCommerce is now declared as a required plugin, with a graceful notice instead of a fatal error when it is missing.
* Fix: zone overlays are no longer counted as billable elements in design surcharges.

= 1.0.0 =
* Initial release: drag-and-drop designer, template builder, design zones, engraving fonts, clip art, pricing rules, local PDF/PNG/SVG exports, production dashboard, design statistics, account page designs, guest design cleanup, and system health checks.
