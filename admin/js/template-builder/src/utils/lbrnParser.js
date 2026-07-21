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
