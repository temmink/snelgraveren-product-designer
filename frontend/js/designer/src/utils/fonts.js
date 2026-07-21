/**
 * Load Google Fonts that aren't web-safe or custom.
 * Injects a single <link> tag for all required Google Fonts.
 */

const WEB_SAFE = [
  'Arial', 'Verdana', 'Helvetica', 'Tahoma', 'Trebuchet MS',
  'Times New Roman', 'Georgia', 'Garamond', 'Courier New',
  'Impact', 'Comic Sans MS',
];

// Custom font families loaded from the server — populated by loadCustomFonts()
let customFamilies = [];

// Google families already registered via the TTF proxy this session.
const _proxyRegistered = new Set();

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Google Fonts' canonical family names are space-separated ("Bebas Neue").
 * A design (or template) may store the family without the space ("BebasNeue"),
 * which 404s the css2 API and never loads — the canvas then falls back to a
 * different-width font, so Fabric mis-measures and centred text drifts in the
 * export. Split camelCase into words to recover the canonical Google name.
 * Mirrors the server-side fallback in RestFonts (the /font-file proxy).
 */
function normalizeGoogleName(family) {
  return family.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/**
 * Register a Google font under the EXACT family name the design references,
 * sourcing the bytes from the plugin's /pf/v1/font-file proxy (which normalises
 * the name server-side and returns TTF). This guarantees the font is available
 * under the design's own family string — even when that string isn't Google's
 * canonical name — so the canvas renders and Fabric measures with the real font.
 */
async function registerViaProxy(family, restUrl) {
  if (!restUrl || typeof FontFace === 'undefined') return;
  if (_proxyRegistered.has(family)) return;
  _proxyRegistered.add(family);
  const base = restUrl.replace(/\/$/, '');
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
    } catch (_) {
      // Proxy unreachable / unparseable — the css2 <link> below is the fallback.
    }
  }
}

export function loadGoogleFonts(fontFamilies, restUrl) {
  const googleFonts = fontFamilies.filter(
    (f) => !WEB_SAFE.includes(f) && !customFamilies.includes(f)
  );
  if (googleFonts.length === 0) return;

  // Primary path: register each font under its exact stored name via the proxy,
  // so a non-canonical family ("BebasNeue") still resolves on the canvas.
  googleFonts.forEach((f) => registerViaProxy(f, restUrl));

  // Fallback path: the css2 <link>, using canonical (space-separated) names so
  // correctly-named families still load fast from Google's CDN.
  const linkId = 'pf-google-fonts';
  let link = document.getElementById(linkId);

  const families = googleFonts
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
 * Escape a string for safe use inside CSS single-quoted values.
 */
function cssEscape(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Inject @font-face CSS for custom-uploaded fonts.
 * Must be called BEFORE loadGoogleFonts so custom families are excluded.
 * @param {Array} fonts — [{family, files: [{file_url, format}]}]
 */
export function loadCustomFonts(fonts) {
  if (!fonts || fonts.length === 0) return;

  // Track custom families so loadGoogleFonts skips them
  customFamilies = fonts.map((f) => f.family);

  const styleId = 'pf-custom-fonts';
  let style = document.getElementById(styleId);

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

  if (style) {
    style.textContent = css;
  } else {
    style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  }
}
