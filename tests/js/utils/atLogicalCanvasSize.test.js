import atLogicalCanvasSize from '../../../shared/js/atLogicalCanvasSize';

// ── The requirement these guard ────────────────────────────────────────────
// The export PNG is what the laser actually cuts. It must come out at the same
// resolution for every customer, whatever window they happen to be designing
// in — a phone and a 27" monitor must ship the identical file for the identical
// design. Before this helper the capture ran straight off the responsive live
// canvas, so the produced pixels were `canvas_width * on-screen scale *
// multiplier`: the window decided the resolution, and a wide enough one pushed
// the 3x PNG past the server's 10 MB limit, where the save is REJECTED.
//
// So the tests below assert on the SIZE OF THE PRODUCED IMAGE at two different
// on-screen scales, not on how the helper goes about it. Each one also checks
// the same capture WITHOUT the helper, which is what the code used to do — that
// is the assertion that would fail if the wrapper were ever dropped again.

// ── A Fabric stand-in with Fabric's real capture geometry ──────────────────
// Only the surface the helper touches. The numbers matter, so toDataURL follows
// fabric 6.9.1 StaticCanvas#toCanvasElement exactly (dist/index.js):
//
//     scaledWidth  = (width || this.width) * multiplier
//     scaledHeight = (height || this.height) * multiplier
//     newZoom      = this.getZoom() * multiplier
//     translateX/Y = vpt[4]/vpt[5] * multiplier
//
// i.e. the output pixel size is the BACKING STORE size times the multiplier,
// and the viewport transform is folded into what gets drawn. Real Fabric needs
// a canvas implementation jsdom does not have, so the produced "data URL"
// encodes the geometry the capture ran under instead of real pixels.
function makeCanvas({ logicalWidth, logicalHeight, scale }) {
  return {
    width: logicalWidth * scale,
    height: logicalHeight * scale,
    viewportTransform: [scale, 0, 0, scale, 0, 0],
    renders: 0,
    getWidth() { return this.width; },
    getHeight() { return this.height; },
    getZoom() { return this.viewportTransform[0]; },
    setDimensions({ width, height }) { this.width = width; this.height = height; },
    setViewportTransform(vpt) { this.viewportTransform = vpt; },
    renderAll() { this.renders += 1; },
    toDataURL({ multiplier = 1 } = {}) {
      const vpt = this.viewportTransform;
      return `data:image/png;w=${this.width * multiplier};h=${this.height * multiplier}`
        + `;zoom=${this.getZoom() * multiplier};tx=${vpt[4] * multiplier};ty=${vpt[5] * multiplier}`;
    },
  };
}

/** Pixel size of one of the fake data URLs above. */
function pixelSize(dataUrl) {
  const w = /;w=([\d.]+)/.exec(dataUrl);
  const h = /;h=([\d.]+)/.exec(dataUrl);
  return { w: Number(w[1]), h: Number(h[1]) };
}

// The plank template: 600x292 logical, the widest mismatch against a desktop
// window and therefore the one that scales furthest.
const W = 600;
const H = 292;

