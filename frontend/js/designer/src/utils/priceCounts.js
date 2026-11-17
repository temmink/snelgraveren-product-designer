/**
 * Count priceable elements across all view snapshots. The classification
 * mirrors PHP PriceCalculator::classify_object() — the server recalculates
 * authoritatively in the cart; this only feeds the live preview.
 */
const TEXT_TYPES = new Set(['itext', 'textbox', 'text']);

/** Whitespace-only counts as empty: it engraves nothing either. */
function isEmptyText(obj) {
    return String(obj.text ?? '').trim() === '';
}

export function countPriceableElements(snapshots) {
    const counts = { text: 0, image: 0, svg: 0 };
    for (const json of Object.values(snapshots || {})) {
        for (const obj of json?.objects || []) {
            // Mirrors PriceCalculator::classify_object(): zone overlays are
            // template chrome, never billable.
            if (obj.data?.isZoneOverlay) continue;
            // Template-supplied background art (e.g. an imported LightBurn
            // bitmap) is not something the customer added — never billable.
            if (obj.data?.templateArt) continue;
            const type = String(obj.type || '').toLowerCase().replace(/-/g, '');
            // An EMPTY text object is not a paid element. Two ways one exists:
            // a template layer the merchant authored empty for the customer to
            // fill in (seeded unconditionally since 9f76d90), and a text the
            // customer cleared — shared/js/textPlaceholder keeps that object on
            // the canvas instead of deleting it. Nothing is engraved either
            // way, so nothing is charged.
            if (TEXT_TYPES.has(type) && isEmptyText(obj)) continue;
            if (TEXT_TYPES.has(type)) counts.text += 1;
            else if (type === 'image') counts.image += 1;
            else if (type === 'group') counts.svg += 1;
            else if (type === 'path' && !obj.isZoneBoundary) counts.svg += 1;
        }
    }
    return counts;
}
