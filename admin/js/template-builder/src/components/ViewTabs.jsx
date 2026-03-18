import React, { useState, useRef } from 'react';
import useTemplateStore from '../store/useTemplateStore';

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
      view_name:            `View ${views.length + 1}`,
      canvas_width:         800,
      canvas_height:        600,
      background_image_url: '',
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
    setEditName(views[index].view_name);
  };

  const commitRename = (index) => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      setEditingIndex(null);
      return;
    }
    if (editName.trim()) {
      updateView(index, { view_name: editName.trim() });
    }
    setEditingIndex(null);
  };

  return (
    <div className="pd-builder__view-tabs" role="tablist" aria-label="Product views">
      {views.map((view, index) => (
        <div
          key={view.id || view._clientId}
          role="tab"
          aria-selected={index === currentViewIndex}
          className={`pd-builder__view-tab${index === currentViewIndex ? ' pd-builder__view-tab--active' : ''}`}
          onClick={() => setCurrentViewIndex(index)}
        >
          {editingIndex === index ? (
            <input
              className="pd-builder__view-tab-input"
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
                className="pd-builder__view-tab-name"
                onDoubleClick={(e) => startRename(e, index)}
                title="Double-click to rename"
              >
                {view.view_name}
              </span>
              {views.length > 1 && (
                <button
                  className="pd-builder__view-tab-remove"
                  aria-label={`Remove ${view.view_name}`}
                  disabled={isSaving}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Remove view "${view.view_name}"?`)) {
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
        className="pd-builder__view-tab-add"
        onClick={handleAdd}
        aria-label="Add view"
        disabled={isSaving}
      >
        + Add View
      </button>
    </div>
  );
}
