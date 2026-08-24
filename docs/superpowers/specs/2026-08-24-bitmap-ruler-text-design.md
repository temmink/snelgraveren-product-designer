# LightBurn Bitmaps, mm Ruler, Text Placement & Layer Locking — Design Spec

**Date:** 2026-08-24
**Status:** Draft
**Scope:** Nine related changes across the Template Builder and the customer Designer, driven by one merchant workflow: import a LightBurn project that contains a raster reference image, position artwork against a real-world millimetre scale, and let customers move and edit text within the boundary at a legible engraving size.

## Goal

Today a `.lbrn2` file containing a bitmap imports with the warning *"Skipped a bitmap image (not supported)"* and the image is lost. Merchants use that bitmap as a background reference — a photo of the product, or a raster version of the artwork — to align vectors against. It must survive the import as a real layer with opacity and visibility control, be visible to the customer, and never reach the production export or the price.

Alongside that, four long-standing rough edges in the same screens are addressed: there is no physical scale anywhere in the UI, text lands wherever the customer clicks with a selection box as wide as the whole zone, that wide box makes text un-draggable inside non-rectangular boundaries, and template artwork is frozen for customers regardless of the lock toggle.

## Decisions (locked)

1. **Bitmap becomes a real `image` layer**, uploaded to the WordPress media library — not a data URI in `zones_config`.
2. **Visible to the customer, excluded from the export.** The bitmap is background context, not production geometry.
3. **Excluded from pricing.** A background the customer never added must never carry a surcharge.
4. **The ruler is DOM, never Fabric.** A Fabric ruler would land in the saved canvas JSON and in the export.
5. **No ruler without a physical size.** When `width_mm` is 0 the ruler is hidden; a millimetre scale derived from nothing is a lie.
6. **The lock toggle governs the boundary only, and only in the Template Builder.** In the customer Designer the boundary is always fixed and every layer is always movable within it.
7. **The minimum font size is expressed in millimetres**, so it means the same physical thing on every template.
8. **Existing customer designs are never retro-modified.** New rules apply to new edits; a saved design opens exactly as the customer left it.

---

## 1. LightBurn bitmap → image layer

### File format

A LightBurn bitmap shape looks like this (verified against `~/Downloads/borrelplank.lbrn2`):

```xml
<Shape Type="Bitmap" CutIndex="0" W="211.64021" H="103.17461"
       Gamma="1" Contrast="0" Brightness="0"
       File="/…/borrelplank28x13.png" SourceHash="1"
       Data="iVBORw0KGgoAAAANSUhEUgAAAyAAAAGG…">
  <XForm>1.3230001 0 0 1.3230001 308 716</XForm>
</Shape>
```

- `W` / `H` are the **final physical size in millimetres**.
- `Data` is a raw base64 PNG (no `data:` prefix).
- The `<XForm>` translation is the **centre** of the bitmap, not a corner.

Verification: the two `Path` shapes in that file span x 168.72–447.17, y 648.25–783.66 — centre (308.0, 716.0), exactly the bitmap's XForm translation. The PNG is 800×390 px; `211.64 / 1.323 = 160.0` and `103.17 / 1.323 = 78.0`, so the local box is 160×78 units centred on the origin.

### Geometry

Add a `Bitmap` branch to `collectShapes`' consumer in `parseLbrn` (`admin/js/template-builder/src/utils/lbrnParser.js`):

```
sx = hypot(a, b)                  // from the composed XForm [a,b,c,d,e,f]
sy = hypot(c, d)
halfW = W / (2 * sx)              // local half-extent
halfH = H / (2 * sy)
corners = applyXform over (±halfW, ±halfH)   // 4 machine-space points
angle  = atan2(b, a) in degrees
```

The four corners join the union bbox accumulator alongside `paths` and `texts`, so a bitmap that extends past the vectors widens the imported canvas correctly.

The emitted descriptor follows the same **bbox convention** as every other layer (bounding-box top-left at `left`/`top`, never the SVG origin — see CLAUDE.md, SVG-boundary convention):

```js
{
  type: 'image',
  dataUrl: 'data:image/png;base64,…',   // consumed by the importer, never stored
  pngWidth, pngHeight,                  // intrinsic pixels, for the scale factor
  left, top,                            // machine bbox top-left → canvas px
  scaleX: (W * PX_PER_MM) / pngWidth,
  scaleY: (H * PX_PER_MM) / pngHeight,
  angle,
}
```

