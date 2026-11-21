import React, { useState, useCallback, useEffect, useRef } from 'react';
import { __ } from '@wordpress/i18n';
import { cache as fabricCache } from 'fabric';
import useDesignerStore from '../../store/useDesignerStore';
import { alignElement } from '../../../../../../shared/js/alignElement';
import { governingZoneIndex } from '../../../../../../shared/js/zoneSelection';
import ImageFilters from '../ImageFilters';
import CurvedTextProperties from '../CurvedTextProperties';
import { renderHersheyText, ENGRAVING_FONTS } from '../../utils/hersheyFonts';
import { getImageQuality } from '../../utils/imageQuality';
import { resolveElementColors } from '../../utils/elementColors';
import { paintCanvasProductColor, paintOtherViewSnapshots } from '../../utils/productColor';
import { readVariantForm, hasColorOption } from '../../utils/productVariants';
import { getDesignerConfig } from '../../utils/config';
import { applyCurve } from '../../utils/curvedText';
import { fontSizeInputFloorPx, clampFontSizePx } from '../../../../../../shared/js/fontSizeLimits';
import { resolveWidthMm } from '../../../../../../shared/js/rulerTicks';

// Whole phrases, one per element type. The heading used to be assembled from
// the internal type name plus a translated " Properties" suffix, which gave
// customers "Curved-text Properties" in every language.
function elementHeading(type) {
  switch (type) {
    case 'text':           return __('Text', 'snelgraveren-product-designer');
    case 'curved-text':    return __('Curved text', 'snelgraveren-product-designer');
    case 'engraving-text': return __('Engraving text', 'snelgraveren-product-designer');
    case 'image':          return __('Photo', 'snelgraveren-product-designer');
    case 'svg':            return __('Clip art', 'snelgraveren-product-designer');
    case 'drawing':        return __('Drawing', 'snelgraveren-product-designer');
    default:               return __('Element', 'snelgraveren-product-designer');
  }
}

