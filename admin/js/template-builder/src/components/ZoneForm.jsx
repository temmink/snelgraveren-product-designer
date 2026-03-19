import React, { useState, useEffect } from 'react';
import { __ } from '@wordpress/i18n';
import { extractSvgBoundingBox } from '../utils/svgPathUtils';

const DEFAULT = {
  name: '', type: 'safe_area',
  x: 0, y: 0, width: 200, height: 200,
  allowed_types: ['text', 'image', 'svg'],
  behavior: 'restrict',
  boundary_type: 'rect',
  svg_url: '',
  svg_path_data: '',
  svg_scale: 1,
  svg_rotation: 0,
};

export default function ZoneForm({ initialData = {}, onSubmit, onCancel, onChange }) {
  const [data, setData] = useState({ ...DEFAULT, ...initialData });

  // Re-sync local state when store data changes externally (e.g. canvas drag/resize).
  useEffect(() => {
    setData((prev) => ({ ...prev, ...initialData }));
  }, [initialData.x, initialData.y, initialData.width, initialData.height, initialData.svg_scale, initialData.svg_rotation]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key, val) => {
    setData((d) => {
      const next = { ...d, [key]: val };

      // When svg_scale changes, auto-compute width/height from intrinsic SVG size.
      if (key === 'svg_scale' && d.boundary_type === 'svg' && d.svg_intrinsic_width) {
        next.width  = Math.round(d.svg_intrinsic_width  * (next.svg_scale || 1));
        next.height = Math.round(d.svg_intrinsic_height * (next.svg_scale || 1));
      }

      if (onChange) onChange(next);
      return next;
    });
  };

  const toggleType = (type) => {
    const types = data.allowed_types.includes(type)
      ? data.allowed_types.filter((t) => t !== type)
      : [...data.allowed_types, type];
    set('allowed_types', types);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!data.name.trim()) return;
    if (data.width < 1 || data.height < 1) return;
    onSubmit({ ...data, name: data.name.trim() });
  };

  return (
    <form onSubmit={handleSubmit} className="pd-zone-form">
      <div className="pd-zone-form__row">
        <label className="pd-zone-form__label">
          { __( 'Name', 'product-designer' ) }
          <input
            type="text" value={data.name} required
            onChange={(e) => set('name', e.target.value)}
            className="pd-zone-form__input"
            placeholder={ __( 'e.g. Front Print Area', 'product-designer' ) }
          />
        </label>
      </div>

      <div className="pd-zone-form__row">
        <label className="pd-zone-form__label">
          { __( 'Type', 'product-designer' ) }
          <select value={data.type} onChange={(e) => set('type', e.target.value)} className="pd-zone-form__select">
            <option value="safe_area">{ __( 'Safe Area', 'product-designer' ) }</option>
            <option value="upload_zone">{ __( 'Upload Zone', 'product-designer' ) }</option>
          </select>
        </label>
        <label className="pd-zone-form__label">
          { __( 'Behavior', 'product-designer' ) }
          <select value={data.behavior} onChange={(e) => set('behavior', e.target.value)} className="pd-zone-form__select">
            <option value="restrict">{ __( "Restrict (can't leave)", 'product-designer' ) }</option>
            <option value="clip">{ __( 'Clip at boundary', 'product-designer' ) }</option>
          </select>
        </label>
      </div>

      {/* Boundary Type */}
      <label className="pd-zone-form__field">
        <span>{ __( 'Boundary', 'product-designer' ) }</span>
        <select
          value={data.boundary_type || 'rect'}
          onChange={(e) => set('boundary_type', e.target.value)}
        >
          <option value="rect">{ __( 'Rectangle', 'product-designer' ) }</option>
          <option value="svg">{ __( 'SVG Shape', 'product-designer' ) }</option>
        </select>
      </label>

      {/* SVG Upload — only shown when boundary_type is 'svg' */}
      {data.boundary_type === 'svg' && (
        <div className="pd-zone-form__svg-upload">
          {data.svg_url ? (
            <div className="pd-zone-form__svg-preview">
              <img src={data.svg_url} alt={ __( 'Zone shape', 'product-designer' ) } style={{ maxWidth: '100%', maxHeight: '80px' }} />
              <button type="button" onClick={() => setData((d) => {
                const next = { ...d, svg_url: '', svg_path_data: '' };
                if (onChange) onChange(next);
                return next;
              })}>
                { __( 'Remove', 'product-designer' ) }
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!window.wp?.media) return;
                const frame = window.wp.media({
                  title: __( 'Select SVG Zone Shape', 'product-designer' ),
                  button: { text: __( 'Use Shape', 'product-designer' ) },
                  multiple: false,
                  library: { type: 'image/svg+xml' },
                });
                frame.on('select', async () => {
                  const attachment = frame.state().get('selection').first().toJSON();
                  try {
                    const resp = await fetch(attachment.url);
                    const svgText = await resp.text();
                    const bbox = await extractSvgBoundingBox(svgText);
                    if (!bbox) {
                      alert( __( 'Could not parse SVG file.', 'product-designer' ) );
                      return;
                    }
                    setData((d) => {
                      const iw = bbox.width || 200;
                      const ih = bbox.height || 200;
                      const scale = d.svg_scale || 1;
                      const next = {
                        ...d,
                        svg_url: attachment.url,
                        svg_intrinsic_width: iw,
                        svg_intrinsic_height: ih,
                        width: Math.round(iw * scale),
                        height: Math.round(ih * scale),
                      };
                      if (onChange) onChange(next);
                      return next;
                    });
                  } catch {
                    alert( __( 'Failed to parse SVG file.', 'product-designer' ) );
                  }
                });
                frame.open();
              }}
            >
              { __( 'Upload SVG Shape', 'product-designer' ) }
            </button>
          )}
          {data.svg_url && (
            <>
              <label className="pd-zone-form__field">
                <span>{ __( 'Scale', 'product-designer' ) }</span>
                <input
                  type="number" step="any" min="0.1"
                  value={Math.round((data.svg_scale || 1) * 100) / 100}
                  onChange={(e) => set('svg_scale', parseFloat(e.target.value) || 1)}
                />
              </label>
              <label className="pd-zone-form__field">
                <span>{ __( 'Rotation', 'product-designer' ) }</span>
                <input
                  type="number" step="1" min="0" max="360"
                  value={data.svg_rotation || 0}
                  onChange={(e) => set('svg_rotation', parseInt(e.target.value, 10) || 0)}
                />
              </label>
            </>
          )}
        </div>
      )}

      <div className="pd-zone-form__row pd-zone-form__row--coords">
        {[['x','X'], ['y','Y'], ['width','W'], ['height','H']].map(([key, label]) => {
          const isSvgSize = data.boundary_type === 'svg' && (key === 'width' || key === 'height');
          return (
            <label key={key} className="pd-zone-form__label pd-zone-form__label--coord">
              {label}
              <input
                type="number" value={data[key]} min={key === 'width' || key === 'height' ? 1 : 0}
                onChange={(e) => set(key, Number(e.target.value))}
                readOnly={isSvgSize}
                className="pd-zone-form__input pd-zone-form__input--number"
                style={isSvgSize ? { opacity: 0.6 } : undefined}
                title={isSvgSize ? __( 'Resize the SVG on canvas or change Scale to adjust', 'product-designer' ) : undefined}
              />
            </label>
          );
        })}
      </div>

      <fieldset className="pd-zone-form__fieldset">
        <legend>{ __( 'Allowed element types', 'product-designer' ) }</legend>
        {['text', 'image', 'svg'].map((t) => (
          <label key={t} className="pd-zone-form__checkbox-label">
            <input
              type="checkbox"
              checked={data.allowed_types.includes(t)}
              onChange={() => toggleType(t)}
            />
            {t}
          </label>
        ))}
      </fieldset>

      {data.type === 'upload_zone' && (
        <div className="pd-zone-form__row">
          <label className="pd-zone-form__label">
            { __( 'Mask SVG URL', 'product-designer' ) }
            <input
              type="url" value={data.mask_svg_url || ''}
              onChange={(e) => set('mask_svg_url', e.target.value)}
              className="pd-zone-form__input"
              placeholder="https://…"
            />
          </label>
        </div>
      )}

      <div className="pd-zone-form__actions">
        <button type="submit" className="button button-primary">{ __( 'Save Boundary', 'product-designer' ) }</button>
        <button type="button" className="button" onClick={onCancel}>{ __( 'Cancel', 'product-designer' ) }</button>
      </div>
    </form>
  );
}
