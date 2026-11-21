=== Snelgraveren Product Designer for WooCommerce ===
Contributors: snelgraveren
Tags: woocommerce, product designer, personalization, engraving, customizer
Requires at least: 6.4
Tested up to: 7.1
Requires PHP: 8.1
Stable tag: 1.13.1
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
* Layers panel: pick any element from a list, even where elements overlap on the canvas
* Product options inside the designer: size and colour are chosen there, sold-out combinations are marked, and the preview follows the chosen colour
* A text field for every text, and a check before ordering when an example text is still on the product
* One step to order: "Save & add to cart", with the design kept whenever the shop cannot accept the order yet
* Mobile-friendly modal designer

= Store owner tools =

* Ready-made starter templates: import one click from the built-in gallery
* Template builder with views, zones, layers, permissions, and pricing rules
* Production dashboard: all orders with designs, bulk ZIP export for a production run
* Automatic design exports (PDF, PNG, SVG, LightBurn .lbrn2) when an order reaches a chosen status
* Designs overview: every saved design in one list — hand a design you made over to a customer's account, or reopen it in the designer
* Font groups: named sets of fonts you assign per template; add a font to a group once and every template using it follows
* Design statistics: saved vs. ordered designs and conversion
* "My designs" tab on the customer account page
* Automatic cleanup of abandoned guest designs (configurable retention)
* System status checks with e-mail alerts when something needs attention

= Security first =

* All prices calculated server-side — client values are never trusted
* Every SVG sanitized, every upload MIME-validated
* Design links use unguessable random identifiers
* Rate-limited uploads

= Free vs Pro =

The free plugin is a complete, working product designer. Pro adds the tools that turn it into a full production and pricing workflow.

Free:

* Drag-and-drop designer (text, photos, SVG)
* Unlimited templates
* Ready-made starter templates
* PNG export
* Shortcode + Gutenberg block
* "My designs" in the customer account
* Mobile designer
* Server-side pricing and SVG sanitization

Pro adds:

* Multiple product views (front, back, …)
* Custom font uploads and font groups
* Clip art collections
* Pricing rules (surcharge per element or per tier)
* Per-element and per-zone permissions
* SVG-shape design zones and safe areas
* Product colors and color palettes
* PDF, SVG and native LightBurn (.lbrn2) production export — text stays editable in LightBurn
* Automatic export on order status
* Upload restrictions (vector-only engraving)
* LightBurn (.lbrn2) import of your own artwork as a template
* Download a design's production SVG or LightBurn file straight from the Designs list, order or not
* Send a design as a proof for customer approval

Learn more and compare plans on the product page linked from this listing.

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

= Is there a manual? =

Yes. The guide for shop owners (templates, zones, permissions, pricing, exports, settings) and the guide for customers (how the designer on the product page works) are on GitHub: https://github.com/temmink/snelgraveren-product-designer/tree/master/docs — and linked from Product Designer → Settings.

= Does it work with block themes? =

Yes. Classic themes render the designer automatically on the product page (or via the `[sgpd_designer]` shortcode). Block themes use the Snelgraveren Product Designer block in the Site Editor or product description.

= Where are the production files? =

Exports (PDF, PNG, SVG, LightBurn .lbrn2) are generated locally on your server — nothing is sent to external services. Download them per order or in bulk from the Production dashboard.

= Saving a design fails with "No route was found matching the URL and request method" =

That message comes from WordPress, not from the plugin: your web server's firewall (typically ModSecurity on cPanel hosting, with `SecRequestBodyNoFilesLimit` at 1 MB) refused the save before it reached the plugin and let WordPress answer a request it has no route for. It only happened for designs large enough to cross that limit, usually ones with a photo. Since 1.12.5 the designer sends the design's export files as file uploads, which fall under the server's much larger file limit, so update the plugin first. If a save is still refused, the designer now says so in plain words; ask your host to raise the request-body limits (`SecRequestBodyNoFilesLimit`, and PHP's `post_max_size` / `upload_max_filesize`) for your site.

= What does the free version include? =

