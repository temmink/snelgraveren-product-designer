/** Round to 3 decimals, drop trailing zeros. */
function n(v) {
  return parseFloat(Number(v).toFixed(3));
}

/**
 * Round a unitless scale factor. 6 decimals, not `n`'s 3: a scale multiplies
 * the source pixel count, so 3 decimals on a 1.89x factor over an 800px PNG
 * already costs 0.1mm of physical size — and more on a larger source image.
 */
function nScale(v) {
  return parseFloat(Number(v).toFixed(6));
}

/**
 * Parse a LightBurn VertList: `V{x} {y}` optionally followed by control-handle
 * tokens `c0x{v}` `c0y{v}` `c1x{v}` `c1y{v}`. A missing handle component
 * defaults to the vertex coordinate. c0 = outgoing handle (toward the next
 * point), c1 = incoming handle (from the previous point).
 */
export function parseVertList(vertList) {
  const verts = [];
  const re = /V(-?[\d.]+) (-?[\d.]+)((?:c[01][xy]-?[\d.]+)*)/g;
  let m;
  while ((m = re.exec(vertList)) !== null) {
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    // Controls default to the vertex itself (straight segment).
    const v = { x, y, c0x: x, c0y: y, c1x: x, c1y: y };
    // Collect the raw control tokens for this vertex.
    const raw = { c0x: null, c0y: null, c1x: null, c1y: null };
    const hre = /c([01])([xy])(-?[\d.]+)/g;
    let h;
    while ((h = hre.exec(m[3])) !== null) raw[`c${h[1]}${h[2]}`] = parseFloat(h[3]);
    // A control point is a real off-vertex coordinate only when BOTH its x and
    // y are given (e.g. `c0x36.9c0y19.6`). A lone `c0x1` is LightBurn's marker
    // for "this side is straight" — the control coincides with the vertex, so
    // it is left at the vertex position, NOT set to the literal 1.
    if (raw.c0x !== null && raw.c0y !== null) { v.c0x = raw.c0x; v.c0y = raw.c0y; }
    if (raw.c1x !== null && raw.c1y !== null) { v.c1x = raw.c1x; v.c1y = raw.c1y; }
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
  if (!verts.length) return '';
  const px = (x, y) => { const [a, b] = t(x, y); return `${n(a)} ${n(b)}`; };

  // LightBurn shorthand primitives: "LineClosed" / "Line" mean "connect every
  // vertex in order with straight segments" (closed for LineClosed) instead of
  // listing explicit L/B primitives. Without this those shapes decode to an
  // empty path and get dropped.
  const primKeyword = String(primList || '').trim();
  if (primKeyword === 'LineClosed' || primKeyword === 'Line') {
    let poly = `M${px(verts[0].x, verts[0].y)}`;
    for (let k = 1; k < verts.length; k++) poly += `L${px(verts[k].x, verts[k].y)}`;
    if (primKeyword === 'LineClosed') poly += 'Z';
    return poly;
  }

  const prims = parsePrimList(primList);
  if (!prims.length) return '';
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
        // Cubic: vertex a's OUTGOING handle (c0) and vertex b's INCOMING (c1).
        d += `C${px(a.c0x, a.c0y)} ${px(b.c1x, b.c1y)} ${px(b.x, b.y)}`;
      }
      cursor = p.b;
      i++;
      if (closing) { d += 'Z'; break; }
    }
  }
  return d;
}

/** Interior extrema (0<t<1) of one axis of a cubic bezier p0-p1-p2-p3. */
export function cubicExtrema(p0, p1, p2, p3) {
  const out = [];
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const ts = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) ts.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      ts.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  ts.forEach((t) => {
    if (t > 0 && t < 1) {
      const mt = 1 - t;
      out.push(mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3);
    }
  });
  return out;
}

