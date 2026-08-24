import { resolveTextAnchor, buildTextAnchorPatch } from '../../../shared/js/textAnchor';

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

// Regression guard for the align-toolbar hole: `object:modified` (Canvas.jsx)
// persists originX/originY alongside left/top, but until this fix
// `handleAlign` persisted only { left, top } — so a single align-toolbar
// click on a legacy layer (no stored originX) wrote the anchor-left raw, and
// the next layer-sync re-derived the textAlign compensation on top of it:
// the identical half-box jump the drag path was fixed for, reached through
// the align button instead. Both write-back sites must build their patch
// through this one helper so they can't drift apart again — deleting
// `patch.originX`/`patch.originY` from either call site should fail this
// suite.
describe('buildTextAnchorPatch', () => {
  it('always includes originX/originY, not just left/top', () => {
    // A Fabric object mid-session already carries the origin it was
    // constructed with (from a prior resolveTextAnchor call) — this is what
    // the live canvas object looks like right after an align-toolbar click
    // or a drag ends (`object:modified` fires with this same shape).
    const objAfterAlign = { left: 195.089, top: 40, originX: 'center', originY: 'top' };
    const patch = buildTextAnchorPatch(objAfterAlign);
    expect(patch.originX).toBe('center');
    expect(patch.originY).toBe('top');
  });

  it('rounds left/top to whole pixels', () => {
    const patch = buildTextAnchorPatch({ left: 10.6, top: 20.4, originX: 'left', originY: 'top' });
    expect(patch.left).toBe(11);
    expect(patch.top).toBe(20);
  });

  it('round-trips through resolveTextAnchor: the live template-4 legacy case', () => {
    // zone.width 526.178, layer.left -58, textAlign 'center', no originX —
    // the exact live-data shape documented at the top of this file.
    const zone = LEGACY_ZONE;
    const legacyLayer = LEGACY_LAYER;

    // First resolve: this is what happens when the layer is loaded onto the
    // canvas — the Fabric object is constructed at this anchor.
    const first = resolveTextAnchor(legacyLayer, zone);

    // Simulate the Fabric object after an align-toolbar click: originX/originY
    // are whatever the object was constructed with (`first`'s), left/top are
    // wherever alignElement() moved it to.
    const objAfterAlign = {
      left: first.left + 12.4, // moved by the align click
      top: first.top,
      originX: first.originX,
      originY: first.originY,
    };

    const patch = buildTextAnchorPatch(objAfterAlign);

    // The bug: without originX/originY in the patch, feeding the merged
    // layer back through resolveTextAnchor re-derives the textAlign
    // compensation a second time and the position drifts.
    const patchedLayer = { ...legacyLayer, ...patch };
    const second = resolveTextAnchor(patchedLayer, zone);

    expect(second.left).toBeCloseTo(patch.left, 6);
    expect(second.top).toBeCloseTo(patch.top, 6);
    expect(second.originX).toBe(patch.originX);
    expect(second.originY).toBe(patch.originY);
  });
});
