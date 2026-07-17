/**
 * Designs export at 3x the canvas size (App.jsx toDataURL multiplier: 3).
 * If the image's intrinsic pixels are fewer than what the export needs,
 * the engraving/print result will be blurry.
 */
const EXPORT_MULTIPLIER = 3;
const TOLERANCE = 1.1;

export function getImageQuality(img) {
    const natural = img?.width || 0;
    const displayed = typeof img?.getScaledWidth === 'function' ? img.getScaledWidth() : 0;
    if (!natural || !displayed) return 'ok';
    return displayed * EXPORT_MULTIPLIER > natural * TOLERANCE ? 'upscaled' : 'ok';
}
