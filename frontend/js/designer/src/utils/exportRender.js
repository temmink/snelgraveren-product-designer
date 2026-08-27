/**
 * Offscreen render pipeline for the production exports.
 *
 * Lives outside App.jsx so it can run — and be verified — without React: the
 * output of these functions is what ends up on a laser bed, so it has to be
 * runnable against a real design JSON in isolation.
 */
import { Canvas as FabricCanvas, cache as fabricCache } from 'fabric';
import { outlineSvgText, embedFontsInSvg } from './textOutline';
import { multiplyMatrices, bakePathTransform, uniformScaleRotation } from './productionSvg';
import { buildLbrnProject } from './lbrnWriter';

/**
 * Ensure every text object's font is loaded and re-measured before an offscreen
 * canvas is serialized. Without this, Fabric lays out (especially centered) text
 * using a fallback-font width — so the text ends up off-centre / mis-positioned
 * in the PNG and SVG exports even though the design looks right in the live
 * editor (where the font is already loaded).
 */
async function ensureFontsAndRemeasure(canvas) {
  const texts = canvas.getObjects().filter((o) => /text/i.test(o.type || ''));
  await Promise.all(texts.map((o) => {
    const fam  = o.fontFamily || 'sans-serif';
    const size = o.fontSize || 16;
    try { return document.fonts.load(`${size}px "${fam}"`).catch(() => {}); }
    catch (_) { return Promise.resolve(); }
  }));
  // Drop Fabric's global char-width cache: if a font finished loading only
  // AFTER the design first rendered (e.g. Google fonts fetched async via the
  // proxy), the cache holds fallback-font widths for these glyphs. initDimensions
  // would reuse them, so centred text lays out against the wrong width and drifts
  // in the export even though the glyphs themselves are outlined at the real
  // width. Clearing forces a fresh measurement with the now-loaded font.
  try { fabricCache.clearFontCache(); } catch (_) { /* ignore */ }
  texts.forEach((o) => { try { o.initDimensions(); o.setCoords(); } catch (_) { /* ignore */ } });
  canvas.renderAll();
}

/**
 * Objects that must never reach a production export.
 *
 * `excludeFromExport` is the merchant's own flag (LightBurn reference art).
 * `isZoneOverlay` is the designer's editing aid — the dashed/coloured zone
 * outline drawn on top of the canvas. It has no business in an engraving file:
 * LightBurn imports it as a normal vector and it comes out as a burnt line
 * around the whole design (seen on order 2678, 2026-08-27).
 */
function isProductionExcluded(obj) {
  return !!(obj.data?.excludeFromExport || obj.data?.isZoneOverlay);
}

/**
 * Run `fn` with every production-excluded object hidden, then restore.
 * Used for the production export renders only — thumbnails keep those objects,
 * because a thumbnail should look like what the customer designed.
 *
 * Sets BOTH the plugin's own flag AND Fabric's top-level `excludeFromExport`
 * property (unrelated properties that happen to share a name). `visible = false`
 * alone hides the object from raster output (toDataURL) but NOT from toSVG() —
 * Fabric still emits invisible objects, just marked `visibility: hidden`, so a
 * bitmap reference layer flagged only that way still ships inside the vector
 * exports. The native `excludeFromExport` is what toSVG() honours by omitting
 * the object. We restore each object's PRIOR native-flag value (not assume
 * false) so we never clobber a flag another code path may have set.
 *
 * The restore lives in `finally` on purpose: two call sites operate on the
 * customer's LIVE on-screen canvas, so a throwing render must never leave a
 * layer hidden (or export-excluded) in front of them.
 */
function withoutExcludedObjects(canvas, fn) {
  const hidden = [];
  try {
    canvas.getObjects().forEach((o) => {
      if (isProductionExcluded(o) && o.visible !== false) {
        hidden.push({ obj: o, prevExcludeFromExport: o.excludeFromExport });
        o.visible = false;
        o.excludeFromExport = true;
      }
    });
    if (hidden.length) canvas.renderAll();
    return fn();
  } finally {
    if (hidden.length) {
      hidden.forEach(({ obj, prevExcludeFromExport }) => {
        obj.visible = true;
        obj.excludeFromExport = prevExcludeFromExport;
      });
      canvas.renderAll();
    }
  }
}