export default function ElementTab() {
  const { selectedObject, template, snapshotView, currentViewIndex, fabricCanvasRef, zoneFillColors, setZoneFillColor } = useDesignerStore();

  const globalConfig = template?.global_config || {};
  const permissions  = globalConfig.permissions || {};
  const views = template?.views || [];
  const currentView = views[currentViewIndex];
  const zones = currentView?.zones_config || [];
  const editableZones = zones.filter((z) => z.boundary_type === 'svg' && z.svg_url && z.svg_fill_editable);
  const { widthMm } = resolveWidthMm(views, currentViewIndex);
  // Same floor helper the merchant's TreePanel size input uses — one rule for
  // "how small may this template's text get", not one per app.
  const sizeFloor = fontSizeInputFloorPx({
    minFontSizeMm: permissions.text?.min_font_size_mm,
    canvasWidth: currentView?.canvas_width || 0,
    widthMm,
  });

  const { type, fabricObj } = selectedObject || {};
  const perms = type ? (permissions[type] || {}) : {};
  const pinned = fabricObj?.data?.templateLocked === true;
  // When the colour is one of the product's options, that option decides the
  // colour (see ProductOptions) and these swatches would be a second, rival
  // place to choose it — one that does not change what is ordered.
  const colorIsProductOption = hasColorOption(
    readVariantForm(document.querySelector('form.cart')),
    getDesignerConfig().color_names || {},
  );
  // A text the merchant pinned in place can be rewritten and restyled, not
  // moved or removed — so no position buttons and no delete for it.
  const position = selectedObject && !pinned
    ? <AlignmentButtons fabricObj={fabricObj} template={template} currentViewIndex={currentViewIndex} snapshotView={snapshotView} />
    : null;

  return (
    <div className="pf-sidebar__tab-content">
      {!colorIsProductOption && (globalConfig.product_colors_enabled || globalConfig.colors_enabled) && editableZones.length > 0 && (
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
        <p className="pf-element__hint">{__('Select an element to edit its properties', 'snelgraveren-product-designer')}</p>
      )}

      {selectedObject && (
        <>
          <h3 className="pf-sidebar__heading">{elementHeading(type)}</h3>

          {type === 'text' && (
            <TextProperties
              fabricObj={fabricObj}
              perms={perms}
              globalConfig={globalConfig}
              snapshotView={snapshotView}
              currentViewIndex={currentViewIndex}
              sizeFloor={sizeFloor}
            >
              {position}
            </TextProperties>
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
                sizeFloor={sizeFloor}
              >
                {position}
              </TextProperties>
            </>
          )}

          {type === 'engraving-text' && (
            <EngravingTextProperties
              fabricObj={fabricObj}
              snapshotView={snapshotView}
              currentViewIndex={currentViewIndex}
              sizeFloor={sizeFloor}
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

          {position && type !== 'text' && type !== 'curved-text' && (
            <details className="pf-element__more">
              <summary>{__('More options', 'snelgraveren-product-designer')}</summary>
              {position}
            </details>
          )}

          {!pinned && perms.delete !== false && (
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
              {__('Delete', 'snelgraveren-product-designer')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

const TEXT_ALIGNS = [
  ['left',   () => __('Left', 'snelgraveren-product-designer')],
  ['center', () => __('Center', 'snelgraveren-product-designer')],
  ['right',  () => __('Right', 'snelgraveren-product-designer')],
];

// Three lines of text, ragged on the side they are not aligned to.
function TextAlignIcon({ align }) {
  const x = (w) => (align === 'left' ? 2 : align === 'right' ? 18 - w : (20 - w) / 2);
  return (
    <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true" focusable="false">
      {[[16, 2], [10, 7], [14, 12]].map(([w, y]) => (
        <rect key={y} x={x(w)} y={y} width={w} height="2" rx="1" fill="currentColor" />
      ))}
    </svg>
  );
}

function TextProperties({ fabricObj, perms, globalConfig, snapshotView, currentViewIndex, sizeFloor, children }) {
  const [fontSizeText, setFontSizeText] = useState(String(fabricObj.fontSize || 24));
  const [fill, setFill]         = useState(fabricObj.fill || '#000000');
  const [bold, setBold]         = useState(fabricObj.fontWeight === 'bold');
  const [italic, setItalic]     = useState(fabricObj.fontStyle === 'italic');
  const [textAlign, setTextAlign] = useState(fabricObj.textAlign || 'left');
  const [fontFamily, setFontFamily] = useState(fabricObj.fontFamily || 'Arial');
  const [textValue, setTextValue] = useState(String(fabricObj.text ?? ''));

  // The text can also be typed on the canvas itself; keep the field in step.
  useEffect(() => {
    setTextValue(String(fabricObj.text ?? ''));
    const sync = () => setTextValue(String(fabricObj.text ?? ''));
    fabricObj.on('changed', sync);
    return () => fabricObj.off('changed', sync);
  }, [fabricObj]);

  // Typing in the field is the same edit as typing on the canvas, so it goes
  // through the same canvas events: 'text:changed' (character limit, the
  // dashed box for an emptied text) while typing, 'object:modified' when the
  // field is left (keeps the text inside its zone, records the undo step).
  const changeText = (raw) => {
    const max = perms.max_chars > 0 ? perms.max_chars : 0;
    const next = max ? raw.slice(0, max) : raw;
    if (fabricObj.isEditing) fabricObj.exitEditing();
    fabricObj.set({ text: next });
    fabricObj.initDimensions();
    fabricObj.setCoords();
    fabricObj.canvas?.fire('text:changed', { target: fabricObj });
    fabricObj.canvas?.requestRenderAll();
    setTextValue(String(fabricObj.text ?? ''));
  };

  const update = useCallback((props) => {
    if ('fontFamily' in props) {
      fabricCache.clearFontCache(props.fontFamily);
    }
    fabricObj.set(props);
    if ('fontFamily' in props || 'fontSize' in props || 'fontWeight' in props || 'fontStyle' in props) {
      fabricObj.initDimensions();
      fabricObj.setCoords();
      // Bigger or wider letters need a longer curve — see utils/curvedText.js.
      if (fabricObj.path && fabricObj.data?.curvePreset) {
        applyCurve(fabricObj, fabricObj.data.curvePreset, fabricObj.data.curveIntensity ?? 60);
      }
    }
    // The handle guard is a ratio against fontSize, so it must move with it.
    if ('fontSize' in props && sizeFloor > 8 && fabricObj.fontSize > 0) {
      fabricObj.set({
        minScaleLimit: Math.max(perms.min_scale ?? 0, sizeFloor / fabricObj.fontSize),
      });
    }
    fabricObj.canvas?.renderAll();
    snapshotView(currentViewIndex, fabricObj.canvas?.toObject(['data']));
  }, [fabricObj, snapshotView, currentViewIndex, sizeFloor, perms]);

  // Sync state when selected object changes
  useEffect(() => {
    setFontSizeText(String(fabricObj.fontSize || 24));
    setFill(fabricObj.fill || '#000000');
    setBold(fabricObj.fontWeight === 'bold');
    setItalic(fabricObj.fontStyle === 'italic');
    setTextAlign(fabricObj.textAlign || 'left');
    setFontFamily(fabricObj.fontFamily || 'Arial');
  }, [fabricObj]);

  // Sorted A→Z (case-insensitive) so the customer's font dropdown is alphabetical.
  // The font the text is set in is always in the list, also when the
  // merchant gave a template text a font outside the allowed set: a <select>
  // whose value is not among its options shows the FIRST option, i.e. the
  // name of a font the text is not in.
  const allowedFonts = [...new Set([...(globalConfig.allowed_fonts || []), fontFamily].filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }));
  const { enabled: elementColorsEnabled, allowed: allowedColors, anyColor } = resolveElementColors(globalConfig);

  return (
    <div className="pf-element__props">
      {/* The text itself. Until this field existed the only way to change a
          text was to click it on the canvas twice and type there — a route
          nothing on screen pointed to, and an awkward one on a phone. */}
      <label className="pf-element__text-field">
        <span>{__('Your text', 'snelgraveren-product-designer')}</span>
        <textarea
          rows={2}
          value={textValue}
          maxLength={perms.max_chars > 0 ? perms.max_chars : undefined}
          onFocus={(e) => { if (fabricObj.data?.sampleText) e.target.select(); }}
          onChange={(e) => changeText(e.target.value)}
          onBlur={() => fabricObj.canvas?.fire('object:modified', { target: fabricObj })}
        />
      </label>

      {/* Font family */}
      {perms.change_font !== false && allowedFonts.length > 0 && (
        <label className="pf-element__field">
          <span>{__('Font', 'snelgraveren-product-designer')}</span>
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
        <span>{__('Size', 'snelgraveren-product-designer')}</span>
        <input
          type="number"
          min={sizeFloor}
          max={Math.max(200, sizeFloor)}
          value={fontSizeText}
          onChange={(e) => {
            const raw = e.target.value;
            setFontSizeText(raw);
            // Commit live while the string is a usable number; sizeFloor/max
            // clamping happens on blur so a transient value (e.g. while
            // typing a two-digit size below the floor) never gets forced
            // back into the field and mangles what the user is typing.
            const parsed = parseInt(raw, 10);
            if (raw !== '' && Number.isFinite(parsed) && parsed > 0) {
              update({ fontSize: parsed });
            }
          }}
          onBlur={(e) => {
            // Shared clamp — the merchant's TreePanel size input uses the
            // same helper, so neither app can drift below the template minimum
            // (and a minimum larger than the 200px cap still wins).
            const clamped = clampFontSizePx({
              value: e.target.value,
              floor: sizeFloor,
              max: 200,
              fallback: fabricObj.fontSize || sizeFloor,
            });
            setFontSizeText(String(clamped));
            update({ fontSize: clamped });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.target.blur();
            }
          }}
        />
      </label>

      {/* Color */}
      {elementColorsEnabled && perms.recolor !== false && (
        <label className="pf-element__field">
          <span>{__('Color', 'snelgraveren-product-designer')}</span>
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

      {/* Everything past text, font, size and colour. These were all laid
          out at once, including two rows both called "align" (one for the
          lines of the text, one for its place on the product) drawn with
          symbols nobody could read. */}
      <details className="pf-element__more">
        <summary>{__('More options', 'snelgraveren-product-designer')}</summary>

        <div className="pf-element__row">
          <span className="pf-element__row-label">{__('Style', 'snelgraveren-product-designer')}</span>
          <div className="pf-element__toggles">
            <button
              type="button"
              className={`pf-element__toggle${bold ? ' pf-element__toggle--active' : ''}`}
              aria-pressed={bold}
              title={__('Bold', 'snelgraveren-product-designer')}
              aria-label={__('Bold', 'snelgraveren-product-designer')}
              onClick={() => {
                const next = !bold;
                setBold(next);
                update({ fontWeight: next ? 'bold' : 'normal' });
              }}
            >
              <b>B</b>
            </button>
            <button
              type="button"
              className={`pf-element__toggle${italic ? ' pf-element__toggle--active' : ''}`}
              aria-pressed={italic}
              title={__('Italic', 'snelgraveren-product-designer')}
              aria-label={__('Italic', 'snelgraveren-product-designer')}
              onClick={() => {
                const next = !italic;
                setItalic(next);
                update({ fontStyle: next ? 'italic' : 'normal' });
              }}
            >
              <i>I</i>
            </button>
          </div>
        </div>

        <div className="pf-element__row">
          <span className="pf-element__row-label">{__('Text Align', 'snelgraveren-product-designer')}</span>
          <div className="pf-element__toggles">
            {TEXT_ALIGNS.map(([align, label]) => (
              <button
                key={align}
                type="button"
                className={`pf-element__toggle${textAlign === align ? ' pf-element__toggle--active' : ''}`}
                aria-pressed={textAlign === align}
                title={label()}
                aria-label={label()}
                onClick={() => {
                  setTextAlign(align);
                  update({ textAlign: align });
                }}
              >
                <TextAlignIcon align={align} />
              </button>
            ))}
          </div>
        </div>

        {children}
      </details>
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
    // Align inside the zone that governs the element, not the container that
    // merely holds it (shared/js/zoneSelection.js#governingZoneIndex).
    const zi = obj.data?.templateLocked === true
      ? obj.data?.zoneIndex
      : governingZoneIndex(view?.zones_config || [], obj.data?.zoneIndex, obj.data?.elementType);

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
    snapshotView(currentViewIndex, canvas?.toObject(['data']));
  }, [template, currentViewIndex, snapshotView]);

  useEffect(() => {
    const el = groupRef.current;
    if (!el) return;
    const onMouseDown = (e) => {
      const dir = e.target.closest?.('[data-align]')?.dataset?.align;
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation();
      handleAlign(dir);
    };
    el.addEventListener('mousedown', onMouseDown, true);
    return () => el.removeEventListener('mousedown', onMouseDown, true);
  }, [handleAlign]);

  const dirs = [
    ['left', '⬅', __('Align left', 'snelgraveren-product-designer')],
    ['center', '↔', __('Align center', 'snelgraveren-product-designer')],
    ['right', '➡', __('Align right', 'snelgraveren-product-designer')],
    ['top', '⬆', __('Align top', 'snelgraveren-product-designer')],
    ['middle', '↕', __('Align middle', 'snelgraveren-product-designer')],
    ['bottom', '⬇', __('Align bottom', 'snelgraveren-product-designer')],
  ];

  return (
    <div className="pf-element__align">
      <span className="pf-element__align-label">{__('Position on the product', 'snelgraveren-product-designer')}</span>
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

  const { enabled: elementColorsEnabled, allowed: allowedColors, anyColor } = resolveElementColors(globalConfig);
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
      snapshotView(currentViewIndex, fabricObj.canvas?.toObject(['data']));
    } catch {
      // Fallback: just set fill (works for some SVG types)
      fabricObj.set({ fill: color });
      fabricObj.canvas?.renderAll();
      snapshotView(currentViewIndex, fabricObj.canvas?.toObject(['data']));
    }
  }, [fabricObj, snapshotView, currentViewIndex]);

  return (
    <div className="pf-element__props">
      <div className="pf-element__field">
        <span>Scale</span>
        <span>{scalePercent}%</span>
      </div>

      {fabricObj?.type?.toLowerCase() === 'image' && getImageQuality(fabricObj) === 'upscaled' && (
        <p className="pf-element__warning">
          {__('This image is scaled beyond its resolution — the result may look blurry or pixelated. Use a larger image for a sharp result.', 'snelgraveren-product-designer')}
        </p>
      )}

      {/* SVG recolor */}
      {type === 'svg' && elementColorsEnabled && perms.recolor !== false && !fabricObj.data?.clipartNoRecolor && (
        <label className="pf-element__field">
          <span>{__('Tint Color', 'snelgraveren-product-designer')}</span>
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
    const canvas = fabricCanvasRef;
    if (!canvas) return;
    paintCanvasProductColor(canvas, color);
    snapshotView(currentViewIndex, canvas.toObject(['data']));

    setZoneFillColor(zoneIndex, color);

    // For solid color products: update snapshots of other views too
    if (isSolid) {
      useDesignerStore.getState().setSolidFillColor(color);
      paintOtherViewSnapshots(color, currentViewIndex);
    }
  }, [fabricCanvasRef, snapshotView, currentViewIndex, isSolid, setZoneFillColor]);

  // For solid color: use the shared color across all zones
  const solidColor = useDesignerStore.getState().solidFillColor;

  return (
    <div className="pf-zone-fill">
      <h3 className="pf-sidebar__heading">{__('Product Color', 'snelgraveren-product-designer')}</h3>
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

function EngravingTextProperties({ fabricObj, snapshotView, currentViewIndex, sizeFloor }) {
  const data = fabricObj.data || {};
  const [text, setText] = useState(data.engravingText || 'Your text');
  const [fontId, setFontId] = useState(data.engravingFontId || 'hershey-simplex');
  const [fontSizeText, setFontSizeText] = useState(String(data.engravingFontSize || 24));
  const [stroke, setStroke] = useState(fabricObj.stroke || '#000000');

  useEffect(() => {
    const d = fabricObj.data || {};
    setText(d.engravingText || 'Your text');
    setFontId(d.engravingFontId || 'hershey-simplex');
    setFontSizeText(String(d.engravingFontSize || 24));
    setStroke(fabricObj.stroke || '#000000');
  }, [fabricObj]);

  const rerender = useCallback((newText, newFontId, newFontSize, newStroke) => {
    const { d, width, height } = renderHersheyText(newText, newFontId, { fontSize: newFontSize });
    if (!d) return;

    const oldLeft = fabricObj.left;
    const oldTop = fabricObj.top;

    // Update path data by replacing the path array
    const tmpPath = new (fabricObj.constructor)(d, {
      left: oldLeft,
      top: oldTop,
      fill: '',
      stroke: newStroke,
      strokeWidth: fabricObj.strokeWidth || 1.5,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
    });

    // Copy path data to existing object
    fabricObj.set({
      path: tmpPath.path,
      pathOffset: tmpPath.pathOffset,
      width: tmpPath.width,
      height: tmpPath.height,
      left: oldLeft,
      top: oldTop,
      fill: '',
      stroke: newStroke,
      data: {
        ...fabricObj.data,
        engravingText: newText,
        engravingFontId: newFontId,
        engravingFontSize: newFontSize,
      },
    });
    fabricObj.setCoords();
    fabricObj.canvas?.renderAll();
    snapshotView(currentViewIndex, fabricObj.canvas?.toObject(['data']));
  }, [fabricObj, snapshotView, currentViewIndex]);

  return (
    <div className="pf-element__section">
      <label className="pf-element__label">{__('Text', 'snelgraveren-product-designer')}</label>
      <input
        type="text"
        className="pf-element__input"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          rerender(e.target.value, fontId, fabricObj.data?.engravingFontSize || 24, stroke);
        }}
      />

      <label className="pf-element__label">{__('Engraving Font', 'snelgraveren-product-designer')} <span style={{ fontSize: '10px', color: '#888', fontWeight: 'normal', marginLeft: '4px', background: '#f0f0f0', padding: '1px 5px', borderRadius: '3px' }}>{__('single-line', 'snelgraveren-product-designer')}</span></label>
      <div className="pf-element__font-picker" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {ENGRAVING_FONTS.map((f) => {
          const preview = renderHersheyText('Abc', f.id, { fontSize: 18 });
          return (
            <button
              type="button"
              key={f.id}
              onClick={() => { setFontId(f.id); rerender(text, f.id, fabricObj.data?.engravingFontSize || 24, stroke); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 8px', border: fontId === f.id ? '2px solid #2271b1' : '1px solid #ddd',
                borderRadius: '4px', background: fontId === f.id ? '#f0f7ff' : '#fff',
                cursor: 'pointer', transition: 'border-color 0.15s',
              }}
            >
              <svg
                viewBox={"0 0 " + (preview.width || 60) + " " + (preview.height || 20)}
                width={Math.min(80, preview.width || 60)}
                height={Math.min(24, preview.height || 20)}
                style={{ flexShrink: 0 }}
              >
                <path d={preview.d} fill="none" stroke="#333" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ fontSize: '11px', color: '#555' }}>{f.label}</span>
            </button>
          );
        })}
      </div>

      <label className="pf-element__label">{__('Size', 'snelgraveren-product-designer')}</label>
      <input
        type="number"
        className="pf-element__input pf-element__input--short"
        value={fontSizeText}
        min={sizeFloor}
        max={Math.max(120, sizeFloor)}
        onChange={(e) => {
          const raw = e.target.value;
          setFontSizeText(raw);
          // Commit live while usable; clamp to sizeFloor/max on blur only —
          // see the matching comment on the text-element size field above.
          const parsed = parseInt(raw, 10);
          if (raw !== '' && Number.isFinite(parsed) && parsed > 0) {
            rerender(text, fontId, parsed, stroke);
          }
        }}
        onBlur={(e) => {
          const clamped = clampFontSizePx({
            value: e.target.value,
            floor: sizeFloor,
            max: 120,
            fallback: fabricObj.data?.engravingFontSize || sizeFloor,
          });
          setFontSizeText(String(clamped));
          rerender(text, fontId, clamped, stroke);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.target.blur();
          }
        }}
      />

      <label className="pf-element__label">{__('Color', 'snelgraveren-product-designer')}</label>
      <input
        type="color"
        className="pf-element__color-input"
        value={stroke}
        onChange={(e) => {
          setStroke(e.target.value);
          rerender(text, fontId, fabricObj.data?.engravingFontSize || 24, e.target.value);
        }}
      />
    </div>
  );
}
