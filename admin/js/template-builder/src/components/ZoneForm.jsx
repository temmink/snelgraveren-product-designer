import React, { useState } from 'react';

const DEFAULT = {
  name: '', type: 'safe_area',
  x: 0, y: 0, width: 200, height: 200,
  allowed_types: ['text', 'image', 'svg'],
  behavior: 'restrict',
  mask_svg_url: '',
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
              type="url" value={data.mask_svg_url}
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
