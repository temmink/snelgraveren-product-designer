/**
 * Rectangular clamp of an object's position into a zone's bounding box.
 *
 * This is the fallback used by clampToZone in both canvases for 'restrict'
 * zones that are NOT tested via true shape containment (rectangular zones,
 * or svg-boundary zones the shape test bailed out of).
 *
 * BUG THIS FIXES: the previous inline version in each canvas applied both
 * edge corrections unconditionally, both derived from the SAME pre-move
 * bounding rect:
 *
 *   if (bound.left < zone.x) left += zone.x - bound.left;
 *   if (bound.left + bound.width > zone.x + zone.width)
 *     left -= (bound.left + bound.width) - (zone.x + zone.width);
 *
 * When the object is wider than the zone, both conditions fire at once and
 * the two deltas partially cancel in a way that reflects the drag about a
 * fixed point instead of clamping it — dragging right could move the object
 * left. See shared/js/zoneRectClamp.test.js for a reproduction.
 *
 * THE FIX: per axis, compute the valid range for the axis position as an
 * ordered [lo, hi] pair rather than applying two independent corrections.
 * For an object that fits (bound size <= zone size) the natural range
 *   [zone.pos, zone.pos + zone.size - bound.size]
 * is already ascending. For an oversized object (bound size > zone size)
 * that same expression is descending — `zone.pos + zone.size - bound.size`
 * is less than `zone.pos`. Reordering it into an ascending [lo, hi] via
 * Math.min/Math.max yields exactly the range that keeps the object COVERING
 * the zone (its near edge at or past the zone's far edge on one side, and
 * vice versa on the other) — the sane reading of "restrict" for an
 * oversized object: the overhang can slide, but the object can never
 * uncover the zone or reflect direction. Clamping (a monotonic operation)
 * into that ordered range means dragging further in one direction can never
 * move the clamped result backwards.
 *
 * Pure, no Fabric objects — takes/returns plain numbers so it is trivially
 * testable and identical between the template builder and the frontend
 * designer (this exact "one mechanism, two copies" duplication produced the
 * bug — see CLAUDE.md).
 *
 * @param {object} opts
 * @param {number} opts.objLeft  the object's current `left` (may differ from
 *   bound.left by a constant offset — rotation, non-default origin, stroke)
 * @param {number} opts.objTop   the object's current `top`
 * @param {{left:number, top:number, width:number, height:number}} opts.bound
 *   result of obj.getBoundingRect()
 * @param {{x:number, y:number, width:number, height:number}} opts.zone
 * @returns {{left:number, top:number}} clamped obj.left / obj.top
 */
export function clampRectToZone({ objLeft, objTop, bound, zone }) {
  const left = clampAxis(objLeft, bound.left, bound.width, zone.x, zone.width);
  const top = clampAxis(objTop, bound.top, bound.height, zone.y, zone.height);
  return { left, top };
}

/**
 * Clamp one axis. `objPos`/`boundPos` differ by a constant offset for a
 * given object; the clamp is computed in bound-space (where the zone's
 * geometry applies directly) and the offset is re-applied to the result so
 * callers can set `obj.left`/`obj.top` directly.
 */
function clampAxis(objPos, boundPos, boundSize, zonePos, zoneSize) {
  const offset = objPos - boundPos;

  // Natural (fits) range: [zonePos, zonePos + zoneSize - boundSize].
  // When boundSize > zoneSize this is descending — reordering into [lo, hi]
  // turns it into the "must keep covering the zone" range instead.
  const a = zonePos;
  const b = zonePos + zoneSize - boundSize;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);

  const clampedBound = Math.min(Math.max(boundPos, lo), hi);
  return clampedBound + offset;
}
