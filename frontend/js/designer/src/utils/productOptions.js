import { optionLabel } from './optionLabel';

// Product options (size, colour, …) the customer has not chosen yet.
//
// A variable product cannot go into the cart until every option is chosen.
// The designer used to save the design and submit the cart form regardless;
// WooCommerce answered "choose product options", the page reloaded, and the
// design the customer had just made was gone. On a phone that was the normal
// path, because the designer opens over the whole page before the options
// are ever seen.

/**
 * @param {HTMLFormElement|null} form  the product's add-to-cart form
 * @returns {string[]} labels of the options still to choose, in page order
 */
export function missingProductOptions(form) {
  if (!form) return [];
  return Array.from(form.querySelectorAll('select[name^="attribute_"]'))
    .filter((select) => !select.value)
    .map((select) => optionLabel(form, select))
    .filter(Boolean);
}

/**
 * Why the chosen combination cannot be ordered, or '' when it can.
 *
 * WooCommerce's own script marks its (hidden) add-to-cart button when the
 * chosen options are out of stock or do not exist as a combination, and puts
 * the reason in the availability line. Reading that BEFORE saving lets the
 * designer say so itself — otherwise the customer saves, the shop refuses,
 * the page reloads, and they are back where they started without having seen
 * why.
 *
 * @param {HTMLFormElement|null} form
 * @returns {string} the shop's own wording when it gives one, '-' when the
 *                   combination is unavailable without a stated reason
 */
export function unavailableReason(form) {
  const button = form?.querySelector('.single_add_to_cart_button');
  if (!button || !button.classList.contains('wc-variation-is-unavailable')) return '';
  const stated = form.querySelector('.woocommerce-variation-availability')?.textContent || '';
  return stated.replace(/\s+/g, ' ').trim() || '-';
}
