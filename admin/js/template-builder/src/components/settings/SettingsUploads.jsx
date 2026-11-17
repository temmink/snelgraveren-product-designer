import React from 'react';
import { __ } from '@wordpress/i18n';

const IMAGE_TYPES = ['jpg', 'png', 'svg', 'webp'];

export default function SettingsUploads({ globalConfig, update }) {
  const {
    max_file_size_mb  = 10,
    min_width         = 0,
    min_height        = 0,
    min_dpi           = 0,
    allowed_image_types = ['jpg', 'png', 'svg', 'webp'],
  } = globalConfig;

  const toggleImageType = (type) => {
    const types = allowed_image_types.includes(type)
      ? allowed_image_types.filter((t) => t !== type)
      : [...allowed_image_types, type];
    update('allowed_image_types', types);
  };

  return (
    <>
      <h3 className="pf-settings__section-title">{__('Uploads', 'snelgraveren-product-designer')}</h3>
      <p className="pf-settings__section-desc">{__('Restrict what customers can upload to their designs.', 'snelgraveren-product-designer')}</p>

      <fieldset className="pf-settings__fieldset">
        <legend>{__('Vector Only', 'snelgraveren-product-designer')}</legend>
        <label className="pf-settings__check">
          <input type="checkbox" checked={globalConfig.vector_only || false}
            onChange={(e) => update('vector_only', e.target.checked)} />
          {__('Vector only (engraving) — block raster image uploads', 'snelgraveren-product-designer')}
        </label>
        <p className="pf-settings__note">
          {__('Enable this for laser/CNC engraving products. Customers can still upload SVGs and use clip art, but photo (JPG/PNG/WebP) uploads are blocked.', 'snelgraveren-product-designer')}
        </p>
      </fieldset>

      <fieldset className="pf-settings__fieldset">
        <legend>{__('Image Upload Restrictions', 'snelgraveren-product-designer')}</legend>
        <label className="pf-settings__label">
          {__('Max file size (MB)', 'snelgraveren-product-designer')}
          <input type="number" min="1" value={max_file_size_mb}
            onChange={(e) => update('max_file_size_mb', parseInt(e.target.value, 10) || 10)}
            className="pf-settings__number"
          />
        </label>
        <label className="pf-settings__label">
          {__('Min width (px)', 'snelgraveren-product-designer')}
          <input type="number" min="0" value={min_width}
            onChange={(e) => update('min_width', parseInt(e.target.value, 10) || 0)}
            className="pf-settings__number"
          />
        </label>
        <label className="pf-settings__label">
          {__('Min height (px)', 'snelgraveren-product-designer')}
          <input type="number" min="0" value={min_height}
            onChange={(e) => update('min_height', parseInt(e.target.value, 10) || 0)}
            className="pf-settings__number"
          />
        </label>
        <label className="pf-settings__label">
          {__('Min DPI', 'snelgraveren-product-designer')}
          <input type="number" min="0" value={min_dpi}
            onChange={(e) => update('min_dpi', parseInt(e.target.value, 10) || 0)}
            className="pf-settings__number"
          />
        </label>
        <div className="pf-settings__types">
          <span className="pf-settings__types-label">{__('Allowed types:', 'snelgraveren-product-designer')}</span>
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
    </>
  );
}
