# ProductForge for WooCommerce — User Guide

> This guide is for **customers** who use the ProductForge designer on a WooCommerce product page to customize products such as dog tags, name plates, coasters, and more.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Opening the Designer](#opening-the-designer)
3. [Understanding the Canvas](#understanding-the-canvas)
4. [The Sidebar](#the-sidebar)
5. [Working with Views](#working-with-views)
6. [Adding Elements](#adding-elements)
7. [Editing Elements](#editing-elements)
8. [Using Clip Art](#using-clip-art)
9. [Changing the Product Color](#changing-the-product-color)
10. [Saving Your Design](#saving-your-design)
11. [Adding to Cart](#adding-to-cart)
12. [Editing a Design from Your Cart](#editing-a-design-from-your-cart)
13. [Mobile Usage](#mobile-usage)
14. [Keyboard Shortcuts](#keyboard-shortcuts)
15. [Troubleshooting](#troubleshooting)

---

## Getting Started

ProductForge is a built-in product designer that lets you personalize products directly on the product page. Depending on the product, you can add text (names, dates, messages), upload your own images or SVG files, choose from a clip art library, and change the product color — all before adding the item to your cart.

Not every product has the designer enabled. If a product supports customization, you will see the designer canvas either embedded on the product page or accessible via a **Customize Product** button.

---

## Opening the Designer

There are two ways the designer can appear:

### Embedded Mode
The designer is displayed directly on the product page, usually within the product description area. You can start designing immediately — no extra clicks needed.

### Modal (Popup) Mode
A **Customize Product** button appears on the product page. Click it to open the designer as a fullscreen overlay. Press **Escape** or click **Close Designer** to return to the product page.

On **mobile devices**, the designer always opens as a fullscreen popup for the best experience.

---

## Understanding the Canvas

The canvas is the main design area where your product is displayed. It shows:

- **The product background** — an image or color representing the product surface.
- **Design zones** — outlined areas where you can place your elements. These are defined by the shop owner and represent the printable/engravable areas of the product.

### Zone Rules

- **Restrict zones** — your elements cannot be moved outside the zone boundary. If you try to drag an element past the edge, it will snap back.
- **Clip zones** — your elements can extend beyond the zone, but anything outside the boundary will be visually hidden (clipped).

You can only place elements in zones that allow that element type. For example, a zone might allow text but not images.

---

## The Sidebar

The sidebar sits next to the canvas and has three tabs:

| Tab | Purpose |
|-----|---------|
| **Views** | Switch between product sides (e.g. Front / Back) |
| **Element** | Edit the properties of a selected element |
| **Add** | Add new text, images, SVGs, or clip art |

The sidebar automatically switches to the **Element** tab when you select an element on the canvas.

---

## Working with Views

Many products have multiple sides — for example, a dog tag with a **Front** and **Back**. Each side is a separate "view."

- Click on a view name (e.g. **Front**, **Back**) in the Views tab to switch.
- Your work on each view is saved automatically when you switch.
- All views are included when you save your design.

---

## Adding Elements

Switch to the **Add** tab in the sidebar to see the available tools:

### Adding Text

1. Click the **Text** button.
2. Click anywhere on the canvas within a text-allowed zone.
3. A text element appears with placeholder text — double-click it to start typing.
4. Use the Element tab to change the font, size, color, and style.

### Adding an Image

1. Click the **Image** button.
2. A file picker opens — select a JPG, PNG, or WEBP image from your device.
3. The image is uploaded and placed on the canvas, scaled to fit the design zone.

**Upload restrictions** may apply depending on the product:
- Maximum file size (typically 2–10 MB)
- Minimum image dimensions (width/height in pixels)
- Minimum DPI (for print quality)
- Allowed file types

If your file does not meet the requirements, an error message will explain what needs to change.

### Adding an SVG

1. Click the **SVG** button.
2. Select an `.svg` file from your device.
3. The SVG is uploaded, sanitized for security, and placed on the canvas.

---

## Editing Elements

Click on any element on the canvas to select it. The sidebar automatically switches to the **Element** tab showing the available properties.

### Text Properties

| Property | Description |
|----------|-------------|
| **Font** | Choose from the available fonts (dropdown). Only shown if the shop has configured fonts. |
| **Size** | Adjust the text size (8–200). |
| **Color** | Pick a text color. The shop owner configures which colors are available — you may see a full color picker, a set of color swatches, or no color option at all. Element colors (text and SVG tint) are configured separately from product colors. |
| **Bold** | Toggle bold style (B button). |
| **Italic** | Toggle italic style (I button). |

To edit the text content itself, double-click the text element on the canvas.

### Image Properties

| Property | Description |
|----------|-------------|
| **Scale** | Shows the current scale percentage (read-only display). Resize using the corner handles on the canvas. |

### SVG Properties

| Property | Description |
|----------|-------------|
| **Scale** | Shows the current scale percentage. |
| **Tint Color** | Apply a color tint to the SVG. Available as a full picker or swatches depending on the element color configuration set by the shop. Not available for all clip art items. |

### Common Controls

| Control | Description |
|---------|-------------|
| **Alignment buttons** | Align the selected element within its zone: left, center, right, top, middle, bottom. |
| **Delete** | Remove the selected element from the canvas. |

### Resizing and Rotating

- **Resize**: Drag the corner handles of a selected element.
- **Rotate**: Drag the rotation handle (small circle above the element).

Some products may have resizing or rotation disabled, or may enforce minimum/maximum scale limits.

---

## Using Clip Art

If the shop has a clip art library enabled for the product, you will see a **Clip Art** section at the bottom of the Add tab.

Clip art is organized into collections (e.g. "Animals", "Symbols"). Each collection shows its SVG items as small thumbnail images.

**To add clip art:**
1. Go to the **Add** tab.
2. Scroll down to the **Clip Art** section.
3. Click on any thumbnail to add it to your design.

The clip art is placed on the canvas like any other SVG element. Depending on the product settings, you may or may not be able to change its color (tint).

---

## Changing the Product Color

Some products allow you to change the base color of the product itself (e.g. changing a dog tag from silver to gold). This is separate from element colors (text color, SVG tint) — the shop configures each independently.

When available, a **Product Color** section appears at the top of the **Element** tab. It shows color swatches or a color picker, depending on what the shop has configured. Click a color to change the product appearance.

For **solid color products** (like dog tags where front and back are the same material), changing the color on one view automatically updates all other views.

---

## Saving Your Design

Click the **Save Design** button in the sidebar to save your work.

| Button State | Meaning |
|-------------|---------|
| **Save Design** | Your design has unsaved changes. |
| **Saving...** | Your design is being saved to the server. |
| **Saved!** | Your design was saved successfully (shown briefly in green). |
| Disabled (greyed out) | No changes to save. |

Saving generates a preview thumbnail that appears on the product page and in your cart.

### Important Notes

- Your design is stored on the server with a unique identifier.
- You can close the designer and come back later — your design is preserved as long as you save it first.
- Each save updates the product image on the page with your latest design.

---

## Adding to Cart

After customizing your product:

1. **Save your design** using the Save Design button.
2. Click **Add to Cart** on the product page.

If you have unsaved changes when clicking Add to Cart, the system will automatically save your design before adding the product to your cart.

Some products **require customization** — the Add to Cart button won't work until you've saved a design. If you see an error message asking you to customize the product first, open the designer and create your design.

### Adding Multiple Customizations

You can add the same product with different customizations to your cart. After adding a customized product to cart, the designer automatically resets — all your elements are removed, the product color returns to its default, and you get a fresh canvas for a new customization. Each customization is a separate cart item with its own design.

### What Appears in Your Cart

- Your customized product shows a thumbnail preview of your design (all views are shown side by side if the product has multiple views).
- A "Design: Customized" label appears under the product.
- If applicable, a design surcharge is added to the product price.
- Each customization appears as a separate line item, even for the same product.

---

## Editing a Design from Your Cart

If you need to make changes after adding to cart:

1. Go to your cart.
2. Click the product name — it links back to the product page with your design pre-loaded.
3. The designer opens automatically with your saved design.
4. Make your changes and save again.

---

## Mobile Usage

The designer is fully responsive and works on phones and tablets:

- The designer always opens as a **fullscreen popup** on mobile.
- Touch controls are optimized with larger handles for easier interaction.
- The sidebar starts collapsed and expands when you tap an element.
- Pinch-to-zoom on the page is temporarily disabled while the designer is open, so your gestures interact with the canvas instead of the browser.

**Tip:** For the best experience with complex designs, consider using a tablet or desktop.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Escape** | Close the designer (modal mode only) |
| **Tab / Shift+Tab** | Navigate between interactive elements (modal mode — focus stays within the designer) |

---

## Troubleshooting

### "Please customize your product before adding to cart"
This product requires a design. Open the designer, create your design, and save it before adding to cart.

### My uploaded image was rejected
Check the error message — common reasons:
- File is too large (check the maximum file size)
- Image dimensions are too small
- File type not allowed (check which formats are accepted)

### My design looks different after saving
The save creates a thumbnail at reduced quality for preview purposes. Your full-quality design is preserved and will be used for production.

### Elements won't move past a certain point
Your element is inside a restricted zone — it cannot be dragged outside the designated design area. This is intentional to ensure your design fits within the printable area.

### I can't change the color of a clip art item
The shop owner may have disabled recoloring for clip art items. This is a per-product setting.

### The designer won't load
- Ensure your browser is up to date (Chrome, Firefox, Safari, Edge).
- Try clearing your browser cache.
- Disable browser extensions that might interfere (ad blockers, script blockers).
- Check your internet connection — the designer needs to load fonts and product data.

### I lost my design
If you saved your design before closing, it should be available when you return to the product page from your cart. If you did not save, the design is lost. Always click **Save Design** before leaving the page.
