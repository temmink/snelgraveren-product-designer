/**
 * Native LightBurn (.lbrn2) writer — the inverse of the template builder's
 * lbrnParser, and built against the same specimens (test_import_export.lbrn2,
 * test_complex.lbrn2, LightBurn 2.1.03).
 *
 * Why a native format at all: SVG can carry curved text either as glyph
 * outlines (exact, but dead) or as <textPath> (editable, but every consumer
 * re-flows it with its own engine). LightBurn's own project format sidesteps
 * both: a Text shape stores just the string, the font and the bend, and
 * LightBurn lays it out natively — fully editable, correct font, correct bend.
 *
 * Encoding facts this writer relies on (all read from real files and from
 * lbrnParser.js, which has parsed them for a year):
 *
 *  - Geometry is millimetres. For this shop's device orientation
 *    (MirrorY="True", Ruida) machine Y maps DIRECTLY onto canvas Y — the
 *    importer applies no flip, so neither does the writer.
 *  - A Path shape is <Shape Type="Path"><XForm/><VertList/><PrimList/></Shape>.
 *    VertList: `V{x} {y}` per anchor with optional `c0x…c0y…` (outgoing) and
 *    `c1x…c1y…` (incoming) cubic handles; omitted handles mean a straight side.
 *    PrimList: concatenated `L{a} {b}` / `B{a} {b}` vertex-index pairs; a
 *    primitive whose target is the subpath's first vertex closes it.
 *  - A Text shape: Str, Font="Family,-1,4096,5,{weight},0,0,0,0,0" (Qt font
 *    string), H = em size in mm, LS/LnS spacing, Ah/Av alignment, and for bent
 *    text Bend="1" with the bend handle at (BendPX, BendPY) — measured on the
 *    specimen: BendPX sits at half the unbent text width, BendPY is the arc
 *    rise. LightBurn does its own layout from these; no glyph geometry needed.
 */

/* eslint-disable no-param-reassign */

const N = (v, digits = 6) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return '0';
  return String(parseFloat(x.toFixed(digits)));
};

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/\n/g, '&#10;');

/* ------------------------------------------------------------------ *
 * SVG path data → VertList/PrimList
 * ------------------------------------------------------------------ */

/**
 * Parse an absolute SVG path string (M/L/H/V/Q/C/Z — what Fabric emits for
 * design content) into subpaths of cubic/line segments. Q is promoted to C
 * (exact: C1 = P0 + ⅔(Q−P0), C2 = P3 + ⅔(Q−P3)). Returns null on anything
 * else (arcs, relative commands) so the caller can refuse loudly instead of
 * writing geometry it cannot vouch for.
 */
export function parsePathData(d) {
  const tokens = String(d).match(/[A-Za-z]|-?[\d.]+(?:e-?\d+)?/g);
  if (!tokens) return null;
  const subpaths = [];
  let current = null;
  let cmd = '';
  let x = 0; let y = 0;
  let i = 0;
  const read = (n) => {
    const vals = tokens.slice(i, i + n).map(Number);
    if (vals.length !== n || vals.some((v) => !Number.isFinite(v))) return null;
    i += n;
    return vals;
  };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) { cmd = tokens[i]; i += 1; }
    switch (cmd) {
      case 'M': {
        const c = read(2); if (!c) return null;
        [x, y] = c;
        current = { start: [x, y], segs: [], closed: false };
        subpaths.push(current);
        cmd = 'L'; // subsequent pairs are implicit LineTos
        break;
      }
      case 'L': {
        const c = read(2); if (!c) return null;
        current?.segs.push({ type: 'L', to: [c[0], c[1]] });
        [x, y] = c;
        break;
      }
      case 'H': {
        const c = read(1); if (!c) return null;
        current?.segs.push({ type: 'L', to: [c[0], y] });
        x = c[0];
        break;
      }
      case 'V': {
        const c = read(1); if (!c) return null;
        current?.segs.push({ type: 'L', to: [x, c[0]] });
        y = c[0];
        break;
      }
      case 'C': {
        const c = read(6); if (!c) return null;
        current?.segs.push({ type: 'C', c1: [c[0], c[1]], c2: [c[2], c[3]], to: [c[4], c[5]] });
        [x, y] = [c[4], c[5]];
        break;
      }
      case 'Q': {
        const c = read(4); if (!c) return null;
        const [qx, qy, tx, ty] = c;
        current?.segs.push({
          type: 'C',
          c1: [x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y)],
          c2: [tx + (2 / 3) * (qx - tx), ty + (2 / 3) * (qy - ty)],
          to: [tx, ty],
        });
        [x, y] = [tx, ty];
        break;
      }
      case 'Z': case 'z': {
        if (current) { current.closed = true; [x, y] = current.start; }
        break;
      }
      default:
        return null; // arcs / relative commands — refuse, never guess
    }
  }
  return subpaths.filter((s) => s.segs.length);
}

