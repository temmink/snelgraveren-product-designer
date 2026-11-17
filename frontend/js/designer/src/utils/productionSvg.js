/**
 * Production SVG post-processing for the design exports.
 *
 * Everything in here exists because a laser operator opens the exported SVG in
 * LightBurn, not in a browser. Measured on LightBurn 1.x with a real order
 * (2026-08-27), importing the same curved text four ways:
 *
 *   tspans with per-char x/y/rotate  → letters land on LightBurn's OWN advances,
 *                                       so the word comes out as "Lekkere ha pjes"
 *   same without style attributes    → identical failure
 *   <textPath> over the curve        → correct
 *   vector <path> outlines           → correct
 *
 * Fabric emits the first form (`Text.toSVG`, index.mjs:18791) whenever a text
 * has a path or a non-zero charSpacing, which covers every curved text in the
 * shop. So a Fabric SVG is, as-is, unusable for engraving — hence outlining for
 * the plain SVG export and textPath for the font-carrying one.
 */

/** Namespace every helper here works in. */
export const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Fabric 6.9.1 builds a tspan as `${dySpan}${angleAttr}${fillStyles}` where
 * angleAttr is ` rotate="…"` (no trailing space) and fillStyles is `style="…"`
 * (no leading space). A char that is BOTH rotated and styled — a space inside
 * curved text gets `style="white-space: pre"` — therefore emits
 * `rotate="12"style="…"`, which is not well-formed XML.
 *
 * The whole export then fails silently: DOMParser refuses it, so the outline and
 * embed passes both bail out to the raw markup, and the server's
 * `sanitize_export_blob()` drops it because svg-sanitize cannot load it. The
 * design keeps saving, only without vector data, and the SVG export quietly
 * falls back to wrapping the raster PNG.
 *
 * Text content cannot produce a false positive: Fabric escapes `"` to `&quot;`
 * inside tspans, so a literal `"style="` only ever occurs between attributes.
 */
export function repairFabricSvgMarkup(markup) {
  if (typeof markup !== 'string' || markup === '') return markup;
  return markup.replace(/"style="/g, '" style="');
}

/**
 * Parse SVG markup, throwing a readable error instead of returning something
 * unusable. Callers must not swallow this: a design that cannot produce valid
 * vector output has to be visible, not silently downgraded to raster.
 *
 * @returns {Document}
 */
export function parseSvgOrThrow(markup) {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) {
    const detail = (err.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new Error(`Export SVG is not well-formed: ${detail}`);
  }
  return doc;
}

/**
 * Remove clipPath definitions and the attributes referencing them.
 *
 * A zone clips its contents on the canvas, and Fabric faithfully exports that
 * as a <clipPath> per clipped object. LightBurn ignores clipPath entirely and
 * draws the clip shape as a normal outline, so a design with five clipped
 * elements arrives as five stacked plank silhouettes on top of the artwork.
 *
 * @returns {number} how many clip references were dropped
 */
export function stripClipPaths(doc) {
  let dropped = 0;
  Array.from(doc.querySelectorAll('clipPath')).forEach((el) => {
    el.parentNode?.removeChild(el);
  });
  Array.from(doc.querySelectorAll('[clip-path]')).forEach((el) => {
    el.removeAttribute('clip-path');
    dropped += 1;
  });
  return dropped;
}

/**
 * Remove the baseline curves of curved text, matched on their exact path data.
 *
 * Fabric appends a text's `path` to the SVG as a normal, visible <path>. On the
 * canvas that curve is invisible scaffolding; in an engraving file it is a line
 * that gets burnt straight through the lettering.
 *
 * Matching on `d` rather than on position in the tree because Fabric emits the
 * curve as a sibling right after the text, and "the element after the text" is
 * a guess — the path data is what the two actually share.
 *
 * @param {Document} doc
 * @param {Set<string>} pathData `d` strings collected from the Fabric objects
 * @returns {number} how many baseline curves were removed
 */
