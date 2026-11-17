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

/**
 * The Fabric properties a locked template layer gets on the customer's canvas.
 *
 * Locked means "the customer cannot MOVE this layer" — that is what the
 * padlock's own tooltip in the Template Builder says. For artwork (svg,
 * image) that is the same as untouchable. For TEXT it is not: a merchant pins
 * "telefoon nr" in place on the back of a dog tag precisely so the customer
 * types their own number there. Until 1.12.8 a locked text was made
 * unselectable like artwork, so that number could not be changed at all and
 * the example would have been engraved as it stood.
 *
 * A locked text therefore stays selectable and editable — text, font, size,
 * colour — but cannot be dragged, scaled with handles, rotated or deleted.
 *
 * Used where the layer is created AND where a canvas is restored (undo, view
 * switch, reopened design): selectable/evented are never serialised, so the
 * two must come from one place or they drift.
 *
 * @param {boolean} isText
 */
export function customerLockProps(isText) {
  const pinned = {
    hasControls: false,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
  };
  return isText
    ? { ...pinned, selectable: true, evented: true, hoverCursor: 'text' }
    : { ...pinned, selectable: false, evented: false };
}