/**
 * The `d` of every curved text's baseline path, as Fabric will write it.
 *
 * `Text.toSVG()` appends its `path` as a visible <path> whenever one exists
 * (fabric index.mjs:18797) — no visibility check, no way to opt out. That curve
 * is an editing construct: in LightBurn it arrives as a stray line running
 * through the text. It has to go, but only AFTER serialisation.
 *
 * Detaching `obj.path` before toSVG() looks tempting and is wrong. Fabric
 * decides to emit per-character tspans via
 * `timeToRender = i === len || this.charSpacing || this.path`
 * (index.mjs:18896), so removing the path makes every text whose charSpacing is
 * 0 collapse into one tspan per line — losing the per-character positions AND
 * rotations that put the letters on the curve. Measured: "Han & Mei"
 * (charSpacing 0) came out straight and re-spaced, while "Lekkere hapjes"
 * (charSpacing 19) survived because its spacing kept the per-character branch
 * alive. Matching on the path data afterwards avoids touching the layout at all.
 *
 * The string comes from Fabric's own serializer, so it matches the exported
 * markup exactly — including its rounding.
 */
function collectBaselinePathData(canvas) {
  return new Set(collectTextPathInfo(canvas).map((i) => i.d));
}

/**
 * Everything the textPath conversion needs to know about each curved text, in
 * canvas object order (the same order Fabric serialises them in): the exact `d`
 * its baseline will carry in the markup, the letter spacing in px, and the
 * path-follow settings. Values a <textPath> cannot express (right-side text,
 * non-baseline alignment, multi-line) are flagged so the conversion can fall
 * back to outlining that text instead of approximating it.
 */
function collectTextPathInfo(canvas) {
  const infos = [];
  canvas.getObjects().forEach((o) => {
    if (!o.path || typeof o.text !== 'string') return;
    try {
      const match = /\sd="([^"]+)"/.exec(o.path.toSVG());
      if (!match) return;
      // The curve in absolute document coordinates, computed from the SAME
      // numbers Fabric renders with. `_setGraphemeOnPath` places every glyph at
      // pointOnPath − path.pathOffset in text-local space (fabric
      // index.mjs:19538), so local curve = raw d translated by −pathOffset, and
      // the object's own matrix lifts it to document space. The path markup
      // Fabric itself appends to the SVG is NOT usable for this — its transform
      // chain puts the curve elsewhere (measured ~200 units off on order 2678).
      const own = o.calcOwnMatrix();
      const off = o.path.pathOffset || { x: 0, y: 0 };
      const m = multiplyMatrices(own, [1, 0, 0, 1, -off.x, -off.y]);
      const usr = uniformScaleRotation(m);
      const bakedD = usr ? bakePathTransform(match[1], m) : null;

      infos.push({
        d: match[1],
        bakedD,
        scale: usr ? usr.scale : 1,
        // Fabric charSpacing is thousandths of an em.
        letterSpacingPx: ((o.fontSize || 0) * (o.charSpacing || 0)) / 1000,
        startOffset: o.pathStartOffset || 0,
        pathSide: o.pathSide || 'left',
        pathAlign: o.pathAlign || 'baseline',
        multiline: /\n/.test(o.text),
      });
    } catch (_) { /* a text whose baseline we cannot identify keeps its path */ }
  });
  return infos;
}

/**
 * A charSpacing so small it cannot move a glyph, but is still truthy.
 *
 * Fabric decides per line whether to emit one tspan for the whole line or one
 * per character: `timeToRender = i === len || this.charSpacing || this.path`
 * (index.mjs:18896). One tspan per line hands the letter positions to whoever
 * renders the file, and no two engines space text identically — measured on a
 * real order, the line "28 augustus 2026" landed 1.02 mm off the proof because
 * the browser measures its leading spaces slightly differently than Fabric does.
 *
 * charSpacing is in 1/1000 em, so at this value a 24 px line shifts by
 * 24 × 1e-6 / 1000 ≈ 2.4e-8 px per character — far below the 2 decimals Fabric
 * writes into the markup. What it buys is that every character carries the
 * position Fabric's own layout computed.
 */