export function stripBaselinePaths(doc, pathData) {
  if (!pathData || pathData.size === 0) return 0;
  let removed = 0;
  Array.from(doc.querySelectorAll('path')).forEach((el) => {
    if (!pathData.has(el.getAttribute('d'))) return;
    const parent = el.parentNode;
    parent?.removeChild(el);
    removed += 1;
    // Fabric wraps it in a <g> that carries the transform; an empty leftover
    // group is harmless but noisy in an operator's layer list.
    if (parent && parent.nodeName === 'g' && parent.childNodes.length === 0) {
      parent.parentNode?.removeChild(parent);
    }
  });
  return removed;
}

/**
 * Give the export its real-world size, in millimetres, with one user unit = 1 mm.
 *
 * Fabric writes the canvas in pixels (`width="600" viewBox="0 0 600 245"`). A
 * consumer then has to guess a resolution: LightBurn assumes 96 dpi, so a
 * 600 px design lands as 158.75 mm instead of 457.81 mm. The server used to
 * paper over this by stamping `width="457.81mm"` onto the root afterwards, which
 * is correct but leaves the units mismatched (0.763 mm per unit) and only
 * happens if that export path runs — the stored vector itself stayed unitless.
 *
 * Scaling the content instead makes the geometry itself millimetres: the numbers
 * in the file ARE the numbers on the machine bed, which is exactly the form
 * LightBurn writes its own files in. Nothing downstream has to convert, so
 * nothing downstream can convert wrongly.
 *
 * Height follows from the canvas aspect ratio, the same way
 * `Export\PremiumExports` computes it (height_mm = width_mm × h_px / w_px), so
 * both paths agree on the size.
 *
 * @param {Document} doc
 * @param {{widthMm:number, pxWidth:number, pxHeight:number}} size
 * @returns {boolean} whether a physical size was applied
 */
export function applyPhysicalSize(doc, { widthMm, pxWidth, pxHeight }) {
  const mm = Number(widthMm);
  const w = Number(pxWidth);
  const h = Number(pxHeight);
  // No physical width configured on the view — leave the pixel canvas alone
  // rather than invent a scale.
  if (!(mm > 0) || !(w > 0) || !(h > 0)) return false;

  const root = doc.documentElement;
  root.setAttribute('width', `${round(mm, 3)}mm`);
  root.setAttribute('height', `${round(h * (mm / w), 3)}mm`);
  // The viewBox stays in canvas pixels on purpose. Rescaling the geometry into
  // millimetre units would be tidier to read, but it adds a transform layer
  // around the whole drawing, and this same markup is handed to Imagick on the
  // server for the PNG and PDF exports — its SVG support is the weakest link in
  // the chain and the fewer transforms it has to honour, the better. width and
  // height alone already pin the physical size for every conforming consumer.
  if (!root.getAttribute('viewBox')) {
    root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  return true;
}

/**
 * The transform that places one glyph outline on its baseline position.
 *
 * opentype.js already returns a path in SVG space at the requested font size,
 * so no scaling or y-flip is needed here — only the move and the rotation.
 *
 * The order matters and is easy to get wrong: translate first, then rotate, so
 * the character turns around ITS OWN baseline origin. That is precisely what a
 * tspan `rotate` attribute means and what the canvas does; rotating first would
 * swing every glyph around the origin of the whole text block instead.
 */
export function glyphTransform(x, y, rotationDeg) {
  const r = Number(rotationDeg) || 0;
  const rot = r ? ` rotate(${round(r)})` : '';
  return `translate(${round(x)} ${round(y)})${rot}`;
}

function round(n, digits = 4) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return parseFloat(v.toFixed(digits));
}

/**
 * Read every glyph of every <text> in a rendered SVG document: which character,
 * where its baseline starts, and how it is rotated.
 *
 * Why measure instead of reading the tspan attributes: Fabric only writes
 * per-character x/y when the text is on a path or has charSpacing. Plain text
 * ships as one tspan per line, and then the per-character positions are the
 * renderer's business — including kerning. Asking the layout engine (via
 * getStartPositionOfChar / getRotationOfChar) gives the same numbers the canvas
 * used, so both cases are handled by one code path and kerning comes along for
 * free.
 *
 * Requires a live layout: the document must be attached to the page. Callers
 * use `withMeasuredSvg`.
 */
