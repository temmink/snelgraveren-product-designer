import { loadSVGFromString, util } from 'fabric';

/**
 * Normalize an SVG string by converting mm/cm/in units in width/height to px.
 */
function normalizeSvgUnits(svgString) {
  return svgString.replace(
    /(<svg[^>]*?(?:width|height)="\s*)([\d.]+)\s*(mm|cm|in)\s*(")/g,
    (_, before, val, unit, after) => {
      const scale = unit === 'mm' ? 3.7795 : unit === 'cm' ? 37.795 : 96;
      return before + (parseFloat(val) * scale).toFixed(2) + after;
    }
  );
}

/**
 * Load an SVG string through Fabric's parser, returning properly transformed
 * objects and the computed bounding box in pixels.
 *
 * Returns { objects, options, width, height } or null on failure.
 */
export async function parseSvgToFabric(svgString) {
  const normalized = normalizeSvgUnits(svgString);
  const { objects, options } = await loadSVGFromString(normalized);
  const filtered = objects.filter(Boolean);
  if (filtered.length === 0) return null;

  const group = util.groupSVGElements(filtered, options);
  return {
    objects: filtered,
    options,
    group,
    width: Math.round(group.width * (group.scaleX || 1)),
    height: Math.round(group.height * (group.scaleY || 1)),
  };
}

/**
 * Extract SVG markup and compute pixel bounding box.
 * Returns { svgString, width, height } or null.
 */
export async function extractSvgBoundingBox(svgString) {
  const result = await parseSvgToFabric(svgString);
  if (!result) return null;
  return { width: result.width, height: result.height };
}

