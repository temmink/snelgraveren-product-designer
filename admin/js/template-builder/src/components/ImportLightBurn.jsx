import React, { useRef, useState } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import useTemplateStore from '../store/useTemplateStore';
import { parseLbrn, PX_PER_MM } from '../utils/lbrnParser';
import { AVAILABLE_FONTS } from '../utils/fonts';
import { displayCanvasSize } from '../utils/displayCanvasSize';
import { importedContainerZone } from '../utils/importedZone';
import { uploadDataUrlToMedia } from '../api/mediaApi';

const isPremium = window.sgpdTemplateBuilder?.isPremium;

/**
 * Pro-gated "Import LightBurn" button for the Template Builder.
 *
 * Parses a .lbrn/.lbrn2 project file client-side (utils/lbrnParser.js) and pushes
 * the resulting text/svg layer descriptors into the currently selected view. A
 * full-canvas container zone is created only when the view has none yet, and it
 * claims no customer element types (utils/importedZone.js explains why);
 * existing zones are left untouched. The view's width_mm is set from the parsed physical width
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
      const { layers, widthMm, heightMm, warnings } = parseLbrn(xml, {
        availableFonts: AVAILABLE_FONTS.map((f) => f.family),
      });

      if (!layers.length) {
        setStatus( __( 'No importable shapes found.', 'snelgraveren-product-designer' ) );
        return;
      }

      // Bitmaps arrive as base64 from the .lbrn2 file. Upload each one to the
      // media library and swap in the URL — a multi-hundred-kilobyte data URI
      // in zones_config would be read on every designer page load, and Fabric
      // JSON must never carry data URIs.
      let bitmapNo = 0;
      const uploaded = [];
      for (const layer of layers) {
        if (layer.type !== 'image' || !layer.dataUrl) { uploaded.push(layer); continue; }
        bitmapNo += 1;
        try {
          const src = await uploadDataUrlToMedia(
            layer.dataUrl,
            `lightburn-bitmap-${Date.now()}-${bitmapNo}.png`
          );
          const { dataUrl, ...rest } = layer;
          uploaded.push({
            ...rest,
            src,
            name: sprintf( __( 'Bitmap %d', 'snelgraveren-product-designer' ), bitmapNo ),
            locked: true,          // background reference art, not customer content
            visible: true,
            opacity: 1,
            exclude_from_export: true,
            template_art: true,    // keeps it out of both price counters
          });
        } catch (err) {
          // Skip this bitmap only — the vector import must still complete.
          warnings.push(
            sprintf( __( 'Could not upload a bitmap image: %s', 'snelgraveren-product-designer' ), err.message )
          );
        }
      }

      // The parser lays the design out at its physical extent (mm × working
      // resolution) — a 37 mm tag is only ~141 px, tiny on screen. Scale the
      // on-screen pixels so the design's larger side hits a comfortable working
      // size (fit-to-target: enlarges small designs, shrinks oversized ones).
      // width_mm keeps the TRUE physical size, so the export stays true-scale —
      // only the editor/preview pixels change.
      //
      // displayCanvasSize picks the integer pixel pair, because the canvas
      // ASPECT RATIO is what the export turns back into millimetres of height
      // (height_mm = width_mm × h_px / w_px). Rounding a fixed 600 px long
      // edge reported this file's true 193.00 mm as 193.33 mm.
      const natW = Math.max(1, widthMm * PX_PER_MM);
      const natH = Math.max(1, heightMm * PX_PER_MM);
      const { width: canvasW, height: canvasH, scale: fit } = displayCanvasSize(natW, natH);
      const r = (v) => Math.round(v * 100) / 100;
      // Scales get 6 decimals, not r()'s 2 — same reasoning as nScale() in
      // lbrnParser: a scale MULTIPLIES the source pixel count, so its absolute
      // error grows with the image. On a 400 mm design from a 2400 px PNG the
      // composed factor is ~0.3333; storing 0.33 renders it at ~396 mm, and
      // the vector layers (which round independently) then no longer register
      // with the bitmap they are supposed to align to.
      const rScale = (v) => parseFloat(Number(v).toFixed(6));

      // Name svg layers so the tree panel is navigable (a 40-shape import
      // otherwise reads "svg, svg, svg…"): merged LightBurn groups become
      // "Group N (x shapes)", loose shapes "Shape N". Text layers keep their
      // own text as the tree label.
      let groupNo = 0;
      let shapeNo = 0;
      const namedLayers = uploaded.map((l) => {
        if (l.type !== 'svg') return l;
        if ((l.pathCount || 1) > 1) {
          groupNo += 1;
          return { ...l, name: sprintf( __( 'Group %1$d (%2$d shapes)', 'snelgraveren-product-designer' ), groupNo, l.pathCount ) };
        }
        shapeNo += 1;
        return { ...l, name: sprintf( __( 'Shape %d', 'snelgraveren-product-designer' ), shapeNo ) };
      });

      // Apply the display scale uniformly to every layer (position + size), so
      // relative positions are preserved exactly.
      const scaledLayers = namedLayers.map((l) => (
        l.type === 'text'
          ? { ...l, left: r(l.left * fit), top: r(l.top * fit), fontSize: r(l.fontSize * fit) }
          : { ...l, left: r(l.left * fit), top: r(l.top * fit),
              scaleX: rScale((l.scaleX || 1) * fit), scaleY: rScale((l.scaleY || 1) * fit) }
      ));

      // Read the store fresh HERE, not at the top of the handler: everything
      // above this point awaits (file read, one media upload per bitmap —
      // seconds on a multi-MB PNG), and a snapshot taken before an await goes
      // stale just as surely as a render-time closure value does (documented
      // Zustand gotcha; see handleUseAsBoundary in Canvas.jsx). A merchant who
      // adds a zone while a bitmap uploads would otherwise get a second
      // full-canvas Imported zone stacked on the one they just made.
      const { views, currentViewIndex } = useTemplateStore.getState();

      // Target the current view's first zone. Create a design-sized container
      // zone only if the view has none yet — existing zones (with their own
      // allowed_types / permissions) are left as the admin configured them.
      // The container holds the artwork and claims NO customer element types;
      // see utils/importedZone.js for the bug that taught us why.
      const view = views[currentViewIndex];
      const zoneIndex = 0;
      if (!view.zones_config || view.zones_config.length === 0) {
        addZone(currentViewIndex, importedContainerZone({ width: canvasW, height: canvasH }));
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
