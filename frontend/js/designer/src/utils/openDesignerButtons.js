/**
 * "Customize Product" buttons that live OUTSIDE the React root.
 *
 * PHP renders one next to #pf-designer-root when the product's display mode
 * is `modal` (Frontend::render_designer). React renders its own copy inside
 * the root on mobile, where every mode is forced to modal. The two must not
 * both show, and every external one must be wired — before this helper the
 * modal effect wired only `querySelector('.pf-open-designer')`, i.e. the first
 * match, which on mobile was React's own button (already wired), so the
 * PHP button below it was dead.
 */
export function getExternalOpenButtons(doc = document) {
  return Array.from(doc.querySelectorAll('.pf-open-designer'))
    .filter((btn) => !btn.closest('#pf-designer-root'));
}