describe('the export is the same size whatever window the customer used', () => {
  it('produces identical 3x export pixels on a shrunk and on an enlarged canvas', () => {
    const phone = makeCanvas({ logicalWidth: W, logicalHeight: H, scale: 0.5 });
    const desktop = makeCanvas({ logicalWidth: W, logicalHeight: H, scale: 2 });

    const fromPhone = atLogicalCanvasSize(phone, W, H, () => phone.toDataURL({ format: 'png', multiplier: 3 }));
    const fromDesktop = atLogicalCanvasSize(desktop, W, H, () => desktop.toDataURL({ format: 'png', multiplier: 3 }));

    expect(pixelSize(fromPhone)).toEqual({ w: 1800, h: 876 });
    expect(pixelSize(fromDesktop)).toEqual(pixelSize(fromPhone));

    // What the same two captures did before the helper existed: the window
    // decided the file. 4x the pixels of the phone, 16x the bytes.
    expect(pixelSize(phone.toDataURL({ multiplier: 3 }))).toEqual({ w: 900, h: 438 });
    expect(pixelSize(desktop.toDataURL({ multiplier: 3 }))).toEqual({ w: 3600, h: 1752 });
  });

  it('produces identical 0.5x thumbnail pixels on a shrunk and on an enlarged canvas', () => {
    const phone = makeCanvas({ logicalWidth: W, logicalHeight: H, scale: 0.5 });
    const desktop = makeCanvas({ logicalWidth: W, logicalHeight: H, scale: 2 });

    const fromPhone = atLogicalCanvasSize(phone, W, H, () => phone.toDataURL({ format: 'png', multiplier: 0.5 }));
    const fromDesktop = atLogicalCanvasSize(desktop, W, H, () => desktop.toDataURL({ format: 'png', multiplier: 0.5 }));

    expect(pixelSize(fromPhone)).toEqual({ w: 300, h: 146 });
    expect(pixelSize(fromDesktop)).toEqual(pixelSize(fromPhone));
  });

  it('draws the design at 1:1, not at the on-screen zoom', () => {
    const desktop = makeCanvas({ logicalWidth: W, logicalHeight: H, scale: 2 });
    const url = atLogicalCanvasSize(desktop, W, H, () => desktop.toDataURL({ multiplier: 3 }));
    // zoom folded into the render = multiplier alone. At scale 2 the old path
    // drew everything 6x, into a 6x-bigger image — same picture, bigger file.
    expect(/;zoom=([\d.]+)/.exec(url)[1]).toBe('3');
  });

  it('ignores a panned viewport, which would otherwise crop the capture', () => {
    const panned = makeCanvas({ logicalWidth: W, logicalHeight: H, scale: 1 });
    panned.viewportTransform = [1, 0, 0, 1, -120, -40];
    const url = atLogicalCanvasSize(panned, W, H, () => panned.toDataURL({ multiplier: 3 }));
    expect(/;tx=(-?[\d.]+)/.exec(url)[1]).toBe('0');
    expect(/;ty=(-?[\d.]+)/.exec(url)[1]).toBe('0');
    expect(panned.viewportTransform).toEqual([1, 0, 0, 1, -120, -40]);
  });
});

describe('the customer never sees the canvas it was captured at', () => {
  it('puts the on-screen zoom and size back', () => {
    const canvas = makeCanvas({ logicalWidth: W, logicalHeight: H, scale: 1.5 });
    atLogicalCanvasSize(canvas, W, H, () => canvas.toDataURL({ multiplier: 3 }));

    expect(canvas.width).toBe(900);
    expect(canvas.height).toBe(438);
    expect(canvas.getZoom()).toBe(1.5);
    expect(canvas.renders).toBeGreaterThan(0);
  });

  it('puts them back even when the capture throws', () => {
    const canvas = makeCanvas({ logicalWidth: W, logicalHeight: H, scale: 1.5 });
    const boom = () => atLogicalCanvasSize(canvas, W, H, () => { throw new Error('render failed'); });

    expect(boom).toThrow('render failed');
    expect(canvas.width).toBe(900);
    expect(canvas.height).toBe(438);
    expect(canvas.getZoom()).toBe(1.5);
  });

  it('restores a viewport that is its own array, not the one it handed out', () => {
    const canvas = makeCanvas({ logicalWidth: W, logicalHeight: H, scale: 2 });
    const before = canvas.viewportTransform;
    atLogicalCanvasSize(canvas, W, H, () => canvas.toDataURL({ multiplier: 3 }));
    expect(canvas.viewportTransform).toEqual([2, 0, 0, 2, 0, 0]);
    // The live array must not have been handed to the capture and mutated.
    expect(before).toEqual([2, 0, 0, 2, 0, 0]);
  });
});

describe('composition with the wrappers it nests around', () => {
  it('runs the inner wrappers while the canvas is already at logical size', () => {
    const canvas = makeCanvas({ logicalWidth: W, logicalHeight: H, scale: 2 });
    const seen = [];
    // Stands in for withoutExcludedObjects / withoutTextPlaceholders: they hide
    // objects and renderAll() before capturing, so they must see the size the
    // capture will actually run at.
    const hidingWrapper = (fn) => { seen.push({ w: canvas.width, h: canvas.height }); return fn(); };

    const url = atLogicalCanvasSize(canvas, W, H, () =>
      hidingWrapper(() => canvas.toDataURL({ multiplier: 3 }))
    );

    expect(seen).toEqual([{ w: W, h: H }]);
    expect(pixelSize(url)).toEqual({ w: 1800, h: 876 });
  });
});

describe('degenerate inputs leave the capture alone', () => {
  it('falls back to the canvas\'s current size when the view has none', () => {
    const canvas = makeCanvas({ logicalWidth: W, logicalHeight: H, scale: 1 });
    const url = atLogicalCanvasSize(canvas, 0, undefined, () => canvas.toDataURL({ multiplier: 3 }));
    expect(pixelSize(url)).toEqual({ w: 1800, h: 876 });
    expect(canvas.width).toBe(W);
  });

  it('still runs the capture when there is no canvas at all', () => {
    expect(atLogicalCanvasSize(null, W, H, () => 'captured')).toBe('captured');
  });
});
