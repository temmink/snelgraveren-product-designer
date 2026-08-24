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
 * is already ascending, and clamping into it holds the object inside the
 * zone exactly as before.
 *
 * For an oversized object (bound size > zone size) there is no position on
 * that axis that satisfies "stay inside the zone" — every candidate range
 * is empty or degenerate. An earlier version of this fix reordered the
 * descending expression into an ascending [lo, hi] via Math.min/Math.max
 * and clamped into THAT, which keeps the object covering the zone — but
 * "covering" collapses every position to a single point (typically the
 * zone's origin), so the object gets pinned there and can never be dragged
 * anywhere. Reported symptom: a zone 20 wide with a 100-wide text object
 * clamped every rightward drag straight back to 0 — the object looked
 * stuck. The trigger in practice is the default 20×20 size of a newly
 * added boundary: any real text dropped into it is oversized on both axes
 * before the merchant has a chance to resize anything.
 *
 * An object that cannot fit on an axis has no valid clamped position there,
 * so this fix does not clamp that axis at all — it passes the requested
 * position through untouched, leaving the object free to move so the
 * merchant/customer can actually fix the mismatch (resize the object,
 * resize the zone, or reposition it). Each axis is decided independently:
 * an object can be oversized on one axis and fitting on the other, and the
 * fitting axis must keep clamping normally.
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
  // Oversized on this axis: no position keeps the object inside the zone,
  // so don't force one — leave the axis free rather than trapping the
  // object at a single point.
  if (boundSize > zoneSize) return objPos;

  const offset = objPos - boundPos;

  // Fits range: [zonePos, zonePos + zoneSize - boundSize], always ascending
  // here since boundSize <= zoneSize.
  const lo = zonePos;
  const hi = zonePos + zoneSize - boundSize;

  const clampedBound = Math.min(Math.max(boundPos, lo), hi);
  return clampedBound + offset;
}
