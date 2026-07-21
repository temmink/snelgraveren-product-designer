# "Use Selected Layers as Boundary" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Pro-gated Template Builder action that turns one or more selected vector (SVG) layers into a single SVG boundary, reusing the existing `boundary_type: 'svg'` zone model with inline `svg_markup`.

**Architecture:** A pure geometry-merge util composes the selected layers' inline SVGs into one standalone `<svg>` (via per-item `<g transform>`, so no path-coordinate math is needed) plus the union bounding box. A Pro-gated canvas-toolbar button feeds the current selection to that util and calls the store's `addZone`. The builder and frontend SVG-boundary renderers gain an `svg_markup` fallback (they currently require `svg_url`), and the server sanitiser is extended to clean a zone's own `svg_markup` on save.

**Tech Stack:** React 18 + Zustand, Fabric.js 6, Jest (pure-util tests), PHP (`enshrined/svg-sanitize`).

## Global Constraints

- **Pro gate:** the action is shown/enabled only when `window.sgpdTemplateBuilder?.isPremium` is truthy (same flag as `ImportLightBurn.jsx`).
- **Non-destructive:** the selected source layers are never removed or mutated.
- **Vector only:** only Fabric objects with `data.elementType === 'svg'` and a stored `svg_markup` contribute; other selected objects are ignored with a notice.
- **Inline storage:** the new zone stores `svg_markup` inline in `zones_config`; it never sets `svg_url`. Do **not** generate `svg_path_data` (it is never read; the clip clones the rendered zone object).
- **Rotation ignored (v1):** merge uses translate + scale only (`angle` is not applied).
- **Security:** a zone's `svg_markup` is admin-authored but served to every customer, so it MUST be run through `\enshrined\svgSanitize\Sanitizer` on view create/update.
- **Fabric JSON:** custom `data` is preserved via `canvas.toJSON(['data'])`; SVG groups override `toObject` to include `data` (existing pattern — do not regress).
- **CSS:** any new button uses the existing `pf-canvas-toolbar__btn` class.

---

### Task 1: Pure geometry-merge util

**Files:**
- Create: `admin/js/template-builder/src/utils/mergeLayersToBoundary.js`
- Test: `tests/js/utils/mergeLayersToBoundary.test.js`

**Interfaces:**
- Produces: `mergeLayersToBoundary(items) → { svg_markup: string, x: number, y: number, width: number, height: number } | null`
  - `items`: `Array<{ svgMarkup: string, left: number, top: number, width: number, height: number, scaleX: number, scaleY: number }>` where `left/top` are the object's canvas-space origin, `width/height` are its on-canvas size (`obj.width * scaleX`, `obj.height * scaleY`), and `svgMarkup` is the layer's stored inline SVG.
  - Returns `null` when no item carries any `<path>` geometry.

- [ ] **Step 1: Write the failing tests**

```js
// tests/js/utils/mergeLayersToBoundary.test.js
import { mergeLayersToBoundary } from '../../../admin/js/template-builder/src/utils/mergeLayersToBoundary';

const item = (over) => ({
  svgMarkup: '<svg viewBox="0 0 10 10"><path d="M0 0L10 0L10 10Z" fill="none" stroke="#e00"/></svg>',
  left: 0, top: 0, width: 10, height: 10, scaleX: 1, scaleY: 1, ...over,
});

describe('mergeLayersToBoundary', () => {
  it('returns null for empty input', () => {
    expect(mergeLayersToBoundary([])).toBeNull();
  });

  it('returns null when no item has a <path>', () => {
    expect(mergeLayersToBoundary([item({ svgMarkup: '<svg></svg>' })])).toBeNull();
  });

  it('unions the bounding box across two offset layers', () => {
    const r = mergeLayersToBoundary([
      item({ left: 0, top: 0, width: 10, height: 10 }),
      item({ left: 90, top: 40, width: 10, height: 10 }),
    ]);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.width).toBe(100);   // 90 + 10 - 0
    expect(r.height).toBe(50);   // 40 + 10 - 0
  });

  it('positions each layer via a translate group relative to the bbox top-left', () => {
    const r = mergeLayersToBoundary([
      item({ left: 20, top: 5, width: 10, height: 10 }),
      item({ left: 90, top: 40, width: 10, height: 10 }),
    ]);
    // bbox top-left is (20,5); groups are offset by (left-minX, top-minY)
    expect(r.svg_markup).toContain('translate(0 0)');    // first item at bbox origin
    expect(r.svg_markup).toContain('translate(70 35)');  // second item: 90-20, 40-5
    expect(r.svg_markup).toContain('viewBox="0 0 80 45"');
    // both source paths are present
    expect((r.svg_markup.match(/<path/g) || []).length).toBe(2);
  });

  it('bakes each layer scale into its group transform', () => {
    const r = mergeLayersToBoundary([item({ left: 0, top: 0, width: 20, height: 20, scaleX: 2, scaleY: 2 })]);
    expect(r.svg_markup).toContain('scale(2 2)');
    expect(r.width).toBe(20);
    expect(r.height).toBe(20);
  });

  it('extracts multiple paths from one layer', () => {
    const r = mergeLayersToBoundary([item({
      svgMarkup: '<svg><path d="M0 0L5 0"/><path d="M0 5L5 5"/></svg>',
    })]);
    expect((r.svg_markup.match(/<path/g) || []).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/js/utils/mergeLayersToBoundary.test.js`
