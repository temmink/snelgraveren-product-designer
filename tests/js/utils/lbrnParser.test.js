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

  it('treats a lone control-x (LightBurn straight-segment marker) as vertex-coincident', () => {
    // `c1x5` / `c0x5` have no paired y → they are LightBurn's "this side is
    // straight" markers, so the controls stay at their vertices (0,0)/(10,0),
    // not at the literal x=5. The bezier degenerates to a straight line.
    expect(vertPrimToPathData('V0 0c1x5V10 0c0x5', 'B0 1'))
      .toBe('M0 0C0 0 10 0 10 0');
  });

  it('uses a control point only when both its x and y are given', () => {
    // c1 of vertex 0 has x AND y → real control (2,3); c0 of vertex 1 has x AND
    // y → real control (8,-3). (Same as the bezier test but asserts the pairing rule.)
    expect(vertPrimToPathData('V0 0c1x2c1y3V10 0c0x8c0y-3', 'B0 1'))
      .toBe('M0 0C2 3 8 -3 10 0');
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

  it('pins the exact left/top of the second path shape (transform composition regression)', () => {
    // Golden values computed from the (fixed) implementation itself — see
    // task-3-report.md for the derivation command. Pins the affine + bbox math
    // so a future regression can't silently drift while still passing `>= 0`.
    const { layers } = parseLbrn(FIXTURE, { availableFonts: ['Arial'] });
    const svgs = layers.filter((l) => l.type === 'svg');
    expect(svgs[1].left).toBe(65.438);
    expect(svgs[1].top).toBe(9.561);
  });
});

describe('parseLbrn (XForm scoping — Text shape with HasBackupPath)', () => {
  const XFORM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="2.1.03">
    <Shape Type="Text" CutIndex="0" Font="Arial,-1,4096,5,400,0,0,0,0,0" Str="Hi" H="10" HasBackupPath="1">
        <BackupPath Type="Path" CutIndex="0">
            <XForm>1 0 0 1 0 0</XForm>
            <VertList>V0 0V10 0V10 10</VertList>
            <PrimList>L0 1L1 2L2 0</PrimList>
        </BackupPath>
        <XForm>1 0 0 1 1000 1000</XForm>
    </Shape>
</LightBurnProject>`;

  it('places the text using the SHAPE\'S OWN XForm, not the nested BackupPath XForm', () => {
    const { layers } = parseLbrn(XFORM_FIXTURE, { availableFonts: ['Arial'] });
    const text = layers.find((l) => l.type === 'text');
    expect(text).toBeTruthy();
    // Only one shape exists, so bbox origin == the shape's own origin → left/top must be 0,0.
    // If the parser mistakenly reads the BackupPath's XForm (identity, translate 0 0)
    // instead of the shape's own (translate 1000 1000), this still passes coincidentally
    // for a single-shape bbox, so we assert against the un-normalised origin directly
    // via widthMm/heightMm being 0 (single point) AND by checking a second shape anchors
    // relative to it below.
    // Horizontal origin (Ah=0) is the left edge → 0 for a single-shape design.
    expect(text.left).toBe(0);
    // Vertical anchor centres the text box on its origin, so top = -fontSize/2
    // (fontSize = H(10mm) * PX_PER_MM = 37.795 → -18.898). The value being 0-based
    // (not offset by the BackupPath's identity XForm) is what proves the own XForm was used.
    expect(text.top).toBe(-18.898);
  });

  it('regression: a second, differently-positioned path shape proves the OWN XForm (not BackupPath) was used', () => {
    // Add a plain Path shape at machine-space (0,0)-(10,10) with an identity XForm.
    // The Text shape's OWN XForm translates by (1000, 1000mm). If the parser bug reads
    // the BackupPath's XForm (identity, i.e. (0,0)) for the text's origin instead of the
    // shape's own (1000, 1000), the text will incorrectly collapse onto the same origin
    // as the path shape, making their bbox-relative positions equal (both near 0,0).
    // With the fix, the text origin is offset by ~1000mm × PX_PER_MM from the path.
    const xmlWithPath = XFORM_FIXTURE.replace(
      '</LightBurnProject>',
      `    <Shape Type="Path" CutIndex="0">
        <XForm>1 0 0 1 0 0</XForm>
        <VertList>V0 0V10 0V10 10</VertList>
        <PrimList>L0 1L1 2L2 0</PrimList>
    </Shape>
</LightBurnProject>`
    );
    const { layers } = parseLbrn(xmlWithPath, { availableFonts: ['Arial'] });
    const text = layers.find((l) => l.type === 'text');
    const svg = layers.find((l) => l.type === 'svg');
    expect(text).toBeTruthy();
    expect(svg).toBeTruthy();
    // Text origin (machine space) is (1000,1000)mm; path origin is (0,0)mm.
    // Buggy code (unscoped querySelector('XForm') finds BackupPath's XForm first)
    // would place the text at the SAME origin as the path (left/top both 0).
    // Fixed code must place the text ~1000mm × PX_PER_MM away from the path.
    const PX_PER_MM = 3.7795;
    expect(text.left).toBeCloseTo(1000 * PX_PER_MM, 0);
    expect(svg.left).toBe(0);
  });
});

describe('parseLbrn (invalid XML)', () => {
  it('throws on a document that is not a LightBurn project', () => {
    expect(() => parseLbrn('<not-lightburn/>', { availableFonts: [] })).toThrow();
  });

  it('throws on malformed (unparseable) XML', () => {
    expect(() => parseLbrn('<LightBurnProject><unclosed>', { availableFonts: [] })).toThrow();
  });
});

describe('parseLbrn (group descent)', () => {
  it('imports a Path shape nested inside a Group as a single svg layer', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="2.1.03">
    <Shape Type="Group" CutIndex="0">
        <Shape Type="Path" CutIndex="0">
            <XForm>1 0 0 1 0 0</XForm>
            <VertList>V0 0V10 0V10 10</VertList>
            <PrimList>L0 1L1 2L2 0</PrimList>
        </Shape>
    </Shape>
</LightBurnProject>`;
    const { layers, warnings } = parseLbrn(xml, { availableFonts: [] });
    const svgs = layers.filter((l) => l.type === 'svg');
    expect(svgs.length).toBe(1);
    expect(warnings.length).toBe(0);
  });
});

describe('parseLbrn (bitmap warning)', () => {
  it('skips a Bitmap shape and warns about it', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="2.1.03">
    <Shape Type="Bitmap" CutIndex="0">
        <XForm>1 0 0 1 0 0</XForm>
    </Shape>
</LightBurnProject>`;
    const { layers, warnings } = parseLbrn(xml, { availableFonts: [] });
    expect(layers.length).toBe(0);
    expect(warnings.join(' ')).toMatch(/bitmap/i);
  });
});
