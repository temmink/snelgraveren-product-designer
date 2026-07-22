/**
 * True shape containment for svg-boundary zones with behavior 'restrict'.
 *
 * The rect clamp (clampToZone) can only hold an element inside the zone's
 * BOUNDING BOX; for a non-rectangular outline (moon, cloud, …) that box is
 * much larger than the visible contour, so restrict felt identical to clip.
 * These helpers let both canvases test an element's corners/edges against the
 * actual svg path and snap back to the last position that fitted.
 *
 * Only inline `svg_markup` boundaries are supported (all merged/imported
 * boundaries have it); svg_url-only zones and rotated boundaries fall back to
 * the rect clamp in the callers.
 */

/** Extract every <path d="…"> from inline svg markup. */
function pathDs(svgMarkup) {
  const out = [];
  const re = /<path\b[^>]*\bd="([^"]*)"/gi;
  let m;
  while ((m = re.exec(String(svgMarkup || ''))) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

const pathCache = new Map(); // markup string → Path2D

/**
 * Combined Path2D of all paths in a zone's inline markup, in markup-local
 * coordinates. Returns null when there is no markup or no Path2D support
 * (jsdom/tests) — callers must then fall back to the rect clamp.
 * @param {{svg_markup?:string}} zone
 * @returns {Path2D|null}
 */
export function zoneShapePath(zone) {
  const markup = zone && zone.svg_markup;
  if (!markup || typeof Path2D === 'undefined') return null;
  if (pathCache.has(markup)) return pathCache.get(markup);
  const ds = pathDs(markup);
  if (!ds.length) return null;
  const combined = new Path2D();
  ds.forEach((d) => combined.addPath(new Path2D(d)));
  if (pathCache.size > 50) pathCache.clear(); // tiny bound, forms are few
  pathCache.set(markup, combined);
  return combined;
}

/**
 * Containment sample points for an object: its 4 corners, the 4 edge
 * midpoints and the centre. Corners alone miss concave boundaries (an edge
 * can cross a notch while both ends stay inside); midpoints catch the common
 * cases without real polygon clipping.
 * @param {Array<{x:number,y:number}>} corners [tl, tr, br, bl]
 * @returns {Array<[number,number]>}
 */
export function objectSamplePoints(corners) {
  if (!corners || corners.length !== 4) return [];
  const [tl, tr, br, bl] = corners;
  const mid = (a, b) => [(a.x + b.x) / 2, (a.y + b.y) / 2];
  return [
    [tl.x, tl.y], [tr.x, tr.y], [br.x, br.y], [bl.x, bl.y],
    mid(tl, tr), mid(tr, br), mid(br, bl), mid(bl, tl),
    [(tl.x + br.x) / 2, (tl.y + br.y) / 2],
  ];
}

let containmentCtx = null;

/**
 * Whether every sample point lies inside the zone's shape. Points are given
 * in canvas coordinates and mapped to markup-local space via the zone's
 * x/y offset and svg_scale (rotation unsupported — callers skip those zones).
 * @param {Path2D} path
 * @param {{x:number,y:number,svg_scale?:number}} zone
 * @param {Array<[number,number]>} points canvas-space sample points
 * @returns {boolean}
 */
export function pointsInsideZoneShape(path, zone, points) {
  if (!containmentCtx) {
    containmentCtx = document.createElement('canvas').getContext('2d');
    if (!containmentCtx) return true; // cannot test — do not block movement
  }
  const s = zone.svg_scale || 1;
  return points.every(([x, y]) =>
    containmentCtx.isPointInPath(path, (x - (zone.x || 0)) / s, (y - (zone.y || 0)) / s)
  );
}
