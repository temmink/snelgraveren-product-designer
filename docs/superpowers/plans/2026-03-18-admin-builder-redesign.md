# Admin Template Builder Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the admin template builder to enforce zone restrictions like the frontend, replace flat zone/layer tabs with a tree UI, and support SVG zone boundaries.

**Architecture:** Three incremental phases. Phase 1 adds zone enforcement to the admin canvas. Phase 2 restructures the store and UI to nest layers inside zones with a tree panel. Phase 3 adds SVG shape support for zone boundaries.

**Tech Stack:** React 18, Zustand 4, Fabric.js 6, @dnd-kit/core + @dnd-kit/sortable (new), Vite 5, PHP 8.1+

**Spec:** `docs/superpowers/specs/2026-03-18-admin-builder-redesign-design.md`

---

## Implementation Notes (from plan review)

These notes apply across tasks — read before starting:

1. **Fabric.js 6 API**: `setControlVisible('mtr', false)` is removed. Use `obj.controls.mtr.visible = false` instead.
2. **IText vs FabricText**: The admin canvas currently uses `FabricText` which doesn't support in-canvas editing. Tasks that add `text:changed` enforcement must also switch text objects from `FabricText` to `IText`. Update the import to include `IText` from `'fabric'`.
3. **ZoneForm props**: The existing `ZoneForm.jsx` uses `{ initialData, onSubmit, onCancel }`. TreePanel must use these names (not `zone`/`onSave`). The `isEditing` prop is not needed — ZoneForm already works for both add and edit via `initialData`.
4. **Store + Canvas atomic updates**: When changing store action signatures (Task 6), also update all Canvas.jsx callers in the same task to avoid broken intermediate states.
5. **Text layers have no width/height**: Migration center-point calculation should use `(left, top)` directly for text layers since they have no explicit width/height fields. This falls back to top-left, which is acceptable.
6. **CSS**: All new tree components use `pf-tree-*` BEM classes. CSS must be added to `admin/css/template-builder.css` (or the existing admin stylesheet).

---

## File Structure

### Phase 1 (modified only)
- `admin/js/template-builder/src/components/Canvas.jsx` — Add zone enforcement helpers + Free Move toggle
- `admin/js/template-builder/src/store/useTemplateStore.js` — Add `isFreeMove` state

### Phase 2 (new + modified + removed)
- `admin/js/template-builder/src/components/TreePanel.jsx` — **New** — Zone/layer tree with inline actions
- `admin/js/template-builder/src/components/TreeNode.jsx` — **New** — Single tree node (zone or layer)
- `admin/js/template-builder/src/store/useTemplateStore.js` — Nest layers inside zones, new layer actions
- `admin/js/template-builder/src/App.jsx` — Replace Zones/Layers tabs with TreePanel
- `admin/js/template-builder/src/components/Canvas.jsx` — Read layers from nested zones
- `admin/js/template-builder/src/components/ZoneForm.jsx` — Adapt to work as detail panel
- `includes/API/class-rest-templates.php` — Handle nested layers in zones_config
- `includes/Database/class-template-repository.php` — Server-side migration on read
- `frontend/js/designer/src/components/DesignerCanvas.jsx` — Read pre-placed layers from zone.layers
- `admin/js/template-builder/src/components/ZoneList.jsx` — **Remove**
- `admin/js/template-builder/src/components/LayerPanel.jsx` — **Remove**

### Phase 3 (new + modified)
- `admin/js/template-builder/src/utils/svgPathUtils.js` — **New** — SVG path extraction + bounding box
- `admin/js/template-builder/src/components/ZoneForm.jsx` — Add boundary type toggle + SVG upload
- `admin/js/template-builder/src/components/Canvas.jsx` — SVG zone rendering + SVG clipPath
- `admin/js/template-builder/src/store/useTemplateStore.js` — New zone fields in defaults
- `frontend/js/designer/src/components/DesignerCanvas.jsx` — Support SVG clipPath

---

## Phase 1: Zone Enforcement

### Task 1: Add isFreeMove state to store

**Files:**
- Modify: `admin/js/template-builder/src/store/useTemplateStore.js`

- [ ] **Step 1: Add isFreeMove state and setter**

In `useTemplateStore.js`, add to the store state (after line 44 `isSaving: false`):

```js
isFreeMove: false,
```

Add setter (after line 60 `setIsSaving`):

```js
setFreeMove: (v) => set({ isFreeMove: v }),
```

- [ ] **Step 2: Verify build passes**

Run: `cd /Users/martintemmink/Documents/Development/woocommerce_plugin/ProductDesigner && VITE_ENTRY=admin npx vite build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add admin/js/template-builder/src/store/useTemplateStore.js
git commit -m "feat: add isFreeMove state to template store"
```

---

### Task 2: Add zone enforcement helpers to Canvas.jsx

Port the zone enforcement functions from `frontend/js/designer/src/components/DesignerCanvas.jsx` into the admin `Canvas.jsx`. These are pure helper functions — they don't change how the canvas renders yet.

**Files:**
- Modify: `admin/js/template-builder/src/components/Canvas.jsx`

**Reference:** `frontend/js/designer/src/components/DesignerCanvas.jsx` lines 34-151

- [ ] **Step 1: Add store bindings**

In the existing store destructuring in `Canvas()` (line 14-17), add `isFreeMove` and `setFreeMove`:

```js
const {
  views, currentViewIndex,
  addZone, updateView, updateLayer, pushHistory, undo, redo, canUndo, canRedo,
  isFreeMove, setFreeMove,
} = useTemplateStore();
```

Add permissions lookup below:

```js
const permissions = useTemplateStore((s) => s.globalConfig?.permissions || {});
```

- [ ] **Step 2: Add findZoneForPoint helper**

Add after the `viewKey` declaration (line 20), before the Fabric init effect:

```js
const findZoneForPoint = useCallback((x, y, elementType) => {
  const zones = views[currentViewIndex]?.zones_config || [];
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (z.behavior !== 'restrict') continue;
    if (!(z.allowed_types || []).includes(elementType)) continue;
    if (x >= z.x && x <= z.x + z.width && y >= z.y && y <= z.y + z.height) {
      return i;
    }
  }
  return -1;
}, [views, currentViewIndex]);
```

- [ ] **Step 3: Add applyZoneClip helper**

```js
const applyZoneClip = useCallback((obj, zoneIdx) => {
  if (isFreeMove) return;
  const zones = views[currentViewIndex]?.zones_config || [];
  if (zoneIdx < 0 || !zones[zoneIdx] || zones[zoneIdx].behavior !== 'restrict') return;
  const zone = zones[zoneIdx];
  obj.clipPath = new Rect({
    left:   zone.x,
    top:    zone.y,
    width:  zone.width,
    height: zone.height,
    absolutePositioned: true,
  });
}, [views, currentViewIndex, isFreeMove]);
```

