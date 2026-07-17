=== ProductForge for WooCommerce ===
Contributors: martintemmink
Tags: woocommerce, product designer, personalization, engraving, customizer
Requires at least: 6.4
Tested up to: 7.0
Requires PHP: 8.1
Stable tag: 1.0.1
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
5. Block theme? Place the "ProductForge Designer" block in your Single Product template or product description.

== Frequently Asked Questions ==

= Does it work with block themes? =

Yes. Classic themes render the designer automatically on the product page (or via the `[productforge]` shortcode). Block themes use the ProductForge Designer block in the Site Editor or product description.

= Where are the production files? =

Exports (PDF, PNG, SVG) are generated locally on your server — nothing is sent to external services. Download them per order or in bulk from the Production dashboard.

= What does the free version include? =

The free version includes the full designer with one template. Pro unlocks unlimited templates, multiple product views, PDF/SVG export, automatic exports, pricing rules, custom fonts, clip art management, and more.

== Changelog ==

= 1.0.1 =
* New: Gutenberg block `productforge/designer` for block themes and the Site Editor.
* New: Starter template gallery — 10 ready-made templates (engraving, print, and basic sets) importable in one click.
* New: WooCommerce is now declared as a required plugin, with a graceful notice instead of a fatal error when it is missing.
* Fix: zone overlays are no longer counted as billable elements in design surcharges.

= 1.0.0 =
* Initial release: drag-and-drop designer, template builder, design zones, engraving fonts, clip art, pricing rules, local PDF/PNG/SVG exports, production dashboard, design statistics, account page designs, guest design cleanup, and system health checks.
