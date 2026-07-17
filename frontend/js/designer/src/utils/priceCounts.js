/**
 * Count priceable elements across all view snapshots. The classification
 * mirrors PHP PriceCalculator::classify_object() — the server recalculates
 * authoritatively in the cart; this only feeds the live preview.
 */
const TEXT_TYPES = new Set(['itext', 'textbox', 'text']);

export function countPriceableElements(snapshots) {
    const counts = { text: 0, image: 0, svg: 0 };
    for (const json of Object.values(snapshots || {})) {
        for (const obj of json?.objects || []) {
            // Mirrors PriceCalculator::classify_object(): zone overlays are
            // template chrome, never billable.
            if (obj.data?.isZoneOverlay) continue;
            const type = String(obj.type || '').toLowerCase().replace(/-/g, '');
            if (TEXT_TYPES.has(type)) counts.text += 1;
            else if (type === 'image') counts.image += 1;
            else if (type === 'group') counts.svg += 1;
            else if (type === 'path' && !obj.isZoneBoundary) counts.svg += 1;
        }
    }
    return counts;
}
