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

  it('positions each layer by baking translate into path coordinates, relative to the bbox top-left', () => {
    const r = mergeLayersToBoundary([
      item({ left: 20, top: 5, width: 10, height: 10 }),
      item({ left: 90, top: 40, width: 10, height: 10 }),
    ]);
    // bbox top-left is (20,5); each layer's path is offset by (left-minX, top-minY)
    expect(r.svg_markup).toContain('M0 0L10 0L10 10Z');   // first item at bbox origin (dx0,dy0)
    expect(r.svg_markup).toContain('M70 35L80 35L80 45Z'); // second item: 90-20, 40-5
    expect(r.svg_markup).toContain('viewBox="0 0 80 45"');
    // both source paths are present
    expect((r.svg_markup.match(/<path/g) || []).length).toBe(2);
    // no wrapping <g transform> anymore — coordinates are baked in directly
    expect(r.svg_markup).not.toContain('<g ');
    expect(r.svg_markup).not.toContain('translate');
    expect(r.svg_markup).not.toContain('scale(');
  });

  it('bakes each layer scale directly into its path coordinates', () => {
    const r = mergeLayersToBoundary([item({ left: 0, top: 0, width: 20, height: 20, scaleX: 2, scaleY: 2 })]);
    expect(r.svg_markup).toContain('M0 0L20 0L20 20Z');
    expect(r.svg_markup).not.toContain('scale(');
    expect(r.svg_markup).not.toContain('<g ');
    expect(r.width).toBe(20);
    expect(r.height).toBe(20);
  });

  it('bakes translate+scale through a C (curve) command', () => {
    const r = mergeLayersToBoundary([item({
      svgMarkup: '<svg><path d="M0 0C2 3 8 -3 10 0" fill="none"/></svg>',
      left: 0, top: 0, width: 10, height: 10, scaleX: 2, scaleY: 2,
    })]);
    expect(r.svg_markup).toContain('M0 0C4 6 16 -6 20 0');
  });

  it('extracts multiple paths from one layer', () => {
    const r = mergeLayersToBoundary([item({
      svgMarkup: '<svg><path d="M0 0L5 0"/><path d="M0 5L5 5"/></svg>',
    })]);
    expect((r.svg_markup.match(/<path/g) || []).length).toBe(2);
  });
});
