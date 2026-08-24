import { clampRectToZone } from '../../../shared/js/zoneRectClamp';

// Zone: x=0, y=0, width=100, height=100 for most cases below.
const ZONE = { x: 0, y: 0, width: 100, height: 100 };

describe('clampRectToZone — object fits inside the zone', () => {
  it('leaves an object entirely inside the zone unchanged', () => {
    const bound = { left: 10, top: 10, width: 20, height: 20 };
    const result = clampRectToZone({ objLeft: 10, objTop: 10, bound, zone: ZONE });
    expect(result).toEqual({ left: 10, top: 10 });
  });

  it('clamps exactly to the left edge when dragged past it', () => {
    const bound = { left: -30, top: 10, width: 20, height: 20 };
    const result = clampRectToZone({ objLeft: -30, objTop: 10, bound, zone: ZONE });
    expect(result.left).toBe(0);
  });

  it('clamps exactly to the right edge when dragged past it', () => {
    const bound = { left: 90, top: 10, width: 20, height: 20 };
    const result = clampRectToZone({ objLeft: 90, objTop: 10, bound, zone: ZONE });
    expect(result.left).toBe(80); // bound.left + width == zone.x + zone.width
  });

  it('clamps exactly to the top edge when dragged past it', () => {
    const bound = { left: 10, top: -30, width: 20, height: 20 };
    const result = clampRectToZone({ objLeft: 10, objTop: -30, bound, zone: ZONE });
    expect(result.top).toBe(0);
  });

  it('clamps exactly to the bottom edge when dragged past it', () => {
    const bound = { left: 10, top: 90, width: 20, height: 20 };
    const result = clampRectToZone({ objLeft: 10, objTop: 90, bound, zone: ZONE });
    expect(result.top).toBe(80);
  });
});

describe('clampRectToZone — object wider than the zone (the reported bug)', () => {
  // zone x=0, width=100; object bound width=120 (wider than the zone)
  const zone = { x: 0, y: 0, width: 100, height: 100 };

  function boundAt(left) {
    return { left, top: 40, width: 120, height: 20 };
  }

  it('dragging right moves the clamped position right, not left', () => {
    const a = clampRectToZone({ objLeft: -10, objTop: 40, bound: boundAt(-10), zone });
    const b = clampRectToZone({ objLeft: -5, objTop: 40, bound: boundAt(-5), zone });
    const c = clampRectToZone({ objLeft: 0, objTop: 40, bound: boundAt(0), zone });
    const d = clampRectToZone({ objLeft: 5, objTop: 40, bound: boundAt(5), zone });

    // Dragging the raw input rightwards must never produce a leftward jump.
    expect(b.left).toBeGreaterThanOrEqual(a.left);
    expect(c.left).toBeGreaterThanOrEqual(b.left);
    expect(d.left).toBeGreaterThanOrEqual(c.left);
  });

  it('does not clamp the oversized axis at all — the object stays free to move', () => {
    // An object that cannot fit inside the zone on this axis has no valid
    // clamped position, so forcing one (e.g. "must keep covering the zone")
    // only traps it. The axis must pass the requested position through
    // untouched, across a range including far outside the zone, so the
    // merchant/customer can actually drag it back to safety.
    const positions = [-1000, -10, -5, 0, 5, 50, 100, 200, 390, 1000];
    for (const left of positions) {
      const result = clampRectToZone({ objLeft: left, objTop: 40, bound: boundAt(left), zone });
      expect(result.left).toBe(left);
    }
  });
});

describe('clampRectToZone — mixed axes: taller but not wider', () => {
  const zone = { x: 0, y: 0, width: 100, height: 100 };

  it('horizontal axis clamps normally while the oversized vertical axis is left free', () => {
    // bound: width 20 (fits), height 150 (oversized)
    const bound = { left: -50, top: -30, width: 20, height: 150 };
    const result = clampRectToZone({ objLeft: -50, objTop: -30, bound, zone });

    // Horizontal: the fitting axis still clamps exactly (bound.left < zone.x).
    expect(result.left).toBe(0);
    // Vertical: the oversized axis is not clamped at all.
    expect(result.top).toBe(-30);

    // Dragging further down on the oversized axis must keep tracking the input.
    const boundLower = { left: -50, top: -20, width: 20, height: 150 };
    const resultLower = clampRectToZone({ objLeft: -50, objTop: -20, bound: boundLower, zone });
    expect(resultLower.top).toBe(-20);
  });
});

describe('clampRectToZone — the exact reported case: 20×20 zone, ~100×40 object', () => {
  // Shop owner's report: a newly-added boundary defaults to 20×20; text
  // dropped into it is far larger on both axes and used to be pinned to 0
  // on every rightward drag.
  const zone = { x: 0, y: 0, width: 20, height: 20 };

  function boundAt(left, top) {
    return { left, top, width: 100, height: 40 };
  }

  it('dragging right actually moves the object right on both axes, never collapsing to 0', () => {
    const positions = [0, 50, 100, 200, 390];
    for (const pos of positions) {
      const result = clampRectToZone({
        objLeft: pos,
        objTop: pos,
        bound: boundAt(pos, pos),
        zone,
      });
      expect(result.left).toBe(pos);
      expect(result.top).toBe(pos);
    }
  });
});

describe('clampRectToZone — offset between objLeft/objTop and bound.left/bound.top', () => {
  const zone = { x: 0, y: 0, width: 100, height: 100 };

  it('respects a non-zero offset (e.g. rotated object, non-default origin)', () => {
    // objLeft is 5 units greater than bound.left (a constant offset for this object).
    const bound = { left: -30, top: 10, width: 20, height: 20 };
    const objLeft = -25; // offset = objLeft - bound.left = 5
    const result = clampRectToZone({ objLeft, objTop: 10, bound, zone });

    // Clamped bound.left should be 0 (zone.x), so clamped objLeft should be 0 + offset = 5.
    expect(result.left).toBe(5);
  });

  it('respects a non-zero vertical offset', () => {
    const bound = { left: 10, top: 90, width: 20, height: 20 };
    const objTop = 95; // offset = 5
    const result = clampRectToZone({ objLeft: 10, objTop, bound, zone });

    // Clamped bound.top should be 80 (zone.y + zone.height - height), so objTop = 85.
    expect(result.top).toBe(85);
  });
});
