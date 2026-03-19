# Admin Template Builder Redesign — Design Spec

**Date:** 2026-03-18
**Status:** Draft
**Scope:** Zone enforcement, tree UI, SVG zone boundaries

---

## Summary

Redesign the admin template builder sidebar and canvas to:
1. Enforce zone restrictions (clip, clamp, scale limits) identically to the frontend designer
2. Replace the flat Zones/Layers tabs with a tree-style parent/child UI
3. Support SVG shapes as zone boundaries

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Zone enforcement mode | Toggle — WYSIWYG default, "Free Move" for flexibility | Admins need to see what customers see, but also need freedom for precise positioning |
| Tree layout style | Tree + inline actions (visibility, lock, delete on hover) | Functional without clutter |
| Layers without zones | Every layer must belong to a zone | Clean model, forces intentional template design |
| SVG zone workflow | Form-first — boundary type toggle in zone properties | Zone properties panel is the single source of truth |
| SVG clipping strategy | SVG path as Fabric.js clipPath, bounding box for clamping | Accurate clipping, performant clamping |
| SVG complexity | Single closed path only | Reliable clipping, avoids multi-path edge cases |
| Layer reordering | Drag between zones, inherits new zone's restrictions | Full flexibility with automatic restriction inheritance |

## Architecture

### Approach: Incremental (3 Phases)

Each phase is independently testable and shippable. Phases have clear dependencies:
Phase 1 → Phase 2 → Phase 3.

---

## Phase 1: Zone Enforcement

**Goal:** Make the admin canvas behave like the frontend designer.

### Changes to Canvas.jsx

Port the following behaviors from `frontend/js/designer/src/components/DesignerCanvas.jsx`:

1. **ClipPath on layers** — When a layer is added to a zone with `behavior: 'restrict'`, apply a `Rect` clipPath with `absolutePositioned: true` matching the zone bounds.

2. **Clamp-to-zone on `object:moving`** — Use `getBoundingRect()` to keep the object fully inside its assigned zone.

3. **Scale clamping on `object:scaling`** — Enforce `min_scale`/`max_scale` from zone permissions. If the scaled bounding rect exceeds zone bounds, scale down to fit.

4. **Snap-to-grid** — If `permissions[elementType].snap_to_grid` is true, round position to nearest `grid_size`.

5. **`text:changed` max_chars** — Truncate text content if it exceeds `max_chars`.

6. **"Free Move" toggle button** — Added to the canvas toolbar.
   - When ON: Disable clipPath rendering and clamping. Zone outlines switch to dashed stroke. Cursor is unrestricted.
   - When OFF: Re-apply clipPaths and clamp all objects back into their zones. This creates a single undo snapshot after all objects are clamped.

### Fabric Object Data Convention

All fabric objects created by the admin canvas must include `data.elementType` (`'text'`, `'image'`, or `'svg'`) and `data.zoneIndex` (index into `zones_config`). This aligns with the frontend convention and enables permission lookups.

### Handling Unassigned Layers (Phase 1 Only)

In Phase 1, the store still uses flat `layers_config`. When creating fabric objects for layers, assign each layer to the zone that contains its `(left, top)` position. If no zone contains it, skip enforcement for that layer (no clipPath, no clamping). This is a temporary state — Phase 2 makes zone assignment mandatory.

### Store Changes

Add to `useTemplateStore.js`:
- `isFreeMove: false` — UI state flag
- `setFreeMove: (v) => set({ isFreeMove: v })`

### Files Affected

- `admin/js/template-builder/src/components/Canvas.jsx` — Main changes
- `admin/js/template-builder/src/store/useTemplateStore.js` — `isFreeMove` state

---

## Phase 2: Tree UI

**Goal:** Replace separate Zones and Layers tabs with a unified tree panel.

### Store Shape Change

**Before (flat):**
```js
view: {
  zones_config: [zone, zone],
  layers_config: [layer, layer],
}
```

**After (nested):**
```js
view: {
  zones_config: [
    { ...zone, layers: [layer, layer] },
    { ...zone, layers: [layer] },
  ],
}
```

The `layers_config` field at the view level is removed. Layers are nested inside their parent zone's `layers` array.

### Migration

On `loadFromApi`, if a template has the old flat structure (`layers_config` at view level):
1. For each layer, find the zone whose bounding box contains the layer's center point `(left + width/2, top + height/2)`. If multiple zones overlap, pick the smallest-area zone (most specific match).
2. Assign the layer to that zone's `layers` array.
3. If no zone contains the layer, assign it to the first zone (since every layer must belong to a zone). Log a console warning.
4. Remove `layers_config` from the view level.

The migration is idempotent — it runs on every load until the template is saved. It does not auto-save or mark `isDirty`. Console warnings only appear on templates that still have the old flat format.

### DB Schema & REST API Changes

