import {
  repairFabricSvgMarkup,
  parseSvgOrThrow,
  stripClipPaths,
  stripBaselinePaths,
  applyPhysicalSize,
  glyphTransform,
} from '../../../frontend/js/designer/src/utils/productionSvg';
import { isPerCharacterText } from '../../../frontend/js/designer/src/utils/textOutline';

/**
 * Reported from a real order (borrelplank, order 2678, 2026-08-27): the customer
 * approved a proof, the merchant exported SVG for LightBurn, and got a single
 * bitmap wrapped in an SVG instead of vectors. The design saved fine, no error
 * anywhere.
 *
 * Root cause, in one line of Fabric 6.9.1 (index.mjs:18980):
 *
 *     `<tspan x=".." y=".." ${dySpan}${angleAttr}${fillStyles}>`
 *
 * `angleAttr` is ` rotate=".."` with no trailing space and `fillStyles` is
 * `style=".."` with no leading space, so a character that is both rotated and
 * styled emits `rotate="-7.29"style="white-space: pre; "`. That is malformed
 * XML, and every consumer downstream bailed out quietly:
 *
 *   - outlineSvgText / embedFontsInSvg returned the raw markup on parsererror,
 *     so both "SVG" and "SVG + fonts" held the SAME unusable string
 *   - the server's sanitize_export_blob() got `false` from svg-sanitize and
 *     stored '' — and upsert_view skips empty columns, so nothing changed
 *   - export_svg (a PNG data URL) survived, so the SVG export fell back to
 *     wrapping the raster
 *
 * A rotated character only gets a style attribute when it is whitespace, so the
 * trigger is "curved text containing a space" — which is most engraving text.
 */
describe('repairFabricSvgMarkup', () => {
  const BROKEN_TSPAN =
    '<tspan x="-23.5084" y="-6.1663"  rotate="-7.2924"style="white-space: pre; "> </tspan>';

  test('separates the attributes Fabric glued together', () => {
    expect(repairFabricSvgMarkup(BROKEN_TSPAN)).toContain('rotate="-7.2924" style=');
  });

  test('the repaired markup actually parses, the original does not', () => {
    const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg"><text>${inner}</text></svg>`;
    expect(() => parseSvgOrThrow(wrap(BROKEN_TSPAN))).toThrow(/not well-formed/);
    expect(() => parseSvgOrThrow(wrap(repairFabricSvgMarkup(BROKEN_TSPAN)))).not.toThrow();
  });

  test('leaves correct markup untouched', () => {
    const fine = '<tspan x="1" y="2" rotate="3" style="fill: red">a</tspan>';
    expect(repairFabricSvgMarkup(fine)).toBe(fine);
  });

  test('cannot corrupt text content, because Fabric escapes quotes in it', () => {
    // A customer typing `"style="` gets it escaped to &quot;style=&quot; by
    // Fabric's escapeXml before it ever reaches this repair.
    const escaped = '<tspan x="0" y="0">&quot;style=&quot;</tspan>';
    expect(repairFabricSvgMarkup(escaped)).toBe(escaped);
  });
});

/**
 * The second half of the same order's failure. Once the SVG parsed, LightBurn
 * showed five stacked plank silhouettes over the artwork: each clipped object
 * carries the zone shape as a <clipPath>, LightBurn ignores clipPath and draws
 * the shape as a normal outline.
 */
describe('stripClipPaths', () => {
  const CLIPPED = `<svg xmlns="http://www.w3.org/2000/svg">
    <g clip-path="url(#CLIPPATH_3)">
      <clipPath id="CLIPPATH_3"><path d="M 0 0 L 10 10 Z"/></clipPath>
      <text x="0" y="0">hi</text>
    </g>
  </svg>`;

  test('removes both the definition and the reference', () => {
    const doc = parseSvgOrThrow(CLIPPED);
    const dropped = stripClipPaths(doc);
    expect(dropped).toBe(1);
    expect(doc.querySelectorAll('clipPath')).toHaveLength(0);
    expect(doc.querySelectorAll('[clip-path]')).toHaveLength(0);
  });

  test('keeps the artwork itself', () => {
    const doc = parseSvgOrThrow(CLIPPED);
    stripClipPaths(doc);
    expect(doc.querySelectorAll('text')).toHaveLength(1);
  });
});

/**
 * Glyph placement. The rotation is what the previous outliner threw away: it
 * called font.getPath(wholeTspanText, x, y, size) and ignored the tspan's
 * `rotate` attribute entirely, so every curved text would have been outlined as
 * a straight line of characters. It never showed up because the malformed XML
 * above made the outliner bail out before it got here.
 */
