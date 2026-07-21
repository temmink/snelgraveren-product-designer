# "Use Selected Layers as Boundary" — Design Spec

**Date:** 2026-07-21
**Status:** Draft
**Scope:** A Pro-gated Template Builder action that converts one or more selected vector (SVG) layers on the current view into a single SVG boundary (safe area / clip zone), reusing the existing `boundary_type: 'svg'` zone model with inline SVG markup.

## Goal

After importing artwork (e.g. a LightBurn `.lbrn2` file) or placing clip art, a merchant often wants the shape's outline to also act as the placement boundary — the region customer content must stay inside (or be clipped to). Today a boundary is either a rectangle or a separately uploaded SVG file. This feature lets the merchant select existing vector layers already on the canvas and turn them into a boundary in one click, without leaving the builder or hand-authoring an SVG.

## Decisions (locked)

1. **Non-destructive** — the selected source layers stay visible and editable. The boundary is added as a separate overlay zone using the same geometry. (The source outline is often also the engraving/print artwork, so it must not be consumed.)
2. **Vector/SVG layers only** — only `type: 'svg'` layers contribute geometry. Selected `text`/`image` layers are ignored with a notice. (Text-to-outline needs glyph paths; out of scope, YAGNI.)
3. **Merge into one boundary** — all eligible selected layers become a single zone (one merged SVG shape), matching the natural reading of "multiple layers as a boundary".
4. **Inline SVG storage** — the new zone stores `svg_markup` inline in `zones_config` (no media-library upload), consistent with how imported LightBurn layers already store inline `svg_markup`. This avoids dependence on WordPress core SVG-mime upload settings and avoids orphaned media files.
5. **Default type/behavior: Safe Area + Restrict** — editable afterwards in the existing Boundary form (type, behavior, name, scale). No new configuration UI.
6. **Pro (premium) feature** — the action is gated behind premium, consistent with the SVG-boundary option and the LightBurn import.

## Persistence model (reuses existing SVG-boundary zone)

The Template Builder stores zones in `wp_pf_template_views.zones_config[]`. The existing SVG boundary uses:

```
{ type, behavior, boundary_type: 'svg',
  svg_url, svg_path_data, svg_intrinsic_width, svg_intrinsic_height,
  x, y, width, height, svg_scale, svg_rotation }
```

This feature produces the **same shape** but with `svg_markup` (inline standalone `<svg>`) instead of `svg_url`:

```
{ type: 'safe_area', behavior: 'restrict', boundary_type: 'svg',
  svg_markup,                       // standalone <svg> containing all merged paths
  svg_intrinsic_width, svg_intrinsic_height,
  x, y, width, height,              // union bbox in canvas px
  svg_scale: 1 }
```

`svg_url` is simply absent. Every renderer must therefore treat `svg_url` **or** `svg_markup` as the boundary source.

**Note on `svg_path_data`:** the existing SVG-boundary code stores a `svg_path_data` field but never reads it — the clip mask is built by *cloning the already-rendered zone object* (`Canvas.jsx`, `applyZoneClip`), not from `svg_path_data`. This feature therefore does **not** generate `svg_path_data`; the clip works from the rendered `svg_markup` boundary object exactly as it does for uploaded SVG boundaries.

## Geometry merge

Given the eligible selected Fabric objects (elementType `svg`), each with a Fabric group built from its `svg_markup` and positioned by `left/top/scaleX/scaleY`:

1. For each object, extract its path `d` string(s) from the stored layer `svg_markup`.
2. Transform each path into a common canvas-pixel space using that object's current `left/top/scaleX/scaleY` (the object's on-canvas transform), so the merged geometry matches what the merchant sees. **Rotation is not applied in v1** — `angle` is ignored (imported LightBurn/clip-art layers are unrotated). A rotated source layer produces an axis-aligned boundary from its unrotated geometry; documented as a v1 limitation rather than silently mis-transformed.
3. Compute the **union bounding box** of all transformed paths → `x, y` (top-left) and `width, height`. `svg_intrinsic_width/height` = `width/height` (scale baked in; `svg_scale: 1`).
4. Emit `svg_markup`: one standalone `<svg width height viewBox="0 0 width height">` whose paths are expressed **relative to the bbox top-left** (local 0..width / 0..height), `fill="none"` (boundary is an outline; fill/stroke styling is applied at render by `zoneStyleFor`). The zone is positioned on canvas at `left = x, top = y`, so local coordinates land correctly.

The merge lives in a pure, testable module (no Fabric, no React): input = array of `{ svgMarkup, left, top, scaleX, scaleY }`, output = `{ svg_markup, x, y, width, height }`.

## Architecture

### New / changed components

1. **`admin/js/template-builder/src/utils/mergeLayersToBoundary.js`** (new, pure) — `mergeLayersToBoundary(items) → { svg_markup, x, y, width, height } | null`. Parses each item's `svg_markup` for `<path d>`, applies the item transform, unions the bbox, returns the merged inline SVG plus its canvas-space bounding box. Returns `null` when no path geometry is found.

