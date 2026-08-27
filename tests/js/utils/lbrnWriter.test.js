import {
  parsePathData,
  subpathsToVertPrim,
  arcBendParams,
  qtFontString,
  buildLbrnProject,
} from '../../../frontend/js/designer/src/utils/lbrnWriter';
import { parseLbrn, parseVertList, parsePrimList } from '../../../admin/js/template-builder/src/utils/lbrnParser';

/**
 * The .lbrn2 writer is the inverse of the template builder's importer, and the
 * importer is the harshest reviewer available: it has parsed real LightBurn
 * files for a year. Every writer test that matters here is therefore a
 * round-trip — write a project, hand it to the REAL parser, and require the
 * content to come back intact. A writer bug that survives that is a parser bug
 * too, and vice versa.
 */

describe('parsePathData', () => {
  test('parses the commands Fabric emits, promoting Q to an exact cubic', () => {
    const sub = parsePathData('M 0 42 Q 100 -21 200 42');
    expect(sub).toHaveLength(1);
    const seg = sub[0].segs[0];
    expect(seg.type).toBe('C');
    // C1 = P0 + 2/3(Q − P0), C2 = P1 + 2/3(Q − P1)
    expect(seg.c1[0]).toBeCloseTo(200 / 3, 9);
    expect(seg.c1[1]).toBe(0);
    expect(seg.c2[0]).toBeCloseTo(400 / 3, 6);
    expect(seg.to).toEqual([200, 42]);
  });

  test('implicit LineTos after M, and H/V as lines', () => {
    const sub = parsePathData('M 0 0 10 0 H 20 V 5');
    expect(sub[0].segs.map((s) => s.to)).toEqual([[10, 0], [20, 0], [20, 5]]);
  });

  test('refuses arcs and relative commands instead of guessing', () => {
    expect(parsePathData('M 0 0 A 5 5 0 0 1 10 0')).toBeNull();
    expect(parsePathData('m 0 0 l 10 10')).toBeNull();
  });
});

describe('subpathsToVertPrim', () => {
  const identity = (x, y) => [x, y];

  test('a closed triangle: three vertices, closing edge back to the start', () => {
    const { vertList, primList } = subpathsToVertPrim(
      parsePathData('M 0 0 L 10 0 L 5 8 Z'), identity
    );
    expect(parseVertList(vertList)).toHaveLength(3);
    expect(parsePrimList(primList)).toEqual([
      { cmd: 'L', a: 0, b: 1 }, { cmd: 'L', a: 1, b: 2 }, { cmd: 'L', a: 2, b: 0 },
    ]);
  });

  test('bezier handles land on the right vertices: outgoing on from, incoming on to', () => {
    const { vertList, primList } = subpathsToVertPrim(
      parsePathData('M 0 0 C 1 2 3 4 5 0'), identity
    );
    const verts = parseVertList(vertList);
    expect(parsePrimList(primList)).toEqual([{ cmd: 'B', a: 0, b: 1 }]);
    expect([verts[0].c0x, verts[0].c0y]).toEqual([1, 2]);
    expect([verts[1].c1x, verts[1].c1y]).toEqual([3, 4]);
  });
});

describe('arcBendParams', () => {
  // The real "Liefde, geluk" baseline: arch-up 42 over a 200 px path, of which
  // the ink occupies the first ~147 px of arc length. Feeding LightBurn the
  // FULL path's rise (31.5 px) instead of this fit bent the word ~83° where the
  // proof shows ~48° (import check, 2026-08-27).
  const LIEFDE = [['M', 0, 42], ['Q', 100, -21, 200, 42]];

  test('fits chord, sagitta and tilt of the span the ink occupies', () => {
    const fit = arcBendParams(LIEFDE, 0, 147);
    // chord/2 ≈ 71 px, sagitta ≈ 15 px, tilted ~ −10.5° (left-low to right-high)
    expect(fit.px).toBeGreaterThan(67);
    expect(fit.px).toBeLessThan(75);
    expect(fit.py).toBeGreaterThan(12);
    expect(fit.py).toBeLessThan(18);
    expect((fit.chordAngleRad * 180) / Math.PI).toBeGreaterThan(-14);
    expect((fit.chordAngleRad * 180) / Math.PI).toBeLessThan(-7);
  });

  test('ink spanning the whole symmetric path: level chord, positive rise', () => {
    // path length ≈ 209 px; lay all of it → symmetric span
    const fit = arcBendParams(LIEFDE, 0, 500);
    expect(Math.abs(fit.chordAngleRad)).toBeLessThan(1e-6);
    expect(fit.px).toBeCloseTo(100, 0);
    expect(fit.py).toBeCloseTo(31.5, 0); // ¾ of the 42 px intensity height
  });

  test('a downward bulge yields a negative bend', () => {
    const fit = arcBendParams([['M', 0, 0], ['Q', 100, 45, 200, 0]], 0, 500);
    expect(fit.py).toBeLessThan(0);
  });

  test('a straight path yields no bend', () => {
    expect(arcBendParams([['M', 0, 0], ['L', 200, 0]], 0, 150).py).toBe(0);
  });
});

