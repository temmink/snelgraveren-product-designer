/**
 * Which zone a CUSTOMER-added element belongs to.
 *
 * ONE mechanism, ONE place. The customer designer asks this question twice —
 * "which zone does a new element of this type go in?" (the Add tools) and
 * "which zone did the customer click in?" (the click-placed tools) — and both
 * copies used to spell the rule out inline. Consolidated here so the two can
 * never drift, per CLAUDE.md's "one mechanism, two places" rule.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * A zone offers itself to the customer only when BOTH hold:
 *
 *   1. it enforces its boundary at all — 'restrict' (clamps movement inside)
 *      or 'clip' (cuts elements off at the outline). Any other behavior
 *      enforces nothing, so binding an element to it would mean binding it to
 *      nothing;
 *   2. it lists the element's type in `allowed_types`.
 *
 * `allowed_types` is therefore a statement about CUSTOMERS, not about what the
 * merchant may put in the zone from the builder. That distinction is the whole
 * point of this module: a LightBurn import creates a canvas-sized container
 * zone to HOLD the imported artwork, and it used to advertise
 * ['text','image','svg'] on it. Being zone 0, it then won every selection —
 * every piece of clip art the customer added bound to the whole canvas instead
 * of the merchant's real engraving boundary further down the list, and landed
 * straddling it. See admin/.../utils/importedZone.js.
 *
 * NOTE: the template builder's own findZoneForPoint answers a DIFFERENT
 * question — where the MERCHANT's click drops a layer — and deliberately
 * accepts 'restrict' zones only. It is not this rule and must not be folded
 * into it.
 *
 * Pure: plain zone objects in, indices out. No Fabric, no React.
 */

/**
 * A zone that visually enforces its boundary: 'restrict' also clamps movement
 * inside it, 'clip' lets elements move freely but cuts them off at the
 * outline. Every other behavior enforces nothing.
 *
 * @param {object} zone
 * @returns {boolean}
 */
export function zoneClips(zone) {
  return !!zone && (zone.behavior === 'restrict' || zone.behavior === 'clip');
}

/**
 * Whether a zone offers itself to the customer as a drop target for a type.
 *
 * @param {object} zone
 * @param {string} elementType 'text' | 'image' | 'svg'
 * @returns {boolean}
 */
export function zoneAcceptsCustomerType(zone, elementType) {
  if (!zoneClips(zone)) return false;
  return (zone.allowed_types || []).includes(elementType);
}

/**
 * Index of the first zone that accepts `elementType` from the customer.
 *
 * @param {object[]} zones
 * @param {string} elementType
 * @returns {number} zone index, or -1 when no zone accepts the type
 */
export function firstZoneForCustomerType(zones, elementType) {
  const list = zones || [];
  for (let i = 0; i < list.length; i++) {
    if (zoneAcceptsCustomerType(list[i], elementType)) return i;
  }
  return -1;
}

/**
 * Index of the first zone that accepts `elementType` AND whose bounding box
 * contains the point — used by the tools the customer places with a click.
 *
 * @param {object[]} zones
 * @param {number} x canvas coordinate
 * @param {number} y canvas coordinate
 * @param {string} elementType
 * @returns {number} zone index, or -1
 */
export function zoneAtPointForCustomerType(zones, x, y, elementType) {
  const list = zones || [];
  for (let i = 0; i < list.length; i++) {
    const z = list[i];
    if (!zoneAcceptsCustomerType(z, elementType)) continue;
    if (x >= z.x && x <= z.x + z.width && y >= z.y && y <= z.y + z.height) return i;
  }
  return -1;
}