/**
 * Encode parsed subpaths as one VertList/PrimList pair, mapping every
 * coordinate through `pt(x, y) → [X, Y]` (canvas px → machine mm).
 */
export function subpathsToVertPrim(subpaths, pt) {
  const verts = []; // { x, y, c0: [x,y]|null, c1: [x,y]|null }
  let prims = '';

  subpaths.forEach((sp) => {
    const startIdx = verts.length;
    verts.push({ p: pt(...sp.start), c0: null, c1: null });
    sp.segs.forEach((seg, k) => {
      const isLast = k === sp.segs.length - 1;
      const closes = sp.closed && isLast
        && Math.abs(seg.to[0] - sp.start[0]) < 1e-9
        && Math.abs(seg.to[1] - sp.start[1]) < 1e-9;
      const from = verts.length - 1;
      const toIdx = closes ? startIdx : verts.length;
      if (!closes) verts.push({ p: pt(...seg.to), c0: null, c1: null });
      if (seg.type === 'L') {
        prims += `L${from} ${toIdx}`;
      } else {
        verts[from].c0 = pt(...seg.c1);   // outgoing handle of the FROM vertex
        verts[toIdx].c1 = pt(...seg.c2);  // incoming handle of the TO vertex
        prims += `B${from} ${toIdx}`;
      }
      // An explicitly closed subpath whose last point does not coincide with
      // the start still needs the closing edge.
      if (sp.closed && isLast && !closes) prims += `L${toIdx} ${startIdx}`;
    });
  });

  const vertList = verts.map((v) => {
    let t = `V${N(v.p[0])} ${N(v.p[1])}`;
    if (v.c0) t += `c0x${N(v.c0[0])}c0y${N(v.c0[1])}`;
    if (v.c1) t += `c1x${N(v.c1[0])}c1y${N(v.c1[1])}`;
    return t;
  }).join('');

  return { vertList, primList: prims };
}

/* ------------------------------------------------------------------ *
 * Fabric objects → shapes
 * ------------------------------------------------------------------ */

/** Qt font string for a family/weight, as LightBurn writes it. */
export function qtFontString(family, { bold = false, italic = false } = {}) {
  const weight = bold ? 700 : 400;
  return `${family},-1,4096,5,${weight},${italic ? 1 : 0},0,0,0,0`;
}

/**
 * Fit LightBurn's circular bend to the piece of Fabric's curve the text
 * ACTUALLY occupies.
 *
 * Fabric lays text along a quadratic by arc length, starting at the left, and
 * the ink usually covers only part of the path. LightBurn lays text along a
 * circle whose curvature follows from (BendPX, BendPY): measured with the
 * spiral calibration, the arc's radius is (PX² + PY²) / (2·PY) and the text
 * runs along it by arc length. Feeding it the FULL path's rise therefore bends
 * the text far too hard (order 2678: "Liefde, geluk" spans ~70% of its path;
 * the full-path rise of 24 mm produced an 83° wrap where the proof shows ~48°).
 *
 * So: sample the path, walk to where the ink starts, halfway and ends, and fit
 * the circle through those three points. That yields the chord (→ BendPX), the
 * sagitta (→ BendPY, signed by which side the middle bulges to) and the chord's
 * tilt — Fabric's laid span is generally not horizontal, and that tilt is part
 * of how the proof looks, so it goes into the object rotation.
 *
 * @param {Array} pathCmds   Fabric path commands ([['M',x,y],['Q',..],...])
 * @param {number} startPx   pathStartOffset in px
 * @param {number} inkPx     laid ink length in px
 * @returns {{px:number, py:number, chordAngleRad:number}|null}
 */
