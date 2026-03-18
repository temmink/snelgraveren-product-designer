import React from 'react';
import useTemplateStore from '../store/useTemplateStore';

export default function PricingPanel() {
  const { globalConfig, setGlobalConfig } = useTemplateStore();
  const currencySymbol = window.pdTemplateBuilder?.currency_symbol || '€';
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
    <div className="pd-pricing">
      <div className="pd-pricing__row">
        <label className="pd-pricing__label">
          Pricing mode
          <select
            value={pricing_mode}
            onChange={(e) => update('pricing_mode', e.target.value)}
            className="pd-pricing__select"
          >
            <option value="per_element">Per element</option>
            <option value="tier">Tier-based</option>
          </select>
        </label>
      </div>

      {pricing_mode === 'per_element' && (
        <fieldset className="pd-pricing__fieldset">
          <legend>Element prices</legend>
          {[
            ['text_price',       'Text'],
            ['image_price',      'Image'],
            ['svg_price',        'SVG'],
            ['extra_layer_price','Extra layer'],
          ].map(([key, label]) => (
            <label key={key} className="pd-pricing__label">
              {label} ({currencySymbol})
              <input
                type="number" step="0.01" min="0"
                value={globalConfig[key] ?? 0}
                onChange={(e) => update(key, parseFloat(e.target.value) || 0)}
                className="pd-pricing__number"
              />
            </label>
          ))}
        </fieldset>
      )}

      {pricing_mode === 'tier' && (
        <fieldset className="pd-pricing__fieldset">
          <legend>Tiers (element count → surcharge)</legend>
          {tiers.map((tier, i) => (
            <div key={i} className="pd-pricing__tier">
              <input type="number" min="0" value={tier.min} onChange={(e) => updateTier(i, 'min', e.target.value)} className="pd-pricing__tier-num" placeholder="Min" />
              –
              <input type="number" min="0" value={tier.max} onChange={(e) => updateTier(i, 'max', e.target.value)} className="pd-pricing__tier-num" placeholder="Max" />
              elements → {currencySymbol}
              <input type="number" min="0" step="0.01" value={tier.surcharge} onChange={(e) => updateTier(i, 'surcharge', e.target.value)} className="pd-pricing__tier-num" />
              <button
                className="pd-pricing__tier-remove"
                onClick={() => update('tiers', tiers.filter((_, j) => j !== i))}
                aria-label="Remove tier"
              >×</button>
            </div>
          ))}
          <button
            className="button button-secondary"
            onClick={() => update('tiers', [...tiers, { min: 0, max: 999, surcharge: 0 }])}
          >
            Add Tier
          </button>
        </fieldset>
      )}

      <fieldset className="pd-pricing__fieldset">
        <legend>Surcharge caps</legend>
        <label className="pd-pricing__label">
          Minimum ({currencySymbol})
          <input type="number" step="0.01" min="0" value={min_surcharge}
            onChange={(e) => update('min_surcharge', parseFloat(e.target.value) || 0)}
            className="pd-pricing__number"
          />
        </label>
        <label className="pd-pricing__label">
          Maximum cap ({currencySymbol}, leave blank for no cap)
          <input type="number" step="0.01" min="0" value={max_surcharge ?? ''}
            onChange={(e) => update('max_surcharge', e.target.value === '' ? null : parseFloat(e.target.value))}
            className="pd-pricing__number"
            placeholder="No cap"
          />
        </label>
      </fieldset>
    </div>
  );
}
