import React, { useState } from 'react';
import useTemplateStore from '../store/useTemplateStore';

const IMAGE_TYPES = ['jpg', 'png', 'svg', 'webp'];

export default function GlobalSettings() {
  const { globalConfig, setGlobalConfig } = useTemplateStore();
  const {
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
    <div className="pd-settings">

      <fieldset className="pd-settings__fieldset">
        <legend>Color Picker</legend>
        <label className="pd-settings__check">
          <input type="checkbox" checked={colors_enabled}
            onChange={(e) => update('colors_enabled', e.target.checked)} />
          Enable color picker
        </label>
        {colors_enabled && (
          <>
            <label className="pd-settings__check">
              <input type="checkbox" checked={any_color}
                onChange={(e) => update('any_color', e.target.checked)} />
              Allow any color (full picker)
            </label>
            {!any_color && (
              <div className="pd-settings__swatches">
                {allowed_colors.map((color) => (
                  <button
                    key={color}
                    className="pd-settings__swatch"
                    style={{ background: color }}
                    title={`Remove ${color}`}
                    onClick={() => update('allowed_colors', allowed_colors.filter((c) => c !== color))}
                    aria-label={`Remove color ${color}`}
                  />
                ))}
                <div className="pd-settings__color-add">
                  <input
                    type="color"
                    className="pd-settings__color-input"
                    value={pendingColor}
                    onChange={(e) => setPendingColor(e.target.value)}
                    title="Pick a color"
                    aria-label="Pick a color"
                  />
                  <button
                    type="button"
                    className="button button-small"
                    onClick={() => addColor(pendingColor)}
                    aria-label="Add selected color"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </fieldset>

      <fieldset className="pd-settings__fieldset">
        <legend>Font Picker</legend>
        <label className="pd-settings__check">
          <input type="checkbox" checked={fonts_enabled}
            onChange={(e) => update('fonts_enabled', e.target.checked)} />
          Enable font picker
        </label>
        {fonts_enabled && (
          <p className="pd-settings__note">
            Font management (Google Fonts cache) will be available in a future update.
          </p>
        )}
      </fieldset>

      <fieldset className="pd-settings__fieldset">
        <legend>Image Upload Restrictions</legend>
        <label className="pd-settings__label">
          Max file size (MB)
          <input type="number" min="1" value={max_file_size_mb}
            onChange={(e) => update('max_file_size_mb', parseInt(e.target.value, 10) || 10)}
            className="pd-settings__number"
          />
        </label>
        <label className="pd-settings__label">
          Min width (px)
          <input type="number" min="0" value={min_width}
            onChange={(e) => update('min_width', parseInt(e.target.value, 10) || 0)}
            className="pd-settings__number"
          />
        </label>
        <label className="pd-settings__label">
          Min height (px)
          <input type="number" min="0" value={min_height}
            onChange={(e) => update('min_height', parseInt(e.target.value, 10) || 0)}
            className="pd-settings__number"
          />
        </label>
        <label className="pd-settings__label">
          Min DPI
          <input type="number" min="0" value={min_dpi}
            onChange={(e) => update('min_dpi', parseInt(e.target.value, 10) || 0)}
            className="pd-settings__number"
          />
        </label>
        <div className="pd-settings__types">
          <span className="pd-settings__types-label">Allowed types:</span>
          {IMAGE_TYPES.map((type) => (
            <label key={type} className="pd-settings__check">
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
