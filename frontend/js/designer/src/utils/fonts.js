/**
 * Load Google Fonts that aren't web-safe.
 * Injects a single <link> tag for all required Google Fonts.
 */

const WEB_SAFE = [
  'Arial', 'Verdana', 'Helvetica', 'Tahoma', 'Trebuchet MS',
  'Times New Roman', 'Georgia', 'Garamond', 'Courier New',
  'Impact', 'Comic Sans MS',
];

export function loadGoogleFonts(fontFamilies) {
  const googleFonts = fontFamilies.filter((f) => !WEB_SAFE.includes(f));
  if (googleFonts.length === 0) return;

  const linkId = 'pd-google-fonts';
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
