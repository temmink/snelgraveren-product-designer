/**
 * Load Google Fonts that aren't web-safe or custom.
 *
 * The actual loading (proxy-FontFace registration under the exact stored
 * family name + css2 <link> fallback) lives in the shared module, so the
 * admin template builder gets the same alias-resolution fix — see
 * shared/js/googleFontLoader.js for why that matters.
 */
import { loadGoogleFontFamilies, injectCustomFontFaces } from '../../../../../shared/js/googleFontLoader';

const WEB_SAFE = [
  'Arial', 'Verdana', 'Helvetica', 'Tahoma', 'Trebuchet MS',
  'Times New Roman', 'Georgia', 'Garamond', 'Courier New',
  'Impact', 'Comic Sans MS',
];

// Custom font families loaded from the server — populated by loadCustomFonts()
let customFamilies = [];

export function loadGoogleFonts(fontFamilies, restUrl) {
  const googleFonts = fontFamilies.filter(
    (f) => !WEB_SAFE.includes(f) && !customFamilies.includes(f)
  );
  loadGoogleFontFamilies(googleFonts, restUrl);
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

  injectCustomFontFaces(fonts);
}
