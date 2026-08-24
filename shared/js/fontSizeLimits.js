/**
 * Convert a template's minimum font size from millimetres to canvas pixels.
 *
 * The minimum is authored in millimetres because engraving legibility is a
 * physical property: 18px means a different real size on a 40mm tag than on a
 * 300mm board. The conversion is per view, since width_mm is a per-view column.
 *
 * Returns 0 — meaning "no minimum" — when the template sets none or when the
 * view has no physical width to convert against.
 *
 * @param {{minFontSizeMm?:number, canvasWidth?:number, widthMm?:number}} opts
 * @returns {number} minimum font size in canvas pixels
 */
export function minFontSizePx({ minFontSizeMm, canvasWidth, widthMm }) {
  const mm = Number(minFontSizeMm) || 0;
  const cw = Number(canvasWidth) || 0;
  const wmm = Number(widthMm) || 0;
  if (mm <= 0 || cw <= 0 || wmm <= 0) return 0;
  return mm * (cw / wmm);
}
