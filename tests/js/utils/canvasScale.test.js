import { computeCanvasScale, MAX_SCALE } from '../../../frontend/js/designer/src/hooks/useCanvasScale';

// ── The requirement these guard ────────────────────────────────────────────
// The designer used to refuse to draw the product any bigger than the template
// was authored — a 600x292 plank sat at 600 px in the middle of a 1300 px slot
// with grey space around it, and the customer designed on a postage stamp. It
// must now use the room it is given, while still shrinking to fit when there
// is less room than the design needs, and still never growing so far that the
// background photo (~800 px of real pixels) turns to mush.

// The plank template: 600x292 logical, the widest mismatch on the shop.
const PLANK = { canvasWidth: 600, canvasHeight: 292 };
// The dog tag: 800x600.
const TAG = { canvasWidth: 800, canvasHeight: 600 };

// Plenty of vertical room, so the width is what decides.
const TALL_WINDOW = 4000;

describe('the canvas uses the room it is given', () => {
  it('grows past the template\'s own size when the slot is wider than it', () => {
    const scale = computeCanvasScale({ ...PLANK, availableWidth: 900, availableHeight: TALL_WINDOW });
    // 900 / 600. The old rule capped this at 1 and left 300 px of the slot empty.
    expect(scale).toBe(1.5);
    expect(900 / scale).toBe(PLANK.canvasWidth);
  });

  it('fills the slot exactly, so no room is left over', () => {
    const available = 793; // the real measurement on a 1600 px window
    const scale = computeCanvasScale({ ...TAG, availableWidth: available, availableHeight: TALL_WINDOW });
    expect(TAG.canvasWidth * scale).toBeCloseTo(available, 6);
  });

  it('stops growing at 2x however much room there is', () => {
    expect(computeCanvasScale({ ...PLANK, availableWidth: 2400, availableHeight: TALL_WINDOW })).toBe(2);
    expect(computeCanvasScale({ ...PLANK, availableWidth: 99999, availableHeight: TALL_WINDOW })).toBe(2);
    expect(MAX_SCALE).toBe(2);
  });
});

describe('the canvas still fits when there is less room than it wants', () => {
  it('shrinks to the width it is given', () => {
    // 447 px is what the product tab actually offers on a 900 px window.
    const scale = computeCanvasScale({ ...TAG, availableWidth: 447, availableHeight: TALL_WINDOW });
    expect(scale).toBeCloseTo(0.55875, 6);
    expect(TAG.canvasWidth * scale).toBeCloseTo(447, 6);
    expect(scale).toBeLessThan(1);
  });

  it('shrinks on a phone rather than overflowing it', () => {
    const scale = computeCanvasScale({ ...PLANK, availableWidth: 360, availableHeight: 780 });
    expect(PLANK.canvasWidth * scale).toBeCloseTo(360, 6);
  });

  it('lets height win when the window is wide but short', () => {
    // Room for 2x across, but only 600 px of window height: 600 / 600 = 1.
    const scale = computeCanvasScale({ ...TAG, availableWidth: 4000, availableHeight: 600 });
    expect(scale).toBe(1);
    expect(TAG.canvasHeight * scale).toBeLessThanOrEqual(600);
  });

  it('never returns a canvas taller than the room, at any window width', () => {
    const availableHeight = 700;
    [400, 800, 1600, 3200, 6400].forEach((availableWidth) => {
      const scale = computeCanvasScale({ ...TAG, availableWidth, availableHeight });
      expect(TAG.canvasHeight * scale).toBeLessThanOrEqual(availableHeight);
      expect(TAG.canvasWidth * scale).toBeLessThanOrEqual(availableWidth);
    });
  });

  it('keeps the design\'s proportions — one scale, both axes', () => {
    const scale = computeCanvasScale({ ...PLANK, availableWidth: 1000, availableHeight: 900 });
    const w = PLANK.canvasWidth * scale;
    const h = PLANK.canvasHeight * scale;
    expect(w / h).toBeCloseTo(PLANK.canvasWidth / PLANK.canvasHeight, 10);
  });
});

describe('nothing to size against', () => {
  it('declines when the container has no width yet', () => {
    expect(computeCanvasScale({ ...PLANK, availableWidth: 0, availableHeight: 800 })).toBeNull();
  });

  it('declines when the view has no size', () => {
    expect(computeCanvasScale({ canvasWidth: 0, canvasHeight: 0, availableWidth: 900, availableHeight: 800 })).toBeNull();
  });

  it('ignores an unmeasurable height instead of collapsing the canvas', () => {
    expect(computeCanvasScale({ ...PLANK, availableWidth: 900, availableHeight: 0 })).toBe(1.5);
  });
});
