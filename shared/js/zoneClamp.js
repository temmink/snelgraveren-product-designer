/**
 * When a 'restrict' zone is enforced against an object, and how hard.
 *
 * ONE mechanism, ONE place. The template builder (Canvas.jsx) and the customer
 * designer (DesignerCanvas.jsx) both import these two functions; neither may
 * re-implement the decision. Both previous copies of this logic contained the
 * same trap, which is exactly what "one mechanism, two places" keeps producing
 * on this branch.
 *
 * ── The trap this replaces ────────────────────────────────────────────────
 *
 * The old shared-shape branch ran on `object:moving`, i.e. on EVERY FRAME of a
 * drag, and did this:
 *
 *   if (points are inside the contour) { obj._sgpdLastValid = {left, top}; return; }
 *   if (obj._sgpdLastValid) { obj.set(obj._sgpdLastValid); return; }   // teleport
 *
 * Two distinct ways for the user to get stuck:
 *
 * 1. Mid-drag teleport. The moment one of the nine sample points crossed the
 *    outline, the object was thrown back to a remembered position while the
 *    mouse button was still down. Fabric keeps deriving the next frame's
 *    position from the offset captured at mousedown, so the restore is undone
 *    and re-applied every frame: the object fights the pointer and reads as
 *    frozen. Measured in the builder against the wolf boundary: the pointer
 *    travelled 250 px and the object moved 21 px, then did not move again for
 *    the remaining eleven frames.
 * 2. Permanent pin. An object that no longer fits the contour at its current
 *    size (the merchant enlarged it, the customer typed more characters) has
 *    NO valid position at all, so every frame took the teleport branch and it
 *    was welded to the one remembered point. Measured: enlarging a text that
 *    had fitted pinned it at (174.089, 411) — two drags of 150 px and 200 px
 *    moved it exactly 0 px.
 *
 * ── The ruling ────────────────────────────────────────────────────────────
 *
 * Same principle that governed commit 0d4c69b for the rectangular clamp: a
 * constraint that leaves the user no way to correct their situation is worse
 * than no constraint. Therefore:
 *
 * - While dragging, only the lenient bounding-box clamp applies
 *   (`clampObjectDuringMove`). Dragging stays smooth, nothing teleports, and
 *   the object never fights the pointer.
 * - When the gesture ends, true shape containment applies once
 *   (`settleObjectInZone`): an object left outside the outline is moved to the
 *   nearest placement that does fit.
 * - If nothing fits at the object's current size, NOTHING is enforced. The
 *   object stays where the user put it — visible, selectable and movable — so
 *   the mistake can actually be corrected. It is deliberately never shrunk to
 *   make it fit: silently resizing a merchant's text is a worse surprise than
 *   letting it sit outside the outline.
 *
 * `_sgpdLastValid` is gone. Nothing remembers a "last good" position any more,
 * because there is no longer a code path that would teleport back to one.
 */

import {
  zoneShapePath as defaultZoneShapePath,
  objectSamplePoints,
  pointsInsideZoneShape,
  fitInsideZoneShape,
} from './zoneContainment';
import { clampRectToZone } from './zoneRectClamp';

/** Clearance, in canvas px, kept between a settled object and the outline. */
const SETTLE_MARGIN = 1;

/**
 * Whether a zone is enforced by true shape containment rather than by its
 * bounding box: a 'restrict' zone whose boundary is an inline svg outline that
 * is not rotated (rotation is unsupported by the containment maths) and whose
 * markup actually parsed into a Path2D.
 *
 * @param {object} zone
 * @param {Function} [getShape] injected for tests (jsdom has no Path2D)
 * @returns {Path2D|null} the shape when the zone is shape-tested, else null
 */
export function zoneContainmentShape(zone, getShape = defaultZoneShapePath) {
  if (!zone || zone.behavior !== 'restrict') return null;
  if (zone.boundary_type !== 'svg' || !zone.svg_markup || zone.svg_rotation) return null;
  return getShape(zone) || null;
}

/**
 * Lenient clamp, safe to run on every frame of a drag or scale.
 *
 * Holds the object inside the zone's BOUNDING BOX only — never against the
 * outline, and never by restoring a remembered position. `clampRectToZone`
 * already leaves an axis the object cannot fit on completely free (see its
 * docblock), so an oversized object is never pinned here either.
 *
 * @param {object} obj  Fabric object (needs left/top/getBoundingRect/set/setCoords)
 * @param {object} zone the object's zone
 * @returns {boolean} whether the object was moved
 */