export function measureTextGlyphs(textEl) {
  const glyphs = [];
  const total = textEl.getNumberOfChars();
  const content = textEl.textContent || '';
  for (let i = 0; i < total; i++) {
    const ch = content[i];
    if (!ch || !ch.trim()) continue; // whitespace has no outline
    const p = textEl.getStartPositionOfChar(i);
    glyphs.push({ ch, x: p.x, y: p.y, rotation: textEl.getRotationOfChar(i) });
  }
  return glyphs;
}

/**
 * Attach an SVG document to the page long enough to measure it, then clean up.
 * Off-screen rather than `display:none`, because a display:none subtree has no
 * layout and every getStartPositionOfChar would return 0.
 */
export async function withMeasuredSvg(doc, fn) {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;';
  const imported = document.importNode(doc.documentElement, true);
  host.appendChild(imported);
  document.body.appendChild(host);
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    return await fn(imported);
  } finally {
    host.remove();
  }
}

/* ------------------------------------------------------------------------- *
 * Transform helpers for converting curved text to <textPath>.
 *
 * LightBurn reads a curved <textPath> correctly (measured 2026-08-27 with the
 * four-way test file: per-character tspans re-flowed wrongly, textPath came in
 * on the curve, in the installed font). But it cannot be trusted with nested
 * transform chains, so the referenced path is baked into absolute coordinates
 * and the <text> sits at the document root with no transform at all — the curve
 * itself carries position AND rotation, and glyphs follow its tangent.
 * ------------------------------------------------------------------------- */

/**
 * Parse one SVG transform attribute into a 2x3 matrix [a b c d e f].
 * Supports the forms Fabric emits: matrix(), translate(), scale(), rotate(deg).
 * Returns null on anything it does not recognise — caller falls back.
 */
export function parseTransformAttr(attr) {
  let m = [1, 0, 0, 1, 0, 0];
  if (!attr) return m;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match;
  let any = false;
  while ((match = re.exec(attr)) !== null) {
    any = true;
    const args = match[2].trim().split(/[\s,]+/).map(Number);
    if (args.some((n) => !Number.isFinite(n))) return null;
    let t;
    switch (match[1]) {
      case 'matrix':
        if (args.length !== 6) return null;
        t = args; break;
      case 'translate':
        t = [1, 0, 0, 1, args[0] || 0, args[1] || 0]; break;
      case 'scale':
        t = [args[0], 0, 0, args.length > 1 ? args[1] : args[0], 0, 0]; break;
      case 'rotate': {
        if (args.length !== 1) return null; // rotate(a cx cy) unused by Fabric
        const r = (args[0] * Math.PI) / 180;
        t = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]; break;
      }
      default:
        return null;
    }
    m = multiplyMatrices(m, t);
  }
  return any ? m : m;
}

