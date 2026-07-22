import React, { useRef, useState } from 'react';
import { __ } from '@wordpress/i18n';
import useTemplateStore from '../store/useTemplateStore';
import { parseLbrn, PX_PER_MM } from '../utils/lbrnParser';
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
  const { addZone, addLayer, updateView } = useTemplateStore();

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
      // Read fresh — this handler is async, so render-time closure values for
      // views/currentViewIndex can be stale by the time the file is read
      // (documented Zustand gotcha; see handleUseAsBoundary in Canvas.jsx).
      const { views, currentViewIndex } = useTemplateStore.getState();
      const { layers, widthMm, heightMm, warnings } = parseLbrn(xml, {
        availableFonts: AVAILABLE_FONTS.map((f) => f.family),
      });

      if (!layers.length) {
        setStatus( __( 'No importable shapes found.', 'snelgraveren-product-designer' ) );
        return;
      }

      // The parser lays the design out at its physical extent (mm × working
      // resolution) — a 37 mm tag is only ~141 px, tiny on screen. Scale the
      // on-screen pixels so the design's larger side hits a comfortable working
      // size (fit-to-target: enlarges small designs, shrinks oversized ones).
      // width_mm keeps the TRUE physical size, so the export stays true-scale —
      // only the editor/preview pixels change.
      const DISPLAY_TARGET_PX = 600;
      const natW = Math.max(1, widthMm * PX_PER_MM);
      const natH = Math.max(1, heightMm * PX_PER_MM);
      const fit = DISPLAY_TARGET_PX / Math.max(natW, natH);
      const r = (v) => Math.round(v * 100) / 100;

      const canvasW = Math.max(1, Math.round(natW * fit));
      const canvasH = Math.max(1, Math.round(natH * fit));

      // Apply the display scale uniformly to every layer (position + size), so
      // relative positions are preserved exactly.
      const scaledLayers = layers.map((l) => (
        l.type === 'text'
          ? { ...l, left: r(l.left * fit), top: r(l.top * fit), fontSize: r(l.fontSize * fit) }
          : { ...l, left: r(l.left * fit), top: r(l.top * fit),
              scaleX: r((l.scaleX || 1) * fit), scaleY: r((l.scaleY || 1) * fit) }
      ));

      // Target the current view's first zone. Create a design-sized zone only if
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
          width: canvasW,
          height: canvasH,
          allowed_types: ['text', 'image', 'svg'],
        });
      }

      scaledLayers.forEach((layer) => addLayer(currentViewIndex, zoneIndex, layer));
      updateView(currentViewIndex, {
        canvas_width: canvasW,
        canvas_height: canvasH,
        ...(widthMm > 0 ? { width_mm: widthMm } : {}),
      });

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
