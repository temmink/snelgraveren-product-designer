import React, { useEffect, useState } from 'react';
import { __ } from '@wordpress/i18n';
import useDesignerStore from '../../store/useDesignerStore';
import { inferElementType } from '../../utils/postRestoreState';
import { isTextPlaceholder } from '../../../../../../shared/js/textPlaceholder';

/**
 * Flat list of the customer's selectable elements, topmost first. Exists
 * because canvas hit-testing is bounding-box based: where elements overlap
 * (clipart over text, a photo's transparent corner over a name), the canvas
 * click lands on whichever box is on top. This list is the way to grab the
 * one underneath.
 */

function typeLabel(type) {
  switch (type) {
    case 'text':
    case 'curved-text':
    case 'engraving-text':
      return __('Text', 'snelgraveren-product-designer');
    case 'image':
      return __('Photo', 'snelgraveren-product-designer');
    case 'svg':
      return __('Clip art', 'snelgraveren-product-designer');
    case 'drawing':
      return __('Drawing', 'snelgraveren-product-designer');
    default:
      return __('Element', 'snelgraveren-product-designer');
  }
}

function objectLabel(obj, type) {
  const text = type === 'engraving-text'
    ? String(obj.data?.engravingText ?? '')
    : String(obj.text ?? '');
  if (type === 'text' || type === 'curved-text' || type === 'engraving-text') {
    const trimmed = text.trim();
    return trimmed === '' ? __('Empty text', 'snelgraveren-product-designer') : trimmed;
  }
  return typeLabel(type);
}

/** Selectable-by-the-customer canvas objects, topmost first. */
function listLayers(canvas) {
  if (!canvas) return [];
  return canvas
    .getObjects()
    .filter((obj) => {
      if (obj.selectable === false || obj.evented === false) return false;
      if (isTextPlaceholder(obj)) return false;
      const d = obj.data || {};
      return !d.isZone && !d.isZoneOverlay && !d.isBackground;
    })
    .reverse();
}

export default function LayersTab() {
  const { fabricCanvasRef, selectedObject } = useDesignerStore();
  const [, setVersion] = useState(0);

  // The list must follow the canvas, not React state: elements are added,
  // removed, restored (undo/view switch) and re-stacked entirely inside
  // Fabric. A version bump on the relevant events re-reads getObjects().
  useEffect(() => {
    const canvas = fabricCanvasRef;
    if (!canvas) return undefined;
    const bump = () => setVersion((v) => v + 1);
    const events = ['object:added', 'object:removed', 'object:modified'];
    events.forEach((ev) => canvas.on(ev, bump));
    bump();
    return () => events.forEach((ev) => canvas.off(ev, bump));
  }, [fabricCanvasRef]);

  const canvas = fabricCanvasRef;
  const layers = listLayers(canvas);
  const activeObj = selectedObject?.fabricObj || null;

  const selectLayer = (obj) => {
    if (!canvas) return;
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
  };

  if (layers.length === 0) {
    return (
      <p className="pf-layers__empty">
        {__('No elements yet. Use the Add tab to place text or an image.', 'snelgraveren-product-designer')}
      </p>
    );
  }

  return (
    <ul className="pf-layers" aria-label={__('Elements on this design', 'snelgraveren-product-designer')}>
      {layers.map((obj, i) => {
        const type = inferElementType(obj);
        const isActive = obj === activeObj;
        return (
          <li key={`layer-${i}`}>
            <button
              type="button"
              className={`pf-layers__item${isActive ? ' pf-layers__item--active' : ''}`}
              aria-pressed={isActive}
              onClick={() => selectLayer(obj)}
            >
              <span className="pf-layers__badge">{typeLabel(type)}</span>
              <span className="pf-layers__label">{objectLabel(obj, type)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
