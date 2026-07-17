/**
 * Read the designer config from the #pf-designer-root DOM element's
 * data-config JSON attribute. Falls back to window.pfDesigner for
 * older PHP builds that still use wp_localize_script.
 *
 * Parsed once and cached. We read from the DOM attribute (not a JS global)
 * so LiteSpeed / WP Rocket / Autoptimize cannot break the bundle by
 * reordering or deferring the inline <script> that defines the global.
 */
let cachedConfig = null;

function parseFromRoot() {
  const root = typeof document !== 'undefined'
    ? document.getElementById('pf-designer-root')
    : null;
  const raw = root?.dataset?.config;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getDesignerConfig() {
  if (cachedConfig) return cachedConfig;
  const fromDom = parseFromRoot();
  if (fromDom) {
    cachedConfig = fromDom;
    return fromDom;
  }
  // Don't cache an empty fallback — re-try on every call until we find it.
  // This guards against the bundle executing before the DOM is queryable
  // (observed on iOS Safari when LiteSpeed delays script execution).
  return (typeof window !== 'undefined' && window.pfDesigner) || {};
}
