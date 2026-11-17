import React from 'react';
import { __ } from '@wordpress/i18n';

export default function SettingsGeneral({ globalConfig, update }) {
  const {
    customization_required = false,
  } = globalConfig;

  return (
    <>
      <h3 className="pf-settings__section-title">{__('General', 'snelgraveren-product-designer')}</h3>
      <p className="pf-settings__section-desc">{__('Global template behavior and product settings.', 'snelgraveren-product-designer')}</p>

      <fieldset className="pf-settings__fieldset">
        <legend>{__('Cart Behavior', 'snelgraveren-product-designer')}</legend>
        <label className="pf-settings__check">
          <input type="checkbox" checked={customization_required}
            onChange={(e) => update('customization_required', e.target.checked)} />
          {__('Require customization before adding to cart', 'snelgraveren-product-designer')}
        </label>
        <p className="pf-settings__note">
          {__('When enabled, customers must save a design before they can add the product to their cart.', 'snelgraveren-product-designer')}
        </p>
      </fieldset>

      <fieldset className="pf-settings__fieldset">
        <legend>{__('Product Color', 'snelgraveren-product-designer')}</legend>
        <label className="pf-settings__check">
          <input type="checkbox" checked={globalConfig.solid_color || false}
            onChange={(e) => update('solid_color', e.target.checked)} />
          {__('Solid color product (all views share the same color)', 'snelgraveren-product-designer')}
        </label>
        <p className="pf-settings__note">
          {__('Enable this for products like dog tags, keychains, etc. where front and back are the same color. Changing the color on one view will update all views.', 'snelgraveren-product-designer')}
        </p>
      </fieldset>
    </>
  );
}