The `zones_config` JSON column in `wp_pd_template_views` absorbs the nested layers. The `layers_config` column remains in the DB for backward compatibility but is no longer written to for new saves.

**Save flow changes:**
- The save handler in `App.jsx` serializes the nested structure: `zones_config` includes each zone's `layers` array. The `layers_config` field is omitted from the API payload (or sent as an empty array).
- The REST API endpoint (`class-rest-templates.php`) must be updated:
  - On **write**: Accept `zones_config` containing nested layers. Stop expecting `layers_config` as a separate field.
  - On **read**: If the stored `zones_config` does not contain `layers`, fall back to reading `layers_config` and merging (server-side migration for API consumers).
- The `TemplateRepository::create_view()` and `update_view()` methods continue writing `zones_config` and `layers_config` to their respective columns. For new templates, `layers_config` is written as `[]`.

**Frontend designer compatibility:**
- The frontend `DesignerCanvas.jsx` reads zones from `zones_config`. Pre-placed template layers (from admin) are now nested inside zones. The frontend must read `zone.layers` to render pre-placed layers. If `zone.layers` is absent, fall back to top-level `layers_config` for backward compatibility.

### Guard: No Zones Exist

If a view has zero zones, the "Add Layer" action is unavailable. The tree panel shows a prompt: "Add a zone first to place layers." The zone form's "Add Zone" button remains always accessible.

### New Components

**TreePanel.jsx** — Replaces `ZoneList.jsx` + `LayerPanel.jsx` in the sidebar.
- Renders the view's zones as collapsible parent nodes
- Each zone shows its child layers indented
- Click a node to show its properties in a detail panel below the tree
- "Add Zone" button at the bottom (opens zone form)

**TreeNode.jsx** — Recursive component for a single tree node (zone or layer).
- Shows node name with type icon (zone: ▢, text: T, image: 🖼)
- Inline actions on hover: visibility toggle (👁), lock toggle (🔒), delete (🗑)
- For zones: "Add Layer" action (+ icon)
- Drag handle for reordering

### Drag & Drop

- Layers can be reordered within a zone (changes `z_order`)
- Layers can be dragged between zones:
  - On drop: update layer's parent zone reference
  - Re-apply new zone's clipPath
  - Clamp layer position to new zone bounds
- Zones can be reordered within a view (changes `sort_order`)
- Use `@dnd-kit/core` + `@dnd-kit/sortable` for accessible drag-and-drop with nested tree support

### Store Changes

Updated actions in `useTemplateStore.js`:

- `addLayer(viewIndex, zoneIndex, layer)` — Now takes `zoneIndex` parameter
- `updateLayer(viewIndex, zoneIndex, layerIndex, patch)` — Now takes `zoneIndex`
- `removeLayer(viewIndex, zoneIndex, layerIndex)` — Now takes `zoneIndex`
- `moveLayer(viewIndex, fromZoneIndex, fromLayerIndex, toZoneIndex, toLayerIndex)` — Supports cross-zone moves
- Remove old flat `addLayer`, `updateLayer`, `removeLayer`, `moveLayer`

Canvas fabric objects must store both `data.zoneIndex` and `data.layerIndex` so that the `object:modified` handler can call `updateLayer(viewIndex, zoneIndex, layerIndex, patch)` correctly.

### Files Affected

- `admin/js/template-builder/src/components/TreePanel.jsx` — New
- `admin/js/template-builder/src/components/TreeNode.jsx` — New
- `admin/js/template-builder/src/App.jsx` — Replace zone/layer tabs in sidebar with TreePanel
- `admin/js/template-builder/src/store/useTemplateStore.js` — Store shape change + new actions
- `admin/js/template-builder/src/components/Canvas.jsx` — Read layers from nested zones
- `admin/js/template-builder/src/components/ZoneList.jsx` — Remove
- `admin/js/template-builder/src/components/LayerPanel.jsx` — Remove
- `admin/js/template-builder/src/components/ZoneForm.jsx` — Keep, used as detail panel when zone is selected

### Files Removed

- `admin/js/template-builder/src/components/ZoneList.jsx`
- `admin/js/template-builder/src/components/LayerPanel.jsx`

---

## Phase 3: SVG Zone Boundaries

**Goal:** Allow admins to upload SVG shapes as zone boundaries instead of only rectangles.

### Zone Data Model Extension

New fields in zone objects within `zones_config`:

```js
{
  // Existing fields
  name: 'Dog Tag Shape',
  type: 'safe_area',
  behavior: 'restrict',
  x: 100,           // bounding box position
  y: 50,
  width: 200,       // bounding box size
  height: 300,
  allowed_types: ['text', 'image'],

  // New fields
  boundary_type: 'rect',        // 'rect' | 'svg'
  svg_url: '',                  // URL to the uploaded SVG file
  svg_path_data: '',            // Extracted `d` attribute from the SVG's <path>
  svg_scale: 1,                 // Uniform scale (aspect ratio locked) applied by admin
  svg_rotation: 0,              // Rotation in degrees applied by admin
}
```

