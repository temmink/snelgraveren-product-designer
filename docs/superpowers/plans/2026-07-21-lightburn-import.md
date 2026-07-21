# LightBurn (.lbrn2) Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a merchant import a LightBurn `.lbrn2` file in the Template Builder so its paths and text become individual, editable template layers at true physical scale.

**Architecture:** A pure parser (`lbrnParser.js`) turns the LightBurn XML into store-ready layer descriptors — `text` layers and inline-vector `svg` layers (new `svg_markup` field). A new inline-vector layer type is rendered in the builder and the frontend designer, and its markup is sanitised server-side on save. A Pro-gated import button wires the parser into the builder.

**Tech Stack:** React 18 + Zustand + Fabric.js 6 (builder & frontend), Jest (unit tests), PHP 8.1 + `enshrined/svg-sanitize` (server).

## Global Constraints

- All JS unit tests run with `npx jest <path>` (config: `jest.config.js`, env jsdom).
- Fabric.js JSON serialisation always uses `canvas.toJSON(['data'])` — never bare `toJSON()`.
- Fabric.js 6 type names: runtime lowercase-hyphenated (`i-text`, `image`, `path`); JSON PascalCase. Compare case-insensitively.
- All uploaded/stored SVG served to customers MUST be sanitised with `enshrined\svgSanitize\Sanitizer`.
- Premium flag in the builder: `window.sgpdTemplateBuilder?.isPremium`.
- Fixed import resolution: `PX_PER_MM = 3.7795` (≈96 dpi), matching `svgPathUtils.js` unit conversion.
- CSS/UI strings use `__( '…', 'snelgraveren-product-designer' )` for i18n.
- New JS module lives at `admin/js/template-builder/src/utils/lbrnParser.js`; tests at `tests/js/utils/lbrnParser.test.js`.

---

## File Structure

- **Create** `admin/js/template-builder/src/utils/lbrnParser.js` — pure parser + geometry + layer building (Tasks 1–3).
- **Create** `tests/js/utils/lbrnParser.test.js` — unit tests (Tasks 1–3).
- **Create** `tests/js/fixtures/test_svg_import.lbrn2` — real-file fixture (Task 3).
- **Modify** `admin/js/template-builder/src/components/Canvas.jsx` — inline `svg_markup` render in the `svg` branch (Task 4).
- **Modify** `frontend/js/designer/src/components/DesignerCanvas.jsx` — render `svg` layers from the `zone.layers` loop (Task 5).
- **Modify** `includes/API/class-rest-templates.php` — sanitise `svg_markup` on view create/update (Task 6).
- **Create** `admin/js/template-builder/src/components/ImportLightBurn.jsx` — the Pro-gated import button (Task 7).
- **Modify** `admin/js/template-builder/src/components/ViewTabs.jsx` — mount the import button (Task 7).

---

## Task 1: Geometry decoder (`vertPrimToPathData`)

**Files:**
- Create: `admin/js/template-builder/src/utils/lbrnParser.js`
- Test: `tests/js/utils/lbrnParser.test.js`

**Interfaces:**
- Produces: `parseVertList(str) → Vertex[]`, `parsePrimList(str) → {cmd,a,b}[]`, `vertPrimToPathData(vertList, primList, transform?) → string`. `Vertex = {x,y,c0x,c0y,c1x,c1y}`. `transform` is an optional `(x,y) => [x,y]` applied to every coordinate (default identity).

- [ ] **Step 1: Write the failing test**

```js
// tests/js/utils/lbrnParser.test.js
import { vertPrimToPathData } from '../../../admin/js/template-builder/src/utils/lbrnParser';

describe('vertPrimToPathData', () => {
  it('builds a closed triangle from line primitives (Z instead of the closing line)', () => {
    expect(vertPrimToPathData('V0 0V10 0V10 10', 'L0 1L1 2L2 0'))
      .toBe('M0 0L10 0L10 10Z');
  });

  it('builds a cubic bezier using a.c1 (outgoing) and b.c0 (incoming) handles', () => {
    expect(vertPrimToPathData('V0 0c1x2c1y3V10 0c0x8c0y-3', 'B0 1'))
      .toBe('M0 0C2 3 8 -3 10 0');
  });

  it('defaults a missing handle component to the vertex coordinate', () => {
    // vertex 0 has only c1x=5 → c1y defaults to y (0)
    expect(vertPrimToPathData('V0 0c1x5V10 0c0x5', 'B0 1'))
      .toBe('M0 0C5 0 5 0 10 0');
  });

  it('applies the optional transform to every point', () => {
    const shift = (x, y) => [x + 100, y + 1];
    expect(vertPrimToPathData('V0 0V10 0V10 10', 'L0 1L1 2L2 0', shift))
      .toBe('M100 1L110 1L110 11Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/js/utils/lbrnParser.test.js -t vertPrimToPathData`