export function arcBendParams(pathCmds, startPx, inkPx) {
  if (!Array.isArray(pathCmds) || !(inkPx > 0)) return null;

  // Flatten to a polyline with cumulative arc length.
  const pts = [];
  let cx = 0; let cy = 0;
  const emit = (x, y) => pts.push([x, y]);
  for (const seg of pathCmds) {
    const c = seg.map(Number);
    switch (seg[0]) {
      case 'M': [, cx, cy] = c; emit(cx, cy); break;
      case 'L': [, cx, cy] = c; emit(cx, cy); break;
      case 'Q': {
        const [, qx, qy, tx, ty] = c;
        for (let i = 1; i <= 64; i++) {
          const t = i / 64; const u = 1 - t;
          emit(u * u * cx + 2 * u * t * qx + t * t * tx,
               u * u * cy + 2 * u * t * qy + t * t * ty);
        }
        cx = tx; cy = ty; break;
      }
      case 'C': {
        const [, x1, y1, x2, y2, tx, ty] = c;
        for (let i = 1; i <= 64; i++) {
          const t = i / 64; const u = 1 - t;
          emit(u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * tx,
               u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ty);
        }
        cx = tx; cy = ty; break;
      }
      default:
        return null; // arcs/relative — the presets never produce them
    }
  }
  if (pts.length < 2) return null;

  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  if (!(total > 0)) return null;

  const at = (sLen) => {
    const target = Math.min(Math.max(sLen, 0), total);
    let i = 1;
    while (i < cum.length && cum[i] < target) i++;
    if (i >= cum.length) return pts[pts.length - 1];
    const seg = cum[i] - cum[i - 1] || 1;
    const f = (target - cum[i - 1]) / seg;
    return [pts[i - 1][0] + f * (pts[i][0] - pts[i - 1][0]),
            pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1])];
  };

  const s0 = startPx || 0;
  const S = at(s0);
  const E = at(s0 + Math.min(inkPx, total - s0));
  const M = at(s0 + Math.min(inkPx, total - s0) / 2);

  const dx = E[0] - S[0];
  const dy = E[1] - S[1];
  const chord = Math.hypot(dx, dy);
  if (!(chord > 1e-6)) return null;

  // Signed distance of the midpoint to the chord. Canvas y points down, so a
  // NEGATIVE cross product means the middle sits above the chord — an upward
  // arch, which LightBurn encodes as positive BendPY.
  const cross = dx * (M[1] - S[1]) - dy * (M[0] - S[0]);
  const sagitta = Math.abs(cross) / chord;

  return {
    px: chord / 2,
    py: sagitta < 0.25 ? 0 : (cross < 0 ? sagitta : -sagitta), // sub-pixel arch = straight
    chordAngleRad: Math.atan2(dy, dx),
    chordMid: [(S[0] + E[0]) / 2, (S[1] + E[1]) / 2], // path-local, for anchoring
  };
}


/**
 * Per-line baseline start points of a straight text, in text-local coordinates.
 *
 * Source: Fabric's own SVG serialisation, which writes one tspan per line with
 * the exact line-start x and baseline y — the same numbers the proof was
 * rendered with. Returns null when the text cannot be split this way (it sits
 * on a path, or charSpacing forces per-character tspans).
 */
function lineBaselines(o) {
  if (o.path || o.charSpacing) return null;
  let markup = '';
  try { markup = o.toSVG(); } catch (_) { return null; }
  const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return null;
  const spans = Array.from(doc.querySelectorAll('tspan'));
  const lines = String(o.text).split('\n');
  if (!spans.length || spans.length !== lines.length) return null;
  return spans.map((sp, i) => ({
    x: parseFloat(sp.getAttribute('x')) || 0,
    y: parseFloat(sp.getAttribute('y')) || 0,
    text: lines[i],
    lineIndex: i,
  }));
}

/**
 * Build a LightBurn project from a LOADED offscreen Fabric canvas.
 *
 * Texts become native Text shapes (editable in LightBurn, laid out by
 * LightBurn); every other vector object becomes a Path shape. Raster images,
 * zone overlays and excluded reference art are skipped — this file is for the
 * laser, not for preview.
 *
 * @param {fabric.Canvas} canvas   loaded offscreen canvas (objects live)
 * @param {{mmPerPx:number}} opts  physical scale; REQUIRED — a laser file
 *                                 without real units is how a 457 mm plank
 *                                 became 160 mm.
 * @returns {{xml:string, skipped:string[]}}
 */
