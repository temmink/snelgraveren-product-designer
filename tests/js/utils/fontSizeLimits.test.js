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

// ── The requirement these guard ────────────────────────────────────────────
// "Net zo hard afdwingen als bij de klant" — a MERCHANT must not be able to
// end up with text below the template's millimetre minimum, by any route the
// UI offers: the size input, or the canvas corner handles (which change
// scale, not fontSize). The customer's designer already enforced both; the
// builder enforced neither. These tests are written against the outcome the
// merchant/customer sees, not against how either app calls the helpers.

import { fontSizeInputFloorPx, textMinScaleLimit, clampFontSizePx } from '../../../shared/js/fontSizeLimits';

// 800px canvas across 80mm → 10px per mm.
const VIEW = { canvasWidth: 800, widthMm: 80 };

describe('a merchant cannot type a size below the template minimum', () => {
  const floor = fontSizeInputFloorPx({ minFontSizeMm: 3, ...VIEW }); // 30px

  it('raises anything typed below the minimum up to it', () => {
    [1, 7, 8, 12, 29].forEach((typed) => {
      const got = clampFontSizePx({ value: String(typed), floor, max: 200, fallback: 24 });
      expect(got).toBeGreaterThanOrEqual(floor);
    });
  });

  it('leaves a legal size exactly as typed', () => {
    expect(clampFontSizePx({ value: '48', floor, max: 200, fallback: 24 })).toBe(48);
  });

  it('never lets an emptied or garbage entry write a zero', () => {
    expect(clampFontSizePx({ value: '', floor, max: 200, fallback: 24 })).toBe(floor);
    expect(clampFontSizePx({ value: 'abc', floor, max: 200, fallback: 24 })).toBe(floor);
  });

  it('keeps the 8px default floor for a template that sets no minimum', () => {
    const noMin = fontSizeInputFloorPx({ minFontSizeMm: 0, ...VIEW });
    expect(noMin).toBe(8);
    expect(clampFontSizePx({ value: '2', floor: noMin, max: 200, fallback: 24 })).toBe(8);
  });

  it('rounds the floor UP so a stored size never sits a fraction below the mm minimum', () => {
    // 2.05mm on this view is 20.5px — 20 would be below the minimum.
    const f = fontSizeInputFloorPx({ minFontSizeMm: 2.05, ...VIEW });
    expect(f).toBe(21);
    expect(f * (VIEW.widthMm / VIEW.canvasWidth)).toBeGreaterThanOrEqual(2.05);
  });

  it('still lets the merchant REACH a minimum larger than the input cap', () => {
    // 10mm minimum on this view is 100px; on a small view it can exceed the
    // 200px convenience cap. Pinning at the cap would strand the value below
    // the minimum with no way up — the constraint must not be a dead end.
    const bigFloor = fontSizeInputFloorPx({ minFontSizeMm: 10, canvasWidth: 800, widthMm: 20 }); // 400px
    expect(bigFloor).toBe(400);
    expect(clampFontSizePx({ value: '50', floor: bigFloor, max: 200, fallback: 24 })).toBe(bigFloor);
  });
});

describe('a merchant cannot drag the corner handles below the template minimum', () => {
  it('caps shrinking at the minimum for a text object above it', () => {
    // 60px text, 3mm (=30px) minimum → may shrink to half, no further.
    const limit = textMinScaleLimit({ minFontSizeMm: 3, ...VIEW, fontSize: 60 });
    expect(limit).toBeCloseTo(0.5, 6);
    // What the customer actually ends up with: fontSize * scale >= minimum.
    expect(60 * limit).toBeCloseTo(30, 6);
  });

  it('forbids shrinking at all when the object is already at the minimum', () => {
    const limit = textMinScaleLimit({ minFontSizeMm: 3, ...VIEW, fontSize: 30 });
    expect(limit).toBe(1);
  });

  it('does not let a per-element min_scale undercut the font minimum', () => {
    const limit = textMinScaleLimit({ minFontSizeMm: 3, ...VIEW, fontSize: 60, minScale: 0.1 });
    expect(60 * limit).toBeCloseTo(30, 6);
  });

  it('keeps a stricter per-element min_scale when it is the binding one', () => {
    const limit = textMinScaleLimit({ minFontSizeMm: 3, ...VIEW, fontSize: 60, minScale: 0.9 });
    expect(limit).toBe(0.9);
  });

  it('applies no floor at all when the template sets no minimum', () => {
    expect(textMinScaleLimit({ minFontSizeMm: 0, ...VIEW, fontSize: 60 })).toBeNull();
    expect(textMinScaleLimit({ minFontSizeMm: 3, canvasWidth: 800, widthMm: 0, fontSize: 60 })).toBeNull();
  });

  it('applies no floor to an object with no fontSize (engraving text is clamped elsewhere)', () => {
    expect(textMinScaleLimit({ minFontSizeMm: 3, ...VIEW, fontSize: undefined })).toBeNull();
    expect(textMinScaleLimit({ minFontSizeMm: 3, ...VIEW, fontSize: 0 })).toBeNull();
  });

  it('opening a template that already contains sub-minimum text does not resize it', () => {
    // The helper returns a SCALE limit, never a font size: there is no return
    // value a caller could mistake for "set fontSize to this". A 10px object
    // under a 30px minimum keeps its 10px until someone drags a handle.
    const limit = textMinScaleLimit({ minFontSizeMm: 3, ...VIEW, fontSize: 10 });
    expect(limit).toBe(3); // may only be scaled UP from here
  });
});
