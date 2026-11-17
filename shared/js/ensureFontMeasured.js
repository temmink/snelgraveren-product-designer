/**
 * Per-object guard against Fabric.js measuring text with a fallback font.
 *
 * Fabric memoizes character widths per font family in a module-global cache
 * (fabric's `cache.charWidthsCache`, exposed to callers as the `cache`
 * export — `import { cache } from 'fabric'`). If a text object is created
 * or its fontFamily/fontSize changes before the real @font-face has finished
 * loading, Fabric measures against whatever face the browser substitutes and
 * CACHES that width. When the real font loads moments later, the object's
 * `width` / bounding box stays wrong until something clears the cache for
 * that family and re-measures THIS object.
 *
 * The app-level `document.fonts.addEventListener('loadingdone', ...)`
 * handler (kept as a safety net in both DesignerCanvas.jsx and Canvas.jsx)
 * is a global catch-all, but it does not fire reliably at every real-world
 * load timing. Observed live on the customer designer: the font finishes
 * loading, `document.fonts.status` is `'loaded'` and
 * `document.fonts.check('130px BebasNeue')` is `true`, yet the object's
 * cached width is still the fallback-font width (632 vs a real 466 —
 * +35.6%) because no `loadingdone` event ever reached the listener for that
 * particular load. This helper gives per-object certainty at the moment it
 * actually matters: object creation and font/size changes, independent of
 * whether the global event ever fires.
 *
 * @param {import('fabric').FabricObject} obj - text-like object with
 *   `fontFamily` / `fontSize` (IText, Text, Textbox, curved IText+path, …).
 * @param {{ clearFontCache: (family?: string) => void }} fabricCache - the
 *   SAME `cache` module the caller already imports
 *   (`import { cache } from 'fabric'`). Deliberately passed in rather than
 *   imported directly by this module: the diagnosed defect is exactly a
 *   "two instances of the same module, two caches" bug (a freshly
 *   `import()`ed copy of fabric in a devtools session did not share the
 *   bundled module's cache), so this helper reuses each caller's own
 *   already-correct `fabric` import instead of opening a second import path
 *   that some future bundler/config change could resolve differently. It
 *   also keeps this module a plain, dependency-free, easily unit-testable
 *   function, consistent with the other pure helpers in shared/js/.
 * @returns {Promise<void>} resolves once the object has been re-measured,
 *   or immediately if no re-measurement was needed or possible.
 */
export async function ensureFontMeasured(obj, fabricCache) {
  if (!obj || !obj.fontFamily || typeof document === 'undefined' || !document.fonts) {
    return;
  }

  const family = obj.fontFamily;
  const size = obj.fontSize || 24;
  const fontSpec = `${size}px "${family}"`;

  if (document.fonts.check(fontSpec)) {
    // Already loaded — whatever Fabric measured at creation/update time is
    // trustworthy. Nothing to do.
    return;
  }

  const canvasAtCallTime = obj.canvas;

  try {
    await document.fonts.load(fontSpec);
  } catch {
    // Font failed to load (network error, bad @font-face, …) — leave the
    // existing (fallback-font) measurement in place; nothing more we can do.
    return;
  }

  // The await above can straddle a view switch that disposes the canvas, or
  // a re-render that removes this object. Fabric clears `obj.canvas` when an
  // object is removed (Canvas#_onObjectRemoved) and sets `canvas.disposed`
  // synchronously at the start of Canvas#dispose(). Bail out rather than
  // touching a torn-down canvas or a stale object.
  const canvas = obj.canvas;
  if (
    !canvas ||
    canvas !== canvasAtCallTime ||
    canvas.disposed ||
    !canvas.getObjects().includes(obj)
  ) {
    return;
  }

  fabricCache.clearFontCache(family);
  obj.initDimensions();
  obj.setCoords();
  canvas.renderAll();
}