Expected: FAIL — "Cannot find module … lbrnParser" / `vertPrimToPathData is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// admin/js/template-builder/src/utils/lbrnParser.js

/** Round to 3 decimals, drop trailing zeros. */
function n(v) {
  return parseFloat(Number(v).toFixed(3));
}

/**
 * Parse a LightBurn VertList: `V{x} {y}` optionally followed by control-handle
 * tokens `c0x{v}` `c0y{v}` `c1x{v}` `c1y{v}`. A missing handle component
 * defaults to the vertex coordinate. c0 = incoming handle, c1 = outgoing.
 */
export function parseVertList(vertList) {
  const verts = [];
  const re = /V(-?[\d.]+) (-?[\d.]+)((?:c[01][xy]-?[\d.]+)*)/g;
  let m;
  while ((m = re.exec(vertList)) !== null) {
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    const v = { x, y, c0x: x, c0y: y, c1x: x, c1y: y };
    const hre = /c([01])([xy])(-?[\d.]+)/g;
    let h;
    while ((h = hre.exec(m[3])) !== null) v[`c${h[1]}${h[2]}`] = parseFloat(h[3]);
    verts.push(v);
  }
  return verts;
}

/** Parse a LightBurn PrimList: `L{a} {b}` = line a→b, `B{a} {b}` = bezier a→b. */
export function parsePrimList(primList) {
  const prims = [];
  const re = /([LB])(\d+) (\d+)/g;
  let m;
  while ((m = re.exec(primList)) !== null) {
    prims.push({ cmd: m[1], a: parseInt(m[2], 10), b: parseInt(m[3], 10) });
  }
  return prims;
}

/**
 * Convert a VertList/PrimList pair to an SVG path `d` string.
 * A primitive whose target is the subpath's start vertex closes it: a line
 * closes with `Z`; a bezier emits its curve then `Z`. `transform(x,y)→[x,y]`
 * is applied to every coordinate (vertices and handles).
 */
export function vertPrimToPathData(vertList, primList, transform) {
  const t = transform || ((x, y) => [x, y]);
  const verts = parseVertList(vertList);
  const prims = parsePrimList(primList);
  if (!verts.length || !prims.length) return '';
  const px = (x, y) => { const [a, b] = t(x, y); return `${n(a)} ${n(b)}`; };
  let d = '';
  let i = 0;
  while (i < prims.length) {
    const start = prims[i].a;
    const sv = verts[start];
    if (!sv) break;
    d += `M${px(sv.x, sv.y)}`;
    let cursor = start;
    while (i < prims.length && prims[i].a === cursor) {
      const p = prims[i];
      const a = verts[p.a];
      const b = verts[p.b];
      const closing = p.b === start;
      if (p.cmd === 'L') {
        if (!closing) d += `L${px(b.x, b.y)}`;
      } else {
        d += `C${px(a.c1x, a.c1y)} ${px(b.c0x, b.c0y)} ${px(b.x, b.y)}`;
      }
      cursor = p.b;
      i++;
      if (closing) { d += 'Z'; break; }
    }
  }
  return d;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/js/utils/lbrnParser.test.js -t vertPrimToPathData`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add admin/js/template-builder/src/utils/lbrnParser.js tests/js/utils/lbrnParser.test.js
git commit -m "feat(lbrn): VertList/PrimList to SVG path decoder"
```

---

## Task 2: Font + layer-colour helpers

**Files:**
- Modify: `admin/js/template-builder/src/utils/lbrnParser.js`
- Test: `tests/js/utils/lbrnParser.test.js`

**Interfaces:**
- Produces: `qtFontToFamily(fontString) → { family, weight }`; `layerColor(index) → '#rrggbb'`; exported const `PX_PER_MM = 3.7795`.

- [ ] **Step 1: Write the failing test**

```js
// append to tests/js/utils/lbrnParser.test.js
import { qtFontToFamily, layerColor } from '../../../admin/js/template-builder/src/utils/lbrnParser';

describe('qtFontToFamily', () => {
  it('reads family and normal weight from a Qt font string', () => {
    expect(qtFontToFamily('Arial,-1,4096,5,400,0,0,0,0,0'))
      .toEqual({ family: 'Arial', weight: 400 });
  });
  it('maps Qt weight >= 600 to bold (700)', () => {
    expect(qtFontToFamily('Arial,-1,4096,5,700,0,0,0,0,0'))
      .toEqual({ family: 'Arial', weight: 700 });
  });
  it('falls back to Arial/400 for empty input', () => {
    expect(qtFontToFamily('')).toEqual({ family: 'Arial', weight: 400 });
  });
});

