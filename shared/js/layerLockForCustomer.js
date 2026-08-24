/**
 * Whether a template layer must render locked (non-interactive) for the
 * customer, given the Template Builder's per-layer padlock (`layer.locked`).
 *
 * RULING R21 — asymmetric defaults, chosen from a measurement across every
 * layer on all 11 live templates at the time this was written:
 *
 *   svg   / locked MISSING = 124
 *   text  / locked false   = 19
 *   text  / locked true    = 1   (merchant already used the padlock here)
 *   image / locked true    = 1
 *
 * A single `locked === true` rule would release all 124 unset svg layers —
 * artwork like a LightBurn-imported "wolfje" stack — to customer dragging,
 * which is exactly the regression this rule exists to prevent. So the
 * default depends on layer type, and each default reproduces what that
 * layer type already did before the padlock was wired to the customer side:
 *
 *   - text          → locked only when `locked === true` (default movable)
 *   - svg and image → locked unless `locked === false`   (default locked)
 *
 * Toggling a layer's padlock to an explicit `false` is what releases an
 * svg/image layer to the customer; toggling it to `true` is what locks a
 * text layer. Merchant intent, once expressed via the padlock, always wins.
 *
 * @param {{type?:string, locked?:boolean}|null|undefined} layer
 * @returns {boolean}
 */
export function isLayerLockedForCustomer(layer) {
  if (layer?.type === 'text') {
    return layer?.locked === true;
  }
  return layer?.locked !== false;
}
