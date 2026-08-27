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

import {
  SVG_NS,
  repairFabricSvgMarkup,
  parseSvgOrThrow,
  stripClipPaths,
  stripBaselinePaths,
  applyPhysicalSize,
  glyphTransform,
  measureTextGlyphs,
  withMeasuredSvg,
} from './productionSvg';

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
 * True when Fabric emitted this <text> character by character.
 *
 * Fabric switches to per-character tspans (each with its own x/y and often a
 * `rotate`) as soon as the text sits on a path or carries charSpacing —
 * `timeToRender = i === len || this.charSpacing || this.path` (fabric
 * index.mjs:18896). Multi-line straight text also produces several tspans, but
 * one per LINE, so counting single-character spans separates the two.
 *
 * This is the dividing line for the font-carrying export: LightBurn ignores
 * per-character positions and re-flows those runs with its own advances (
 * measured 2026-08-27: "Lekkere hapjes" imported as "Lekkere ha pjes"), while
 * plain one-tspan-per-line text imports correctly.
 */
export function isPerCharacterText(textEl) {
  const spans = Array.from(textEl.querySelectorAll('tspan'));
  if (spans.some((s) => s.hasAttribute('rotate'))) return true;
  return spans.filter((s) => (s.textContent || '').length === 1).length > 1;
}

/**
 * Turn every <text> in a Fabric-generated SVG into vector <path> outlines, at
 * the exact position and rotation the layout engine gave each character.
 *
 * Also strips what has no business in an engraving file: the zone clip shapes
 * and the baseline curves of curved text.
 *
 * Throws when a font cannot be outlined rather than leaving <text> behind — an
 * export that claims to need no fonts must not quietly depend on one.
 *
 * @param {string} svg
 * @param {{customFonts?:Array, restUrl?:string, baselinePaths?:Set<string>,
 *          only?:(el:Element)=>boolean}} opts
 * @returns {Promise<string>}
 */
