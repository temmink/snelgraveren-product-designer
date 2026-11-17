import { __, _x, sprintf } from '@wordpress/i18n';

// The name a customer sees for a product view.
//
// A view's name is the merchant's own text and is shown as typed — except for
// the handful of stock names the plugin itself hands out ("Front" from the
// template builder's default view, "Front"/"Back" from the starter
// templates). Those are stored in English, so a Dutch shop showed its
// customers FRONT and BACK. A stock name is translated at display time; the
// stored template is left alone, so it follows the site language either way.
const STOCK_NAMES = {
  front:  () => _x('Front', 'product side', 'snelgraveren-product-designer'),
  back:   () => _x('Back', 'product side', 'snelgraveren-product-designer'),
  left:   () => _x('Left', 'product side', 'snelgraveren-product-designer'),
  right:  () => _x('Right', 'product side', 'snelgraveren-product-designer'),
  top:    () => _x('Top', 'product side', 'snelgraveren-product-designer'),
  bottom: () => _x('Bottom', 'product side', 'snelgraveren-product-designer'),
  inside: () => _x('Inside', 'product side', 'snelgraveren-product-designer'),
};

export function viewLabel(view, index) {
  const name = String(view?.name ?? '').trim();
  if (name === '') {
    /* translators: %d: number of the product view (1, 2, ...) */
    return sprintf(__('View %d', 'snelgraveren-product-designer'), index + 1);
  }
  const stock = STOCK_NAMES[name.toLowerCase()];
  return stock ? stock() : name;
}
