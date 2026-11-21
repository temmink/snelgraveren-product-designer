/**
 * A zone's outline as one path, in canvas pixels — the reference the
 * production exports carry so the operator can line the design up with the
 * real product (LightBurn tool layer T1; a thin line in SVG/PNG/PDF).
 *
 * Computed in the browser with Fabric itself, because the placement of a
 * zone SVG (bounding box at zone.x/y, svg_scale, svg_rotation, stroke-aware
 * group bounds) only exists exactly there. The template builder stores the
 * result per zone (`zone.export_outline`); the server only re-draws it.
 *
 * Shared by the builder and the customer designer: `placeZoneBoundary` is the
 * ONE rule for where a zone's SVG lands. Copying it into a renderer again is
 * how the outline and the overlay would drift apart.
 */

/** Where a zone's SVG boundary group goes. Every renderer uses this. */
export function placeZoneBoundary(group, zone) {
  group.set({
    left:   zone.x,
    top:    zone.y,
    scaleX: zone.svg_scale || 1,
    scaleY: zone.svg_scale || 1,
    angle:  zone.svg_rotation || 0,
  });
}

/** Up to 3 decimals, never exponent notation, never "-0". */
function num(v) {
  const r = Math.round(v * 1000) / 1000;
  if (Object.is(r, -0) || r === 0) return '0';
  return String(Number(r.toFixed(3)));
}

const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** The closed outline of a rect zone. */
export function rectOutline(zone) {
  const { x, y, width: w, height: h } = zone;
  return `M ${num(x)} ${num(y)} L ${num(x + w)} ${num(y)} L ${num(x + w)} ${num(y + h)} L ${num(x)} ${num(y + h)} Z`;
}

// Cubic approximation of a quarter ellipse.
const K = 0.5522847498;

/** Local-space subpaths ({start, segs:[{type,pts}]}) for one Fabric child. */
function localSubpaths(o) {
  const type = String(o.type || '').toLowerCase();
  const off = o.pathOffset || { x: 0, y: 0 };

  if (type === 'path' && Array.isArray(o.path)) {
    const subs = [];
    let cur = null;
    let last = [0, 0];
    o.path.forEach((seg) => {
      const c = String(seg[0]).toUpperCase();
      const p = (i) => [seg[i] - off.x, seg[i + 1] - off.y];
      if (c === 'M') {
        cur = { start: p(1), segs: [] };
        subs.push(cur);
        last = cur.start;
      } else if (c === 'L' && cur) {
        last = p(1);
        cur.segs.push({ type: 'L', pts: [last] });
      } else if (c === 'C' && cur) {
        const to = p(5);
        cur.segs.push({ type: 'C', pts: [p(1), p(3), to] });
        last = to;
      } else if (c === 'Q' && cur) {
        const q = p(1);
        const to = p(3);
        const c1 = [last[0] + (2 / 3) * (q[0] - last[0]), last[1] + (2 / 3) * (q[1] - last[1])];
        const c2 = [to[0] + (2 / 3) * (q[0] - to[0]), to[1] + (2 / 3) * (q[1] - to[1])];
        cur.segs.push({ type: 'C', pts: [c1, c2, to] });
        last = to;
      } else if (c === 'Z' && cur) {
        last = cur.start;
      }
    });
    return subs.filter((s) => s.segs.length);
  }

  if (type === 'rect') {
    const w = (o.width || 0) / 2;
    const h = (o.height || 0) / 2;
    return [{ start: [-w, -h], segs: [[w, -h], [w, h], [-w, h]].map((pt) => ({ type: 'L', pts: [pt] })) }];
  }

  if (type === 'circle' || type === 'ellipse') {
    const rx = type === 'circle' ? o.radius || 0 : o.rx || 0;
    const ry = type === 'circle' ? o.radius || 0 : o.ry || 0;
    const kx = rx * K;
    const ky = ry * K;
    return [{
      start: [rx, 0],
      segs: [
        { type: 'C', pts: [[rx, ky], [kx, ry], [0, ry]] },
        { type: 'C', pts: [[-kx, ry], [-rx, ky], [-rx, 0]] },
        { type: 'C', pts: [[-rx, -ky], [-kx, -ry], [0, -ry]] },
        { type: 'C', pts: [[kx, -ry], [rx, -ky], [rx, 0]] },
      ],
    }];
  }

  if ((type === 'polygon' || type === 'polyline') && Array.isArray(o.points) && o.points.length > 1) {
    const pts = o.points.map((pt) => [pt.x - off.x, pt.y - off.y]);
    return [{ start: pts[0], segs: pts.slice(1).map((pt) => ({ type: 'L', pts: [pt] })) }];
  }

  return [];
}

/**
 * Bake Fabric children (each with its ABSOLUTE calcTransformMatrix) into one
 * path string: absolute M/L/C/Z only, every subpath closed.
 */
export function bakeOutline(objects) {
  const parts = [];
  (objects || []).forEach((o) => {
    const m = o.calcTransformMatrix();
    const pt = ([x, y]) => apply(m, x, y).map(num).join(' ');
    localSubpaths(o).forEach((sp) => {
      let d = `M ${pt(sp.start)}`;
      sp.segs.forEach((seg) => { d += ` ${seg.type} ${seg.pts.map(pt).join(' ')}`; });
      parts.push(`${d} Z`);
    });
  });
  return parts.join(' ');
}

/**
 * The outline of one zone, laid out by real Fabric exactly as the designer
 * lays out its overlay. `fabric` is passed in ({ loadSVGFromString, util })
 * so this module never imports Fabric itself.
 *
 * @returns {Promise<string|null>} null when the zone has no usable shape.
 */
export async function zoneOutlinePathData(zone, svgText, fabric) {
  if (zone.boundary_type !== 'svg') return rectOutline(zone);
  if (!svgText) return null;
  const { objects, options } = await fabric.loadSVGFromString(svgText);
  const filtered = (objects || []).filter(Boolean);
  if (!filtered.length) return null;
  const group = fabric.util.groupSVGElements(filtered, options);
  placeZoneBoundary(group, zone);
  group.setCoords();
  const children = typeof group.getObjects === 'function' ? group.getObjects() : [group];
  const d = bakeOutline(children);
  return d || null;
}

/**
 * A copy of `zone` with a fresh `export_outline`, or without one when the
 * shape cannot be computed (a stale outline must never survive a changed or
 * missing SVG). The SVG source order is the customer designer's: `svg_url`
 * first, inline `svg_markup` otherwise.
 *
 * @param {object} zone
 * @param {{loadSVGFromString:Function, util:{groupSVGElements:Function}}} fabric
 * @param {(url:string)=>Promise<string>} fetchText
 */
export async function withExportOutline(zone, fabric, fetchText) {
  const { export_outline: _stale, ...rest } = zone;
  try {
    let svgText = null;
    if (zone.boundary_type === 'svg') {
      svgText = zone.svg_url ? await fetchText(zone.svg_url) : (zone.svg_markup || null);
    }
    const d = await zoneOutlinePathData(zone, svgText, fabric);
    return d ? { ...rest, export_outline: { d, v: 1 } } : rest;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[SGPD] zone outline could not be computed:', err);
    return rest;
  }
}
