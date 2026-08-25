import {
  zoneAcceptsCustomerType,
  firstZoneForCustomerType,
  zoneAtPointForCustomerType,
} from '../../../shared/js/zoneSelection';
import { importedContainerZone } from '../../../admin/js/template-builder/src/utils/importedZone';

/**
 * The user-facing requirement, reported from the live shop with a screenshot:
 *
 *   A customer adding clip art to an acacia plank must get it inside the
 *   merchant's engraving boundary — not straddling it.
 *
 * The template it was reported on (template 22) has two zones, in this order:
 *
 *   #0  Imported       restrict  rect  0,0 600x289 (the WHOLE canvas)
 *   #1  GraveerGebied  clip      svg   45,45 379x197
 *
 * Zone 0 is the container the LightBurn import creates to hold the imported
 * artwork. It used to advertise allowed_types ['text','image','svg'], so being
 * first it won every selection and every customer element was bound to the
 * whole canvas instead of the engraving boundary.
 *
 * These tests therefore compose the REAL import zone factory with the REAL
 * selection rule: nothing here restates either one's contents, so re-adding the
 * claim in either place fails them.
 */

// Zone #1 exactly as it stands in the reported template.
const MERCHANT_BOUNDARY = {
  name: 'GraveerGebied',
  behavior: 'clip',
  boundary_type: 'svg',
  svg_markup: '<svg><path d="M0 0"/></svg>',
  x: 45,
  y: 45,
  width: 379,
  height: 197,
  allowed_types: ['text', 'image', 'svg'],
};

describe('the reported template: clip art must land in the merchant boundary', () => {
  const zones = [
    importedContainerZone({ width: 600, height: 289 }),
    MERCHANT_BOUNDARY,
  ];

  it.each(['svg', 'image', 'text'])(
    'a new %s element binds to the engraving boundary, not to the imported container',
    (elementType) => {
      expect(firstZoneForCustomerType(zones, elementType)).toBe(1);
    }
  );

  it('the imported container is not a drop target for any customer type', () => {
    const imported = zones[0];
    expect(zoneAcceptsCustomerType(imported, 'svg')).toBe(false);
    expect(zoneAcceptsCustomerType(imported, 'image')).toBe(false);
    expect(zoneAcceptsCustomerType(imported, 'text')).toBe(false);
  });

  it('a click inside the engraving boundary places the element there', () => {
    expect(zoneAtPointForCustomerType(zones, 200, 100, 'text')).toBe(1);
  });

  it('a click on the plank but outside the engraving boundary belongs to no zone', () => {
    // Bottom-left corner: inside the imported container, outside the boundary.
    expect(zoneAtPointForCustomerType(zones, 10, 270, 'text')).toBe(-1);
  });

  it('the imported container still restricts the artwork it holds', () => {
    // Part 1 drops the CUSTOMER claim only — the zone must keep enforcing its
    // boundary, or the merchant's imported layers stop being clamped at all.
    expect(zones[0].behavior).toBe('restrict');
    expect(zones[0].width).toBe(600);
    expect(zones[0].height).toBe(289);
  });
});

describe('a zone only offers itself when it actually enforces a boundary', () => {
  const base = { x: 0, y: 0, width: 100, height: 100, allowed_types: ['text'] };

  it('accepts the type in a restrict zone', () => {
    expect(zoneAcceptsCustomerType({ ...base, behavior: 'restrict' }, 'text')).toBe(true);
  });

  it('accepts the type in a clip zone', () => {
    expect(zoneAcceptsCustomerType({ ...base, behavior: 'clip' }, 'text')).toBe(true);
  });

  it('refuses a zone whose behavior enforces nothing', () => {
    expect(zoneAcceptsCustomerType({ ...base, behavior: 'none' }, 'text')).toBe(false);
    expect(zoneAcceptsCustomerType({ ...base }, 'text')).toBe(false);
  });

  it('refuses a type the zone does not list', () => {
    expect(zoneAcceptsCustomerType({ ...base, behavior: 'restrict' }, 'image')).toBe(false);
  });

  it('treats a zone with no allowed_types at all as claiming nothing', () => {
    const zone = { behavior: 'restrict', x: 0, y: 0, width: 10, height: 10 };
    expect(zoneAcceptsCustomerType(zone, 'text')).toBe(false);
  });

  it('reports -1 when no zone accepts the type, and for an empty template', () => {
    expect(firstZoneForCustomerType([{ ...base, behavior: 'restrict' }], 'svg')).toBe(-1);
    expect(firstZoneForCustomerType([], 'text')).toBe(-1);
    expect(firstZoneForCustomerType(undefined, 'text')).toBe(-1);
    expect(zoneAtPointForCustomerType(undefined, 5, 5, 'text')).toBe(-1);
  });

  it('picks the first accepting zone when several accept', () => {
    const a = { ...base, behavior: 'restrict', name: 'a' };
    const b = { ...base, behavior: 'restrict', name: 'b' };
    expect(firstZoneForCustomerType([a, b], 'text')).toBe(0);
  });

  it('skips an earlier non-accepting zone rather than stopping at it', () => {
    const blocked = { ...base, behavior: 'restrict', allowed_types: [] };
    const open = { ...base, behavior: 'restrict' };
    expect(firstZoneForCustomerType([blocked, open], 'text')).toBe(1);
  });
});
