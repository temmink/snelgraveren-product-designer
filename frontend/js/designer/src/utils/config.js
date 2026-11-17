/**
 * Read the designer config from the #pf-designer-root DOM element's
 * data-config JSON attribute. Falls back to window.pfDesigner, which keeps
 * the designer working on stale page-cached HTML from before the data-config
 * deploy (old markup still carries the wp_localize_script inline global).
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

  // Only cache a COMPLETE config (template_id present — PHP always emits it).
  // Caching a partial parse (e.g. an optimizer mangled the attribute into
  // valid-but-empty JSON) would freeze the retry loop in App.jsx on a config
  // that can never become valid.
  const fromDom = parseFromRoot();
  if (fromDom?.template_id) {
    cachedConfig = fromDom;
    return fromDom;
  }

  const fallback = (typeof window !== 'undefined' && window.pfDesigner) || null;
  if (fallback?.template_id) {
    cachedConfig = fallback;
    return fallback;
  }

  // Don't cache an empty/partial result — re-try on every call until we find
  // a complete config. This guards against the bundle executing before the
  // DOM is queryable (observed on iOS Safari when LiteSpeed delays script
  // execution).
  return fromDom || fallback || {};
}
