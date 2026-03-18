import { Path } from 'fabric';

/**
 * Extract a single closed path from an SVG string.
 * Returns { pathData, viewBox } or null if no valid path found.
 */
export function extractClosedPath(svgString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');

  // Check for parse errors.
  const parseError = doc.querySelector('parsererror');
  if (parseError) return null;

  const svgEl = doc.querySelector('svg');
  const viewBox = svgEl?.getAttribute('viewBox') || '';

  const paths = doc.querySelectorAll('path');
  for (const pathEl of paths) {
    const d = (pathEl.getAttribute('d') || '').trim();
    if (!d) continue;

    // Must be a single closed subpath: exactly one M/m command, ends with Z/z.
    const moveMatches = d.match(/[Mm]/g);
    if (!moveMatches || moveMatches.length !== 1) continue;
    if (!/[Zz]\s*$/.test(d)) continue;

    return { pathData: d, viewBox };
  }

  return null;
}

/**
 * Compute the axis-aligned bounding box of a path with transforms applied.
 * Uses a temporary Fabric.js Path object.
 */
export function pathToBoundingBox(pathData, scale = 1, rotation = 0) {
  const tempPath = new Path(pathData, {
    left: 0,
    top: 0,
    scaleX: scale,
    scaleY: scale,
    angle: rotation,
  });

  const bound = tempPath.getBoundingRect();
  return {
    x: Math.round(bound.left),
    y: Math.round(bound.top),
    width: Math.round(bound.width),
    height: Math.round(bound.height),
  };
}
