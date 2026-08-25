import { __ } from '@wordpress/i18n';

/**
 * The container zone a LightBurn import creates for its artwork.
 *
 * WHY THIS IS NOT A CUSTOMER DROP TARGET
 *
 * The import needs somewhere to put the layers it parsed, so when the view has
 * no zone yet it creates one the size of the whole canvas. That zone exists to
 * HOLD the imported artwork — it is not a place customers may add things.
 *
 * It used to be created with `allowed_types: ['text', 'image', 'svg']`, and
 * because it is zone 0 it then won every customer zone selection
 * (shared/js/zoneSelection.js walks the list in order). Reported from the live
 * shop, template 22:
 *
 *   #0  Imported       restrict  rect  0,0 600x289 (the WHOLE canvas)  text,image,svg
 *   #1  GraveerGebied  clip      svg   45,45 379x197                   text,image,svg
 *
 * A customer adding clip art bound it to zone 0, so it was clamped to the
 * canvas rather than to the engraving boundary and landed straddling the
 * plank's outline. The merchant's fix was to untick the three types by hand on
 * every import; the import now simply never claims them.
 *
 * The zone stays `restrict` so the imported artwork itself is still held to
 * the canvas in the builder. Only the customer-facing claim is dropped.
 *
 * Existing templates are NOT migrated: a template imported before this change
 * still carries the claiming zone and still needs the merchant to untick the
 * three types once, in the zone's settings.
 *
 * @param {object} opts
 * @param {number} opts.width  canvas width in px
 * @param {number} opts.height canvas height in px
 * @returns {object} a zone descriptor for useTemplateStore#addZone
 */
export function importedContainerZone({ width, height }) {
  return {
    name: __( 'Imported', 'snelgraveren-product-designer' ),
    type: 'safe_area',
    behavior: 'restrict',
    boundary_type: 'rect',
    x: 0,
    y: 0,
    width,
    height,
    // Deliberately empty — see the docblock. The merchant adds a real design
    // zone (with a boundary) for the customer to work in.
    allowed_types: [],
  };
}
