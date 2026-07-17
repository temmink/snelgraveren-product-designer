import { countPriceableElements } from '../../../frontend/js/designer/src/utils/priceCounts';

describe('countPriceableElements', () => {
    it('classifies objects the same way as the server', () => {
        const snapshots = {
            0: { objects: [
                { type: 'IText' }, { type: 'i-text' },
                { type: 'Image' },
                { type: 'Group' },
                { type: 'Path' },
                { type: 'Path', isZoneBoundary: true },
                { type: 'Rect' },
            ] },
            1: { objects: [{ type: 'textbox' }] },
        };
        expect(countPriceableElements(snapshots)).toEqual({ text: 3, image: 1, svg: 2 });
    });

    it('returns zeros for empty snapshots', () => {
        expect(countPriceableElements({})).toEqual({ text: 0, image: 0, svg: 0 });
    });
});