- [ ] **Step 4: Add clampToZone helper**

```js
const clampToZone = useCallback((obj) => {
  if (isFreeMove) return;
  const zi = obj.data?.zoneIndex;
  const zones = views[currentViewIndex]?.zones_config || [];
  if (zi == null || zi < 0 || !zones[zi] || zones[zi].behavior !== 'restrict') return;

  const zone = zones[zi];
  const bound = obj.getBoundingRect();

  let left = obj.left;
  let top  = obj.top;

  if (bound.left < zone.x) left += zone.x - bound.left;
  if (bound.top  < zone.y) top  += zone.y - bound.top;
  if (bound.left + bound.width  > zone.x + zone.width)
    left -= (bound.left + bound.width) - (zone.x + zone.width);
  if (bound.top  + bound.height > zone.y + zone.height)
    top  -= (bound.top + bound.height) - (zone.y + zone.height);

  obj.set({ left, top });
  obj.setCoords();
}, [views, currentViewIndex, isFreeMove]);
```

- [ ] **Step 5: Add clampScaleToZone helper**

```js
const clampScaleToZone = useCallback((obj) => {
  if (isFreeMove) return;
  const zi = obj.data?.zoneIndex;
  const zones = views[currentViewIndex]?.zones_config || [];
  if (zi == null || zi < 0 || !zones[zi] || zones[zi].behavior !== 'restrict') return;

  const zone  = zones[zi];
  const perms = permissions[obj.data?.elementType] || {};
  const bound = obj.getBoundingRect();

  if (perms.max_scale != null) {
    if (obj.scaleX > perms.max_scale) obj.set({ scaleX: perms.max_scale });
    if (obj.scaleY > perms.max_scale) obj.set({ scaleY: perms.max_scale });
  }

  if (bound.width > zone.width || bound.height > zone.height) {
    const ratio = Math.min(zone.width / bound.width, zone.height / bound.height);
    let newScaleX = obj.scaleX * ratio;
    let newScaleY = obj.scaleY * ratio;
    if (perms.min_scale != null) {
      newScaleX = Math.max(newScaleX, perms.min_scale);
      newScaleY = Math.max(newScaleY, perms.min_scale);
    }
    obj.set({ scaleX: newScaleX, scaleY: newScaleY });
  }

  obj.setCoords();
  clampToZone(obj);
}, [views, currentViewIndex, permissions, clampToZone, isFreeMove]);
```

- [ ] **Step 6: Add snapToGrid and applyPermissions helpers**

```js
const snapToGrid = useCallback((obj) => {
  if (isFreeMove) return;
  const perms = permissions[obj.data?.elementType] || {};
  if (!perms.snap_to_grid) return;
  const grid = perms.grid_size || 10;
  obj.set({
    left: Math.round(obj.left / grid) * grid,
    top:  Math.round(obj.top / grid) * grid,
  });
  obj.setCoords();
}, [permissions, isFreeMove]);

const applyPermissions = useCallback((obj, elementType) => {
  if (isFreeMove) return;
  const perms = permissions[elementType] || {};
  if (perms.resize === false) obj.set({ hasControls: false });
  if (perms.rotate === false && obj.controls?.mtr) obj.controls.mtr.visible = false;
  if (perms.min_scale != null) obj.set({ minScaleLimit: perms.min_scale });
}, [permissions, isFreeMove]);
```

- [ ] **Step 7: Verify build passes**

Run: `cd /Users/martintemmink/Documents/Development/woocommerce_plugin/ProductDesigner && VITE_ENTRY=admin npx vite build`
Expected: Build succeeds. The helpers exist but aren't wired up yet.

- [ ] **Step 8: Commit**

```bash
git add admin/js/template-builder/src/components/Canvas.jsx
git commit -m "feat: add zone enforcement helpers to admin Canvas"
```

---

### Task 3: Wire enforcement into canvas events

Connect the helpers from Task 2 to the Fabric.js canvas events and the layer sync effect.

**Files:**
- Modify: `admin/js/template-builder/src/components/Canvas.jsx`

- [ ] **Step 1: Add zone assignment to layer sync effect**

In the existing layer sync effect (around line 150, the `useEffect` that watches `layers`), modify the section where new fabric text objects are created. Update the `data` property to include `elementType` and `zoneIndex`:

When creating a new FabricText object, change the `data` field from:
```js
data: { layerIndex: index, layerType: 'text' },
```
to:
```js
data: { layerIndex: index, layerType: 'text', elementType: 'text', zoneIndex: findZoneForPoint(layer.left || 100, layer.top || 100, 'text') },
```

After creating the text object and adding to canvas, apply enforcement:
```js
applyPermissions(text, 'text');
const zi = text.data.zoneIndex;
if (zi >= 0) {
  applyZoneClip(text, zi);
  clampToZone(text);
}
```

Also update the existing object `set()` call in the "Update existing" branch to refresh clipPath when zone changes.

- [ ] **Step 2: Add object:moving and object:scaling event handlers**

In the Fabric init effect (the `useEffect` at line 24), add event handlers after the existing `object:modified` handler:

```js
canvas.on('object:moving', (e) => {
  snapToGrid(e.target);
  clampToZone(e.target);
});

canvas.on('object:scaling', (e) => {
  clampScaleToZone(e.target);
});
```

- [ ] **Step 3: Add text:changed max_chars enforcement**

In the Fabric init effect, add:

```js
canvas.on('text:changed', (e) => {
  const obj = e.target;
  if (!obj?.data?.elementType) return;
  const textPerms = permissions[obj.data.elementType] || {};
  const maxChars = textPerms.max_chars;
  if (maxChars && maxChars > 0 && obj.text && obj.text.length > maxChars) {
    obj.set({ text: obj.text.slice(0, maxChars) });
    canvas.renderAll();
  }
});
```

- [ ] **Step 4: Update dependency arrays**

Add `isFreeMove`, `findZoneForPoint`, `applyZoneClip`, `clampToZone`, `clampScaleToZone`, `snapToGrid`, `applyPermissions`, and `permissions` to the relevant effect dependency arrays (with eslint-disable comments as needed, matching existing pattern).

- [ ] **Step 5: Verify build passes**

Run: `cd /Users/martintemmink/Documents/Development/woocommerce_plugin/ProductDesigner && VITE_ENTRY=admin npx vite build`
Expected: Build succeeds.

- [ ] **Step 6: Manual test in browser**

1. Open http://localhost:8080/wp-admin/ → ProductForge → edit a template with zones
2. Add a text layer inside a zone
3. Drag the text — it should clamp to the zone boundary
4. Scale the text — it should not exceed the zone

- [ ] **Step 7: Commit**

```bash
git add admin/js/template-builder/src/components/Canvas.jsx
git commit -m "feat: wire zone enforcement into admin canvas events"
```

