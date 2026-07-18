import React from 'react';
import { __ } from '@wordpress/i18n';

const ALL_FILTERS = ['Brightness', 'Contrast', 'Saturation', 'Grayscale', 'Sepia', 'Blur', 'Invert', 'Vintage', 'Noise', 'Pixelate', 'HueRotation', 'Vibrance', 'BlackWhite', 'Brownie', 'Kodachrome', 'Technicolor', 'Polaroid'];
const DEFAULT_FILTERS = ['Brightness', 'Contrast', 'Saturation', 'Grayscale', 'Sepia'];

export default function SettingsTools({ globalConfig, update }) {
  return (
    <>
      <h3 className="pf-settings__section-title">{__('Tools', 'snelgraveren-product-designer')}</h3>
      <p className="pf-settings__section-desc">{__('Configure which tools are available to customers.', 'snelgraveren-product-designer')}</p>

      <fieldset className="pf-settings__fieldset">
        <legend>{__('Drawing Tool', 'snelgraveren-product-designer')}</legend>
        <label className="pf-settings__check">
          <input
            type="checkbox"
            checked={globalConfig.drawing_enabled || false}
            onChange={(e) => update('drawing_enabled', e.target.checked)}
          />
          {__('Enable drawing tool', 'snelgraveren-product-designer')}
        </label>
        {globalConfig.drawing_enabled && (
          <div style={{ paddingLeft: 20, marginTop: 8 }}>
            <label className="pf-settings__field">
              <span>{__('Default stroke width', 'snelgraveren-product-designer')}</span>
              <input
                type="number"
                min="1"
                max="50"
                value={globalConfig.drawing_default_width || 3}
                onChange={(e) => update('drawing_default_width', parseInt(e.target.value, 10) || 3)}
              />
            </label>
            <label className="pf-settings__field">
              <span>{__('Default stroke color', 'snelgraveren-product-designer')}</span>
              <input
                type="color"
                value={globalConfig.drawing_default_color || '#000000'}
                onChange={(e) => update('drawing_default_color', e.target.value)}
              />
            </label>
          </div>
        )}
      </fieldset>

      <fieldset className="pf-settings__fieldset">
        <legend>{__('Image Filters', 'snelgraveren-product-designer')}</legend>
        <label className="pf-settings__check">
          <input
            type="checkbox"
            checked={globalConfig.filters_enabled || false}
            onChange={(e) => update('filters_enabled', e.target.checked)}
          />
          {__('Enable image filters', 'snelgraveren-product-designer')}
        </label>
        {globalConfig.filters_enabled && (
          <div style={{ paddingLeft: 20, marginTop: 8 }}>
            <div className="pf-settings__filter-label">{__('Available filters:', 'snelgraveren-product-designer')}</div>
            <div className="pf-settings__filter-pills">
              {ALL_FILTERS.map((f) => {
                const allowed = globalConfig.allowed_filters || DEFAULT_FILTERS;
                const checked = allowed.includes(f);
                return (
                  <label key={f} className="pf-settings__filter-pill">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...allowed, f]
                          : allowed.filter((x) => x !== f);
                        update('allowed_filters', next);
                      }}
                    />
                    {f}
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </fieldset>
      <fieldset className="pf-settings__fieldset">
        <legend>{__('Curved Text', 'snelgraveren-product-designer')}</legend>
        <label className="pf-settings__check">
          <input
            type="checkbox"
            checked={globalConfig.curved_text_enabled || false}
            onChange={(e) => update('curved_text_enabled', e.target.checked)}
          />
          {__('Enable curved text tool', 'snelgraveren-product-designer')}
        </label>
      </fieldset>
    </>
  );
}