/** Machine-space bbox points of a vert/prim pair under an affine xform: every
 *  vertex plus the exact extrema of each bezier segment. Vertex hulls miss
 *  curve overshoot; Fabric positions the TRUE geometry bbox at layer.left/top,
 *  so a vertex-only bbox shifts each shape by its own overshoot — cut layers
 *  that coincide in LightBurn land misaligned in the builder. An affine map of
 *  a bezier is the bezier of the mapped controls, so extrema are found
 *  directly in machine space. */
export function vertPrimBoundsPoints(vertList, primList, xform) {
  const verts = parseVertList(vertList);
  const pts = verts.map((v) => applyXform(xform, v.x, v.y));
  const keyword = String(primList || '').trim();
  if (keyword === 'LineClosed' || keyword === 'Line') return pts; // straight only
  parsePrimList(primList).forEach((p) => {
    if (p.cmd !== 'B') return;
    const a = verts[p.a];
    const b = verts[p.b];
    if (!a || !b) return;
    const P0 = applyXform(xform, a.x, a.y);
    const P1 = applyXform(xform, a.c0x, a.c0y);
    const P2 = applyXform(xform, b.c1x, b.c1y);
    const P3 = applyXform(xform, b.x, b.y);
    // Per-axis extrema paired with an endpoint's other coordinate — endpoints
    // are genuine path points, so this never widens the other axis.
    cubicExtrema(P0[0], P1[0], P2[0], P3[0]).forEach((xv) => pts.push([xv, P0[1]]));
    cubicExtrema(P0[1], P1[1], P2[1], P3[1]).forEach((yv) => pts.push([P0[0], yv]));
  });
  return pts;
}

/** Bezier circle-arc constant: control handle length as a fraction of the radius. */
const KAPPA = 0.552285;

/**
 * Synthesise a LightBurn VertList/PrimList pair for a primitive shape that
 * carries NO geometry of its own. LightBurn stores a `Rect` as just
 * `W`/`H`/`Cr` (corner radius) and an `Ellipse` as `Rx`/`Ry`, both centred on
 * the shape's XForm translation (the same convention as Bitmap). Emitting the
 * shape in LightBurn's own vertex format — rather than a path `d` directly —
 * lets the rest of the pipeline (bbox extrema, transform composition, group
 * merge) treat it exactly like a drawn Path. Returns `{ vert: '', prim: '' }`
 * for a degenerate size so the caller reports it as unreadable.
 */
export function rectVertPrim(w, h, cr = 0) {
  if (!(w > 0) || !(h > 0)) return { vert: '', prim: '' };
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.max(0, Math.min(Number(cr) || 0, hw, hh));
  if (r === 0) {
    return {
      vert: `V${n(-hw)} ${n(-hh)}V${n(hw)} ${n(-hh)}V${n(hw)} ${n(hh)}V${n(-hw)} ${n(hh)}`,
      prim: 'L0 1L1 2L2 3L3 0',
    };
  }
  const k = KAPPA * r;
  // Eight vertices: one at each end of every corner arc. `c0` is the OUTGOING
  // handle (used when this vertex starts a bezier), `c1` the INCOMING one.
  const V = (x, y, c0, c1) =>
    `V${n(x)} ${n(y)}` +
    (c0 ? `c0x${n(c0[0])}c0y${n(c0[1])}` : '') +
    (c1 ? `c1x${n(c1[0])}c1y${n(c1[1])}` : '');
  const vert =
    V(-hw + r, -hh, null, [-hw + r - k, -hh]) +
    V(hw - r, -hh, [hw - r + k, -hh], null) +
    V(hw, -hh + r, null, [hw, -hh + r - k]) +
    V(hw, hh - r, [hw, hh - r + k], null) +
    V(hw - r, hh, null, [hw - r + k, hh]) +
    V(-hw + r, hh, [-hw + r - k, hh], null) +
    V(-hw, hh - r, null, [-hw, hh - r + k]) +
    V(-hw, -hh + r, [-hw, -hh + r - k], null);
  return { vert, prim: 'L0 1B1 2L2 3B3 4L4 5B5 6L6 7B7 0' };
}

