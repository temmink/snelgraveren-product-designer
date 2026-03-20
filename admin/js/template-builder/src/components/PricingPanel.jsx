import React from 'react';
import { __ } from '@wordpress/i18n';
import useTemplateStore from '../store/useTemplateStore';

export default function PricingPanel() {
  const { globalConfig, setGlobalConfig } = useTemplateStore();
  const currencySymbol = window.pfTemplateBuilder?.currency_symbol || '€';
  const {
    pricing_mode    = 'per_element',
    tiers           = [],
    min_surcharge   = 0,
    max_surcharge   = '',
  } = globalConfig;

  const update = (key, value) => setGlobalConfig({ [key]: value });

  const updateTier = (i, key, value) => {
    const next = [...tiers];
    next[i] = { ...next[i], [key]: Number(value) };
    update('tiers', next);
  };

  return (
    <div className="pf-pricing">
      <div className="pf-pricing__row">
        <label className="pf-pricing__label">
          { __( 'Pricing mode', 'productforge' ) }
          <select
            value={pricing_mode}
            onChange={(e) => update('pricing_mode', e.target.value)}
            className="pf-pricing__select"
          >
            <option value="per_element">{ __( 'Per element', 'productforge' ) }</option>
            <option value="tier">{ __( 'Tier-based', 'productforge' ) }</option>
          </select>
        </label>
      </div>

      {pricing_mode === 'per_element' && (
        <fieldset className="pf-pricing__fieldset">
          <legend>{ __( 'Element prices', 'productforge' ) }</legend>
          {[
            ['text_price',       __( 'Text', 'productforge' )],
            ['image_price',      __( 'Image', 'productforge' )],
            ['svg_price',        __( 'SVG', 'productforge' )],
            ['extra_layer_price', __( 'Extra layer', 'productforge' )],
          ].map(([key, label]) => (
            <label key={key} className="pf-pricing__label">
              {label} ({currencySymbol})
              <input
                type="number" step="0.01" min="0"
                value={globalConfig[key] ?? 0}
                onChange={(e) => update(key, parseFloat(e.target.value) || 0)}
                className="pf-pricing__number"
              />
            </label>
          ))}
        </fieldset>
      )}

      {pricing_mode === 'tier' && (
        <fieldset className="pf-pricing__fieldset">
          <legend>{ __( 'Tiers (element count → surcharge)', 'productforge' ) }</legend>
          {tiers.map((tier, i) => (
            <div key={i} className="pf-pricing__tier">
              <input type="number" min="0" value={tier.min} onChange={(e) => updateTier(i, 'min', e.target.value)} className="pf-pricing__tier-num" placeholder={ __( 'Min', 'productforge' ) } />
              –
              <input type="number" min="0" value={tier.max} onChange={(e) => updateTier(i, 'max', e.target.value)} className="pf-pricing__tier-num" placeholder={ __( 'Max', 'productforge' ) } />
              elements → {currencySymbol}
              <input type="number" min="0" step="0.01" value={tier.surcharge} onChange={(e) => updateTier(i, 'surcharge', e.target.value)} className="pf-pricing__tier-num" />
              <button
                className="pf-pricing__tier-remove"
                onClick={() => update('tiers', tiers.filter((_, j) => j !== i))}
                aria-label={__('Remove tier', 'productforge')}
              >×</button>
            </div>
          ))}
          <button
            className="button button-secondary"
            onClick={() => update('tiers', [...tiers, { min: 0, max: 999, surcharge: 0 }])}
          >
            { __( 'Add Tier', 'productforge' ) }
          </button>
        </fieldset>
      )}

      <fieldset className="pf-pricing__fieldset">
        <legend>{ __( 'Surcharge caps', 'productforge' ) }</legend>
        <label className="pf-pricing__label">
          { `${ __( 'Minimum', 'productforge' ) } (${currencySymbol})` }
          <input type="number" step="0.01" min="0" value={min_surcharge}
            onChange={(e) => update('min_surcharge', parseFloat(e.target.value) || 0)}
            className="pf-pricing__number"
          />
        </label>
        <label className="pf-pricing__label">
          { `${ __( 'Maximum cap', 'productforge' ) } (${currencySymbol}, ${ __( 'leave blank for no cap', 'productforge' ) })` }
          <input type="number" step="0.01" min="0" value={max_surcharge ?? ''}
            onChange={(e) => update('max_surcharge', e.target.value === '' ? null : parseFloat(e.target.value))}
            className="pf-pricing__number"
            placeholder={ __( 'No cap', 'productforge' ) }
          />
        </label>
      </fieldset>
    </div>
  );
}
