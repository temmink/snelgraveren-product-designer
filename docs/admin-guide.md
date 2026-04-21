# ProductForge for WooCommerce — Administrator Guide

> This comprehensive guide is for **shop administrators** who configure ProductForge templates, manage the design system, and handle orders with customized products.

---

## Table of Contents

1. [Overview](#overview)
2. [Installation & Requirements](#installation--requirements)
3. [Architecture Overview](#architecture-overview)
4. [Template Management](#template-management)
   - [Creating a Template](#creating-a-template)
   - [Template Status Workflow](#template-status-workflow)
   - [Duplicating Templates](#duplicating-templates)
5. [The Template Builder](#the-template-builder)
   - [Views](#views)
   - [The Canvas](#the-canvas)
   - [Zones](#zones)
   - [Layers](#layers)
   - [The Tree Panel](#the-tree-panel)
6. [Zone Configuration In-Depth](#zone-configuration-in-depth)
   - [Zone Types](#zone-types)
   - [Boundary Types](#boundary-types)
   - [Zone Behavior](#zone-behavior)
   - [Allowed Element Types](#allowed-element-types)
   - [SVG Boundaries](#svg-boundaries)
   - [Default Fonts per Zone](#default-fonts-per-zone)
7. [Permissions](#permissions)
8. [Pricing](#pricing)
   - [Per-Element Pricing](#per-element-pricing)
   - [Tier Pricing](#tier-pricing)
   - [Surcharge Caps](#surcharge-caps)
   - [How Pricing Works at Checkout](#how-pricing-works-at-checkout)
9. [Global Settings](#global-settings)
   - [Cart Behavior](#cart-behavior)
   - [Product Color](#product-color)
   - [Colorpicker Product](#colorpicker-product)
   - [Colorpicker Elements](#colorpicker-elements)
   - [Color Palettes](#color-palettes)
   - [Font Picker](#font-picker)
   - [Custom Fonts](#custom-fonts)
   - [Clip Art Library](#clip-art-library)
   - [Image Upload Restrictions](#image-upload-restrictions)
10. [Design Templates](#design-templates)
    - [Templates vs Design Templates](#templates-vs-design-templates)
    - [Managing Design Templates](#managing-design-templates)
    - [Import & Export](#import--export)
11. [Assigning Templates to Products](#assigning-templates-to-products)
12. [Display Modes](#display-modes)
13. [The Frontend Designer](#the-frontend-designer)
    - [How Customers Use the Designer](#how-customers-use-the-designer)
    - [Auto-Save Before Cart](#auto-save-before-cart)
    - [Mobile Behavior](#mobile-behavior)
14. [WooCommerce Integration](#woocommerce-integration)
    - [Cart Integration](#cart-integration)
    - [Order Processing](#order-processing)
    - [Design Surcharges](#design-surcharges)
15. [Export System](#export-system)
    - [PDF Export](#pdf-export)
    - [PNG Export](#png-export)
    - [SVG Export](#svg-export)
    - [Auto-Export on Order Status](#auto-export-on-order-status)
    - [Managing Exports](#managing-exports)
16. [Database Reference](#database-reference)
17. [REST API Reference](#rest-api-reference)
18. [Security](#security)
19. [File Storage](#file-storage)
20. [Development & Build](#development--build)
21. [Troubleshooting](#troubleshooting)

---

## Overview

ProductForge is a WooCommerce plugin that adds a drag-and-drop product designer to your store. Customers can personalize products with text, images, and SVG graphics within zones that you define. The plugin handles the full lifecycle: template design, frontend customization, cart/order integration, and production-ready exports.

**Key capabilities:**
- Multi-view templates (e.g. front and back of a product)
- Zone-based design areas with boundary enforcement
- Pre-placed design layers (text, image, SVG)
- Customizable permissions per element type
- Flexible pricing (per-element or tiered)
- Color picker with palette support
- Font picker with Google Fonts and custom font upload
- Clip art library with admin-managed SVG collections
- SVG boundary shapes with optional customer-editable fill color
- Production exports: PDF (TCPDF), PNG (Imagick), SVG
- Full WooCommerce integration (cart thumbnails, surcharges, order meta, HPOS compatible)

---

## Installation & Requirements

### Server Requirements
- PHP 8.1 or higher
- WordPress 6.4 or higher
- WooCommerce 8.0 or higher
- PHP extensions: `finfo` (for MIME detection), `gd` or `imagick` (for PNG export)
- Composer dependency: `enshrined/svg-sanitize` (included in the plugin)

### Installation

1. Upload the `productforge` folder to `wp-content/plugins/`.
2. Activate the plugin in **Plugins → Installed Plugins**.
3. The plugin automatically:
   - Creates the required database tables (11 tables).
   - Registers the `edit_pf_templates` capability.
   - Adds a **ProductForge** menu item to the WordPress admin sidebar.

### HPOS Compatibility
ProductForge declares compatibility with WooCommerce High-Performance Order Storage (HPOS). It works with both the legacy `wp_posts`-based order storage and the new `wp_wc_orders` table.

---

## Architecture Overview

ProductForge uses a **pure custom database** approach — no Custom Post Types. All data is stored in `wp_pf_*` tables for performance, schema control, and clean separation from WordPress content.

| Component | Technology |
|-----------|-----------|
| Admin Template Builder | React 18 + Zustand + Fabric.js 6.x |
| Admin Design Templates | React 18 + Zustand (separate Vite entry) |
| Admin Clipart Manager | React 18 + Zustand (separate Vite entry) |
| Frontend Designer | React 18 + Zustand + Fabric.js 6.x |
| Build System | Vite (single config, four entry points) |
| Canvas Engine | Fabric.js 6.x |
| State Management | Zustand (both admin and frontend) |
| PHP Autoloading | PSR-4 (`ProductForge\` namespace) |
| Database | Custom tables with InnoDB, foreign keys, prepared statements — 11 tables |
| Licensing | Freemius SDK (premium feature gates via `ProductForge::has_feature()`) |
| Export Pipeline | Browser-rendered source (SVG or PNG data URL) stored per view; server assembles PDF via TCPDF and rasterizes SVG via `rsvg-convert`/Imagick when needed |

### Plugin File Structure

```
ProductDesigner/
├── productforge.php              # Main plugin file
├── includes/
│   ├── class-product-forge.php   # Core plugin class
│   ├── Admin/                    # Admin pages, product settings
│   ├── API/                      # REST API controllers
│   ├── Database/                 # Repositories, migrations, DB manager
│   ├── Export/                   # PDF, PNG, SVG exporters
│   ├── Frontend/                 # Shortcode, cart, order integration
│   ├── Pricing/                  # Price calculator, cart surcharge
│   └── Security/                 # Validators (upload, SVG, font, clipart)
├── admin/js/template-builder/    # Admin template builder React app (Vite)
├── admin/js/design-templates/    # Design templates CRUD React app (Vite)
├── admin/js/clipart/             # Clipart manager React app (Vite)
├── frontend/js/designer/         # Frontend designer React app (Vite)
├── languages/                    # Translation files (.pot, .po, .mo, .json)
└── dist/                         # Built assets (generated by npm run build)
```

---

## Template Management

### Creating a Template

1. Navigate to **ProductForge → Templates** in the WordPress admin.
2. Click **New Template** (or **Nieuw Toevoegen**).
3. Enter a template title.
4. The template builder opens with a blank canvas and one default view.

### Template Status Workflow

| Status | Meaning |
|--------|---------|
| **Draft** | Template is being designed. Not available to customers. |
| **Published** | Template is live. Can be assigned to products. Customers can use it. |
| **Archived** | Template is hidden but preserved. Cannot be assigned to new products. |
| **Trashed** | Marked for deletion. Can be restored or permanently deleted. |

Only **Published** templates appear in the product settings dropdown and are accessible via the public API.

### Duplicating Templates

From the template list, hover over a template and click **Duplicate**. This creates a copy with all views, zones, layers, and settings — with "(Copy)" appended to the title and status set to Draft.

---

## The Template Builder

The template builder is a single-page React application that loads when you edit a template. It consists of:

- **Header bar**: Template title, status dropdown, save button.
- **View tabs**: Switch between product views (e.g. Front, Back).
- **Canvas area**: Visual editor with the product design surface.
- **Sidebar panel**: Four tabs — Structure, Permissions, Pricing, Settings.

### Views

Views represent different sides or angles of a product. A dog tag might have a Front and Back view. A coaster might have just one view.

**Managing views:**
- **Add view**: Click "+ Add View" to create a new view tab.
- **Rename view**: Double-click the view tab name to edit it.
- **Reorder views**: Drag view tabs to rearrange them.
- **Delete view**: Click the × button on a view tab. The view is marked for deletion and removed when you save.

**View settings** (configured per view in the canvas/structure panel):
- **Canvas width** and **height** (pixels) — defines the design surface dimensions.
- **Background color** — fill color behind the design.
- **Background image** — upload from the WordPress Media Library. Supports transform (scale, position).

### The Canvas

The canvas is a Fabric.js editor where you visually design the product template. It shows:

- The background image/color.
- Zone overlays (outlined areas showing where customers can place elements).
- Pre-placed layers (text, images, SVGs that you add as starting points).

**Canvas toolbar:**
- **Free Move** toggle — when enabled, bypasses all zone enforcement so you can position elements freely. Disable it to test how zone clamping will work for customers.
- **Set Background** — opens the WordPress Media Library to select a background image.
- **Undo / Redo** — 50-step history per view (also accessible via Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z).
- **Alignment buttons** — align the selected element within its zone (left, center, right, top, middle, bottom).

### Zones

Zones are the core concept of ProductForge. They define **where** customers can place design elements and **what rules** apply.

Every element a customer places must belong to a zone. Zones control:
- Which element types are allowed (text, image, SVG).
- How elements are constrained (restricted to boundaries or visually clipped).
- The visual shape of the design area (rectangle or custom SVG shape).

See [Zone Configuration In-Depth](#zone-configuration-in-depth) for full details.

### Layers

Layers are pre-placed design elements inside zones. They appear on the canvas when the customer opens the designer — for example, a default text saying "Your Name Here" or a decorative SVG element.

**Layer types:**
- **Text** — an IText element with configurable content, font, size, and color.
- **Image** — a raster image selected from the WordPress Media Library.
- **SVG** — a vector graphic selected from the WordPress Media Library.

**Layer properties:**
- Name (display label in the tree panel)
- Position (X, Y coordinates on the canvas)
- For text: content, font family, font size, fill color
- For image/SVG: source URL, scaleX, scaleY, rotation angle
- Locked (prevents customer from moving/resizing)
- Visible (can be hidden from customers)

### The Tree Panel

The tree panel (Structure tab) shows a hierarchical view of the current view's structure:

```
▢ Zone: Front Print Area
  ├── T Text: Your Name
  └── 🖼 Image: Logo
▢ Zone: Bottom Text Area
  └── T Text: Phone Number
```

**Features:**
- Click a zone or layer to expand and edit its properties.
- **Drag-and-drop** reordering: reorder layers within a zone, move layers between zones (validates allowed types), or reorder zones themselves.
- **Toggle visibility** (eye icon) — hide a zone or layer from the customer.
- **Toggle lock** (lock icon) — prevent a zone or layer from being modified by the customer.
- **Add layer** — click the + button on a zone to add a new layer (text, image, or SVG).
- **Delete** — remove a zone or layer.
- **Add Boundary** — add a new zone to the current view.

---

## Zone Configuration In-Depth

### Zone Types

| Type | Purpose |
|------|---------|
| **Safe Area** | A standard design zone where customers can place elements. |
| **Upload Zone** | A zone specifically designed for image uploads, with optional SVG mask for shaped uploads. |

### Boundary Types

| Type | Description |
|------|-------------|
| **Rectangle** | A simple rectangular zone defined by x, y, width, and height. Minimum width and height of 1px. |
| **SVG Shape** | A custom shape (e.g. circle, heart, dog tag outline) loaded from an SVG file via the WordPress Media Library. The bounding box is auto-computed from the SVG path data. |

### Zone Behavior

| Behavior | Description |
|----------|-------------|
| **Restrict** | Elements are clamped to the zone boundary — they cannot be moved or scaled outside the zone. Both movement and scaling are enforced in real-time. |
| **Clip** | Elements are visually clipped at the zone boundary — parts outside the zone are hidden but the element can extend beyond. |

Both behaviors are enforced in both the admin canvas (unless Free Move is on) and the frontend designer.

### Allowed Element Types

Each zone specifies which element types are permitted via checkboxes:
- **Text** — IText elements
- **Image** — raster images (JPG, PNG, WEBP)
- **SVG** — vector graphics

A zone that allows only text will not accept image or SVG elements. The frontend designer hides the corresponding "Add" buttons if no zone on the current view allows that type.

### SVG Boundaries

When a zone uses an SVG boundary:

| Setting | Description |
|---------|-------------|
| **SVG URL** | The SVG file from the Media Library that defines the zone shape. |
| **Scale** | A multiplier applied to the SVG's intrinsic dimensions (default: 1). |
| **Rotation** | Rotate the SVG shape 0–360 degrees. |
| **Fill Color** | The color of the SVG shape as seen on the canvas. |
| **Customer can change fill color** | When checked, a color swatch appears in the frontend Element tab under "Product Color", allowing the customer to change the zone's fill color. |

This is particularly useful for products like dog tags or keychains where the product shape itself is part of the design. The SVG zone visually represents the product and can optionally let customers pick the product color (e.g. silver, gold, black).

### Default Fonts per Zone

When a zone allows text elements, you can set a **Default Font** for that zone. When a customer adds a text element to this zone, it will use this font by default. The dropdown shows all globally allowed fonts (or all available fonts if no specific fonts are configured in Settings).

---

## Permissions

The **Permissions** tab in the template builder controls what customers can do with each element type. These are global settings that apply to all zones within the template.

### Per-Element-Type Permissions

For **Text**, **Image**, and **SVG** independently:

| Permission | Default | Description |
|-----------|---------|-------------|
| **Resize** | On | Allow customer to resize the element using corner handles. When off, the element is shown at its original/placed size. |
| **Rotate** | On | Allow customer to rotate the element using the rotation handle. |
| **Delete** | On | Allow customer to remove the element from the canvas. |
| **Recolor** | On (text, SVG) | Allow customer to change the text color or apply a tint to SVGs. |
| **Change Font** | On (text only) | Allow customer to change the font family. |
| **Snap to Grid** | Off | When enabled, elements snap to a grid when moved. |
| **Grid Size** | 10 px | The grid cell size in pixels (only visible when snap is on). |
| **Min Scale** | 0.1 | Minimum scale factor (prevents making elements too small). |
| **Max Scale** | 10 | Maximum scale factor (prevents making elements too large). |

### Important Notes

- These permissions apply to **customer-placed** elements. Pre-placed layers that are locked cannot be modified regardless of permissions.
- Permissions are template-wide. You cannot set different permissions for different zones (but you can control which element types are allowed per zone).
- The `max_chars` setting (maximum characters for text) is enforced in the canvas code but is not currently exposed in the permissions UI. It defaults to 0 (unlimited).

---

## Pricing

The **Pricing** tab lets you configure how design surcharges are calculated. Surcharges are added to the product's base price when a customer adds a customized product to their cart.

### Per-Element Pricing

In `per_element` mode, each element type has a flat price:

| Field | Description |
|-------|-------------|
| **Text price** | Surcharge per text element in the design. |
| **Image price** | Surcharge per uploaded image element. |
| **SVG price** | Surcharge per SVG element (including clip art). |
| **Extra layer price** | Additional surcharge field (available in the UI). |

**Example:** If text price is €1.00 and a customer adds 3 text elements, the surcharge is €3.00.

### Tier Pricing

In `tier` mode, surcharges are based on the total number of elements across all views:

| Field | Description |
|-------|-------------|
| **Min** | Minimum element count for this tier (inclusive). |
| **Max** | Maximum element count for this tier (inclusive). |
| **Surcharge** | Flat surcharge amount for this tier. |

**Example tiers:**
| Min | Max | Surcharge |
|-----|-----|-----------|
| 1 | 3 | €2.00 |
| 4 | 6 | €4.00 |
| 7 | 999 | €6.00 |

A customer with 5 elements would pay a €4.00 surcharge.

### Surcharge Caps

Both pricing modes support:

| Field | Description |
|-------|-------------|
| **Minimum surcharge** | If the calculated surcharge is greater than zero but less than this value, it is raised to the minimum. Leave at 0 to disable. |
| **Maximum cap** | The surcharge will never exceed this value. Leave blank for no cap. |

### How Pricing Works at Checkout

1. When a customized product is added to the cart, the system loads the design's canvas JSON.
2. `PriceCalculator` counts the elements by type across all views.
3. The surcharge is calculated based on the template's pricing mode.
4. The surcharge is added to the product's price via `woocommerce_before_calculate_totals`.
5. A price audit log is created in `wp_pf_price_log` for each element.
6. The surcharge is displayed in the cart as "Design surcharge: €X.XX".

**Critical:** Prices are always calculated server-side. The client never sends price values — they are derived from the canvas JSON stored on the server. This prevents price manipulation.

---

## Global Settings

The **Settings** tab contains template-wide configuration options organized into fieldsets.

### Cart Behavior

| Setting | Description |
|---------|-------------|
| **Require customization before adding to cart** | When enabled, the customer must save a design before the Add to Cart button works. An error message is shown if they try to add to cart without a design. |

This is useful for products where customization is mandatory (e.g. personalized name tags).

### Product Color

| Setting | Description |
|---------|-------------|
| **Solid color product** | Enable for products where all views share the same material color (e.g. a dog tag where front and back are the same metal). When enabled, changing the color on one view automatically updates all other views. This applies to SVG zone fills that have "Customer can change fill color" enabled. |

### Colorpicker Product

Controls how customers choose the product background/fill color (SVG zone fills). This is the color applied to the product surface itself (e.g. gold, silver, black for a dog tag).

| Setting | Description |
|---------|-------------|
| **Enable product color picker** | Master toggle for the product color picker. When enabled, a "Product Color" section appears in the frontend Element tab for zones with "Customer can change fill color" enabled. |
| **Color mode** | How colors are presented to the customer (see below). |

**Color modes:**

| Mode | Description |
|------|-------------|
| **All colors (full picker)** | Customer gets a full RGB/HSL color picker — any color is allowed. |
| **Use a color palette** | Customer chooses from a predefined palette. Select a palette from the dropdown. Colors are shown as swatches. |
| **Individual colors** | Admin manually adds specific hex colors. Only these exact colors are available to the customer. |

The product color palette is also used in the **Zone Configuration** fill color picker. When a product color palette is configured, the admin zone fill color field shows the same swatches instead of the full color picker.

### Colorpicker Elements

Controls how customers choose colors for text elements and SVG tint colors. This is independent from the product color picker.

| Setting | Description |
|---------|-------------|
| **Enable element color picker** | Master toggle for element colors. When disabled, customers cannot change text color or SVG tint. |
| **Color mode** | How element colors are presented to the customer (same modes as product color picker: all colors, palette, or individual). |

**Note:** Both color pickers can use different palettes or modes. For example, you might offer a limited set of product colors (gold, silver, black) but allow any color for text elements.

### Color Palettes

Palettes are reusable sets of colors that can be shared across templates.

**Managing palettes** (click "Manage Palettes" in either color picker section):
- **Create palette**: Enter a name, add colors using the color picker, click Create.
- **Edit palette**: Click a palette to expand it. Add or remove individual colors. Rename the palette.
- **Delete palette**: Remove a palette (does not affect templates already using it — they retain the colors that were resolved at save time).

Palettes are stored as a WordPress option (`pf_color_palettes`) and accessed via the REST API.

### Font Picker

Controls which fonts are available to customers.

| Setting | Description |
|---------|-------------|
| **Enable font picker** | Master toggle. When off, customers cannot change fonts. |
| **Allowed fonts** | The specific fonts available to customers. Add fonts from the dropdown; remove them by clicking ×. |

**Available font sources:**

| Source | Count | Examples |
|--------|-------|---------|
| **Web-safe fonts** | 11 | Arial, Verdana, Helvetica, Times New Roman, Georgia, Courier New, etc. |
| **Google Fonts** | 31 | Roboto, Open Sans, Lato, Montserrat, Poppins, Dancing Script, Pacifico, etc. |
| **Custom uploaded fonts** | Variable | Any .woff2, .woff, or .ttf file you upload |

Google Fonts are loaded on-demand — only the fonts you add to the allowed list are loaded for customers.

**If no fonts are selected** (the allowed list is empty), a warning is shown. If fonts_enabled is true but no fonts are configured, the font dropdown will not appear for customers.

### Custom Fonts

Upload your own font files for use in the designer.

**Uploading a custom font:**
1. In the Font Picker section, find the **Upload Custom Font** area.
2. Click **Choose File** and select a `.woff2`, `.woff`, or `.ttf` file.
3. The font family name is auto-derived from the filename (weight suffixes like "Regular", "Bold" are stripped).
4. You can edit the family name before uploading.
5. Click upload. The font appears in the **Uploaded Fonts** list and in the font dropdown.

**Multiple files per family:** You can upload separate files for regular and bold weights of the same family. Upload them one at a time — they will be grouped under the same family name.

**Custom fonts in exports:**
- **SVG export**: Custom fonts are embedded as base64 `@font-face` within `<defs>`.
- **PDF export**: Custom fonts are registered with TCPDF for embedding.
- **PNG export**: Custom fonts are loaded for rendering.

**Deleting a custom font:** Click the × button next to the font family in the Uploaded Fonts list. This deletes all files for that family and removes the font from the system.

**Reserved names:** You cannot use a family name that matches any of the 42 built-in fonts.

### Clip Art Library

The clip art library lets you create collections of SVG graphics that customers can browse and add to their designs with a single click — no file upload needed.

**Enabling clip art:**

| Setting | Description |
|---------|-------------|
| **Enable clip art library** | Master toggle. When enabled, a "Clip Art" section appears in the frontend Add tab. |
| **Allow recoloring clip art** | When enabled, customers can apply a tint color to placed clip art. When disabled, clip art items cannot be recolored. |
| **Available collections** | Checkboxes to select which collections are available for this template. Unchecking all means all collections are available. |

**Managing collections** (click "Manage Collections"):

The Collection Manager is an inline panel in the Settings tab.

**Creating a collection:**
1. Enter a name in the "New collection name" field.
2. Click **Create**.

**Uploading clip art SVGs:**
1. Click the collection name to expand it.
2. Click **Upload SVGs**.
3. Select one or more `.svg` files (multiple selection supported).
4. SVGs are validated (512 KB max, MIME check, sanitized), stored with random filenames, and appear as thumbnails in the collection.

**Collection management:**
- **Rename**: Click "Rename" next to a collection, enter the new name.
- **Delete**: Click "Delete" next to a collection. A confirmation dialog appears. Deleting a collection removes all its SVG items and files from disk.
- **Delete individual item**: Click the × button on an SVG thumbnail to remove that specific item.

**How it appears to customers:**
In the frontend designer's Add tab, below the Text/Image/SVG buttons, a "Clip Art" section shows each enabled collection as a heading with a grid of clickable SVG thumbnails (48×48px). Clicking a thumbnail adds the SVG to the canvas.

**Security:** All uploaded clip art SVGs go through the same sanitization process as customer-uploaded SVGs — `<script>` tags, event handlers, external references, and other potentially dangerous content is stripped.

### Image Upload Restrictions

Control what files customers can upload.

| Setting | Default | Description |
|---------|---------|-------------|
| **Max file size (MB)** | 2 | Maximum file size for customer uploads. |
| **Min width (px)** | 0 | Minimum image width. Set to 0 to disable. |
| **Min height (px)** | 0 | Minimum image height. Set to 0 to disable. |
| **Min DPI** | 0 | Minimum dots per inch for print quality. Set to 0 to disable. |
| **Allowed types** | PNG, SVG | Checkboxes: JPG, PNG, SVG, WEBP. Only checked types are accepted. |

These restrictions are communicated to customers via error messages when an upload is rejected.

---

## Design Templates

### Templates vs Design Templates

ProductForge has two distinct concepts:

- **Templates (Sjablonen):** Define the *product structure* — canvas dimensions, zones, allowed element types, permissions, and pricing. A template says *where* customers can place elements and *what rules* apply. Templates contain no design content.

- **Design Templates:** Pre-made *designs* that customers can apply as a starting point in the designer. They contain actual Fabric.js canvas content (text, images, shapes) and are linked to a specific product template. Customers see these as "starter designs" they can customize.

**Example:** A T-Shirt template defines a print zone of 300×400px on the front. A design template "Best Dad Ever" provides a pre-made text layout that fits within that zone. The customer picks the design template, then customizes the text.

### Managing Design Templates

Navigate to **ProductForge → Design Templates** in the WordPress admin menu.

The list view shows all design templates with columns:
- **Name** — The template name shown to customers
- **Category** — Grouping label (e.g., "Mug", "T-Shirt", "Business Card")
- **Product Template** — Which product template this design is linked to (or "Any" for all)
- **Views** — Number of views (canvas pages) in the design
- **Status** — Active or Inactive
- **Actions** — Edit, Export, Delete

To create a new design template:
1. Click **Add New**
2. Fill in the name, category, select a product template (optional), and set status
3. Click **Save**

### Import & Export

Design templates can be exported as JSON files for backup or sharing between sites:
- Click **Export** on any design template to download its JSON file
- Click **Import JSON** and select a previously exported file to import

The JSON format includes the design template metadata and all view canvas data.

---

## Assigning Templates to Products

1. Edit a WooCommerce product.
2. Scroll to the **Product data** section.
3. Click the **ProductForge** tab.
4. Check **Enable Designer**.
5. Select a template from the **Template** dropdown (only published templates appear).
6. Choose a **Display Mode** (Embedded or Modal).
7. Save/update the product.

The designer will now appear on the product's frontend page.

**Product meta fields saved:**

| Meta Key | Description |
|----------|-------------|
| `_pf_designer_enabled` | `yes` or empty |
| `_pf_template_id` | ID of the assigned template |
| `_pf_display_mode` | `embedded` or `modal` |

---

## Display Modes

| Mode | Behavior |
|------|----------|
| **Embedded** | The designer renders inline on the product page, within the product description area (via the `[productforge]` shortcode or the `woocommerce_before_add_to_cart_button` hook). |
| **Modal** | A "Customize Product" button appears on the page. Clicking it opens the designer as a fullscreen overlay with focus trapping and keyboard accessibility. |

**Mobile override:** On mobile devices (screen width ≤ 768px), the designer always uses modal mode regardless of the setting.

**Shortcode:** The `[productforge]` shortcode can be placed anywhere in the product description to control exactly where the designer appears. If the shortcode is present, the hook-based render is skipped to prevent double rendering.

---

## The Frontend Designer

### How Customers Use the Designer

The frontend designer mirrors the template builder but with restrictions:

1. **Views tab** — customers switch between views (Front, Back, etc.).
2. **Add tab** — customers add text, images, SVGs, or clip art.
3. **Element tab** — customers edit selected elements within the allowed permissions.

Elements are constrained by:
- Zone boundaries (restrict or clip behavior).
- Allowed types per zone.
- Permissions (resize, rotate, delete, recolor, change font, min/max scale).
- Grid snapping (if enabled).
- Maximum character limits (if configured).

### Auto-Save Before Cart

When a customer clicks "Add to Cart" with unsaved design changes:

1. The form submission is intercepted.
2. The design is saved (or created if it's a first save).
3. All views are saved with thumbnails:
   - Active view: captured directly from the live canvas.
   - Non-active views: rendered via an offscreen Fabric.js canvas.
4. The design hash is injected into a hidden form field.
5. The form re-submits automatically.

This ensures customers never lose their work when adding to cart.

### Mobile Behavior

- Designer always opens as a fullscreen modal.
- Touch-optimized: larger control handles (44px+ targets), circle corner style.
- Sidebar starts collapsed, auto-expands on element selection.
- Zone boundaries rendered with higher opacity and thicker strokes for visibility.
- Viewport pinch-to-zoom is temporarily disabled while the designer is open (via dynamic viewport meta tag modification).

---

## WooCommerce Integration

### Cart Integration

When a customized product is in the cart:

| Feature | Description |
|---------|-------------|
| **Design hash** | Stored as `pf_design_hash` in cart item data via a hidden form field. |
| **Thumbnails (classic cart)** | Product thumbnail is replaced with all design view thumbnails side-by-side (max 80×80px each). |
| **Thumbnails (block cart)** | Real PNG URLs provided to the Store API (block cart cannot use data URIs). |
| **Cart item label** | "Design: Customized" appears in cart item details. |
| **Cart item permalink** | Product link appended with `?pf_design=HASH` so the customer can return to edit. |
| **Surcharge display** | "Design surcharge: €X.XX" shown in cart item data. |
| **Multiple customizations** | After adding a customized product to cart (via AJAX), the designer automatically resets: all user elements are removed, zone fill colors revert to admin defaults, and the design hash is cleared. The customer can immediately start a new customization of the same product and add it as a separate cart item. |

### Order Processing

| Hook | Purpose |
|------|---------|
| **Classic checkout** | Design hash saved to order item meta via `woocommerce_checkout_create_order_line_item`. |
| **Block checkout** | Safety net via `woocommerce_store_api_checkout_update_order_meta` — matches cart items to order items by product ID. |
| **Order item thumbnail** | Design thumbnails replace product images in order confirmation and emails. |
| **Admin order view** | Design thumbnail shown at 38×38px. Export buttons (PDF/PNG/SVG) appear per order item. Completed exports show download links. |
| **Order item meta display** | `_pf_design_hash` is exposed as "Design: Customized" in order details. |

### Design Surcharges

Surcharges are calculated via `CartSurcharge.php` + `PriceCalculator.php`:

1. Hooked to `woocommerce_before_calculate_totals` (priority 20).
2. For each cart item with a `pf_design_hash`:
   - Loads the design's canvas JSON from the database.
   - Counts elements by type across all views.
   - Calculates surcharge based on the template's pricing config.
   - Adds the surcharge to the product's price.
3. A re-entrancy guard prevents infinite loops.
4. Sale prices are respected (uses `$product->get_price()`).

---

## Export System

Exports generate production-ready files from a customer's design. They can be triggered manually from the admin order view or automatically on order status change.

### Pre-Rendered Export Pipeline

Exports use a **browser-rendered source** stored as `wp_pf_design_views.export_svg`: either raw SVG markup from `canvas.toSVG()` or a PNG data URL from an offscreen Fabric canvas at 3× multiplier. This is produced on the client at save time because only the browser has the fonts (including custom `@font-face` and Hershey engraving fonts) and the exact glyph metrics needed for pixel-accurate output. Server-side canvas rendering cannot reproduce the text layout.

Inputs are sanitized on write (`enshrined/svg-sanitize` for SVG, PNG magic-byte check for data URLs, 10 MB cap). If a design was saved before the export pipeline existed, the API returns the error *"Design has no export SVG data. Please re-save the design to generate export data."* — the customer or admin must re-save the design to regenerate it.

### PDF Export

| Feature | Detail |
|---------|--------|
| **Library** | TCPDF |
| **Source** | Pre-rendered PNG (embedded directly) or SVG (converted to PNG via `rsvg-convert` or Imagick) |
| **Multi-view** | One page per view in a single PDF file |
| **Page size** | Template canvas dimensions, converted from pixels to mm at 96 DPI |
| **Orientation** | Per page: landscape if width ≥ height, portrait otherwise |

### PNG Export

| Feature | Detail |
|---------|--------|
| **Source** | Pre-rendered PNG (written directly) or SVG (converted via `rsvg-convert` or Imagick at 300 DPI) |
| **Multi-view** | Separate PNG file per view (suffixed `-view-N`); `file_path` stores a comma-separated list |
| **DPI** | 300 when converting from SVG |

### SVG Export

| Feature | Detail |
|---------|--------|
| **Source** | Pre-rendered SVG (written as-is) or PNG wrapped in an `<svg><image>` container |
| **Multi-view** | Separate SVG file per view; `file_path` stores a comma-separated list |
| **Library** | Pure PHP (no external library) |

### Auto-Export on Order Status

The export system can automatically generate exports when an order reaches a specific status:

- **Trigger status**: Configured via the `pf_export_trigger_status` WordPress option (default: `completed`).
- **Default format**: Configured via the `pf_export_default_format` option (default: `pdf`).
- **Behavior**: When an order transitions to the trigger status, all order items with a design hash are exported automatically.

To configure these options, use `wp option update pf_export_trigger_status processing` (for example) via WP-CLI or a custom settings page.

### Managing Exports

**From the admin order view:**

Each order item with a design shows export buttons:
- Click **PDF**, **PNG**, or **SVG** to trigger an export.
- The file downloads automatically when generation is complete.
- Previously generated exports of the same format are replaced.

**Export file storage:**
- Path: `wp-content/uploads/pf-exports/{format}/`
- Filename: `{design_hash}-{design_id}.{ext}`
- Protected with `.htaccess` (deny direct access) and `index.php` (directory listing prevention).
- Downloads served via the REST API with proper headers (`Content-Disposition: attachment`, `nocache_headers`, `X-Content-Type-Options: nosniff`).

---

## Database Reference

ProductForge creates 11 tables (all using InnoDB engine):

### wp_pf_templates

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT UNSIGNED PK | Auto-increment |
| title | VARCHAR(255) | Template name |
| slug | VARCHAR(255) UNIQUE | URL-safe identifier |
| status | ENUM | draft, published, archived, trashed |
| global_config | LONGTEXT | JSON: permissions, pricing, all settings |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last modified (auto-updated) |

### wp_pf_template_views

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT UNSIGNED PK | Auto-increment |
| template_id | BIGINT UNSIGNED FK | → templates.id (CASCADE) |
| name | VARCHAR(255) | View name (e.g. "Front") |
| sort_order | SMALLINT UNSIGNED | Display order |
| canvas_width | SMALLINT UNSIGNED | Default: 800 |
| canvas_height | SMALLINT UNSIGNED | Default: 600 |
| background_color | VARCHAR(20) | Default: '#ffffff' |
| background_url | VARCHAR(2048) | Background image URL |
| background_transform | TEXT | JSON: {scaleX, scaleY, left, top} |
| zones_config | LONGTEXT | JSON array of zone objects with nested layers |
| layers_config | LONGTEXT | Legacy flat layers (migrated on load) |
| permissions | LONGTEXT | Legacy per-view permissions |

### wp_pf_designs

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT UNSIGNED PK | Internal only — never exposed |
| design_hash | CHAR(32) UNIQUE | CSPRNG hex — public identifier |
| template_id | BIGINT UNSIGNED FK | → templates.id |
| product_id | BIGINT UNSIGNED | WooCommerce product ID |
| customer_id | BIGINT UNSIGNED | WordPress user ID (0 for guests) |
| session_id | VARCHAR(64) | Guest session cookie value |
| status | ENUM | draft, final, ordered, archived |
| total_price | DECIMAL(10,2) | Calculated surcharge |
| created_at | DATETIME | |
| updated_at | DATETIME | |

### wp_pf_design_views

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT UNSIGNED PK | |
| design_id | BIGINT UNSIGNED FK | → designs.id (CASCADE) |
| view_id | BIGINT UNSIGNED | → template_views.id |
| canvas_json | LONGTEXT | Fabric.js JSON |
| thumbnail | VARCHAR(2048) | URL to PNG thumbnail |
| export_svg | LONGTEXT | Browser-rendered export source: either raw SVG markup (sanitized with `enshrined/svg-sanitize`) or a `data:image/png;base64,` data URL (magic-byte validated). Max 10 MB on write. Used by the export pipeline instead of server-side canvas rendering because only the client has all the loaded web fonts needed for pixel-accurate text output |

### wp_pf_exports

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT UNSIGNED PK | |
| design_id | BIGINT UNSIGNED FK | → designs.id |
| order_id | BIGINT UNSIGNED | WooCommerce order ID |
| format | ENUM | pdf, png, svg |
| file_path | VARCHAR(2048) | Absolute server path. For multi-view PNG/SVG exports this is a **comma-separated list of paths** (one per view); single-file formats like PDF store a single path. All readers must `explode(',', $file_path)` before `file_exists`/`realpath`/`unlink` |
| status | ENUM | pending, processing, done, failed |
| created_at | DATETIME | |

### wp_pf_price_log

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT UNSIGNED PK | |
| design_id | BIGINT UNSIGNED FK | → designs.id (CASCADE) |
| element_type | ENUM | text, image, svg |
| element_id | VARCHAR(64) | Format: `{type}_{index}` |
| price | DECIMAL(10,2) | Price for this element |
| logged_at | DATETIME | |

### wp_pf_fonts

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT UNSIGNED PK | |
| family | VARCHAR(255) | Font family name |
| file_url | VARCHAR(2048) | URL to uploaded file |
| format | VARCHAR(10) | woff2, woff, or truetype |
| created_at | DATETIME | |

### wp_pf_clipart_collections

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT UNSIGNED PK | |
| name | VARCHAR(255) | Collection display name |
| created_at | DATETIME | |

### wp_pf_clipart

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT UNSIGNED PK | |
| collection_id | BIGINT UNSIGNED FK | → collections.id (CASCADE) |
| name | VARCHAR(255) | Item display name |
| svg_url | VARCHAR(2048) | URL to stored SVG file |
| created_at | DATETIME | |

### wp_pf_design_templates

Pre-made designs that customers can apply in the frontend designer. Separate from `wp_pf_templates` (which are product templates authored by the shop owner).

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT UNSIGNED PK | |
| title | VARCHAR(255) | Display name |
| slug | VARCHAR(255) UNIQUE | URL-safe identifier |
| template_id | BIGINT UNSIGNED FK | → `wp_pf_templates.id` — which product template this design is compatible with |
| status | ENUM | draft, published |
| thumbnail_url | VARCHAR(2048) | Preview image shown in the picker |
| created_at / updated_at | DATETIME | |

### wp_pf_design_template_views

Per-view Fabric.js canvas JSON for design templates.

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT UNSIGNED PK | |
| design_template_id | BIGINT UNSIGNED FK | → `wp_pf_design_templates.id` (CASCADE) |
| view_id | BIGINT UNSIGNED FK | → `wp_pf_template_views.id` |
| canvas_json | LONGTEXT | Fabric.js `toJSON(['data'])` output |

---

## REST API Reference

All endpoints are under the `pf/v1` namespace. Nonce verification via `X-WP-Nonce` header is required for write operations.

### Templates

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/templates` | Admin | List templates (paginated, filterable by status) |
| POST | `/templates` | Admin | Create template |
| GET | `/templates/{id}` | Admin | Get template with views |
| PUT | `/templates/{id}` | Admin | Update template |
| DELETE | `/templates/{id}` | Admin | Trash or force-delete (`?force=true`) |
| POST | `/templates/{id}/duplicate` | Admin | Duplicate template |
| GET | `/templates/{id}/public` | Public | Get published template (sanitized, no auth required) |
| GET | `/templates/{id}/views` | Admin | List views |
| POST | `/templates/{id}/views` | Admin | Create view |
| PUT | `/templates/{id}/views/{vid}` | Admin | Update view |
| DELETE | `/templates/{id}/views/{vid}` | Admin | Delete view |

### Designs

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/designs` | Nonce | Create design (sets customer_id/session_id) |
| GET | `/designs/{hash}` | Owner/Admin | Get design by hash |
| PUT | `/designs/{hash}` | Owner | Update design status |
| DELETE | `/designs/{hash}` | Owner | Delete design |
| POST | `/designs/{hash}/views` | Owner | Upsert view (canvas JSON + thumbnail + `export_svg`). SVG markup is sanitized via `enshrined/svg-sanitize`; PNG data URLs are magic-byte validated; payloads >10 MB are dropped. `export_svg` is stripped from GET responses to keep payloads small. |
| GET | `/admin/designs` | Admin | List all designs (paginated) |
| PUT | `/admin/designs/{hash}/status` | Admin | Update design status |

### Exports

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/exports/{hash}` | Admin | Trigger export (format: pdf/png/svg) |
| GET | `/exports/{id}/download` | Admin | Download export file |
| GET | `/orders/{oid}/exports` | Admin | List exports for an order |
| DELETE | `/exports/{id}` | Admin | Delete export. Multi-view paths (comma-separated `file_path`) are split and each path is validated against `pf-exports/` via `realpath()` before `unlink()`. |

### Uploads

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/uploads` | Nonce | Upload image/SVG (customer uploads) |

### Fonts

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/fonts` | Public | List custom fonts grouped by family |
| POST | `/fonts` | Admin | Upload font file |
| DELETE | `/fonts/{id}` | Admin | Delete font file |
| DELETE | `/fonts/family/{family}` | Admin | Delete all files for a family |

### Palettes

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/palettes` | Admin | List all color palettes |
| POST | `/palettes` | Admin | Create palette |
| PUT | `/palettes/{id}` | Admin | Update palette |
| DELETE | `/palettes/{id}` | Admin | Delete palette |

### Clip Art

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/clipart/collections` | Public | List collections with item counts |
| POST | `/clipart/collections` | Admin | Create collection |
| GET | `/clipart/collections/{id}` | Public | Get collection with items |
| PUT | `/clipart/collections/{id}` | Admin | Rename collection |
| DELETE | `/clipart/collections/{id}` | Admin | Delete collection + items + files |
| POST | `/clipart` | Admin | Upload SVG to collection |
| DELETE | `/clipart/{id}` | Admin | Delete clip art item + file |

---

## Security

ProductForge was built as a secure replacement for Fancy Product Designer, which had critical vulnerabilities (CVE-2024-51919: arbitrary file upload/RCE, CVE-2024-51818: SQL injection). Security is a core design principle.

### SQL Injection Prevention
All database queries use `$wpdb->prepare()` with parameterized placeholders. Raw SQL interpolation is never used. All database access goes through Repository classes — `$wpdb` is never accessed directly outside `includes/Database/`.

### File Upload Security

| Check | Details |
|-------|---------|
| **MIME validation** | `finfo_file()` used for server-side MIME detection — file extensions and HTTP content-type headers are never trusted. |
| **SVG sanitization** | All SVGs (customer uploads, admin clip art) are sanitized via `enshrined/svg-sanitize`. Stripped: `<script>`, `on*` attributes, `<use>` with external refs, `<foreignObject>`, `data:` URIs. |
| **Font validation** | WOFF2/WOFF/TTF files validated via magic bytes and MIME check. |
| **Rate limiting** | Customer uploads limited to 10 per minute per session (tracked via WordPress transients). |
| **Secure filenames** | All uploaded files renamed to `bin2hex(random_bytes(8))` + extension — no user-provided filenames are used. |
| **Clip art size limit** | Clip art SVGs limited to 512 KB. |

### Design ID Security
- Designs are publicly identified by `design_hash`: 32 characters of CSPRNG hex (`bin2hex(random_bytes(16))`).
- Internal sequential IDs are never exposed in API responses.
- Design ownership is verified on every access: logged-in user must match `customer_id`, or session cookie must match `session_id`, or user must have `edit_pf_templates` capability.

### Export Security
- Download paths validated against `pf-exports/` directory via `realpath()` comparison.
- Multi-view exports store a comma-separated list in `wp_pf_exports.file_path`; delete and cleanup code must `explode(',', $path)` and validate each entry individually before `unlink()`.
- Export files served with `nocache_headers()` and `X-Content-Type-Options: nosniff`.
- Export directories protected with `.htaccess` (deny all) and `index.php` (silence).
- Client-submitted export blobs (`export_svg` on view save) are sanitized before storage: SVG markup through `enshrined/svg-sanitize`, PNG data URLs via base64 decode + PNG magic-byte check, everything else dropped. 10 MB hard cap to prevent memory exhaustion during PDF/PNG render.

### Thumbnail Validation
- PNG thumbnails validated for magic bytes (`\x89PNG\r\n\x1a\n`) before saving.
- Base64 payload capped at ~5 MB decoded.

### Capability System
- Admin endpoints require `edit_pf_templates` or `manage_woocommerce` capability.
- The `grant_template_cap` filter is registered on the main plugin class (not the Admin class) so it applies in REST API context.
- Session IDs are 32-char CSPRNG hex, stored in HttpOnly cookies with `Secure` (if HTTPS) and `SameSite=Lax`.

### Fabric.js JSON Security
- Before loading canvas JSON (from saved designs or API responses), a whitelist filter strips any object types not in the allowed set (`IText`, `Image`, `Rect`, `Path`, `Group`).
- This prevents arbitrary Fabric.js object injection.

### Server-Side Pricing
Prices are always recalculated server-side from the canvas JSON. Client-sent price values are never trusted or accepted.

---

## File Storage

| Content | Path | Protection |
|---------|------|------------|
| Customer uploads | `wp-content/uploads/productforge/YYYY/MM/` | Random filenames |
| Design thumbnails | `wp-content/uploads/pf-thumbnails/` | `.htaccess` + `index.php` |
| Export files | `wp-content/uploads/pf-exports/{format}/` | `.htaccess` (deny all) + `index.php` |
| Custom fonts | `wp-content/uploads/` (standard WP upload path) | Standard WP upload protection |
| Clip art SVGs | `wp-content/uploads/pf-clipart/` | Random filenames, path traversal guard on delete |

---

## Development & Build

### Requirements
- Node.js 18+
- npm

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server with HMR (hot module replacement) |
| `npm run build` | Production build → `dist/` directory |

### Build Output

The build produces four entry points:
- `dist/admin-template-builder.js` + `dist/admin-template-builder.css` — Admin template builder
- `dist/admin-design-templates.js` + `dist/admin-design-templates.css` — Design templates CRUD app
- `dist/admin-clipart.js` + `dist/admin-clipart.css` — Clipart manager (collections + bulk upload)
- `dist/frontend-designer.js` + `dist/frontend-designer.css` — Frontend customer designer

CSS is output both as JS-injected styles (via Vite) and as separate CSS files (via a `cp` step in the build script) for Safari compatibility.

### Docker Development Environment

```bash
docker compose up -d                    # Start WordPress + MariaDB + phpMyAdmin
docker compose exec wordpress wp ...    # Run WP-CLI commands
npm run dev                             # Vite dev server (HMR)
```

- WordPress: http://localhost:8080 (admin / admin)
- phpMyAdmin: http://localhost:8081

---

## Troubleshooting

### Template builder won't load
- Check the browser console for JavaScript errors.
- Ensure `npm run build` has been run (or `npm run dev` is running).
- Verify the plugin is activated and the `wp_pf_templates` table exists.

### Designer doesn't appear on the product page
- Confirm the product has **Enable Designer** checked in the ProductForge tab.
- Confirm the assigned template has **Published** status.
- Check that the `[productforge]` shortcode is not duplicated in the product description.
- If using a page builder, ensure the shortcode is rendered (not escaped).

### Fonts not loading for customers
- Verify fonts are added to the **Allowed Fonts** list in template Settings.
- Check the browser console for failed font requests (CORS issues, 404s).
- For custom fonts, verify the font files exist at their URLs.

### Clip art not showing
- Verify **Enable clip art library** is checked in template Settings.
- Verify at least one collection exists with uploaded SVGs.
- Check if the collection is checked in the "Available collections" list.
- Ensure at least one zone allows SVG elements.

### Exports failing
- **"Design has no export SVG data. Please re-save the design to generate export data."** — the design was saved before the pre-rendered export pipeline was in place. Open the design in the frontend and click **Save Design** to regenerate `export_svg`.
- **PDF**: Ensure TCPDF library is available (included via Composer). Source must be a valid PNG data URL or SVG; SVG is converted to PNG via `rsvg-convert` (preferred) or Imagick.
- **PNG**: Pre-rendered PNG is written directly. If the source is SVG, Imagick or `rsvg-convert` must be available to rasterize.
- **SVG**: No external dependencies — if failing, check PHP error log.
- Verify the export directory (`wp-content/uploads/pf-exports/`) is writable.

### Design surcharge not applied
- Verify the template has pricing configured (Pricing tab, per_element or tier mode).
- Verify the design has elements (empty designs have no surcharge).
- Check that the design hash is present in the cart item data (inspect the hidden input `pf_design_hash`).

### Database tables missing
- Deactivate and reactivate the plugin to trigger migration.
- Or run: `docker compose exec wordpress wp eval "ProductForge\Database\DbManager::run_migrations();"`.
- Check the `pf_db_version` option value — it should match the latest migration number (700).

### SVG upload rejected
- Ensure the SVG is valid XML.
- Check file size (customer uploads: 10 MB max; clip art: 512 KB max).
- The SVG may contain disallowed elements (scripts, external references) that are being sanitized. Simplify the SVG and retry.

### Rate limit hit on uploads
- Customer uploads are limited to 10 per minute per session.
- Wait 60 seconds and try again.
- This limit applies per session, not per user — clearing cookies resets it.
