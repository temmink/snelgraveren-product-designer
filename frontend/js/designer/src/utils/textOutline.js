/**
 * SVG text outlining + font embedding for production-ready SVG exports.
 *
 * Fabric.js `toSVG()` emits `<text>` elements that reference a font by family
 * name only. Opened in an app without that font, the substitute font has a
 * different width, so centred text (positioned by Fabric at x = -width/2) drifts
 * out of the middle. Two fixes:
 *
 *  A. outlineSvgText()  — replace every <text> with vector <path> glyph outlines
 *     (rendered with opentype.js at the exact x/y Fabric already computed). No
 *     font needed to open the file; centring is baked into the geometry. Default.
 *
 *  B. embedFontsInSvg() — keep the <text> editable but inject an @font-face with
 *     the base64 font bytes, so any viewer that honours it renders the real font.
 *
 * Font bytes: custom fonts are fetched from their uploaded URL (same origin);
 * Google fonts come from the plugin's /pf/v1/font-file proxy, which returns TTF
 * (opentype-parseable, no woff2 decoding, no CORS). opentype.js is imported
 * dynamically so it only loads when an export actually runs.
 */

const WEB_SAFE = new Set([
  'Arial', 'Verdana', 'Helvetica', 'Tahoma', 'Trebuchet MS',
  'Times New Roman', 'Georgia', 'Garamond', 'Courier New',
  'Impact', 'Comic Sans MS', 'sans-serif', 'serif', 'monospace',
]);

let _opentype = null;
const _fontCache = new Map();   // `${family}|${weight}` -> opentype.Font | null
const _faceCache = new Map();   // `${family}|${weight}` -> {mime, b64} | null

async function getOpentype() {
  if (!_opentype) {
    const mod = await import('opentype.js');
    _opentype = mod.default || mod;
  }
  return _opentype;
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

const _rawCache = new Map(); // url -> ArrayBuffer
async function fetchBytes(url) {
  if (_rawCache.has(url)) return _rawCache.get(url);
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`font fetch ${res.status}`);
  const buf = await res.arrayBuffer();
  _rawCache.set(url, buf);
  return buf;
}

function findCustom(customFonts, family) {
  return (customFonts || []).find((f) => f.family === family) || null;
}

/** Google font proxy → { format:'ttf', data:<base64> } or null. */
async function fetchGoogleFace(restUrl, family, weight) {
  if (!restUrl) return null;
  try {
    // restUrl is the pf/v1 base (e.g. https://site/wp-json/pf/v1).
    const url = `${restUrl.replace(/\/$/, '')}/font-file?family=${encodeURIComponent(family)}&weight=${weight}`;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return null;
    const json = await res.json();
    return json && json.data ? { mime: 'font/ttf', b64: json.data } : null;
  } catch (_) {
    return null;
  }
}

/**
 * Base64 @font-face payload for a family/weight — { mime, b64 } or null.
 * Cached. Used by embedFontsInSvg().
 */
async function getFace(family, weight, opts) {
  const key = `${family}|${weight}`;
  if (_faceCache.has(key)) return _faceCache.get(key);

  let face = null;
  try {
    if (!WEB_SAFE.has(family)) {
      const custom = findCustom(opts.customFonts, family);
      if (custom && custom.files && custom.files.length) {
        const pick = custom.files[0];
        const fmt = (pick.format || 'woff2').toLowerCase();
        const mime = fmt === 'ttf' ? 'font/ttf' : fmt === 'otf' ? 'font/otf'
                   : fmt === 'woff' ? 'font/woff' : 'font/woff2';
        const buf = await fetchBytes(pick.file_url);
        face = { mime, b64: arrayBufferToBase64(buf) };
      } else {
        face = await fetchGoogleFace(opts.restUrl, family, weight);
      }
    }
  } catch (_) {
    face = null;
  }

  _faceCache.set(key, face);
  return face;
}

/**
 * opentype.Font for a family/weight (or null if unresolved / woff2 custom /
 * web-safe). Cached.
 */
async function getFont(family, weight, opts) {
  const key = `${family}|${weight}`;
  if (_fontCache.has(key)) return _fontCache.get(key);

  let font = null;
  try {
    if (!WEB_SAFE.has(family)) {
      let buf = null;
      const custom = findCustom(opts.customFonts, family);
      if (custom && custom.files && custom.files.length) {
        // opentype.js parses ttf/otf/woff — not woff2. Prefer a non-woff2 file.
        const pick = custom.files.find((f) => !/woff2/i.test(f.format || '')) || null;
        if (pick) buf = await fetchBytes(pick.file_url);
      } else {
        const face = await fetchGoogleFace(opts.restUrl, family, weight);
        if (face) buf = base64ToArrayBuffer(face.b64);
      }
      if (buf) {
        const opentype = await getOpentype();
        font = opentype.parse(buf);
      }
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`textOutline: could not load font "${family}" ${weight}:`, err);
    }
    font = null;
  }

  _fontCache.set(key, font);
  return font;
}

