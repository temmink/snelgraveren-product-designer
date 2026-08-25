import { countPriceableElements } from '../../../frontend/js/designer/src/utils/priceCounts';

describe('countPriceableElements', () => {
    it('classifies objects the same way as the server', () => {
        const snapshots = {
            0: { objects: [
                { type: 'IText', text: 'a' }, { type: 'i-text', text: 'b' },
                { type: 'Image' },
                { type: 'Group' },
                { type: 'Path' },
                { type: 'Path', isZoneBoundary: true },
                { type: 'Rect' },
            ] },
            1: { objects: [{ type: 'textbox', text: 'c' }] },
        };
        expect(countPriceableElements(snapshots)).toEqual({ text: 3, image: 1, svg: 2 });
    });

    it('returns zeros for empty snapshots', () => {
        expect(countPriceableElements({})).toEqual({ text: 0, image: 0, svg: 0 });
    });

    it('skips zone overlays (template chrome is never billable)', () => {
        const snapshots = {
            0: { objects: [
                { type: 'Group', data: { zoneIndex: 0, isZoneOverlay: true } },
                { type: 'Group' },
                { type: 'IText', text: 'a', data: { elementType: 'text', zoneIndex: 0 } },
            ] },
        };
        expect(countPriceableElements(snapshots)).toEqual({ text: 1, image: 0, svg: 1 });
    });

    it('does not bill an empty text layer', () => {
        // A template may author an empty "Your name here" layer for the
        // customer to fill in, and shared/js/textPlaceholder keeps a text the
        // customer has cleared on the canvas. Neither is a paid element.
        const counts = countPriceableElements({
            0: {
                objects: [
                    { type: 'IText', text: '' },
                    { type: 'IText', text: '   ' },
                    { type: 'IText' },
                    { type: 'IText', text: 'Martin' },
                ],
            },
        });
        expect(counts.text).toBe(1);
    });

    it('does not bill template background art', () => {
        const counts = countPriceableElements({
            0: {
                objects: [
                    { type: 'Image', data: { templateArt: true } },   // the bitmap background
                    { type: 'Image' },                                 // a customer upload
                    { type: 'IText', text: 'a' },
                ],
            },
        });
        expect(counts.image).toBe(1);
        expect(counts.text).toBe(1);
    });
});
