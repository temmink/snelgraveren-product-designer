import React, { useState } from 'react';
import { __ } from '@wordpress/i18n';
import useTemplateStore from '../../store/useTemplateStore';
import { AVAILABLE_FONTS, loadCustomFonts, mergeCustomFonts } from '../../utils/fonts';
import { fontApi } from '../../api/templateApi';

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
          <option value="">{__('Add a font...', 'snelgraveren-product-designer')}</option>
          {available.map((f) => (
            <option key={f.family} value={f.family}>
              {f.family} ({f.category})
            </option>
          ))}
        </select>
      </div>

      {/* Custom font upload */}
      <div className="pf-settings__font-upload">
        <h4>{__('Upload Custom Font', 'snelgraveren-product-designer')}</h4>
        {!pendingFile ? (
          <div className="pf-settings__font-upload-row">
            <label className="button button-small pf-settings__font-upload-btn">
              {__('Choose File', 'snelgraveren-product-designer')}
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
              placeholder={__('Font family name', 'snelgraveren-product-designer')}
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
              {isUploading ? __('Uploading\u2026', 'snelgraveren-product-designer') : __('Upload', 'snelgraveren-product-designer')}
            </button>
            <button
              type="button"
              className="button button-small"
              onClick={() => { setPendingFile(null); setUploadFamily(''); }}
              disabled={isUploading}
            >
              {__('Cancel', 'snelgraveren-product-designer')}
            </button>
          </div>
        )}
        <p className="pf-settings__note">
          {__('Supported formats: .woff2, .woff, .ttf. You can upload multiple files for the same family name (e.g. regular + bold).', 'snelgraveren-product-designer')}
        </p>
        {uploadError && <p className="pf-settings__error">{uploadError}</p>}
      </div>

      {/* List of uploaded custom fonts */}
      {customFonts.length > 0 && (
        <div className="pf-settings__font-custom-list">
          <h4>{__('Uploaded Fonts', 'snelgraveren-product-designer')}</h4>
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
                title={__('Delete font', 'snelgraveren-product-designer')}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {allowed.length === 0 && (
        <p className="pf-settings__note">
          {__("No fonts selected. Customers won't be able to change fonts.", 'snelgraveren-product-designer')}
        </p>
      )}
    </div>
  );
}

export default function SettingsFonts({ globalConfig, update }) {
  const { fonts_enabled = false } = globalConfig;

  return (
    <>
      <h3 className="pf-settings__section-title">{__('Fonts', 'snelgraveren-product-designer')}</h3>
      <p className="pf-settings__section-desc">{__('Control which fonts customers can use in their designs.', 'snelgraveren-product-designer')}</p>

      <fieldset className="pf-settings__fieldset">
        <legend>{__('Font Picker', 'snelgraveren-product-designer')}</legend>
        <label className="pf-settings__check">
          <input type="checkbox" checked={fonts_enabled}
            onChange={(e) => update('fonts_enabled', e.target.checked)} />
          {__('Enable font picker', 'snelgraveren-product-designer')}
        </label>
        {fonts_enabled && (
          <FontSelector
            allowed={globalConfig.allowed_fonts || []}
            onChange={(fonts) => update('allowed_fonts', fonts)}
          />
        )}
      </fieldset>
    </>
  );
}
