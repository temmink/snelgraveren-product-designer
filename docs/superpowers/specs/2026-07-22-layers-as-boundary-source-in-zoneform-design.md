# Select Imported SVG Layers as a Boundary Source (ZoneForm) — Design Spec

**Date:** 2026-07-22
**Status:** Draft
**Scope:** In the admin Template Builder's Boundary form (`ZoneForm`), when the boundary type is **SVG Shape**, add a second source next to "Upload SVG": pick one or more of the current view's imported SVG layers and merge them into the boundary shape. Admin/template-authoring only.

## Goal

Today a merchant defining an SVG-shaped boundary can only upload an SVG file. But the artwork whose outline should be the boundary is often already on the canvas — e.g. a LightBurn `.lbrn2` import. This feature lets the merchant select those existing SVG layers directly in the Boundary form and use their combined outline as the boundary, without exporting/uploading a separate file. It complements the existing canvas-toolbar "Use as Boundary" quick action (kept) by integrating the same capability into the add/edit-boundary flow, where type/behavior/name are set together.

## Decisions (locked)

1. **Source switch (Upload / From layers)** — when boundary type is SVG Shape, a small toggle chooses the source. "Upload SVG" shows the existing media picker; "From layers" shows a checklist of the view's SVG layers. Exactly one source is active at a time.
2. **Keep the toolbar action** — the canvas "Use as Boundary" button from 1.5.0 stays as a quick path; this adds a second, form-integrated path to the same result.
3. **Vector/inline layers only** — the checklist lists only layers with `type: 'svg'` AND inline `svg_markup` (the LightBurn-imported layers). URL-based SVG layers (clip art, `svg_url` only) are not offered in v1, matching "imported SVG layers".
4. **Admin only** — this is authoring UI in the Template Builder. No customer/frontend change: the frontend already renders inline `svg_markup` boundaries (shipped 1.5.0).
5. **Reuse the 1.5.0 pipeline** — merging uses the existing `mergeLayersToBoundary` util; the produced zone uses the existing inline-`svg_markup` SVG-boundary model (stored, rendered, clipped, and server-sanitised exactly as an uploaded SVG boundary). No backend change.

## Persistence model (unchanged, reused)

The boundary produced from layers is the SAME shape an uploaded SVG boundary produces, but inline. The zone (in `zones_config[]`) gets:

```
{ …, boundary_type: 'svg',
  svg_markup,                       // merged standalone <svg> (from mergeLayersToBoundary)
  svg_intrinsic_width, svg_intrinsic_height,
  x, y, width, height,              // union bbox of the selected layers, canvas px
  svg_scale: 1,
  svg_url: '' }                     // cleared — inline source
```

`svg_url` and `svg_markup` are mutually exclusive on a zone: applying layers clears `svg_url`; uploading a file (existing flow) leaves `svg_markup` untouched — the switch to "Upload" clears `svg_markup`. `svg_path_data` is not produced (never read; see the 2026-07-21 spec).

Which specific layers were selected is **not** persisted — only the merged `svg_markup`. Re-opening a layer-based boundary shows the current shape as a preview; re-picking layers rebuilds it. (YAGNI: no per-layer provenance.)

## Architecture

### Components

1. **`admin/js/template-builder/src/utils/mergeLayersToBoundary.js`** (existing, from 1.5.0) — reused unchanged. `mergeLayersToBoundary(items) → { svg_markup, x, y, width, height } | null`, where each item is `{ svgMarkup, left, top, width, height, scaleX, scaleY }` in canvas px. It bakes each item's translate+scale into the path coordinates.

2. **New small pure helper** `admin/js/template-builder/src/utils/layerBoundaryItems.js`:
   - `svgMarkupIntrinsicSize(svgMarkup) → { width, height }` — parse the `width="…" height="…"` (or viewBox) of a layer's inline `<svg>` to get its intrinsic px size.
   - `layerToBoundaryItem(layer) → { svgMarkup, left, top, width, height, scaleX, scaleY }` — build a `mergeLayersToBoundary` item from a stored svg layer descriptor: `left = layer.left`, `top = layer.top`, `scaleX = layer.scaleX || 1`, `scaleY = layer.scaleY || 1`, `width = intrinsicW * scaleX`, `height = intrinsicH * scaleY`. (Stored layer `left/top` are already canvas-absolute, so — unlike the toolbar path — no Fabric `getBoundingRect`/ActiveSelection handling is needed.)
   Pure, unit-testable, no React/Fabric/DOM beyond string parsing.

