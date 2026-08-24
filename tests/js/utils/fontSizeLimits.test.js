import { minFontSizePx } from '../../../shared/js/fontSizeLimits';

describe('minFontSizePx', () => {
  it('converts millimetres to canvas pixels using the view scale', () => {
    // 600px canvas across 60mm → 10px per mm → a 3mm minimum is 30px.
    expect(minFontSizePx({ minFontSizeMm: 3, canvasWidth: 600, widthMm: 60 })).toBeCloseTo(30, 6);
  });

  it('returns 0 when the template sets no minimum', () => {
    expect(minFontSizePx({ minFontSizeMm: 0, canvasWidth: 600, widthMm: 60 })).toBe(0);
    expect(minFontSizePx({ canvasWidth: 600, widthMm: 60 })).toBe(0);
  });

  it('returns 0 when the view has no physical size', () => {
    // Without width_mm there is no millimetre scale, so no minimum is enforced.
    expect(minFontSizePx({ minFontSizeMm: 3, canvasWidth: 600, widthMm: 0 })).toBe(0);
  });

  it('returns 0 for a nonsensical canvas width', () => {
    expect(minFontSizePx({ minFontSizeMm: 3, canvasWidth: 0, widthMm: 60 })).toBe(0);
  });

  it('scales with the canvas, not with the millimetres alone', () => {
    // Same 3mm minimum on a denser canvas yields a larger pixel value.
    const a = minFontSizePx({ minFontSizeMm: 3, canvasWidth: 600, widthMm: 60 });
    const b = minFontSizePx({ minFontSizeMm: 3, canvasWidth: 1200, widthMm: 60 });
    expect(b).toBeCloseTo(a * 2, 6);
  });
});
