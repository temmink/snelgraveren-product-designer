/**
 * Designs export at 3x the canvas size (App.jsx toDataURL multiplier: 3).
 * If the image's intrinsic pixels are fewer than what the export needs,
 * the engraving/print result will be blurry.
 */
import { isSvgImageElement } from '../../../../../shared/js/svgImageRender';

const EXPORT_MULTIPLIER = 3;
const TOLERANCE = 1.1;

export function getImageQuality(img) {
    // A vector source is drawn at the destination resolution
    // (shared/js/svgImageRender.js), so it never runs out of pixels: clip art
    // showed "this image is scaled beyond its resolution" at 101%. A filtered
    // SVG (recolour tint) renders from a raster canvas and IS checked below.
    if (isSvgImageElement(img?._element)) return 'ok';
    const natural = img?.width || 0;
    const displayed = typeof img?.getScaledWidth === 'function' ? img.getScaledWidth() : 0;
    if (!natural || !displayed) return 'ok';
    return displayed * EXPORT_MULTIPLIER > natural * TOLERANCE ? 'upscaled' : 'ok';
}