3. **`admin/js/template-builder/src/components/ZoneForm.jsx`** — the UI:
   - Read `views` and `currentViewIndex` from `useTemplateStore` (already imports the store).
   - Collect eligible layers: flatten `views[currentViewIndex].zones_config[*].layers[*]`, keep `layer.type === 'svg' && layer.svg_markup`.
   - When `boundary_type === 'svg'`, render a source toggle (`Upload SVG` / `From layers`). Local UI state `svgSource` initialised from the current data (`svg_markup` present → 'layers', else 'upload').
   - **Upload mode:** the existing upload button/preview (unchanged).
   - **Layers mode:**
     - If no eligible layers → a hint message.
     - Else a checklist: one row per eligible layer with a checkbox, a small inline-SVG thumbnail (rendered from `layer.svg_markup`), and a label `Layer N` (imported svg layers carry no per-layer name). Local UI state `selectedKeys` (a Set of composite `"${zoneIndex}:${layerIndex}"` keys — deterministic, independent of any `_key`).
     - On any checkbox change: rebuild the merge from the checked layers. If ≥1 checked and merge succeeds, `setData` → `{ …, boundary_type:'svg', svg_markup, svg_intrinsic_width, svg_intrinsic_height, x, y, width, height, svg_scale:1, svg_url:'' }` and call `onChange(next)` (same multi-field pattern as the upload flow). If none checked, clear `svg_markup` (and leave the shape empty until a pick).
     - A small live preview of the merged `svg_markup`.
   - Switching source toggle from `layers` → `upload` clears `svg_markup`; `upload` → `layers` clears `svg_url` (and the media preview). The form always saves exactly one source.

### Data flow

```
merchant: Add/Edit Boundary → Boundary = SVG Shape → source = From layers
  → ZoneForm reads views[currentViewIndex].zones_config[*].layers, filters svg+svg_markup
  → merchant checks one or more layers
  → items = selected.map(layerToBoundaryItem)
  → mergeLayersToBoundary(items) → { svg_markup, x, y, width, height }
  → setData({ boundary_type:'svg', svg_markup, svg_intrinsic_*, x, y, width, height, svg_scale:1, svg_url:'' })
  → Save Boundary → addZone/updateZone (existing) → zones_config[]
  → builder + frontend render the inline svg_markup boundary (existing, 1.5.0)
  → template save → server sanitises zone svg_markup (existing, 1.5.0)
```

### Premium gating

The SVG Shape boundary option is already gated behind premium (`window.sgpdTemplateBuilder?.isPremium`, existing). The layers source lives inside that gated section, so it inherits the gate. No new server enforcement.

## Scope (v1)

**In:** source toggle in ZoneForm for SVG-shape boundaries; checklist of the current view's `svg` layers that have `svg_markup`, with thumbnails; multi-select; live merge into the zone's inline `svg_markup` + bbox; live preview; mutual exclusivity of `svg_url`/`svg_markup`.

**Out (YAGNI):** URL-based (clip-art) svg layers as a source; persisting which layers were selected; editing/individually transforming the merged shape; rotation (inherits the merge util's v1 limitation — layer `angle` not applied); any frontend/customer change.

## Error handling & messages

- **No eligible layers on the view** → informational hint in Layers mode; upload remains available.
- **Merge yields nothing** (no `<path>` in the selected layers) → treat as no selection; do not write `svg_markup`.
- **Layer `svg_markup` without a parseable size** → skip that layer from the merge (its item can't be sized); if all skipped, behave as no selection.

## Security

No new server surface. The produced `svg_markup` is the parser's own `<svg><path>` output and is sanitised on save by the existing `sanitize_zone_layers` (extended in 1.5.0 to cover a zone's own `svg_markup`).

## Testing

- **Unit (pure, no DOM/Fabric)** — `tests/js/utils/layerBoundaryItems.test.js`:
  - `svgMarkupIntrinsicSize` — parses `width="60" height="40"` → `{width:60,height:40}`; falls back to viewBox `0 0 60 40`; returns null/0 when unparseable.
  - `layerToBoundaryItem` — a layer `{ svg_markup:'<svg width="10" height="10" viewBox="0 0 10 10">…', left:20, top:5, scaleX:2, scaleY:2 }` → item `{ left:20, top:5, width:20, height:20, scaleX:2, scaleY:2, svgMarkup:… }`.
  - Integration through the existing `mergeLayersToBoundary`: two layer descriptors → a merged boundary whose bbox equals the union of their canvas rects.
- **Manual (dev, admin only):** import the LightBurn lion → Add Boundary → SVG Shape → From layers → the checklist lists the 46 svg layers with thumbnails → check the outer ring (and optionally more) → the boundary preview + canvas boundary match the selection at the right size → Save → reopen the template and confirm the boundary persists and restricts content. Confirm the Upload path still works and that switching sources keeps exactly one active.

## Non-goals

- No change to the customer/frontend designer (boundary rendering already shipped in 1.5.0).
- No new REST endpoint or DB column.
- No removal of the canvas "Use as Boundary" toolbar action.
