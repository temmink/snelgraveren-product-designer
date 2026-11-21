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

/**
 * The zone type ('text' | 'image' | 'svg') a customer-side element counts as,
 * from its `data.elementType`. Curved and engraving text are text to a zone.
 *
 * @param {string} elementType
 * @returns {string|null} null for anything a zone does not list (a drawing)
 */
export function zoneTypeOfElement(elementType) {
  if (elementType === 'image' || elementType === 'svg') return elementType;
  if (elementType === 'text' || elementType === 'curved-text' || elementType === 'engraving-text') return 'text';
  return null;
}

/**
 * Which zone GOVERNS an element the customer can move — as opposed to which
 * zone merely HOLDS it in the template.
 *
 * WHY THESE ARE TWO DIFFERENT THINGS
 *
 * A template layer is stored inside a zone, and the designer used to treat
 * that zone as the one that constrains it. For a LightBurn import that is the
 * wrong zone: every imported layer — the editable texts included — lands in
 * the canvas-sized `Imported` container (admin/.../utils/importedZone.js),
 * and the merchant then draws the real engraving boundary as a SECOND zone,
 * which holds no layers at all. Measured on the slate template (28):
 *
 *   #0  Imported             restrict  rect  0,0 600x600   []               3 texts
 *   #1  VeiligGraveerGebied  restrict  svg   62,60 480x480 text,image,svg   —
 *
 * The example text "Naam 1 - Naam 2" could be dragged to (0,0), outside the
 * engraving boundary, because zone 0 — the whole canvas — was its zone. A text
 * the customer ADDED on the same template went to zone 1 and was held inside.
 * Same product, same kind of element, two different boundaries.
 *
 * THE RULE
 *
 * A zone that does not offer itself to the customer for this type
 * (`zoneAcceptsCustomerType`) is a container, not a boundary: it says nothing
 * about where the customer may put the element. Such an element is governed
 * by the zone a NEW element of that type would get — the first one that does
 * accept it. When the holding zone accepts the type itself it keeps governing
 * (a template with two real design areas must not have its layers pulled from
 * one into the other), and when no zone accepts the type nothing changes.
 *
 * Resolved when the zone is ASKED FOR, never written back: the stored
 * template, the object's `data.zoneIndex` and saved designs stay as they are,
 * so a template the merchant reorders or re-ticks is picked up at once and
 * designs saved before this rule existed are covered too.
 *
 * Only for elements the customer can move. Locked template art stays with the
 * zone that holds it.
 *
 * @param {object[]} zones
 * @param {number|null|undefined} zoneIndex the zone holding the element
 * @param {string} elementType `data.elementType` of the element
 * @returns {number|null|undefined} the governing zone index; `zoneIndex`
 *   itself when nothing better applies
 */
export function governingZoneIndex(zones, zoneIndex, elementType) {
  const list = zones || [];
  const type = zoneTypeOfElement(elementType);
  if (!type) return zoneIndex;
  const holding = zoneIndex != null && zoneIndex >= 0 ? list[zoneIndex] : null;
  if (holding && zoneAcceptsCustomerType(holding, type)) return zoneIndex;
  const first = firstZoneForCustomerType(list, type);
  return first >= 0 ? first : zoneIndex;
}
