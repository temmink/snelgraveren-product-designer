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

/**
 * Floor for a font-size NUMBER INPUT, in whole canvas pixels.
 *
 * Rounded UP: a stored size must never sit a fraction below the millimetre
 * minimum just because the mm→px conversion landed between two integers.
 * Falls back to `fallback` (8px, the historic hard floor of both size inputs)
 * when the template sets no minimum, so a template without a minimum keeps
 * behaving exactly as it always did.
 *
 * Used by BOTH size inputs — the customer's ElementTab and the merchant's
 * TreePanel. The merchant's input used to carry a hardcoded min="8" while the
 * customer's derived its floor from the template: same rule, two places, and
 * they disagreed. One helper, two call sites.
 *
 * @param {{minFontSizeMm?:number, canvasWidth?:number, widthMm?:number, fallback?:number}} opts
 * @returns {number} floor in whole canvas pixels
 */
export function fontSizeInputFloorPx({ minFontSizeMm, canvasWidth, widthMm, fallback = 8 }) {
  const fb = Number(fallback) || 0;
  return Math.max(fb, Math.ceil(minFontSizePx({ minFontSizeMm, canvasWidth, widthMm })));
}

/**
 * The `minScaleLimit` a text object needs so its CORNER HANDLES cannot drag it
 * below the template's millimetre minimum.
 *
 * Fabric's corner handles change scaleY/scaleX, not fontSize, so the effective
 * rendered size is `fontSize * scaleY`. Clamping the size input alone leaves
 * the handles as an open door under the minimum — which is exactly the hole
 * the merchant's builder had while the customer's designer did not.
 *
 * Returns null when no floor applies (no template minimum, no physical view
 * width, or an object with no usable fontSize such as engraving text, whose
 * size lives in data.engravingFontSize and is clamped separately). Callers
 * must leave minScaleLimit untouched on null rather than resetting it — a
 * `perms.min_scale` set elsewhere still stands.
 *
 * NOTE: this only constrains INTERACTIVE scaling. It never resizes an object
 * that is already below the minimum, which is deliberate: opening a template
 * that contains sub-minimum text must not silently rewrite that text.
 *
 * @param {object} opts
 * @param {number} [opts.minFontSizeMm] template minimum in millimetres
 * @param {number} [opts.canvasWidth]   the view's canvas width in px
 * @param {number} [opts.widthMm]       the view's physical width in mm
 * @param {number} [opts.fontSize]      the object's own fontSize
 * @param {number} [opts.minScale]      an existing per-element min_scale, if any
 * @returns {number|null} minScaleLimit to set, or null for "no floor applies"
 */
export function textMinScaleLimit({ minFontSizeMm, canvasWidth, widthMm, fontSize, minScale }) {
  const minPx = minFontSizePx({ minFontSizeMm, canvasWidth, widthMm });
  const size = Number(fontSize) || 0;
  if (minPx <= 0 || size <= 0) return null;
  return Math.max(Number(minScale) || 0, minPx / size);
}

/**
 * Clamp a font size a user typed into a size input.
 *
 * `floor` wins over `max`. A template minimum can legitimately exceed the
 * input's convenience cap (a 10mm minimum on a 20mm-wide tag converts to more
 * pixels than the 200px cap), and a clamp that then pinned the value at the
 * cap would leave the user permanently below the minimum with no way to reach
 * it — the same "constraint with no escape" failure as the zone clamp fix in
 * shared/js/zoneRectClamp.js. So the effective ceiling is max(floor, max).
 *
 * A non-numeric / non-positive entry falls back to `fallback` (the value the
 * field held before), so clearing the box never writes a 0.
 *
 * Used by the customer's ElementTab size inputs and the merchant's TreePanel
 * size input — one clamp, every size input.
 *
 * @param {object} opts
 * @param {string|number} opts.value  the raw entry
 * @param {number} opts.floor         minimum, from fontSizeInputFloorPx()
 * @param {number} [opts.max]         convenience cap (200 for text, 120 for engraving)
 * @param {number} [opts.fallback]    used when `value` is not a usable number
 * @returns {number} the clamped size
 */
export function clampFontSizePx({ value, floor, max = 200, fallback = 0 }) {
  const parsed = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  const fb = Number(fallback) || 0;
  const usable = (Number.isFinite(parsed) && parsed > 0) ? parsed : fb;
  const lo = Math.max(0, Number(floor) || 0);
  const hi = Math.max(lo, Number(max) || 0);
  return Math.min(hi, Math.max(lo, usable));
}