const HAIRLINE_CHAR_SPACING = 1e-6;

/**
 * Run `fn` with every text forced into per-character output, then restore.
 *
 * Only for the outlining pass: there the text becomes geometry anyway, so what
 * matters is that each glyph sits exactly where the canvas put it. The
 * font-carrying export must NOT use this — it would turn every editable line
 * into per-character spans and defeat its own purpose.
 *
 * Safe because it runs on a throwaway offscreen canvas.
 */
function withPerCharacterSpans(canvas, fn) {
  const touched = [];
  try {
    canvas.getObjects().forEach((o) => {
      if (typeof o.text !== 'string' || o.charSpacing || o.path) return;
      touched.push({ obj: o, prev: o.charSpacing });
      o.charSpacing = HAIRLINE_CHAR_SPACING;
      try { o.initDimensions(); } catch (_) { /* keep going */ }
    });
    return fn();
  } finally {
    touched.forEach(({ obj, prev }) => {
      obj.charSpacing = prev;
      try { obj.initDimensions(); } catch (_) { /* ignore */ }
    });
  }
}

/**
 * Render a thumbnail from canvas JSON using an offscreen Fabric canvas.
 * Returns a data URL (PNG) or empty string on failure.
 */
async function renderOffscreenThumbnail(canvasJson, width, height) {
  try {
    const el = document.createElement('canvas');
    el.width = width;
    el.height = height;
    const offscreen = new FabricCanvas(el, { width, height });
    await offscreen.loadFromJSON(canvasJson);
    await ensureFontsAndRemeasure(offscreen);
    offscreen.renderAll();
    const dataUrl = offscreen.toDataURL({ format: 'png', multiplier: 0.5 });
    offscreen.dispose();
    return dataUrl;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Offscreen thumbnail render failed:', err);
    }
    return '';
  }
}

/**
 * Generate high-res export PNG from canvas JSON using an offscreen Fabric canvas.
 * Returns a data URL (PNG at 3x resolution) or empty string on failure.
 * We use PNG instead of SVG because SVG text requires the exact fonts on the
 * server, whereas browser-rendered PNG captures text with loaded web fonts.
 */
async function renderOffscreenExportPng(canvasJson, width, height) {
  try {
    const el = document.createElement('canvas');
    el.width = width;
    el.height = height;
    const offscreen = new FabricCanvas(el, { width, height });
    await offscreen.loadFromJSON(canvasJson);
    await ensureFontsAndRemeasure(offscreen);
    offscreen.renderAll();
    const dataUrl = withoutExcludedObjects(offscreen, () =>
      offscreen.toDataURL({ format: 'png', multiplier: 3 })
    );
    offscreen.dispose();
    return dataUrl;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Offscreen export PNG render failed:', err);
    }
    return '';
  }
}

/**
 * Generate a real vector SVG from canvas JSON using an offscreen Fabric canvas.
 * Returns SVG markup or empty string on failure.
 *
 * Rendered offscreen at the view's NATIVE dimensions (zoom = 1), so the
 * resulting <svg> carries the correct width/height/viewBox regardless of the
 * responsive zoom applied to the live on-screen canvas. This is stored as
 * `export_vector` and used by the SVG export — vector shapes/paths stay vector.
 * Text is emitted as <text> referencing its font family, so the production
 * machine needs that font installed (or the operator outlines it).
 */
async function renderOffscreenExportSvg(canvasJson, width, height, { perCharacter = false } = {}) {
  try {
    const el = document.createElement('canvas');
    el.width = width;
    el.height = height;
    const offscreen = new FabricCanvas(el, { width, height });
    await offscreen.loadFromJSON(canvasJson);
    await ensureFontsAndRemeasure(offscreen);
    offscreen.renderAll();
    const baselinePaths = collectBaselinePathData(offscreen);
    const textPathInfos = collectTextPathInfo(offscreen);
    const serialize = () => withoutExcludedObjects(offscreen, () => offscreen.toSVG());
    const svg = perCharacter ? withPerCharacterSpans(offscreen, serialize) : serialize();
    offscreen.dispose();
    return { svg, baselinePaths, textPathInfos };
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Offscreen export SVG render failed:', err);
    }
    return { svg: '', baselinePaths: new Set(), textPathInfos: [] };
  }
}


