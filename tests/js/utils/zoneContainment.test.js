import { objectSamplePoints, zoneShapePath } from '../../../shared/js/zoneContainment';

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