Expected: FAIL — "Cannot find module '.../mergeLayersToBoundary'".

- [ ] **Step 3: Write the implementation**

```js
// admin/js/template-builder/src/utils/mergeLayersToBoundary.js

/** Round to 3 decimals and strip trailing zeros. */
const n = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Number.isFinite(r) ? r : 0;
};

/** Extract the `d` value of every <path> in an SVG markup string. */
function extractPathData(svgMarkup) {
  const out = [];
  const re = /<path\b[^>]*\bd="([^"]*)"/g;
  let m;
  while ((m = re.exec(String(svgMarkup || ''))) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/**
 * Merge selected vector layers into one standalone inline SVG boundary plus
 * its canvas-space bounding box.
 *
 * Each item's paths are wrapped in a `<g transform="translate(dx dy) scale(sx sy)">`
 * so no path-coordinate math is needed — the group transform maps the layer's
 * local path coordinates into the union-local frame (bbox top-left = 0,0). The
 * boundary is later rendered at left=x, top=y, scale=1, reproducing the union.
 *
 * @param {Array<{svgMarkup:string,left:number,top:number,width:number,height:number,scaleX:number,scaleY:number}>} items
 * @returns {{svg_markup:string,x:number,y:number,width:number,height:number}|null}
 */
export function mergeLayersToBoundary(items) {
  const withPaths = (items || [])
    .filter((it) => it && it.svgMarkup)
    .map((it) => ({ ...it, paths: extractPathData(it.svgMarkup) }))
    .filter((it) => it.paths.length > 0);

  if (!withPaths.length) return null;

  const minX = Math.min(...withPaths.map((i) => i.left));
  const minY = Math.min(...withPaths.map((i) => i.top));
  const maxX = Math.max(...withPaths.map((i) => i.left + i.width));
  const maxY = Math.max(...withPaths.map((i) => i.top + i.height));
  const width = n(maxX - minX);
  const height = n(maxY - minY);

  const groups = withPaths.map((i) => {
    const dx = n(i.left - minX);
    const dy = n(i.top - minY);
    const sx = n(i.scaleX || 1);
    const sy = n(i.scaleY || 1);
    const paths = i.paths.map((d) => `<path d="${d}" fill="none"/>`).join('');
    return `<g transform="translate(${dx} ${dy}) scale(${sx} ${sy})">${paths}</g>`;
  }).join('');

  const svg_markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `
    + `viewBox="0 0 ${width} ${height}">${groups}</svg>`;

  return { svg_markup, x: n(minX), y: n(minY), width, height };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/js/utils/mergeLayersToBoundary.test.js`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add admin/js/template-builder/src/utils/mergeLayersToBoundary.js tests/js/utils/mergeLayersToBoundary.test.js
git commit -m "feat(boundary): pure util to merge selected vector layers into one SVG boundary"
```

---

### Task 2: "Use as boundary" toolbar action

