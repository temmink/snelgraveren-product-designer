import { useState, useEffect, useRef } from 'react';

/**
 * Observe a container element and return the scale factor needed
 * to fit a canvas of `canvasWidth` × `canvasHeight` into the container.
 * Returns { scale, containerRef } where containerRef is attached to the wrapper div.
 *
 * Fits to whichever dimension is more constrained (width or height),
 * so the full canvas is always visible without scrolling.
 *
 * IMPORTANT: Do NOT use CSS transform to scale the canvas.
 * Fabric.js calculates pointer positions from the DOM element's bounding rect.
 * A CSS transform on a parent causes pointer position mismatch.
 * Instead, apply the returned scale via canvas.setZoom() + canvas.setDimensions(cssOnly).
 */
export default function useCanvasScale(canvasWidth, canvasHeight) {
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !canvasWidth || !canvasHeight) return;

    const updateScale = () => {
      const availableWidth = el.clientWidth;
      if (availableWidth <= 0) return;

      const scaleByWidth = availableWidth / canvasWidth;

      // On mobile (modal fullscreen), also consider available height
      // The container gets flex: 1 so it has an actual height to measure
      const availableHeight = el.clientHeight;
      let scaleByHeight = Infinity;
      if (availableHeight > 0) {
        scaleByHeight = availableHeight / canvasHeight;
      }

      // Fit to the most constrained dimension, never scale up
      const newScale = Math.min(1, scaleByWidth, scaleByHeight);
      setScale(newScale);
    };

    const ro = new ResizeObserver(updateScale);
    ro.observe(el);
    updateScale(); // initial

    return () => ro.disconnect();
  }, [canvasWidth, canvasHeight]);

  return { scale, containerRef };
}
