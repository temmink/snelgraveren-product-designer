import { svgMarkupIntrinsicSize, layerToBoundaryItem } from '../../../admin/js/template-builder/src/utils/layerBoundaryItems';
import { mergeLayersToBoundary } from '../../../admin/js/template-builder/src/utils/mergeLayersToBoundary';

describe('svgMarkupIntrinsicSize', () => {
  it('reads width/height attributes', () => {
    expect(svgMarkupIntrinsicSize('<svg width="60" height="40" viewBox="0 0 60 40"></svg>'))
      .toEqual({ width: 60, height: 40 });
  });
  it('falls back to viewBox when width/height are absent', () => {
    expect(svgMarkupIntrinsicSize('<svg viewBox="0 0 60 40"></svg>'))
      .toEqual({ width: 60, height: 40 });
  });
  it('returns zeros when unparseable', () => {
    expect(svgMarkupIntrinsicSize('<svg></svg>')).toEqual({ width: 0, height: 0 });
    expect(svgMarkupIntrinsicSize('')).toEqual({ width: 0, height: 0 });
  });
});

describe('layerToBoundaryItem', () => {
  const layer = (over) => ({
    type: 'svg',
    svg_markup: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0L10 0L10 10Z"/></svg>',
    left: 20, top: 5, scaleX: 2, scaleY: 2, ...over,
  });

  it('builds an item with on-canvas size = intrinsic * scale', () => {
    expect(layerToBoundaryItem(layer())).toEqual({
      svgMarkup: layer().svg_markup,
      left: 20, top: 5, width: 20, height: 20, scaleX: 2, scaleY: 2,
    });
  });
  it('defaults scale to 1 and left/top to 0', () => {
    const it = layerToBoundaryItem({ svg_markup: '<svg width="10" height="10"></svg>' });
    expect(it.scaleX).toBe(1); expect(it.scaleY).toBe(1);
    expect(it.left).toBe(0); expect(it.top).toBe(0);
    expect(it.width).toBe(10); expect(it.height).toBe(10);
  });
  it('returns null without svg_markup or parseable size', () => {
    expect(layerToBoundaryItem({ type: 'svg' })).toBeNull();
    expect(layerToBoundaryItem(null)).toBeNull();
    expect(layerToBoundaryItem({ svg_markup: '<svg></svg>' })).toBeNull();
  });
  it('feeds mergeLayersToBoundary: two layers → union bbox', () => {
    const items = [
      layerToBoundaryItem(layer({ left: 0, top: 0, scaleX: 1, scaleY: 1 })),   // 10x10 @ (0,0)
      layerToBoundaryItem(layer({ left: 90, top: 40, scaleX: 1, scaleY: 1 })), // 10x10 @ (90,40)
    ];
    const merged = mergeLayersToBoundary(items);
    expect(merged.x).toBe(0); expect(merged.y).toBe(0);
    expect(merged.width).toBe(100); expect(merged.height).toBe(50);
  });
});
