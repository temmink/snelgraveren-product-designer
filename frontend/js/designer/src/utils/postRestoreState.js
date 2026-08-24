// Infer element type from Fabric object type when data.elementType is missing
// (e.g. designs saved before data serialisation was added).
export function inferElementType(obj) {
  if (obj.data?.elementType) return obj.data.elementType;
  const t = (obj.type || '').toLowerCase();
  if (t === 'textbox' || t === 'itext' || t === 'i-text') return 'text';
  if (t === 'image') return 'image';
  if (t === 'path' || t === 'group') return 'svg';
  return 'unknown';
}

// Re-apply post-restore interactivity state after ANY canvas.loadFromJSON()
// restore — view switch, undo/redo, or a ?pf_design=HASH reload. Fabric 6
// never serializes minScaleLimit / hasControls / selectable / evented /
// lockMovementX/Y, so every loadFromJSON call hands objects back with
// Fabric's interactive defaults regardless of the template's permissions or
// the per-layer lock state that was in effect before the snapshot was taken.
//
// Shared by DesignerCanvas's own restore path and useCanvasHistory's
// undo/redo restore (`applySnapshot`) — a second, independent copy of this
// logic is exactly how earlier defects on this branch crept in (the
// drag-handle floor and lock state silently not surviving Ctrl+Z).
//
// `applyPermissions(obj, elementType)` is supplied by the caller (it closes
// over template state — `permissions`, `canvasWidth`, `widthMm` — that lives
// in the DesignerCanvas component, not here) and MUST only ever set
// interactivity flags (hasControls / control visibility / minScaleLimit) —
// NEVER geometry (left/top/scaleX/scaleY/angle/fontSize). Retro-modifying a
// saved customer design is forbidden; this function does not touch geometry
// either, only the two interactivity loops below.
//
// Ordering is load-bearing: the lock-enforcement loop runs LAST because lock
// is the stronger constraint — a locked layer must never end up with
// controls handed back to it by the permissions re-apply that runs first.
export function reapplyPostRestoreState(canvas, applyPermissions) {
  // 1) Re-apply permissions (minScaleLimit / hasControls / mtr visibility)
  //    to every non-locked, non-template-art object. Keys off
  //    data.elementType when present, falling back to inferElementType()
  //    for legacy designs saved before `data` serialisation existed — those
  //    objects carry no `data` at all and would otherwise get no floor.
  canvas.getObjects().forEach((obj) => {
    if (obj.data?.templateArt || obj.data?.templateLocked === true) return;
    const et = obj.data?.elementType || inferElementType(obj);
    if (et === 'text' || et === 'curved-text' || et === 'engraving-text') {
      applyPermissions(obj, 'text');
    } else if (et === 'svg' || et === 'image') {
      applyPermissions(obj, et);
    }
  });

  // 2) Re-enforce lock state. Runs LAST so lock state always wins over the
  //    permissions re-apply above. The unlock branch restores movement and
  //    selection interactivity only — it must NOT assert hasControls: true,
  //    which would clobber a perms.resize === false the loop above just set
  //    (live template 4's svg layer: resize=false must keep hasControls
  //    false through every restore, not just the first one).
  canvas.getObjects().forEach((obj) => {
    if (obj.data?.templateArt || obj.data?.templateLocked === true) {
      obj.set({ selectable: false, evented: false, hasControls: false, lockMovementX: true, lockMovementY: true });
    } else if (obj.data?.templateLocked === false) {
      obj.set({ selectable: true, evented: true, lockMovementX: false, lockMovementY: false });
    }
  });
}
