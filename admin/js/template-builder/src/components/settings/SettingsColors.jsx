import React, { useState } from 'react';
import { __ } from '@wordpress/i18n';
import { paletteApi } from '../../api/templateApi';

function PaletteManager({ palettes, onUpdate }) {
  const [newName, setNewName] = useState('');
  const [newColors, setNewColors] = useState([]);
  const [pendingColor, setPendingColor] = useState('#000000');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editColors, setEditColors] = useState([]);
  const [editPendingColor, setEditPendingColor] = useState('#000000');
  const [error, setError] = useState(null);

  const handleCreate = async () => {
    if (!newName.trim() || newColors.length === 0) return;
    setError(null);
    try {
      const created = await paletteApi.create({ name: newName.trim(), colors: newColors });
      onUpdate([...palettes, created]);
      setNewName('');
      setNewColors([]);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    setError(null);
    try {
      await paletteApi.delete(id);
      onUpdate(palettes.filter((p) => p.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (palette) => {
    setEditingId(palette.id);
    setEditName(palette.name);
    setEditColors([...palette.colors]);
  };

  const handleSaveEdit = async () => {
    if (!editName.trim()) return;
    setError(null);
    try {
      const updated = await paletteApi.update(editingId, { name: editName.trim(), colors: editColors });
      onUpdate(palettes.map((p) => p.id === editingId ? updated : p));
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="pf-palette-manager">
      <h4>{__('Color Palettes', 'snelgraveren-product-designer')}</h4>
      {error && <p className="pf-settings__error">{error}</p>}

      {/* Existing palettes */}
      {palettes.map((p) => (
        <div key={p.id} className="pf-palette-manager__item">
          {editingId === p.id ? (
            <div className="pf-palette-manager__edit">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="pf-settings__input"
              />
              <div className="pf-settings__swatches">
                {editColors.map((c, i) => (
                  <button
                    key={`${c}-${i}`}
                    className="pf-settings__swatch"
                    style={{ background: c }}
                    title={`Remove ${c}`}
                    onClick={() => setEditColors(editColors.filter((_, j) => j !== i))}
                  />
                ))}
                <div className="pf-settings__color-add">
                  <input
                    type="color"
                    className="pf-settings__color-input"
                    value={editPendingColor}
                    onChange={(e) => setEditPendingColor(e.target.value)}
                  />
                  <button
                    type="button"
                    className="button button-small"
                    onClick={() => {
                      if (editPendingColor && !editColors.includes(editPendingColor)) {
                        setEditColors([...editColors, editPendingColor]);
                      }
                    }}
                  >
                    {__('Add', 'snelgraveren-product-designer')}
                  </button>
                </div>
              </div>
              <div className="pf-palette-manager__actions">
                <button type="button" className="button button-primary button-small" onClick={handleSaveEdit}>
                  {__('Save', 'snelgraveren-product-designer')}
                </button>
                <button type="button" className="button button-small" onClick={() => setEditingId(null)}>
                  {__('Cancel', 'snelgraveren-product-designer')}
                </button>
              </div>
            </div>
          ) : (
            <div className="pf-palette-manager__row">
              <strong>{p.name}</strong>
              <div className="pf-settings__swatches">
                {p.colors.map((c) => (
                  <span key={c} className="pf-settings__swatch pf-settings__swatch--preview" style={{ background: c, cursor: 'default' }} title={c} />
                ))}
              </div>
              <div className="pf-palette-manager__actions">
                <button type="button" className="button button-small" onClick={() => startEdit(p)}>
                  {__('Edit', 'snelgraveren-product-designer')}
                </button>
                <button type="button" className="button button-small pf-btn--danger" onClick={() => handleDelete(p.id)}>
                  {__('Delete', 'snelgraveren-product-designer')}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Create new palette */}
      <div className="pf-palette-manager__new">
        <h5>{__('New Palette', 'snelgraveren-product-designer')}</h5>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={__('Palette name', 'snelgraveren-product-designer')}
          className="pf-settings__input"
        />
        <div className="pf-settings__swatches">
          {newColors.map((c, i) => (
            <button
              key={`${c}-${i}`}
              className="pf-settings__swatch"
              style={{ background: c }}
              title={`Remove ${c}`}
              onClick={() => setNewColors(newColors.filter((_, j) => j !== i))}
            />
          ))}
          <div className="pf-settings__color-add">
            <input
              type="color"
              className="pf-settings__color-input"
              value={pendingColor}
              onChange={(e) => setPendingColor(e.target.value)}
            />
            <button
              type="button"
              className="button button-small"
              onClick={() => {
                if (pendingColor && !newColors.includes(pendingColor)) {
                  setNewColors([...newColors, pendingColor]);
                }
              }}
            >
              {__('Add', 'snelgraveren-product-designer')}
            </button>
          </div>
        </div>
        <button
          type="button"
          className="button button-primary button-small"
          onClick={handleCreate}
          disabled={!newName.trim() || newColors.length === 0}
        >
          {__('Create Palette', 'snelgraveren-product-designer')}
        </button>
      </div>
    </div>
  );
}

function ColorModeFieldset({ legend, prefix, globalConfig, update, colorPalettes, setColorPalettes }) {
  const enabled       = globalConfig[`${prefix}_colors_enabled`] || false;
  const colorMode     = globalConfig[`${prefix}_color_mode`] || 'individual';
  const paletteId     = globalConfig[`${prefix}_color_palette_id`] || '';
  const allowedColors = globalConfig[`${prefix}_allowed_colors`] || [];

  const [pendingColor, setPendingColor] = useState('#000000');
  const [showPaletteManager, setShowPaletteManager] = useState(false);

  const addColor = (hex) => {
    if (hex && !allowedColors.includes(hex)) {
      update(`${prefix}_allowed_colors`, [...allowedColors, hex]);
    }
  };

  return (
    <fieldset className="pf-settings__fieldset">
      <legend>{legend}</legend>
      <label className="pf-settings__check">
        <input type="checkbox" checked={enabled}
          onChange={(e) => update(`${prefix}_colors_enabled`, e.target.checked)} />
        {__('Enable color picker', 'snelgraveren-product-designer')}
      </label>
      {enabled && (
        <>
          <div className="pf-settings__color-mode">
            <label className="pf-settings__label">
              {__('Color mode', 'snelgraveren-product-designer')}
              <select
                value={colorMode}
                onChange={(e) => update(`${prefix}_color_mode`, e.target.value)}
                className="pf-settings__select"
              >
                <option value="all">{__('All colors (full picker)', 'snelgraveren-product-designer')}</option>
                <option value="palette">{__('Use a color palette', 'snelgraveren-product-designer')}</option>
                <option value="individual">{__('Individual colors', 'snelgraveren-product-designer')}</option>
              </select>
            </label>
          </div>

          {colorMode === 'palette' && (
            <div className="pf-settings__palette-select">
              <label className="pf-settings__label">
                {__('Palette', 'snelgraveren-product-designer')}
                <div className="pf-settings__palette-row">
                  <select
                    value={paletteId}
                    onChange={(e) => update(`${prefix}_color_palette_id`, e.target.value)}
                    className="pf-settings__select"
                  >
                    <option value="">{__('— Select a palette —', 'snelgraveren-product-designer')}</option>
                    {colorPalettes.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.colors.length} {__('colors', 'snelgraveren-product-designer')})</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="button button-small"
                    onClick={() => setShowPaletteManager(!showPaletteManager)}
                  >
                    {showPaletteManager ? __('Close', 'snelgraveren-product-designer') : __('Manage Palettes', 'snelgraveren-product-designer')}
                  </button>
                </div>
              </label>
              {paletteId && (() => {
                const selected = colorPalettes.find((p) => p.id === paletteId);
                if (!selected) return null;
                return (
                  <div className="pf-settings__swatches" style={{ marginTop: 8 }}>
                    {selected.colors.map((c) => (
                      <span key={c} className="pf-settings__swatch pf-settings__swatch--preview" style={{ background: c, cursor: 'default' }} title={c} />
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {colorMode === 'individual' && (
            <div className="pf-settings__swatches">
              {allowedColors.map((color) => (
                <button
                  key={color}
                  className="pf-settings__swatch"
                  style={{ background: color }}
                  title={`Remove ${color}`}
                  onClick={() => update(`${prefix}_allowed_colors`, allowedColors.filter((c) => c !== color))}
                  aria-label={`Remove color ${color}`}
                />
              ))}
              <div className="pf-settings__color-add">
                <input
                  type="color"
                  className="pf-settings__color-input"
                  value={pendingColor}
                  onChange={(e) => setPendingColor(e.target.value)}
                  title={__('Pick a color', 'snelgraveren-product-designer')}
                  aria-label={__('Pick a color', 'snelgraveren-product-designer')}
                />
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => addColor(pendingColor)}
                  aria-label={__('Add selected color', 'snelgraveren-product-designer')}
                >
                  {__('Add', 'snelgraveren-product-designer')}
                </button>
              </div>
            </div>
          )}

          {(colorMode === 'palette' && showPaletteManager) && (
            <PaletteManager
              palettes={colorPalettes}
              onUpdate={setColorPalettes}
            />
          )}
        </>
      )}
    </fieldset>
  );
}

export default function SettingsColors({ globalConfig, update, colorPalettes, setColorPalettes }) {
  return (
    <>
      <h3 className="pf-settings__section-title">{__('Colors', 'snelgraveren-product-designer')}</h3>
      <p className="pf-settings__section-desc">{__('Configure color pickers for product and element colors.', 'snelgraveren-product-designer')}</p>

      <ColorModeFieldset
        legend={__('Colorpicker Product', 'snelgraveren-product-designer')}
        prefix="product"
        globalConfig={globalConfig}
        update={update}
        colorPalettes={colorPalettes}
        setColorPalettes={setColorPalettes}
      />

      <ColorModeFieldset
        legend={__('Colorpicker Elements', 'snelgraveren-product-designer')}
        prefix="element"
        globalConfig={globalConfig}
        update={update}
        colorPalettes={colorPalettes}
        setColorPalettes={setColorPalettes}
      />
    </>
  );
}