describe('glyphTransform', () => {
  test('moves the glyph onto its baseline position', () => {
    expect(glyphTransform(10, 20, 0)).toBe('translate(10 20)');
  });

  test('rotates around the glyph origin, after the move', () => {
    expect(glyphTransform(-100.15, 23.32, -29.2192))
      .toBe('translate(-100.15 23.32) rotate(-29.2192)');
  });

  test('omits a zero rotation instead of emitting rotate(0)', () => {
    expect(glyphTransform(1, 2, 0)).not.toContain('rotate');
  });
});

/**
 * Curved text sits on an invisible baseline curve. Fabric appends that curve to
 * the SVG as a normal <path> whenever the text has one — there is no way to opt
 * out (index.mjs:18797). On a laser bed it becomes a line burnt straight through
 * the lettering.
 *
 * The obvious fix — detach `obj.path` before toSVG() — silently destroys the
 * text: Fabric's `timeToRender = i === len || this.charSpacing || this.path`
 * then collapses every character back into one tspan per line, losing the
 * positions AND rotations that put the letters on the curve. Measured on order
 * 2678: "Han & Mei" (charSpacing 0) came out straight and re-spaced, while
 * "Lekkere hapjes" (charSpacing 19) survived by accident. Hence matching on the
 * path data after serialisation, which never touches the layout.
 */
describe('stripBaselinePaths', () => {
  const CURVE = 'M 0 42 Q 100 -21 200 42';
  const svg = () => parseSvgOrThrow(
    `<svg xmlns="http://www.w3.org/2000/svg">
       <g transform="matrix(1 0 0 1 100 18)"><path d="${CURVE}"/></g>
       <path d="M 5 5 L 9 9 Z"/>
     </svg>`
  );

  test('removes the baseline curve', () => {
    const doc = svg();
    expect(stripBaselinePaths(doc, new Set([CURVE]))).toBe(1);
    expect(Array.from(doc.querySelectorAll('path')).map((p) => p.getAttribute('d')))
      .toEqual(['M 5 5 L 9 9 Z']);
  });

  test('takes the now-empty wrapper group with it', () => {
    const doc = svg();
    stripBaselinePaths(doc, new Set([CURVE]));
    expect(doc.querySelectorAll('g')).toHaveLength(0);
  });

  test('leaves real artwork alone, including a path it was not told about', () => {
    const doc = svg();
    expect(stripBaselinePaths(doc, new Set(['M 1 1 L 2 2'])) ).toBe(0);
    expect(doc.querySelectorAll('path')).toHaveLength(2);
  });

  test('does nothing without a set — a design with no curved text', () => {
    expect(stripBaselinePaths(svg(), undefined)).toBe(0);
    expect(stripBaselinePaths(svg(), new Set())).toBe(0);
  });
});

/**
 * Which runs the font-carrying export has to outline. LightBurn re-flows
 * per-character text with its own advances (measured: "Lekkere hapjes" →
 * "Lekkere ha pjes"), but imports one-tspan-per-line text correctly, so that
 * text can stay editable with an embedded font.
 */
describe('isPerCharacterText', () => {
  const textEl = (inner) => parseSvgOrThrow(
    `<svg xmlns="http://www.w3.org/2000/svg"><text>${inner}</text></svg>`
  ).querySelector('text');

  test('curved text — one tspan per character, each rotated', () => {
    expect(isPerCharacterText(textEl(
      '<tspan x="0" y="0" rotate="-29">L</tspan><tspan x="9" y="1" rotate="-24">i</tspan>'
    ))).toBe(true);
  });

  test('letter-spaced text — per character, no rotation', () => {
    expect(isPerCharacterText(textEl(
      '<tspan x="0" y="0">A</tspan><tspan x="9" y="0">B</tspan><tspan x="18" y="0">C</tspan>'
    ))).toBe(true);
  });

  test('multi-line straight text — one tspan per LINE, stays editable', () => {
    expect(isPerCharacterText(textEl(
      '<tspan x="0" y="0">Anni &amp; Dane</tspan><tspan x="0" y="30">28 augustus 2026</tspan>'
    ))).toBe(false);
  });

  test('a single-line, single-character text is not a per-character run', () => {
    expect(isPerCharacterText(textEl('<tspan x="0" y="0">&amp;</tspan>'))).toBe(false);
  });
});

