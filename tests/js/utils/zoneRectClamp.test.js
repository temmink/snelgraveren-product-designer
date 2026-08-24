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

  it('still covers the zone at both extremes of its travel', () => {
    // Far left drag: object's right edge must not retreat past the zone's left edge,
    // and far right drag: object's left edge must not advance past the zone's right edge.
    const farLeft = clampRectToZone({ objLeft: -1000, objTop: 40, bound: boundAt(-1000), zone });
    const farRight = clampRectToZone({ objLeft: 1000, objTop: 40, bound: boundAt(1000), zone });

    // bound.left == objLeft here (no offset), so we can reason directly in bound space.
    expect(farLeft.left).toBeLessThanOrEqual(zone.x); // left edge still at/left of zone start
    expect(farLeft.left + 120).toBeGreaterThanOrEqual(zone.x + zone.width); // still covers full zone width... actually right edge must be >= zone.x (covering)
    expect(farRight.left).toBeGreaterThanOrEqual(zone.x + zone.width - 120);
  });
});

describe('clampRectToZone — mixed axes: taller but not wider', () => {
  const zone = { x: 0, y: 0, width: 100, height: 100 };

  it('horizontal axis clamps normally while vertical axis uses the oversized rule', () => {
    // bound: width 20 (fits), height 150 (oversized)
    const bound = { left: -50, top: -30, width: 20, height: 150 };
    const result = clampRectToZone({ objLeft: -50, objTop: -30, bound, zone });

    // Horizontal: normal clamp to left edge (bound.left < zone.x)
    expect(result.left).toBe(0);

    // Vertical: oversized rule — dragging further down should not reverse direction.
    const boundLower = { left: -50, top: -20, width: 20, height: 150 };
    const resultLower = clampRectToZone({ objLeft: -50, objTop: -20, bound: boundLower, zone });
    expect(resultLower.top).toBeGreaterThanOrEqual(result.top);
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
