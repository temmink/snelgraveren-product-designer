import { useEffect, useRef } from 'react';

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
 */
export default function useCanvasScale(canvasWidth, canvasHeight, fabricRef) {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !canvasWidth || !canvasHeight) return;

    const applyScale = () => {
      const canvas = fabricRef?.current;
      if (!canvas) return;

      const availableWidth = el.clientWidth;
      if (availableWidth <= 0) return;

      const scaleByWidth = availableWidth / canvasWidth;

      const availableHeight = el.clientHeight;
      let scaleByHeight = Infinity;
      if (availableHeight > 0) {
        scaleByHeight = availableHeight / canvasHeight;
      }

      const scale = Math.min(1, scaleByWidth, scaleByHeight);

      canvas.setZoom(scale);
      canvas.setDimensions({
        width: canvasWidth * scale,
        height: canvasHeight * scale,
      });
      canvas.renderAll();
    };

    const ro = new ResizeObserver(applyScale);
    ro.observe(el);
    applyScale();

    return () => ro.disconnect();
  }, [canvasWidth, canvasHeight, fabricRef]);

  return { containerRef };
}
