/**
 * Loader for the Pro production exports (dist/frontend-designer-pro.js).
 *
 * The vector exports (outlined SVG, SVG + fonts, LightBurn) are Pro code and
 * ship in a separate bundle that the free build and the public source do not
 * contain (pro/js/designer-export/). PHP puts its URL in the designer config as
 * `pro_export_url` only on a licensed Pro site; without it the designer saves
 * the PNG export only, which is all a free site can export anyway.
 *
 * The bundle is injected from here rather than enqueued by PHP: it needs the
 * designer's own Fabric (window.sgpdFabric, set just before) — a script tag
 * that LiteSpeed's Delay JS reorders could otherwise run first and find
 * nothing. Injected scripts are not touched by page optimisers.
 *
 * A Pro site where the bundle cannot load still saves — the customer must
 * never be blocked by a production-file problem — but says so loudly in the
 * console and returns empty vectors, which the order screen reports as
 * "no export data" instead of silently serving a bitmap.
 */
import { Canvas, cache } from 'fabric';

const CONTRACT_VERSION = 1;
let loading = null;

function usable(api) {
  return api && api.version === CONTRACT_VERSION && typeof api.buildExportVectors === 'function';
}

export function loadProExport(url) {
  if (usable(window.sgpdDesignerPro)) return Promise.resolve(window.sgpdDesignerPro);
  if (!url) return Promise.resolve(null);
  if (!loading) {
    // Exactly what the Pro bundle imports from 'fabric' (external there).
    window.sgpdFabric = window.sgpdFabric || { Canvas, cache };
    loading = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.setAttribute('data-no-optimize', '1');
      s.onload = () => {
        if (usable(window.sgpdDesignerPro)) { resolve(window.sgpdDesignerPro); return; }
        // eslint-disable-next-line no-console
        console.error('Snelgraveren Product Designer: Pro export bundle loaded but did not register (version mismatch?) — vector exports skipped.');
        resolve(null);
      };
      s.onerror = () => {
        // eslint-disable-next-line no-console
        console.error('Snelgraveren Product Designer: Pro export bundle could not be loaded — vector exports skipped.', url);
        loading = null; // allow a retry on the next save
        resolve(null);
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

const NO_VECTORS = Object.freeze({ outline: '', embed: '', lbrn: '', errors: [] });

/** The vector exports for one view, or empty ones when Pro is not available. */
export async function buildProExportVectors(url, canvasJson, width, height, opts) {
  const pro = await loadProExport(url);
  if (!pro) return NO_VECTORS;
  return pro.buildExportVectors(canvasJson, width, height, opts);
}