/** Four-bezier ellipse centred on the origin (see `rectVertPrim`). */
export function ellipseVertPrim(rx, ry) {
  if (!(rx > 0) || !(ry > 0)) return { vert: '', prim: '' };
  const kx = KAPPA * rx;
  const ky = KAPPA * ry;
  const V = (x, y, c0, c1) =>
    `V${n(x)} ${n(y)}c0x${n(c0[0])}c0y${n(c0[1])}c1x${n(c1[0])}c1y${n(c1[1])}`;
  const vert =
    V(rx, 0, [rx, ky], [rx, -ky]) +
    V(0, ry, [-kx, ry], [kx, ry]) +
    V(-rx, 0, [-rx, -ky], [-rx, ky]) +
    V(0, -ry, [kx, -ry], [-kx, -ry]);
  return { vert, prim: 'B0 1B1 2B2 3B3 0' };
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

/**
 * Read a PNG's pixel dimensions from the IHDR header of its base64 payload.
 * Bytes 0-7 are the PNG signature, 16-19 the width and 20-23 the height, all
 * big-endian — so the first 24 decoded bytes are enough and we never decode a
 * multi-megabyte image just to learn how big it is.
 * Returns null for anything that is not a PNG (LightBurn can embed other
 * formats; without dimensions we cannot scale, so those are skipped upstream).
 */
export function decodePngSize(base64) {
  const head = String(base64 || '').slice(0, 48); // 48 base64 chars → 36 bytes
  if (head.length < 32) return null;
  let bin;
  try {
    bin = atob(head);
  } catch (_) {
    return null; // not valid base64
  }
  if (bin.length < 24) return null;
  if (bin.slice(0, 8) !== '\x89PNG\r\n\x1a\n') return null;
  const be32 = (o) => (
    (bin.charCodeAt(o) << 24) | (bin.charCodeAt(o + 1) << 16)
    | (bin.charCodeAt(o + 2) << 8) | bin.charCodeAt(o + 3)
  ) >>> 0;
  const width = be32(16);
  const height = be32(20);
  return width > 0 && height > 0 ? { width, height } : null;
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

const IDENTITY_XFORM = [1, 0, 0, 1, 0, 0];

/** Compose two affines: apply `b` (inner/child) then `a` (outer/parent) → a·b. */
function multiplyXform(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** First direct-child element of `el` with the given tag (`:scope >`, with a
 *  fallback for engines lacking `:scope` in querySelector). */
function directChild(el, tag) {
  let c = el.querySelector(`:scope > ${tag}`);
  if (!c) c = Array.from(el.children).find((x) => x.tagName === tag) || null;
  return c;
}

/** Read a shape's VertList/PrimList text (empty strings if absent). For a Text
 *  shape's outline fallback these intentionally read the nested BackupPath's
 *  VertList/PrimList (that IS the backup outline), so this stays unscoped. */
function readVertPrim(shapeEl) {
  const v = shapeEl.querySelector('VertList');
  const p = shapeEl.querySelector('PrimList');
  return { vert: (v && v.textContent) || '', prim: (p && p.textContent) || '' };
}

/** Read a shape's OWN direct-child `<XForm>` text, ignoring any `<XForm>`
 *  nested deeper (e.g. inside a Text shape's `<BackupPath>`). `querySelector`
 *  alone returns the first match in document order, which for a
 *  `HasBackupPath="1"` Text shape is the BackupPath's XForm, not the shape's
 *  own trailing one — this scoping is what fixes that mis-placement. */
function readOwnXform(shapeEl) {
  let el = shapeEl.querySelector(':scope > XForm');
  if (!el) {
    // Fallback for engines without :scope support in querySelector.
    el = Array.from(shapeEl.children).find((c) => c.tagName === 'XForm') || null;
  }
  return el ? el.textContent : null;
}

/** Build VertID→VertList and PrimID→PrimList text maps. LightBurn stores a
 *  shared VertList/PrimList inline on the first shape that uses it; other
 *  shapes carry only the matching VertID/PrimID and no nested list. This pool
 *  lets those referencing shapes resolve their geometry. */
function buildGeometryPools(root) {
  const vertPool = new Map();
  const primPool = new Map();
  root.querySelectorAll('Shape').forEach((el) => {
    const vid = el.getAttribute('VertID');
    const pid = el.getAttribute('PrimID');
    const v = directChild(el, 'VertList');
    const p = directChild(el, 'PrimList');
    if (vid && v && !vertPool.has(vid)) vertPool.set(vid, v.textContent || '');
    if (pid && p && !primPool.has(pid)) primPool.set(pid, p.textContent || '');
  });
  return { vertPool, primPool };
}

/** Resolve a Path shape's VertList/PrimList: prefer its own nested lists, else
 *  fall back to the shared pool by VertID/PrimID. */
function resolvePathGeom(el, vertPool, primPool) {
  const v = directChild(el, 'VertList');
  const p = directChild(el, 'PrimList');
  const vid = el.getAttribute('VertID');
  const pid = el.getAttribute('PrimID');
  return {
    vert: (v && v.textContent) || (vid && vertPool.get(vid)) || '',
    prim: (p && p.textContent) || (pid && primPool.get(pid)) || '',
  };
}

/** Flatten shapes depth-first, composing each ancestor Group's XForm into its
 *  descendants so grouped geometry lands where LightBurn draws it. Returns leaf
 *  (non-Group) shapes as { el, xform (composed, mm), type, groupKey }.
 *  groupKey identifies the TOP-LEVEL LightBurn group a shape belongs to (nested
 *  groups inherit their outermost ancestor's key); ungrouped shapes get null.
 *  parseLbrn merges all paths sharing a groupKey into one svg layer. */
function collectShapes(root) {
  const out = [];
  let nextGroup = 0;
  const walk = (el, acc, groupKey) => {
    const eff = multiplyXform(acc, parseXform(readOwnXform(el)));
    const type = el.getAttribute('Type');
    if (type === 'Group') {
      const key = groupKey ?? `g${nextGroup++}`;
      // Real files wrap children in <Children>; fall back to direct child
      // <Shape>s if that wrapper is absent.
      const container = directChild(el, 'Children') || el;
      Array.from(container.children).forEach((ch) => {
        if (ch.tagName === 'Shape') walk(ch, eff, key);
      });
      return;
    }
    out.push({ el, xform: eff, type, groupKey: groupKey ?? null });
  };
  Array.from(root.children).forEach((ch) => {
    if (ch.tagName === 'Shape') walk(ch, IDENTITY_XFORM, null);
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
  const paths = []; // { d(local), xform, cutIndex, mpts:[[mx,my]...] }
  const texts = []; // { text, family, fontSize, xform, cutIndex, originMx, originMy }
  const bitmaps = []; // { data, pngW, pngH, localWMm, localHMm, finalWMm, finalHMm, corners, centre, angle }

  const pushPath = (vert, prim, xform, cutIndex, groupKey) => {
    const localD = vertPrimToPathData(vert, prim);
    if (!localD) return false;
    // machine-space bbox points (vertices + exact bezier extrema)
    const mpts = vertPrimBoundsPoints(vert, prim, xform);
    paths.push({ vert, prim, xform, cutIndex, mpts, groupKey: groupKey ?? null });
    return true;
  };

  const root = doc.querySelector('LightBurnProject');
  const { vertPool, primPool } = buildGeometryPools(root);

  collectShapes(root).forEach(({ el, xform, type, groupKey }) => {
    const cutIndex = parseInt(el.getAttribute('CutIndex') || '0', 10);

    if (type === 'Path' || type === 'Rect' || type === 'Ellipse') {
      let { vert, prim } = resolvePathGeom(el, vertPool, primPool);
      // Rect and Ellipse normally carry NO VertList at all — only their size
      // attributes — so synthesise the outline in LightBurn's vertex format.
      // A shape that does ship geometry (older files) keeps its own.
      if (!vert && type === 'Rect') {
        ({ vert, prim } = rectVertPrim(
          parseFloat(el.getAttribute('W') || '0'),
          parseFloat(el.getAttribute('H') || '0'),
          parseFloat(el.getAttribute('Cr') || '0')
        ));
      } else if (!vert && type === 'Ellipse') {
        ({ vert, prim } = ellipseVertPrim(
          parseFloat(el.getAttribute('Rx') || '0'),
          parseFloat(el.getAttribute('Ry') || '0')
        ));
      }
      if (!pushPath(vert, prim, xform, cutIndex, groupKey)) warnings.push('Skipped an unreadable shape.');
    } else if (type === 'Text') {
      const str = el.getAttribute('Str') || '';
      const { family } = qtFontToFamily(el.getAttribute('Font'));
      const heightMm = parseFloat(el.getAttribute('H') || '0') || 0;
      if (str && available.has(family)) {
        const [ox, oy] = applyXform(xform, 0, 0);
        texts.push({ text: str, family, fontSize: heightMm * PX_PER_MM, cutIndex, originMx: ox, originMy: oy });
      } else {
        const { vert, prim } = readVertPrim(el);
        if (pushPath(vert, prim, xform, cutIndex, groupKey)) {
          if (str) warnings.push(`Font "${family}" is not available; imported "${str}" as an outline.`);
        } else if (str) {
          warnings.push(`Font "${family}" is not available and "${str}" has no outline; skipped.`);
        }
      }
    } else if (type === 'Bitmap') {
      const data = el.getAttribute('Data') || '';
      // W/H are the shape-LOCAL size in mm; the XForm scales them (see below).
      const localWMm = parseFloat(el.getAttribute('W') || '0') || 0;
      const localHMm = parseFloat(el.getAttribute('H') || '0') || 0;
      const size = data ? decodePngSize(data) : null;
      if (!data || localWMm <= 0 || localHMm <= 0) {
        warnings.push('Skipped a bitmap image with no usable size.');
      } else if (!size) {
        warnings.push('Skipped a bitmap image: only PNG images are supported.');
      } else {
        // W/H are the LOCAL (unscaled) millimetre size; the XForm carries the
        // real one — its scale factors AND, in its translation, the image
        // CENTRE. So the final size is W/H MULTIPLIED by the XForm scale
        // (LightBurn's own size readout), never divided by it. The local box is
        // simply W/2 x H/2 around the origin; mapping its corners through the
        // matrix applies the scale (and any rotation) so a scaled or rotated
        // bitmap contributes its true extent to the union bbox.
        // `Math.hypot` recovers each axis' scale magnitude even when rotated.
        const sx = Math.hypot(xform[0], xform[1]) || 1;
        const sy = Math.hypot(xform[2], xform[3]) || 1;
        const halfW = localWMm / 2;
        const halfH = localHMm / 2;
        const corners = [[-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]]
          .map(([lx, ly]) => applyXform(xform, lx, ly));
        bitmaps.push({
          data,
          pngW: size.width,
          pngH: size.height,
          localWMm,
          localHMm,
          finalWMm: localWMm * sx,
          finalHMm: localHMm * sy,
          corners,
          centre: applyXform(xform, 0, 0),
          angle: Math.atan2(xform[1], xform[0]) * 180 / Math.PI,
        });
      }
    } else if (type && type !== 'Group') {
      warnings.push(`Skipped unsupported shape type "${type}".`);
    }
  });

  // 2) Union machine-space bbox across all geometry + text origins.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const acc = (x, y) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
  paths.forEach((p) => p.mpts.forEach(([x, y]) => acc(x, y)));
  texts.forEach((t) => acc(t.originMx, t.originMy));
  bitmaps.forEach((b) => b.corners.forEach(([x, y]) => acc(x, y)));
  if (!Number.isFinite(minX)) { return { layers: [], widthMm: 0, heightMm: 0, warnings }; }

  const widthMm = maxX - minX;
  const heightMm = maxY - minY;
  const layers = [];

  // Bitmaps first so they sit at the bottom of the layer list. Anchored on
  // their centre (originX/originY) rather than a bbox corner: Fabric rotates
  // around the origin, so a centre anchor keeps a rotated bitmap exact without
  // any bounding-box correction.
  bitmaps.forEach((b) => {
    layers.push({
      type: 'image',
      dataUrl: `data:image/png;base64,${b.data}`,
      pngWidth: b.pngW,
      pngHeight: b.pngH,
      originX: 'center',
      originY: 'center',
      left: n((b.centre[0] - minX) * PX_PER_MM),
      top:  n((b.centre[1] - minY) * PX_PER_MM),
      scaleX: nScale((b.finalWMm * PX_PER_MM) / b.pngW),
      scaleY: nScale((b.finalHMm * PX_PER_MM) / b.pngH),
      angle: n(b.angle),
    });
  });

  // 3) Path → inline svg layer. Bake a shape-local px path; position the layer
  //    at the shape's design-canvas top-left. LightBurn stores Y downward for
  //    this device orientation (MirrorY), so machine Y maps directly to canvas
  //    Y (no flip) — the ring hole at low machine-Y lands at the canvas top.
  //    All paths of one LightBurn group merge into a single multi-path layer
  //    (relative positions baked into the path data, per-cut colours kept);
  //    ungrouped paths stay individual layers. Buckets preserve document order.
  const buckets = [];
  const byGroup = new Map();
  paths.forEach((p) => {
    if (p.groupKey == null) { buckets.push([p]); return; }
    let arr = byGroup.get(p.groupKey);
    if (!arr) { arr = []; byGroup.set(p.groupKey, arr); buckets.push(arr); }
    arr.push(p);
  });
  buckets.forEach((members) => {
    let sMinX = Infinity, sMinY = Infinity, sMaxX = -Infinity, sMaxY = -Infinity;
    members.forEach((p) => p.mpts.forEach(([x, y]) => { if (x < sMinX) sMinX = x; if (y < sMinY) sMinY = y; if (x > sMaxX) sMaxX = x; if (y > sMaxY) sMaxY = y; }));
    const wPx = Math.max(1, (sMaxX - sMinX) * PX_PER_MM);
    const hPx = Math.max(1, (sMaxY - sMinY) * PX_PER_MM);
    const pathTags = members.map((p) => {
      // per-vertex transform: machine → bucket-local px (Y direct, no flip)
      const toLocalPx = (lx, ly) => {
        const [mx, my] = applyXform(p.xform, lx, ly);
        return [(mx - sMinX) * PX_PER_MM, (my - sMinY) * PX_PER_MM];
      };
      const d = vertPrimToPathData(p.vert, p.prim, toLocalPx);
      return `<path d="${d}" fill="none" stroke="${layerColor(p.cutIndex)}" stroke-width="1"/>`;
    }).join('');
    const svg_markup =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${n(wPx)}" height="${n(hPx)}" `
      + `viewBox="0 0 ${n(wPx)} ${n(hPx)}">${pathTags}</svg>`;
    layers.push({
      type: 'svg',
      svg_markup,
      pathCount: members.length, // >1 = merged LightBurn group (used for layer naming)
      left: n((sMinX - minX) * PX_PER_MM),
      top: n((sMinY - minY) * PX_PER_MM),
      scaleX: 1,
      scaleY: 1,
    });
  });

  // 4) Text → text layer (fill = cut-layer colour). LightBurn anchors the text
  //    vertically at its XForm origin (Av); position the text box so its middle
  //    sits on that origin (no Y-flip), which centres it in the surrounding art
  //    the way LightBurn shows it. Horizontal origin is the left edge (Ah=0).
  texts.forEach((t) => {
    layers.push({
      type: 'text',
      text: t.text,
      fontFamily: t.family,
      fontSize: n(t.fontSize),
      fill: layerColor(t.cutIndex),
      textAlign: 'left',
      left: n((t.originMx - minX) * PX_PER_MM),
      top: n((t.originMy - minY) * PX_PER_MM - t.fontSize / 2),
    });
  });

  return { layers, widthMm: n(widthMm), heightMm: n(heightMm), warnings };
}
