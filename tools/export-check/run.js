/**
 * Verification harness for the production SVG exports.
 *
 * Point it at a saved design JSON (the shape POST /designs/{hash}/views stores)
 * and it runs the SAME code path the designer runs on save, then shows the
 * canvas render next to both SVG variants. Started because a broken export
 * shipped unnoticed for a release: it saved fine, looked fine, and only failed
 * on the laser.
 *
 * Usage:  npx vite --config tools/export-check/vite.config.js
 *         then open the page and pass ?design=<url-to-json>
 */
import {
  buildExportVectors,
  renderOffscreenExportPng,
  renderOffscreenExportSvg,
} from '../../frontend/js/designer/src/utils/exportRender';
import { loadGoogleFonts } from '../../frontend/js/designer/src/utils/fonts';

const log = (msg) => {
  document.getElementById('log').textContent += `\n${msg}`;
};

function show(hostId, markup) {
  const host = document.getElementById(hostId);
  host.innerHTML = '';
  if (!markup) { host.textContent = '(leeg)'; return; }
  if (markup.startsWith('data:image')) {
    const img = new Image();
    img.src = markup;
    host.appendChild(img);
    return;
  }
  host.innerHTML = markup;
}

function report(label, svg) {
  if (!svg) return `${label}: LEEG`;
  const count = (re) => (svg.match(re) || []).length;
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const bad = doc.querySelector('parsererror');
  const root = doc.documentElement;
  return [
    `${label}: ${svg.length} tekens`,
    `  maat       : ${root.getAttribute('width')} × ${root.getAttribute('height')}`
      + `  (viewBox ${root.getAttribute('viewBox')})`,
    `  geldig XML : ${bad ? 'NEE — ' + bad.textContent.slice(0, 80) : 'ja'}`,
    `  <path>     : ${count(/<path/g)}`,
    `  <text>     : ${count(/<text/g)}`,
    `  <tspan>    : ${count(/<tspan/g)}`,
    `  <image>    : ${count(/<image/g)}`,
    `  <clipPath> : ${count(/<clipPath/g)}`,
    `  @font-face : ${count(/@font-face/g)}`,
  ].join('\n');
}

async function main() {
  const params = new URLSearchParams(location.search);
  const src = params.get('design') || './design.json';
  log(`design: ${src}`);

  const payload = await (await fetch(src)).json();
  const view = (payload.views || [payload])[0];
  let json = view.canvas_json;
  if (typeof json === 'string') json = JSON.parse(json);

  const width = Number(params.get('w')) || 600;
  const height = Number(params.get('h')) || 245;
  log(`canvas: ${width} × ${height}, objecten: ${(json.objects || []).length}`);

  // Same font loading the designer does, so text is measured with the real font.
  const families = [...new Set((json.objects || [])
    .map((o) => o.fontFamily).filter(Boolean))];
  if (families.length) {
    log(`fonts: ${families.join(', ')}`);
    loadGoogleFonts(families, params.get('rest') || '');
    await document.fonts.ready;
    await Promise.all(families.map((f) => document.fonts.load(`36px "${f}"`).catch(() => {})));
  }

  const png = await renderOffscreenExportPng(json, width, height);
  show('canvasOut', png);

  // Physical width of the view (mm). Without it the export stays in pixels and
  // a laser has to guess a DPI — pass ?mm=457.81 to check the real size.
  const widthMm = Number(params.get('mm')) || 0;
  log(`fysieke breedte: ${widthMm ? widthMm + ' mm' : '(niet opgegeven — export blijft in px)'}`);

  const { outline, embed, lbrn, errors } = await buildExportVectors(json, width, height, {
    customFonts: [], restUrl: params.get('rest') || '', widthMm,
  });
  log(`lbrn: ${lbrn ? lbrn.length + ' tekens' : 'LEEG'}`);

  log(report('outline', outline));
  log(report('embed', embed));
  if (errors?.length) log(`FOUTEN: ${errors.join(' | ')}`);

  show('outlineOut', outline);
  show('embedOut', embed);

  // Fabric's own markup, before any of our processing — needed to tell an
  // export bug apart from a Fabric-layout difference.
  const { svg: raw } = await renderOffscreenExportSvg(json, width, height);

  // Expose for scripted comparison (Puppeteer / DevTools).
  window.__exportCheck = { outline, embed, lbrn, png, raw, errors };
  log('klaar');
}

main().catch((err) => log(`HARNAS-FOUT: ${err.message}\n${err.stack}`));
