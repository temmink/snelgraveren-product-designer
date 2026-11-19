/**
 * Draw SVG images WHOLE, never through a source rectangle.
 *
 * Fabric's `FabricImage#_renderFill` always calls the 9-argument
 * `drawImage(el, sx, sy, sw, sh, dx, dy, dw, dh)`, with the source rectangle
 * taken from `el.naturalWidth/naturalHeight`. For an SVG that has a `viewBox`
 * but no `width`/`height` attributes — every file in the Borrelplank clip-art
 * collection, and most SVGs exported by Illustrator/Inkscape "responsive" —
 * the browser has no intrinsic size: Chrome reports `naturalWidth` 150 for a
 * square viewBox, yet resolves the source rectangle against a DIFFERENT default
 * size. The result is a cut-off drawing: the "Season everything with love &
 * laughter" clip art rendered as "Season eve… LOVE & LA" (measured 2026-11-19,
 * tools/clipart-debug). Scaling the object does not help — the crop happens
 * inside the image, at every scale — and the cut-off canvas is what the PNG
 * export, the thumbnail and the cart picture are rendered from.
 *
 * For an SVG source without a crop, the 5-argument `drawImage(el, dx, dy, dw,
 * dh)` draws the complete image into the object's box (the SVG's own
 * preserveAspectRatio keeps the proportions), and it rasterises at the
 * destination resolution, so vector clip art stays sharp in the 3x export too.
 * Raster images, cropped images and filtered images (whose `_element` is a
 * canvas) keep Fabric's own code path untouched.
 *
 * Patches the prototype once per bundle; idempotent.
 */

const SVG_SRC = /^data:image\/svg\+xml|\.svg(?:[?#]|$)/i;

/** Whether a Fabric image's current source is an SVG `<img>`. */
export function isSvgImageElement(el) {
  if (!el || typeof el !== 'object') return false;
  if (typeof HTMLImageElement !== 'undefined' && !(el instanceof HTMLImageElement)) return false;
  const src = el.currentSrc || el.src || '';
  return SVG_SRC.test(src);
}

export function installSvgImageRender(FabricImage) {
  const proto = FabricImage && FabricImage.prototype;
  if (!proto || proto.__sgpdSvgRender) return;
  const original = proto._renderFill;
  proto._renderFill = function sgpdRenderFill(ctx) {
    const el = this._element;
    if (isSvgImageElement(el) && !(this.cropX > 0) && !(this.cropY > 0)) {
      const w = this.width;
      const h = this.height;
      if (w > 0 && h > 0) ctx.drawImage(el, -w / 2, -h / 2, w, h);
      return;
    }
    return original.call(this, ctx);
  };
  proto.__sgpdSvgRender = true;
}