function parseSize(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function readTextAttrs(textEl) {
  const family = (textEl.getAttribute('font-family') || '').replace(/['"]/g, '').trim();
  const weight = /bold|[6-9]00/i.test(textEl.getAttribute('font-weight') || '') ? 700 : 400;
  const size = parseSize(textEl.getAttribute('font-size') || '0');
  return { family, weight, size };
}

/**
 * Replace every <text> in a Fabric-generated SVG with vector <path> outlines.
 * Leaves a <text> untouched when its font can't be outlined, so the export
 * never ends up with missing glyphs.
 *
 * @param {string} svg
 * @param {{customFonts?:Array, restUrl?:string}} opts
 * @returns {Promise<string>}
 */
export async function outlineSvgText(svg, opts = {}) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return svg;
  } catch (_) {
    return svg;
  }

  const textNodes = Array.from(doc.querySelectorAll('text'));
  if (textNodes.length === 0) return svg;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  for (const textEl of textNodes) {
    const { family, weight, size } = readTextAttrs(textEl);
    if (!family || !size) continue;

    const font = await getFont(family, weight, opts);
    if (!font) continue; // web-safe / unresolved → keep <text>

    const fill = textEl.style.fill || textEl.getAttribute('fill') || '#000000';
    const opacity = textEl.style.opacity || textEl.getAttribute('opacity') || '';

    // Each <tspan> carries the baseline x/y Fabric already computed (incl. the
    // -width/2 centring offset). Render the same glyphs at the same baseline.
    const spans = Array.from(textEl.querySelectorAll('tspan'));
    const runs = spans.length ? spans : [textEl];

    let combined = '';
    for (const span of runs) {
      const content = span.textContent || '';
      if (!content) continue;
      const x = parseFloat(span.getAttribute('x') || '0') || 0;
      const y = parseFloat(span.getAttribute('y') || '0') || 0;
      try {
        combined += font.getPath(content, x, y, size).toPathData(3);
      } catch (_) { /* skip run */ }
    }
    if (!combined) continue;

    const pathEl = doc.createElementNS(SVG_NS, 'path');
    pathEl.setAttribute('d', combined);
    pathEl.setAttribute('fill', fill);
    if (opacity) pathEl.setAttribute('opacity', opacity);
    textEl.parentNode.replaceChild(pathEl, textEl);
  }

  return new XMLSerializer().serializeToString(doc);
}

/**
 * Keep <text> editable but embed the fonts it uses as base64 @font-face rules,
 * so viewers that honour embedded fonts render the correct typeface. Fonts that
 * can't be fetched are skipped.
 *
 * @param {string} svg
 * @param {{customFonts?:Array, restUrl?:string}} opts
 * @returns {Promise<string>}
 */
export async function embedFontsInSvg(svg, opts = {}) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return svg;
  } catch (_) {
    return svg;
  }

  const textNodes = Array.from(doc.querySelectorAll('text'));
  if (textNodes.length === 0) return svg;

  const wanted = new Map(); // family -> Set(weight)
  for (const t of textNodes) {
    const { family, weight } = readTextAttrs(t);
    if (!family || WEB_SAFE.has(family)) continue;
    if (!wanted.has(family)) wanted.set(family, new Set());
    wanted.get(family).add(weight);
  }
  if (wanted.size === 0) return svg;

  const faces = [];
  for (const [family, weights] of wanted) {
    for (const weight of weights) {
      const face = await getFace(family, weight, opts);
      if (face) {
        faces.push(`@font-face{font-family:'${family}';font-weight:${weight};`
          + `src:url(data:${face.mime};base64,${face.b64});}`);
      }
    }
  }
  if (faces.length === 0) return svg;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const defs = doc.createElementNS(SVG_NS, 'defs');
  const style = doc.createElementNS(SVG_NS, 'style');
  style.setAttribute('type', 'text/css');
  style.textContent = faces.join('\n');
  defs.appendChild(style);
  const root = doc.documentElement;
  root.insertBefore(defs, root.firstChild);

  return new XMLSerializer().serializeToString(doc);
}
