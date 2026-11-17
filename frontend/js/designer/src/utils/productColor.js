import useDesignerStore from '../store/useDesignerStore';

// Painting the product itself (the fillable zone shape) in a colour.
//
// Two things choose that colour: the "Product colour" swatches in the Edit
// tab, and — when the colour is a product option — the option the customer
// picked. Both go through here so the preview, the other views and the saved
// snapshots can never disagree about what colour the product is.

/**
 * Paint the zone overlays on a live canvas.
 *
 * `editableOnly` limits it to zones the merchant marked as fill-editable: a
 * colour that arrives from a product option must never flood a zone that is
 * only an outline over a product photo.
 *
 * @returns {boolean} whether anything was painted
 */
export function paintCanvasProductColor(canvas, color, { editableOnly = false } = {}) {
  if (!canvas || !color) return false;
  let painted = false;
  canvas.getObjects().forEach((obj) => {
    if (!obj.data?.isZoneOverlay) return;
    if (editableOnly && !obj.data.svgFillEditable) return;
    const already = obj.fill === color
      && (!obj.getObjects || obj.getObjects().every((c) => c.fill === color));
    if (already) return;
    if (obj.getObjects) {
      obj.getObjects().forEach((c) => c.set({ fill: color, stroke: 'transparent', strokeWidth: 0 }));
    }
    obj.set({ fill: color });
    obj.dirty = true;
    painted = true;
  });
  if (painted) canvas.renderAll();
  return painted;
}

/**
 * Give the stored snapshots of the OTHER views the same colour — a product
 * is one colour, front and back.
 */
export function paintOtherViewSnapshots(color, currentViewIndex, { editableOnly = false } = {}) {
  const { canvasSnapshots, snapshotView } = useDesignerStore.getState();
  Object.entries(canvasSnapshots).forEach(([viewIdx, snap]) => {
    if (Number(viewIdx) === currentViewIndex || !snap?.objects) return;
    let changed = false;
    const objects = snap.objects.map((obj) => {
      // Only zone overlay groups, not clip art or other groups.
      const isOverlay = (obj.type === 'Group' || obj.type === 'group') && obj.data?.isZoneOverlay;
      if (!isOverlay || (editableOnly && !obj.data.svgFillEditable)) return obj;
      changed = true;
      return {
        ...obj,
        fill: color,
        objects: (obj.objects || []).map((c) => ({ ...c, fill: color, stroke: 'transparent', strokeWidth: 0 })),
      };
    });
    if (changed) snapshotView(Number(viewIdx), { ...snap, objects });
  });
}
