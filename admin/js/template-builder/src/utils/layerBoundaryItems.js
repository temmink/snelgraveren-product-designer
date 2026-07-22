import { cubicExtrema } from './lbrnParser';
import { transformPathData } from './mergeLayersToBoundary';

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

/**
 * Exact bbox of an absolute M/L/C/Z path `d` string, including cubic-bezier
 * extrema (the same math that positions imported shapes — endpoints alone
 * miss curve overshoot). Only the command set our own producers emit is
 * supported; anything else in `d` is skipped. Returns null when no
 * coordinates are found.
 * @param {string} d
 * @returns {{minX:number,minY:number,width:number,height:number}|null}
 */
export function pathDataBBox(d) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const accX = (v) => { if (v < minX) minX = v; if (v > maxX) maxX = v; };
  const accY = (v) => { if (v < minY) minY = v; if (v > maxY) maxY = v; };
  const re = /([MLC])([^MLCZ]*)/gi;
  let cx = 0, cy = 0, m;
  while ((m = re.exec(String(d || ''))) !== null) {
    const cmd = m[1].toUpperCase();
    const nums = (m[2].match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || []).map(Number);
    if (cmd === 'M' || cmd === 'L') {
      for (let i = 0; i + 1 < nums.length; i += 2) { cx = nums[i]; cy = nums[i + 1]; accX(cx); accY(cy); }
    } else { // C
      for (let i = 0; i + 5 < nums.length; i += 6) {
        const [x1, y1, x2, y2, x, y] = nums.slice(i, i + 6);
        accX(cx); accX(x);
        cubicExtrema(cx, x1, x2, x).forEach(accX);
        accY(cy); accY(y);
        cubicExtrema(cy, y1, y2, y).forEach(accY);
        cx = x; cy = y;
      }
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Split an svg layer's inline markup into per-<path> boundary entries, so a
 * single shape inside a merged LightBurn group can be used as a boundary.
 * Each entry carries:
 *  - `bbox`: the path's exact local bbox (markup/viewBox coordinates)
 *  - `item`: a canvas-space mergeLayersToBoundary item for JUST this path
 *    (path data rebased to its own bbox origin, position/size mapped through
 *    the layer's left/top/scale)
 *  - `thumbMarkup`: the ORIGINAL path element (stroke colour intact) in a
 *    tight-viewBox <svg> for checklist thumbnails
 * @param {object} layer
 * @returns {Array<{d:string,bbox:object,item:object,thumbMarkup:string}>}
 */
export function layerSubPathItems(layer) {
  if (!layer || !layer.svg_markup) return [];
  const scaleX = layer.scaleX || 1;
  const scaleY = layer.scaleY || 1;
  const left = layer.left || 0;
  const top = layer.top || 0;
  const tags = String(layer.svg_markup).match(/<path\b[^>]*\/?>/gi) || [];
  const out = [];
  tags.forEach((tag) => {
    const dm = tag.match(/\bd="([^"]*)"/);
    if (!dm || !dm[1]) return;
    const bbox = pathDataBBox(dm[1]);
    if (!bbox) return;
    const w = Math.max(bbox.width, 0.01);
    const h = Math.max(bbox.height, 0.01);
    const shifted = transformPathData(dm[1], -bbox.minX, -bbox.minY, 1, 1);
    out.push({
      d: dm[1],
      bbox,
      thumbMarkup:
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bbox.minX} ${bbox.minY} ${w} ${h}">${tag}</svg>`,
      item: {
        svgMarkup:
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
          + `<path d="${shifted}" fill="none"/></svg>`,
        left: left + bbox.minX * scaleX,
        top: top + bbox.minY * scaleY,
        width: bbox.width * scaleX,
        height: bbox.height * scaleY,
        scaleX,
        scaleY,
      },
    });
  });
  return out;
}
