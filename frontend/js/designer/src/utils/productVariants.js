import { optionLabel } from './optionLabel';

// The product's own options (size, colour, …) as the designer sees them.
//
// There is ONE place where an option is chosen: WooCommerce's form on the
// product page. The designer shows the same choices and writes through to
// that form, so what the customer sees in the designer is what gets ordered.
// Nothing here stores a choice of its own.

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Read the options and the variations WooCommerce printed with the form.
 *
 * `known` is the previous read: WooCommerce removes choices from a <select>
 * that do not combine with the other selections, so a single read can be
 * missing options. The designer wants to keep showing them (marked
 * unavailable), which means remembering every option it has ever seen.
 *
 * @returns {{attributes: Array<{name,label,value,options:Array<{value,label}>}>, variations: Array|null}}
 */
export function readVariantForm(form, known = null) {
  if (!form) return { attributes: [], variations: null };

  let variations = null;
  try {
    const raw = form.dataset?.product_variations;
    const parsed = raw && raw !== 'false' ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) variations = parsed;
  } catch (_) { /* printed by WooCommerce; unreadable means "unknown" */ }

  const attributes = Array.from(form.querySelectorAll('select[name^="attribute_"]')).map((select) => {
    const seen = new Map();
    (known?.attributes.find((a) => a.name === select.name)?.options || [])
      .forEach((o) => seen.set(o.value, o));
    Array.from(select.options).forEach((o) => {
      if (o.value !== '') seen.set(o.value, { value: o.value, label: (o.textContent || o.value).trim() });
    });
    return {
      name: select.name,
      label: optionLabel(form, select),
      value: select.value || '',
      options: Array.from(seen.values()),
    };
  });

  return { attributes, variations };
}

const orderable = (v) => v.is_in_stock !== false && v.is_purchasable !== false
  && v.variation_is_active !== false;

// A variation matches a choice when it names that value or leaves the
// attribute open ("any size").
const matches = (variation, name, value) => {
  const own = variation.attributes?.[name];
  return own === '' || own === undefined || own === null || own === value;
};

/**
 * For one attribute: which of its options can still be ordered together with
 * what is chosen for the OTHER attributes.
 *
 * @returns {Object<string, boolean>} option value → orderable. Every option
 *          is true when WooCommerce did not print the variations (it then
 *          asks the server per choice, and the designer cannot know).
 */
export function optionAvailability({ attributes, variations }, attributeName) {
  const attribute = attributes.find((a) => a.name === attributeName);
  if (!attribute) return {};
  const others = attributes.filter((a) => a.name !== attributeName && a.value !== '');
  return Object.fromEntries(attribute.options.map((option) => {
    if (!variations) return [option.value, true];
    const ok = variations.some((v) => orderable(v)
      && matches(v, attributeName, option.value)
      && others.every((a) => matches(v, a.name, a.value)));
    return [option.value, ok];
  }));
}

/**
 * The tint for the colour the customer chose, or null.
 *
 * No attribute is configured as "the colour": the first chosen option whose
 * name (or value) is in the shop's colour-name list is one.
 */
export function chosenColor({ attributes }, colorNames = {}) {
  for (const attribute of attributes) {
    if (attribute.value === '') continue;
    const option = attribute.options.find((o) => o.value === attribute.value);
    const hex = colorNames[norm(option?.label)] || colorNames[norm(attribute.value)];
    if (hex) return hex;
  }
  return null;
}

/** Whether any option of this product is a colour the shop has a tint for. */
export function hasColorOption({ attributes }, colorNames = {}) {
  return attributes.some((a) => a.options.some(
    (o) => colorNames[norm(o.label)] || colorNames[norm(o.value)],
  ));
}

/**
 * Choose an option in WooCommerce's form.
 *
 * A real `change` event, bubbling: WooCommerce listens through jQuery, and
 * jQuery handlers do run for native events. (The reverse is not true — see
 * the component's sync.)
 */
export function chooseOption(form, attributeName, value) {
  const select = Array.from(form?.querySelectorAll('select[name^="attribute_"]') || [])
    .find((s) => s.name === attributeName);
  if (!select) return false;
  if (value !== '' && !Array.from(select.options).some((o) => o.value === value)) {
    // WooCommerce pruned it from the list because of the other selections.
    return false;
  }
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