export function buildLbrnProject(canvas, { mmPerPx }) {
  if (!(mmPerPx > 0)) throw new Error('lbrn export needs a physical width (width_mm) on the view');

  const mm = (x, y) => [x * mmPerPx, y * mmPerPx];
  const shapes = [];
  const skipped = [];
  let geomId = 0;

  const matrixPoint = (m, x, y) => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ];

  const pushPathShape = (dLocal, matrix, label) => {
    const sub = parsePathData(dLocal);
    if (!sub) { skipped.push(`${label}: pad-geometrie niet omzetbaar`); return; }
    const pt = (x, y) => mm(...matrixPoint(matrix, x, y));
    const { vertList, primList } = subpathsToVertPrim(sub, pt);
    if (!primList) { skipped.push(`${label}: leeg pad`); return; }
    geomId += 1;
    shapes.push(
      `<Shape Type="Path" CutIndex="0" VertID="${geomId}" PrimID="${geomId}">`
      + '<XForm>1 0 0 1 0 0</XForm>'
      + `<VertList>${vertList}</VertList>`
      + `<PrimList>${primList}</PrimList>`
      + '</Shape>'
    );
  };

  canvas.getObjects().forEach((o, idx) => {
    const data = o.data || {};
    if (data.excludeFromExport || data.isZoneOverlay) return;
    const label = data.elementType || o.type || `object ${idx}`;

    // --- text ---------------------------------------------------------
    if (typeof o.text === 'string') {
      if (!o.text.trim()) return; // placeholder — never billable, never engraved

      const preset = data.curvePreset || (o.path ? 'custom' : 'straight');
      // Wave and circle are not a single arc — those texts cannot become a
      // LightBurn bend and are reported instead of approximated.
      if (o.path && (preset === 'wave' || preset === 'circle')) {
        skipped.push(`"${o.text.slice(0, 20)}": ${preset}-vorm kan niet als LightBurn-buiging`);
        return;
      }

      const own = o.calcOwnMatrix();
      const scale = Math.hypot(own[0], own[1]) || 1;
      let angleDeg = Math.atan2(own[1], own[0]) * (180 / Math.PI);

      // Ink width of the laid line — how much of the curve the text occupies.
      // Trailing spaces advance the layout but leave no ink; keeping them in
      // skews the chord fit toward the empty end of the curve.
      let inkWidthPx = o.width || 0;
      try { inkWidthPx = o.calcTextWidth() || inkWidthPx; } catch (_) { /* keep */ }
      try {
        const line = o.__charBounds?.[0];
        const chars = o._text || o.text;
        if (line && chars) {
          let last = -1;
          for (let k = 0; k < line.length && k < chars.length; k++) {
            if (String(chars[k]).trim()) last = k;
          }
          if (last >= 0) inkWidthPx = line[last].left + (line[last].kernedWidth || line[last].width || 0);
        }
      } catch (_) { /* keep the advance width */ }

      // A single character carries no arc: its per-character tangent angle
      // (below) is the whole story, and a chord tilt on top would double-count.
      const isSingleChar = o.path && o.text.trim().length === 1;

      // Circular-arc fit of the laid span (chord, sagitta, tilt).
      let bendInfo = { bend: 0 };
      if (o.path && !isSingleChar) {
        const fit = arcBendParams(o.path.path, o.pathStartOffset || 0, inkWidthPx);
        if (!fit) {
          skipped.push(`"${o.text.slice(0, 20)}": baan niet als boog te passen`);
          return;
        }
        bendInfo = { bend: fit.py, chordPx: fit.px, chordMid: fit.chordMid };
        angleDeg += fit.chordAngleRad * (180 / Math.PI);
      }

      // A single character on a curve has no arc to speak of — bending it in
      // LightBurn wraps that one glyph around a tiny circle and it arrives
      // rotated a quarter turn (seen on the "&" of order 2678). What the
      // canvas actually shows is the glyph tilted to the curve's tangent, so
      // carry THAT: drop the bend, add Fabric's own per-character angle
      // (set by _setGraphemeOnPath during layout) to the object rotation.
      // The anchor must then be the GLYPH's position, not the object centre:
      // the object of a one-character curved text spans the whole 200 px path,
      // so its centre sits half a path away from the ink.
      let singleCharAnchor = null;
      if (isSingleChar) {
        const cb = o.__charBounds?.[0]?.[0];
        const charAngleRad = cb?.angle || 0;
        angleDeg += charAngleRad * (180 / Math.PI);
        bendInfo = { bend: 0 };
        if (cb && Number.isFinite(cb.renderLeft) && Number.isFinite(cb.renderTop)) {
          // Anchor the glyph on its own BASELINE START — with Ah=0 LightBurn
          // starts its line exactly there, so no glyph-shape guessing (ink
          // centres of decorative glyphs like "&" defy any em-fraction). The
          // vertical anchor-to-baseline relation is the grid-measured 0.8·H.
          singleCharAnchor = { x: cb.renderLeft, y: cb.renderTop };
        }
      }

      const centre = o.getCenterPoint();
      const [cx, cy] = mm(centre.x, centre.y);
      const hMm = (o.fontSize || 16) * scale * mmPerPx;

      // Extra spacing between characters. Fabric charSpacing is thousandths of
      // an em; LightBurn LS is millimetres of extra advance.
      const lsMm = ((o.fontSize || 0) * (o.charSpacing || 0) / 1000) * scale * mmPerPx;

      // Anchoring model, measured by exporting LightBurn's own render of known
      // anchors back to SVG and fitting the deltas (order 2678, five texts,
      // 2026-08-27). With Av="1", LightBurn hangs the rendered ink a fixed
      // fraction below the anchor, along the TEXT's own down-axis:
      //
      //   rendered mid = anchor + R(θ)·(0, 0.31·H + max(BendPY, 0))
      //
      // The bend term is asymmetric because LightBurn pins the TOP of the
      // block: an upward arch pushes everything down by its rise, a downward
      // arch leaves the top row in place. Verified to ±1.5 mm on the bent
      // texts and ±1 mm on the straight ones. (Av0 scatters bent glyphs;
      // Av2 anchors the bottom — neither is written.)
      const bent = !!bendInfo.bend;
      const hPx = (o.fontSize || 16); // px; hMm below is the mm version
      const theta = (angleDeg * Math.PI) / 180;
      const down = (p) => [-p * Math.sin(theta), p * Math.cos(theta)]; // R(θ)·(0,p)
      const AV1_DROP = 0.31;          // line-box middle → ink middle, × H
      const INK_ABOVE_BASELINE = 0.35; // baseline → ink middle, × H

      // Bend term, fitted on the re-export: signed and in full. An upward arch
      // shifts the ink down by its rise (LightBurn pins the top of the block);
      // a downward arch lifts the anchor point by the same amount relative to
      // its top-edge chord. Verified against the measured targets: Liefde
      // (+11.7) −1.2 mm, Lekkere (−11.3) −0.1 mm, Han & Mei (−1.2) −0.6 mm.
      const dropMm = (AV1_DROP * hPx + bendInfo.bend) * scale * mmPerPx;
      const [dX, dY] = down(dropMm);
      let anchorX;
      let anchorY;
      if (singleCharAnchor) {
        // Baseline-anchored: with Av=1 the anchor sits 0.8·H above the
        // rendered baseline (grid measurement: +9.6 mm at H=12).
        const [gx, gy] = mm(...matrixPoint(own, singleCharAnchor.x, singleCharAnchor.y));
        const [bX, bY] = down(0.80 * hPx * scale * mmPerPx);
        anchorX = gx - bX;
        anchorY = gy - bY;
      } else if (bent) {
        // Anchor on the CHORD MIDPOINT of the laid span — the object's centre
        // sits half an unused path away from the ink (measured +26 mm on
        // "Liefde, geluk"). Ink middle ≈ chord mid, 0.35·H above the baseline.
        const off = o.path.pathOffset || { x: 0, y: 0 };
        const [cmx, cmy] = mm(...matrixPoint(own,
          bendInfo.chordMid[0] - off.x, bendInfo.chordMid[1] - off.y));
        const [uX, uY] = down(INK_ABOVE_BASELINE * hPx * scale * mmPerPx);
        anchorX = cmx - uX - dX;
        anchorY = cmy - uY - dY;
      } else {
        // Straight text — handled per LINE further down; this branch only
        // remains for texts whose lines cannot be derived (charSpacing forces
        // per-character tspans): left-anchored at the block start.
        const [lx, ly] = mm(...matrixPoint(own, -(o.width || 0) / 2, 0));
        anchorX = lx - dX;
        anchorY = ly - dY;
      }

      // Straight multi-line (and single-line) text: one Text shape per line,
      // each anchored on the baseline START of its first real character.
      // One combined shape would leave the leading spaces of an indented line
      // to LightBurn's own space metrics — measured on order 2678: twelve
      // leading spaces pushed "28 augustus 2026" visibly right of the proof.
      // Splitting also removes any dependence on LightBurn's line spacing.
      if (!bent && !singleCharAnchor) {
        const lines = lineBaselines(o);
        if (lines) {
          const cosL = Math.cos(theta);
          const sinL = Math.sin(theta);
          const [bX, bY] = down(0.80 * hPx * scale * mmPerPx);
          lines.forEach((line) => {
            const stripped = line.text.replace(/^\s+/, '').replace(/\s+$/, '');
            if (!stripped) return;
            // Leading-space width in Fabric's own metrics, from the line's
            // character bounds — never LightBurn's space width.
            let lead = 0;
            const lb = o.__charBounds?.[line.lineIndex];
            const leadCount = line.text.length - line.text.replace(/^\s+/, '').length;
            if (lb && leadCount > 0 && lb[leadCount]) lead = lb[leadCount].left || 0;
            const [gx, gy] = mm(...matrixPoint(own, line.x + lead, line.y));
            shapes.push(
              `<Shape Type="Text" CutIndex="0" `
              + `Font="${esc(qtFontString(o.fontFamily || 'Arial', {
                bold: /bold|[6-9]00/i.test(String(o.fontWeight || '')),
                italic: /italic|oblique/i.test(String(o.fontStyle || '')),
              }))}" `
              + `Str="${esc(stripped)}" H="${N(hMm, 3)}" LS="0" LnS="0" `
              + 'Ah="0" Av="1" Weld="1">'
              + `<XForm>${N(cosL)} ${N(sinL)} ${N(-sinL)} ${N(cosL)} `
              + `${N(gx - bX, 4)} ${N(gy - bY, 4)}</XForm>`
              + '</Shape>'
            );
          });
          return;
        }
      }

      const cos = Math.cos((angleDeg * Math.PI) / 180);
      const sin = Math.sin((angleDeg * Math.PI) / 180);
      const attrs = [
        'Type="Text"', 'CutIndex="0"',
        `Font="${esc(qtFontString(o.fontFamily || 'Arial', {
          bold: /bold|[6-9]00/i.test(String(o.fontWeight || '')),
          italic: /italic|oblique/i.test(String(o.fontStyle || '')),
        }))}"`,
        `Str="${esc(o.text)}"`,
        `H="${N(hMm, 3)}"`,
        `LS="${N(lsMm, 3)}"`, 'LnS="0"',
        `Ah="${bent ? 1 : 0}"`, 'Av="1"', 'Weld="1"',
      ];
      if (bent) {
        attrs.push(
          'Bend="1"',
          `BendPX="${N((bendInfo.chordPx || inkWidthPx / 2) * scale * mmPerPx, 4)}"`,
          `BendPY="${N(bendInfo.bend * scale * mmPerPx, 4)}"`
        );
      }
      shapes.push(
        `<Shape ${attrs.join(' ')}>`
        + `<XForm>${N(cos)} ${N(sin)} ${N(-sin)} ${N(cos)} ${N(anchorX, 4)} ${N(anchorY, 4)}</XForm>`
        + '</Shape>'
      );
      return;
    }

    // --- vector geometry ---------------------------------------------
    if (Array.isArray(o.path)) {
      const dLocal = o.path
        .map((seg) => seg.map((v, k) => (k === 0 ? v : N(v))).join(' '))
        .join(' ');
      const off = o.pathOffset || { x: 0, y: 0 };
      const own = o.calcOwnMatrix();
      // own matrix ∘ translate(−pathOffset): identical maths to the SVG export.
      const m = [
        own[0], own[1], own[2], own[3],
        own[4] - own[0] * off.x - own[2] * off.y,
        own[5] - own[1] * off.x - own[3] * off.y,
      ];
      pushPathShape(dLocal, m, label);
      return;
    }

    if (/image/i.test(o.type || '')) {
      skipped.push(`${label}: rasterafbeelding niet opgenomen in .lbrn2`);
      return;
    }
    skipped.push(`${label}: type niet ondersteund`);
  });

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<LightBurnProject AppVersion="1.7.03" FormatVersion="1" MirrorX="False" MirrorY="True">\n'
    // One generic engrave layer; power and speed are the operator's call.
    + '<CutSetting type="Scan">'
    + '<index Value="0"/><name Value="Gravure"/>'
    + '<minPower Value="20"/><maxPower Value="20"/><speed Value="200"/><priority Value="0"/>'
    + '</CutSetting>\n'
    + shapes.join('\n')
    + '\n<Notes ShowOnLoad="0" Notes="Gegenereerd door Snelgraveren Product Designer"/>\n'
    + '</LightBurnProject>\n';

  return { xml, skipped };
}
