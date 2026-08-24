/**
 * Curated list of fonts available in the template builder.
 * Web-safe fonts are available without loading; Google Fonts need a stylesheet.
 */
import { loadGoogleFontFamilies, injectCustomFontFaces, normalizeGoogleName } from '../../../../../shared/js/googleFontLoader';

export const AVAILABLE_FONTS = [
  // Web-safe fonts (no loading needed)
  { family: 'Arial', category: 'sans-serif', source: 'web-safe' },
  { family: 'Verdana', category: 'sans-serif', source: 'web-safe' },
  { family: 'Helvetica', category: 'sans-serif', source: 'web-safe' },
  { family: 'Tahoma', category: 'sans-serif', source: 'web-safe' },
  { family: 'Trebuchet MS', category: 'sans-serif', source: 'web-safe' },
  { family: 'Times New Roman', category: 'serif', source: 'web-safe' },
  { family: 'Georgia', category: 'serif', source: 'web-safe' },
  { family: 'Garamond', category: 'serif', source: 'web-safe' },
  { family: 'Courier New', category: 'monospace', source: 'web-safe' },
  { family: 'Impact', category: 'display', source: 'web-safe' },
  { family: 'Comic Sans MS', category: 'handwriting', source: 'web-safe' },

  // Google Fonts (popular picks)
  { family: 'Roboto', category: 'sans-serif', source: 'google' },
  { family: 'Open Sans', category: 'sans-serif', source: 'google' },
  { family: 'Lato', category: 'sans-serif', source: 'google' },
  { family: 'Montserrat', category: 'sans-serif', source: 'google' },
  { family: 'Poppins', category: 'sans-serif', source: 'google' },
  { family: 'Inter', category: 'sans-serif', source: 'google' },
  { family: 'Raleway', category: 'sans-serif', source: 'google' },
  { family: 'Nunito', category: 'sans-serif', source: 'google' },
  { family: 'Ubuntu', category: 'sans-serif', source: 'google' },
  { family: 'Oswald', category: 'sans-serif', source: 'google' },
  { family: 'Playfair Display', category: 'serif', source: 'google' },
  { family: 'Merriweather', category: 'serif', source: 'google' },
  { family: 'Lora', category: 'serif', source: 'google' },
  { family: 'PT Serif', category: 'serif', source: 'google' },
  { family: 'Roboto Slab', category: 'serif', source: 'google' },
  { family: 'Roboto Mono', category: 'monospace', source: 'google' },
  { family: 'Source Code Pro', category: 'monospace', source: 'google' },
  { family: 'Fira Code', category: 'monospace', source: 'google' },
  { family: 'Dancing Script', category: 'handwriting', source: 'google' },
  { family: 'Pacifico', category: 'handwriting', source: 'google' },
  { family: 'Great Vibes', category: 'handwriting', source: 'google' },
  { family: 'Caveat', category: 'handwriting', source: 'google' },
  { family: 'Satisfy', category: 'handwriting', source: 'google' },
  { family: 'Bebas Neue', category: 'display', source: 'google' },
  { family: 'Lobster', category: 'display', source: 'google' },
  { family: 'Righteous', category: 'display', source: 'google' },
  { family: 'Permanent Marker', category: 'display', source: 'google' },
  { family: 'Alfa Slab One', category: 'display', source: 'google' },
  { family: 'Anton', category: 'display', source: 'google' },
  { family: 'Bangers', category: 'display', source: 'google' },
];

/**
 * Load Google Fonts that aren't already loaded.
 *
 * The actual loading (proxy-FontFace registration under the exact stored
 * family name + css2 <link> fallback) lives in the shared module, so the
 * builder resolves non-canonical aliases ("BebasNeue") the same way the
 * customer-facing designer does — see shared/js/googleFontLoader.js for why
 * that matters. `restUrl` is the plugin's REST base, read by the caller
 * from `window.sgpdTemplateBuilder.restUrl` (mirrors `config.rest_url` on
 * the frontend) and passed in rather than read from a global here.
 */
export function loadGoogleFonts(fontFamilies, restUrl) {
  const googleFonts = fontFamilies.filter((family) => {
    // A stored family may be a non-canonical alias ("BebasNeue" instead of
    // the catalogue's "Bebas Neue") — match against the catalogue's
    // canonical name too, so the alias still gets recognised as a Google
    // font and reaches loadGoogleFontFamilies (which registers it under
    // its EXACT stored name via the proxy).
    const font = AVAILABLE_FONTS.find(
      (f) => f.family === family || f.family === normalizeGoogleName(family)
    );
    return font && font.source === 'google';
  });

  loadGoogleFontFamilies(googleFonts, restUrl);
}

/**
 * Inject @font-face rules for custom-uploaded fonts.
 * @param {Array} customFonts — from GET /pf/v1/fonts: [{family, files: [{file_url, format}]}]
 */
export function loadCustomFonts(customFonts) {
  injectCustomFontFaces(customFonts);
}

/**
 * Merge custom fonts into AVAILABLE_FONTS for the font picker.
 * Returns a new array with builtin + custom fonts sorted alphabetically by
 * family (case-insensitive), so the picker reads A→Z everywhere.
 */
export function mergeCustomFonts(customFonts) {
  return [
    ...AVAILABLE_FONTS,
    ...customFonts.map((f) => ({
      family: f.family,
      category: 'custom',
      source: 'custom',
    })),
  ].sort((a, b) => a.family.localeCompare(b.family, undefined, { sensitivity: 'base' }));
}
