/**
 * Compatibility anchor for text layers. New layers set originX/originY
 * explicitly ('center') and left/top IS that anchor point — used as-is.
 * Layers saved before this convention have neither: they were authored as a
 * wide Textbox + textAlign, where `left` meant the BOX's left edge, not
 * where the glyphs sit. An auto-width IText anchored raw at that `left`
 * would shift text that was centered/right-aligned in its old box, so this
 * derives the equivalent origin/left for an auto-width IText.
 *
 * Pure — no DOM, no store lookups. Callers pass the resolved zone in rather
 * than this module looking it up, so it stays testable and usable from both
 * the Template Builder canvas and the customer Designer canvas.
 *
 * IMPORTANT — idempotence: once a layer has an explicit `originX`, this
 * function does NOT re-apply the textAlign compensation. That is what makes
 * it safe to call again on a layer that was just written back with the
 * origin the first call produced (round-tripping through an
 * `object:modified` handler that persists left/top/originX/originY must
 * yield the identical anchor on the next resolve — see
 * tests/js/utils/textAnchor.test.js for the regression this guards).
 *
 * @param {{left?:number, top?:number, originX?:string, originY?:string, textAlign?:string, width?:number}} layer
 * @param {{x:number, y:number, width:number}|null|undefined} zone parent zone, or null/undefined if none
 * @returns {{left:number, top:number, originX:string, originY:string}}
 */
export function resolveTextAnchor(layer, zone) {
  let originX = layer.originX;
  const originY = layer.originY || 'top';
  let left = layer.left ?? (zone ? zone.x + 20 : 100);
  const top = layer.top ?? (zone ? zone.y + 20 : 100);
  if (!originX) {
    const align = layer.textAlign || 'left';
    const boxWidth = layer.width || (zone ? zone.width - 20 : 200);
    originX = 'left';
    if (align === 'center')      { originX = 'center'; left += boxWidth / 2; }
    else if (align === 'right')  { originX = 'right';  left += boxWidth; }
  }
  return { left, top, originX, originY };
}