/**
 * Generate a native LightBurn project (.lbrn2) from canvas JSON.
 *
 * Runs on its own offscreen canvas because the writer reads the LIVE objects
 * (curve presets, calcTextWidth for the bend handle) — and after
 * ensureFontsAndRemeasure, so ink widths are measured with the real font, not
 * a fallback. Returns { xml, skipped } or null when the view has no physical
 * width — a laser file without real units is worse than no file.
 */
async function renderOffscreenLbrn(canvasJson, width, height, widthMm) {
  if (!(widthMm > 0)) return null;
  try {
    const el = document.createElement('canvas');
    el.width = width;
    el.height = height;
    const offscreen = new FabricCanvas(el, { width, height });
    await offscreen.loadFromJSON(canvasJson);
    await ensureFontsAndRemeasure(offscreen);
    const result = buildLbrnProject(offscreen, { mmPerPx: widthMm / width });
    offscreen.dispose();
    return result;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Offscreen lbrn render failed:', err);
    }
    return null;
  }
}

/**
 * Build the two production SVG variants from a view's canvas JSON:
 *   outline — every glyph as a vector <path>; geometry-exact, no font needed
 *   embed   — editable <text> with base64 @font-face, except runs Fabric places
 *             character by character, which are outlined (see isPerCharacterText)
 *
 * Never falls back to the raw Fabric markup. That fallback is what hid the
 * malformed-XML bug for an entire release: both variants silently held the same
 * unusable string, the server dropped it, and the SVG export quietly served a
 * bitmap instead. A variant that cannot be produced correctly is returned empty
 * and reported, so the failure is visible instead of shipping to a laser.
 */
async function buildExportVectors(canvasJson, width, height, opts) {
  // Two renders on purpose: the outline pass wants Fabric's per-character
  // positions, the embed pass wants the lines left whole so they stay editable.
  const [exact, editable] = await Promise.all([
    renderOffscreenExportSvg(canvasJson, width, height, { perCharacter: true }),
    renderOffscreenExportSvg(canvasJson, width, height),
  ]);
  if (!exact.svg || !editable.svg) {
    return { outline: '', embed: '', errors: ['offscreen SVG render failed'] };
  }

  const errors = [];
  const attempt = async (label, fn) => {
    try {
      return await fn();
    } catch (err) {
      errors.push(`${label}: ${err.message}`);
      // eslint-disable-next-line no-console
      console.error(`ProductForge export (${label}) failed:`, err);
      return '';
    }
  };

  const [outline, embed, lbrnResult] = await Promise.all([
    attempt('outline', () => outlineSvgText(exact.svg,
      { ...opts, baselinePaths: exact.baselinePaths, pxWidth: width, pxHeight: height })),
    attempt('embed', () => embedFontsInSvg(editable.svg,
      { ...opts, baselinePaths: editable.baselinePaths, textPathInfos: editable.textPathInfos,
        pxWidth: width, pxHeight: height })),
    renderOffscreenLbrn(canvasJson, width, height, opts.widthMm),
  ]);
  if (lbrnResult?.skipped?.length) {
    // Not fatal — the file is still written — but the operator must be able to
    // find out why something is missing from it.
    // eslint-disable-next-line no-console
    console.warn('ProductForge lbrn export, overgeslagen onderdelen:', lbrnResult.skipped);
  }
  return { outline, embed, lbrn: lbrnResult?.xml || '', errors };
}

export {
  ensureFontsAndRemeasure,
  isProductionExcluded,
  withoutExcludedObjects,
  collectBaselinePathData,
  renderOffscreenThumbnail,
  renderOffscreenExportPng,
  renderOffscreenExportSvg,
  buildExportVectors,
};
