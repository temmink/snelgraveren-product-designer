// The name of a product option as the customer knows it ("Kleur").
//
// Read from the <label> on the product page — but only its OWN text. Themes
// (Astra here) put the chosen value inside the label too, in a child element,
// so the label's full text reads "Kleur" + "Groen" = "KleurGroen".

const ownText = (el) => Array.from(el?.childNodes || [])
  .filter((n) => n.nodeType === 3)
  .map((n) => n.textContent)
  .join(' ')
  .replace(/\s+/g, ' ')
  .replace(/[:：]\s*$/, '')
  .trim();

export function optionLabel(form, select) {
  const label = select.id ? form.querySelector(`label[for="${select.id}"]`) : null;
  const text = ownText(label) || (label?.textContent || '').replace(/\s+/g, ' ').trim();
  if (text) return text;
  // attribute_pa_kleur → kleur
  return (select.name || '').replace(/^attribute_(pa_)?/, '').replace(/[-_]+/g, ' ').trim();
}
