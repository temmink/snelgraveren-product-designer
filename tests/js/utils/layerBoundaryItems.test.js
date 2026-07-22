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

import { layerSubPathItems } from '../../../admin/js/template-builder/src/utils/layerBoundaryItems';

describe('layerSubPathItems', () => {
  const multi = {
    type: 'svg', left: 100, top: 50, scaleX: 2, scaleY: 2,
    svg_markup: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30">'
      + '<path d="M0 0L10 0L10 10Z" fill="none" stroke="#000000" stroke-width="1"/>'
      + '<path d="M20 10L40 10L40 30Z" fill="none" stroke="#ff0000" stroke-width="1"/></svg>',
  };

  it('splits a multi-path layer into one entry per path with exact local bboxes', () => {
    const subs = layerSubPathItems(multi);
    expect(subs.length).toBe(2);
    expect(subs[0].bbox).toEqual({ minX: 0, minY: 0, width: 10, height: 10 });
    expect(subs[1].bbox).toEqual({ minX: 20, minY: 10, width: 20, height: 20 });
  });

  it('builds canvas-space items usable by mergeLayersToBoundary', () => {
    const it2 = layerSubPathItems(multi)[1].item;
    expect(it2.left).toBe(100 + 20 * 2);   // layer.left + bboxMinX * scaleX
    expect(it2.top).toBe(50 + 10 * 2);
    expect(it2.width).toBe(40);            // 20 * scaleX
    expect(it2.height).toBe(40);
    // path data rebased to its own bbox origin
    expect(it2.svgMarkup).toContain('M0 0L20 0L20 20Z');
    const merged = mergeLayersToBoundary([it2]);
    expect(merged.x).toBe(140);
    expect(merged.y).toBe(70);
    expect(merged.width).toBe(40);
  });

  it('includes bezier extrema in sub-path bboxes', () => {
    const l = {
      ...multi,
      svg_markup: '<svg width="10" height="3" viewBox="0 0 10 3">'
        + '<path d="M0 3C0 -1 10 -1 10 3" fill="none" stroke="#000" stroke-width="1"/></svg>',
    };
    const subs = layerSubPathItems(l);
    expect(subs[0].bbox.minY).toBeCloseTo(0, 5);   // curve peak, above both endpoints (y=3)
    expect(subs[0].bbox.height).toBeCloseTo(3, 5);
  });

  it('keeps the original path (with stroke colour) in a tight-viewBox thumb markup', () => {
    const subs = layerSubPathItems(multi);
    expect(subs[1].thumbMarkup).toContain('viewBox="20 10 20 20"');
    expect(subs[1].thumbMarkup).toContain('stroke="#ff0000"');
  });

  it('returns a single entry for a single-path layer and [] without markup', () => {
    const single = { ...multi, svg_markup: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0L10 0L10 10Z" fill="none"/></svg>' };
    expect(layerSubPathItems(single).length).toBe(1);
    expect(layerSubPathItems({ type: 'svg' })).toEqual([]);
  });
});
