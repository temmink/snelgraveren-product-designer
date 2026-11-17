/**
 * Capture from the LIVE canvas at the template's own logical size — ONE
 * mechanism, so no capture site can quietly grow its own rule.
 *
 * THE PROBLEM: the on-screen canvas is responsive. `useCanvasScale` gives it
 * `setZoom(scale)` and a backing store of `canvas_width * scale`. Fabric's
 * `toDataURL({ multiplier })` renders `this.width * multiplier` pixels with the
 * viewport transform folded in (StaticCanvas#toCanvasElement: `scaledWidth =
 * (width || this.width) * multiplier`, `newZoom = zoom * multiplier`). So a
 * capture straight off the live canvas produces
 *
 *     canvas_width * scale * multiplier
 *
 * pixels — the customer's WINDOW decides the resolution of what the laser cuts.
 * Two customers saving the identical design on a phone and on a 27" monitor
 * would ship different export files, and a large enough window pushes the 3x
 * PNG past the 10 MB `sanitize_export_blob` limit, where the save is REJECTED.
 *
 * THE FIX: every capture runs as if the canvas were at zoom 1 and at its
 * logical `canvas_width x canvas_height`, so the output is
 * `canvas_width * multiplier` and nothing else. That is the same geometry the
 * offscreen renders (non-active views) already produce on their own fresh
 * canvases, so active and non-active views finally agree.
 *
 * Composes with `withoutExcludedObjects` (App.jsx) and `withoutTextPlaceholders`
 * (textPlaceholder.js); this one goes OUTERMOST — it is the only wrapper that
 * touches the canvas ELEMENT (backing store, CSS size, viewport transform)
 * rather than object state, so restoring it last means the final act before the
 * customer gets control back is a full render at their own on-screen zoom.
 *
 * The restore is in `finally` for the same reason those two are: this is the
 * canvas the customer is looking at, and a throwing render must never leave
 * them staring at a resized or wrongly-zoomed plank.
 *
 * Pure Fabric, no React and no app state — the builder captures off a zoomed
 * live canvas too, and can use this without a second copy of the rule.
 */

/** Identity viewport: zoom 1, no pan. */
const IDENTITY_VPT = [1, 0, 0, 1, 0, 0];

/**
 * Run `fn` with `canvas` temporarily at zoom 1 and at `width x height`, then
 * restore the on-screen zoom, pan and dimensions.
 *
 * @param {object}   canvas  Fabric canvas (the live, on-screen one)
 * @param {number}   width   Logical canvas width  (view.canvas_width)
 * @param {number}   height  Logical canvas height (view.canvas_height)
 * @param {Function} fn      Capture to run; its return value is passed through
 * @returns {*} whatever `fn` returns
 */
export default function atLogicalCanvasSize(canvas, width, height, fn) {
  if (typeof fn !== 'function') return undefined;
  if (!canvas || typeof canvas.setDimensions !== 'function') return fn();

  const w = Number(width) > 0 ? Number(width) : canvas.getWidth();
  const h = Number(height) > 0 ? Number(height) : canvas.getHeight();

  const prevWidth = canvas.getWidth();
  const prevHeight = canvas.getHeight();
  // Clone: setViewportTransform stores the array by reference, so keeping the
  // live one would hand back a mutated copy of itself.
  const prevVpt = Array.isArray(canvas.viewportTransform)
    ? canvas.viewportTransform.slice()
    : IDENTITY_VPT.slice();

  try {
    canvas.setDimensions({ width: w, height: h });
    // setViewportTransform rather than setZoom(1): setZoom only rewrites the
    // scale entries and keeps any pan, which would offset the capture.
    canvas.setViewportTransform(IDENTITY_VPT.slice());
    canvas.renderAll();
    return fn();
  } finally {
    canvas.setDimensions({ width: prevWidth, height: prevHeight });
    canvas.setViewportTransform(prevVpt);
    canvas.renderAll();
  }
}
