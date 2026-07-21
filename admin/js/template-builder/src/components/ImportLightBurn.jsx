import React, { useRef, useState } from 'react';
import { __ } from '@wordpress/i18n';
import useTemplateStore from '../store/useTemplateStore';
import { parseLbrn } from '../utils/lbrnParser';
import { AVAILABLE_FONTS } from '../utils/fonts';

const isPremium = window.sgpdTemplateBuilder?.isPremium;

/**
 * Pro-gated "Import LightBurn" button for the Template Builder.
 *
 * Parses a .lbrn/.lbrn2 project file client-side (utils/lbrnParser.js) and pushes
 * the resulting text/svg layer descriptors into the currently selected view. A
 * full-canvas zone is created only when the view has none yet; existing zones
 * are left untouched. The view's width_mm is set from the parsed physical width
 * so the export pipeline (SVG mm units / PDF page size) renders at true scale.
 */
export default function ImportLightBurn() {
  const inputRef = useRef(null);
  const [status, setStatus] = useState('');
  const { views, currentViewIndex, addZone, addLayer, updateView } = useTemplateStore();

  if (!isPremium) {
    return (
      <span style={{ fontSize: 12, opacity: 0.7 }}>
        { __( 'Import LightBurn (Pro)', 'snelgraveren-product-designer' ) }
      </span>
    );
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus( __( 'Importing…', 'snelgraveren-product-designer' ) );
    try {
      const xml = await file.text();
      const { layers, widthMm, warnings } = parseLbrn(xml, {
        availableFonts: AVAILABLE_FONTS.map((f) => f.family),
      });

      if (!layers.length) {
        setStatus( __( 'No importable shapes found.', 'snelgraveren-product-designer' ) );
        return;
      }

      // Target the current view's first zone. Create a full-canvas zone only if
      // the view has none yet — existing zones (with their own allowed_types /
      // permissions) are left as the admin configured them.
      const view = views[currentViewIndex];
      const zoneIndex = 0;
      if (!view.zones_config || view.zones_config.length === 0) {
        addZone(currentViewIndex, {
          name: __( 'Imported', 'snelgraveren-product-designer' ),
          type: 'safe_area',
          behavior: 'restrict',
          boundary_type: 'rect',
          x: 0,
          y: 0,
          width: view.canvas_width || 800,
          height: view.canvas_height || 600,
          allowed_types: ['text', 'image', 'svg'],
        });
      }

      layers.forEach((layer) => addLayer(currentViewIndex, zoneIndex, layer));
      if (widthMm > 0) updateView(currentViewIndex, { width_mm: widthMm });

      const msg = warnings.length
        ? __( 'Imported with warnings: ', 'snelgraveren-product-designer' ) + warnings.join(' ')
        : __( 'Imported successfully.', 'snelgraveren-product-designer' );
      setStatus(msg);
    } catch (err) {
      setStatus( __( 'Import failed: ', 'snelgraveren-product-designer' ) + err.message );
    } finally {
      e.target.value = '';
    }
  };

  return (
    <span className="pf-builder__import-lightburn">
      <button type="button" className="button" onClick={() => inputRef.current?.click()}>
        { __( 'Import LightBurn', 'snelgraveren-product-designer' ) }
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".lbrn2,.lbrn"
        style={{ display: 'none' }}
        onChange={onFile}
      />
      {status && <span style={{ marginLeft: 8, fontSize: 12 }}>{status}</span>}
    </span>
  );
}
