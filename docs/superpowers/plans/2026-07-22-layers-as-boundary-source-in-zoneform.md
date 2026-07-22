# Layer-Selection as Boundary Source (ZoneForm) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the admin Template Builder's Boundary form, when boundary type is "SVG Shape", let the merchant pick one or more of the current view's imported SVG layers and use their merged outline as the boundary — as an alternative source to uploading an SVG file.

**Architecture:** A new pure helper turns a stored svg layer descriptor into a `mergeLayersToBoundary` item (parsing the layer's intrinsic size from its inline `svg_markup`). `ZoneForm` gains an Upload/From-layers source toggle; the "From layers" mode lists the view's eligible svg layers with thumbnails, and on selection change runs the existing `mergeLayersToBoundary` (1.5.0) to set the zone's inline `svg_markup` + bbox. Everything downstream (render, clip, server sanitisation) is the existing inline-`svg_markup` boundary pipeline — no backend or frontend change.

**Tech Stack:** React 18 + Zustand, Jest (pure-util tests). Reuses `mergeLayersToBoundary` from 1.5.0.

## Global Constraints

- **Admin only:** changes are confined to the Template Builder (`ZoneForm` + one util). No customer/frontend file and no PHP change — inline `svg_markup` boundaries already render/clip/sanitise (shipped 1.5.0).
- **Reuse, don't reinvent:** merging uses the existing `admin/js/template-builder/src/utils/mergeLayersToBoundary.js` (`mergeLayersToBoundary(items) → { svg_markup, x, y, width, height } | null`, items `{ svgMarkup, left, top, width, height, scaleX, scaleY }`). Do not modify it.
- **Eligible layers only:** a layer qualifies iff `layer.type === 'svg' && layer.svg_markup` (LightBurn-imported inline geometry). URL-only svg layers are excluded in v1.
- **One source at a time:** on a zone, `svg_url` and `svg_markup` are mutually exclusive. Applying layers sets `svg_markup` and clears `svg_url`; switching to Upload clears `svg_markup`.
- **Do not produce `svg_path_data`** (never read).
- **Pro gate is inherited:** the SVG-Shape option is already gated by `window.sgpdTemplateBuilder?.isPremium`; the layers source lives inside that gated block. Do not add a separate gate.
- **Thumbnails/preview are rendered via a `data:image/svg+xml` `<img>` src** (not `dangerouslySetInnerHTML`), CSS-constrained to a fixed box.
- **Selection keys are composite `"${zoneIndex}:${layerIndex}"`** strings (deterministic; do not depend on a layer `_key`).

---

### Task 1: Pure helper — layer descriptor → merge item

**Files:**
- Create: `admin/js/template-builder/src/utils/layerBoundaryItems.js`
- Test: `tests/js/utils/layerBoundaryItems.test.js`

**Interfaces:**
- Produces:
  - `svgMarkupIntrinsicSize(svgMarkup: string) → { width: number, height: number }` — intrinsic px size from the `<svg>`'s `width`/`height` attrs, falling back to `viewBox`; `{width:0,height:0}` when unparseable.
  - `layerToBoundaryItem(layer: object) → { svgMarkup, left, top, width, height, scaleX, scaleY } | null` — a `mergeLayersToBoundary` item from a stored svg layer; `null` when the layer has no `svg_markup` or no parseable size.
- Consumes (in Task 2): `mergeLayersToBoundary` (existing).

- [ ] **Step 1: Write the failing tests**

```js
// tests/js/utils/layerBoundaryItems.test.js
import { svgMarkupIntrinsicSize, layerToBoundaryItem } from '../../../admin/js/template-builder/src/utils/layerBoundaryItems';
import { mergeLayersToBoundary } from '../../../admin/js/template-builder/src/utils/mergeLayersToBoundary';

describe('svgMarkupIntrinsicSize', () => {
  it('reads width/height attributes', () => {
    expect(svgMarkupIntrinsicSize('<svg width="60" height="40" viewBox="0 0 60 40"></svg>'))
      .toEqual({ width: 60, height: 40 });
  });
  it('falls back to viewBox when width/height are absent', () => {
    expect(svgMarkupIntrinsicSize('<svg viewBox="0 0 60 40"></svg>'))
      .toEqual({ width: 60, height: 40 });
  });
  it('returns zeros when unparseable', () => {
    expect(svgMarkupIntrinsicSize('<svg></svg>')).toEqual({ width: 0, height: 0 });
    expect(svgMarkupIntrinsicSize('')).toEqual({ width: 0, height: 0 });
  });
});

describe('layerToBoundaryItem', () => {
  const layer = (over) => ({
    type: 'svg',
    svg_markup: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0L10 0L10 10Z"/></svg>',
    left: 20, top: 5, scaleX: 2, scaleY: 2, ...over,
  });

  it('builds an item with on-canvas size = intrinsic * scale', () => {
    expect(layerToBoundaryItem(layer())).toEqual({
      svgMarkup: layer().svg_markup,
      left: 20, top: 5, width: 20, height: 20, scaleX: 2, scaleY: 2,
    });
  });
  it('defaults scale to 1 and left/top to 0', () => {
    const it = layerToBoundaryItem({ svg_markup: '<svg width="10" height="10"></svg>' });
    expect(it.scaleX).toBe(1); expect(it.scaleY).toBe(1);
    expect(it.left).toBe(0); expect(it.top).toBe(0);
    expect(it.width).toBe(10); expect(it.height).toBe(10);
  });
  it('returns null without svg_markup or parseable size', () => {
    expect(layerToBoundaryItem({ type: 'svg' })).toBeNull();
    expect(layerToBoundaryItem(null)).toBeNull();
    expect(layerToBoundaryItem({ svg_markup: '<svg></svg>' })).toBeNull();
  });
  it('feeds mergeLayersToBoundary: two layers → union bbox', () => {
    const items = [
      layerToBoundaryItem(layer({ left: 0, top: 0, scaleX: 1, scaleY: 1 })),   // 10x10 @ (0,0)
      layerToBoundaryItem(layer({ left: 90, top: 40, scaleX: 1, scaleY: 1 })), // 10x10 @ (90,40)
    ];
    const merged = mergeLayersToBoundary(items);
    expect(merged.x).toBe(0); expect(merged.y).toBe(0);
    expect(merged.width).toBe(100); expect(merged.height).toBe(50);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/js/utils/layerBoundaryItems.test.js`
Expected: FAIL — "Cannot find module '.../layerBoundaryItems'".

- [ ] **Step 3: Write the implementation**

```js
// admin/js/template-builder/src/utils/layerBoundaryItems.js

/**
 * Intrinsic pixel size of an inline <svg> string. Prefers the root <svg>'s
 * width/height attributes; falls back to the viewBox's w/h. Returns zeros when
 * neither is parseable.
 * @param {string} svgMarkup
 * @returns {{width:number,height:number}}
 */
export function svgMarkupIntrinsicSize(svgMarkup) {
  const s = String(svgMarkup || '');
  const wm = s.match(/<svg[^>]*\bwidth="([\d.]+)"/i);
  const hm = s.match(/<svg[^>]*\bheight="([\d.]+)"/i);
  let width = wm ? parseFloat(wm[1]) : 0;
  let height = hm ? parseFloat(hm[1]) : 0;
  if (!width || !height) {
    const vb = s.match(/viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)"/i);
    if (vb) {
      width = width || parseFloat(vb[1]);
      height = height || parseFloat(vb[2]);
    }
  }
  return { width: width || 0, height: height || 0 };
}

/**
 * Build a mergeLayersToBoundary item from a stored svg layer descriptor.
 * The layer's own left/top are already canvas-absolute; on-canvas size is the
 * intrinsic size scaled by the layer's scaleX/scaleY. Returns null when the
 * layer carries no inline geometry or its size can't be parsed.
 * @param {object} layer
 * @returns {{svgMarkup:string,left:number,top:number,width:number,height:number,scaleX:number,scaleY:number}|null}
 */
export function layerToBoundaryItem(layer) {
  if (!layer || !layer.svg_markup) return null;
  const { width: iw, height: ih } = svgMarkupIntrinsicSize(layer.svg_markup);
  if (!iw || !ih) return null;
  const scaleX = layer.scaleX || 1;
  const scaleY = layer.scaleY || 1;
  return {
    svgMarkup: layer.svg_markup,
    left: layer.left || 0,
    top: layer.top || 0,
    width: iw * scaleX,
    height: ih * scaleY,
    scaleX,
    scaleY,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/js/utils/layerBoundaryItems.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add admin/js/template-builder/src/utils/layerBoundaryItems.js tests/js/utils/layerBoundaryItems.test.js
git commit -m "feat(boundary): helper to build merge items from stored svg layers"
```

---

### Task 2: ZoneForm — Upload/From-layers source toggle + layer picker

**Files:**
- Modify: `admin/js/template-builder/src/components/ZoneForm.jsx`
- Modify: `admin/js/template-builder/src/builder.css` (thumbnail/preview styles)

**Interfaces:**
- Consumes: `layerToBoundaryItem` (Task 1); `mergeLayersToBoundary` (existing); the store's `views` + `currentViewIndex`.
- Produces: sets the form's zone data to an inline-`svg_markup` SVG boundary when layers are picked.

**Context:** `ZoneForm({ initialData, onSubmit, onCancel, onChange })` holds all zone fields in `data` (via `useState({ ...DEFAULT, ...initialData })`). `set(key, val)` updates one field and calls `onChange(next)`; multi-field updates use `setData((d) => { const next = {...d, …}; if (onChange) onChange(next); return next; })` (see the existing SVG upload handler). The SVG section is the block `{data.boundary_type === 'svg' && ( … )}` (currently: an upload button when `!data.svg_url`, else a preview + Scale/Rotation/Fill controls gated on `data.svg_url`). The component already imports `useTemplateStore` and destructures `{ globalConfig, customFonts }` from it.

- [ ] **Step 1: Add imports and store/state wiring**

Add imports at the top:
```js
import { mergeLayersToBoundary } from '../utils/mergeLayersToBoundary';
import { layerToBoundaryItem } from '../utils/layerBoundaryItems';
```

Extend the store destructure and add derived data + UI state inside the component (near `const [data, setData] = useState(...)`):
```js
const { globalConfig, customFonts, views, currentViewIndex } = useTemplateStore();

// Imported svg layers on the current view that carry inline geometry.
const eligibleLayers = (views[currentViewIndex]?.zones_config || []).flatMap((zone, zi) =>
  (zone.layers || [])
    .map((layer, li) => ({ layer, key: `${zi}:${li}` }))
    .filter(({ layer }) => layer.type === 'svg' && layer.svg_markup)
);

const [svgSource, setSvgSource] = useState(
  (initialData.svg_markup && !initialData.svg_url) ? 'layers' : 'upload'
);
const [selectedKeys, setSelectedKeys] = useState(() => new Set());
```

(Update the existing `const { globalConfig, customFonts } = useTemplateStore();` line to the extended destructure above — do not add a second `useTemplateStore()` call.)

- [ ] **Step 2: Add the selection/merge helpers**

Inside the component, after `set`:
```js
const applyLayerSelection = (keys) => {
  const items = eligibleLayers
    .filter(({ key }) => keys.has(key))
    .map(({ layer }) => layerToBoundaryItem(layer))
    .filter(Boolean);
  const merged = items.length ? mergeLayersToBoundary(items) : null;
  setData((d) => {
    const next = merged
      ? { ...d, boundary_type: 'svg', svg_url: '', svg_path_data: '',
          svg_markup: merged.svg_markup,
          svg_intrinsic_width: merged.width, svg_intrinsic_height: merged.height,
          x: merged.x, y: merged.y, width: merged.width, height: merged.height,
          svg_scale: 1 }
      : { ...d, svg_markup: '' };
    if (onChange) onChange(next);
    return next;
  });
};

const toggleLayer = (key) => {
  setSelectedKeys((prev) => {
    const nextSet = new Set(prev);
    if (nextSet.has(key)) nextSet.delete(key); else nextSet.add(key);
    applyLayerSelection(nextSet);
    return nextSet;
  });
};

const switchSvgSource = (src) => {
  setSvgSource(src);
  if (src === 'upload') {
    setSelectedKeys(new Set());
    setData((d) => { const next = { ...d, svg_markup: '' }; if (onChange) onChange(next); return next; });
  } else {
    setData((d) => { const next = { ...d, svg_url: '', svg_path_data: '' }; if (onChange) onChange(next); return next; });
  }
};
```

- [ ] **Step 3: Render the source toggle + layers picker in the SVG block**

Immediately inside the `{data.boundary_type === 'svg' && (` block, BEFORE the existing upload button/preview markup, insert the toggle:
```jsx
<div className="pf-zone-form__svg-source">
  <label className="pf-zone-form__radio">
    <input type="radio" name="svg-source" checked={svgSource === 'upload'}
      onChange={() => switchSvgSource('upload')} />
    { __( 'Upload SVG', 'snelgraveren-product-designer' ) }
  </label>
  <label className="pf-zone-form__radio">
    <input type="radio" name="svg-source" checked={svgSource === 'layers'}
      onChange={() => switchSvgSource('layers')} />
    { __( 'From layers', 'snelgraveren-product-designer' ) }
  </label>
</div>
```

Wrap the EXISTING upload UI (the `{!data.svg_url ? (<button …Upload SVG Shape…/>) : null}` button AND the `{data.svg_url && (<>…Scale/Rotation/Fill…</>)}` block) so it only shows in upload mode — i.e. put `{svgSource === 'upload' && (` … existing markup … `)}` around it.

Then add the layers picker after it:
```jsx
{svgSource === 'layers' && (
  <div className="pf-zone-form__layer-picker">
    {eligibleLayers.length === 0 ? (
      <p className="pf-zone-form__hint">
        { __( 'No vector layers with editable geometry on this view. Import a LightBurn file first, then reopen this form.', 'snelgraveren-product-designer' ) }
      </p>
    ) : (
      <>
        <ul className="pf-zone-form__layer-list">
          {eligibleLayers.map(({ layer, key }, i) => (
            <li key={key} className="pf-zone-form__layer-item">
              <label>
                <input type="checkbox" checked={selectedKeys.has(key)} onChange={() => toggleLayer(key)} />
                <img className="pf-zone-form__layer-thumb" alt=""
                  src={`data:image/svg+xml;utf8,${encodeURIComponent(layer.svg_markup)}`} />
                <span>{ __( 'Layer', 'snelgraveren-product-designer' ) } {i + 1}</span>
              </label>
            </li>
          ))}
        </ul>
        {data.svg_markup && (
          <div className="pf-zone-form__layer-preview">
            <img alt="" src={`data:image/svg+xml;utf8,${encodeURIComponent(data.svg_markup)}`} />
          </div>
        )}
      </>
    )}
  </div>
)}
```

- [ ] **Step 4: Add thumbnail/preview CSS**

Append to `admin/js/template-builder/src/builder.css`:
```css
.pf-zone-form__svg-source { display: flex; gap: 12px; margin-bottom: 8px; }
.pf-zone-form__svg-source .pf-zone-form__radio { display: inline-flex; align-items: center; gap: 4px; color: #1e1e1e; }
.pf-zone-form__layer-picker { margin-top: 6px; }
.pf-zone-form__layer-list { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px; }
.pf-zone-form__layer-item { border-bottom: 1px solid #f0f0f0; }
.pf-zone-form__layer-item:last-child { border-bottom: none; }
.pf-zone-form__layer-item label { display: flex; align-items: center; gap: 8px; padding: 4px 8px; cursor: pointer; color: #1e1e1e; }
.pf-zone-form__layer-thumb { width: 32px; height: 32px; object-fit: contain; background: #fff; border: 1px solid #eee; flex: none; }
.pf-zone-form__layer-preview { margin-top: 8px; text-align: center; }
.pf-zone-form__layer-preview img { max-width: 120px; max-height: 120px; object-fit: contain; border: 1px solid #eee; background: #fff; }
.pf-zone-form__hint { color: #757575; font-style: italic; margin: 4px 0; }
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: succeeds; `dist/admin-template-builder.js` regenerated. `dist/` is gitignored — commit only source (`ZoneForm.jsx`, `builder.css`).

Manual (dev, admin): import the LightBurn lion → **+ Add Boundary** → set Boundary = **SVG Shape** → toggle **From layers** → the checklist lists the view's svg layers with thumbnails → check the outer ring → a preview appears and the on-canvas boundary matches the ring at the correct size → **Save Boundary** → reopen the template and confirm the boundary persists and restricts content. Verify **Upload SVG** still works and that switching source keeps exactly one of `svg_url`/`svg_markup` set.

- [ ] **Step 6: Commit**

```bash
git add admin/js/template-builder/src/components/ZoneForm.jsx admin/js/template-builder/src/builder.css
git commit -m "feat(boundary): pick imported svg layers as an SVG-shape boundary source in ZoneForm"
```

---

## Self-Review Notes

- **Spec coverage:** helper (Task 1); source toggle + eligible-layer checklist + thumbnails + live merge + preview + mutual exclusivity + no-eligible-layers hint (Task 2). No frontend/PHP change (inline `svg_markup` boundary render/clip/sanitise already shipped in 1.5.0).
- **Reuse:** `mergeLayersToBoundary` unchanged; the produced zone matches the uploaded-SVG boundary shape but inline. No `svg_path_data`.
- **Type consistency:** `layerToBoundaryItem` returns exactly the `{ svgMarkup, left, top, width, height, scaleX, scaleY }` shape `mergeLayersToBoundary` consumes; `applyLayerSelection` writes the same field set (`svg_markup`, `svg_intrinsic_width/height`, `x/y/width/height`, `svg_scale:1`, cleared `svg_url`) the render branches read.
- **Security:** thumbnails/preview use a `data:image/svg+xml` `<img>` src (no `dangerouslySetInnerHTML`, no script execution); the stored `svg_markup` is still server-sanitised on save by the existing pipeline.
