import { getImageQuality } from '../../../frontend/js/designer/src/utils/imageQuality';

const fakeImg = (naturalWidth, scaledWidth) => ({
    width: naturalWidth,
    getScaledWidth: () => scaledWidth,
});

describe('getImageQuality', () => {
    it('flags images whose 3x export exceeds source pixels', () => {
        // 300px source shown at 200px → export 600px → upscaled
        expect(getImageQuality(fakeImg(300, 200))).toBe('upscaled');
    });
    it('accepts images with enough source pixels', () => {
        // 1500px source shown at 200px → export 600px → fine
        expect(getImageQuality(fakeImg(1500, 200))).toBe('ok');
    });
    it('is ok for missing dimensions', () => {
        expect(getImageQuality(fakeImg(0, 200))).toBe('ok');
    });
    it('is ok when getScaledWidth is missing', () => {
        expect(getImageQuality({ width: 500 })).toBe('ok');
    });
});
