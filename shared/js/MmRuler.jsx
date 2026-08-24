import React, { useEffect, useRef, useState } from 'react';
import { buildTicks } from './rulerTicks';

const THICKNESS = 22; // px, matches the CSS grid track

/**
 * Millimetre rulers along the top and left edges of a Fabric canvas.
 *
 * Rendered as DOM/SVG beside the canvas, never as Fabric objects: a Fabric
 * ruler would be serialized into the saved design and drawn into every
 * export.
 *
 * Scale is derived by measuring the canvas element rather than by reading
 * the Fabric zoom, so the responsive zoom loop in useCanvasScale can stay
 * free of React state.
 *
 * `canvasRef` is the ref OBJECT that owns the `<canvas>` element, not its
 * current value — on first render `ref.current` is still null (a ref
 * mutation doesn't trigger a re-render), so passing the dereferenced value
 * as a prop would permanently early-return this component's effect. Reading
 * `canvasRef.current` inside the effect works because effects run after the
 * DOM commit, by which point the canvas element is attached.
 *
 * The canvas element is not flush against the strips' own origin — both
 * apps' `.pf-canvas-scroll` pane can pad and/or centre the canvas inside
 * itself (and may be mid-scroll), so a strip drawn from its own (0,0) would
 * measure the wrong thing entirely. Each strip therefore carries its own
 * ref too, and ticks are offset by the live gap between the canvas's
 * bounding rect and that strip's bounding rect.
 *
 * Re-measuring: a `ResizeObserver` on the canvas element alone is not
 * enough. `ResizeObserver` fires on SIZE changes, not position changes. In
 * the Template Builder the canvas is a fixed pixel size and never resizes —
 * a window resize re-centres it inside `.pf-canvas-scroll` (moving it)
 * without ever changing its width/height, so that observer would never
 * fire and the offset would go stale. The scroll pane's own size, in
 * contrast, always tracks the window (it's the flex/grid track), so it is
 * also observed; a `window` resize listener is kept too as a backstop for
 * any layout change that moves the canvas without resizing either the
 * canvas or the pane. Both are cleaned up on unmount. Scrolling the pane is
 * handled separately (a `scroll` listener), since scrolling changes
 * position without firing ResizeObserver either.
 *
 * Each strip's SVG viewport spans its own grid cell (not the canvas width),
 * so ticks pushed right/down by a positive offset are not clipped before
 * they reach the strip's visible edge.
 *
 * Renders nothing when widthMm is 0 — a millimetre scale derived from no
 * physical size would be a lie.
 */
export default function MmRuler({ canvasRef, widthMm, canvasWidth, canvasHeight }) {
  const topStripRef = useRef(null);
  const leftStripRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const canvasEl = canvasRef?.current;
    if (!canvasEl) return undefined;

    const measure = () => {
      const canvasRect = canvasEl.getBoundingClientRect();
      setSize({ w: canvasRect.width, h: canvasRect.height });

      const topRect = topStripRef.current?.getBoundingClientRect();
      const leftRect = leftStripRef.current?.getBoundingClientRect();
      setOffset({
        x: topRect ? canvasRect.left - topRect.left : 0,
        y: leftRect ? canvasRect.top - leftRect.top : 0,
      });
    };

    // .pf-canvas-scroll pads/centres the canvas and can overflow-scroll it,
    // so the gap between the strips and the canvas shifts on scroll too —
    // not just on resize.
    const scrollParent = canvasEl.closest('.pf-canvas-scroll') || canvasEl.parentElement;

    const ro = new ResizeObserver(measure);
    ro.observe(canvasEl);
    // Also observe the scroll pane: it resizes with the window even when the
    // canvas itself does not (a fixed-size Template Builder canvas), which
    // is exactly the case a canvas-only ResizeObserver misses.
    if (scrollParent) ro.observe(scrollParent);
    measure();

    scrollParent?.addEventListener('scroll', measure, { passive: true });
    // Backstop for any window-level layout change that moves the canvas
    // without resizing either observed element.
    window.addEventListener('resize', measure);

    return () => {
      ro.disconnect();
      scrollParent?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [canvasRef]);

  if (!(widthMm > 0) || !(canvasWidth > 0)) return null;

  const mmPerPx = size.w > 0 ? widthMm / size.w : 0;
  const hTicks = size.w > 0 ? buildTicks({ lengthPx: size.w, mmPerPx }) : [];
  const vTicks = size.h > 0 ? buildTicks({ lengthPx: size.h, mmPerPx }) : [];

  const strip = (ticks, horizontal) => (
    <svg
      ref={horizontal ? topStripRef : leftStripRef}
      className={`pf-ruler pf-ruler--${horizontal ? 'top' : 'left'}`}
      width={horizontal ? '100%' : THICKNESS}
      height={horizontal ? THICKNESS : '100%'}
      aria-hidden="true"
    >
      {ticks.map((t, i) => {
        const len = t.major ? THICKNESS * 0.5 : THICKNESS * 0.25;
        const pos = horizontal ? offset.x + t.px : offset.y + t.px;
        return horizontal ? (
          <line key={i} x1={pos} y1={THICKNESS - len} x2={pos} y2={THICKNESS} className="pf-ruler__tick" />
        ) : (
          <line key={i} x1={THICKNESS - len} y1={pos} x2={THICKNESS} y2={pos} className="pf-ruler__tick" />
        );
      })}
      {ticks.filter((t) => t.major).map((t, i) => {
        const pos = horizontal ? offset.x + t.px : offset.y + t.px;
        return horizontal ? (
          <text key={i} x={pos + 2} y={9} className="pf-ruler__label">{t.mm}</text>
        ) : (
          <text key={i} x={2} y={pos - 2} className="pf-ruler__label">{t.mm}</text>
        );
      })}
    </svg>
  );

  return (
    <>
      <div className="pf-ruler__corner">mm</div>
      {strip(hTicks, true)}
      {strip(vTicks, false)}
    </>
  );
}
