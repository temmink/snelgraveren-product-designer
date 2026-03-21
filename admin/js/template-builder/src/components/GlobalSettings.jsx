import React, { useState } from 'react';
import { __ } from '@wordpress/i18n';
import useTemplateStore from '../store/useTemplateStore';
import { AVAILABLE_FONTS, loadCustomFonts, mergeCustomFonts } from '../utils/fonts';
import { fontApi, paletteApi } from '../api/templateApi';

const IMAGE_TYPES = ['jpg', 'png', 'svg', 'webp'];

export default function GlobalSettings() {
  const { globalConfig, setGlobalConfig, colorPalettes, setColorPalettes } = useTemplateStore();
  const {
    customization_required = false,
    colors_enabled    = false,
    color_mode        = 'individual',
    color_palette_id  = '',
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
  const [showPaletteManager, setShowPaletteManager] = useState(false);

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
        <legend>{ __( 'Product Color', 'productforge' ) }</legend>
        <label className="pf-settings__check">
          <input type="checkbox" checked={globalConfig.solid_color || false}
            onChange={(e) => update('solid_color', e.target.checked)} />
          { __( 'Solid color product (all views share the same color)', 'productforge' ) }
        </label>
        <p className="pf-settings__note">
          { __( 'Enable this for products like dog tags, keychains, etc. where front and back are the same color. Changing the color on one view will update all views.', 'productforge' ) }
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
            <div className="pf-settings__color-mode">
              <label className="pf-settings__label">
                { __( 'Color mode', 'productforge' ) }
                <select
                  value={color_mode}
                  onChange={(e) => update('color_mode', e.target.value)}
                  className="pf-settings__select"
                >
                  <option value="all">{ __( 'All colors (full picker)', 'productforge' ) }</option>
                  <option value="palette">{ __( 'Use a color palette', 'productforge' ) }</option>
                  <option value="individual">{ __( 'Individual colors', 'productforge' ) }</option>
                </select>
              </label>
            </div>

            {color_mode === 'palette' && (
              <div className="pf-settings__palette-select">
                <label className="pf-settings__label">
                  { __( 'Palette', 'productforge' ) }
                  <div className="pf-settings__palette-row">
                    <select
                      value={color_palette_id}
                      onChange={(e) => update('color_palette_id', e.target.value)}
                      className="pf-settings__select"
                    >
                      <option value="">{ __( '— Select a palette —', 'productforge' ) }</option>
                      {colorPalettes.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({p.colors.length} { __( 'colors', 'productforge' ) })</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="button button-small"
                      onClick={() => setShowPaletteManager(!showPaletteManager)}
                    >
                      { showPaletteManager ? __( 'Close', 'productforge' ) : __( 'Manage Palettes', 'productforge' ) }
                    </button>
                  </div>
                </label>
                {color_palette_id && (() => {
                  const selected = colorPalettes.find((p) => p.id === color_palette_id);
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

            {color_mode === 'individual' && (
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

            {(color_mode === 'palette' && showPaletteManager) && (
              <PaletteManager
                palettes={colorPalettes}
                onUpdate={setColorPalettes}
              />
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
  const { customFonts, setCustomFonts } = useTemplateStore();
  const [adding, setAdding] = useState('');
  const [uploadFamily, setUploadFamily] = useState('');
  const [pendingFile, setPendingFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const allFonts = mergeCustomFonts(customFonts);
  const available = allFonts.filter((f) => !allowed.includes(f.family));

  const addFont = (family) => {
    if (family && !allowed.includes(family)) {
      onChange([...allowed, family]);
    }
    setAdding('');
  };

  const removeFont = (family) => {
    onChange(allowed.filter((f) => f !== family));
  };

  const refreshCustomFonts = async () => {
    const updated = await fontApi.list();
    setCustomFonts(updated);
    loadCustomFonts(updated);
    return updated;
  };

  const deriveFamilyName = (filename) => {
    const base = filename.replace(/\.(woff2?|ttf)$/i, '');
    return base.replace(/[-_](Regular|Bold|Italic|Light|Medium|SemiBold|ExtraBold|Thin|Black|BoldItalic)$/i, '');
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setUploadFamily(deriveFamilyName(file.name));
    e.target.value = '';
  };

  const handleUpload = async () => {
    if (!pendingFile || !uploadFamily.trim()) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      await fontApi.upload(pendingFile, uploadFamily.trim());
      await refreshCustomFonts();
      setUploadFamily('');
      setPendingFile(null);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteCustomFont = async (family) => {
    try {
      await fontApi.deleteFamily(family);
      await refreshCustomFonts();
      if (allowed.includes(family)) {
        onChange(allowed.filter((f) => f !== family));
      }
    } catch (err) {
      setUploadError(err.message);
    }
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
        <select value={adding} onChange={(e) => addFont(e.target.value)}>
          <option value="">{ __( 'Add a font...', 'productforge' ) }</option>
          {available.map((f) => (
            <option key={f.family} value={f.family}>
              {f.family} ({f.category})
            </option>
          ))}
        </select>
      </div>

      {/* Custom font upload */}
      <div className="pf-settings__font-upload">
        <h4>{ __( 'Upload Custom Font', 'productforge' ) }</h4>
        {!pendingFile ? (
          <div className="pf-settings__font-upload-row">
            <label className="button button-small pf-settings__font-upload-btn">
              { __( 'Choose File', 'productforge' ) }
              <input
                type="file"
                accept=".woff2,.woff,.ttf"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        ) : (
          <div className="pf-settings__font-upload-row">
            <input
              type="text"
              value={uploadFamily}
              onChange={(e) => setUploadFamily(e.target.value)}
              placeholder={ __( 'Font family name', 'productforge' ) }
              className="pf-settings__font-upload-name"
            />
            <span className="pf-settings__note" style={{ marginRight: '0.5em' }}>
              {pendingFile.name}
            </span>
            <button
              type="button"
              className="button button-primary button-small"
              onClick={handleUpload}
              disabled={isUploading || !uploadFamily.trim()}
            >
              {isUploading ? __( 'Uploading…', 'productforge' ) : __( 'Upload', 'productforge' )}
            </button>
            <button
              type="button"
              className="button button-small"
              onClick={() => { setPendingFile(null); setUploadFamily(''); }}
              disabled={isUploading}
            >
              { __( 'Cancel', 'productforge' ) }
            </button>
          </div>
        )}
        <p className="pf-settings__note">
          { __( 'Supported formats: .woff2, .woff, .ttf. You can upload multiple files for the same family name (e.g. regular + bold).', 'productforge' ) }
        </p>
        {uploadError && <p className="pf-settings__error">{uploadError}</p>}
      </div>

      {/* List of uploaded custom fonts */}
      {customFonts.length > 0 && (
        <div className="pf-settings__font-custom-list">
          <h4>{ __( 'Uploaded Fonts', 'productforge' ) }</h4>
          {customFonts.map((font) => (
            <div key={font.family} className="pf-settings__font-item">
              <span style={{ fontFamily: `'${font.family}'` }}>{font.family}</span>
              <span className="pf-settings__note" style={{ marginLeft: '0.5em' }}>
                ({font.files.length} {font.files.length === 1 ? 'file' : 'files'})
              </span>
              <button
                type="button"
                className="pf-settings__font-remove"
                onClick={() => handleDeleteCustomFont(font.family)}
                aria-label={`Delete ${font.family}`}
                title={ __( 'Delete font', 'productforge' ) }
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {allowed.length === 0 && (
        <p className="pf-settings__note">
          { __( "No fonts selected. Customers won't be able to change fonts.", 'productforge' ) }
        </p>
      )}
    </div>
  );
}

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
      <h4>{ __( 'Color Palettes', 'productforge' ) }</h4>
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
                    { __( 'Add', 'productforge' ) }
                  </button>
                </div>
              </div>
              <div className="pf-palette-manager__actions">
                <button type="button" className="button button-primary button-small" onClick={handleSaveEdit}>
                  { __( 'Save', 'productforge' ) }
                </button>
                <button type="button" className="button button-small" onClick={() => setEditingId(null)}>
                  { __( 'Cancel', 'productforge' ) }
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
                  { __( 'Edit', 'productforge' ) }
                </button>
                <button type="button" className="button button-small pf-btn--danger" onClick={() => handleDelete(p.id)}>
                  { __( 'Delete', 'productforge' ) }
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Create new palette */}
      <div className="pf-palette-manager__new">
        <h5>{ __( 'New Palette', 'productforge' ) }</h5>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={ __( 'Palette name', 'productforge' ) }
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
              { __( 'Add', 'productforge' ) }
            </button>
          </div>
        </div>
        <button
          type="button"
          className="button button-primary button-small"
          onClick={handleCreate}
          disabled={!newName.trim() || newColors.length === 0}
        >
          { __( 'Create Palette', 'productforge' ) }
        </button>
      </div>
    </div>
  );
}