describe('layerColor', () => {
  it('returns a hex colour and differs between indices', () => {
    expect(layerColor(0)).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(layerColor(0)).not.toBe(layerColor(2));
  });
  it('wraps indices beyond the palette', () => {
    expect(layerColor(30)).toBe(layerColor(0));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/js/utils/lbrnParser.test.js -t qtFontToFamily`
Expected: FAIL — `qtFontToFamily is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// append to admin/js/template-builder/src/utils/lbrnParser.js

export const PX_PER_MM = 3.7795; // ≈ 96 dpi; matches svgPathUtils.js unit conversion

/** LightBurn's default 30-colour layer palette (index → hex). Verify against
 *  the running LightBurn build if exact round-trip layer indices matter. */
const LBRN_PALETTE = [
  '#000000', '#0000ff', '#ff0000', '#00e000', '#d0d000', '#ff8000',
  '#00e0e0', '#ff00ff', '#b4b4b4', '#0000a0', '#a00000', '#00a000',
  '#a0a000', '#c08000', '#00a0a0', '#a000a0', '#808080', '#7d87b9',
  '#bb7784', '#4a6fe3', '#d33f6a', '#8cd78c', '#f0b98d', '#f6c4e1',
  '#fa9ed4', '#500a78', '#b45a00', '#004754', '#86fa88', '#ffdb66',
];

/** Stroke colour for a LightBurn cut-layer index (wraps at palette length). */
export function layerColor(index) {
  const L = LBRN_PALETTE.length;
  const i = ((Number(index) % L) + L) % L;
  return LBRN_PALETTE[i];
}

/** Qt QFont string `family,pointSize,pixelSize,styleHint,weight,…` → family + weight. */
export function qtFontToFamily(fontString) {
  const parts = String(fontString || '').split(',');
  const family = (parts[0] || '').trim() || 'Arial';
  const weight = parseInt(parts[4], 10) >= 600 ? 700 : 400;
  return { family, weight };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/js/utils/lbrnParser.test.js -t "qtFontToFamily|layerColor"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admin/js/template-builder/src/utils/lbrnParser.js tests/js/utils/lbrnParser.test.js
git commit -m "feat(lbrn): Qt font + LightBurn layer-colour helpers"
```

---

## Task 3: `parseLbrn` — XML to layer descriptors

**Files:**
- Modify: `admin/js/template-builder/src/utils/lbrnParser.js`
- Test: `tests/js/utils/lbrnParser.test.js`
- Create: `tests/js/fixtures/test_svg_import.lbrn2` (copy of the sample file)

**Interfaces:**
- Consumes: `vertPrimToPathData`, `qtFontToFamily`, `layerColor`, `PX_PER_MM` (Tasks 1–2).
- Produces: `parseLbrn(xmlString, { availableFonts }) → { layers: LayerDescriptor[], widthMm, heightMm, warnings: string[] }`.
  - text descriptor: `{ type: 'text', text, fontFamily, fontSize, left, top, fill, textAlign: 'left' }`
  - svg descriptor: `{ type: 'svg', svg_markup, left, top, scaleX: 1, scaleY: 1 }`
  - `availableFonts` = array of family-name strings the builder can render.

- [ ] **Step 1: Copy the fixture**

```bash
mkdir -p tests/js/fixtures
cp /Users/martintemmink/Downloads/test_svg_import.lbrn2 tests/js/fixtures/test_svg_import.lbrn2
```

- [ ] **Step 2: Write the failing test**

```js
// append to tests/js/utils/lbrnParser.test.js
import fs from 'fs';
import path from 'path';
import { parseLbrn } from '../../../admin/js/template-builder/src/utils/lbrnParser';

const FIXTURE = fs.readFileSync(
  path.join(__dirname, '../fixtures/test_svg_import.lbrn2'), 'utf8'
);

describe('parseLbrn (sample file)', () => {
  it('imports the editable "Bobbie" text when Arial is available', () => {
    const { layers } = parseLbrn(FIXTURE, { availableFonts: ['Arial'] });
    const text = layers.find((l) => l.type === 'text');
    expect(text).toBeTruthy();
    expect(text.text).toBe('Bobbie');
    expect(text.fontFamily).toBe('Arial');
    expect(text.fontSize).toBeGreaterThan(0);
    expect(Number.isFinite(text.left)).toBe(true);
    expect(Number.isFinite(text.top)).toBe(true);
  });

  it('imports the two paths as inline svg layers with markup', () => {
    const { layers } = parseLbrn(FIXTURE, { availableFonts: ['Arial'] });
    const svgs = layers.filter((l) => l.type === 'svg');
    expect(svgs.length).toBe(2);
    svgs.forEach((s) => {
      expect(s.svg_markup).toMatch(/<svg[\s\S]*<path[\s\S]*<\/svg>/);
      expect(s.svg_markup).toMatch(/stroke="#/);
    });
  });

  it('reports a positive physical width and origin-normalised layers', () => {
    const { widthMm, heightMm, layers } = parseLbrn(FIXTURE, { availableFonts: ['Arial'] });
    expect(widthMm).toBeGreaterThan(0);
    expect(heightMm).toBeGreaterThan(0);
    layers.forEach((l) => { expect(l.left).toBeGreaterThanOrEqual(0); expect(l.top).toBeGreaterThanOrEqual(0); });
  });

  it('falls back to an outline svg layer + warning when the font is unavailable', () => {
    const { layers, warnings } = parseLbrn(FIXTURE, { availableFonts: [] });
    expect(layers.some((l) => l.type === 'text')).toBe(false);
    expect(layers.filter((l) => l.type === 'svg').length).toBe(3); // 2 paths + text outline
    expect(warnings.join(' ')).toMatch(/Arial/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/js/utils/lbrnParser.test.js -t "parseLbrn"`
Expected: FAIL — `parseLbrn is not a function`.

- [ ] **Step 4: Write the implementation**

```js
// append to admin/js/template-builder/src/utils/lbrnParser.js

/** Parse an `<XForm>` text node "a b c d e f" → 6-number affine (identity default). */
function parseXform(text) {
  const p = String(text || '').trim().split(/\s+/).map(Number);
  return p.length === 6 && p.every(Number.isFinite) ? p : [1, 0, 0, 1, 0, 0];
}

/** Apply an affine [a,b,c,d,e,f] to a point → [x,y]. */
function applyXform(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Read a shape's VertList/PrimList text (empty strings if absent). */
function readVertPrim(shapeEl) {
  const v = shapeEl.querySelector('VertList');
  const p = shapeEl.querySelector('PrimList');
  return { vert: (v && v.textContent) || '', prim: (p && p.textContent) || '' };
}

/** Flatten shapes, descending into groups. */
function collectShapes(root) {
  const out = [];
  root.querySelectorAll('Shape').forEach((el) => {
    if (el.getAttribute('Type') === 'Group') return; // its child <Shape>s are matched separately
    out.push(el);
  });
  return out;
}

/**
 * Parse a LightBurn project into store-ready layer descriptors.
 * Coordinates: shape XForm (mm) → union bbox → Y-flip → ×PX_PER_MM.
 * Paths become inline `svg` layers; text becomes a `text` layer (or an outline
 * `svg` layer when its font is unavailable).
 */
export function parseLbrn(xmlString, opts = {}) {
  const available = new Set((opts.availableFonts || []).map(String));
  const warnings = [];
  const doc = new DOMParser().parseFromString(xmlString, 'application/xml');
  if (doc.querySelector('parsererror') || !doc.querySelector('LightBurnProject')) {
    throw new Error('Not a valid LightBurn (.lbrn2) file');
  }

  // 1) Collect raw shapes with machine-space geometry.
  const paths = []; // { d(local), xform, cutIndex, pts:[[mx,my]...] }
  const texts = []; // { text, family, fontSize, xform, cutIndex, originMx, originMy }

  const pushPath = (vert, prim, xform, cutIndex) => {
    const localD = vertPrimToPathData(vert, prim);
    if (!localD) return false;
    // machine-space points (for bbox + later per-shape transform)
    const mpts = parseVertList(vert).map((v) => applyXform(xform, v.x, v.y));
    paths.push({ vert, prim, xform, cutIndex, mpts });
    return true;
  };

  collectShapes(doc).forEach((el) => {
    const type = el.getAttribute('Type');
    const cutIndex = parseInt(el.getAttribute('CutIndex') || '0', 10);
    const xform = parseXform((el.querySelector('XForm') || {}).textContent);

    if (type === 'Path' || type === 'Rect' || type === 'Ellipse') {
      const { vert, prim } = readVertPrim(el);
      if (!pushPath(vert, prim, xform, cutIndex)) warnings.push('Skipped an unreadable shape.');
    } else if (type === 'Text') {
      const str = el.getAttribute('Str') || '';
      const { family } = qtFontToFamily(el.getAttribute('Font'));
      const heightMm = parseFloat(el.getAttribute('H') || '0') || 0;
      if (str && available.has(family)) {
        const [ox, oy] = applyXform(xform, 0, 0);
        texts.push({ text: str, family, fontSize: heightMm * PX_PER_MM, cutIndex, originMx: ox, originMy: oy });
      } else {
        const { vert, prim } = readVertPrim(el);
        if (pushPath(vert, prim, xform, cutIndex)) {
          if (str) warnings.push(`Font "${family}" is not available; imported "${str}" as an outline.`);
        } else if (str) {
          warnings.push(`Font "${family}" is not available and "${str}" has no outline; skipped.`);
        }
      }
    } else if (type === 'Bitmap') {
      warnings.push('Skipped a bitmap image (not supported).');
    } else if (type && type !== 'Group') {
      warnings.push(`Skipped unsupported shape type "${type}".`);
    }
  });

  // 2) Union machine-space bbox across all geometry + text origins.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const acc = (x, y) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
  paths.forEach((p) => p.mpts.forEach(([x, y]) => acc(x, y)));
  texts.forEach((t) => acc(t.originMx, t.originMy));
  if (!Number.isFinite(minX)) { return { layers: [], widthMm: 0, heightMm: 0, warnings }; }

  const widthMm = maxX - minX;
  const heightMm = maxY - minY;
  const layers = [];

  // 3) Path → inline svg layer. Bake a shape-local, Y-flipped px path; position
  //    the layer at the shape's design-canvas top-left (also Y-flipped).
  paths.forEach((p) => {
    let sMinX = Infinity, sMinY = Infinity, sMaxX = -Infinity, sMaxY = -Infinity;
    p.mpts.forEach(([x, y]) => { if (x < sMinX) sMinX = x; if (y < sMinY) sMinY = y; if (x > sMaxX) sMaxX = x; if (y > sMaxY) sMaxY = y; });
    const wPx = Math.max(1, (sMaxX - sMinX) * PX_PER_MM);
    const hPx = Math.max(1, (sMaxY - sMinY) * PX_PER_MM);
    // per-vertex transform: machine → shape-local px, Y flipped
    const toLocalPx = (lx, ly) => {
      const [mx, my] = applyXform(p.xform, lx, ly);
      return [(mx - sMinX) * PX_PER_MM, (sMaxY - my) * PX_PER_MM];
    };
    const d = vertPrimToPathData(p.vert, p.prim, toLocalPx);
    const color = layerColor(p.cutIndex);
    const svg_markup =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${n(wPx)}" height="${n(hPx)}" `
      + `viewBox="0 0 ${n(wPx)} ${n(hPx)}">`
      + `<path d="${d}" fill="none" stroke="${color}" stroke-width="1"/></svg>`;
    layers.push({
      type: 'svg',
      svg_markup,
      left: n((sMinX - minX) * PX_PER_MM),
      top: n((maxY - sMaxY) * PX_PER_MM),
      scaleX: 1,
      scaleY: 1,
    });
  });

  // 4) Text → text layer (fill = cut-layer colour; positioned by its origin).
  texts.forEach((t) => {
    layers.push({
      type: 'text',
      text: t.text,
      fontFamily: t.family,
      fontSize: n(t.fontSize),
      fill: layerColor(t.cutIndex),
      textAlign: 'left',
      left: n((t.originMx - minX) * PX_PER_MM),
      top: n((maxY - t.originMy) * PX_PER_MM),
    });
  });

  return { layers, widthMm: n(widthMm), heightMm: n(heightMm), warnings };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/js/utils/lbrnParser.test.js`
Expected: PASS (all describe blocks).

- [ ] **Step 6: Commit**

```bash
git add admin/js/template-builder/src/utils/lbrnParser.js tests/js/utils/lbrnParser.test.js tests/js/fixtures/test_svg_import.lbrn2
git commit -m "feat(lbrn): parse .lbrn2 into text + inline-svg layer descriptors"
```

---

## Task 4: Render inline `svg_markup` layers in the builder

**Files:**
- Modify: `admin/js/template-builder/src/components/Canvas.jsx` (the `else if (layer.type === 'svg')` branch, around line 589–650)

**Interfaces:**
- Consumes: layer descriptors with `svg_markup` (Task 3).
- Produces: builder canvas renders inline-vector layers (no behaviour change for URL-based `svg` layers).

- [ ] **Step 1: Read the current svg branch**

Run: `sed -n '589,651p' admin/js/template-builder/src/components/Canvas.jsx`
Expected: the `else if (layer.type === 'svg')` block that fetches `layer.src`.

- [ ] **Step 2: Add an inline-markup path before the `layer.src` fetch**

Replace the branch's `else if (layer.src && !pendingLoads.current.has(layer._key)) {` opening so an inline `svg_markup` is handled first. Insert this block immediately after the `if (existing) { … }` sub-block and before the existing `else if (layer.src …)`:

```jsx
        } else if (layer.svg_markup && !pendingLoads.current.has(layer._key)) {
          pendingLoads.current.add(layer._key);
          loadSVGFromString(layer.svg_markup)
            .then(({ objects, options }) => {
              pendingLoads.current.delete(layer._key);
              if (!fabricRef.current) return;
              const filtered = objects.filter(Boolean);
              filtered.forEach((o) => o.set({ strokeUniform: true }));
              const group = util.groupSVGElements(filtered, options);
              group.set({
                left:           layer.left   || 100,
                top:            layer.top    || 100,
                scaleX:         layer.scaleX || 1,
                scaleY:         layer.scaleY || 1,
                angle:          layer.angle  || 0,
                selectable:     !layer.locked,
                evented:        !layer.locked,
                strokeUniform:  true,
                subTargetCheck: false,
                interactive:    false,
                data:           layerData(layer),
              });
              canvas.add(group);
              group.setCoords();
              applyPermissions(group, layer.type);
              applyClipAndClamp(group, layer);
              canvas.renderAll();
            })
            .catch((err) => {
              pendingLoads.current.delete(layer._key);
              console.warn('[PF] inline SVG layer load failed:', err);
            });
        } else if (layer.src && !pendingLoads.current.has(layer._key)) {
```

(`loadSVGFromString` and `util` are already imported in this file.)

- [ ] **Step 3: Build the admin bundle**

Run: `npm run build 2>&1 | grep -E "admin-template-builder|error"`
Expected: builds without error; `dist/admin-template-builder.js` emitted.

- [ ] **Step 4: Manual verification (deferred to Task 7)**

Inline-vector rendering is exercised end-to-end by the import in Task 7. No standalone UI yet, so verification happens there. Confirm only that the build succeeds.

- [ ] **Step 5: Commit**

```bash
git add admin/js/template-builder/src/components/Canvas.jsx dist/admin-template-builder.js
git commit -m "feat(lbrn): render inline svg_markup layers in the builder canvas"
```

---

## Task 5: Render `svg` layers in the frontend designer

**Files:**
- Modify: `frontend/js/designer/src/components/DesignerCanvas.jsx` (the `(zone.layers || []).forEach((layer) => { … })` loop, around line 433)

**Interfaces:**
- Consumes: template `svg` layers (`svg_markup` or `src`).
- Produces: the customer-facing designer instantiates inline-vector layers as canvas objects (previously only `text` layers were instantiated).

- [ ] **Step 1: Read the current layer loop**

Run: `sed -n '430,460p' frontend/js/designer/src/components/DesignerCanvas.jsx`
Expected: `(zone.layers || []).forEach((layer) => { if (layer.type === 'text' && layer.text) { … } })`.

- [ ] **Step 2: Add an `svg` branch inside the layer loop**

After the existing `if (layer.type === 'text' && layer.text) { … }` block (still inside the `forEach`), add:

```jsx
        if (layer.type === 'svg' && (layer.svg_markup || layer.src)) {
          const markupPromise = layer.svg_markup
            ? Promise.resolve(layer.svg_markup)
            : fetch(layer.src).then((r) => r.text());
          markupPromise
            .then((svgString) => loadSVGFromString(svgString))
            .then(({ objects, options }) => {
              if (!fabricCanvasRef || !fabricCanvasRef.current) return;
              const filtered = (objects || []).filter(Boolean);
              if (!filtered.length) return;
              filtered.forEach((o) => o.set({ strokeUniform: true }));
              const group = util.groupSVGElements(filtered, options);
              group.set({
                left:        layer.left   || 0,
                top:         layer.top    || 0,
                scaleX:      layer.scaleX || 1,
                scaleY:      layer.scaleY || 1,
                angle:       layer.angle  || 0,
                strokeUniform: true,
                data:        { elementType: 'svg', fromTemplate: true },
              });
              const perms = permissions.svg || {};
              const locked = perms.locked || !perms.movable;
              group.set({ selectable: !locked, evented: !locked });
              fabricCanvasRef.current.add(group);
              group.setCoords();
              fabricCanvasRef.current.renderAll();
            })
            .catch((err) => console.warn('[PF] template svg layer load failed:', err));
        }
```

Adjust the fabric-canvas ref name (`fabricCanvasRef`) and `permissions` accessor to match the surrounding code in this file if they differ — read the neighbouring `text` branch for the exact identifiers used there.

- [ ] **Step 3: Confirm imports**

Run: `grep -n "loadSVGFromString\|util" frontend/js/designer/src/components/DesignerCanvas.jsx | head -2`
Expected: both are imported from `fabric` (line 3). If `util` is missing, add it to the import.

- [ ] **Step 4: Build the frontend bundle**

Run: `npm run build 2>&1 | grep -E "frontend-designer|error"`
Expected: builds without error.

- [ ] **Step 5: Manual verification (deferred to Task 7)**

Verified end-to-end after import + save in Task 7 (open the product page and confirm the vector layers render). Confirm only that the build succeeds here.

- [ ] **Step 6: Commit**

```bash
git add frontend/js/designer/src/components/DesignerCanvas.jsx dist/frontend-designer.js dist/frontend-designer.css
git commit -m "feat(lbrn): render template svg layers (inline + url) in the frontend designer"
```

---

## Task 6: Sanitise `svg_markup` on the server

**Files:**
- Modify: `includes/API/class-rest-templates.php` (view create/update handlers `create_view` ~line 232, `update_view` ~line 243)

**Interfaces:**
- Consumes: incoming `zones_config[].layers[]` with `svg_markup`.
- Produces: stored `svg_markup` is always sanitised (script/handler/external-ref-free).

- [ ] **Step 1: Read the view write handlers**

Run: `sed -n '222,260p' includes/API/class-rest-templates.php`
Expected: `create_view` / `update_view` that pass the request's `zones_config` to the repository.

- [ ] **Step 2: Add a sanitiser helper**

Add this private method to the `RestTemplates` class (namespace already imports nothing extra; reference the sanitizer fully-qualified):

```php
    /**
     * Sanitise inline SVG markup on every layer of a zones_config array.
     * svg_markup is admin-authored but served to all customers, so it must be
     * stripped of scripts/handlers/external refs before storage.
     *
     * @param array $zones
     * @return array
     */
    private function sanitize_zone_layers(array $zones): array {
        if (!class_exists(\enshrined\svgSanitize\Sanitizer::class)) {
            // No sanitiser available — drop markup rather than store it raw.
            foreach ($zones as &$zone) {
                foreach (($zone['layers'] ?? []) as &$layer) {
                    if (isset($layer['svg_markup'])) {
                        unset($layer['svg_markup']);
                    }
                }
            }
            return $zones;
        }
        $sanitizer = new \enshrined\svgSanitize\Sanitizer();
        foreach ($zones as &$zone) {
            if (empty($zone['layers']) || !is_array($zone['layers'])) {
                continue;
            }
            foreach ($zone['layers'] as &$layer) {
                if (!empty($layer['svg_markup']) && is_string($layer['svg_markup'])) {
                    $clean = $sanitizer->sanitize($layer['svg_markup']);
                    $layer['svg_markup'] = is_string($clean) ? $clean : '';
                }
            }
            unset($layer);
        }
        unset($zone);
        return $zones;
    }
```

- [ ] **Step 3: Call the helper before persisting zones**

In both `create_view` and `update_view`, where the request's `zones_config` is read and passed to the repository, wrap it:

```php
        $zones = $request['zones_config'] ?? [];
        if (is_array($zones)) {
            $zones = $this->sanitize_zone_layers($zones);
        }
        // …pass $zones instead of the raw request value into the repository call…
```

Read the surrounding code and substitute `$zones` into the existing `TemplateRepository::create_view(...)` / `update_view(...)` argument that currently uses `$request['zones_config']`.

- [ ] **Step 4: Verify sanitisation on dev**

Run:
```bash
docker compose exec -T wordpress wp eval '
$s = new \enshrined\svgSanitize\Sanitizer();
echo $s->sanitize("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script><path d=\"M0 0L10 0\" stroke=\"#000\"/></svg>");
' --allow-root
```
Expected: output contains the `<path …>` but NOT `<script>`.

- [ ] **Step 5: Commit**

```bash
git add includes/API/class-rest-templates.php
git commit -m "security(lbrn): sanitise inline svg_markup on template view save"
```

---

## Task 7: Pro-gated "Import LightBurn" button

**Files:**
- Create: `admin/js/template-builder/src/components/ImportLightBurn.jsx`
- Modify: `admin/js/template-builder/src/components/ViewTabs.jsx` (mount the button)

**Interfaces:**
- Consumes: `parseLbrn` (Task 3); store actions `addLayer`, `addZone`, `updateView`; `AVAILABLE_FONTS` from `utils/fonts.js`; `isPremium` flag.
- Produces: a UI that imports a `.lbrn2` into the current view.

- [ ] **Step 1: Create the component**

```jsx
// admin/js/template-builder/src/components/ImportLightBurn.jsx
import React, { useRef, useState } from 'react';
import { __ } from '@wordpress/i18n';
import useTemplateStore from '../store/useTemplateStore';
import { parseLbrn } from '../utils/lbrnParser';
import { AVAILABLE_FONTS } from '../utils/fonts';

const isPremium = window.sgpdTemplateBuilder?.isPremium;

export default function ImportLightBurn() {
  const inputRef = useRef(null);
  const [status, setStatus] = useState('');
  const { views, currentViewIndex, addZone, addLayer, updateView } = useTemplateStore();

  if (!isPremium) {
    return (
      <span style={{ fontSize: 12, opacity: 0.7 }}>
        {__('Import LightBurn (Pro)', 'snelgraveren-product-designer')}
      </span>
    );
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus(__('Importing…', 'snelgraveren-product-designer'));
    try {
      const xml = await file.text();
      const { layers, widthMm, warnings } = parseLbrn(xml, {
        availableFonts: AVAILABLE_FONTS.map((f) => f.family),
      });
      if (!layers.length) {
        setStatus(__('No importable shapes found.', 'snelgraveren-product-designer'));
        return;
      }
      // Ensure a target zone exists (zone 0). Create a full-canvas zone if none.
      const view = views[currentViewIndex];
      let zoneIndex = 0;
      if (!view.zones_config || view.zones_config.length === 0) {
        addZone(currentViewIndex, {
          name: __('Imported', 'snelgraveren-product-designer'),
          x: 0, y: 0,
          width: view.canvas_width || 800,
          height: view.canvas_height || 600,
          allowed_types: ['text', 'image', 'svg'],
        });
      }
      layers.forEach((layer) => addLayer(currentViewIndex, zoneIndex, layer));
      if (widthMm > 0) updateView(currentViewIndex, { width_mm: widthMm });
      const msg = warnings.length
        ? __('Imported with warnings: ', 'snelgraveren-product-designer') + warnings.join(' ')
        : __('Imported successfully.', 'snelgraveren-product-designer');
      setStatus(msg);
    } catch (err) {
      setStatus(__('Import failed: ', 'snelgraveren-product-designer') + err.message);
    } finally {
      e.target.value = '';
    }
  };

  return (
    <span>
      <button type="button" className="button" onClick={() => inputRef.current?.click()}>
        {__('Import LightBurn', 'snelgraveren-product-designer')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".lbrn2,.lbrn"
        style={{ display: 'none' }}
        onChange={onFile}
      />
      {status && <span style={{ marginLeft: 8, fontSize: 12 }}>{status}</span>}
    </span>
  );
}
```

- [ ] **Step 2: Mount the button in ViewTabs**

Read `admin/js/template-builder/src/components/ViewTabs.jsx`, import the component at the top:

```jsx
import ImportLightBurn from './ImportLightBurn';
```

and render `<ImportLightBurn />` next to the existing view controls (near the "Real width (mm)" input / add-view button). Place it inside the same toolbar container so it sits with the other per-view actions.

- [ ] **Step 3: Build**

Run: `npm run build 2>&1 | grep -E "admin-template-builder|error"`
Expected: builds without error.

- [ ] **Step 4: Manual end-to-end test on dev**

1. `docker compose up -d` (if not running). Ensure premium is on (dev license constant).
2. Open the Template Builder for a template (`http://localhost:8080/wp-admin/admin.php?page=sgpd-template-builder`).
3. Click **Import LightBurn**, choose `test_svg_import.lbrn2`.
4. Expect: "Bobbie" text + the bone outline + engraved lines appear on the canvas at correct relative positions and physical scale; each path is a separate, selectable layer in the tree; the text is editable; "Real width (mm)" is populated.
5. Save the template. Reload the builder → the imported layers persist.
6. Assign the template to a product, open the product page in the frontend designer → the vector layers render and the text is editable.
7. Export SVG → the design comes out at true physical size with the cut-layer stroke colours preserved.

- [ ] **Step 5: Commit**

```bash
git add admin/js/template-builder/src/components/ImportLightBurn.jsx admin/js/template-builder/src/components/ViewTabs.jsx dist/admin-template-builder.js
git commit -m "feat(lbrn): Pro-gated Import LightBurn button in the Template Builder"
```

---

## Self-Review

**Spec coverage:** Parser/geometry (Tasks 1–3) ✓; editable text with backup-path fallback (Task 3) ✓; cut-layer colour + stroke-only paths (Tasks 2–3) ✓; inline-vector layer type across builder/frontend/server (Tasks 4–6) ✓; Pro gating + one-view-per-import + width_mm (Task 7) ✓; security sanitisation of svg_markup (Task 6) ✓; scope Text/Path/Rect/Ellipse/Group, Bitmap skipped (Task 3) ✓; tests + manual (each task) ✓.

**Type consistency:** `parseLbrn` returns `{ layers, widthMm, heightMm, warnings }` (Task 3) and Task 7 consumes exactly those. Layer descriptors use `type: 'text'|'svg'`, `svg_markup`, `left`, `top` — matching the render branches in Tasks 4–5 and the store `addLayer` shape. `vertPrimToPathData(vertList, primList, transform?)`, `qtFontToFamily`, `layerColor`, `PX_PER_MM` names are consistent across tasks.

**Known follow-ups (out of v1 scope):** exact LightBurn palette verification; text extent in bbox is approximated by its origin point (minor clip risk); Y-flip confirmed by manual test (one-line toggle if mirrored).
