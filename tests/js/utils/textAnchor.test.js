import { resolveTextAnchor } from '../../../shared/js/textAnchor';

// Live-data shape: Template 4 view 5 zone 1. zone.width = 526.178, layer.left
// = -58, textAlign 'center', no originX. See CLAUDE.md / task report for the
// full bug narrative — this is the exact case that produced the 253px jump.
const LEGACY_ZONE = { x: 0, y: 0, width: 526.178, height: 300 };
const LEGACY_LAYER = { left: -58, top: 40, textAlign: 'center' };

describe('resolveTextAnchor', () => {
  it('round-trips: resolving the write-back patch of a resolved anchor gives the same anchor (idempotence)', () => {
    // This is the actual defect. Before the fix, resolving twice (as the
    // layer-sync effect does on every re-render after a save) adds the
    // center compensation a second time and the text jumps.
    const first = resolveTextAnchor(LEGACY_LAYER, LEGACY_ZONE);

    // Simulate the object:modified write-back handler AFTER the Part A fix:
    // it persists left/top/originX/originY from the live Fabric object,
    // which at this point holds `first`'s values.
    const patchedLayer = {
      ...LEGACY_LAYER,
      left: first.left,
      top: first.top,
      originX: first.originX,
      originY: first.originY,
    };

    const second = resolveTextAnchor(patchedLayer, LEGACY_ZONE);

    expect(second.left).toBeCloseTo(first.left, 6);
    expect(second.top).toBeCloseTo(first.top, 6);
    expect(second.originX).toBe(first.originX);
    expect(second.originY).toBe(first.originY);
  });

  it('matches the documented legacy numbers for the live template-4 case', () => {
    // zone.x=0, so left = -58 + 526.178/2 = 195.089
    const anchor = resolveTextAnchor(LEGACY_LAYER, LEGACY_ZONE);
    expect(anchor.left).toBeCloseTo(195.089, 3);
    expect(anchor.originX).toBe('center');
  });

  it('center align: adds half the box width to left and sets originX center', () => {
    const zone = { x: 0, y: 0, width: 200, height: 100 };
    const layer = { left: 10, top: 20, textAlign: 'center' };
    const anchor = resolveTextAnchor(layer, zone);
    // boxWidth falls back to zone.width - 20 = 180
    expect(anchor.left).toBeCloseTo(10 + 90, 6);
    expect(anchor.top).toBe(20);
    expect(anchor.originX).toBe('center');
    expect(anchor.originY).toBe('top');
  });

  it('right align: adds the full box width to left and sets originX right', () => {
    const zone = { x: 0, y: 0, width: 200, height: 100 };
    const layer = { left: 10, top: 20, textAlign: 'right' };
    const anchor = resolveTextAnchor(layer, zone);
    expect(anchor.left).toBeCloseTo(10 + 180, 6);
    expect(anchor.originX).toBe('right');
  });

  it('left align (explicit or default): left passes through unchanged', () => {
    const zone = { x: 0, y: 0, width: 200, height: 100 };
    expect(resolveTextAnchor({ left: 10, top: 20, textAlign: 'left' }, zone).left).toBe(10);
    expect(resolveTextAnchor({ left: 10, top: 20 }, zone).left).toBe(10);
  });

  it('explicit originX short-circuits the compensation entirely, regardless of textAlign', () => {
    const zone = { x: 0, y: 0, width: 200, height: 100 };
    const layer = { left: 10, top: 20, textAlign: 'center', originX: 'left' };
    const anchor = resolveTextAnchor(layer, zone);
    expect(anchor.left).toBe(10);
    expect(anchor.originX).toBe('left');
  });

  it('explicit originY is preserved instead of defaulting to top', () => {
    const zone = { x: 0, y: 0, width: 200, height: 100 };
    const layer = { left: 10, top: 20, originX: 'center', originY: 'center' };
    const anchor = resolveTextAnchor(layer, zone);
    expect(anchor.originY).toBe('center');
  });

  it('uses layer.width over the zone-derived box width when present', () => {
    const zone = { x: 0, y: 0, width: 200, height: 100 };
    const layer = { left: 10, top: 20, textAlign: 'center', width: 60 };
    const anchor = resolveTextAnchor(layer, zone);
    expect(anchor.left).toBeCloseTo(10 + 30, 6);
  });

  it('falls back to zone-relative left/top when the layer omits them', () => {
    const zone = { x: 50, y: 30, width: 200, height: 100 };
    const anchor = resolveTextAnchor({ textAlign: 'left' }, zone);
    expect(anchor.left).toBe(zone.x + 20);
    expect(anchor.top).toBe(zone.y + 20);
  });

  it('falls back to fixed defaults when there is no zone and no left/top', () => {
    const anchor = resolveTextAnchor({ textAlign: 'left' }, null);
    expect(anchor.left).toBe(100);
    expect(anchor.top).toBe(100);
  });

  it('a missing zone does not throw, even with center/right alignment', () => {
    expect(() => resolveTextAnchor({ left: 10, top: 20, textAlign: 'center' }, null)).not.toThrow();
    expect(() => resolveTextAnchor({ left: 10, top: 20, textAlign: 'right' }, undefined)).not.toThrow();
    const anchor = resolveTextAnchor({ left: 10, top: 20, textAlign: 'center' }, null);
    // boxWidth falls back to the fixed 200 default when there's no zone.
    expect(anchor.left).toBeCloseTo(10 + 100, 6);
  });
});