### SVG Upload Workflow (Form-First)

1. In the zone properties form, admin selects **Boundary Type**: `Rectangle` (default) or `SVG Shape`.
2. When "SVG Shape" is selected, an upload field appears: "Upload SVG or choose from Media Library."
3. On upload:
   a. Server-side: SVG is sanitized (existing `UploadValidator` pipeline).
   b. Client-side: Parse the SVG, extract the first `<path>` element with a closed `d` attribute.
   c. If no valid path found, show error: "SVG must contain a single closed path."
   d. Store `svg_url` and `svg_path_data` in zone config.
4. The SVG shape appears on the canvas as the zone boundary (replacing the rectangle).
5. Admin can select the zone shape on canvas and scale/rotate it for correct placement.
6. The bounding box (`x`, `y`, `width`, `height`) is auto-calculated from the SVG path's bounding box after transform.

### Canvas Rendering

- **Rectangle zones:** Rendered as `Rect` objects (unchanged).
- **SVG zones:** Rendered as `Path` objects using `svg_path_data`, with `svg_scale` and `svg_rotation` transforms applied.
  - Fill: `rgba(59, 130, 246, 0.08)` (same as frontend)
  - Stroke: `#3b82f6`
  - `selectable: true` (admin can reposition/scale/rotate)
  - `evented: true`

### ClipPath for SVG Zones

When applying clipPath to a layer inside an SVG zone:

```js
// Instead of:
obj.clipPath = new Rect({ left, top, width, height, absolutePositioned: true });

// Use:
obj.clipPath = new Path(zone.svg_path_data, {
  left: zone.x,
  top: zone.y,
  scaleX: zone.svg_scale,
  scaleY: zone.svg_scale,
  angle: zone.svg_rotation,
  absolutePositioned: true,
});
```

### Clamping

SVG zones use their bounding box (`x`, `y`, `width`, `height`) for clamping — same algorithm as rectangular zones. The bounding box is recalculated whenever the SVG is scaled or rotated.

### New Utility

**`svgPathUtils.js`** — Helper module for SVG path operations:

- `extractClosedPath(svgString)` — Parse SVG markup, find first `<path>` whose `d` attribute is a single closed subpath (exactly one `M`/`m` command and ends with `Z`/`z`, after trimming whitespace). Multi-subpath or unclosed paths are rejected with a user-friendly error. Returns `{ pathData, viewBox }` or `null`.
- `pathToBoundingBox(pathData, scale, rotation)` — Instantiate a temporary `fabric.Path`, apply transforms, and use `getBoundingRect()` to compute the axis-aligned bounding box. No custom math needed.

### Files Affected

- `admin/js/template-builder/src/components/ZoneForm.jsx` — Boundary type toggle + SVG upload field
- `admin/js/template-builder/src/components/Canvas.jsx` — SVG zone rendering + SVG clipPath
- `admin/js/template-builder/src/store/useTemplateStore.js` — New zone fields in defaults
- `admin/js/template-builder/src/utils/svgPathUtils.js` — New utility module
- `frontend/js/designer/src/components/DesignerCanvas.jsx` — Support SVG clipPath (read `boundary_type` + `svg_path_data` from zone config)

---

## Error Handling

1. **SVG validation failure** — Toast error: "SVG must contain a single closed path." Zone remains as rectangle.
2. **Migration: layer outside all zones** — Auto-assign to first zone. Log warning in console.
3. **Free Move → enforcement toggle** — When turning off Free Move, any object outside its zone is animated back into bounds.
4. **Drag layer to incompatible zone** — If the zone's `allowed_types` doesn't include the layer's type, reject the drop (visual feedback: red outline on zone).
5. **SVG upload fails** — Standard WP media error handling. Zone boundary stays as rectangle.

## Testing Strategy

- **Phase 1:** Manual testing in browser. Verify clipPath, clamping, scale limits match frontend behavior. Test Free Move toggle.
- **Phase 2:** Verify tree renders correctly. Test drag-reorder within zones, drag between zones. Verify migration of old templates. Test save/load round-trip.
- **Phase 3:** Upload various SVGs (single path, multi-path, invalid). Verify clip rendering. Test scale/rotate of SVG zone. Verify bounding box recalculation.

## Undo/Redo Interaction

The undo/redo system stores Fabric.js canvas JSON snapshots (visual state). It does **not** undo store-level structural changes (e.g., moving a layer between zones). Structural changes (tree operations) are committed immediately. Canvas undo reverts visual positions only — the layer remains in its new zone. This matches the behavior of Photoshop-style layer panels.

## Out of Scope

- Multi-path SVG zones (future enhancement)
- Point-in-polygon hit testing for SVG zones (using bounding box instead)
- Automated tests (to be added in a future phase)
- Keyboard accessibility for tree panel (future enhancement — arrow key navigation, focus management)