The `'Skipped a bitmap image (not supported).'` warning is removed.

**Composed group XForms apply unchanged.** `collectShapes` already composes ancestor group transforms; a bitmap inside a LightBurn group inherits that composition like any other shape.

### Upload

`ImportLightBurn.jsx` converts `dataUrl` to a `Blob` and POSTs it to `${restUrl}wp/v2/media` with the `X-WP-Nonce` header (both already exposed on `window.sgpdTemplateBuilder`). The returned `source_url` becomes `layer.src`; `dataUrl` is dropped before the layer reaches the store.

Failure handling: a failed upload (no `upload_files` capability, server rejection) skips **that layer only** and appends a warning to the existing `warnings` array. The vector part of the import always completes.

Ordering: bitmap layers are added **first**, so they sit at the bottom of the layer list.

Layer defaults on import: `locked: true`, `visible: true`, `opacity: 1`, `name: "Bitmap N"`, `exclude_from_export: true`, `template_art: true`.

**Why not a data URI:** the example PNG is ~200 KB of base64. `zones_config` is a JSON column read on every designer page load, and CLAUDE.md forbids data URIs in Fabric JSON.

---

## 2. `opacity` as a layer property

New optional layer field `opacity`, a number in `[0, 1]`, default `1`.

- **Builder canvas** (`admin/js/template-builder/src/components/Canvas.jsx`): add `opacity: layer.opacity ?? 1` to the text, image and svg branches — both the create path and the update path of each.
- **Layer form** (`TreePanel.jsx` → `LayerDetail`): a range slider 0–100 % in the non-text branch, which covers image and svg layers.
- **Customer designer**: applied in the layer branches (§3, §7).
- **Visibility**: no work. The eye toggle already writes `visible` and both canvases already read `layer.visible !== false`.

**No storage work.** `RestTemplates::sanitize_zone_layers` has no key whitelist — it only sanitises `svg_markup` — so `opacity`, `exclude_from_export` and `template_art` pass through to the database untouched.

---

## 3. Customer rendering, export exclusion, price exclusion

### 3a. The missing image branch

`frontend/js/designer/src/components/DesignerCanvas.jsx` renders template `text` and `svg` layers but **has no `image` branch at all**. Without one an imported bitmap is invisible to the customer.

Add one modelled on the existing `svg` branch:

- `FabricImage.fromURL(layer.src, { crossOrigin: 'anonymous' })`
- position/scale/angle/opacity/visible from the layer
- guarded by the same `hasSnapshotForView` check the svg branch uses — the async image load can resolve *after* `loadFromJSON` restored a snapshot that already contains the image, stacking a duplicate (the race documented at `DesignerCanvas.jsx:458-471`)
- `canvas.sendObjectToBack(img)` so background art stays behind everything
- `data: { elementType: 'image', zoneIndex, excludeFromExport: true, templateArt: true, templateLocked: true }`

The bitmap is the **one exception** to "layers are movable" (§7): it is background reference art, kept `selectable: false, evented: false`. Because it is `evented: false`, clicks fall straight through to the text and logos above it.

### 3b. Export exclusion

`data` survives serialization — every save uses `toJSON(['data'])` — so the flag reaches the offscreen renderers through the stored JSON.

One caveat to verify rather than assume: Fabric 6's `Group.toObject` ignores `propertiesToInclude`, which is why the zone overlay patches its own `toObject` (`DesignerCanvas.jsx:349-355`). The bitmap is a plain `Image`, not a Group, so it should round-trip natively — confirm it does, and mirror the same override if it does not. A flag that silently fails to serialize means the bitmap reappears in the export of every non-active view.

Add one helper to `frontend/js/designer/src/App.jsx`:

```js
// Hide export-excluded objects, run fn, restore. Restoring in `finally` matters:
// a throwing render must never leave the customer's canvas with a hidden layer.
async function withoutExcludedObjects(canvas, fn) { … }
```

Applied to all **four** export render paths, and to neither thumbnail path:

| Call site | Excluded? |
|---|---|
| `fabricCanvasRef.toDataURL({ multiplier: 3 })` — `App.jsx:566` and `:723` | yes |
| `renderOffscreenExportPng` | yes |
| `renderOffscreenExportSvg` (feeds both `export_vector` variants) | yes |
| `toDataURL({ multiplier: 0.5 })` thumbnails, live and offscreen | **no** |

The thumbnail keeps the bitmap deliberately: it is what the customer sees in the cart and in My Account, so it should look like their design.

### 3c. Price exclusion

Both price counters classify by Fabric object type and exclude only `data.isZoneOverlay`:

- `frontend/js/designer/src/utils/priceCounts.js:15` (live preview)
- `Snelgraveren\ProductDesigner\Pricing\PriceCalculator::classify_object()`, `includes/Pricing/class-price-calculator.php:120` (authoritative, server-side)

An `Image` on the canvas is billable, so the bitmap background would silently add an image surcharge to every design. Both functions gain an early return on `data.templateArt`.

**Deliberately unchanged:** existing template `svg` layers stay billable. They are counted today; excluding them would change live prices on snelgraveren.nl, which nobody asked for.

---

## 4. Millimetre ruler

A shared component, `shared/js/mmRuler.js`, alongside the existing `shared/js/zoneContainment.js` — the established place for code both apps use.

### Scale without touching the zoom loop

`useCanvasScale` deliberately keeps React state out of the resize loop ("no React state in the loop, so resizes are instant"). The ruler must not force it to publish the zoom.

Instead the ruler observes the `<canvas>` element with its own `ResizeObserver` and derives everything from its rendered size:

```
mmPerScreenPx = width_mm / renderedCanvasWidthPx
heightMm      = width_mm * canvas_height / canvas_width     // square pixels
```

This works unchanged in the Template Builder, where the canvas is not zoomed at all.

### Rendering

- Two strips: one along the top, one along the left, rendered as inline SVG in the DOM — **never Fabric objects**, which would be serialized into the design and rendered into the export.
- Origin (0 mm) at the canvas top-left corner.
- Tick step chosen from `[1, 2, 5, 10, 20, 50, 100]` mm — the smallest value that keeps labelled ticks at least 40 px apart. Minor ticks at one fifth of the step, unlabelled.
- Labels are integers with the unit shown once per strip.

### Layout change

`useCanvasScale` currently observes `.pf-canvas-wrap`, which would grow to include the ruler strips and inflate the available-space measurement. `scaleContainerRef` moves onto the canvas cell of a CSS grid:

```
.pf-canvas-wrap
  └─ grid:  [corner] [top ruler]
            [left]   [canvas cell ← scaleContainerRef]
                         └─ .pf-canvas-scroll > canvas
```

### When there is no physical size

`width_mm` defaults to 0 and is only set by the LightBurn import or by hand in `ViewTabs.jsx`. With `width_mm <= 0` the ruler renders nothing. The Template Builder additionally shows a short hint next to the existing `width_mm` field explaining that filling it in enables the ruler.

### Visibility

- Template Builder: always shown (when `width_mm > 0`).
- Customer Designer: shown on desktop, hidden on mobile via the existing `useIsMobile` hook — `matchMedia`, per CLAUDE.md's mobile-detection rule, never `window.innerWidth`.

`width_mm` already reaches the customer: `RestTemplates::get_public_template()` includes it per view (`class-rest-templates.php:146`). No PHP work.

---

## 5. Text placed centred in the boundary

In the customer designer, the `add-text` tool currently sets `canvas.defaultCursor = 'crosshair'` and waits for a click, placing the text with its **top-left corner** on the clicked point (`DesignerCanvas.jsx:775`).

New behaviour: activating the tool places the text immediately, no click step.

- Target zone: the first zone whose `allowed_types` includes `text`.
- Anchor: `originX: 'center', originY: 'center'` at `zone.x + zone.width / 2`, `zone.y + zone.height / 2`.
- Created as `IText`, not `Textbox`, so the bounding box hugs the glyphs and grows as the customer types.
- Immediately `setActiveObject`, then `setActiveTool('select')` so it is ready to drag.
- Initial `fontSize`: `max(24, minimum from §9)`.

The same change applies to `add-curved-text`, which already uses `IText` and only needs the placement change.

`Textbox` was chosen originally to give text a fixed layout width. That width is what makes the selection box span the zone — and §6 shows it is also what makes text un-draggable inside shaped boundaries.