---

### Task 4: Add Free Move toggle button

**Files:**
- Modify: `admin/js/template-builder/src/components/Canvas.jsx`

- [ ] **Step 1: Add Free Move button to toolbar**

In the JSX return, add a Free Move toggle button to the toolbar (after the Draw Zone button, around line 437):

```jsx
<button
  className={`pf-canvas-toolbar__btn${isFreeMove ? ' pf-canvas-toolbar__btn--active' : ''}`}
  onClick={() => {
    const next = !isFreeMove;
    setFreeMove(next);
    const canvas = fabricRef.current;
    if (canvas) {
      if (!next) {
        // Re-entering enforcement mode: clamp all objects and re-apply clipPaths.
        canvas.getObjects().forEach((obj) => {
          if (obj.data?.isZone || obj.data?.isZoneOverlay) return;
          if (obj.data?.zoneIndex >= 0) {
            applyZoneClip(obj, obj.data.zoneIndex);
            clampToZone(obj);
          }
        });
        pushHistory(viewKey, canvas.toJSON());
      } else {
        // Entering free mode: remove clipPaths.
        canvas.getObjects().forEach((obj) => {
          if (obj.data?.isZone || obj.data?.isZoneOverlay) return;
          obj.clipPath = undefined;
        });
      }
      canvas.renderAll();
    }
  }}
  title={isFreeMove ? 'Enable zone enforcement' : 'Disable zone enforcement for free positioning'}
>
  {isFreeMove ? 'Enforce Zones' : 'Free Move'}
</button>
```

- [ ] **Step 2: Update zone sync effect for dashed stroke in free move**

In the zone sync effect (the `useEffect` that watches `zones`), modify the zone rect styling to use dashed strokes when in free move mode:

Change the Rect creation inside the zone sync effect:
```js
strokeDashArray: isFreeMove ? [6, 4] : null,
```

Add `isFreeMove` to the effect's dependency array.

- [ ] **Step 3: Verify build passes and test**

Run: `cd /Users/martintemmink/Documents/Development/woocommerce_plugin/ProductDesigner && VITE_ENTRY=admin npx vite build`

Manual test:
1. Click "Free Move" — zone outlines should become dashed, elements should be freely draggable
2. Click "Enforce Zones" — elements should snap back into their zones, clipPaths reapplied

- [ ] **Step 4: Commit**

```bash
git add admin/js/template-builder/src/components/Canvas.jsx
git commit -m "feat: add Free Move toggle to admin canvas toolbar"
```

---

## Phase 2: Tree UI

### Task 5: Install @dnd-kit dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
cd /Users/martintemmink/Documents/Development/woocommerce_plugin/ProductDesigner
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 2: Verify build still passes**

Run: `VITE_ENTRY=admin npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @dnd-kit for tree drag-and-drop"
```

---

### Task 6: Restructure store — nest layers inside zones

This is the core data model change. Update `useTemplateStore.js` to nest layers inside zones and add migration logic.

**Files:**
- Modify: `admin/js/template-builder/src/store/useTemplateStore.js`

- [ ] **Step 1: Add migration helper function**

Add before the `useTemplateStore` create call (before line 32):

```js
function migrateViewToNestedLayers(view) {
  // If zones already have layers arrays, no migration needed.
  const hasNestedLayers = (view.zones_config || []).some((z) => Array.isArray(z.layers));
  if (hasNestedLayers || !view.layers_config?.length) return view;

  const zones = (view.zones_config || []).map((z) => ({ ...z, layers: [] }));
  const layers = view.layers_config || [];

  layers.forEach((layer) => {
    // Find zone by center point of layer.
    const cx = (layer.left || 0) + ((layer.width || 0) / 2);
    const cy = (layer.top || 0) + ((layer.height || 0) / 2);

    let bestIdx = -1;
    let bestArea = Infinity;

    zones.forEach((z, i) => {
      if (cx >= z.x && cx <= z.x + z.width && cy >= z.y && cy <= z.y + z.height) {
        const area = z.width * z.height;
        if (area < bestArea) {
          bestIdx = i;
          bestArea = area;
        }
      }
    });

    if (bestIdx < 0) {
      // No zone contains this layer — assign to first zone.
      if (zones.length > 0) {
        console.warn('[PD] Layer outside all zones, assigning to first zone:', layer.name || layer.type);
        bestIdx = 0;
      } else {
        return; // No zones at all — drop the layer (shouldn't happen with the guard).
      }
    }

    zones[bestIdx].layers.push(layer);
  });

  const migrated = { ...view, zones_config: zones };
  delete migrated.layers_config;
  return migrated;
}
```

- [ ] **Step 2: Update loadFromApi to run migration**

Change the `loadFromApi` views mapping (line 224) from:
```js
views: (data.views || []).map((v) => ({ _clientId: crypto.randomUUID(), ...v })),
```
to:
```js
views: (data.views || []).map((v) => ({
  _clientId: crypto.randomUUID(),
  ...migrateViewToNestedLayers(v),
})),
```

- [ ] **Step 3: Ensure addZone creates zones with empty layers array**

Update `addZone` (line 104) to ensure new zones have a `layers` array:

Change the zone object in addZone from:
```js
zones_config: [...(views[viewIndex].zones_config || []), { _key: crypto.randomUUID(), ...zone }],
```
to:
```js
zones_config: [...(views[viewIndex].zones_config || []), { _key: crypto.randomUUID(), layers: [], ...zone }],
```

- [ ] **Step 4: Replace flat layer actions with zone-nested versions**

Replace the existing `addLayer`, `updateLayer`, `removeLayer`, `moveLayer` actions (lines 133-172) with:

```js
addLayer: (viewIndex, zoneIndex, layer) =>
  set((s) => {
    const views = [...s.views];
    const zones = [...(views[viewIndex].zones_config || [])];
    zones[zoneIndex] = {
      ...zones[zoneIndex],
      layers: [...(zones[zoneIndex].layers || []), { _key: crypto.randomUUID(), ...layer }],
    };
    views[viewIndex] = { ...views[viewIndex], zones_config: zones };
    return { views, isDirty: true };
  }),

updateLayer: (viewIndex, zoneIndex, layerIndex, patch) =>
  set((s) => {
    const views = [...s.views];
    const zones = [...(views[viewIndex].zones_config || [])];
    const layers = [...(zones[zoneIndex].layers || [])];
    layers[layerIndex] = { ...layers[layerIndex], ...patch };
    zones[zoneIndex] = { ...zones[zoneIndex], layers };
    views[viewIndex] = { ...views[viewIndex], zones_config: zones };
    return { views, isDirty: true };
  }),

removeLayer: (viewIndex, zoneIndex, layerIndex) =>
  set((s) => {
    const views = [...s.views];
    const zones = [...(views[viewIndex].zones_config || [])];
    const layers = (zones[zoneIndex].layers || [])
      .filter((_, i) => i !== layerIndex)
      .map((layer, i) => ({ ...layer, z_order: i }));
    zones[zoneIndex] = { ...zones[zoneIndex], layers };
    views[viewIndex] = { ...views[viewIndex], zones_config: zones };
    return { views, isDirty: true };
  }),

moveLayer: (viewIndex, fromZoneIndex, fromLayerIndex, toZoneIndex, toLayerIndex) =>
  set((s) => {
    const views = [...s.views];
    const zones = [...(views[viewIndex].zones_config || [])];

    // Remove from source zone.
    const fromLayers = [...(zones[fromZoneIndex].layers || [])];
    const [moved] = fromLayers.splice(fromLayerIndex, 1);
    zones[fromZoneIndex] = { ...zones[fromZoneIndex], layers: fromLayers.map((l, i) => ({ ...l, z_order: i })) };

    // Insert into target zone.
    const toLayers = fromZoneIndex === toZoneIndex ? fromLayers : [...(zones[toZoneIndex].layers || [])];
    toLayers.splice(toLayerIndex, 0, moved);
    zones[toZoneIndex] = { ...zones[toZoneIndex], layers: toLayers.map((l, i) => ({ ...l, z_order: i })) };

    views[viewIndex] = { ...views[viewIndex], zones_config: zones };
    return { views, isDirty: true };
  }),

reorderZone: (viewIndex, fromIndex, toIndex) =>
  set((s) => {
    const views = [...s.views];
    const zones = [...(views[viewIndex].zones_config || [])];
    if (fromIndex < 0 || fromIndex >= zones.length || toIndex < 0 || toIndex >= zones.length) return {};
    const [moved] = zones.splice(fromIndex, 1);
    zones.splice(toIndex, 0, moved);
    const reordered = zones.map((z, i) => ({ ...z, sort_order: i }));
    views[viewIndex] = { ...views[viewIndex], zones_config: reordered };
    return { views, isDirty: true };
  }),
```

- [ ] **Step 5: Update Canvas.jsx to read layers from nested zones**

This must happen in the same task to avoid a broken intermediate state.

In Canvas.jsx, replace the layers variable:
```js
// Old:
const layers = currentView?.layers_config || [];

// New:
const layers = (currentView?.zones_config || []).flatMap((zone, zoneIndex) =>
  (zone.layers || []).map((layer, layerIndex) => ({
    ...layer,
    _zoneIndex: zoneIndex,
    _layerIndex: layerIndex,
  }))
);
```

Update fabric text object `data` in the layer sync effect to include zone info:
```js
data: { layerIndex: layer._layerIndex, zoneIndex: layer._zoneIndex, layerType: layer.type, elementType: layer.type },
```

Update the `object:modified` handler to pass `zoneIndex`:
```js
updateLayer(currentViewIndex, obj.data.zoneIndex, obj.data.layerIndex, {
  left:     Math.round(obj.left),
  top:      Math.round(obj.top),
  fontSize: newFontSize,
});
```

- [ ] **Step 6: Verify build passes**

Run: `VITE_ENTRY=admin npx vite build`
Expected: Build succeeds. ZoneList/LayerPanel will have unused imports but won't break the build.

- [ ] **Step 7: Commit**

```bash
git add admin/js/template-builder/src/store/useTemplateStore.js admin/js/template-builder/src/components/Canvas.jsx
git commit -m "feat: nest layers inside zones in store with migration"
```

---

### Task 7: Create TreeNode component

**Files:**
- Create: `admin/js/template-builder/src/components/TreeNode.jsx`

- [ ] **Step 1: Create TreeNode.jsx**

```jsx
import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const TYPE_ICONS = { text: 'T', image: '\u{1F5BC}', svg: '\u2B21' };

export default function TreeNode({ node, nodeType, isSelected, onSelect, onAction, depth = 0, children }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: node._key });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    paddingLeft: `${depth * 16}px`,
  };

  const isZone = nodeType === 'zone';
  const icon = isZone ? '\u25A2' : (TYPE_ICONS[node.type] || '?');
  const label = isZone ? (node.name || 'Unnamed Zone') : (node.name || node.text || node.type || 'Layer');

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div
        className={`pf-tree-node pf-tree-node--${nodeType}${isSelected ? ' pf-tree-node--selected' : ''}`}
        onClick={() => onSelect(node, nodeType)}
      >
        <span className="pf-tree-node__drag" {...listeners} title="Drag to reorder">⠿</span>
        <span className="pf-tree-node__icon">{icon}</span>
        <span className="pf-tree-node__label">{label}</span>

        {isZone && (
          <span className="pf-tree-node__badge">{node.behavior}</span>
        )}

        <span className="pf-tree-node__actions">
          {isZone && (
            <button
              className="pf-tree-node__action"
              onClick={(e) => { e.stopPropagation(); onAction('add-layer', node); }}
              title="Add layer"
            >+</button>
          )}
          <button
            className="pf-tree-node__action"
            onClick={(e) => { e.stopPropagation(); onAction('toggle-visibility', node); }}
            title={node.visible === false ? 'Show' : 'Hide'}
          >{node.visible === false ? '\u25CB' : '\u25C9'}</button>
          <button
            className="pf-tree-node__action"
            onClick={(e) => { e.stopPropagation(); onAction('toggle-lock', node); }}
            title={node.locked ? 'Unlock' : 'Lock'}
          >{node.locked ? '\u{1F512}' : '\u{1F513}'}</button>
          <button
            className="pf-tree-node__action pf-tree-node__action--danger"
            onClick={(e) => { e.stopPropagation(); onAction('delete', node); }}
            title="Delete"
          >&times;</button>
        </span>
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Verify build passes**

Run: `VITE_ENTRY=admin npx vite build`

- [ ] **Step 3: Commit**

```bash
git add admin/js/template-builder/src/components/TreeNode.jsx
git commit -m "feat: create TreeNode component for zone/layer tree"
```

---

### Task 8: Create TreePanel component

**Files:**
- Create: `admin/js/template-builder/src/components/TreePanel.jsx`

- [ ] **Step 1: Create TreePanel.jsx**

```jsx
import React, { useState, useCallback } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import useTemplateStore from '../store/useTemplateStore';
import TreeNode from './TreeNode';
import ZoneForm from './ZoneForm';