The free version includes the full designer with unlimited templates and PNG export. Pro unlocks multiple product views, PDF/SVG/LightBurn production export, automatic exports on order status, pricing rules, custom fonts, clip art management, color palettes, and more.

== External Services ==

This plugin uses the Freemius SDK for license validation, plugin update delivery, and optional usage analytics.

**No data is sent anywhere before you act.** On activation, Freemius shows an opt-in screen with two choices:

* **"Skip"** — nothing is sent. The plugin works fully offline; only your Pro license key (if you have one) is validated against Freemius' servers when you activate a license.
* **"Allow & Continue"** — you opt in to license validation, update delivery, and anonymized usage analytics. Only then does the plugin share: your site URL, WordPress and PHP versions, the list of active plugins and theme, and the admin e-mail address, with Freemius (freemius.com), a licensing and analytics service used by many WordPress and WooCommerce plugins.

You can review or withdraw this consent at any time from the plugin's account/opt-in prompts. This service is used for licensing and update delivery — no customer, design, or order data is ever sent to Freemius.

Freemius Privacy Policy: https://freemius.com/privacy/
Freemius Terms of Service: https://freemius.com/terms/

No other external services are used. Design exports (PDF/PNG/SVG) are rendered entirely on your own server — nothing about your customers' designs, uploads, or orders is ever sent off-site.

== Screenshots ==

1. The customer-facing designer: a name on a bone-shaped dog tag shown in the chosen colour, with size and colour options, front and back, a text field, font and size controls, undo/redo, and a Save & add to cart button.
2. The template builder: imported vector artwork and text zones on a canvas, with a layer tree, per-zone permissions, pricing rules and LightBurn import.
3. Starter templates gallery: import a ready-made engrave, print or basic template with one click.
4. Production dashboard: every order with a design, filtered by status and period, ready to download as one ZIP.

== Upgrade Notice ==

= 1.13.1 =
Fixes the scale of a product side without its own width in the LightBurn and PDF exports, font names LightBurn could not find, and names every export file after order, side and product.

= 1.13.0 =
Smaller designer script; the Pro vector exports now load only on Pro sites. Production exports now show the product's outline as a non-engraving reference (LightBurn: tool layer T1) — open and save each template once.

= 1.12.9 =
Fixes clip art that was shown and exported cut off, and places new clip art inside shaped engraving areas.

= 1.12.8 =
Fixes Undo in the customer designer, makes a newly added text readable on phones and places it clear of existing text, and restores the Dutch translation.

= 1.12.7 =
Updates the bundled Freemius SDK to 2.13.5, which includes security hardening of its admin notices and opt-in screen. Recommended for every site.

= 1.12.6 =
Fixes three database tables never being created on MySQL hosting (System status: "Missing tables"), which left the plugin unusable there. Update and the tables are repaired automatically.

= 1.12.5 =
Fixes design saves failing with "No route was found matching the URL and request method" on cPanel/ModSecurity hosting — any design with a photo. Recommended for every site.

= 1.12.4 =
Fixes the second, dead "Customize Product" button on phones for products in modal display mode.

== Changelog ==

= 1.13.1 =
* Fix: a product side without its own "Real width (mm)" (the back of the dog tags) uses the width of another side in the designer, but the exports used the 96-DPI pixel size for it. In LightBurn the reference outline of that side came out about 209 mm wide around text laid out at 38 mm, and the PDF page of that side had the wrong size too. The exports now use the same width as the designer, also for orders placed before this update. The template builder no longer says such a side is exported at the 96-DPI size.
* Fix: a Google font stored as "BebasNeue" (instead of "Bebas Neue") reached LightBurn and the "SVG + fonts" file under that name, so LightBurn reported it could not find the font. Exports now use the font's real name; fonts you uploaded yourself keep their name.
* Change: export files are named after the order, the product side and the product — for example 2571_voorkant_dog-tags.lbrn2 — and a multi-side download after the order and product (2571_dog-tags-lbrn.zip). Exports made without an order (Designs page) use the start of the design ID instead of the order number.

