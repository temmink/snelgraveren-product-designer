import { useEffect, useRef } from 'react';

/**
 * How far past its own logical size the canvas may be blown up.
 *
 * WHY 2, and not "as much as fits": a template's background photo is around
 * 800 px wide against a canvas of 600–800 px logical, so past roughly 2x the
 * background goes visibly soft. A big blurry plank looks worse than a smaller
 * sharp one. Filling the window is a comfort feature, not a quality one — the
 * export is rendered from the design at its logical size either way
 * (shared/js/atLogicalCanvasSize.js), so nothing about what the laser cuts
 * depends on this number.
 */
export const MAX_SCALE = 2;

/**
 * The zoom to show the canvas at: as large as the space allows, never past
 * MAX_SCALE, and never taller than the room it has.
 *
 * Pure, so the sizing rule can be tested without a browser.
 *
 * @returns {number|null} the scale, or null when there is nothing to size against
 */
export function computeCanvasScale({
  availableWidth,
  availableHeight,
  canvasWidth,
  canvasHeight,
  maxScale = MAX_SCALE,
}) {
  if (!(canvasWidth > 0) || !(canvasHeight > 0)) return null;
  if (!(availableWidth > 0)) return null;

  const scaleByWidth = availableWidth / canvasWidth;
  const scaleByHeight = availableHeight > 0 ? availableHeight / canvasHeight : Infinity;

  return Math.min(maxScale, scaleByWidth, scaleByHeight);
}

/**
 * Width the container's own frame takes away from the canvas.
 *
 * The canvas sits inside a bordered, scrollable box (`.pf-canvas-scroll`), and
 * that border is part of the container's width but not room the canvas can
 * use. Without subtracting it a canvas sized to "exactly fit" overflows its box
 * by the border and the customer gets a scrollbar down each side of a design
 * that fits. Read from the DOM rather than hard-coded, so it cannot drift away
 * from designer.css.
 */
function frameWidth(el) {
  const box = el.firstElementChild;
  if (!box) return 0;
  const cs = window.getComputedStyle(box);
  return (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
}

/**
 * Observe a container element and apply responsive zoom directly to a
 * Fabric.js canvas — no React state in the loop, so resizes are instant
 * with no visible "grow/shrink" animation between frames.
 *
 * @param {number} canvasWidth   Logical canvas width  (e.g. 800)
 * @param {number} canvasHeight  Logical canvas height (e.g. 600)
 * @param {React.MutableRefObject} fabricRef  Ref to the Fabric.js canvas instance
 *
 * IMPORTANT: Do NOT use CSS transform to scale the canvas.
 * Fabric.js calculates pointer positions from the DOM element's bounding rect.
 * A CSS transform on a parent causes pointer position mismatch.
 *
 * WHAT IS MEASURED, AND WHY NOT THE OBVIOUS THING:
 *
 *   Width comes from the container, which is honest only because
 *   `.pf-canvas-cell` / `.pf-canvas-grid` carry `min-width: 0` (designer.css).
 *   Without that a grid item's automatic minimum size is its min-content — the
 *   canvas's own current width — so the "available width" would be a floor set
 *   by the thing being sized. It could never report less than the canvas
 *   already is (hence no shrinking to fit), and it would report slightly MORE
 *   after every pass, so with a ceiling above 1 the canvas would creep up to
 *   MAX_SCALE on every window, one ResizeObserver frame at a time.
 *
 *   Height comes from the WINDOW, not from the container, for the same reason:
 *   in the product-page layout every box between the canvas and the page is
 *   auto-height, so the container's height IS the canvas's height plus a
 *   border. Feeding that back would be the same creep. The window is the real
 *   vertical limit a customer feels anyway — a canvas taller than the screen
 *   cannot be seen while it is being worked on.
 */
export default function useCanvasScale(canvasWidth, canvasHeight, fabricRef) {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !canvasWidth || !canvasHeight) return;

    const applyScale = () => {
      const canvas = fabricRef?.current;
      if (!canvas) return;

      const scale = computeCanvasScale({
        availableWidth: el.clientWidth - frameWidth(el),
        availableHeight: window.innerHeight || document.documentElement.clientHeight,
        canvasWidth,
        canvasHeight,
      });
      if (scale === null) return;

      // Already there: skip the work rather than re-render on every scroll-bar
      // twitch the observer reports.
      if (canvas.getZoom() === scale && canvas.getWidth() === canvasWidth * scale) return;

      canvas.setZoom(scale);
      canvas.setDimensions({
        width: canvasWidth * scale,
        height: canvasHeight * scale,
      });
      canvas.renderAll();
    };

    const ro = new ResizeObserver(applyScale);
    ro.observe(el);
    // The container's own box does not change when only the window's HEIGHT
    // does, and the height bound above is the window's — so listen for that too.
    window.addEventListener('resize', applyScale);
    applyScale();

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', applyScale);
    };
  }, [canvasWidth, canvasHeight, fabricRef]);

  return { containerRef };
}
