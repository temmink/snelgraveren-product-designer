import { vertPrimToPathData, qtFontToFamily, layerColor } from '../../../admin/js/template-builder/src/utils/lbrnParser';

describe('vertPrimToPathData', () => {
  it('builds a closed triangle from line primitives (Z instead of the closing line)', () => {
    expect(vertPrimToPathData('V0 0V10 0V10 10', 'L0 1L1 2L2 0'))
      .toBe('M0 0L10 0L10 10Z');
  });

  it('builds a cubic bezier using a.c0 (outgoing) and b.c1 (incoming) handles', () => {
    // For `B a b`: first control = vertex a's OUTGOING handle (c0), second
    // control = vertex b's INCOMING handle (c1).
    expect(vertPrimToPathData('V0 0c0x2c0y3V10 0c1x8c1y-3', 'B0 1'))
      .toBe('M0 0C2 3 8 -3 10 0');
  });

  it('treats a lone control-x (LightBurn straight-segment marker) as vertex-coincident', () => {
    // `c0x5` / `c1x5` have no paired y → they are LightBurn's "this side is
    // straight" markers, so the used controls (a.c0, b.c1) stay at their
    // vertices (0,0)/(10,0), not at the literal x=5 → the bezier is straight.
    expect(vertPrimToPathData('V0 0c0x5V10 0c1x5', 'B0 1'))
      .toBe('M0 0C0 0 10 0 10 0');
  });

  it('uses a control point only when both its x and y are given', () => {
    // a.c0 has x AND y → real outgoing control (2,3); b.c1 has x AND y → real
    // incoming control (8,-3). (Asserts the x/y pairing rule.)
    expect(vertPrimToPathData('V0 0c0x2c0y3V10 0c1x8c1y-3', 'B0 1'))
      .toBe('M0 0C2 3 8 -3 10 0');
  });

  it('decodes the LineClosed keyword as a closed straight polygon through all verts', () => {
    expect(vertPrimToPathData('V0 0V10 0V10 10', 'LineClosed'))
      .toBe('M0 0L10 0L10 10Z');
  });

  it('decodes the Line keyword as an open polyline', () => {
    expect(vertPrimToPathData('V0 0V10 0V10 10', 'Line'))
      .toBe('M0 0L10 0L10 10');
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
import { parseLbrn, decodePngSize, PX_PER_MM } from '../../../admin/js/template-builder/src/utils/lbrnParser';

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
    // Golden values computed from the implementation itself. Pins the affine +
    // bbox math so a future regression can't silently drift while still
    // passing `>= 0`. Re-derived after the bezier-extents bbox fix (the bbox
    // now includes exact curve extrema, not just vertices).
    const { layers } = parseLbrn(FIXTURE, { availableFonts: ['Arial'] });
    const svgs = layers.filter((l) => l.type === 'svg');
    expect(svgs[1].left).toBe(65.071);
    expect(svgs[1].top).toBe(9.723);
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

describe('parseLbrn (group merge — one svg layer per LightBurn group)', () => {
  const TRI = (own, cut) => `      <Shape Type="Path" CutIndex="${cut}">
        <XForm>${own}</XForm>
        <VertList>V0 0V10 0V10 10</VertList>
        <PrimList>L0 1L1 2L2 0</PrimList>
      </Shape>`;
  const wrap = (inner) => `<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="2.1.03">
${inner}
</LightBurnProject>`;

  it('merges all paths of one group into a single multi-path svg layer with per-cut colours', () => {
    const xml = wrap(`  <Shape Type="Group" CutIndex="0">
    <XForm>1 0 0 1 0 0</XForm>
    <Children>
${TRI('1 0 0 1 0 0', 0)}
${TRI('1 0 0 1 20 0', 2)}
    </Children>
  </Shape>`);
    const { layers, widthMm } = parseLbrn(xml, { availableFonts: [] });
    const svgs = layers.filter((l) => l.type === 'svg');
    expect(svgs.length).toBe(1);                                   // one layer, not two
    expect((svgs[0].svg_markup.match(/<path/g) || []).length).toBe(2);
    expect(svgs[0].svg_markup).toContain('stroke="#000000"');      // cut 0
    expect(svgs[0].svg_markup).toContain('stroke="#ff0000"');      // cut 2
    expect(svgs[0].left).toBe(0);
    expect(widthMm).toBe(30);                                      // union spans both triangles
  });

  it('keeps ungrouped shapes as individual layers next to a merged group', () => {
    const xml = wrap(`  <Shape Type="Group" CutIndex="0">
    <XForm>1 0 0 1 0 0</XForm>
    <Children>
${TRI('1 0 0 1 0 0', 0)}
${TRI('1 0 0 1 20 0', 0)}
    </Children>
  </Shape>
${TRI('1 0 0 1 50 0', 1)}`);
    const { layers } = parseLbrn(xml, { availableFonts: [] });
    const svgs = layers.filter((l) => l.type === 'svg');
    expect(svgs.length).toBe(2); // merged group + the loose shape
  });

  it('merges nested groups into the top-level group layer', () => {
    const xml = wrap(`  <Shape Type="Group" CutIndex="0">
    <XForm>1 0 0 1 0 0</XForm>
    <Children>
${TRI('1 0 0 1 0 0', 0)}
      <Shape Type="Group" CutIndex="0">
        <XForm>1 0 0 1 20 0</XForm>
        <Children>
${TRI('1 0 0 1 0 0', 0)}
        </Children>
      </Shape>
    </Children>
  </Shape>`);
    const { layers } = parseLbrn(xml, { availableFonts: [] });
    const svgs = layers.filter((l) => l.type === 'svg');
    expect(svgs.length).toBe(1);
    expect((svgs[0].svg_markup.match(/<path/g) || []).length).toBe(2);
  });

  it('keeps editable text inside a group as a separate text layer', () => {
    const xml = wrap(`  <Shape Type="Group" CutIndex="0">
    <XForm>1 0 0 1 0 0</XForm>
    <Children>
${TRI('1 0 0 1 0 0', 0)}
      <Shape Type="Text" CutIndex="0" Font="Arial,-1,4096,5,400,0,0,0,0,0" Str="Hi" H="10">
        <XForm>1 0 0 1 5 5</XForm>
      </Shape>
    </Children>
  </Shape>`);
    const { layers } = parseLbrn(xml, { availableFonts: ['Arial'] });
    expect(layers.filter((l) => l.type === 'svg').length).toBe(1);
    expect(layers.filter((l) => l.type === 'text').length).toBe(1);
  });
});

describe('parseLbrn (bezier curve extents in bbox)', () => {
  // A bezier bump whose curve peaks 3mm above its two vertices, overlaid on a
  // straight rect that exactly covers the curve's TRUE bounds. In LightBurn
  // both shapes coincide. A vertex-only bbox misses the curve overshoot and
  // shifts the bezier layer down relative to the rect (the "misaligned cut
  // layers" import bug).
  const RECT = `  <Shape Type="Path" CutIndex="0">
    <XForm>1 0 0 1 0 0</XForm>
    <VertList>V0 -3V10 -3V10 0V0 0</VertList>
    <PrimList>L0 1L1 2L2 3L3 0</PrimList>
  </Shape>`;
  // Cubic (0,0)→(10,0) with handles (0,-4)/(10,-4): peak at y=-3 (t=0.5).
  const BEZIER = `  <Shape Type="Path" CutIndex="1">
    <XForm>1 0 0 1 0 0</XForm>
    <VertList>V0 0c0x0c0y-4V10 0c1x10c1y-4</VertList>
    <PrimList>B0 1</PrimList>
  </Shape>`;
  const wrap = (shapes) => `<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="2.1.03">
${shapes}
</LightBurnProject>`;

  it('positions a curve-overshooting bezier at the same top/left as a rect covering its true bounds', () => {
    const { layers } = parseLbrn(wrap(RECT + '\n' + BEZIER), { availableFonts: [] });
    const [rect, bez] = layers;
    expect(bez.top).toBeCloseTo(rect.top, 2);   // both 0 — curve peak == rect top
    expect(bez.left).toBeCloseTo(rect.left, 2);
    // Declared height must cover the true curve (3mm), not the 1px vertex fallback.
    const h = parseFloat(bez.svg_markup.match(/height="([\d.]+)"/)[1]);
    expect(h).toBeCloseTo(3 * 3.7795, 1);
  });

  it('includes curve extrema in the overall design bounds (single bezier shape)', () => {
    const { heightMm } = parseLbrn(wrap(BEZIER), { availableFonts: [] });
    expect(heightMm).toBeCloseTo(3, 2); // vertex-only bbox would report 0
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

describe('parseLbrn (grouped + shared geometry)', () => {
  it('composes group XForms and resolves shared PrimID geometry from the pool', () => {
    // Two groups at different offsets; the second shape carries only its VertID/
    // PrimID and shares the PrimList of the first via the pool.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="2.1.03">
  <Shape Type="Group" CutIndex="0">
    <XForm>1 0 0 1 0 0</XForm>
    <Children>
      <Shape Type="Path" CutIndex="0" VertID="1" PrimID="7">
        <XForm>1 0 0 1 0 0</XForm>
        <VertList>V0 0V10 0V10 10</VertList>
        <PrimList>L0 1L1 2L2 0</PrimList>
      </Shape>
    </Children>
  </Shape>
  <Shape Type="Group" CutIndex="0">
    <XForm>1 0 0 1 100 0</XForm>
    <Children>
      <Shape Type="Path" CutIndex="0" VertID="2" PrimID="7">
        <XForm>1 0 0 1 0 0</XForm>
        <VertList>V0 0V10 0V10 10</VertList>
      </Shape>
    </Children>
  </Shape>
</LightBurnProject>`;
    const { layers, widthMm, warnings } = parseLbrn(xml, { availableFonts: [] });
    const svgs = layers.filter((l) => l.type === 'svg');
    // Both shapes import (2nd resolved its PrimList from the pool → not skipped).
    expect(svgs.length).toBe(2);
    // Group (100,0) composed onto the 2nd shape → design spans x 0..110, not 0..10.
    expect(widthMm).toBe(110);
    expect(warnings.length).toBe(0);
  });
});

describe('decodePngSize', () => {
  // A 1x1 transparent PNG. Bytes 16-23 of a PNG are the IHDR width and height.
  const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('reads width and height from the PNG IHDR header', () => {
    expect(decodePngSize(PNG_1X1)).toEqual({ width: 1, height: 1 });
  });

  it('returns null for a non-PNG payload', () => {
    // JPEG magic bytes FFD8FF, padded to a valid base64 length.
    expect(decodePngSize('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJ')).toBeNull();
  });

  it('returns null for garbage', () => {
    expect(decodePngSize('not base64 at all!!')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(decodePngSize('')).toBeNull();
  });
});

describe('parseLbrn (bitmap shapes)', () => {
  const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const wrap = (inner) => `<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="2.1.03">
${inner}
</LightBurnProject>`;

  // A 20mm x 10mm bitmap centred at machine (100, 50), unrotated and unscaled.
  const BITMAP = (attrs = '', xform = '1 0 0 1 100 50') =>
    `  <Shape Type="Bitmap" CutIndex="0" W="20" H="10" Data="${PNG_1X1}"${attrs}>
    <XForm>${xform}</XForm>
  </Shape>`;

  // A 40mm x 20mm rect spanning machine x 80..120, y 40..60 — same centre as BITMAP.
  const RECT = `  <Shape Type="Path" CutIndex="0">
    <XForm>1 0 0 1 80 40</XForm>
    <VertList>V0 0V40 0V40 20V0 20</VertList>
    <PrimList>LineClosed</PrimList>
  </Shape>`;

  it('imports a bitmap as an image layer instead of warning', () => {
    const { layers, warnings } = parseLbrn(wrap(BITMAP()), { availableFonts: [] });
    expect(warnings).toEqual([]);
    const img = layers.find((l) => l.type === 'image');
    expect(img).toBeTruthy();
    expect(img.dataUrl).toBe(`data:image/png;base64,${PNG_1X1}`);
    expect(img.pngWidth).toBe(1);
    expect(img.pngHeight).toBe(1);
  });

  it('anchors the image on its centre, not its corner', () => {
    const { layers } = parseLbrn(wrap(BITMAP()), { availableFonts: [] });
    const img = layers.find((l) => l.type === 'image');
    expect(img.originX).toBe('center');
    expect(img.originY).toBe('center');
    // Alone on the canvas the union bbox is the bitmap itself: 20x10 mm, so
    // the centre sits at half of each side, in pixels.
    expect(img.left).toBeCloseTo(10 * PX_PER_MM, 1);
    expect(img.top).toBeCloseTo(5 * PX_PER_MM, 1);
  });

  it('scales the 1px PNG up to its physical millimetre size', () => {
    const { layers } = parseLbrn(wrap(BITMAP()), { availableFonts: [] });
    const img = layers.find((l) => l.type === 'image');
    expect(img.scaleX).toBeCloseTo(20 * PX_PER_MM, 1); // 20mm across 1 source pixel
    expect(img.scaleY).toBeCloseTo(10 * PX_PER_MM, 1);
  });

  it('multiplies W/H by the XForm scale to find the final size', () => {
    // W/H are the LOCAL size. XForm scale 2 doubles them, so a W=20 bitmap is
    // 40mm wide on the machine: corners at 100 +/- 20, and the image layer
    // must be scaled to 40mm, not 20 (and certainly not 10).
    const { layers, widthMm, heightMm } = parseLbrn(wrap(BITMAP('', '2 0 0 2 100 50')), { availableFonts: [] });
    expect(widthMm).toBeCloseTo(40, 3);
    expect(heightMm).toBeCloseTo(20, 3);
    const img = layers.find((l) => l.type === 'image');
    expect(img.scaleX).toBeCloseTo(40 * PX_PER_MM, 1); // 40mm across 1 source pixel
    expect(img.scaleY).toBeCloseTo(20 * PX_PER_MM, 1);
  });

  it('keeps the scale magnitude when the XForm also rotates', () => {
    // 90 degrees at scale 2: [a,b,c,d] = [0,2,-2,0]. Final size is still
    // 40 x 20 mm, but rotated, so the bbox is 20 wide and 40 tall.
    const { layers, widthMm, heightMm } = parseLbrn(wrap(BITMAP('', '0 2 -2 0 100 50')), { availableFonts: [] });
    expect(widthMm).toBeCloseTo(20, 3);
    expect(heightMm).toBeCloseTo(40, 3);
    const img = layers.find((l) => l.type === 'image');
    expect(img.angle).toBeCloseTo(90, 3);
    expect(img.scaleX).toBeCloseTo(40 * PX_PER_MM, 1);
    expect(img.scaleY).toBeCloseTo(20 * PX_PER_MM, 1);
  });

  it('reports the rotation from the XForm', () => {
    // 90 degrees: [a,b,c,d] = [0,1,-1,0].
    const { layers } = parseLbrn(wrap(BITMAP('', '0 1 -1 0 100 50')), { availableFonts: [] });
    const img = layers.find((l) => l.type === 'image');
    expect(img.angle).toBeCloseTo(90, 3);
  });

  it('widens the union bbox when the bitmap extends past the vectors', () => {
    // A 60mm-wide bitmap centred on a 40mm-wide rect must win the union.
    const wide = `  <Shape Type="Bitmap" CutIndex="0" W="60" H="10" Data="${PNG_1X1}">
    <XForm>1 0 0 1 100 50</XForm>
  </Shape>`;
    const { widthMm } = parseLbrn(wrap(RECT + '\n' + wide), { availableFonts: [] });
    expect(widthMm).toBeCloseTo(60, 3);
  });

  it('places the bitmap layer before the vector layers', () => {
    const { layers } = parseLbrn(wrap(RECT + '\n' + BITMAP()), { availableFonts: [] });
    expect(layers[0].type).toBe('image');
  });

  it('warns and skips a non-PNG bitmap', () => {
    const jpeg = `  <Shape Type="Bitmap" CutIndex="0" W="20" H="10" Data="/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJ">
    <XForm>1 0 0 1 100 50</XForm>
  </Shape>`;
    const { layers, warnings } = parseLbrn(wrap(jpeg), { availableFonts: [] });
    expect(layers.some((l) => l.type === 'image')).toBe(false);
    expect(warnings.join(' ')).toMatch(/only PNG/i);
  });

  it('warns and skips a bitmap with no physical size', () => {
    const zero = `  <Shape Type="Bitmap" CutIndex="0" W="0" H="0" Data="${PNG_1X1}">
    <XForm>1 0 0 1 100 50</XForm>
  </Shape>`;
    const { layers, warnings } = parseLbrn(wrap(zero), { availableFonts: [] });
    expect(layers.some((l) => l.type === 'image')).toBe(false);
    expect(warnings.join(' ')).toMatch(/size/i);
  });
});

// The user's own file: a 800x386 PNG placed on a plank outline. Its Bitmap
// shape carries W="211.64021" H="102.1164" with an XForm scale of 1.89 —
// 211.64021 x 1.89 = 400.000 mm exactly, which is what LightBurn shows.
describe('parseLbrn (arcacia.lbrn2 — real LightBurn file)', () => {
  const ARCACIA = fs.readFileSync(
    path.join(__dirname, '../fixtures/arcacia.lbrn2'), 'utf8'
  );
  const parsed = () => parseLbrn(ARCACIA, { availableFonts: [] });

  it('renders the bitmap at the 400.00 x 193.00 mm LightBurn shows, not its unscaled 211 mm W', () => {
    const { layers, warnings } = parsed();
    expect(warnings).toEqual([]);
    const img = layers.find((l) => l.type === 'image');
    expect(img.pngWidth).toBe(800);
    expect(img.pngHeight).toBe(386);
    // The rendered size is scale x source pixels, back into millimetres.
    expect((img.scaleX * img.pngWidth) / PX_PER_MM).toBeCloseTo(400.00, 1);
    expect((img.scaleY * img.pngHeight) / PX_PER_MM).toBeCloseTo(193.00, 1);
    expect(img.scaleX).toBeCloseTo((400 * PX_PER_MM) / 800, 2); // 1.88975
    expect(img.angle).toBeCloseTo(0, 6);
  });

  it('reports the design extent as the bitmap 400.00 x 193.00, which overhangs the plank', () => {
    // The bitmap is centred at (354.068, 464.939), so it spans X 154.068..554.068
    // — wider than the paths' 157.37..551.61. The overhang is real, not an error:
    // before the fix this read 395.63 x 190.39.
    const { widthMm, heightMm } = parsed();
    expect(widthMm).toBeCloseTo(400.00, 2);
    expect(heightMm).toBeCloseTo(193.00, 2);
  });

  it('leaves the three path layers at their own size and relative position', () => {
    const svgs = parsed().layers.filter((l) => l.type === 'svg');
    expect(svgs).toHaveLength(3);
    const dims = svgs.map((l) => {
      const m = /width="([\d.]+)" height="([\d.]+)"/.exec(l.svg_markup);
      return [parseFloat(m[1]), parseFloat(m[2])];
    });
    expect(dims[0][0]).toBeCloseTo(52.2, 2);
    expect(dims[0][1]).toBeCloseTo(62.352, 2);
    expect(dims[1][0]).toBeCloseTo(1495.265, 2);
    expect(dims[1][1]).toBeCloseTo(719.58, 2);
    expect(dims[2][0]).toBeCloseTo(947.95, 2);
    expect(dims[2][1]).toBeCloseTo(492.831, 2);
    // Positions relative to each other are untouched by the bitmap fix (only
    // the shared origin moved, because the bitmap now widens the union bbox).
    expect(svgs[1].left - svgs[0].left).toBeCloseTo(-1366.945, 2);
    expect(svgs[1].top - svgs[0].top).toBeCloseTo(-471.954, 2);
    expect(svgs[2].left - svgs[1].left).toBeCloseTo(113.349, 2);
    expect(svgs[2].top - svgs[1].top).toBeCloseTo(113.347, 2);
  });
});