2. **Canvas toolbar action** (`admin/js/template-builder/src/components/Canvas.jsx` or its toolbar) — a Pro-gated **"Use as boundary"** button, enabled only when the current selection contains ≥1 eligible object. On click:
   - Read `canvas.getActiveObjects()`; split into eligible (`data.elementType === 'svg'` with a stored `svg_markup`) and ignored.
   - If no eligible objects → notice ("Select at least one vector layer."), stop.
   - Map each eligible object to `{ svgMarkup, left, top, scaleX, scaleY }` (svgMarkup from the corresponding layer in the store), call `mergeLayersToBoundary`.
   - `addZone(currentViewIndex, { type:'safe_area', behavior:'restrict', boundary_type:'svg', svg_markup, svg_intrinsic_width, svg_intrinsic_height, x, y, width, height, svg_scale:1 })`.
   - Notice summarising result (+ how many non-vector layers were ignored, if any).
   - Source layers are left untouched (non-destructive).

3. **Builder zone render** (`admin/js/template-builder/src/components/Canvas.jsx`, zone sync effect) — the `boundary_type === 'svg'` branch currently requires `zone.svg_url`. Change the guard to `zone.svg_url || zone.svg_markup`, and render via `loadSVGFromString(zone.svg_markup)` when `svg_url` is absent (mirroring the existing inline-svg **layer** branch). Positioning/scale/rotation and `zoneStyleFor` styling stay identical. The clip logic is unchanged — it clones the rendered zone object, which now exists regardless of source.

4. **Frontend zone render** (`frontend/js/designer/src/components/DesignerCanvas.jsx`) — the customer designer's SVG-boundary rendering path gains the same `svg_markup` fallback so imported/merged boundaries render and clip for customers.

5. **Server sanitisation** (`includes/API/class-rest-templates.php`, `sanitize_zone_layers`) — currently sanitises each **layer's** `svg_markup`. Extend it so a **zone's own** `svg_markup` is also run through `enshrined\svgSanitize\Sanitizer` on view create/update (and dropped if the sanitiser class is unavailable).

### Data flow

```
merchant selects vector layers → clicks "Use as boundary"
  → getActiveObjects() (filter elementType 'svg')
  → mergeLayersToBoundary(items)          // paths → transformed → union bbox → {svg_markup, x,y,w,h}
  → addZone(view, { boundary_type:'svg', svg_markup, ... })
  → zones_config[] (store)
  → builder renders boundary from svg_markup + clips content to it
  → template save → server sanitises zone.svg_markup
  → frontend designer renders + clips customer content to the boundary
```

## Premium gating

The button is rendered/enabled only when the builder config reports premium (same flag gating the SVG-boundary option and the LightBurn import). This is a UX/feature gate; the produced content is a normal template save.

## Scope (v1)

**In:** merge ≥1 selected `svg` layers into one inline SVG boundary; non-destructive; default Safe Area + Restrict; builder + frontend render + clip; server sanitisation of zone `svg_markup`.

**Out (YAGNI):** text→outline or image→bbox boundaries; one-boundary-per-layer mode; rotated source layers (angle ignored); boolean union/simplification of overlapping paths (paths are concatenated, not geometrically merged — overlapping fills use even-odd/nonzero as the browser renders, which is fine for a clip/outline); converting an existing rectangle boundary; editing the merged geometry after creation (delete + redo instead).

## Error handling & notices

- **No selection / no eligible layers** → notice, nothing added.
- **Some non-vector layers selected** → they are ignored; notice states how many.
- **Merge yields no geometry** (no `<path>` found) → notice, nothing added.
- **Boundary extends beyond the canvas** → allowed (same as manual boundaries).

## Security

`svg_markup` on a zone is admin-authored but served to every customer's browser, so it MUST be sanitised server-side on save with `enshrined\svgSanitize\Sanitizer` (already used for layer `svg_markup` and uploads), stripping `<script>`, `on*` handlers, external refs, `foreignObject`, and `data:` URIs. The generator only emits `<svg><path>` markup. Sanitisation happens on WRITE so stored data is always clean.

## Testing

- **Unit (pure, no DOM/Fabric)** — `tests/js/utils/mergeLayersToBoundary.test.js`:
  - Two simple single-path layers at different `left/top` → merged `svg_markup` contains both paths; `x/y/width/height` equal the union bbox; local path coordinates are relative to the bbox top-left (start at 0).
  - A layer with `scaleX/scaleY ≠ 1` → transformed coordinates reflect the scale.
  - Mixed input where one item has no `<path>` → skipped; all-empty input → returns `null`.
- **PHP / manual** — a zone whose `svg_markup` contains `<script>` is stored stripped of the script (extends the existing layer sanitisation test).
- **Manual (dev):** import the LightBurn lion → select the outer ring layer(s) → "Use as boundary" → a Safe Area appears; drop a text object and confirm it is restricted to the ring; the source ring layers remain; save + reopen preserves the boundary; open the template in the frontend designer and confirm the boundary renders and restricts/clips customer content.

## Non-goals

- No new boundary-configuration UI (reuses the existing Boundary form for type/behavior/name/scale edits).
- No media-library upload.
- No geometric boolean union or path simplification.
