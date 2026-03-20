import React, { useState } from 'react';
import { __ } from '@wordpress/i18n';
import useTemplateStore from '../store/useTemplateStore';
import { AVAILABLE_FONTS } from '../utils/fonts';

const IMAGE_TYPES = ['jpg', 'png', 'svg', 'webp'];

export default function GlobalSettings() {
  const { globalConfig, setGlobalConfig } = useTemplateStore();
  const {
    customization_required = false,
    colors_enabled    = false,
    any_color         = false,
    allowed_colors    = [],
    fonts_enabled     = false,
    max_file_size_mb  = 10,
    min_width         = 0,
    min_height        = 0,
    min_dpi           = 0,
    allowed_image_types = ['jpg', 'png', 'svg', 'webp'],
  } = globalConfig;

  const update = (key, value) => setGlobalConfig({ [key]: value });
  const [pendingColor, setPendingColor] = useState('#000000');

  const addColor = (hex) => {
    if (hex && !allowed_colors.includes(hex)) {
      update('allowed_colors', [...allowed_colors, hex]);
    }
  };

  const toggleImageType = (type) => {
    const types = allowed_image_types.includes(type)
      ? allowed_image_types.filter((t) => t !== type)
      : [...allowed_image_types, type];
    update('allowed_image_types', types);
  };

  return (
    <div className="pf-settings">

      <fieldset className="pf-settings__fieldset">
        <legend>{ __( 'Cart Behavior', 'productforge' ) }</legend>
        <label className="pf-settings__check">
          <input type="checkbox" checked={customization_required}
            onChange={(e) => update('customization_required', e.target.checked)} />
          { __( 'Require customization before adding to cart', 'productforge' ) }
        </label>
        <p className="pf-settings__note">
          { __( 'When enabled, customers must save a design before they can add the product to their cart.', 'productforge' ) }
        </p>
      </fieldset>

      <fieldset className="pf-settings__fieldset">
        <legend>{ __( 'Color Picker', 'productforge' ) }</legend>
        <label className="pf-settings__check">
          <input type="checkbox" checked={colors_enabled}
            onChange={(e) => update('colors_enabled', e.target.checked)} />
          { __( 'Enable color picker', 'productforge' ) }
        </label>
        {colors_enabled && (
          <>
            <label className="pf-settings__check">
              <input type="checkbox" checked={any_color}
                onChange={(e) => update('any_color', e.target.checked)} />
              { __( 'Allow any color (full picker)', 'productforge' ) }
            </label>
            {!any_color && (
              <div className="pf-settings__swatches">
                {allowed_colors.map((color) => (
                  <button
                    key={color}
                    className="pf-settings__swatch"
                    style={{ background: color }}
                    title={`Remove ${color}`}
                    onClick={() => update('allowed_colors', allowed_colors.filter((c) => c !== color))}
                    aria-label={`Remove color ${color}`}
                  />
                ))}
                <div className="pf-settings__color-add">
                  <input
                    type="color"
                    className="pf-settings__color-input"
                    value={pendingColor}
                    onChange={(e) => setPendingColor(e.target.value)}
                    title={ __( 'Pick a color', 'productforge' ) }
                    aria-label={ __( 'Pick a color', 'productforge' ) }
                  />
                  <button
                    type="button"
                    className="button button-small"
                    onClick={() => addColor(pendingColor)}
                    aria-label={ __( 'Add selected color', 'productforge' ) }
                  >
                    { __( 'Add', 'productforge' ) }
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </fieldset>

      <fieldset className="pf-settings__fieldset">
        <legend>{ __( 'Font Picker', 'productforge' ) }</legend>
        <label className="pf-settings__check">
          <input type="checkbox" checked={fonts_enabled}
            onChange={(e) => update('fonts_enabled', e.target.checked)} />
          { __( 'Enable font picker', 'productforge' ) }
        </label>
        {fonts_enabled && (
          <FontSelector
            allowed={globalConfig.allowed_fonts || []}
            onChange={(fonts) => update('allowed_fonts', fonts)}
          />
        )}
      </fieldset>

      <fieldset className="pf-settings__fieldset">
        <legend>{ __( 'Image Upload Restrictions', 'productforge' ) }</legend>
        <label className="pf-settings__label">
          { __( 'Max file size (MB)', 'productforge' ) }
          <input type="number" min="1" value={max_file_size_mb}
            onChange={(e) => update('max_file_size_mb', parseInt(e.target.value, 10) || 10)}
            className="pf-settings__number"
          />
        </label>
        <label className="pf-settings__label">
          { __( 'Min width (px)', 'productforge' ) }
          <input type="number" min="0" value={min_width}
            onChange={(e) => update('min_width', parseInt(e.target.value, 10) || 0)}
            className="pf-settings__number"
          />
        </label>
        <label className="pf-settings__label">
          { __( 'Min height (px)', 'productforge' ) }
          <input type="number" min="0" value={min_height}
            onChange={(e) => update('min_height', parseInt(e.target.value, 10) || 0)}
            className="pf-settings__number"
          />
        </label>
        <label className="pf-settings__label">
          { __( 'Min DPI', 'productforge' ) }
          <input type="number" min="0" value={min_dpi}
            onChange={(e) => update('min_dpi', parseInt(e.target.value, 10) || 0)}
            className="pf-settings__number"
          />
        </label>
        <div className="pf-settings__types">
          <span className="pf-settings__types-label">{ __( 'Allowed types:', 'productforge' ) }</span>
          {IMAGE_TYPES.map((type) => (
            <label key={type} className="pf-settings__check">
              <input type="checkbox"
                checked={allowed_image_types.includes(type)}
                onChange={() => toggleImageType(type)} />
              {type.toUpperCase()}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function FontSelector({ allowed, onChange }) {
  const [adding, setAdding] = useState('');

  const available = AVAILABLE_FONTS.filter((f) => !allowed.includes(f.family));

  const addFont = (family) => {
    if (family && !allowed.includes(family)) {
      onChange([...allowed, family]);
    }
    setAdding('');
  };

  const removeFont = (family) => {
    onChange(allowed.filter((f) => f !== family));
  };

  return (
    <div className="pf-settings__fonts">
      {allowed.length > 0 && (
        <div className="pf-settings__font-list">
          {allowed.map((family) => (
            <div key={family} className="pf-settings__font-item">
              <span>{family}</span>
              <button
                type="button"
                className="pf-settings__font-remove"
                onClick={() => removeFont(family)}
                aria-label={`Remove ${family}`}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="pf-settings__font-add">
        <select
          value={adding}
          onChange={(e) => addFont(e.target.value)}
        >
          <option value="">{ __( 'Add a font...', 'productforge' ) }</option>
          {available.map((f) => (
            <option key={f.family} value={f.family}>
              {f.family} ({f.category})
            </option>
          ))}
        </select>
      </div>
      {allowed.length === 0 && (
        <p className="pf-settings__note">
          { __( "No fonts selected. Customers won't be able to change fonts.", 'productforge' ) }
        </p>
      )}
    </div>
  );
}
