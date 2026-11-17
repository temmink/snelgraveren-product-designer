// Where a newly added element goes so it does not land on top of one that is
// already there.
//
// New text used to be dropped on the centre of the zone, always. A template
// that already carries a text there ("NAAM HOND") got the new one stacked
// straight over it: two unreadable lines, and a click that selects whichever
// box happens to be on top.

const overlaps = (a, b) =>
  a.left < b.left + b.width && b.left < a.left + a.width
  && a.top < b.top + b.height && b.top < a.top + a.height;

const inside = (r, area) =>
  r.left >= area.left && r.top >= area.top
  && r.left + r.width <= area.left + area.width
  && r.top + r.height <= area.top + area.height;

/**
 * @param {{width:number,height:number}} size      the new element
 * @param {{left:number,top:number,width:number,height:number}} area  where it may go
 * @param {Array<{left:number,top:number,width:number,height:number}>} occupied
 * @param {number} gap  breathing room between elements
 * @returns {{x:number,y:number}} centre point for the new element
 *
 * Tries the centre of the area first, then the rows below and above it in
 * turn. When nothing is free (a full design, an area too small) it returns
 * the centre: an overlapping element the customer can drag beats one placed
 * outside the area.
 */
export function findFreeSpot(size, area, occupied = [], gap = 8) {
  const cx = area.left + area.width / 2;
  const cy = area.top + area.height / 2;
  const rectAt = (y) => ({
    left: cx - size.width / 2,
    top: y - size.height / 2,
    width: size.width,
    height: size.height,
  });
  const padded = occupied.map((r) => ({
    left: r.left - gap, top: r.top - gap,
    width: r.width + gap * 2, height: r.height + gap * 2,
  }));
  const free = (y) => {
    const r = rectAt(y);
    return inside(r, area) && !padded.some((o) => overlaps(r, o));
  };

  if (free(cy)) return { x: cx, y: cy };

  const step = Math.max(4, Math.min(size.height / 2, 12));
  const reach = area.height / 2;
  for (let d = step; d <= reach; d += step) {
    if (free(cy + d)) return { x: cx, y: cy + d };
    if (free(cy - d)) return { x: cx, y: cy - d };
  }
  return { x: cx, y: cy };
}