export function clampObjectDuringMove(obj, zone) {
  if (!obj || !zone || zone.behavior !== 'restrict') return false;

  // Fabric writes `left`/`top` on every drag frame but only refreshes the
  // cached corner coords when the transform ENDS, so getBoundingRect() here
  // would otherwise describe where the object was one or more frames ago. The
  // clamp then computes its correction from a stale box, fires only on the
  // frames that happen to be in sync, and the object drifts steadily outside
  // the zone box during a long drag (measured: it escaped 80 px past the zone
  // edge before the drop pulled it back).
  obj.setCoords();
  const bound = obj.getBoundingRect();
  const { left, top } = clampRectToZone({ objLeft: obj.left, objTop: obj.top, bound, zone });
  if (left === obj.left && top === obj.top) return false;

  obj.set({ left, top });
  obj.setCoords();
  return true;
}

/**
 * Strict containment, for the END of a gesture only (drop / scale release) and
 * for one-shot placement of a newly added object. Never call this from
 * `object:moving` — enforcing the outline mid-drag is the whole bug.
 *
 * Order of business:
 *   1. the lenient bounding-box clamp (this is all a rectangular zone gets);
 *   2. for a shape-tested zone, if the object is already inside the outline,
 *      leave it exactly where it is;
 *   3. otherwise move it — WITHOUT resizing it — to the placement nearest its
 *      current centre that fits inside the outline;
 *   4. if no such placement exists, do nothing at all and leave it movable.
 *
 * @param {object} obj  Fabric object (needs left/top/getBoundingRect/getCoords/set/setCoords)
 * @param {object} zone the object's zone
 * @param {object} [deps] injection seam for tests: { getShape, isInside }
 * @returns {'skipped'|'rect'|'inside'|'moved'|'nofit'} what was decided, for tests
 */
export function settleObjectInZone(obj, zone, deps = {}) {
  if (!obj || !zone || zone.behavior !== 'restrict') return 'skipped';

  clampObjectDuringMove(obj, zone);

  const isInside = deps.isInside || pointsInsideZoneShape;
  const shape = zoneContainmentShape(zone, deps.getShape || defaultZoneShapePath);
  if (!shape) return 'rect';

  const corners = obj.getCoords();
  const pts = objectSamplePoints(corners);
  if (pts.length && isInside(shape, zone, pts)) return 'inside';

  // The object's own axis-aligned bounding box is what we look for room for.
  // For a rotated object that is a conservative over-approximation: we may
  // conclude "nothing fits" for a tilted object that technically would — and
  // "nothing fits" means we leave it alone, which is the safe outcome.
  const bound = obj.getBoundingRect();
  const fit = fitInsideZoneShape({
    shape,
    zone,
    // Searched one pixel larger on every side, and the result shifted back by
    // that pixel. The placement search converges ON the contour, so asking for
    // the exact size lands the object hard against the outline and rounding
    // can put a corner a fraction outside it. A 1 px inset makes "inside the
    // outline after the drop" hold, at a cost nobody can see.
    width:  bound.width + SETTLE_MARGIN * 2,
    height: bound.height + SETTLE_MARGIN * 2,
    // Locking both scales to 1 asks the one shared placement routine a
    // yes/no question at the object's CURRENT size: "is there room for this,
    // as it is?". It must never come back with a smaller object.
    maxScale: 1,
    minScale: 1,
    prefer: { x: bound.left + bound.width / 2, y: bound.top + bound.height / 2 },
    isInside,
  });

  // Nothing fits at this size. Enforce nothing — the user keeps a movable
  // object they can resize or drag, instead of a pinned one they cannot.
  if (!fit) return 'nofit';

  // fit.left/top place the BOUNDING BOX; obj.left/top may sit at a constant
  // offset from it (rotation, non-default origin, stroke width), so shift by
  // the delta rather than assigning fit.left/top directly.
  obj.set({
    left: obj.left + (fit.left + SETTLE_MARGIN - bound.left),
    top:  obj.top + (fit.top + SETTLE_MARGIN - bound.top),
  });
  obj.setCoords();
  return 'moved';
}