export default function TreePanel() {
  const {
    views, currentViewIndex,
    addZone, updateZone, removeZone, reorderZone,
    addLayer, updateLayer, removeLayer, moveLayer,
  } = useTemplateStore();

  const [selectedNode, setSelectedNode] = useState(null);
  const [isAddingZone, setIsAddingZone] = useState(false);
  const [addingLayerToZone, setAddingLayerToZone] = useState(null);
  const [expandedZones, setExpandedZones] = useState({});

  const currentView = views[currentViewIndex];
  const zones = currentView?.zones_config || [];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const toggleExpanded = (key) => {
    setExpandedZones((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSelect = useCallback((node, nodeType) => {
    setSelectedNode({ node, nodeType });
  }, []);

  const handleAction = useCallback((action, node, zoneIndex, layerIndex) => {
    switch (action) {
      case 'add-layer':
        setAddingLayerToZone(zoneIndex);
        break;
      case 'toggle-visibility':
        if (layerIndex != null) {
          updateLayer(currentViewIndex, zoneIndex, layerIndex, { visible: node.visible === false });
        } else {
          updateZone(currentViewIndex, zoneIndex, { visible: node.visible === false });
        }
        break;
      case 'toggle-lock':
        if (layerIndex != null) {
          updateLayer(currentViewIndex, zoneIndex, layerIndex, { locked: !node.locked });
        } else {
          updateZone(currentViewIndex, zoneIndex, { locked: !node.locked });
        }
        break;
      case 'delete':
        if (layerIndex != null) {
          removeLayer(currentViewIndex, zoneIndex, layerIndex);
        } else {
          removeZone(currentViewIndex, zoneIndex);
        }
        setSelectedNode(null);
        break;
    }
  }, [currentViewIndex, updateZone, removeZone, updateLayer, removeLayer]);

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;

    // Check if dragging a zone (zone reordering).
    const fromZoneIdx = zones.findIndex((z) => z._key === active.id);
    const toZoneIdx = zones.findIndex((z) => z._key === over.id);
    if (fromZoneIdx >= 0 && toZoneIdx >= 0) {
      reorderZone(currentViewIndex, fromZoneIdx, toZoneIdx);
      return;
    }

    // Otherwise, dragging a layer.
    for (let zi = 0; zi < zones.length; zi++) {
      const layers = zones[zi].layers || [];
      const fromIdx = layers.findIndex((l) => l._key === active.id);
      if (fromIdx < 0) continue;

      for (let tzi = 0; tzi < zones.length; tzi++) {
        const tLayers = zones[tzi].layers || [];
        const toIdx = tLayers.findIndex((l) => l._key === over.id);
        if (toIdx < 0) continue;

        // Check allowed_types compatibility.
        const layer = layers[fromIdx];
        const targetZone = zones[tzi];
        if (!(targetZone.allowed_types || []).includes(layer.type)) return;

        moveLayer(currentViewIndex, zi, fromIdx, tzi, toIdx);
        return;
      }
    }
  }, [zones, currentViewIndex, moveLayer, reorderZone]);

  const handleAddLayer = useCallback((zoneIndex, layerData) => {
    addLayer(currentViewIndex, zoneIndex, layerData);
    setAddingLayerToZone(null);
  }, [currentViewIndex, addLayer]);

  // Collect all sortable IDs: zone _keys + layer _keys.
  const allSortableKeys = [
    ...zones.map((z) => z._key),
    ...zones.flatMap((z) => (z.layers || []).map((l) => l._key)),
  ];

  return (
    <div className="pf-tree-panel">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={allSortableKeys} strategy={verticalListSortingStrategy}>
          {zones.length === 0 && (
            <p className="pf-tree-panel__empty">Add a zone first to place layers.</p>
          )}
          {zones.map((zone, zoneIndex) => {
            const isExpanded = expandedZones[zone._key] !== false; // Default expanded.
            return (
              <div key={zone._key} className="pf-tree-panel__zone-group">
                <TreeNode
                  node={zone}
                  nodeType="zone"
                  isSelected={selectedNode?.node?._key === zone._key}
                  onSelect={(n, t) => { handleSelect(n, t); toggleExpanded(zone._key); }}
                  onAction={(action, n) => handleAction(action, n, zoneIndex)}
                  depth={0}
                >
                  {isExpanded && (
                    <div className="pf-tree-panel__children">
                      {(zone.layers || []).map((layer, layerIndex) => (
                        <TreeNode
                          key={layer._key}
                          node={layer}
                          nodeType="layer"
                          isSelected={selectedNode?.node?._key === layer._key}
                          onSelect={handleSelect}
                          onAction={(action, n) => handleAction(action, n, zoneIndex, layerIndex)}
                          depth={1}
                        />
                      ))}
                      {addingLayerToZone === zoneIndex && (
                        <AddLayerInline
                          zone={zone}
                          onAdd={(data) => handleAddLayer(zoneIndex, data)}
                          onCancel={() => setAddingLayerToZone(null)}
                        />
                      )}
                    </div>
                  )}
                </TreeNode>
              </div>
            );
          })}
        </SortableContext>
      </DndContext>

      <div className="pf-tree-panel__footer">
        <button
          className="pf-tree-panel__add-zone-btn"
          onClick={() => setIsAddingZone(true)}
        >
          + Add Zone
        </button>
      </div>

      {isAddingZone && (
        <ZoneForm
          onSubmit={(zone) => { addZone(currentViewIndex, zone); setIsAddingZone(false); }}
          onCancel={() => setIsAddingZone(false)}
        />
      )}

      {selectedNode && (
        <div className="pf-tree-panel__detail">
          {selectedNode.nodeType === 'zone' && (
            <ZoneForm
              key={selectedNode.node._key}
              initialData={selectedNode.node}
              onSubmit={(patch) => {
                const idx = zones.findIndex((z) => z._key === selectedNode.node._key);
                if (idx >= 0) updateZone(currentViewIndex, idx, patch);
              }}
              onCancel={() => setSelectedNode(null)}
            />
          )}
          {selectedNode.nodeType === 'layer' && (
            <LayerDetail
              layer={selectedNode.node}
              onChange={(patch) => {
                for (let zi = 0; zi < zones.length; zi++) {
                  const li = (zones[zi].layers || []).findIndex((l) => l._key === selectedNode.node._key);
                  if (li >= 0) { updateLayer(currentViewIndex, zi, li, patch); break; }
                }
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function AddLayerInline({ zone, onAdd, onCancel }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('text');
  const allowedTypes = zone.allowed_types || ['text', 'image', 'svg'];

  return (
    <div className="pf-tree-panel__add-layer" style={{ paddingLeft: '32px' }}>
      <input
        type="text"
        placeholder="Layer name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <select value={type} onChange={(e) => setType(e.target.value)}>
        {allowedTypes.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <button onClick={() => onAdd({ name: name || type, type, locked: false, visible: true, text: type === 'text' ? 'Text' : '', fontSize: 24, fontFamily: 'Arial', fill: '#000000', left: zone.x + 20, top: zone.y + 20 })}>
        Add
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}

function LayerDetail({ layer, onChange }) {
  if (layer.type === 'text') {
    return (
      <div className="pf-tree-panel__layer-detail">
        <h4>Text Properties</h4>
        <label>
          Text
          <input type="text" value={layer.text || ''} onChange={(e) => onChange({ text: e.target.value })} />
        </label>
        <label>
          Font Size
          <input type="number" min="8" max="200" value={layer.fontSize || 24} onChange={(e) => onChange({ fontSize: parseInt(e.target.value, 10) || 24 })} />
        </label>
        <label>
          Font Family
          <input type="text" value={layer.fontFamily || 'Arial'} onChange={(e) => onChange({ fontFamily: e.target.value })} />
        </label>
        <label>
          Color
          <input type="color" value={layer.fill || '#000000'} onChange={(e) => onChange({ fill: e.target.value })} />
        </label>
        <label>
          X
          <input type="number" value={layer.left || 0} onChange={(e) => onChange({ left: parseInt(e.target.value, 10) || 0 })} />
        </label>
        <label>
          Y
          <input type="number" value={layer.top || 0} onChange={(e) => onChange({ top: parseInt(e.target.value, 10) || 0 })} />
        </label>
      </div>
    );
  }

  return (
    <div className="pf-tree-panel__layer-detail">
      <h4>{(layer.type || 'Layer').charAt(0).toUpperCase() + (layer.type || '').slice(1)} Properties</h4>
      <label>
        Name
        <input type="text" value={layer.name || ''} onChange={(e) => onChange({ name: e.target.value })} />
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Verify build passes**

Run: `VITE_ENTRY=admin npx vite build`

- [ ] **Step 3: Commit**

```bash
git add admin/js/template-builder/src/components/TreePanel.jsx
git commit -m "feat: create TreePanel with drag-and-drop and inline actions"
```

---

### Task 9: Wire TreePanel into App.jsx and update save flow

Replace the Zones and Layers tabs with TreePanel. Canvas.jsx layer reading was already updated in Task 6.

**Files:**
- Modify: `admin/js/template-builder/src/App.jsx`

- [ ] **Step 1: Update App.jsx imports and TABS array**

In `App.jsx`, replace the `ZoneList` and `LayerPanel` imports:

Remove:
```js
import ZoneList from './components/ZoneList';
import LayerPanel from './components/LayerPanel';
```

Add:
```js
import TreePanel from './components/TreePanel';
```

Update the TABS array — replace the Zones and Layers entries with a single Tree entry:
```js
const TABS = [
  { label: 'Structure', Component: TreePanel },
  { label: 'Permissions', Component: PermissionsPanel },
  { label: 'Pricing',     Component: PricingPanel },
  { label: 'Settings',    Component: GlobalSettings },
];
```

- [ ] **Step 2: Update save flow in App.jsx**

In the `handleSave` function, where view data is sent to the API (around line 89-106), ensure `layers_config` is sent as empty array:

Change the view payload from:
```js
{ name, sort_order, canvas_width, canvas_height, background_url, zones_config, layers_config, permissions }
```
to:
```js
{ name, sort_order, canvas_width, canvas_height, background_url, zones_config, layers_config: [], permissions }
```

The `zones_config` already contains nested layers from the store.

- [ ] **Step 3: Verify build passes**

Run: `VITE_ENTRY=admin npx vite build`

- [ ] **Step 4: Manual test in browser**

1. Open template builder — sidebar should show "Structure" tab with zone/layer tree
2. Add a zone via "Add Zone" button
3. Add a layer inside the zone via "+" button
4. Verify layer appears on canvas inside the zone
5. Save and reload — verify data persists

- [ ] **Step 5: Commit**

```bash
git add admin/js/template-builder/src/App.jsx
git commit -m "feat: wire TreePanel into app, update save flow for nested layers"
```

---

### Task 10: Remove old ZoneList and LayerPanel files

**Files:**
- Remove: `admin/js/template-builder/src/components/ZoneList.jsx`
- Remove: `admin/js/template-builder/src/components/LayerPanel.jsx`

- [ ] **Step 1: Delete files**

```bash
cd /Users/martintemmink/Documents/Development/woocommerce_plugin/ProductDesigner
rm admin/js/template-builder/src/components/ZoneList.jsx
rm admin/js/template-builder/src/components/LayerPanel.jsx
```

- [ ] **Step 2: Verify no remaining imports**

Search for any remaining imports of these files. There should be none after Task 9.

Run: `grep -r "ZoneList\|LayerPanel" admin/js/template-builder/src/ --include="*.jsx" --include="*.js"`
Expected: No matches.

- [ ] **Step 3: Verify build passes**

Run: `VITE_ENTRY=admin npx vite build`

- [ ] **Step 4: Commit**

```bash
git rm admin/js/template-builder/src/components/ZoneList.jsx admin/js/template-builder/src/components/LayerPanel.jsx
git commit -m "chore: remove old ZoneList and LayerPanel components"
```

---

### Task 11: Update REST API and repository for nested layers

**Files:**
- Modify: `includes/API/class-rest-templates.php`
- Modify: `includes/Database/class-template-repository.php`

- [ ] **Step 1: Add server-side migration to decode_view in TemplateRepository**

In `class-template-repository.php`, in the `decode_view()` method (line 232), add migration logic after the existing JSON decoding:

```php
// Migrate: if zones don't have nested layers but layers_config exists, merge them.
if (!empty($row['layers_config']) && is_array($row['layers_config'])) {
    $hasNested = false;
    foreach ($row['zones_config'] as $zone) {
        if (isset($zone['layers'])) { $hasNested = true; break; }
    }
    if (!$hasNested && !empty($row['zones_config'])) {
        foreach ($row['layers_config'] as $layer) {
            $cx = ($layer['left'] ?? 0) + (($layer['width'] ?? 0) / 2);
            $cy = ($layer['top'] ?? 0) + (($layer['height'] ?? 0) / 2);
            $bestIdx = 0;
            $bestArea = PHP_INT_MAX;
            foreach ($row['zones_config'] as $i => $z) {
                if ($cx >= $z['x'] && $cx <= $z['x'] + $z['width'] &&
                    $cy >= $z['y'] && $cy <= $z['y'] + $z['height']) {
                    $area = $z['width'] * $z['height'];
                    if ($area < $bestArea) { $bestIdx = $i; $bestArea = $area; }
                }
            }
            $row['zones_config'][$bestIdx]['layers'][] = $layer;
        }
    }
    unset($row['layers_config']);
}
```

- [ ] **Step 2: Update get_public_template in REST API**

In `class-rest-templates.php`, the `get_public_template()` method returns `layers_config` as a separate field. After migration, this may be unset. Update it to gracefully handle missing `layers_config`:

In the view mapping inside `get_public_template()`, change references to `$v['layers_config']` to use `$v['layers_config'] ?? []`. The frontend now reads layers from `zone.layers` in `zones_config`, so `layers_config` in the public API response is for backward compatibility only.

- [ ] **Step 3: Update frontend DesignerCanvas.jsx to read pre-placed layers from zones**

In `frontend/js/designer/src/components/DesignerCanvas.jsx`, in the canvas init effect (line 155), after the zone rendering section but before the snapshot restore, add:

```js
// Render pre-placed template layers from zones.
zones.forEach((zone, zoneIdx) => {
  (zone.layers || []).forEach((layer) => {
    if (layer.type === 'text' && layer.text) {
      const text = new IText(layer.text, {
        left:       layer.left       || zone.x + 20,
        top:        layer.top        || zone.y + 20,
        fontSize:   layer.fontSize   || 24,
        fontFamily: layer.fontFamily || 'Arial',
        fill:       layer.fill       || '#000000',
        data:       { elementType: 'text', zoneIndex: zoneIdx },
      });
      applyPermissions(text, 'text');
      if (zone.behavior === 'restrict') applyZoneClip(text, zoneIdx);
      canvas.add(text);
      if (zone.behavior === 'restrict') clampToZone(text);
    }
  });
});
```

- [ ] **Step 4: Verify build passes**

Run: `VITE_ENTRY=admin npx vite build && VITE_ENTRY=frontend npx vite build`

- [ ] **Step 5: Commit**

```bash
git add includes/Database/class-template-repository.php includes/API/class-rest-templates.php frontend/js/designer/src/components/DesignerCanvas.jsx
git commit -m "feat: server-side migration and frontend support for nested layers"
```

---

## Phase 3: SVG Zone Boundaries

### Task 12: Create svgPathUtils.js utility

**Files:**
- Create: `admin/js/template-builder/src/utils/svgPathUtils.js`

- [ ] **Step 1: Create the utility file**

```js
import { Path } from 'fabric';

/**
 * Extract a single closed path from an SVG string.
 * Returns { pathData, viewBox } or null if no valid path found.
 */
export function extractClosedPath(svgString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');

  // Check for parse errors.
  const parseError = doc.querySelector('parsererror');
  if (parseError) return null;

  const svgEl = doc.querySelector('svg');
  const viewBox = svgEl?.getAttribute('viewBox') || '';

  const paths = doc.querySelectorAll('path');
  for (const pathEl of paths) {
    const d = (pathEl.getAttribute('d') || '').trim();
    if (!d) continue;

    // Must be a single closed subpath: exactly one M/m command, ends with Z/z.
    const moveMatches = d.match(/[Mm]/g);
    if (!moveMatches || moveMatches.length !== 1) continue;
    if (!/[Zz]\s*$/.test(d)) continue;

    return { pathData: d, viewBox };
  }

  return null;
}

/**
 * Compute the axis-aligned bounding box of a path with transforms applied.
 * Uses a temporary Fabric.js Path object.
 */
export function pathToBoundingBox(pathData, scale = 1, rotation = 0) {
  const tempPath = new Path(pathData, {
    left: 0,
    top: 0,
    scaleX: scale,
    scaleY: scale,
    angle: rotation,
  });

  const bound = tempPath.getBoundingRect();
  return {
    x: Math.round(bound.left),
    y: Math.round(bound.top),
    width: Math.round(bound.width),
    height: Math.round(bound.height),
  };
}
```

- [ ] **Step 2: Verify build passes**

Run: `VITE_ENTRY=admin npx vite build`

- [ ] **Step 3: Commit**

```bash
git add admin/js/template-builder/src/utils/svgPathUtils.js
git commit -m "feat: add SVG path extraction and bounding box utilities"
```

---

### Task 13: Add boundary type toggle and SVG upload to ZoneForm

**Files:**
- Modify: `admin/js/template-builder/src/components/ZoneForm.jsx`

- [ ] **Step 1: Update DEFAULT zone to include new SVG fields**

In `ZoneForm.jsx`, update the `DEFAULT` object (line 3-9):

```js
const DEFAULT = {
  name: '', type: 'safe_area',
  x: 0, y: 0, width: 200, height: 200,
  allowed_types: ['text', 'image', 'svg'],
  behavior: 'restrict',
  boundary_type: 'rect',
  svg_url: '',
  svg_path_data: '',
  svg_scale: 1,
  svg_rotation: 0,
};
```

- [ ] **Step 2: Add boundary type toggle and SVG upload UI**

After the existing "Behavior" dropdown field, add:

```jsx
{/* Boundary Type */}
<label className="pf-zone-form__field">
  <span>Boundary</span>
  <select
    value={zone.boundary_type || 'rect'}
    onChange={(e) => setZone({ ...zone, boundary_type: e.target.value })}
  >
    <option value="rect">Rectangle</option>
    <option value="svg">SVG Shape</option>
  </select>
</label>

{/* SVG Upload — only shown when boundary_type is 'svg' */}
{zone.boundary_type === 'svg' && (
  <div className="pf-zone-form__svg-upload">
    {zone.svg_url ? (
      <div className="pf-zone-form__svg-preview">
        <img src={zone.svg_url} alt="Zone shape" style={{ maxWidth: '100%', maxHeight: '80px' }} />
        <button type="button" onClick={() => setZone({ ...zone, svg_url: '', svg_path_data: '' })}>
          Remove
        </button>
      </div>
    ) : (
      <button
        type="button"
        onClick={() => {
          if (!window.wp?.media) return;
          const frame = window.wp.media({
            title: 'Select SVG Zone Shape',
            button: { text: 'Use Shape' },
            multiple: false,
            library: { type: 'image/svg+xml' },
          });
          frame.on('select', async () => {
            const attachment = frame.state().get('selection').first().toJSON();
            try {
              const resp = await fetch(attachment.url);
              const svgText = await resp.text();
              const result = extractClosedPath(svgText);
              if (!result) {
                alert('SVG must contain a single closed path.');
                return;
              }
              const bbox = pathToBoundingBox(result.pathData, zone.svg_scale || 1, zone.svg_rotation || 0);
              setZone({
                ...zone,
                svg_url: attachment.url,
                svg_path_data: result.pathData,
                width: bbox.width || 200,
                height: bbox.height || 200,
              });
            } catch {
              alert('Failed to parse SVG file.');
            }
          });
          frame.open();
        }}
      >
        Upload SVG Shape
      </button>
    )}
    {zone.svg_path_data && (
      <>
        <label className="pf-zone-form__field">
          <span>Scale</span>
          <input
            type="number" step="0.1" min="0.1" max="10"
            value={zone.svg_scale || 1}
            onChange={(e) => {
              const s = parseFloat(e.target.value) || 1;
              const bbox = pathToBoundingBox(zone.svg_path_data, s, zone.svg_rotation || 0);
              setZone({ ...zone, svg_scale: s, width: bbox.width, height: bbox.height });
            }}
          />
        </label>
        <label className="pf-zone-form__field">
          <span>Rotation</span>
          <input
            type="number" step="1" min="0" max="360"
            value={zone.svg_rotation || 0}
            onChange={(e) => {
              const r = parseInt(e.target.value, 10) || 0;
              const bbox = pathToBoundingBox(zone.svg_path_data, zone.svg_scale || 1, r);
              setZone({ ...zone, svg_rotation: r, width: bbox.width, height: bbox.height });
            }}
          />
        </label>
      </>
    )}
  </div>
)}
```

- [ ] **Step 3: Add import for svgPathUtils**

At the top of `ZoneForm.jsx`:

```js
import { extractClosedPath, pathToBoundingBox } from '../utils/svgPathUtils';
```

- [ ] **Step 4: Verify build passes**

Run: `VITE_ENTRY=admin npx vite build`

- [ ] **Step 5: Commit**

```bash
git add admin/js/template-builder/src/components/ZoneForm.jsx
git commit -m "feat: add boundary type toggle and SVG upload to zone form"
```

---

### Task 14: Render SVG zones on canvas and use SVG clipPath

**Files:**
- Modify: `admin/js/template-builder/src/components/Canvas.jsx`

- [ ] **Step 1: Import Path from fabric**

At the top of `Canvas.jsx`, add `Path` to the fabric import:

```js
import { Canvas as FabricCanvas, Rect, FabricImage, FabricText, Path } from 'fabric';
```

- [ ] **Step 2: Update zone sync effect to render SVG zones**

In the zone sync effect (the `useEffect` that watches `zones`), modify the zone rect creation to handle SVG zones:

Replace the zone rendering loop body with:

```js
zones.forEach((zone, index) => {
  let shape;
  if (zone.boundary_type === 'svg' && zone.svg_path_data) {
    shape = new Path(zone.svg_path_data, {
      left:        zone.x,
      top:         zone.y,
      scaleX:      zone.svg_scale || 1,
      scaleY:      zone.svg_scale || 1,
      angle:       zone.svg_rotation || 0,
      fill:        isFreeMove ? 'transparent' : 'rgba(59, 130, 246, 0.08)',
      stroke:      '#3b82f6',
      strokeWidth: 2,
      strokeDashArray: isFreeMove ? [6, 4] : null,
      selectable:  false,
      evented:     false,
      data:        { zoneIndex: index, isZone: true },
    });
  } else {
    shape = new Rect({
      left:        zone.x,
      top:         zone.y,
      width:       zone.width,
      height:      zone.height,
      fill:        isFreeMove ? 'transparent' : 'rgba(59, 130, 246, 0.15)',
      stroke:      '#3b82f6',
      strokeWidth: 2,
      strokeDashArray: isFreeMove ? [6, 4] : null,
      selectable:  false,
      evented:     false,
      data:        { zoneIndex: index, isZone: true },
    });
  }
  canvas.add(shape);
});
```

- [ ] **Step 3: Update applyZoneClip to support SVG clipPath**

Modify the `applyZoneClip` helper to use Path when zone has SVG boundary:

```js
const applyZoneClip = useCallback((obj, zoneIdx) => {
  if (isFreeMove) return;
  const zones = views[currentViewIndex]?.zones_config || [];
  if (zoneIdx < 0 || !zones[zoneIdx] || zones[zoneIdx].behavior !== 'restrict') return;
  const zone = zones[zoneIdx];

  if (zone.boundary_type === 'svg' && zone.svg_path_data) {
    obj.clipPath = new Path(zone.svg_path_data, {
      left:   zone.x,
      top:    zone.y,
      scaleX: zone.svg_scale || 1,
      scaleY: zone.svg_scale || 1,
      angle:  zone.svg_rotation || 0,
      absolutePositioned: true,
    });
  } else {
    obj.clipPath = new Rect({
      left:   zone.x,
      top:    zone.y,
      width:  zone.width,
      height: zone.height,
      absolutePositioned: true,
    });
  }
}, [views, currentViewIndex, isFreeMove]);
```

- [ ] **Step 4: Update frontend DesignerCanvas.jsx to support SVG clipPath**

In `frontend/js/designer/src/components/DesignerCanvas.jsx`, update the `applyZoneClip` function similarly:

Add `Path` to the fabric import. Then update `applyZoneClip`:

```js
const applyZoneClip = useCallback((obj, zoneIdx) => {
  if (zoneIdx < 0 || !zones[zoneIdx] || zones[zoneIdx].behavior !== 'restrict') return;
  const zone = zones[zoneIdx];

  if (zone.boundary_type === 'svg' && zone.svg_path_data) {
    obj.clipPath = new Path(zone.svg_path_data, {
      left:   zone.x,
      top:    zone.y,
      scaleX: zone.svg_scale || 1,
      scaleY: zone.svg_scale || 1,
      angle:  zone.svg_rotation || 0,
      absolutePositioned: true,
    });
  } else {
    obj.clipPath = new Rect({
      left:   zone.x,
      top:    zone.y,
      width:  zone.width,
      height: zone.height,
      absolutePositioned: true,
    });
  }
}, [zones]);
```

- [ ] **Step 5: Verify build passes**

Run: `VITE_ENTRY=admin npx vite build && VITE_ENTRY=frontend npx vite build`

- [ ] **Step 6: Manual test**

1. Create a zone, set boundary type to "SVG Shape"
2. Upload a simple SVG (e.g., a circle or star path)
3. Verify SVG shape appears on canvas as zone boundary
4. Add a text layer — verify it clips to the SVG shape
5. Save and reload — verify SVG zone persists

- [ ] **Step 7: Commit**

```bash
git add admin/js/template-builder/src/components/Canvas.jsx frontend/js/designer/src/components/DesignerCanvas.jsx
git commit -m "feat: render SVG zones on canvas and use SVG clipPath"
```

---

### Task 15: Add new zone fields to store defaults

**Files:**
- Modify: `admin/js/template-builder/src/store/useTemplateStore.js`

- [ ] **Step 1: Update addZone default fields**

In the `addZone` action, ensure the zone object has SVG defaults. Update the spread to include defaults:

No code change needed if `ZoneForm.jsx` already sends the full object with defaults. But ensure the `DEFAULT` in ZoneForm includes the new fields (already done in Task 13).

Verify the store's `addZone` passes through all fields correctly — it does, since it spreads `...zone`.

- [ ] **Step 2: Verify full build**

Run: `VITE_ENTRY=admin npx vite build && VITE_ENTRY=frontend npx vite build`

- [ ] **Step 3: Final manual test round**

1. Phase 1: Zone enforcement works (clip, clamp, Free Move toggle)
2. Phase 2: Tree UI works (add zone, add layer, drag reorder, save/load)
3. Phase 3: SVG zones work (upload, render, clip, save/load)

- [ ] **Step 4: Commit**

```bash
git add admin/js/template-builder/src/store/useTemplateStore.js
git commit -m "feat: ensure SVG zone defaults in store"
```
