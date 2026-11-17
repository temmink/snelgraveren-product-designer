import React, { useEffect, useRef, useState } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import useDesignerStore from '../store/useDesignerStore';
import { getDesignerConfig } from '../utils/config';
import {
  readVariantForm, optionAvailability, chosenColor, chooseOption,
} from '../utils/productVariants';
import { paintCanvasProductColor, paintOtherViewSnapshots } from '../utils/productColor';

const getForm = () => document.querySelector('form.cart');

const sameState = (a, b) => JSON.stringify(a.attributes) === JSON.stringify(b.attributes)
  && (a.variations?.length || 0) === (b.variations?.length || 0);

/**
 * The product's options (size, colour, …), chosen inside the designer.
 *
 * These are WooCommerce's own options, not a second set: a choice made here
 * is written to the form on the product page, and a choice made there shows
 * up here. Before this the designer had its own colour swatches that had
 * nothing to do with the order — a customer could design on a red tag and
 * order a black one — and on a phone the options were hidden behind the
 * designer until the order button refused to work.
 *
 * Renders nothing for a product without options.
 */
export default function ProductOptions() {
  const { fabricCanvasRef, currentViewIndex, snapshotView } = useDesignerStore();
  const colorNames = getDesignerConfig().color_names || {};
  const [state, setState] = useState(() => readVariantForm(getForm()));
  const [note, setNote] = useState('');
  const stateRef = useRef(state);
  stateRef.current = state;

  // Keep in step with the page's form. A native listener is not enough:
  // WooCommerce changes its selects through jQuery (.val().trigger('change') —
  // its "clear" link, default selections, pruning options that do not
  // combine), and jQuery-triggered events never reach native listeners. So:
  // listen for what can be heard, and re-read on a slow tick for the rest.
  useEffect(() => {
    const form = getForm();
    if (!form) return undefined;
    const read = () => {
      const next = readVariantForm(form, stateRef.current);
      if (!sameState(next, stateRef.current)) setState(next);
    };
    read();
    form.addEventListener('change', read);
    const tick = setInterval(read, 700);
    return () => {
      form.removeEventListener('change', read);
      clearInterval(tick);
    };
  }, []);

  // The product is shown in the colour that was chosen. Re-applied when the
  // view changes and whenever a zone shape lands on the canvas (they load
  // asynchronously, after this effect has already run once).
  const tint = chosenColor(state, colorNames);
  useEffect(() => {
    const canvas = fabricCanvasRef;
    if (!canvas || !tint) return undefined;
    const paint = () => {
      if (!paintCanvasProductColor(canvas, tint, { editableOnly: true })) return;
      useDesignerStore.getState().setSolidFillColor(tint);
      snapshotView(currentViewIndex, canvas.toObject(['data']));
      paintOtherViewSnapshots(tint, currentViewIndex, { editableOnly: true });
    };
    const onAdded = (e) => { if (e.target?.data?.isZoneOverlay) paint(); };
    paint();
    canvas.on('object:added', onAdded);
    return () => canvas.off('object:added', onAdded);
  }, [tint, fabricCanvasRef, currentViewIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.attributes.length === 0) return null;

  const choose = (attribute, value) => {
    const form = getForm();
    if (!form) return;
    setNote('');
    if (!chooseOption(form, attribute.name, value)) {
      // WooCommerce dropped this value from its list because of the other
      // selections. The customer asked for it, so it wins: clear the others.
      state.attributes.filter((a) => a.name !== attribute.name)
        .forEach((a) => chooseOption(form, a.name, ''));
      chooseOption(form, attribute.name, value);
    }

    // A choice that makes another one undeliverable (this colour is sold out
    // in that size) clears the other one, with the reason — rather than
    // letting it stand until the order button refuses.
    let next = readVariantForm(form, stateRef.current);
    const cleared = [];
    next.attributes.filter((a) => a.name !== attribute.name && a.value !== '').forEach((other) => {
      if (optionAvailability(next, other.name)[other.value] === false) {
        const label = other.options.find((o) => o.value === other.value)?.label || other.value;
        cleared.push(label);
        chooseOption(form, other.name, '');
      }
    });
    if (cleared.length > 0) {
      next = readVariantForm(form, next);
      const chosenLabel = attribute.options.find((o) => o.value === value)?.label || value;
      setNote(sprintf(
        /* translators: 1: the options that were cleared, e.g. "Pink"; 2: the option just chosen, e.g. "51 mm" */
        __('%1$s is sold out in %2$s — please choose again.', 'snelgraveren-product-designer'),
        cleared.join(', '),
        chosenLabel,
      ));
    }
    setState(next);
  };

  return (
    <div className="pf-options">
      <div className="pf-options__fields">
        {state.attributes.map((attribute) => {
          const available = optionAvailability(state, attribute.name);
          return (
            <label key={attribute.name} className="pf-options__field">
              <span>{attribute.label}</span>
              <select
                value={attribute.value}
                className={attribute.value === '' ? 'pf-options__select pf-options__select--empty' : 'pf-options__select'}
                onChange={(e) => choose(attribute, e.target.value)}
              >
                <option value="">{__('Choose…', 'snelgraveren-product-designer')}</option>
                {attribute.options.map((option) => (
                  <option key={option.value} value={option.value} disabled={available[option.value] === false}>
                    {available[option.value] === false
                      /* translators: %s: a product option, e.g. "Pink" */
                      ? sprintf(__('%s (sold out)', 'snelgraveren-product-designer'), option.label)
                      : option.label}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      {note && <p className="pf-options__note" role="status">{note}</p>}
    </div>
  );
}
