import React, { useEffect, useState } from 'react';
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
 * Renders nothing when widthMm is 0 — a millimetre scale derived from no
 * physical size would be a lie.
 */
export default function MmRuler({ canvasRef, widthMm, canvasWidth, canvasHeight }) {
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const canvasEl = canvasRef?.current;
    if (!canvasEl) return undefined;
    const measure = () => {
      const r = canvasEl.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(canvasEl);
    measure();
    return () => ro.disconnect();
  }, [canvasRef]);

  if (!(widthMm > 0) || !(canvasWidth > 0) || !(size.w > 0)) return null;

  const mmPerPx = widthMm / size.w;
  const hTicks = buildTicks({ lengthPx: size.w, mmPerPx });
  const vTicks = buildTicks({ lengthPx: size.h, mmPerPx });
  if (!hTicks.length) return null;

  const strip = (ticks, horizontal) => (
    <svg
      className={`pf-ruler pf-ruler--${horizontal ? 'top' : 'left'}`}
      width={horizontal ? size.w : THICKNESS}
      height={horizontal ? THICKNESS : size.h}
      aria-hidden="true"
    >
      {ticks.map((t, i) => {
        const len = t.major ? THICKNESS * 0.5 : THICKNESS * 0.25;
        return horizontal ? (
          <line key={i} x1={t.px} y1={THICKNESS - len} x2={t.px} y2={THICKNESS} className="pf-ruler__tick" />
        ) : (
          <line key={i} x1={THICKNESS - len} y1={t.px} x2={THICKNESS} y2={t.px} className="pf-ruler__tick" />
        );
      })}
      {ticks.filter((t) => t.major).map((t, i) => (
        horizontal ? (
          <text key={i} x={t.px + 2} y={9} className="pf-ruler__label">{t.mm}</text>
        ) : (
          <text key={i} x={2} y={t.px - 2} className="pf-ruler__label">{t.mm}</text>
        )
      ))}
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