= 1.13.0 =
* Change: the Pro production exports (vector SVG and LightBurn) moved into their own script, which only Pro sites load. The free designer script is about a quarter smaller and free sites no longer prepare export files they cannot use.
* Fix: on a product with a shaped (SVG) engraving boundary, a template's own text/artwork could be dragged outside the shape by the customer when the design's layers sat in the whole-canvas holding zone rather than in the boundary zone. Elements now follow the real design/boundary zone wherever they physically live, so they stay inside the shape. Existing templates and already-saved designs benefit without re-saving; a too-wide element is also kept on the canvas instead of sliding off.
* New: every production export of an order (PNG, PDF, SVG, SVG + fonts, LightBurn) now carries the template's engraving-area outline as a reference, so the design can be lined up with the real product. In LightBurn it sits on tool layer T1, which is never sent to the laser; in SVG it is a separate group "referentie"; in PNG and PDF a thin blue line. Because the outline comes from the template, orders placed before this update get it too — open and save each template once in the template builder; until then the order screen says so.
* Fix: the PNG, SVG, LightBurn and "SVG + fonts" export buttons all downloaded a ZIP with the same name, so it was easy to open the wrong format. The download name now says which format it is, and the two SVG variants are kept as separate files instead of overwriting each other.
* Improvement: in the template builder you can now add or move your own template layers into any zone — including an empty holding/boundary zone — without first ticking an element type. "Allowed element types" now only governs what customers may add, and the field explains this. The template builder also shows an always-visible lock-status dot per layer (red locked, amber locked-by-default, green open to the customer).

= 1.12.9 =
* Fix: clip art made as an SVG without its own width and height (a viewBox only, as most design tools export it) was drawn cut off — only part of the artwork showed, at every scale, and the cut-off version also reached the cart picture and the production PNG. SVG artwork is now always drawn whole, also in designs saved before this update.
* Fix: on a product with a shaped engraving area (for example the curved olive-wood boards) new clip art was placed on the middle of the area's bounding box, where the shape can be narrow, so most of it fell outside the engravable area. It is now placed, at the largest size that fits, where the shape has room.
* Fix: the "scaled beyond its resolution" warning appeared for vector clip art, which stays sharp at any size.

