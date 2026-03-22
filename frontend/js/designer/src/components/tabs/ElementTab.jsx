import React, { useState, useCallback, useEffect, useRef } from 'react';
import { __ } from '@wordpress/i18n';
import { cache as fabricCache } from 'fabric';
import useDesignerStore from '../../store/useDesignerStore';
import { alignElement } from '../../../../../../shared/js/alignElement';
import ImageFilters from '../ImageFilters';
import CurvedTextProperties from '../CurvedTextProperties';

export default function ElementTab() {
  const { selectedObject, template, snapshotView, currentViewIndex, fabricCanvasRef, zoneFillColors, setZoneFillColor } = useDesignerStore();

  const globalConfig = template?.global_config || {};
  const permissions  = globalConfig.permissions || {};
  const views = template?.views || [];
  const currentView = views[currentViewIndex];
  const zones = currentView?.zones_config || [];
  const editableZones = zones.filter((z) => z.boundary_type === 'svg' && z.svg_url && z.svg_fill_editable);

  const { type, fabricObj } = selectedObject || {};
  const perms = type ? (permissions[type] || {}) : {};

  return (
    <div className="pf-sidebar__tab-content">
      {(globalConfig.product_colors_enabled || globalConfig.colors_enabled) && editableZones.length > 0 && (
        <ZoneFillSection
          zones={zones}
          editableZones={editableZones}
          globalConfig={globalConfig}
          fabricCanvasRef={fabricCanvasRef}
          zoneFillColors={zoneFillColors}
          setZoneFillColor={setZoneFillColor}
          snapshotView={snapshotView}
          currentViewIndex={currentViewIndex}
        />
      )}

      {!selectedObject && (
        <p className="pf-element__hint">{__('Select an element to edit its properties', 'productforge')}</p>
      )}

      {selectedObject && (
        <>
          <h3 className="pf-sidebar__heading">{type.charAt(0).toUpperCase() + type.slice(1)}{__(' Properties', 'productforge')}</h3>

          {type === 'text' && (
            <TextProperties
              fabricObj={fabricObj}
              perms={perms}
              globalConfig={globalConfig}
              snapshotView={snapshotView}
              currentViewIndex={currentViewIndex}
            />
          )}

          {type === 'curved-text' && (
            <>
              <CurvedTextProperties
                fabricObj={fabricObj}
                snapshotView={snapshotView}
                currentViewIndex={currentViewIndex}
              />
              <TextProperties
                fabricObj={fabricObj}
                perms={perms}
                globalConfig={globalConfig}
                snapshotView={snapshotView}
                currentViewIndex={currentViewIndex}
              />
            </>
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

          <AlignmentButtons fabricObj={fabricObj} template={template} currentViewIndex={currentViewIndex} snapshotView={snapshotView} />

          {perms.delete !== false && (
            <button
              type="button"
              className="pf-element__delete-btn"
              onClick={() => {
                const canvas = fabricObj.canvas;
                if (canvas) {
                  canvas.remove(fabricObj);
                  canvas.discardActiveObject();
                  canvas.renderAll();
                }
              }}
            >
              {__('Delete', 'productforge')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function TextProperties({ fabricObj, perms, globalConfig, snapshotView, currentViewIndex }) {
  const [fontSize, setFontSize] = useState(fabricObj.fontSize || 24);
  const [fill, setFill]         = useState(fabricObj.fill || '#000000');
  const [bold, setBold]         = useState(fabricObj.fontWeight === 'bold');
  const [italic, setItalic]     = useState(fabricObj.fontStyle === 'italic');
  const [textAlign, setTextAlign] = useState(fabricObj.textAlign || 'left');
  const [fontFamily, setFontFamily] = useState(fabricObj.fontFamily || 'Arial');

  const update = useCallback((props) => {
    if ('fontFamily' in props) {
      fabricCache.clearFontCache(props.fontFamily);
    }
    fabricObj.set(props);
    if ('fontFamily' in props || 'fontSize' in props) {
      fabricObj.initDimensions();
      fabricObj.setCoords();
    }
    fabricObj.canvas?.renderAll();
    snapshotView(currentViewIndex, fabricObj.canvas?.toJSON(['data']));
  }, [fabricObj, snapshotView, currentViewIndex]);

  // Sync state when selected object changes
  useEffect(() => {
    setFontSize(fabricObj.fontSize || 24);
    setFill(fabricObj.fill || '#000000');
    setBold(fabricObj.fontWeight === 'bold');
    setItalic(fabricObj.fontStyle === 'italic');
    setTextAlign(fabricObj.textAlign || 'left');
    setFontFamily(fabricObj.fontFamily || 'Arial');
  }, [fabricObj]);

  const allowedFonts = globalConfig.allowed_fonts || [];
  const elementColorsEnabled = globalConfig.element_colors_enabled ?? globalConfig.colors_enabled ?? true;
  const allowedColors = globalConfig.element_allowed_colors || globalConfig.allowed_colors || [];
  const anyColor = globalConfig.element_any_color ?? globalConfig.any_color ?? false;

  return (
    <div className="pf-element__props">
      {/* Font family */}
      {perms.change_font !== false && allowedFonts.length > 0 && (
        <label className="pf-element__field">
          <span>{__('Font', 'productforge')}</span>
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
      <label className="pf-element__field">
        <span>{__('Size', 'productforge')}</span>
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
      {elementColorsEnabled && perms.recolor !== false && (
        <label className="pf-element__field">
          <span>{__('Color', 'productforge')}</span>
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
            <div className="pf-element__color-swatches">
              {allowedColors.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`pf-element__swatch${fill === c ? ' pf-element__swatch--active' : ''}`}
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
      <div className="pf-element__toggles">
        <button
          type="button"
          className={`pf-element__toggle${bold ? ' pf-element__toggle--active' : ''}`}
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
          className={`pf-element__toggle${italic ? ' pf-element__toggle--active' : ''}`}
          onClick={() => {
            const next = !italic;
            setItalic(next);
            update({ fontStyle: next ? 'italic' : 'normal' });
          }}
        >
          I
        </button>
      </div>

      {/* Text Alignment */}
      <div className="pf-element__toggles">
        {['left', 'center', 'right'].map((align) => (
          <button
            key={align}
            type="button"
            className={`pf-element__toggle${textAlign === align ? ' pf-element__toggle--active' : ''}`}
            onClick={() => {
              setTextAlign(align);
              update({ textAlign: align });
            }}
            aria-label={align}
          >
            {align === 'left' ? '⫷' : align === 'center' ? '⫶' : '⫸'}
          </button>
        ))}
      </div>
    </div>
  );
}

function AlignmentButtons({ fabricObj, template, currentViewIndex, snapshotView }) {
  const groupRef = useRef(null);
  const fabricObjRef = useRef(fabricObj);
  fabricObjRef.current = fabricObj;

  const handleAlign = useCallback((dir) => {
    const obj = fabricObjRef.current;
    if (!obj) return;
    const canvas = obj.canvas;
    const view = template?.views?.[currentViewIndex];
    const zi = obj.data?.zoneIndex;

    // Use the Fabric zone object's bounding rect for SVG boundaries.
    let bounds;
    if (zi != null && canvas) {
      const zoneObj = canvas.getObjects().find(
        (o) => o.data?.isZone && o.data?.zoneIndex === zi
      );
      if (zoneObj) {
        const r = zoneObj.getBoundingRect();
        bounds = { x: r.left, y: r.top, width: r.width, height: r.height };
      }
    }
    if (!bounds) {
      const zones = view?.zones_config || [];
      const zone = (zi != null && zones[zi]) ? zones[zi] : null;
      bounds = zone || { x: 0, y: 0, width: view?.canvas_width || 800, height: view?.canvas_height || 600 };
    }

    alignElement(obj, dir, bounds);
    canvas?.renderAll();
    snapshotView(currentViewIndex, canvas?.toJSON(['data']));
  }, [template, currentViewIndex, snapshotView]);

  useEffect(() => {
    const el = groupRef.current;
    if (!el) return;
    const onMouseDown = (e) => {
      const dir = e.target.dataset?.align;
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation();
      handleAlign(dir);
    };
    el.addEventListener('mousedown', onMouseDown, true);
    return () => el.removeEventListener('mousedown', onMouseDown, true);
  }, [handleAlign]);

  const dirs = [
    ['left', '⬅', __('Align left', 'productforge')],
    ['center', '↔', __('Align center', 'productforge')],
    ['right', '➡', __('Align right', 'productforge')],
    ['top', '⬆', __('Align top', 'productforge')],
    ['middle', '↕', __('Align middle', 'productforge')],
    ['bottom', '⬇', __('Align bottom', 'productforge')],
  ];

  return (
    <div className="pf-element__align">
      <span className="pf-element__align-label">{__('Align', 'productforge')}</span>
      <div className="pf-element__align-btns" ref={groupRef}>
        {dirs.map(([dir, icon, title]) => (
          <button key={dir} type="button" className="pf-element__align-btn" data-align={dir} title={title}>{icon}</button>
        ))}
      </div>
    </div>
  );
}

function ImageProperties({ fabricObj, type, perms, globalConfig, snapshotView, currentViewIndex }) {
  const scalePercent = Math.round((fabricObj.scaleX || 1) * 100);

  const elementColorsEnabled = globalConfig.element_colors_enabled ?? globalConfig.colors_enabled ?? true;
  const allowedColors = globalConfig.element_allowed_colors || globalConfig.allowed_colors || [];
  const anyColor = globalConfig.element_any_color ?? globalConfig.any_color ?? false;
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
      snapshotView(currentViewIndex, fabricObj.canvas?.toJSON(['data']));
    } catch {
      // Fallback: just set fill (works for some SVG types)
      fabricObj.set({ fill: color });
      fabricObj.canvas?.renderAll();
      snapshotView(currentViewIndex, fabricObj.canvas?.toJSON(['data']));
    }
  }, [fabricObj, snapshotView, currentViewIndex]);

  return (
    <div className="pf-element__props">
      <div className="pf-element__field">
        <span>Scale</span>
        <span>{scalePercent}%</span>
      </div>

      {/* SVG recolor */}
      {type === 'svg' && elementColorsEnabled && perms.recolor !== false && !fabricObj.data?.clipartNoRecolor && (
        <label className="pf-element__field">
          <span>{__('Tint Color', 'productforge')}</span>
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
            <div className="pf-element__color-swatches">
              {allowedColors.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`pf-element__swatch${fill === c ? ' pf-element__swatch--active' : ''}`}
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

      {/* Image filters */}
      {type === 'image' && globalConfig.filters_enabled && (
        <ImageFilters
          fabricObj={fabricObj}
          allowedFilters={globalConfig.allowed_filters || ['Brightness', 'Contrast', 'Saturation', 'Grayscale', 'Sepia']}
          snapshotView={snapshotView}
          currentViewIndex={currentViewIndex}
        />
      )}
    </div>
  );
}

function ZoneFillSection({ zones, editableZones, globalConfig, fabricCanvasRef, zoneFillColors, setZoneFillColor, snapshotView, currentViewIndex }) {
  const allowedColors = globalConfig.product_allowed_colors || globalConfig.allowed_colors || [];
  const anyColor = globalConfig.product_any_color ?? globalConfig.any_color ?? false;
  const isSolid = globalConfig.solid_color || false;

  const applyColor = useCallback((zoneIndex, color) => {
    // Update current canvas
    const canvas = fabricCanvasRef;
    if (!canvas) return;
    canvas.getObjects().forEach((obj) => {
      if (obj.data?.isZoneOverlay) {
        if (obj.getObjects) {
          obj.getObjects().forEach((c) => c.set({ fill: color }));
        }
        obj.set({ fill: color });
        obj.dirty = true;
      }
    });
    canvas.renderAll();
    snapshotView(currentViewIndex, canvas.toJSON(['data']));

    setZoneFillColor(zoneIndex, color);

    // For solid color products: update snapshots of other views too
    if (isSolid) {
      useDesignerStore.getState().setSolidFillColor(color);
      const snapshots = useDesignerStore.getState().canvasSnapshots;
      Object.entries(snapshots).forEach(([viewIdx, snap]) => {
        if (Number(viewIdx) === currentViewIndex || !snap?.objects) return;
        const updated = {
          ...snap,
          objects: snap.objects.map((obj) => {
            // Only recolor zone overlay groups, not clip-art or other groups
            if ((obj.type === 'Group' || obj.type === 'group') && obj.data?.isZoneOverlay) {
              return {
                ...obj,
                fill: color,
                objects: (obj.objects || []).map((c) => ({ ...c, fill: color })),
              };
            }
            return obj;
          }),
        };
        useDesignerStore.getState().snapshotView(Number(viewIdx), updated);
      });
    }
  }, [fabricCanvasRef, snapshotView, currentViewIndex, isSolid, setZoneFillColor]);

  // For solid color: use the shared color across all zones
  const solidColor = useDesignerStore.getState().solidFillColor;

  return (
    <div className="pf-zone-fill">
      <h3 className="pf-sidebar__heading">{__('Product Color', 'productforge')}</h3>
      {editableZones.map((zone) => {
        const zoneIndex = zones.indexOf(zone);
        const currentColor = (isSolid && solidColor) ? solidColor : (zoneFillColors[zoneIndex] || zone.svg_fill_color || '#ffffff');
        return (
          <label key={zoneIndex} className="pf-element__field">
            {!isSolid && <span>{zone.name || `Zone ${zoneIndex + 1}`}</span>}
            {!anyColor && allowedColors.length > 0 ? (
              <div className="pf-element__color-swatches">
                {allowedColors.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={`pf-element__swatch${currentColor === c ? ' pf-element__swatch--active' : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={() => applyColor(zoneIndex, c)}
                  />
                ))}
              </div>
            ) : (
              <input
                type="color"
                value={currentColor}
                onChange={(e) => applyColor(zoneIndex, e.target.value)}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