export async function outlineSvgText(svg, opts = {}) {
  const doc = parseSvgOrThrow(repairFabricSvgMarkup(svg));
  stripClipPaths(doc);
  stripBaselinePaths(doc, opts.baselinePaths);

  // `only` lets the font-carrying export outline just the runs that need it.
  const wants = typeof opts.only === 'function' ? opts.only : () => true;
  const textNodes = Array.from(doc.querySelectorAll('text'));
  if (textNodes.length === 0 || !textNodes.some(wants)) {
    return finish(doc, opts);
  }

  // Ask the layout engine where every character actually sits. Reading the
  // tspan attributes instead would only work for curved / letter-spaced text —
  // Fabric writes one tspan per LINE for everything else, leaving the
  // per-character advances (and the kerning between them) to the renderer.
  const measured = await withMeasuredSvg(doc, (live) =>
    Array.from(live.querySelectorAll('text')).map((el) => {
      const cs = window.getComputedStyle(el);
      return {
        glyphs: measureTextGlyphs(el),
        family: (cs.fontFamily || '').replace(/['"]/g, '').split(',')[0].trim(),
        size: parseFloat(cs.fontSize) || 0,
        weight: /bold|[6-9]00/i.test(cs.fontWeight || '') ? 700 : 400,
        italic: /italic|oblique/i.test(cs.fontStyle || ''),
      };
    })
  );

  const unresolved = new Set();

  for (let i = 0; i < textNodes.length; i++) {
    const textEl = textNodes[i];
    if (!wants(textEl)) continue;
    const info = measured[i];
    if (!info || !info.family || !info.size || info.glyphs.length === 0) continue;

    const font = await getFont(info.family, info.weight, opts);
    if (!font) {
      // Web-safe families have no file to outline and the machine has them
      // anyway; anything else is a genuine miss the caller must hear about.
      if (!WEB_SAFE.has(info.family)) unresolved.add(info.family);
      continue;
    }

    const fill = textEl.style.fill || textEl.getAttribute('fill') || '#000000';
    const opacity = textEl.style.opacity || textEl.getAttribute('opacity') || '';

    const group = doc.createElementNS(SVG_NS, 'g');
    group.setAttribute('fill', fill);
    group.setAttribute('stroke', 'none');
    if (opacity) group.setAttribute('opacity', opacity);

    for (const g of info.glyphs) {
      let d = '';
      try {
        // Drawn at the origin, then moved and turned by glyphTransform, so the
        // rotation happens around the character's own baseline point.
        d = font.getPath(g.ch, 0, 0, info.size).toPathData(3);
      } catch (_) { continue; }
      if (!d) continue;
      const p = doc.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('transform', glyphTransform(g.x, g.y, g.rotation));
      group.appendChild(p);
    }

    if (group.childNodes.length === 0) continue;
    textEl.parentNode.replaceChild(group, textEl);
  }

  if (unresolved.size) {
    // Loud on purpose. Silently leaving <text> in the "no fonts needed" export
    // is how a plank gets engraved in the wrong typeface.
    throw new Error(`Could not outline font(s): ${Array.from(unresolved).join(', ')}`);
  }

  return finish(doc, opts);
}

/**
 * Last step of both variants: stamp the real-world size on, then serialise.
 * Kept in one place so the two exports can never disagree about scale.
 */
function finish(doc, opts) {
  applyPhysicalSize(doc, {
    widthMm: opts.widthMm,
    pxWidth: opts.pxWidth,
    pxHeight: opts.pxHeight,
  });
  return new XMLSerializer().serializeToString(doc);
}


/**
 * Convert curved <text> runs into real <textPath> elements — the standard SVG
 * form for text on a curve, and the one form LightBurn demonstrably reads
 * (four-way import test, 2026-08-27: per-character tspans re-flowed into
 * "Lekkere ha pjes"; a textPath came in on the curve, in the installed font).
 *
 * The referenced curve is Fabric's OWN baseline for that text, baked into
 * absolute document coordinates, so position and rotation live in the path
 * itself and the <text> needs no transform at all. Glyphs follow the path
 * tangent, which is exactly how the canvas renders them.
 *
 * A text whose settings a textPath cannot express (right-side text,
 * non-baseline alignment, multi-line, a transform with skew or non-uniform
 * scale) is left alone — the caller outlines it instead, which is always
 * geometrically safe.
 *
 * @param {Document} doc
 * @param {Array} infos  collectTextPathInfo() output, in canvas object order
 * @returns {number} how many texts were converted
 */
export function convertCurvedTextsToTextPaths(doc, infos) {
  if (!Array.isArray(infos) || infos.length === 0) return 0;
  const XLINK_NS = 'http://www.w3.org/1999/xlink';
  const root = doc.documentElement;

  let defs = root.querySelector('defs');
  const ensureDefs = () => {
    if (!defs) {
      defs = doc.createElementNS(SVG_NS, 'defs');
      root.insertBefore(defs, root.firstChild);
    }
    return defs;
  };

  // Walk in document order, pairing each emitted baseline path with the last
  // <text> seen before it — Fabric writes them adjacently, text first — and
  // with the next unused info entry carrying the same path data.
  const unused = infos.slice();
  let lastText = null;
  let converted = 0;

  Array.from(root.querySelectorAll('text, path')).forEach((el) => {
    if (el.nodeName === 'text') { lastText = el; return; }
    if (el.closest('defs')) return;

    const d = el.getAttribute('d');
    const idx = unused.findIndex((i) => i.d === d);
    if (idx === -1 || !lastText) return;
    const info = unused.splice(idx, 1)[0];
    const textEl = lastText;
    lastText = null;

    // Settings a <textPath> cannot express — leave this text for the outliner.
    if (info.multiline || info.pathSide !== 'left' || info.pathAlign !== 'baseline') return;
    // No pre-baked curve: the object's matrix had skew/non-uniform scale, or
    // the path used commands baking refuses. Outlining handles those.
    if (!info.bakedD) return;

    const fontSize = parseFloat(textEl.getAttribute('font-size')) || 0;
    if (!fontSize) return;

    const id = `sgpd-baseline-${converted + 1}`;
    const ref = doc.createElementNS(SVG_NS, 'path');
    ref.setAttribute('id', id);
    ref.setAttribute('d', info.bakedD);
    ref.setAttribute('fill', 'none');
    ensureDefs().appendChild(ref);

    const t = doc.createElementNS(SVG_NS, 'text');
    ['font-family', 'font-weight', 'font-style', 'fill', 'style'].forEach((a) => {
      const v = textEl.getAttribute(a);
      if (v) t.setAttribute(a, v);
    });
    // Glyph size does not follow the path's coordinates — it must scale with
    // the object explicitly, the same way Fabric's own matrix scaled it.
    t.setAttribute('font-size', String(Math.round(fontSize * info.scale * 10000) / 10000));
    if (info.letterSpacingPx > 0) {
      t.setAttribute('letter-spacing', String(Math.round(info.letterSpacingPx * info.scale * 10000) / 10000));
    }
    t.setAttribute('xml:space', 'preserve');

    const tp = doc.createElementNS(SVG_NS, 'textPath');
    tp.setAttributeNS(XLINK_NS, 'xlink:href', `#${id}`);
    tp.setAttribute('href', `#${id}`);
    if (info.startOffset) tp.setAttribute('startOffset', String(info.startOffset * info.scale));
    tp.textContent = textEl.textContent || '';
    t.appendChild(tp);
    root.appendChild(t);

    // Retire the originals: the per-character text and the emitted curve.
    const removeWithEmptyWrapper = (node) => {
      const parent = node.parentNode;
      parent?.removeChild(node);
      if (parent && parent.nodeName === 'g' && parent.childNodes.length === 0) {
        parent.parentNode?.removeChild(parent);
      }
    };
    removeWithEmptyWrapper(textEl);
    removeWithEmptyWrapper(el);
    converted += 1;
  });

  return converted;
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
  // First give curved text its standard, LightBurn-readable form.
  const pre = parseSvgOrThrow(repairFabricSvgMarkup(svg));
  stripClipPaths(pre);
  convertCurvedTextsToTextPaths(pre, opts.textPathInfos || []);
  // Any curve that did NOT convert (unsupported settings) still needs its
  // baseline removed, and its text outlined below.
  stripBaselinePaths(pre, opts.baselinePaths);

  // Outline whatever per-character runs remain — letter-spaced straight text,
  // and curved text the conversion had to skip. Everything else stays editable.
  const outlined = await outlineSvgText(
    new XMLSerializer().serializeToString(pre),
    { ...opts, baselinePaths: new Set(), only: isPerCharacterText }
  );
  const doc = parseSvgOrThrow(outlined);

  const textNodes = Array.from(doc.querySelectorAll('text'));
  if (textNodes.length === 0) return finish(doc, opts);

  const wanted = new Map(); // family -> Set(weight)
  for (const t of textNodes) {
    const { family, weight } = readTextAttrs(t);
    if (!family || WEB_SAFE.has(family)) continue;
    if (!wanted.has(family)) wanted.set(family, new Set());
    wanted.get(family).add(weight);
  }
  if (wanted.size === 0) return finish(doc, opts);

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
  // Nothing to embed (only web-safe families, or every font failed to fetch) —
  // the cleaned, outlined document is still the better answer than the raw one.
  if (faces.length === 0) return finish(doc, opts);

  const defs = doc.createElementNS(SVG_NS, 'defs');
  const style = doc.createElementNS(SVG_NS, 'style');
  style.setAttribute('type', 'text/css');
  style.textContent = faces.join('\n');
  defs.appendChild(style);
  const root = doc.documentElement;
  root.insertBefore(defs, root.firstChild);

  return finish(doc, opts);
}
