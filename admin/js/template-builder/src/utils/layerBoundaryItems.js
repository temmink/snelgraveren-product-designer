/**
 * Intrinsic pixel size of an inline <svg> string. Prefers the root <svg>'s
 * width/height attributes; falls back to the viewBox's w/h. Returns zeros when
 * neither is parseable.
 * @param {string} svgMarkup
 * @returns {{width:number,height:number}}
 */
export function svgMarkupIntrinsicSize(svgMarkup) {
  const s = String(svgMarkup || '');
  const wm = s.match(/<svg[^>]*\bwidth="([\d.]+)"/i);
  const hm = s.match(/<svg[^>]*\bheight="([\d.]+)"/i);
  let width = wm ? parseFloat(wm[1]) : 0;
  let height = hm ? parseFloat(hm[1]) : 0;
  if (!width || !height) {
    const vb = s.match(/viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)"/i);
    if (vb) {
      width = width || parseFloat(vb[1]);
      height = height || parseFloat(vb[2]);
    }
  }
  return { width: width || 0, height: height || 0 };
}

/**
 * Build a mergeLayersToBoundary item from a stored svg layer descriptor.
 * The layer's own left/top are already canvas-absolute; on-canvas size is the
 * intrinsic size scaled by the layer's scaleX/scaleY. Returns null when the
 * layer carries no inline geometry or its size can't be parsed.
 * @param {object} layer
 * @returns {{svgMarkup:string,left:number,top:number,width:number,height:number,scaleX:number,scaleY:number}|null}
 */
export function layerToBoundaryItem(layer) {
  if (!layer || !layer.svg_markup) return null;
  const { width: iw, height: ih } = svgMarkupIntrinsicSize(layer.svg_markup);
  if (!iw || !ih) return null;
  const scaleX = layer.scaleX || 1;
  const scaleY = layer.scaleY || 1;
  return {
    svgMarkup: layer.svg_markup,
    left: layer.left || 0,
    top: layer.top || 0,
    width: iw * scaleX,
    height: ih * scaleY,
    scaleX,
    scaleY,
  };
}
