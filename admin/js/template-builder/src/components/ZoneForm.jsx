import React, { useState, useEffect } from 'react';
import { __ } from '@wordpress/i18n';
import { extractSvgBoundingBox } from '../utils/svgPathUtils';
import useTemplateStore from '../store/useTemplateStore';
import { AVAILABLE_FONTS, mergeCustomFonts } from '../utils/fonts';
import { mergeLayersToBoundary } from '../utils/mergeLayersToBoundary';
import { layerToBoundaryItem } from '../utils/layerBoundaryItems';

const isPremium = window.sgpdTemplateBuilder?.isPremium;

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
  svg_fill_color: '',
  svg_fill_editable: false,
};

function FillColorPicker({ value, onChange, onClear, globalConfig }) {
  const { colorPalettes } = useTemplateStore();

  // Resolve product color palette if configured
  const productEnabled = globalConfig.product_colors_enabled || false;
  const productMode    = globalConfig.product_color_mode || 'individual';
  const productColors  = globalConfig.product_allowed_colors || [];
  const paletteId      = globalConfig.product_color_palette_id || '';

  let swatches = [];
  if (productEnabled) {
    if (productMode === 'individual' && productColors.length > 0) {
      swatches = productColors;
    } else if (productMode === 'palette' && paletteId) {
      const palette = colorPalettes.find((p) => p.id === paletteId);
      if (palette?.colors?.length > 0) {
        swatches = palette.colors;
      }
    }
    // mode === 'all' → no swatches, fall through to free picker
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {swatches.length > 0 ? (
        <>
          {swatches.map((c) => (
            <button
              key={c}
              type="button"
              style={{
                width: 28, height: 28, padding: 0,
                backgroundColor: c,
                border: value === c ? '3px solid #2271b1' : '1px solid #8c8f94',
                borderRadius: 3, cursor: 'pointer',
              }}
              title={c}
              onClick={() => onChange(c)}
            />
          ))}
          {onClear && (
            <button type="button" className="button button-small" onClick={onClear}>
              { __( 'Clear', 'snelgraveren-product-designer' ) }
            </button>
          )}
        </>
      ) : (
        <>
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ width: 32, height: 28, padding: 0, border: '1px solid #8c8f94', borderRadius: 3, cursor: 'pointer' }}
          />
          {onClear && (
            <button type="button" className="button button-small" onClick={onClear}>
              { __( 'Clear', 'snelgraveren-product-designer' ) }
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function ZoneForm({ initialData = {}, onSubmit, onCancel, onChange }) {
  const { globalConfig, customFonts, views, currentViewIndex } = useTemplateStore();
  const [data, setData] = useState({ ...DEFAULT, ...initialData });

  // Imported svg layers on the current view that carry inline geometry.
  const eligibleLayers = (views[currentViewIndex]?.zones_config || []).flatMap((zone, zi) =>
    (zone.layers || [])
      .map((layer, li) => ({ layer, key: `${zi}:${li}` }))
      .filter(({ layer }) => layer.type === 'svg' && layer.svg_markup)
  );

  const [svgSource, setSvgSource] = useState(
    (initialData.svg_markup && !initialData.svg_url) ? 'layers' : 'upload'
  );
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());

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

  const applyLayerSelection = (keys) => {
    const items = eligibleLayers
      .filter(({ key }) => keys.has(key))
      .map(({ layer }) => layerToBoundaryItem(layer))
      .filter(Boolean);
    const merged = items.length ? mergeLayersToBoundary(items) : null;
    setData((d) => {
      const next = merged
        ? { ...d, boundary_type: 'svg', svg_url: '', svg_path_data: '',
            svg_markup: merged.svg_markup,
            svg_intrinsic_width: merged.width, svg_intrinsic_height: merged.height,
            x: merged.x, y: merged.y, width: merged.width, height: merged.height,
            svg_scale: 1 }
        : { ...d, svg_markup: '' };
      if (onChange) onChange(next);
      return next;
    });
  };

  const toggleLayer = (key) => {
    setSelectedKeys((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(key)) nextSet.delete(key); else nextSet.add(key);
      applyLayerSelection(nextSet);
      return nextSet;
    });
  };

  const switchSvgSource = (src) => {
    setSvgSource(src);
    if (src === 'upload') {
      setSelectedKeys(new Set());
      setData((d) => { const next = { ...d, svg_markup: '' }; if (onChange) onChange(next); return next; });
    } else {
      setData((d) => { const next = { ...d, svg_url: '', svg_path_data: '' }; if (onChange) onChange(next); return next; });
    }
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
    <form onSubmit={handleSubmit} className="pf-zone-form">
      <div className="pf-zone-form__row">
        <label className="pf-zone-form__label">
          { __( 'Name', 'snelgraveren-product-designer' ) }
          <input
            type="text" value={data.name} required
            onChange={(e) => set('name', e.target.value)}
            className="pf-zone-form__input"
            placeholder={ __( 'e.g. Front Print Area', 'snelgraveren-product-designer' ) }
          />
        </label>
      </div>

      <div className="pf-zone-form__row">
        <label className="pf-zone-form__label">
          { __( 'Type', 'snelgraveren-product-designer' ) }
          <select value={data.type} onChange={(e) => set('type', e.target.value)} className="pf-zone-form__select">
            <option value="safe_area">{ __( 'Safe Area', 'snelgraveren-product-designer' ) }</option>
            <option value="upload_zone">{ __( 'Upload Zone', 'snelgraveren-product-designer' ) }</option>
          </select>
        </label>
        <label className="pf-zone-form__label">
          { __( 'Behavior', 'snelgraveren-product-designer' ) }
          <select value={data.behavior} onChange={(e) => set('behavior', e.target.value)} className="pf-zone-form__select">
            <option value="restrict">{ __( "Restrict (can't leave)", 'snelgraveren-product-designer' ) }</option>
            <option value="clip">{ __( 'Clip at boundary', 'snelgraveren-product-designer' ) }</option>
          </select>
        </label>
      </div>

      {/* Boundary Type */}
      <label className="pf-zone-form__field">
        <span>{ __( 'Boundary', 'snelgraveren-product-designer' ) }</span>
        <select
          value={data.boundary_type || 'rect'}
          onChange={(e) => set('boundary_type', e.target.value)}
        >
          <option value="rect">{ __( 'Rectangle', 'snelgraveren-product-designer' ) }</option>
          {isPremium && <option value="svg">{ __( 'SVG Shape', 'snelgraveren-product-designer' ) }</option>}
        </select>
      </label>

      {/* SVG Upload — only shown when boundary_type is 'svg' */}
      {data.boundary_type === 'svg' && (
        <div className="pf-zone-form__svg-upload">
          <div className="pf-zone-form__svg-source">
            <label className="pf-zone-form__radio">
              <input type="radio" name="svg-source" checked={svgSource === 'upload'}
                onChange={() => switchSvgSource('upload')} />
              { __( 'Upload SVG', 'snelgraveren-product-designer' ) }
            </label>
            <label className="pf-zone-form__radio">
              <input type="radio" name="svg-source" checked={svgSource === 'layers'}
                onChange={() => switchSvgSource('layers')} />
              { __( 'From layers', 'snelgraveren-product-designer' ) }
            </label>
          </div>

          {svgSource === 'upload' && (
          <>
          {data.svg_url ? (
            <div className="pf-zone-form__svg-preview">
              <img src={data.svg_url} alt={ __( 'Zone shape', 'snelgraveren-product-designer' ) } style={{ maxWidth: '100%', maxHeight: '80px' }} />
              <button type="button" onClick={() => setData((d) => {
                const next = { ...d, svg_url: '', svg_path_data: '' };
                if (onChange) onChange(next);
                return next;
              })}>
                { __( 'Remove', 'snelgraveren-product-designer' ) }
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!window.wp?.media) return;
                const frame = window.wp.media({
                  title: __( 'Select SVG Zone Shape', 'snelgraveren-product-designer' ),
                  button: { text: __( 'Use Shape', 'snelgraveren-product-designer' ) },
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
                      alert( __( 'Could not parse SVG file.', 'snelgraveren-product-designer' ) );
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
                    alert( __( 'Failed to parse SVG file.', 'snelgraveren-product-designer' ) );
                  }
                });
                frame.open();
              }}
            >
              { __( 'Upload SVG Shape', 'snelgraveren-product-designer' ) }
            </button>
          )}
          {data.svg_url && (
            <>
              <label className="pf-zone-form__field">
                <span>{ __( 'Scale', 'snelgraveren-product-designer' ) }</span>
                <input
                  type="number" step="any" min="0.1"
                  value={Math.round((data.svg_scale || 1) * 100) / 100}
                  onChange={(e) => set('svg_scale', parseFloat(e.target.value) || 1)}
                />
              </label>
              <label className="pf-zone-form__field">
                <span>{ __( 'Rotation', 'snelgraveren-product-designer' ) }</span>
                <input
                  type="number" step="1" min="0" max="360"
                  value={data.svg_rotation || 0}
                  onChange={(e) => set('svg_rotation', parseInt(e.target.value, 10) || 0)}
                />
              </label>
              <label className="pf-zone-form__field">
                <span>{ __( 'Fill Color', 'snelgraveren-product-designer' ) }</span>
                <FillColorPicker
                  value={data.svg_fill_color || '#ffffff'}
                  onChange={(color) => set('svg_fill_color', color)}
                  onClear={data.svg_fill_color ? () => set('svg_fill_color', '') : null}
                  globalConfig={globalConfig}
                />
              </label>
              <label className="pf-zone-form__check">
                <input
                  type="checkbox"
                  checked={data.svg_fill_editable || false}
                  onChange={(e) => set('svg_fill_editable', e.target.checked)}
                />
                { __( 'Customer can change fill color', 'snelgraveren-product-designer' ) }
              </label>
            </>
          )}
          </>
          )}

          {svgSource === 'layers' && (
            <div className="pf-zone-form__layer-picker">
              {eligibleLayers.length === 0 ? (
                <p className="pf-zone-form__hint">
                  { __( 'No vector layers with editable geometry on this view. Import a LightBurn file first, then reopen this form.', 'snelgraveren-product-designer' ) }
                </p>
              ) : (
                <>
                  <ul className="pf-zone-form__layer-list">
                    {eligibleLayers.map(({ layer, key }, i) => (
                      <li key={key} className="pf-zone-form__layer-item">
                        <label>
                          <input type="checkbox" checked={selectedKeys.has(key)} onChange={() => toggleLayer(key)} />
                          <img className="pf-zone-form__layer-thumb" alt=""
                            src={`data:image/svg+xml;utf8,${encodeURIComponent(layer.svg_markup)}`} />
                          <span>{ __( 'Layer', 'snelgraveren-product-designer' ) } {i + 1}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {data.svg_markup && (
                    <div className="pf-zone-form__layer-preview">
                      <img alt="" src={`data:image/svg+xml;utf8,${encodeURIComponent(data.svg_markup)}`} />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="pf-zone-form__row pf-zone-form__row--coords">
        {[['x','X'], ['y','Y'], ['width','W'], ['height','H']].map(([key, label]) => {
          const isSvgSize = data.boundary_type === 'svg' && (key === 'width' || key === 'height');
          return (
            <label key={key} className="pf-zone-form__label pf-zone-form__label--coord">
              {label}
              <input
                type="number" value={data[key]} min={key === 'width' || key === 'height' ? 1 : 0}
                onChange={(e) => set(key, Number(e.target.value))}
                readOnly={isSvgSize}
                className="pf-zone-form__input pf-zone-form__input--number"
                style={isSvgSize ? { opacity: 0.6 } : undefined}
                title={isSvgSize ? __( 'Resize the SVG on canvas or change Scale to adjust', 'snelgraveren-product-designer' ) : undefined}
              />
            </label>
          );
        })}
      </div>

      <fieldset className="pf-zone-form__fieldset">
        <legend>{ __( 'Allowed element types', 'snelgraveren-product-designer' ) }</legend>
        {['text', 'image', 'svg'].map((t) => (
          <label key={t} className="pf-zone-form__checkbox-label">
            <input
              type="checkbox"
              checked={data.allowed_types.includes(t)}
              onChange={() => toggleType(t)}
            />
            {t}
          </label>
        ))}
      </fieldset>

      {data.allowed_types.includes('text') && (() => {
        const allowedFonts = globalConfig.allowed_fonts || [];
        const allFonts = mergeCustomFonts(customFonts);
        const fontOptions = allowedFonts.length > 0
          ? allFonts.filter((f) => allowedFonts.includes(f.family))
          : allFonts;
        return (
          <div className="pf-zone-form__row">
            <label className="pf-zone-form__label">
              { __( 'Default Font', 'snelgraveren-product-designer' ) }
              <select
                value={data.defaultFontFamily || ''}
                onChange={(e) => set('defaultFontFamily', e.target.value)}
                className="pf-zone-form__select"
              >
                <option value="">{ __( 'Default (Arial)', 'snelgraveren-product-designer' ) }</option>
                {fontOptions.map((f) => (
                  <option key={f.family} value={f.family}>
                    {f.family} ({f.category})
                  </option>
                ))}
              </select>
            </label>
          </div>
        );
      })()}

      {data.type === 'upload_zone' && (
        <div className="pf-zone-form__row">
          <label className="pf-zone-form__label">
            { __( 'Mask SVG URL', 'snelgraveren-product-designer' ) }
            <input
              type="url" value={data.mask_svg_url || ''}
              onChange={(e) => set('mask_svg_url', e.target.value)}
              className="pf-zone-form__input"
              placeholder="https://…"
            />
          </label>
        </div>
      )}

      <div className="pf-zone-form__actions">
        <button type="submit" className="button button-primary">{ __( 'Save Boundary', 'snelgraveren-product-designer' ) }</button>
        <button type="button" className="button" onClick={onCancel}>{ __( 'Cancel', 'snelgraveren-product-designer' ) }</button>
      </div>
    </form>
  );
}