describe('qtFontString', () => {
  test('matches the specimen format', () => {
    expect(qtFontString('Great Vibes')).toBe('Great Vibes,-1,4096,5,400,0,0,0,0,0');
    expect(qtFontString('Anton', { bold: true })).toBe('Anton,-1,4096,5,700,0,0,0,0,0');
  });
});

/* ------------------------------------------------------------------ *
 * Round-trip through the real importer
 * ------------------------------------------------------------------ */

const IDENTITY = [1, 0, 0, 1, 0, 0];
const fakeText = (over = {}) => ({
  type: 'i-text',
  text: 'Anni & Dane',
  fontFamily: 'Great Vibes',
  fontSize: 36,
  charSpacing: 0,
  width: 180,
  data: { elementType: 'text' },
  calcOwnMatrix: () => over.matrix || [1, 0, 0, 1, 300, 120],
  getCenterPoint: () => over.centre || { x: 300, y: 120 },
  getBoundingRect: () => over.box || { left: 250, top: 90, width: 100, height: 60 },
  calcTextWidth: () => over.inkWidth || 180,
  // Fabric's serialisation: one tspan per line with line-start x and baseline y.
  toSVG: () => {
    const lines = String(over.text ?? 'Anni & Dane').split('\n');
    const spans = lines.map((l, i) =>
      `<tspan x="-90" y="${-5 + i * 30}">${l.replace(/&/g, '&amp;')}</tspan>`).join('');
    return `<g><text>${spans}</text></g>`;
  },
  ...over,
});

const MM_PER_PX = 457.81 / 600;