export function multiplyMatrices(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * The absolute transform of an element: every ancestor's transform attribute
 * composed from the SVG root down. Returns null when any attribute is
 * unparseable.
 */
export function absoluteTransform(el) {
  const chain = [];
  for (let node = el; node && node.nodeName !== 'svg'; node = node.parentNode) {
    if (node.nodeType === 1 && node.getAttribute && node.getAttribute('transform')) {
      chain.unshift(node.getAttribute('transform'));
    }
  }
  let m = [1, 0, 0, 1, 0, 0];
  for (const attr of chain) {
    const t = parseTransformAttr(attr);
    if (!t) return null;
    m = multiplyMatrices(m, t);
  }
  return m;
}

/**
 * Decompose a matrix into { scale, rotationDeg } when it is a uniform
 * scale + rotation (no skew, no flip, no non-uniform scale) — the only shapes a
 * text baseline can safely carry, because glyph size follows the path only
 * through an explicit font-size. Returns null otherwise.
 */
export function uniformScaleRotation([a, b, c, d]) {
  const sx = Math.hypot(a, b);
  const sy = Math.hypot(c, d);
  if (sx < 1e-9 || Math.abs(sx - sy) > 1e-6 * Math.max(sx, sy)) return null;
  // skew check: columns must be perpendicular
  if (Math.abs(a * c + b * d) > 1e-6 * sx * sy) return null;
  // flip check: determinant must be positive
  if (a * d - b * c <= 0) return null;
  return { scale: sx, rotationDeg: (Math.atan2(b, a) * 180) / Math.PI };
}

/**
 * Bake an affine matrix into an absolute path string.
 *
 * Handles the commands the curve presets produce (M, L, Q, C, plus H/V/S/T for
 * completeness) and elliptical arcs when the matrix is a uniform
 * scale + rotation. Returns null for anything else — lowercase relative
 * commands included — so the caller can fall back to outlining instead of
 * guessing.
 */
export function bakePathTransform(d, m) {
  const usr = uniformScaleRotation(m);
  const pt = (x, y) => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ];
  const fmt = (n) => round(n, 4);
  const tokens = d.match(/[A-Za-z]|-?[\d.]+(?:e-?\d+)?/g);
  if (!tokens) return null;

  let out = '';
  let i = 0;
  let cmd = '';
  // Track the previous point for H/V, which only carry one coordinate.
  let cx = 0;
  let cy = 0;
  const read = (n) => {
    const vals = tokens.slice(i, i + n).map(Number);
    if (vals.length !== n || vals.some((v) => !Number.isFinite(v))) return null;
    i += n;
    return vals;
  };

  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) { cmd = tokens[i]; i += 1; }
    let coords;
    switch (cmd) {
      case 'M': case 'L': case 'T': {
        coords = read(2); if (!coords) return null;
        [cx, cy] = coords;
        const [x, y] = pt(cx, cy);
        out += `${cmd} ${fmt(x)} ${fmt(y)} `;
        break;
      }
      case 'H': {
        coords = read(1); if (!coords) return null;
        cx = coords[0];
        const [x, y] = pt(cx, cy);
        out += `L ${fmt(x)} ${fmt(y)} `; // H is axis-bound; after rotation it must be a line
        break;
      }
      case 'V': {
        coords = read(1); if (!coords) return null;
        cy = coords[0];
        const [x, y] = pt(cx, cy);
        out += `L ${fmt(x)} ${fmt(y)} `;
        break;
      }
      case 'Q': case 'S': {
        coords = read(4); if (!coords) return null;
        const [x1, y1] = pt(coords[0], coords[1]);
        [cx, cy] = [coords[2], coords[3]];
        const [x, y] = pt(cx, cy);
        out += `${cmd} ${fmt(x1)} ${fmt(y1)} ${fmt(x)} ${fmt(y)} `;
        break;
      }
      case 'C': {
        coords = read(6); if (!coords) return null;
        const [x1, y1] = pt(coords[0], coords[1]);
        const [x2, y2] = pt(coords[2], coords[3]);
        [cx, cy] = [coords[4], coords[5]];
        const [x, y] = pt(cx, cy);
        out += `C ${fmt(x1)} ${fmt(y1)} ${fmt(x2)} ${fmt(y2)} ${fmt(x)} ${fmt(y)} `;
        break;
      }
      case 'A': {
        if (!usr) return null; // arcs survive only uniform scale + rotation
        coords = read(7); if (!coords) return null;
        const [rx, ry, rot, laf, sf] = coords;
        [cx, cy] = [coords[5], coords[6]];
        const [x, y] = pt(cx, cy);
        out += `A ${fmt(rx * usr.scale)} ${fmt(ry * usr.scale)} `
             + `${fmt(rot + usr.rotationDeg)} ${laf} ${sf} ${fmt(x)} ${fmt(y)} `;
        break;
      }
      case 'Z': case 'z':
        out += 'Z ';
        break;
      default:
        return null; // relative commands or unknown — do not guess
    }
  }
  return out.trim();
}
