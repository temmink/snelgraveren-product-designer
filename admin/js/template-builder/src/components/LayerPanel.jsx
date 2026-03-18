import React, { useState } from 'react';
import useTemplateStore from '../store/useTemplateStore';

const LAYER_TYPES = ['text', 'image', 'svg'];

const emptyLayer = () => ({
  name: '', type: 'text', locked: false, visible: true,
});

export default function LayerPanel() {
  const { views, currentViewIndex, addLayer, updateLayer, removeLayer } = useTemplateStore();
  const [isAdding, setIsAdding] = useState(false);
  const [draft,    setDraft]    = useState(emptyLayer());

  const layers = views[currentViewIndex]?.layers_config || [];

  const handleAdd = () => {
    if (!draft.name.trim()) return;
    addLayer(currentViewIndex, { ...draft, name: draft.name.trim(), z_order: layers.length });
    setDraft(emptyLayer());
    setIsAdding(false);
  };

  return (
    <div className="pd-layers">
      <div className="pd-layers__header">
        <h3 className="pd-layers__title">Default Layers</h3>
        <button
          className="button button-secondary"
          onClick={() => setIsAdding(true)}
          disabled={views.length === 0}
        >
          Add Layer
        </button>
      </div>

      {isAdding && (
        <div className="pd-layer-form">
          <input
            type="text" placeholder="Layer name" value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="pd-layer-form__input"
          />
          <select
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value })}
            className="pd-layer-form__select"
          >
            {LAYER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <label className="pd-layer-form__check">
            <input type="checkbox" checked={draft.locked} onChange={(e) => setDraft({ ...draft, locked: e.target.checked })} />
            Locked
          </label>
          <div className="pd-layer-form__actions">
            <button className="button button-primary" onClick={handleAdd}>Add</button>
            <button className="button" onClick={() => { setIsAdding(false); setDraft(emptyLayer()); }}>Cancel</button>
          </div>
        </div>
      )}

      {layers.length === 0 && !isAdding && (
        <p className="pd-layers__empty">
          No default layers. Customers start with a blank canvas.
        </p>
      )}

      <ul className="pd-layers__list">
        {layers.map((layer, index) => (
          <li key={layer._key || index} className="pd-layer-item">
            <div className="pd-layer-item__info">
              <span className="pd-layer-item__name">{layer.name}</span>
              <span className="pd-layer-item__type">{layer.type}</span>
              {layer.locked  && <span className="pd-layer-item__badge">Locked</span>}
              {layer.visible === false && <span className="pd-layer-item__badge">Hidden</span>}
            </div>
            <div className="pd-layer-item__controls">
              <label title="Locked (customers cannot move/resize/delete)">
                <input
                  type="checkbox" checked={!!layer.locked}
                  onChange={(e) => updateLayer(currentViewIndex, index, { locked: e.target.checked })}
                /> Lock
              </label>
              <label title="Visible by default">
                <input
                  type="checkbox" checked={layer.visible !== false}
                  onChange={(e) => updateLayer(currentViewIndex, index, { visible: e.target.checked })}
                /> Visible
              </label>
              <button
                className="button button-small pd-btn--danger"
                onClick={() => {
                  if (window.confirm(`Delete layer "${layer.name}"?`)) removeLayer(currentViewIndex, index);
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
