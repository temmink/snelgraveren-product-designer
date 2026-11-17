import { Path as FabricPath } from 'fabric';
import { PRESETS } from './curvePresets';

// Bending a text along one of the curve presets.
//
// A preset draws its path from the WIDTH OF THE TEXT — the length the letters
// need. That width must be measured from the letters themselves. It used to be
// read from `obj.width`, but once a text sits on a path Fabric sets `width` to
// the width of the PATH's bounding box. For an arch those are the same number,
// so nothing showed. For a circle they are not: the circle's box is its
// diameter, a third of the circumference the text was laid on. Every touch of
// the intensity slider therefore rebuilt the circle from a third of the
// previous length — letters piled on top of each other after one step, and the
// radius kept collapsing until the tab stopped responding (reported for
// 1.12.5).

/** The length the text needs along a path: its widest line, as laid out flat. */
export function naturalTextWidth(obj) {
  const lines = obj?._textLines?.length || 0;
  let widest = 0;
  for (let i = 0; i < lines; i++) {
    const w = Number(obj.getLineWidth?.(i));
    if (Number.isFinite(w) && w > widest) widest = w;
  }
  return widest > 0 ? widest : (Number(obj?.width) || 200);
}

/**
 * Put `obj` on the given preset's curve (or take it off, for 'straight').
 * Safe to call again and again with the same arguments: the result depends
 * only on the text, never on the path that was there before.
 */
export function applyCurve(obj, presetId, intensity) {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!obj || !preset) return false;

  if (presetId === 'straight') {
    obj.set({ path: null });
  } else {
    const d = preset.generator(naturalTextWidth(obj), intensity);
    obj.set({ path: new FabricPath(d, { visible: false }) });
  }
  obj.set({ data: { ...obj.data, curvePreset: presetId, curveIntensity: intensity } });
  obj.initDimensions();
  obj.setCoords();
  return true;
}