describe('buildLbrnProject → parseLbrn round-trip', () => {
  const canvas = (objects) => ({ getObjects: () => objects });

  test('a real design shape survives the trip: texts stay text, art stays geometry', () => {
    const objects = [
      // reference photo — excluded from every production export
      { type: 'image', data: { excludeFromExport: true }, calcOwnMatrix: () => IDENTITY },
      // zone overlay — editor chrome
      { type: 'rect', data: { isZoneOverlay: true }, calcOwnMatrix: () => IDENTITY },
      // ornament vector
      {
        type: 'path',
        path: [['M', 0, 0], ['Q', 50, 40, 100, 0], ['Z']],
        pathOffset: { x: 50, y: 15 },
        data: { elementType: 'svg' },
        calcOwnMatrix: () => [1, 0, 0, 1, 200, 100],
      },
      // straight text
      fakeText(),
      // curved text (arch-up 42 over 200px, the real "Liefde, geluk")
      fakeText({
        text: 'Liefde, geluk',
        path: { path: [['M', 0, 42], ['Q', 100, -21, 200, 42]] },
        width: 200,
        inkWidth: 200,
        data: { elementType: 'curved-text', curvePreset: 'arch-up', curveIntensity: 42 },
        centre: { x: 160, y: 48 },
      }),
    ];

    const { xml, skipped } = buildLbrnProject(canvas(objects), { mmPerPx: MM_PER_PX });

    // The image is reported, the overlay is silently editor-only.
    expect(skipped.some((s) => /rasterafbeelding/.test(s))).toBe(false); // excluded, not skipped
    expect(xml).toContain('Bend="1"');

    const parsed = parseLbrn(xml, { availableFonts: ['Great Vibes'] });
    expect(parsed.warnings).toEqual([]);

    const texts = parsed.layers.filter((l) => l.type === 'text');
    const svgs = parsed.layers.filter((l) => l.type === 'svg');
    expect(texts.map((t) => t.text).sort()).toEqual(['Anni & Dane', 'Liefde, geluk']);
    // rechte tekst gaat per regel het bestand in — één regel hier, dus één shape
    expect(texts.every((t) => t.fontFamily === 'Great Vibes')).toBe(true);
    expect(svgs).toHaveLength(1);
    expect(svgs[0].svg_markup).toContain('<path');
  });

  test('bend parameters come from the fitted span, in millimetres', () => {
    const { xml } = buildLbrnProject(canvas([fakeText({
      text: 'Liefde, geluk', path: { path: [['M', 0, 42], ['Q', 100, -21, 200, 42]] }, width: 200, inkWidth: 147,
      data: { elementType: 'curved-text', curvePreset: 'arch-up', curveIntensity: 42 },
    })]), { mmPerPx: MM_PER_PX });
    const px = parseFloat(/BendPX="([^"]+)"/.exec(xml)[1]);
    const py = parseFloat(/BendPY="([^"]+)"/.exec(xml)[1]);
    // gefit op het inktsegment: koorde/2 ≈ 71 px, pijlhoogte ≈ 15 px → mm
    expect(px).toBeGreaterThan(67 * MM_PER_PX);
    expect(px).toBeLessThan(75 * MM_PER_PX);
    expect(py).toBeGreaterThan(12 * MM_PER_PX);
    expect(py).toBeLessThan(18 * MM_PER_PX);
    // en de koorde-kanteling zit in de rotatiematrix (≈ −10.5°)
    expect(xml).not.toMatch(/<XForm>1 0 0 1 [^<]*<\/XForm>[\s\S]*Bend="1"/);
  });


  test('anchoring follows the measured LightBurn model', () => {
    // Model, fitted on LightBurn's own SVG re-export of known anchors (order
    // 2678, 2026-08-27): rendered ink hangs R(θ)(0, 0.31·H + max(bend,0))
    // below the anchor. Straight text left-anchors at the line start (Ah=0,
    // like Fabric's textAlign left); bent text centre-anchors on the chord
    // midpoint of the laid span — never on the object centre, which sits half
    // an unused path away from the ink.
    const { xml } = buildLbrnProject(canvas([
      fakeText(), // recht, own-translate (300, 120), width 180
      fakeText({
        text: 'Liefde, geluk', path: { path: [['M', 0, 42], ['Q', 100, -21, 200, 42]] },
        width: 200, inkWidth: 147, matrix: [1, 0, 0, 1, 160, 48],
        data: { elementType: 'curved-text', curvePreset: 'arch-up', curveIntensity: 42 },
      }),
    ]), { mmPerPx: MM_PER_PX });
    const shapes = xml.match(/<Shape Type="Text"[^>]*>[^<]*<XForm>[^<]*<\/XForm>/g);

    // recht: Ah=0, per regel verankerd op de baseline-start (tspan −90,−5 in
    // eigen coördinaten + own-translate), 0.8·H erboven
    expect(shapes[0]).toContain('Ah="0" Av="1"');
    const [ax, ay] = shapes[0].match(/<XForm>1 0 0 1 ([-\d.]+) ([-\d.]+)<\/XForm>/).slice(1).map(Number);
    expect(ax).toBeCloseTo((300 - 90) * MM_PER_PX, 2);
    expect(ay).toBeCloseTo((120 - 5 - 0.8 * 36) * MM_PER_PX, 2);

    // gebogen: Ah=1, anker in de buurt van het koordemidden, geheven met
    // 0.66·H + boog (niet exact narekenen — de fit bepaalt de kanteling)
    expect(shapes[1]).toContain('Ah="1" Av="1"');
    const my = parseFloat(shapes[1].match(/ ([-\d.]+)<\/XForm>/)[1]);
    // koordemidden-y ≈ (48 + ~28.7 − pathOffset-y) px; anker moet er ruim boven
    expect(my).toBeLessThan(48 * MM_PER_PX);
  });

  test('a single bent character gets the tangent rotation, never a bend', () => {
    // Bending one glyph wraps it around a tiny circle — the "&" of order 2678
    // arrived rotated a quarter turn. The canvas shows it tilted to the curve
    // tangent, so that is what the file carries.
    const { xml } = buildLbrnProject(canvas([fakeText({
      text: '&', path: { path: [['M', 0, 60], ['Q', 100, -30, 200, 60]] }, width: 200, inkWidth: 22,
      data: { elementType: 'curved-text', curvePreset: 'arch-up', curveIntensity: 60 },
      // Fabric layout: het teken start lokaal op (−100, 33), 22 breed, −30°.
      __charBounds: [[{ angle: -Math.PI / 6, renderLeft: -100, renderTop: 33, kernedWidth: 22 }]],
    })]), { mmPerPx: MM_PER_PX });
    expect(xml).not.toContain('Bend="1"');
    // rotatiematrix voor −30°: cos 0.866, sin −0.5
    expect(xml).toMatch(/<XForm>0\.866025 -0\.5 0\.5 0\.866025/);
    // anker = de baseline-START van de glyph (Ah=0 begint de regel precies
    // daar), 0.8·H erboven volgens de grid-meting — nooit het objectmidden,
    // want het object beslaat het hele 200px-pad
    const ca = Math.cos(-Math.PI / 6); const sa = Math.sin(-Math.PI / 6);
    const gx = (300 - 100) * MM_PER_PX;
    const gy = (120 + 33) * MM_PER_PX;
    const drop = 0.8 * 36 * MM_PER_PX;
    const ax = gx - (-drop * sa);
    const ay = gy - (drop * ca);
    expect(xml).toContain(`${String(parseFloat(ax.toFixed(4)))} ${String(parseFloat(ay.toFixed(4)))}</XForm>`);
  });

  test('a wave text is refused with a reason, not silently dropped', () => {
    const { xml, skipped } = buildLbrnProject(canvas([fakeText({
      text: 'Golfje', path: { path: [['M', 0, 0], ['C', 50, -40, 150, 40, 200, 0]] },
      data: { elementType: 'curved-text', curvePreset: 'wave', curveIntensity: 60 },
    })]), { mmPerPx: MM_PER_PX });
    expect(xml).not.toContain('Golfje');
    expect(skipped.join(' ')).toMatch(/Golfje.*wave/);
  });

  test('XML special characters in customer text cannot break the file', () => {
    const { xml } = buildLbrnProject(canvas([fakeText({ text: '"Zon" & <maan>\nregel 2' })]),
      { mmPerPx: MM_PER_PX });
    expect(xml).toContain('Str="&quot;Zon&quot; &amp; &lt;maan&gt;&#10;regel 2"');
    // and the whole document still parses
    expect(() => parseLbrn(xml, { availableFonts: ['Great Vibes'] })).not.toThrow();
  });

  test('refuses to write a file without physical units', () => {
    expect(() => buildLbrnProject(canvas([]), { mmPerPx: 0 })).toThrow(/width_mm/);
  });
});

