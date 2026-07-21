import { vertPrimToPathData } from '../../../admin/js/template-builder/src/utils/lbrnParser';

describe('vertPrimToPathData', () => {
  it('builds a closed triangle from line primitives (Z instead of the closing line)', () => {
    expect(vertPrimToPathData('V0 0V10 0V10 10', 'L0 1L1 2L2 0'))
      .toBe('M0 0L10 0L10 10Z');
  });

  it('builds a cubic bezier using a.c1 (outgoing) and b.c0 (incoming) handles', () => {
    expect(vertPrimToPathData('V0 0c1x2c1y3V10 0c0x8c0y-3', 'B0 1'))
      .toBe('M0 0C2 3 8 -3 10 0');
  });

  it('defaults a missing handle component to the vertex coordinate', () => {
    // vertex 0 has only c1x=5 → c1y defaults to y (0)
    expect(vertPrimToPathData('V0 0c1x5V10 0c0x5', 'B0 1'))
      .toBe('M0 0C5 0 5 0 10 0');
  });

  it('applies the optional transform to every point', () => {
    const shift = (x, y) => [x + 100, y + 1];
    expect(vertPrimToPathData('V0 0V10 0V10 10', 'L0 1L1 2L2 0', shift))
      .toBe('M100 1L110 1L110 11Z');
  });
});
