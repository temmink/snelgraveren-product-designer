import React, { useState, useRef } from 'react';
import { __ } from '@wordpress/i18n';
import useTemplateStore from '../store/useTemplateStore';

const isPremium = window.sgpdTemplateBuilder?.isPremium;

export default function ViewTabs() {
  const {
    views, currentViewIndex, isSaving,
    setCurrentViewIndex, addView, removeView, updateView,
  } = useTemplateStore();

  const [editingIndex, setEditingIndex] = useState(null);
  const [editName,     setEditName]     = useState('');
  const cancelledRef = useRef(false);

  const handleAdd = () => {
    addView({
      /* translators: %d is the view number */
      name:            `${ __( 'View', 'snelgraveren-product-designer' ) } ${views.length + 1}`,
      canvas_width:         800,
      canvas_height:        600,
      background_url: '',
      zones_config:         [],
      layers_config:        [],
      permissions:          {},
      sort_order:           views.length,
    });
  };

  const startRename = (e, index) => {
    if (isSaving) return;
    e.stopPropagation();
    cancelledRef.current = false;
    setEditingIndex(index);
    setEditName(views[index].name);
  };

  const commitRename = (index) => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      setEditingIndex(null);
      return;
    }
    if (editName.trim()) {
      updateView(index, { name: editName.trim() });
    }
    setEditingIndex(null);
  };

  // Real-world physical width of the current view, in mm. Used to export at true
  // scale (SVG mm units / PDF page size). The height is derived from the canvas
  // aspect ratio, shown as a hint, so the export is never distorted. 0 = unset
  // (export falls back to the 96-DPI pixel assumption).
  const currentView = views[currentViewIndex];
  const widthMm = Number(currentView?.width_mm) || 0;
  const canvasW = currentView?.canvas_width || 800;
  const canvasH = currentView?.canvas_height || 600;
  const derivedHeightMm = widthMm > 0
    ? Math.round((widthMm * canvasH / canvasW) * 100) / 100
    : 0;

  return (
    <>
    <div className="pf-builder__view-tabs" role="tablist" aria-label="Product views">
      {views.map((view, index) => (
        <div
          key={view.id || view._clientId}
          role="tab"
          aria-selected={index === currentViewIndex}
          className={`pf-builder__view-tab${index === currentViewIndex ? ' pf-builder__view-tab--active' : ''}`}
          onClick={() => setCurrentViewIndex(index)}
        >
          {editingIndex === index ? (
            <input
              className="pf-builder__view-tab-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => commitRename(index)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(index);
                if (e.key === 'Escape') {
                  cancelledRef.current = true;
                  setEditingIndex(null);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          ) : (
            <>
              <span
                className="pf-builder__view-tab-name"
                onDoubleClick={(e) => startRename(e, index)}
                title={ __( 'Double-click to rename', 'snelgraveren-product-designer' ) }
              >
                {view.name}
              </span>
              {views.length > 1 && (
                <button
                  className="pf-builder__view-tab-remove"
                  aria-label={ `${ __( 'Remove', 'snelgraveren-product-designer' ) } ${view.name}` }
                  disabled={isSaving}
                  onClick={(e) => {
                    e.stopPropagation();
                    /* translators: %s is the view name */
                    if (window.confirm( `${ __( 'Remove view', 'snelgraveren-product-designer' ) } "${view.name}"?` )) {
                      removeView(index);
                    }
                  }}
                >
                  ×
                </button>
              )}
            </>
          )}
        </div>
      ))}
      <button
        className="pf-builder__view-tab-add"
        onClick={handleAdd}
        aria-label={ __( 'Add view', 'snelgraveren-product-designer' ) }
        disabled={isSaving || (!isPremium && views.length >= 1)}
        title={!isPremium && views.length >= 1 ? __( 'Multiple views require Pro', 'snelgraveren-product-designer' ) : ''}
      >
        { __( '+ Add View', 'snelgraveren-product-designer' ) }
        {!isPremium && views.length >= 1 && <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>Pro</span>}
      </button>
    </div>

    {currentView && (
      <div
        className="pf-builder__view-size"
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', flexWrap: 'wrap' }}
      >
        <label style={{ fontSize: 12, fontWeight: 600, color: '#1e1e1e' }}>
          { __( 'Real width (mm)', 'snelgraveren-product-designer' ) }
        </label>
        <input
          type="number"
          min="0"
          step="0.1"
          value={widthMm || ''}
          placeholder="0"
          disabled={isSaving}
          onChange={(e) => updateView(currentViewIndex, { width_mm: parseFloat(e.target.value) || 0 })}
          style={{ width: 90, color: '#1e1e1e' }}
        />
        <span style={{ fontSize: 12, color: '#757575' }}>
          {widthMm > 0
            /* translators: %s is the derived height in millimetres */
            ? `${ __( 'Height follows canvas:', 'snelgraveren-product-designer' ) } ${derivedHeightMm} mm`
            : __( 'Empty = export uses the 96-DPI pixel size', 'snelgraveren-product-designer' )}
        </span>
      </div>
    )}
    </>
  );
}
