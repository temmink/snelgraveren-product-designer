/**
 * Shared Google Fonts loading logic used by both the customer-facing
 * designer and the admin template builder.
 *
 * Google Fonts' canonical family names are space-separated ("Bebas Neue").
 * A design (or template) may store the family without the space
 * ("BebasNeue"), which 404s the css2 API and never loads — the canvas then
 * silently falls back to a different-width font, so Fabric mis-measures and
 * centred/placed text drifts. The fix is to ALSO register the font under
 * the exact stored alias via the plugin's /pf/v1/font-file proxy (which
 * normalises the name server-side and returns TTF bytes), independent of
 * whether that alias happens to be Google's canonical name.
 *
 * This module used to be duplicated: the customer designer
 * (frontend/js/designer/src/utils/fonts.js) had the proxy-FontFace
 * registration, the admin template builder
 * (admin/js/template-builder/src/utils/fonts.js) only had the css2 <link>
 * fallback below. That meant the builder measured "BebasNeue" against a
 * fallback face ~35% wider than the real one, so merchants laid out text
 * against the wrong metrics and it appeared to overflow/misalign for
 * customers. Both apps now share this module — see each app's own
 * utils/fonts.js for the thin per-app wrapper (Google-font filtering
 * differs: the designer excludes a runtime WEB_SAFE/custom-family list, the
 * builder checks its curated AVAILABLE_FONTS catalogue).
 */

// Google families already registered via the TTF proxy this session.
const _proxyRegistered = new Set();

/**
 * Subscribers notified once a family's exact-alias FontFace has actually
 * been added to `document.fonts` by `registerViaProxy` below.
 *
 * This exists because `document.fonts`' own `'loadingdone'` event is NOT a
 * reliable signal for this path: the FontFace here is constructed from
 * proxy-fetched bytes and `await face.load()`d BEFORE it is `add()`ed to
 * the set, so by the time the set sees it, it's already in the `loaded`
 * state — the set never observes an unloaded->loading->loaded transition
 * for it, and per the CSS Font Loading spec that's what drives
 * `'loadingdone'`. So callers that need to know exactly when an alias
 * becomes available (to re-measure text objects created before it
 * resolved) must subscribe here instead of listening for that event.
 */
const _familyLoadListeners = new Set();

/**
 * Subscribe to be notified (with the family name) every time
 * `registerViaProxy` successfully adds a FontFace for that family. Returns
 * an unsubscribe function.
 */
export function onFontFamilyLoaded(callback) {
  _familyLoadListeners.add(callback);
  return () => _familyLoadListeners.delete(callback);
}

function notifyFamilyLoaded(family) {
  _familyLoadListeners.forEach((cb) => {
    try {
      cb(family);
    } catch (_) {
      // A subscriber's own error must not break other subscribers.
    }
  });
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Recover Google's canonical (space-separated) family name from a
 * camelCase-collapsed alias, e.g. "BebasNeue" -> "Bebas Neue". Mirrors the
 * server-side fallback in RestFonts (the /font-file proxy).
 */
export function normalizeGoogleName(family) {
  return family.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/**
 * Escape a string for safe use inside CSS single-quoted values.
 */
export function cssEscape(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Register a Google font under the EXACT family name it's referenced by,
 * sourcing the bytes from the plugin's /pf/v1/font-file proxy. This
 * guarantees the font is available under that exact family string — even
 * when it isn't Google's canonical name — so the canvas renders and Fabric
 * measures with the real font instead of silently falling back.
 */
async function registerViaProxy(family, restUrl) {
  if (!restUrl || typeof FontFace === 'undefined') return;
  if (_proxyRegistered.has(family)) return;
  _proxyRegistered.add(family);
  const base = restUrl.replace(/\/$/, '');
  let loadedAny = false;
  for (const weight of [400, 700]) {
    try {
      const res = await fetch(
        `${base}/font-file?family=${encodeURIComponent(family)}&weight=${weight}`,
        { credentials: 'omit' }
      );
      if (!res.ok) continue;
      const json = await res.json();
      if (!json || !json.data) continue;
      const face = new FontFace(family, base64ToArrayBuffer(json.data), {
        weight: String(weight),
      });
      await face.load();
      document.fonts.add(face);
      loadedAny = true;
    } catch (_) {
      // Proxy unreachable / unparseable — the css2 <link> below is the fallback.
    }
  }
  // Notify once the family has at least one usable weight registered, so
  // callers can re-measure any text objects that were created/measured
  // before this resolved (see the doc comment on _familyLoadListeners for
  // why this can't be done via a document.fonts event instead).
  if (loadedAny) notifyFamilyLoaded(family);
}

/**
 * Load a pre-filtered list of Google font families: register each under its
 * exact stored name via the proxy (primary path, so a non-canonical alias
 * like "BebasNeue" still resolves), and inject/update a shared css2 <link>
 * using canonical names as a fast-loading fallback.
 *
 * Callers are responsible for filtering `fontFamilies` down to just the
 * Google fonts that need loading (web-safe / custom families excluded) —
 * that filtering differs per app and stays in each app's own utils/fonts.js.
 */
export function loadGoogleFontFamilies(fontFamilies, restUrl) {
  if (!fontFamilies || fontFamilies.length === 0) return;

  // Primary path: register each font under its exact stored name via the
  // proxy, so a non-canonical family ("BebasNeue") still resolves on the
  // canvas.
  fontFamilies.forEach((f) => registerViaProxy(f, restUrl));

  // Fallback path: the css2 <link>, using canonical (space-separated) names
  // so correctly-named families still load fast from Google's CDN.
  const linkId = 'pf-google-fonts';
  let link = document.getElementById(linkId);

  const families = fontFamilies
    .map((f) => normalizeGoogleName(f).replace(/ /g, '+') + ':wght@400;700')
    .join('&family=');
  const href = `https://fonts.googleapis.com/css2?family=${families}&display=swap`;

  if (link) {
    if (link.href !== href) {
      link.href = href;
    }
  } else {
    link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
}

/**
 * Inject @font-face CSS for custom-uploaded fonts.
 * @param {Array} fonts — [{family, files: [{file_url, format}]}]
 * @param {string} [styleId] — id of the <style> element to create/update.
 */
export function injectCustomFontFaces(fonts, styleId = 'pf-custom-fonts') {
  if (!fonts || fonts.length === 0) return;

  const css = fonts
    .map((font) => {
      const sources = font.files
        .map((f) => `url('${cssEscape(f.file_url)}') format('${cssEscape(f.format)}')`)
        .join(',\n       ');
      return `@font-face {
  font-family: '${cssEscape(font.family)}';
  src: ${sources};
  font-display: swap;
}`;
    })
    .join('\n\n');

  let style = document.getElementById(styleId);
  if (style) {
    style.textContent = css;
  } else {
    style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  }
}
