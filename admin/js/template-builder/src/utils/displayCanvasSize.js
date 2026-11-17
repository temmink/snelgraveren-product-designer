/**
 * Pick the on-screen canvas size (integer pixels) for an imported design.
 *
 * A view stores its physical size as `width_mm` only. The HEIGHT in
 * millimetres is derived everywhere else from the canvas pixel aspect ratio —
 * `Export\PremiumExports` computes `height_mm = width_mm * h_px / w_px` for the
 * PDF page and the SVG mm units, and ViewTabs shows the same number as a hint.
 * The pixel ratio is therefore not a display detail: it lands directly in the
 * exported millimetres, on a plugin whose users engrave to the millimetre.
 *
 * A `<canvas>` cannot help here: `HTMLCanvasElement.width` is an integer, so a
 * fractional size is silently truncated and Fabric's model would disagree with
 * its own backing store. The ratio has to be approximated by a pair of
 * integers, and simply rounding both sides of a fixed 600 px long edge is a
 * poor approximation: a 400 × 193 mm LightBurn file wants 600 × 289.5 px,
 * rounds to 600 × 290, and reports its height back as 193.33 mm.
 *
 * So instead of fixing the long edge and accepting whatever the short edge
 * rounds to, scan long edges from the target upwards and keep the first pair
 * whose ratio is closest to the true one. Scanning ascending with a strict
 * improvement test means the smallest — and so the closest to the target —
 * of any equally good candidates wins, and a design whose ratio is already
 * exact at the target (2:1, 4:3, square …) never grows at all. The 400 × 193
 * case becomes 800 × 386 px, which is exactly 193.00 mm.
 *
 * The window only ever grows the canvas, never shrinks it below the
 * comfortable working size the import aims for.
 */

export const DISPLAY_TARGET_PX = 600;

/** How far above the target the search may go, as a multiple of it. */
const MAX_GROWTH = 2;

/**
 * @param {number} natW Natural (physical) width, any unit — only the ratio matters.
 * @param {number} natH Natural (physical) height, same unit as natW.
 * @param {number} targetPx Preferred length of the design's longer edge, in px.
 * @returns {{width: number, height: number, scale: number}} Integer canvas size,
 *   plus the scale factor from natural units to those pixels. `scale` is what
 *   the caller must apply to every layer's position and size.
 */
export function displayCanvasSize(natW, natH, targetPx = DISPLAY_TARGET_PX) {
  const w = Number(natW) > 0 ? Number(natW) : 1;
  const h = Number(natH) > 0 ? Number(natH) : 1;

  const long  = Math.max(w, h);
  const short = Math.min(w, h);
  const ratio = short / long;

  const from = Math.max(1, Math.round(targetPx));
  const to   = from * MAX_GROWTH;

  const shortAt = (L) => Math.round(L * ratio);

  let bestLong = from;
  let bestShort = Math.max(1, shortAt(from));
  // A short edge that rounds to zero cannot express the ratio at all — it gets
  // clamped to a single pixel, so its "error" says nothing. Treat that as no
  // candidate yet, so a longer edge that DOES land on a real pixel wins; and
  // if none in the window does (a needle-thin design), the target size stands
  // instead of the canvas growing for no gain.
  let bestErr = shortAt(from) >= 1 ? Math.abs(bestShort / bestLong - ratio) : Infinity;

  for (let L = from + 1; L <= to && bestErr > 0; L++) {
    const S = shortAt(L);
    if (S < 1) continue;
    const err = Math.abs(S / L - ratio);
    // Strictly better only: ties keep the earlier (smaller) candidate, which
    // is the one closest to the caller's target size.
    if (err < bestErr - 1e-12) {
      bestLong = L;
      bestShort = S;
      bestErr = err;
    }
  }

  return w >= h
    ? { width: bestLong,  height: bestShort, scale: bestLong / w }
    : { width: bestShort, height: bestLong,  scale: bestLong / h };
}

export default displayCanvasSize;