---

## 6. Text springing back inside SVG boundaries

### Root cause

For a zone with `boundary_type: 'svg'` and `behavior: 'restrict'`, `clampToZone` tests true shape containment (`DesignerCanvas.jsx:199-214`):

```js
const pts = objectSamplePoints(obj.getCoords());
if (pts.length && pointsInsideZoneShape(shape, zone, pts)) { …accept… }
if (obj._sgpdLastValid) { …snap back… }
```

`objectSamplePoints` (`shared/js/zoneContainment.js:56`) samples the object's four rotated bounding-box corners, the four edge midpoints and the centre. `pointsInsideZoneShape` requires **every** point to be inside the path.

A `Textbox` is created `zone.width - 20` wide. Its bounding box is therefore almost as wide as the zone's bounding box, so for any non-rectangular contour — a bone tag, an oval, a heart — the corners lie outside the outline by construction. Containment can never pass, and the object snaps back to `_sgpdLastValid` on every drag.

### Fix

1. **§5's `IText`** shrinks the bounding box to the actual glyph extent, which does fit inside a shaped boundary.
2. **Seed `_sgpdLastValid` at placement time.** It is currently only written on a successful containment test, so text that starts outside the shape has no anchor and falls through to the rectangular bbox clamp.
3. **Centre placement (§5)** starts the object at the most interior point of the zone, so the seeded anchor is valid from the first frame.

Now that layers are movable for customers (§7), the same failure applies to logo layers, and the same fix covers them.

### Verification

This is a bug, not a feature. It is fixed under `superpowers:systematic-debugging`: reproduce it first on the Docker environment with a real bone-shaped SVG boundary in restrict mode, confirm the root cause above from observed behaviour, then fix. No blind edits.

The identical clamp exists in the builder (`Canvas.jsx:131`) and gets the same treatment.

---

## 7. Locking: boundary only; layers always movable for the customer

### Current state

| | Template Builder | Customer Designer |
|---|---|---|
| Zone / boundary | `selectable: !zone.locked` etc. — `Canvas.jsx:354-358` | hardcoded `selectable: false, evented: false`, sent to back |
| Layers | `selectable: !layer.locked, evented: !layer.locked` on all six branches | **`layer.locked` is never read.** `svg` layers are hardcoded `templateLocked: true`; `text` layers are always editable |

### Target state

- **Boundary:** the lock toggle keeps driving the Template Builder, unchanged. In the customer Designer the boundary stays fixed under all circumstances.

  *Why not let the lock govern the customer side too:* `clampToZone` reads `zone.x` / `zone.y` from the template configuration, not from the rendered overlay object. A customer dragging the boundary would decouple the visible outline from the containment geometry, and saved designs would clamp against a boundary that is no longer where it is drawn.

- **Layers:** always selectable and movable for the customer, constrained to the boundary. The hardcoded `templateLocked: true` on template svg layers is removed; svg, image and text layers all get `applyPermissions(obj, type)` plus `clampToZone` when `zone.behavior === 'restrict'`.

  The bitmap background (§3a) is the single exception — it stays locked and at the back.

- **Z-order:** bitmap at the back, then svg and image layers, text on top. The existing "bring text to front after async template art loads" rule stays; without it a group's bounding-box hit area swallows clicks meant for the text underneath.

### The snapshot-restore hazard

After `loadFromJSON`, `DesignerCanvas.jsx:573` re-locks everything carrying `data.templateLocked`:

```js
canvas.getObjects().forEach((obj) => {
  if (obj.data?.templateLocked) obj.set({ selectable: false, evented: false, … });
});
```

**Designs already saved on snelgraveren.nl carry `templateLocked: true` in their stored JSON.** If that loop survives, those designs keep their logos frozen even after this change, and the loop would also re-freeze the new movable layers on every reopen. It must be narrowed to objects that are still meant to be locked — the bitmap background — rather than trusting the flag baked into old snapshots.

This is a save-path change touching stored customer designs. Per the `feedback_save_path_data_loss` lesson, the required proof before anything is deployed is: on the Docker environment, open an existing saved design, save it again, and confirm the content is preserved rather than emptied.

### Deliberately out of scope

