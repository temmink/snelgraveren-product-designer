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
 * Transform a path `d` string's coordinates by (newX = dx + x*sx, newY = dy + y*sy).
 *
 * ONLY absolute `M`, `L`, `C`, `Z` are supported — that is the complete set of
 * commands `lbrnParser.js` (the sole producer of `layer.svg_markup` in this
 * codebase) ever emits, all with absolute, uppercase coordinates. M and L take
 * one (x,y) pair, C takes three (x,y) pairs, Z takes none. Relative commands
 * and H/V/Q/S/T/A are NOT transformed — out of scope for v1 since no producer
 * emits them into `svg_markup`. If one is encountered, its segment is passed
 * through untransformed (best-effort) rather than throwing.
 *
 * @param {string} d
 * @param {number} dx
 * @param {number} dy
 * @param {number} sx
 * @param {number} sy
 * @returns {string}
 */
export function transformPathData(d, dx, dy, sx, sy) {
  const cmdRe = /([A-Za-z])([^A-Za-z]*)/g;
  let out = '';
  let match;
  while ((match = cmdRe.exec(String(d || ''))) !== null) {
    const cmd = match[1];
    const numsStr = match[2];
    const upper = cmd.toUpperCase();

    if (upper === 'Z') {
      out += cmd;
      continue;
    }

    if (upper !== 'M' && upper !== 'L' && upper !== 'C') {
      // Unsupported command — best-effort passthrough, not our contract.
      out += cmd + numsStr;
      continue;
    }

    const nums = (numsStr.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || []).map(Number);
    const transformed = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      transformed.push(n(dx + nums[i] * sx), n(dy + nums[i + 1] * sy));
    }
    out += cmd + transformed.join(' ');
  }
  return out;
}

/**
 * Merge selected vector layers into one standalone inline SVG boundary plus
 * its canvas-space bounding box.
 *
 * Each item's path coordinates are baked directly into union-local
 * coordinates (translate by (left-minX, top-minY), scale by (scaleX, scaleY))
 * via `transformPathData`, and emitted as plain `<path>` elements with no
 * wrapping `<g transform>`. This matters because Fabric.js's
 * `loadSVGFromString`+`groupSVGElements` behaves differently for a single
 * path vs. multiple: a single `<path>` returns one object whose
 * `scaleX`/`scaleY` would carry a `<g scale(...)>` transform while `width`
 * stays the UNSCALED path extent — the zone renderer then overwrites
 * `scaleX` with `svg_scale` (1), silently discarding the intended scale and
 * rendering at intrinsic size. Multiple paths get wrapped in a Group with
 * scaleX=1, which happened to work before. Baking the transform into the
 * coordinates themselves means the resulting group/object always has
 * scaleX=1 regardless of path count, so the renderer's `scaleX: svg_scale(1)`
 * is correct for both cases and no render-code change is needed.
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

  const allPaths = withPaths.map((i) => {
    const dx = n(i.left - minX);
    const dy = n(i.top - minY);
    const sx = n(i.scaleX || 1);
    const sy = n(i.scaleY || 1);
    return i.paths
      .map((d) => `<path d="${transformPathData(d, dx, dy, sx, sy)}" fill="none"/>`)
      .join('');
  }).join('');

  const svg_markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `
    + `viewBox="0 0 ${width} ${height}">${allPaths}</svg>`;

  return { svg_markup, x: n(minX), y: n(minY), width, height };
}