/**
 * Reported straight from the laser (2026-08-27): a 457.81 mm plank imported into
 * LightBurn as 160.232 mm. Fabric writes the canvas in pixels, and a consumer
 * that finds no unit falls back to a DPI guess — LightBurn assumes 96, so
 * 600 px becomes 158.75 mm.
 *
 * Stamping mm onto the root alone (what the server did) fixes the displayed size
 * but leaves one user unit at 0.763 mm. Scaling the content makes the numbers in
 * the file the numbers on the bed, which is the form LightBurn writes itself.
 */
describe('applyPhysicalSize', () => {
  const doc = () => parseSvgOrThrow(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="245" viewBox="0 0 600 245">
       <defs><style>@font-face{}</style></defs>
       <path d="M 0 0 L 10 10"/>
     </svg>`
  );

  test('a 600 px canvas of 457.81 mm gets its real size in millimetres', () => {
    const d = doc();
    expect(applyPhysicalSize(d, { widthMm: 457.81, pxWidth: 600, pxHeight: 245 })).toBe(true);
    expect(d.documentElement.getAttribute('width')).toBe('457.81mm');
    expect(d.documentElement.getAttribute('height')).toBe('186.939mm');  // 245 × 457.81/600
  });

  test('leaves the geometry and the viewBox untouched', () => {
    const d = doc();
    applyPhysicalSize(d, { widthMm: 457.81, pxWidth: 600, pxHeight: 245 });
    expect(d.documentElement.getAttribute('viewBox')).toBe('0 0 600 245');
    expect(d.documentElement.querySelectorAll('g')).toHaveLength(0);
    expect(d.documentElement.querySelector('path').getAttribute('d')).toBe('M 0 0 L 10 10');
  });

  test('supplies a viewBox when Fabric left none, so the mm size has a reference', () => {
    const d = parseSvgOrThrow('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="245"/>');
    applyPhysicalSize(d, { widthMm: 457.81, pxWidth: 600, pxHeight: 245 });
    expect(d.documentElement.getAttribute('viewBox')).toBe('0 0 600 245');
  });

  test('a view without a physical width keeps its pixel canvas untouched', () => {
    const d = doc();
    expect(applyPhysicalSize(d, { widthMm: 0, pxWidth: 600, pxHeight: 245 })).toBe(false);
    expect(d.documentElement.getAttribute('width')).toBe('600');
  });
});

/**
 * Transform machinery for the textPath conversion. The referenced curve must be
 * baked into absolute coordinates: LightBurn read a flat textPath correctly in
 * the four-way test, and the less transform bookkeeping we hand it, the less it
 * can get wrong.
 */
describe('transform helpers', () => {
  const { parseTransformAttr, multiplyMatrices, uniformScaleRotation, bakePathTransform } =
    // eslint-disable-next-line global-require
    require('../../../frontend/js/designer/src/utils/productionSvg');

  test('parses the forms Fabric emits', () => {
    expect(parseTransformAttr('matrix(0.977 -0.213 0.213 0.977 176.13 206.61)'))
      .toEqual([0.977, -0.213, 0.213, 0.977, 176.13, 206.61]);
    expect(parseTransformAttr(' translate(-302.8015, -123.4438)'))
      .toEqual([1, 0, 0, 1, -302.8015, -123.4438]);
    expect(parseTransformAttr('matrix(1 0 0 1 10 20) translate(5, 5)'))
      .toEqual([1, 0, 0, 1, 15, 25]);
  });

  test('refuses what it does not understand instead of guessing', () => {
    expect(parseTransformAttr('skewX(30)')).toBeNull();
    expect(parseTransformAttr('rotate(30 10 10)')).toBeNull();
  });

  test('recognises uniform scale + rotation, rejects skew and flips', () => {
    // pure rotation of 12.3° — the "Lekkere hapjes" object matrix
    const r = uniformScaleRotation([0.977, -0.213, 0.213, 0.977]);
    expect(r.scale).toBeCloseTo(1, 2);
    expect(r.rotationDeg).toBeCloseTo(-12.3, 1);
    expect(uniformScaleRotation([2, 0, 0, 1])).toBeNull();   // non-uniform
    expect(uniformScaleRotation([1, 0, 0.5, 1])).toBeNull(); // skew
    expect(uniformScaleRotation([-1, 0, 0, 1])).toBeNull();  // flip
  });

  test('bakes a translation into the curve presets', () => {
    // arch-up: the real "Liefde, geluk" baseline
    expect(bakePathTransform('M 0 42 Q 100 -21 200 42', [1, 0, 0, 1, 60, 30]))
      .toBe('M 60 72 Q 160 9 260 72');
  });

  test('bakes rotation into Q curves — control points transform affinely', () => {
    const quarter = [0, 1, -1, 0, 0, 0]; // 90° turn
    expect(bakePathTransform('M 10 0 Q 20 0 30 0', quarter))
      .toBe('M 0 10 Q 0 20 0 30');
  });

  test('arcs survive uniform scale + rotation, with radii and angle adjusted', () => {
    const double = [2, 0, 0, 2, 0, 0];
    expect(bakePathTransform('M 0 10 A 10 10 0 1 1 20 10', double))
      .toBe('M 0 20 A 20 20 0 1 1 40 20');
  });

  test('refuses arcs under a non-uniform matrix, and relative commands anywhere', () => {
    expect(bakePathTransform('M 0 0 A 10 10 0 1 1 20 0', [2, 0, 0, 1, 0, 0])).toBeNull();
    expect(bakePathTransform('m 0 0 l 10 10', [1, 0, 0, 1, 0, 0])).toBeNull();
  });
});

/**
 * The conversion the "SVG + fonts" export runs on curved text. LightBurn reads
 * per-character tspans wrongly and <textPath> correctly, so a curved run is
 * rewritten as the standard form: its own Fabric baseline, baked to absolute
 * coordinates, referenced from a root-level <text>.
 */
describe('convertCurvedTextsToTextPaths', () => {
  const { convertCurvedTextsToTextPaths } =
    // eslint-disable-next-line global-require
    require('../../../frontend/js/designer/src/utils/textOutline');

  const CURVE = 'M 0 0 Q 100 45 200 0'; // the real "Lekkere hapjes" arch
  const FABRIC_DOC = () => parseSvgOrThrow(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <g transform="matrix(0.977 -0.213 0.213 0.977 176.13 206.61)">
        <text font-family="Great Vibes" font-size="36" style="fill: rgb(0,0,0);"
          ><tspan x="-100.12" y="-16.59" rotate="21.56">L</tspan
          ><tspan x="-75.44" y="-7.13" rotate="17.65">e</tspan></text>
        <g transform="matrix(1 0 0 1 100 16.875)"><path d="${CURVE}"/></g>
      </g>
    </svg>`
  );
  // bakedD is precomputed at collect time from the live Fabric object
  // (own matrix ∘ translate(−pathOffset) baked into the raw d); here the
  // matrix ∘ offset works out to translate(60, 30) for a legible expectation.
  const INFO = () => [{
    d: CURVE, bakedD: 'M 60 30 Q 160 75 260 30', scale: 1,
    letterSpacingPx: 0.684, startOffset: 0,
    pathSide: 'left', pathAlign: 'baseline', multiline: false,
  }];

  test('rewrites the curved run as a textPath over its own baked baseline', () => {
    const doc = FABRIC_DOC();
    expect(convertCurvedTextsToTextPaths(doc, INFO())).toBe(1);

    const ref = doc.querySelector('defs > path');
    expect(ref.getAttribute('id')).toBe('sgpd-baseline-1');
    expect(ref.getAttribute('d')).toBe('M 60 30 Q 160 75 260 30');

    const tp = doc.querySelector('text > textPath');
    expect(tp.getAttribute('href')).toBe('#sgpd-baseline-1');
    expect(tp.textContent).toBe('Le');
    const t = tp.parentNode;
    expect(t.parentNode).toBe(doc.documentElement);       // root level, no transform
    expect(t.getAttribute('font-family')).toBe('Great Vibes');
    expect(parseFloat(t.getAttribute('font-size'))).toBeCloseTo(36, 1); // scale ≈ 1
    expect(parseFloat(t.getAttribute('letter-spacing'))).toBeCloseTo(0.684, 2);
  });

  test('removes the per-character original and the stray baseline', () => {
    const doc = FABRIC_DOC();
    convertCurvedTextsToTextPaths(doc, INFO());
    expect(doc.querySelectorAll('tspan')).toHaveLength(0);
    // the only path left is the defs reference
    const paths = Array.from(doc.querySelectorAll('path'));
    expect(paths).toHaveLength(1);
    expect(paths[0].closest('defs')).not.toBeNull();
  });

  test('leaves a run alone when textPath cannot express it', () => {
    for (const patch of [{ pathSide: 'right' }, { pathAlign: 'center' }, { multiline: true }, { bakedD: null }]) {
      const doc = FABRIC_DOC();
      expect(convertCurvedTextsToTextPaths(doc, [{ ...INFO()[0], ...patch }])).toBe(0);
      expect(doc.querySelectorAll('tspan').length).toBeGreaterThan(0);
    }
  });

  test('no infos, no changes', () => {
    const doc = FABRIC_DOC();
    expect(convertCurvedTextsToTextPaths(doc, [])).toBe(0);
  });
});
