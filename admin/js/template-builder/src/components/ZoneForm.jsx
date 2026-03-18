import React, { useState } from 'react';
import { extractClosedPath, pathToBoundingBox } from '../utils/svgPathUtils';

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

export default function ZoneForm({ initialData = {}, onSubmit, onCancel }) {
  const [data, setData] = useState({ ...DEFAULT, ...initialData });

  const set = (key, val) => setData((d) => ({ ...d, [key]: val }));

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
          Name
          <input
            type="text" value={data.name} required
            onChange={(e) => set('name', e.target.value)}
            className="pd-zone-form__input"
            placeholder="e.g. Print Area"
          />
        </label>
      </div>

      <div className="pd-zone-form__row">
        <label className="pd-zone-form__label">
          Type
          <select value={data.type} onChange={(e) => set('type', e.target.value)} className="pd-zone-form__select">
            <option value="safe_area">Safe Area</option>
            <option value="upload_zone">Upload Zone</option>
          </select>
        </label>
        <label className="pd-zone-form__label">
          Behavior
          <select value={data.behavior} onChange={(e) => set('behavior', e.target.value)} className="pd-zone-form__select">
            <option value="restrict">Restrict (can't leave)</option>
            <option value="clip">Clip at boundary</option>
          </select>
        </label>
      </div>

      {/* Boundary Type */}
      <label className="pd-zone-form__field">
        <span>Boundary</span>
        <select
          value={data.boundary_type || 'rect'}
          onChange={(e) => set('boundary_type', e.target.value)}
        >
          <option value="rect">Rectangle</option>
          <option value="svg">SVG Shape</option>
        </select>
      </label>

      {/* SVG Upload — only shown when boundary_type is 'svg' */}
      {data.boundary_type === 'svg' && (
        <div className="pd-zone-form__svg-upload">
          {data.svg_url ? (
            <div className="pd-zone-form__svg-preview">
              <img src={data.svg_url} alt="Zone shape" style={{ maxWidth: '100%', maxHeight: '80px' }} />
              <button type="button" onClick={() => setData((d) => ({ ...d, svg_url: '', svg_path_data: '' }))}>
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!window.wp?.media) return;
                const frame = window.wp.media({
                  title: 'Select SVG Zone Shape',
                  button: { text: 'Use Shape' },
                  multiple: false,
                  library: { type: 'image/svg+xml' },
                });
                frame.on('select', async () => {
                  const attachment = frame.state().get('selection').first().toJSON();
                  try {
                    const resp = await fetch(attachment.url);
                    const svgText = await resp.text();
                    const result = extractClosedPath(svgText);
                    if (!result) {
                      alert('SVG must contain a single closed path.');
                      return;
                    }
                    const bbox = pathToBoundingBox(result.pathData, data.svg_scale || 1, data.svg_rotation || 0);
                    setData((d) => ({
                      ...d,
                      svg_url: attachment.url,
                      svg_path_data: result.pathData,
                      width: bbox.width || 200,
                      height: bbox.height || 200,
                    }));
                  } catch {
                    alert('Failed to parse SVG file.');
                  }
                });
                frame.open();
              }}
            >
              Upload SVG Shape
            </button>
          )}
          {data.svg_path_data && (
            <>
              <label className="pd-zone-form__field">
                <span>Scale</span>
                <input
                  type="number" step="0.1" min="0.1" max="10"
                  value={data.svg_scale || 1}
                  onChange={(e) => {
                    const s = parseFloat(e.target.value) || 1;
                    const bbox = pathToBoundingBox(data.svg_path_data, s, data.svg_rotation || 0);
                    setData((d) => ({ ...d, svg_scale: s, width: bbox.width, height: bbox.height }));
                  }}
                />
              </label>
              <label className="pd-zone-form__field">
                <span>Rotation</span>
                <input
                  type="number" step="1" min="0" max="360"
                  value={data.svg_rotation || 0}
                  onChange={(e) => {
                    const r = parseInt(e.target.value, 10) || 0;
                    const bbox = pathToBoundingBox(data.svg_path_data, data.svg_scale || 1, r);
                    setData((d) => ({ ...d, svg_rotation: r, width: bbox.width, height: bbox.height }));
                  }}
                />
              </label>
            </>
          )}
        </div>
      )}

      <div className="pd-zone-form__row pd-zone-form__row--coords">
        {[['x','X'], ['y','Y'], ['width','W'], ['height','H']].map(([key, label]) => (
          <label key={key} className="pd-zone-form__label pd-zone-form__label--coord">
            {label}
            <input
              type="number" value={data[key]} min={key === 'width' || key === 'height' ? 1 : 0}
              onChange={(e) => set(key, Number(e.target.value))}
              className="pd-zone-form__input pd-zone-form__input--number"
            />
          </label>
        ))}
      </div>

      <fieldset className="pd-zone-form__fieldset">
        <legend>Allowed element types</legend>
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
            Mask SVG URL
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
        <button type="submit" className="button button-primary">Save Zone</button>
        <button type="button" className="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