/**
 * The bug that forced per-line shapes: "Anni & Dane\n            28 augustus
 * 2026" is ONE Fabric object whose second line is indented with twelve leading
 * spaces. Rendered as one LightBurn Text shape, those spaces get LightBurn's
 * OWN space width — measured on order 2678, the line drifted visibly right of
 * the proof. Per line, with the lead baked into the anchor from Fabric's
 * metrics, LightBurn never measures a space.
 */
describe('multi-line straight text', () => {
  const canvas = (objects) => ({ getObjects: () => objects });
  test('one shape per line, leading spaces stripped and baked into the anchor', () => {
    const charB = [[], []];
    for (let i = 0; i < 30; i++) charB[1].push({ left: i * 6, kernedWidth: 6, width: 6 });
    const { xml } = buildLbrnProject(canvas([fakeText({
      text: 'Anni & Dane\n    28 augustus 2026', // 4 voorloopspaties → left = 24 px
      __charBounds: charB,
    })]), { mmPerPx: MM_PER_PX });

    const shapes = xml.match(/<Shape Type="Text"[^>]*>[\s\S]*?<\/Shape>/g);
    expect(shapes).toHaveLength(2);
    expect(shapes[0]).toContain('Str="Anni &amp; Dane"');
    expect(shapes[1]).toContain('Str="28 augustus 2026"'); // zonder spaties
    // regel 2 ankert 24 px (de gemeten spatiebreedte) rechts van de regelstart
    const x1 = parseFloat(shapes[0].match(/1 0 0 1 ([-\d.]+)/)[1]);
    const x2 = parseFloat(shapes[1].match(/1 0 0 1 ([-\d.]+)/)[1]);
    expect(x2 - x1).toBeCloseTo(24 * MM_PER_PX, 2);
  });
});
