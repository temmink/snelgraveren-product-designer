import { mergeLayersToBoundary } from '../../../admin/js/template-builder/src/utils/mergeLayersToBoundary';

const item = (over) => ({
  svgMarkup: '<svg viewBox="0 0 10 10"><path d="M0 0L10 0L10 10Z" fill="none" stroke="#e00"/></svg>',
  left: 0, top: 0, width: 10, height: 10, scaleX: 1, scaleY: 1, ...over,
});

describe('mergeLayersToBoundary', () => {
  it('returns null for empty input', () => {
    expect(mergeLayersToBoundary([])).toBeNull();
  });

  it('returns null when no item has a <path>', () => {
    expect(mergeLayersToBoundary([item({ svgMarkup: '<svg></svg>' })])).toBeNull();
  });

  it('unions the bounding box across two offset layers', () => {
    const r = mergeLayersToBoundary([
      item({ left: 0, top: 0, width: 10, height: 10 }),
      item({ left: 90, top: 40, width: 10, height: 10 }),
    ]);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.width).toBe(100);   // 90 + 10 - 0
    expect(r.height).toBe(50);   // 40 + 10 - 0
  });

  it('positions each layer via a translate group relative to the bbox top-left', () => {
    const r = mergeLayersToBoundary([
      item({ left: 20, top: 5, width: 10, height: 10 }),
      item({ left: 90, top: 40, width: 10, height: 10 }),
    ]);
    // bbox top-left is (20,5); groups are offset by (left-minX, top-minY)
    expect(r.svg_markup).toContain('translate(0 0)');    // first item at bbox origin
    expect(r.svg_markup).toContain('translate(70 35)');  // second item: 90-20, 40-5
    expect(r.svg_markup).toContain('viewBox="0 0 80 45"');
    // both source paths are present
    expect((r.svg_markup.match(/<path/g) || []).length).toBe(2);
  });

  it('bakes each layer scale into its group transform', () => {
    const r = mergeLayersToBoundary([item({ left: 0, top: 0, width: 20, height: 20, scaleX: 2, scaleY: 2 })]);
    expect(r.svg_markup).toContain('scale(2 2)');
    expect(r.width).toBe(20);
    expect(r.height).toBe(20);
  });

  it('extracts multiple paths from one layer', () => {
    const r = mergeLayersToBoundary([item({
      svgMarkup: '<svg><path d="M0 0L5 0"/><path d="M0 5L5 5"/></svg>',
    })]);
    expect((r.svg_markup.match(/<path/g) || []).length).toBe(2);
  });
});
