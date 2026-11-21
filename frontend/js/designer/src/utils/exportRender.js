/**
 * Offscreen render pipeline for the previews and the 3x PNG — the part of the
 * export every build has.
 *
 * The vector exports (outlined SVG, SVG + fonts, LightBurn .lbrn2) are Pro and
 * live in pro/js/designer-export/, built into their own bundle
 * (dist/frontend-designer-pro.js) that the free build and the public source do
 * not contain. The designer loads it on demand — utils/proExport.js.
 */
import { Canvas as FabricCanvas, cache as fabricCache } from 'fabric';

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

export {
  ensureFontsAndRemeasure,
  isProductionExcluded,
  withoutExcludedObjects,
  renderOffscreenThumbnail,
  renderOffscreenExportPng,
};
