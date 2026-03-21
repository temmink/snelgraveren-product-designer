import React from 'react';
import { __ } from '@wordpress/i18n';

export default function SettingsTools({ globalConfig, update }) {
  return (
    <>
      <h3 className="pf-settings__section-title">{__('Tools', 'productforge')}</h3>
      <p className="pf-settings__section-desc">{__('Configure which tools are available to customers.', 'productforge')}</p>

      <fieldset className="pf-settings__fieldset">
        <legend>{__('Drawing Tool', 'productforge')}</legend>
        <label className="pf-settings__check">
          <input
            type="checkbox"
            checked={globalConfig.drawing_enabled || false}
            onChange={(e) => update('drawing_enabled', e.target.checked)}
          />
          {__('Enable drawing tool', 'productforge')}
        </label>
        {globalConfig.drawing_enabled && (
          <div style={{ paddingLeft: 20, marginTop: 8 }}>
            <label className="pf-settings__field">
              <span>{__('Default stroke width', 'productforge')}</span>
              <input
                type="number"
                min="1"
                max="50"
                value={globalConfig.drawing_default_width || 3}
                onChange={(e) => update('drawing_default_width', parseInt(e.target.value, 10) || 3)}
              />
            </label>
            <label className="pf-settings__field">
              <span>{__('Default stroke color', 'productforge')}</span>
              <input
                type="color"
                value={globalConfig.drawing_default_color || '#000000'}
                onChange={(e) => update('drawing_default_color', e.target.value)}
              />
            </label>
          </div>
        )}
      </fieldset>
    </>
  );
}