**Files:**
- Modify: `admin/js/template-builder/src/components/Canvas.jsx`

**Interfaces:**
- Consumes: `mergeLayersToBoundary` (Task 1); the store's `addZone(viewIndex, zone)`; Fabric `canvas.getActiveObjects()`; selected object `data` shape `{ layerKey, layerIndex, zoneIndex, elementType }` (set by `layerData`).
- Produces: a new zone appended to the current view via `addZone`.

**Context:** `Canvas.jsx` already imports the store and Fabric, tracks selection (`hasSelection`, `selection:created/updated/cleared`), and renders a `<div className="pf-canvas-toolbar">` (around line 1037) containing the Free Move / Background / Undo / Redo buttons. `fabricRef.current` is the Fabric canvas. The current view index and `views` are available from the store. The stored layer for a selected object is `views[currentViewIndex].zones_config[obj.data.zoneIndex].layers[obj.data.layerIndex]` and carries `svg_markup`. Premium flag: `window.sgpdTemplateBuilder?.isPremium`.

- [ ] **Step 1: Add the premium flag and the handler**

Near the top of the component (with the other `useTemplateStore` destructuring / refs), ensure `addZone` is pulled from the store and add the import:

```js
import { mergeLayersToBoundary } from '../utils/mergeLayersToBoundary';
```

Add a handler inside the component (Fabric-space, reads live objects):

```js
const isPremium = window.sgpdTemplateBuilder?.isPremium;

const handleUseAsBoundary = useCallback(() => {
  const canvas = fabricRef.current;
  if (!canvas) return;
  const active = canvas.getActiveObjects() || [];
  const views = useTemplateStore.getState().views;   // read fresh (avoid stale closure)
  const view = views[currentViewIndex];

  const items = [];
  let ignored = 0;
  active.forEach((obj) => {
    const d = obj.data || {};
    const layer = view?.zones_config?.[d.zoneIndex]?.layers?.[d.layerIndex];
    if (d.elementType === 'svg' && layer && layer.svg_markup) {
      items.push({
        svgMarkup: layer.svg_markup,
        left: obj.left,
        top: obj.top,
        width: obj.width * (obj.scaleX || 1),
        height: obj.height * (obj.scaleY || 1),
        scaleX: obj.scaleX || 1,
        scaleY: obj.scaleY || 1,
      });
    } else {
      ignored += 1;
    }
  });

  const merged = items.length ? mergeLayersToBoundary(items) : null;
  if (!merged) {
    window.alert(__( 'Select at least one vector layer to use as a boundary.', 'snelgraveren-product-designer' ));
    return;
  }

  addZone(currentViewIndex, {
    name: __( 'Boundary', 'snelgraveren-product-designer' ),
    type: 'safe_area',
    behavior: 'restrict',
    boundary_type: 'svg',
    svg_markup: merged.svg_markup,
    svg_intrinsic_width: merged.width,
    svg_intrinsic_height: merged.height,
    x: merged.x,
    y: merged.y,
    width: merged.width,
    height: merged.height,
    svg_scale: 1,
    allowed_types: ['text', 'image', 'svg'],
  });

  if (ignored > 0) {
    window.alert(
      __( 'Boundary created. Ignored non-vector layers: ', 'snelgraveren-product-designer' ) + ignored
    );
  }
}, [currentViewIndex, addZone]);
```

(If `addZone` is not already destructured from `useTemplateStore()` at the top of the component, add it there.)

- [ ] **Step 2: Add the Pro-gated button to the toolbar**

Inside the `<div className="pf-canvas-toolbar">`, after the Free Move button block, add:

```jsx
{isPremium && hasSelection && (
  <button
    className="pf-canvas-toolbar__btn"
    onClick={handleUseAsBoundary}
    title={ __( 'Turn the selected vector layer(s) into a boundary', 'snelgraveren-product-designer' ) }
  >
    { __( 'Use as Boundary', 'snelgraveren-product-designer' ) }
  </button>
)}
```

- [ ] **Step 3: Build and verify no crash**

Run: `npm run build`
Expected: build succeeds; `dist/admin-template-builder.js` regenerated.

- [ ] **Step 4: Commit**

