import { vertPrimToPathData, qtFontToFamily, layerColor } from '../../../admin/js/template-builder/src/utils/lbrnParser';

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

describe('qtFontToFamily', () => {
  it('reads family and normal weight from a Qt font string', () => {
    expect(qtFontToFamily('Arial,-1,4096,5,400,0,0,0,0,0'))
      .toEqual({ family: 'Arial', weight: 400 });
  });
  it('maps Qt weight >= 600 to bold (700)', () => {
    expect(qtFontToFamily('Arial,-1,4096,5,700,0,0,0,0,0'))
      .toEqual({ family: 'Arial', weight: 700 });
  });
  it('falls back to Arial/400 for empty input', () => {
    expect(qtFontToFamily('')).toEqual({ family: 'Arial', weight: 400 });
  });
});

describe('layerColor', () => {
  it('returns a hex colour and differs between indices', () => {
    expect(layerColor(0)).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(layerColor(0)).not.toBe(layerColor(2));
  });
  it('wraps indices beyond the palette', () => {
    expect(layerColor(30)).toBe(layerColor(0));
  });
});

import fs from 'fs';
import path from 'path';
import { parseLbrn } from '../../../admin/js/template-builder/src/utils/lbrnParser';

const FIXTURE = fs.readFileSync(
  path.join(__dirname, '../fixtures/test_svg_import.lbrn2'), 'utf8'
);

describe('parseLbrn (sample file)', () => {
  it('imports the editable "Bobbie" text when Arial is available', () => {
    const { layers } = parseLbrn(FIXTURE, { availableFonts: ['Arial'] });
    const text = layers.find((l) => l.type === 'text');
    expect(text).toBeTruthy();
    expect(text.text).toBe('Bobbie');
    expect(text.fontFamily).toBe('Arial');
    expect(text.fontSize).toBeGreaterThan(0);
    expect(Number.isFinite(text.left)).toBe(true);
    expect(Number.isFinite(text.top)).toBe(true);
  });

  it('imports the two paths as inline svg layers with markup', () => {
    const { layers } = parseLbrn(FIXTURE, { availableFonts: ['Arial'] });
    const svgs = layers.filter((l) => l.type === 'svg');
    expect(svgs.length).toBe(2);
    svgs.forEach((s) => {
      expect(s.svg_markup).toMatch(/<svg[\s\S]*<path[\s\S]*<\/svg>/);
      expect(s.svg_markup).toMatch(/stroke="#/);
    });
  });

  it('reports a positive physical width and origin-normalised layers', () => {
    const { widthMm, heightMm, layers } = parseLbrn(FIXTURE, { availableFonts: ['Arial'] });
    expect(widthMm).toBeGreaterThan(0);
    expect(heightMm).toBeGreaterThan(0);
    layers.forEach((l) => { expect(l.left).toBeGreaterThanOrEqual(0); expect(l.top).toBeGreaterThanOrEqual(0); });
  });

  it('falls back to an outline svg layer + warning when the font is unavailable', () => {
    const { layers, warnings } = parseLbrn(FIXTURE, { availableFonts: [] });
    expect(layers.some((l) => l.type === 'text')).toBe(false);
    expect(layers.filter((l) => l.type === 'svg').length).toBe(3); // 2 paths + text outline
    expect(warnings.join(' ')).toMatch(/Arial/);
  });
});
