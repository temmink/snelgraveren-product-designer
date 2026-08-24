import { objectSamplePoints, zoneShapePath, fitInsideZoneShape } from '../../../shared/js/zoneContainment';

describe('objectSamplePoints', () => {
  it('returns corners, edge midpoints and centre for a rect', () => {
    const pts = objectSamplePoints([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 },
    ]);
    expect(pts).toHaveLength(9);
    expect(pts).toContainEqual([0, 0]);
    expect(pts).toContainEqual([10, 20]);
    expect(pts).toContainEqual([5, 0]);   // top edge midpoint
    expect(pts).toContainEqual([10, 10]); // right edge midpoint
    expect(pts).toContainEqual([5, 10]);  // centre
  });

  it('handles rotated corner sets (no axis alignment assumed)', () => {
    const pts = objectSamplePoints([
      { x: 5, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 5 },
    ]);
    expect(pts).toContainEqual([7.5, 2.5]); // midpoint tl-tr
    expect(pts).toContainEqual([5, 5]);     // centre
  });

  it('returns [] for missing/invalid corners', () => {
    expect(objectSamplePoints(null)).toEqual([]);
    expect(objectSamplePoints([{ x: 0, y: 0 }])).toEqual([]);
  });
});

describe('zoneShapePath (jsdom has no Path2D)', () => {
  it('returns null without Path2D support instead of throwing', () => {
    expect(zoneShapePath({ svg_markup: '<svg><path d="M0 0L10 0L10 10Z"/></svg>' })).toBeNull();
  });
  it('returns null without markup', () => {
    expect(zoneShapePath({})).toBeNull();
    expect(zoneShapePath(null)).toBeNull();
  });
});

describe('fitInsideZoneShape', () => {
  // Real geometric predicates, injected via `isInside`, so containment is
  // actually exercised — the default `pointsInsideZoneShape` fails OPEN in
  // jsdom (no 2d context → always true), which would make every assertion
  // here pass regardless of what the code does.

  // A circle in canvas-space coordinates. `shape`/`zone` are ignored (the
  // fake "shape" IS the circle) — only `points`, which fits() already builds
  // in canvas space, matter.
  const insideCircle = (cx, cy, r) => (shape, zone, points) =>
    points.every(([x, y]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);

  const neverInside = () => () => false;

  // zone: a 200x200 box at the origin, bbox centre (100, 100).
  const zone = { x: 0, y: 0, width: 200, height: 200 };

  function cornerDistancesOk(cx, cy, r, left, top, width, height, scale) {
    const corners = [
      [left, top],
      [left + width * scale, top],
      [left + width * scale, top + height * scale],
      [left, top + height * scale],
    ];
    return corners.every(([x, y]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 1e-6);
  }

  it('object smaller than the shape: returned at maxScale, centred on the bbox centre', () => {
    const isInside = insideCircle(100, 100, 80);
    const result = fitInsideZoneShape({
      shape: 'circle', zone, width: 40, height: 40, isInside,
    });
    expect(result).not.toBeNull();
    expect(result.scale).toBe(1); // default maxScale
    // Centred on the zone bbox centre (100, 100), which the circle allows.
    expect(result.left + (40 * result.scale) / 2).toBeCloseTo(100, 5);
    expect(result.top + (40 * result.scale) / 2).toBeCloseTo(100, 5);
    expect(cornerDistancesOk(100, 100, 80, result.left, result.top, 40, 40, result.scale)).toBe(true);
  });

  it('object larger than the shape: scale is reduced, and the box genuinely passes the predicate', () => {
    const isInside = insideCircle(100, 100, 80);
    const result = fitInsideZoneShape({
      shape: 'circle', zone, width: 300, height: 300, isInside,
    });
    expect(result).not.toBeNull();
    expect(result.scale).toBeLessThan(1);
    expect(result.scale).toBeGreaterThan(0);
    // Independently re-derive containment from the returned box — do not
    // trust the internal fits() call that produced it.
    expect(cornerDistancesOk(100, 100, 80, result.left, result.top, 300, 300, result.scale)).toBe(true);
    // The theoretical largest scale for a square object inscribed corner-to-
    // -centre in this circle is r / (sqrt(2)/2 * side) = 80 / (300 * sqrt(2) / 2).
    const theoreticalMax = 80 / ((300 * Math.sqrt(2)) / 2);
    expect(result.scale).toBeCloseTo(theoreticalMax, 2);
  });

  it('bbox centre outside the contour (crescent-like off-centre shape): anchor moves to a point that is inside', () => {
    // Circle well away from the zone's bbox centre (100,100) — the centre
    // itself (distance 60 from (160,100)) is outside this "shape".
    const cx = 160;
    const cy = 100;
    const r = 30;
    const isInside = insideCircle(cx, cy, r);
    // Sanity: bbox centre really is outside the shape.
    expect(isInside(null, zone, [[100, 100]])).toBe(false);

    const result = fitInsideZoneShape({
      shape: 'circle', zone, width: 10, height: 10, isInside,
    });
    expect(result).not.toBeNull();
    const centreX = result.left + (10 * result.scale) / 2;
    const centreY = result.top + (10 * result.scale) / 2;
    // Anchor genuinely moved off the (unusable) bbox centre.
    expect(Math.hypot(centreX - 100, centreY - 100)).toBeGreaterThan(1);
    // And the returned box genuinely fits inside the shape.
    expect(cornerDistancesOk(cx, cy, r, result.left, result.top, 10, 10, result.scale)).toBe(true);
  });

  it('nothing fits even at minScale: returns null', () => {
    const result = fitInsideZoneShape({
      shape: 'circle', zone, width: 40, height: 40, isInside: neverInside(),
    });
    expect(result).toBeNull();
  });

  it('degenerate inputs return null without throwing', () => {
    expect(fitInsideZoneShape({ shape: null, zone, width: 10, height: 10 })).toBeNull();
    expect(fitInsideZoneShape({ shape: 'circle', zone, width: 0, height: 10 })).toBeNull();
    expect(fitInsideZoneShape({ shape: 'circle', zone, width: 10, height: 0 })).toBeNull();
    expect(() => fitInsideZoneShape({ shape: 'circle', zone: null, width: 10, height: 10 })).not.toThrow();
    expect(fitInsideZoneShape({ shape: 'circle', zone: null, width: 10, height: 10 })).toBeNull();
  });
});
