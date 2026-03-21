import { useState, useEffect, useRef } from 'react';

/**
 * Observe a container element and return the scale factor needed
 * to fit a canvas of `canvasWidth` into the container.
 * Returns { scale, containerRef } where containerRef is attached to the wrapper div.
 *
 * IMPORTANT: Do NOT use CSS transform to scale the canvas.
 * Fabric.js calculates pointer positions from the DOM element's bounding rect.
 * A CSS transform on a parent causes pointer position mismatch.
 * Instead, apply the returned scale via canvas.setZoom() + canvas.setDimensions(cssOnly).
 */
export default function useCanvasScale(canvasWidth) {
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !canvasWidth) return;

    const updateScale = () => {
      const availableWidth = el.clientWidth;
      if (availableWidth <= 0) return;
      // Only scale down, never up
      const newScale = Math.min(1, availableWidth / canvasWidth);
      setScale(newScale);
    };

    const ro = new ResizeObserver(updateScale);
    ro.observe(el);
    updateScale(); // initial

    return () => ro.disconnect();
  }, [canvasWidth]);

  return { scale, containerRef };
}
