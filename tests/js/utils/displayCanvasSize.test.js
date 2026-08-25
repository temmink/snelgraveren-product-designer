import { displayCanvasSize, DISPLAY_TARGET_PX } from '../../../admin/js/template-builder/src/utils/displayCanvasSize';

// The exported height in millimetres is derived from the canvas pixel ratio
// (Export\PremiumExports: height_mm = width_mm * h_px / w_px), so that is what
// these tests assert on — not the pixel numbers for their own sake.
const derivedHeightMm = (widthMm, { width, height }) => (widthMm * height) / width;

describe('displayCanvasSize', () => {
  it('leaves a ratio that is already exact at the target size alone', () => {
    expect(displayCanvasSize(200, 100)).toEqual({ width: 600, height: 300, scale: 3 });
    expect(displayCanvasSize(100, 200)).toEqual({ width: 300, height: 600, scale: 3 });
    expect(displayCanvasSize(50, 50)).toEqual({ width: 600, height: 600, scale: 12 });
  });

  it('reproduces the reported 400 x 193 mm LightBurn file exactly', () => {
    // The regression: a fixed 600 px long edge rounds 289.5 -> 290 and turns
    // a true 193.00 mm height into 193.33 mm.
    const naive = { width: 600, height: 290 };
    expect(derivedHeightMm(400, naive)).toBeCloseTo(193.33, 2);

    const size = displayCanvasSize(400 * 3.7795, 193 * 3.7795);
    expect(derivedHeightMm(400, size)).toBeCloseTo(193, 6);
  });

  it('never returns a long edge below the target, nor more than double it', () => {
    for (let h = 1; h <= 400; h++) {
      const { width, height } = displayCanvasSize(400, h);
      expect(width).toBeGreaterThanOrEqual(DISPLAY_TARGET_PX);
      expect(width).toBeLessThanOrEqual(DISPLAY_TARGET_PX * 2);
      expect(Number.isInteger(width)).toBe(true);
      expect(Number.isInteger(height)).toBe(true);
      expect(height).toBeGreaterThanOrEqual(1);
    }
  });

  it('is never worse than naively rounding the target long edge', () => {
    for (let h = 1; h <= 400; h++) {
      const ratio = h / 400;
      const chosen = displayCanvasSize(400, h);
      const naiveErr = Math.abs(Math.round(DISPLAY_TARGET_PX * ratio) / DISPLAY_TARGET_PX - ratio);
      const chosenErr = Math.abs(chosen.height / chosen.width - ratio);
      expect(chosenErr).toBeLessThanOrEqual(naiveErr + 1e-12);
    }
  });

  it('keeps the derived height within a hundredth of a millimetre for a 400 mm design', () => {
    // The tolerance that matters to the user: they engrave to the millimetre.
    for (let h = 1; h <= 400; h++) {
      const size = displayCanvasSize(400 * 3.7795, h * 3.7795);
      expect(Math.abs(derivedHeightMm(400, size) - h)).toBeLessThan(0.01);
    }
  });

  it('scale maps the natural long edge onto the chosen pixel long edge', () => {
    const nat = { w: 1511.8, h: 729.4435 };
    const { width, scale } = displayCanvasSize(nat.w, nat.h);
    expect(nat.w * scale).toBeCloseTo(width, 6);
  });

  it('falls back to a square-safe result for degenerate input', () => {
    expect(displayCanvasSize(0, 0).width).toBe(600);
    expect(displayCanvasSize(0, 0).height).toBe(600);
    expect(displayCanvasSize(NaN, undefined).width).toBe(600);
  });

  it('clamps an extremely elongated design to at least one pixel on the short edge', () => {
    const { width, height } = displayCanvasSize(100000, 1);
    expect(width).toBe(600);
    expect(height).toBe(1);
  });
});
