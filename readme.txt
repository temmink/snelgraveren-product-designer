=== Snelgraveren Product Designer for WooCommerce ===
Contributors: snelgraveren
Tags: woocommerce, product designer, personalization, engraving, customizer
Requires at least: 6.4
Tested up to: 7.0
Requires PHP: 8.1
Stable tag: 1.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Let customers personalize WooCommerce products with text, images, and SVGs in a fast drag-and-drop designer — built for engraving and print shops.

== Description ==

ProductForge adds a modern, secure product designer to your WooCommerce store. Customers add text, photos, clip art, and SVG artwork onto your products, see a live price, and their design flows straight into your order and production workflow.

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
3. Open ProductForge → Templates and import a starter template, or build your own.
4. Edit a product, enable the designer, and pick a template.
5. Block theme? Place the "Snelgraveren Product Designer" block in your Single Product template or product description.

== Frequently Asked Questions ==

= Does it work with block themes? =

Yes. Classic themes render the designer automatically on the product page (or via the `[productforge]` shortcode). Block themes use the ProductForge Designer block in the Site Editor or product description.

= Where are the production files? =

Exports (PDF, PNG, SVG) are generated locally on your server — nothing is sent to external services. Download them per order or in bulk from the Production dashboard.

= What does the free version include? =

The free version includes the full designer with unlimited templates and PNG export. Pro unlocks multiple product views, PDF/SVG production export, automatic exports on order status, pricing rules, custom fonts, clip art management, color palettes, and more.

== Changelog ==

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
