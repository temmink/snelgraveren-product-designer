/**
 * Curated list of fonts available in the template builder.
 * Web-safe fonts are available without loading; Google Fonts need a stylesheet.
 */

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
 * Injects a single <link> tag for all required Google Fonts.
 */
export function loadGoogleFonts(fontFamilies) {
  const googleFonts = fontFamilies.filter((family) => {
    const font = AVAILABLE_FONTS.find((f) => f.family === family);
    return font && font.source === 'google';
  });

  if (googleFonts.length === 0) return;

  const linkId = 'pf-google-fonts';
  let link = document.getElementById(linkId);

  const families = googleFonts
    .map((f) => f.replace(/ /g, '+') + ':wght@400;700')
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
 * Inject @font-face rules for custom-uploaded fonts.
 * @param {Array} customFonts — from GET /pf/v1/fonts: [{family, files: [{file_url, format}]}]
 */
export function loadCustomFonts(customFonts) {
  if (!customFonts || customFonts.length === 0) return;

  const styleId = 'pf-custom-fonts';
  let style = document.getElementById(styleId);

  const css = customFonts
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
