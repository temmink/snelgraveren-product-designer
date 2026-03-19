import React, { useState, useCallback, useEffect } from 'react';
import { __ } from '@wordpress/i18n';
import useDesignerStore from '../../store/useDesignerStore';

export default function ElementTab() {
  const { selectedObject, template, snapshotView, currentViewIndex } = useDesignerStore();

  const globalConfig = template?.global_config || {};
  const permissions  = globalConfig.permissions || {};

  if (!selectedObject) {
    return <div className="pd-sidebar__tab-content"><p>{__('Select an element', 'product-designer')}</p></div>;
  }

  const { type, fabricObj } = selectedObject;
  const perms = permissions[type] || {};

  return (
    <div className="pd-sidebar__tab-content">
      <h3 className="pd-sidebar__heading">{type.charAt(0).toUpperCase() + type.slice(1)}{__(' Properties', 'product-designer')}</h3>

      {type === 'text' && (
        <TextProperties
          fabricObj={fabricObj}
          perms={perms}
          globalConfig={globalConfig}
          snapshotView={snapshotView}
          currentViewIndex={currentViewIndex}
        />
      )}

      {(type === 'image' || type === 'svg') && (
        <ImageProperties
          fabricObj={fabricObj}
          type={type}
          perms={perms}
          globalConfig={globalConfig}
          snapshotView={snapshotView}
          currentViewIndex={currentViewIndex}
        />
      )}

      {perms.delete !== false && (
        <button
          type="button"
          className="pd-element__delete-btn"
          onClick={() => {
            const canvas = fabricObj.canvas;
            if (canvas) {
              canvas.remove(fabricObj);
              canvas.discardActiveObject();
              canvas.renderAll();
            }
          }}
        >
          {__('Delete', 'product-designer')}
        </button>
      )}
    </div>
  );
}

function TextProperties({ fabricObj, perms, globalConfig, snapshotView, currentViewIndex }) {
  const [fontSize, setFontSize] = useState(fabricObj.fontSize || 24);
  const [fill, setFill]         = useState(fabricObj.fill || '#000000');
  const [bold, setBold]         = useState(fabricObj.fontWeight === 'bold');
  const [italic, setItalic]     = useState(fabricObj.fontStyle === 'italic');
  const [fontFamily, setFontFamily] = useState(fabricObj.fontFamily || 'Arial');

  const update = useCallback((props) => {
    fabricObj.set(props);
    fabricObj.canvas?.renderAll();
    snapshotView(currentViewIndex, fabricObj.canvas?.toJSON());
  }, [fabricObj, snapshotView, currentViewIndex]);

  // Sync state when selected object changes
  useEffect(() => {
    setFontSize(fabricObj.fontSize || 24);
    setFill(fabricObj.fill || '#000000');
    setBold(fabricObj.fontWeight === 'bold');
    setItalic(fabricObj.fontStyle === 'italic');
    setFontFamily(fabricObj.fontFamily || 'Arial');
  }, [fabricObj]);

  const allowedFonts = globalConfig.allowed_fonts || [];
  const allowedColors = globalConfig.allowed_colors || [];
  const anyColor = globalConfig.any_color || false;

  return (
    <div className="pd-element__props">
      {/* Font family */}
      {perms.change_font !== false && allowedFonts.length > 0 && (
        <label className="pd-element__field">
          <span>{__('Font', 'product-designer')}</span>
          <select
            value={fontFamily}
            onChange={(e) => {
              setFontFamily(e.target.value);
              update({ fontFamily: e.target.value });
            }}
          >
            {allowedFonts.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
      )}

      {/* Font size */}
      <label className="pd-element__field">
        <span>{__('Size', 'product-designer')}</span>
        <input
          type="number"
          min="8"
          max="200"
          value={fontSize}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10) || 24;
            setFontSize(v);
            update({ fontSize: v });
          }}
        />
      </label>

      {/* Color */}
      {perms.recolor !== false && (
        <label className="pd-element__field">
          <span>{__('Color', 'product-designer')}</span>
          {anyColor ? (
            <input
              type="color"
              value={fill}
              onChange={(e) => {
                setFill(e.target.value);
                update({ fill: e.target.value });
              }}
            />
          ) : allowedColors.length > 0 ? (
            <div className="pd-element__color-swatches">
              {allowedColors.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`pd-element__swatch${fill === c ? ' pd-element__swatch--active' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => {
                    setFill(c);
                    update({ fill: c });
                  }}
                />
              ))}
            </div>
          ) : (
            <input
              type="color"
              value={fill}
              onChange={(e) => {
                setFill(e.target.value);
                update({ fill: e.target.value });
              }}
            />
          )}
        </label>
      )}

      {/* Bold / Italic */}
      <div className="pd-element__toggles">
        <button
          type="button"
          className={`pd-element__toggle${bold ? ' pd-element__toggle--active' : ''}`}
          onClick={() => {
            const next = !bold;
            setBold(next);
            update({ fontWeight: next ? 'bold' : 'normal' });
          }}
        >
          B
        </button>
        <button
          type="button"
          className={`pd-element__toggle${italic ? ' pd-element__toggle--active' : ''}`}
          onClick={() => {
            const next = !italic;
            setItalic(next);
            update({ fontStyle: next ? 'italic' : 'normal' });
          }}
        >
          I
        </button>
      </div>
    </div>
  );
}

function ImageProperties({ fabricObj, type, perms, globalConfig, snapshotView, currentViewIndex }) {
  const scalePercent = Math.round((fabricObj.scaleX || 1) * 100);

  const allowedColors = globalConfig.allowed_colors || [];
  const anyColor = globalConfig.any_color || false;
  const [fill, setFill] = useState('');

  const applyRecolor = useCallback((color) => {
    try {
      // Dynamic import to avoid issues if filters aren't available
      const { BlendColor } = require('fabric').filters;
      if (color) {
        fabricObj.filters = [new BlendColor({ color, mode: 'tint', alpha: 1 })];
      } else {
        fabricObj.filters = [];
      }
      fabricObj.applyFilters();
      fabricObj.canvas?.renderAll();
      snapshotView(currentViewIndex, fabricObj.canvas?.toJSON());
    } catch {
      // Fallback: just set fill (works for some SVG types)
      fabricObj.set({ fill: color });
      fabricObj.canvas?.renderAll();
      snapshotView(currentViewIndex, fabricObj.canvas?.toJSON());
    }
  }, [fabricObj, snapshotView, currentViewIndex]);

  return (
    <div className="pd-element__props">
      <div className="pd-element__field">
        <span>Scale</span>
        <span>{scalePercent}%</span>
      </div>

      {/* SVG recolor */}
      {type === 'svg' && perms.recolor !== false && (
        <label className="pd-element__field">
          <span>{__('Tint Color', 'product-designer')}</span>
          {anyColor || allowedColors.length === 0 ? (
            <input
              type="color"
              value={fill || '#000000'}
              onChange={(e) => {
                setFill(e.target.value);
                applyRecolor(e.target.value);
              }}
            />
          ) : (
            <div className="pd-element__color-swatches">
              {allowedColors.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`pd-element__swatch${fill === c ? ' pd-element__swatch--active' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => {
                    setFill(c);
                    applyRecolor(c);
                  }}
                />
              ))}
            </div>
          )}
        </label>
      )}
    </div>
  );
}