No `move` permission is added to `PermissionsPanel`. Layers are movable for every template, including existing ones on the live site — that is the explicit decision.

---

## 8. Text layer form: no width, no X/Y

The Template Builder's `LayerDetail` text branch (`TreePanel.jsx:523`) offers **Width** (default 200), **X** and **Y** number inputs. With text centred by default and auto-sizing to its content, all three are noise.

- Remove the Width, X and Y fields from the text branch. The non-text branch keeps its coordinate row.
- Position is set by dragging on the canvas, which writes `left` / `top` as it does today.
- `AddLayerPanel.handleText` places new text at the zone centre instead of `zone.x + 20, zone.y + 20`.
- The builder canvas renders text layers as `IText` instead of `Textbox`, matching the customer designer, so the builder becomes WYSIWYG for text.

### Backwards compatibility

Existing template text layers were authored as a wide box plus an alignment, and `left` means the box's left edge. The customer designer already compensates with an anchoring calculation (`DesignerCanvas.jsx:479-497`) so the *visual* position survives the `Textbox` → `IText` switch.

New layers use an explicit marker instead of a second, implicit convention on the same field:

```js
{ originX: 'center', originY: 'center', left: <zone centre x>, top: <zone centre y> }
```

Both canvases read `layer.originX ?? 'left'` and `layer.originY ?? 'top'`. Layers without the field keep the existing anchoring path exactly; layers with it stay centred on their anchor as the text grows. No field carries two meanings.

---

## 9. Minimum font size in millimetres

### Setting

`globalConfig.permissions.text.min_font_size_mm` — a number, `0` meaning "no minimum". Edited in `PermissionsPanel.jsx`'s text fieldset, next to the existing min/max scale inputs. It reaches the customer through `global_config.permissions`, which is already delivered.

Millimetres rather than pixels: legibility when engraving is a physical property. The same pixel value means different real sizes on a 40 mm tag and a 300 mm board.

### Conversion

Per view, since `width_mm` is a per-view column:

```
pxPerMm = canvas_width / width_mm
minPx   = min_font_size_mm * pxPerMm
```

With `width_mm <= 0` there is no conversion and no minimum is enforced. The builder shows the same hint as the ruler (§4).

### Enforcement in the customer designer

The size input is not the only way to shrink text. Dragging a corner handle changes `scaleY`, not `fontSize`; the effective size is `fontSize × scaleY`. Both paths need covering:

1. **Input field** — `ElementTab.jsx:179` replaces the hardcoded `min="8"` with `Math.ceil(minPx)` and clamps the value on change.
2. **Handle scaling** — set `minScaleLimit` on text objects, which Fabric enforces natively during a scale gesture:
   ```js
   obj.minScaleLimit = Math.max(perms.min_scale ?? 0, minPx / obj.fontSize)
   ```
   Recomputed whenever `fontSize` changes, since the ratio depends on it.
3. **New text** starts at `max(24, minPx)` (§5).
4. **Engraving text** (`data.elementType === 'engraving-text'`) gets the same minimum on its own `engravingFontSize` input — it is the case the rule exists for.

### Existing designs below the minimum

A saved design that already contains text below the new minimum opens unchanged. Silently resizing a customer's saved design is worse than showing it as they left it. The minimum applies from the next edit onward.

### Template Builder

The builder does not block the merchant from authoring small text — they are the one setting the rule. It shows a warning on a text layer whose size falls below the template's own minimum.

---

## Files touched

**JavaScript**
- `admin/js/template-builder/src/utils/lbrnParser.js` — Bitmap branch (§1)
- `admin/js/template-builder/src/components/ImportLightBurn.jsx` — media upload, layer defaults (§1)
- `admin/js/template-builder/src/components/Canvas.jsx` — opacity, `IText` for text layers, clamp seeding (§2, §6, §8)
- `admin/js/template-builder/src/components/TreePanel.jsx` — opacity slider, text-form fields, centred `handleText` (§2, §8)
- `admin/js/template-builder/src/components/ViewTabs.jsx` — `width_mm` hint (§4)
- `admin/js/template-builder/src/components/PermissionsPanel.jsx` — `min_font_size_mm` (§9)
- `frontend/js/designer/src/components/DesignerCanvas.jsx` — image branch, locking, placement, clamp (§3, §5, §6, §7)
- `frontend/js/designer/src/components/tabs/ElementTab.jsx` — font-size minimum (§9)
- `frontend/js/designer/src/App.jsx` — export exclusion helper (§3)
- `frontend/js/designer/src/hooks/useCanvasScale.js` — measured element moves to the canvas cell (§4)
- `frontend/js/designer/src/utils/priceCounts.js` — `templateArt` exclusion (§3)
- `shared/js/mmRuler.js` — **new** (§4)

