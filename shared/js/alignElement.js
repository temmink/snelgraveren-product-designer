/**
 * Align a Fabric.js object within its zone boundaries.
 *
 * @param {fabric.Object} obj   – The Fabric object to align.
 * @param {string}         dir  – One of: 'left', 'center', 'right', 'top', 'middle', 'bottom'.
 * @param {object}         zone – Zone config with { x, y, width, height }.
 */
export function alignElement(obj, dir, zone) {
  if (!obj || !zone) return;

  const bound = obj.getBoundingRect();
  // Offsets between the object's origin (left/top) and the bounding rect.
  const offsetX = obj.left - bound.left;
  const offsetY = obj.top  - bound.top;

  switch (dir) {
    case 'left':
      obj.set({ left: zone.x + offsetX });
      break;
    case 'center':
      obj.set({ left: zone.x + (zone.width - bound.width) / 2 + offsetX });
      break;
    case 'right':
      obj.set({ left: zone.x + zone.width - bound.width + offsetX });
      break;
    case 'top':
      obj.set({ top: zone.y + offsetY });
      break;
    case 'middle':
      obj.set({ top: zone.y + (zone.height - bound.height) / 2 + offsetY });
      break;
    case 'bottom':
      obj.set({ top: zone.y + zone.height - bound.height + offsetY });
      break;
  }

  obj.setCoords();
}