= 1.12.8 =
* Fix: Undo in the customer designer did nothing — clicking it after adding an element left the element in place. One click now removes the last change and Redo brings it back; Undo stops at the template's own starting state.
* Fix: on phones the selection handles were larger than a line of text and covered it completely. They are now small outlined corner handles placed outside the element, with the same finger-sized touch area.
* Fix: on a product with options (size, colour) the design was lost when the customer pressed "Save & add to cart" before choosing them — WooCommerce refused the request and the page reloaded with an empty designer. The designer now asks for the options first, says so when the chosen combination is out of stock, and keeps the design; and when WooCommerce refuses for another reason (for example out of stock) the design is handed back instead of discarded.
* Fix: reopening a design from the cart lost the chosen product options (size, colour), and saving it again added a second cart line instead of updating the first. The link from the cart now carries the options, and a design is one cart line: saving it again replaces the line it came from.
* Fix: Undo and Redo closed the designer in the full-screen (modal) view, which is the view every phone uses, instead of undoing.
* Fix: circular curved text collapsed into overlapping letters as soon as "Curve intensity" was touched, and could freeze the tab. Curved text now also follows changes to the text, font, size and letter spacing.
* Fix: a design that had already been ordered could be reopened, changed and saved over itself, so two orders shared one design and the first order's production files were replaced. An ordered design can no longer be changed; reopening one and saving creates a new design with its own preview and production files.
* Fix: a template that is Draft or Archived could still be chosen for a product, after which customers saw "Template not found." Only published templates are offered now, a product still pointing at an unpublished template says so in its settings, and the product page shows no designer instead of an error.
* Fix: with LiteSpeed Cache, a change saved in a template (for example switching a tool off) could stay invisible to customers until the cache expired. The plugin's REST responses are now marked as not cacheable.
* Fix: a text layer locked with the padlock could not be changed by the customer at all, although the padlock only promises that it cannot be moved. A locked text now stays in its place but its text, font, size and colour can be edited.
* Fix: a newly added text was placed on top of a text the template already had in the middle of the zone. It now lands in the nearest free spot.
* Fix: a newly added text was always black, even when the template's palette did not contain black. It now starts in the first allowed colour.
* Fix: the Dutch translation was not loaded, so the designer and the admin screens were English on Dutch sites. The translation is complete again and is used by both the PHP screens and the designer.
* New: product options in the designer. For a product with options (size, colour) the customer chooses them inside the designer; they are WooCommerce's own options, kept in step with the product page. Options that are sold out in the chosen combination are marked and cannot be picked.
* New: the preview follows the chosen colour. Settings → Colour names holds one shop-wide list of colour names and their tints (pre-filled with common Dutch and English names); the designer shows the product in the tint of the colour option the customer picked, and the separate "Product colour" swatches are hidden for such products.
* New: a check before ordering. When an example text from the template ("First name", "Phone number") is still on the product, the designer says so and offers to change it, leave it out, or order as it is. Works in every language: examples are recognised by a marker, not by their wording.
* Tweak: the canvas now fits the height of the window, taking the toolbar and ruler above it into account, so a tall or square design is visible in full on a small laptop screen; on phones it leaves room for the options underneath.
* Fix: a newly added text started in Arial even when the template does not allow that font, and the font list could show a different font than the text was set in.
* New: a text field in the sidebar. A text can now be typed there instead of only on the canvas, and a template's example text is replaced by the first key the customer types.
* New: the designer opens on "Add" with two main choices, "Add text" and "Add image" (one upload button for photos and SVG). Curved and engraving text moved under "More kinds of text", with a hint that they are placed by clicking on the product.
* New: the sides of a product (front/back) are always visible above the tools instead of in a tab, and the stock names Front/Back are translated.
* New: on phones the product stays in view while the options scroll, and the order button stays at the bottom of the screen. The empty space under the canvas is gone.
* New: a "Customize Product" button stays at the bottom of the screen while the designer is scrolled out of sight. Developers can switch it off with the `sgpd_sticky_start_button` filter.
* New: changes made in the sidebar (font, size, colour, filters) can be undone.
* Tweak: the edit panel shows text, font, size and colour first; style, text alignment and position on the product are under "More options", with readable icons.
* Tweak: ordering through the product page's own form (Enter in the quantity field) now goes through the same save and the same checks as the designer's button.
* New: links to the guide for shop owners and the guide for customers on the Settings page and in the plugin list.
* Tweak: sidebar tabs size to their label so translated labels are no longer cut off; the element heading reads "Text", "Photo" or "Clip art" instead of an internal type name.

= 1.12.7 =
* Security: the bundled Freemius SDK is updated from 2.13.4 to 2.13.5 (stricter input handling and output escaping in its admin notices and opt-in flow, plus pricing-page and add-on listing fixes).

= 1.12.6 =
* Fix: on MySQL hosting (MariaDB was unaffected) the tables for templates, template views and design views were never created, so System status reported "Missing tables" and deactivating/re-activating did not help. The table definitions are now MySQL-compatible, and updating — or deactivating and re-activating — repairs an existing install automatically. If a table still cannot be created, System status now shows the database's own error message.

= 1.12.5 =
* Fix: saving a design with a photo failed on some hosts with "No route was found matching the URL and request method". Hosting firewalls (ModSecurity on cPanel) refuse requests whose non-file body exceeds 1 MB, and the save sent the full-resolution export as one JSON payload. Every export is now sent as a file part, which falls under the far larger file limit; older cached bundles keep working.
* Improved: when a server still refuses a save or upload before it reaches the plugin, the designer now explains that the design is too large for the server's limits instead of showing WordPress' "no route" message. A save whose payload was dropped entirely by PHP is refused instead of overwriting the design with an empty canvas.

