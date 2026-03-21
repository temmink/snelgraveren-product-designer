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

export function loadGoogleFonts(fontFamilies) {
  const googleFonts = fontFamilies.filter(
    (f) => !WEB_SAFE.includes(f) && !customFamilies.includes(f)
  );
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