```bash
git add admin/js/template-builder/src/components/Canvas.jsx
git commit -m "feat(boundary): Use-as-Boundary toolbar action (Pro) from selected vector layers"
```

---

### Task 3: Render inline `svg_markup` boundaries in the builder

**Files:**
- Modify: `admin/js/template-builder/src/components/Canvas.jsx` (zone-sync effect, the `boundary_type === 'svg'` branch, ~line 341)

**Interfaces:**
- Consumes: a zone with `boundary_type: 'svg'` and `svg_markup` (Task 2) **or** `svg_url` (existing).
- Produces: a rendered, back-sent boundary group; existing clip logic (clones the group) then applies unchanged.

**Context:** The current branch guards on `zone.svg_url` and, in the async path, does `fetch(zone.svg_url).then(r => r.text()).then(svgText => parseSvgToFabric(svgText))`. `parseSvgToFabric` (from `../utils/svgPathUtils`) accepts an SVG string. For inline markup we skip the fetch and pass `zone.svg_markup` straight in.

- [ ] **Step 1: Widen the branch guard**

Change:
```js
if (zone.boundary_type === 'svg' && zone.svg_url) {
```
to:
```js
if (zone.boundary_type === 'svg' && (zone.svg_url || zone.svg_markup)) {
```

- [ ] **Step 2: Feed inline markup into the async loader**

In the `else` (create) sub-branch, replace:
```js
fetch(zone.svg_url)
  .then((r) => r.text())
  .then((svgText) => parseSvgToFabric(svgText))
```
with:
```js
(zone.svg_url
  ? fetch(zone.svg_url).then((r) => r.text())
  : Promise.resolve(zone.svg_markup))
  .then((svgText) => parseSvgToFabric(svgText))
```
Leave the rest of the `.then((result) => { ... })` chain (grouping, `zoneStyleFor`, positioning at `zone.x/zone.y`, `sendZonesToBack`, clip re-apply) unchanged. The in-place update sub-branch (when `existing` is present) needs no change — it only repositions/restyles an already-rendered group.

- [ ] **Step 3: Build and manually verify**

Run: `npm run build`
Then in the builder (dev): import the LightBurn lion → select the outer ring layer → **Use as Boundary** → a Safe Area boundary appears over the ring; drag a text layer and confirm it is restricted inside the ring; the source ring layer is still present and editable. Save the template, reload the page, and confirm the boundary persists and still restricts.

- [ ] **Step 4: Commit**

```bash
git add admin/js/template-builder/src/components/Canvas.jsx
git commit -m "feat(boundary): render inline svg_markup boundaries in the builder canvas"
```

---

### Task 4: Render inline `svg_markup` boundaries in the frontend designer

**Files:**
- Modify: `frontend/js/designer/src/components/DesignerCanvas.jsx` (zone render, the `boundary_type === 'svg'` branch, ~line 300)

**Interfaces:**
- Consumes: a zone with `boundary_type: 'svg'` and `svg_markup` **or** `svg_url`.
- Produces: a rendered boundary overlay in the customer designer that restricts/clips content, identical to the `svg_url` path.

**Context:** The current branch guards on `zone.svg_url` and does `fetch(zone.svg_url).then((r) => r.text()).then((svgString) => loadSVGFromString(svgString))`. The subsequent `.then(({ objects, options }) => { ... })` builds the group, sets `left/top/scale/angle`, overrides `toObject` to preserve `data`, and styles the outline — all of which must stay unchanged.

- [ ] **Step 1: Widen the guard and source the markup**

Change:
```js
if (zone.boundary_type === 'svg' && zone.svg_url) {
  const promise = fetch(zone.svg_url)
    .then((r) => r.text())
    .then((svgString) => loadSVGFromString(svgString))
```
to:
```js
if (zone.boundary_type === 'svg' && (zone.svg_url || zone.svg_markup)) {
  const promise = (zone.svg_url
    ? fetch(zone.svg_url).then((r) => r.text())
    : Promise.resolve(zone.svg_markup))
    .then((svgString) => loadSVGFromString(svgString))
```
Leave the rest of the `.then` chain and `svgZonePromises.push(promise)` unchanged.

- [ ] **Step 2: Build and manually verify**