= 1.12.4 =
* Fix: on a phone, a product set to the modal display mode showed two "Customize Product" buttons under each other, and the lower one did nothing. There is now one button, and it opens the designer.
* Fix: the free build no longer requests a live price preview on every canvas change — that endpoint only exists in Pro, so each change produced a needless 404 in the server log.

= 1.12.3 =
* Fix: the LightBurn import (Pro) skipped every Rect and Ellipse shape as "unreadable" — LightBurn stores those without a vertex list, only their size. They now import as outlines, so a 200 mm slate drawn as a rectangle sets the true design size.
* New: "PT Serif Caption" added to the built-in Google Fonts, so LightBurn text set in it imports as editable text instead of an outline.

= 1.12.2 =
* New: a Layers tab in the designer sidebar listing every selectable element, topmost first. Where elements overlap on the canvas, a click can land on the wrong one — the list selects exactly the element you mean, and selecting from the list keeps you on the Layers tab.

= 1.12.1 =
* New: download a design straight from the Designs admin page as a production SVG or native LightBurn file (Pro) — draft or not, no order needed. A design saved before 1.11.0 has no LightBurn data yet; the row explains to reopen and re-save it once.
* Improved: on the Designs admin page, clicking a design's product name (or thumbnail) now opens the design itself in the designer, in a new tab. The WooCommerce product edit screen stays reachable via a small "edit product" link.

= 1.12.0 =
* New: font groups — create named sets of fonts on the new Product Designer → Fonts admin page and enable whole groups per template in the builder. Adding a font to a group later automatically makes it available in every template using that group, including existing ones.
* Fixed: uninstall now removes the clip art items table when "delete data on uninstall" is enabled.

= 1.11.4 =
* Improved: clip art in the designer is now chosen from a large-preview panel that opens when the customer clicks a category, instead of tiny thumbnails in the sidebar.

= 1.11.3 =
* Improved: the clip art upload size limit was raised from 512 KB to 3 MB per SVG file.

= 1.11.2 =
* New: a "Delete design" action on the Designs page — permanently removes a design together with its thumbnails and export files, after confirmation. Designs that belong to an order are protected and cannot be deleted. The automatic guest-draft cleanup (Settings → guest design retention) is unchanged and remains deliberately more conservative.

= 1.11.1 =
* Improved: the Production dashboard's bulk ZIP now contains every available export format per design (PNG, PDF, SVG and LightBurn) instead of only the configured default. Formats that cannot be generated are listed in a LEESMIJ file inside the ZIP rather than failing the download.

= 1.11.0 =
* Fixed: the SVG export of designs with curved text silently fell back to a bitmap — Fabric.js emits malformed XML for rotated styled characters, which the sanitizer rejected without a trace. The markup is now repaired and validated before saving, and rejections are logged.
* Fixed: zone overlays, clip paths and the invisible baseline curves of curved text no longer leak into the SVG exports.
* Improved: the "SVG" export now outlines every glyph at the exact position and rotation of the approved design (kerning and letter spacing included) and carries real millimetre dimensions.
* Improved: the "SVG + fonts" export writes curved text as a standard textPath over its own curve, so it imports correctly into LightBurn while staying editable.
* New (Pro): native LightBurn export (.lbrn2) — text as editable LightBurn Text shapes with the bend calibrated against LightBurn's own rendering, vector art as Path shapes in millimetres.

= 1.10.0 =
* New (Pro): send a design to a customer as a proof for approval instead of handing over the full editor. The customer gets an e-mailed link to a read-only page showing exactly what was saved — no login needed — with a button to approve and go straight to checkout, or to request a change with a short note. Approving adds the design to their cart automatically.
* New (Pro): Product Designer → Designs shows the status of every proof you have sent, and lets you resend it after making changes or withdraw it to make the link stop working.
* New (Pro): you are notified by e-mail when a customer approves a proof or asks for a change, and the customer is notified when you send or resend one.

= Earlier versions =
* The full history back to 1.0.0 is in the readme.txt history on GitHub: https://github.com/temmink/snelgraveren-product-designer
