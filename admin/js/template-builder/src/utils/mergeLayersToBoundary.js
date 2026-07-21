/** Round to 3 decimals and strip trailing zeros. */
const n = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Number.isFinite(r) ? r : 0;
};

/** Extract the `d` value of every <path> in an SVG markup string. */
function extractPathData(svgMarkup) {
  const out = [];
  const re = /<path\b[^>]*\bd="([^"]*)"/g;
  let m;
  while ((m = re.exec(String(svgMarkup || ''))) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/**
 * Merge selected vector layers into one standalone inline SVG boundary plus
 * its canvas-space bounding box.
 *
 * Each item's paths are wrapped in a `<g transform="translate(dx dy) scale(sx sy)">`
 * so no path-coordinate math is needed — the group transform maps the layer's
 * local path coordinates into the union-local frame (bbox top-left = 0,0). The
 * boundary is later rendered at left=x, top=y, scale=1, reproducing the union.
 *
 * @param {Array<{svgMarkup:string,left:number,top:number,width:number,height:number,scaleX:number,scaleY:number}>} items
 * @returns {{svg_markup:string,x:number,y:number,width:number,height:number}|null}
 */
export function mergeLayersToBoundary(items) {
  const withPaths = (items || [])
    .filter((it) => it && it.svgMarkup)
    .map((it) => ({ ...it, paths: extractPathData(it.svgMarkup) }))
    .filter((it) => it.paths.length > 0);

  if (!withPaths.length) return null;

  const minX = Math.min(...withPaths.map((i) => i.left));
  const minY = Math.min(...withPaths.map((i) => i.top));
  const maxX = Math.max(...withPaths.map((i) => i.left + i.width));
  const maxY = Math.max(...withPaths.map((i) => i.top + i.height));
  const width = n(maxX - minX);
  const height = n(maxY - minY);

  const groups = withPaths.map((i) => {
    const dx = n(i.left - minX);
    const dy = n(i.top - minY);
    const sx = n(i.scaleX || 1);
    const sy = n(i.scaleY || 1);
    const paths = i.paths.map((d) => `<path d="${d}" fill="none"/>`).join('');
    return `<g transform="translate(${dx} ${dy}) scale(${sx} ${sy})">${paths}</g>`;
  }).join('');

  const svg_markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `
    + `viewBox="0 0 ${width} ${height}">${groups}</svg>`;

  return { svg_markup, x: n(minX), y: n(minY), width, height };
}