Run: `npm run build`
Then open the saved template's product page in the frontend designer and confirm the boundary renders and restricts/clips customer content the same as a rectangle/SVG-URL boundary.

- [ ] **Step 3: Commit**

```bash
git add frontend/js/designer/src/components/DesignerCanvas.jsx
git commit -m "feat(boundary): render inline svg_markup boundaries in the frontend designer"
```

---

### Task 5: Sanitise a zone's own `svg_markup` on save

**Files:**
- Modify: `includes/API/class-rest-templates.php` (`sanitize_zone_layers`, ~line 269)

**Interfaces:**
- Consumes: `zones_config` arrays on view create/update (already routed through `sanitize_zone_layers`).
- Produces: every zone's own `svg_markup` (and each layer's, as before) is sanitised or dropped.

**Context:** `sanitize_zone_layers` currently iterates `$zone['layers']` and sanitises `$layer['svg_markup']`. It `continue`s past zones with no layers — which would skip a boundary-only zone. The zone-level `svg_markup` must be handled **before** that `continue`, in both the no-sanitiser and sanitiser paths.

- [ ] **Step 1: Rewrite `sanitize_zone_layers` to also cover zone-level markup**

Replace the method body with:

```php
    private function sanitize_zone_layers(array $zones): array {
        $have_sanitizer = class_exists(\enshrined\svgSanitize\Sanitizer::class);
        $sanitizer = $have_sanitizer ? new \enshrined\svgSanitize\Sanitizer() : null;

        $clean_markup = static function ($markup) use ($sanitizer) {
            if (!is_string($markup) || $markup === '') {
                return '';
            }
            if (!$sanitizer) {
                return null; // signal: drop it
            }
            $clean = $sanitizer->sanitize($markup);
            return is_string($clean) ? $clean : '';
        };

        foreach ($zones as &$zone) {
            // Zone-level boundary markup (a zone may have no layers).
            if (is_array($zone) && isset($zone['svg_markup'])) {
                $clean = $clean_markup($zone['svg_markup']);
                if ($clean === null) {
                    unset($zone['svg_markup']);
                } else {
                    $zone['svg_markup'] = $clean;
                }
            }

            if (empty($zone['layers']) || !is_array($zone['layers'])) {
                continue;
            }
            foreach ($zone['layers'] as &$layer) {
                if (is_array($layer) && isset($layer['svg_markup'])) {
                    $clean = $clean_markup($layer['svg_markup']);
                    if ($clean === null) {
                        unset($layer['svg_markup']);
                    } else {
                        $layer['svg_markup'] = $clean;
                    }
                }
            }
            unset($layer);
        }
        unset($zone);
        return $zones;
    }
```

- [ ] **Step 2: Manually verify sanitisation**

With the dev stack running, save a view whose `zones_config` contains a zone with `svg_markup` embedding `<script>alert(1)</script><path d="M0 0L1 1"/>` (e.g. via the builder after creating a boundary, or a REST call). Reload and confirm the stored zone `svg_markup` no longer contains `<script>` but keeps the `<path>`.

Optional PHP lint:
Run: `php -l includes/API/class-rest-templates.php`
Expected: "No syntax errors detected".

- [ ] **Step 3: Commit**

```bash
git add includes/API/class-rest-templates.php
git commit -m "security(boundary): sanitise a zone's own svg_markup on view save"
```

---

## Self-Review Notes

- **Spec coverage:** merge util (Task 1), toolbar action + Pro gate + non-destructive + vector-only (Task 2), builder render fallback (Task 3), frontend render fallback (Task 4), server sanitisation (Task 5). Clip logic is intentionally untouched (it clones the rendered boundary group, which now exists for `svg_markup` zones).
- **No `svg_path_data`:** confirmed unused; not generated.
- **Type consistency:** `mergeLayersToBoundary` returns `{ svg_markup, x, y, width, height }`; Task 2 maps `width/height` → both `svg_intrinsic_width/height` and `width/height`, sets `svg_scale: 1`, `x/y` → zone `x/y` — matching the render branches which position at `zone.x/zone.y` with `scaleX/scaleY = zone.svg_scale`.
- **Rotation:** ignored by design; the merge input carries no `angle`.