**PHP**
- `includes/Pricing/class-price-calculator.php` — `templateArt` exclusion in `classify_object()` (§3)

**CSS**
- `admin/js/template-builder/src/builder.css` and the frontend designer stylesheet — ruler grid and strips (§4)

No database migration. No REST schema change.

---

## Implementation order

Nine sections is more than one sitting. They are grouped so that each phase is independently verifiable and independently deployable, and so the riskiest change lands last with the most attention on it.

1. **Bitmap pipeline** — §1, §2, §3. Self-contained: parser, upload, opacity, customer rendering, export and price exclusion. Touches no existing behaviour except removing a warning.
2. **Ruler** — §4. Purely additive UI in both apps; nothing else depends on it.
3. **Text placement and form** — §5, §8, §9. Changes how new text is created and configured; existing layers keep their anchoring path.
4. **Locking and dragging** — §6, §7. The only phase that touches stored customer designs, and the only one gated on the save-path regression proof.

## Testing

**Automated (jest, `npm test`)**
- `tests/js/utils/lbrnParser.test.js` — a fixture containing a `Type="Bitmap"` shape asserts: the emitted centre matches the XForm translation, `scaleX/scaleY` reproduce `W`/`H` in millimetres from the PNG's intrinsic pixels, a rotated XForm yields the right `angle`, and the bitmap widens the union bbox when it extends past the vectors.
- New `tests/js/utils/mmRuler.test.js` — tick-step selection across canvas widths and `width_mm` values; asserts labelled ticks never fall below the 40 px spacing floor and that `width_mm = 0` produces no ticks.
- `tests/js/utils/priceCounts.test.js` — an object carrying `data.templateArt` is not counted.

**Manual (Docker: `docker compose up -d`)**

Docker must be running; ask before assuming it is.

1. Import `borrelplank.lbrn2` in the Template Builder — bitmap appears as the bottom layer, aligned with the vectors, no warning.
2. Opacity slider and eye toggle both affect the canvas; both survive save and reload.
3. Customer designer shows the bitmap behind the artwork; it is not selectable and clicks pass through to the text above it.
4. Save a design, then export PDF/PNG/SVG from the order — **no bitmap in any of the three**, but the cart thumbnail does show it.
5. Cart price is unchanged by the presence of the bitmap.
6. Ruler shows correct millimetres in both apps; a 100 mm span measures 100 mm against a physical ruler held to the screen at 100 % zoom.
7. Ruler disappears on a view with `width_mm = 0` and on a mobile viewport.
8. Adding text lands it centred with a box that hugs the glyphs.
9. Text and logos drag freely inside a bone-shaped SVG boundary in restrict mode, and stop at its outline.
10. **Regression, mandatory before deployment:** open a design saved *before* this change, confirm it renders as saved, save it again, reload — content preserved, not emptied.
11. Font size cannot be set or scaled below the template minimum, through the input or the corner handles.

**Live deployment**

Standard sequence from CLAUDE.md: `bash bin/package.sh`, upload the ZIP from the project directory choosing "replace current", then LiteSpeed Purge All. Verify the active version on `plugins.php` afterwards.

---

## Risks

| Risk | Mitigation |
|---|---|
| The snapshot re-lock loop freezes existing customer designs (§7) | Step 10 of manual testing is a hard gate before deployment |
| Media upload fails for shop managers without `upload_files` | Per-layer skip with a warning; the vector import always completes |
| Making logos movable surprises customers on live templates | Explicitly chosen; flagged here so it is a decision, not an accident |
| Large bitmaps slow the designer | The PNG is served as a URL and browser-cached, not inlined; no size limit is imposed beyond WordPress's own upload limit |
| The `Textbox` → `IText` switch shifts existing template text | The existing alignment-anchor calculation preserves visual position; verified in manual step 8 against a template authored before the change |
