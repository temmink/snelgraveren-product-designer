import React, { useState } from 'react';
import useTemplateStore from '../store/useTemplateStore';
import ZoneForm from './ZoneForm';

export default function ZoneList() {
  const { views, currentViewIndex, addZone, updateZone, removeZone } = useTemplateStore();
  const [editingKey, setEditingKey] = useState(null);
  const [isAdding,   setIsAdding]   = useState(false);

  const zones = views[currentViewIndex]?.zones_config || [];

  const handleAdd = (zoneData) => {
    addZone(currentViewIndex, zoneData);
    setIsAdding(false);
  };

  const handleUpdate = (index, zoneData) => {
    updateZone(currentViewIndex, index, zoneData);
    setEditingKey(null);
  };

  return (
    <div className="pd-zones">
      <div className="pd-zones__header">
        <h3 className="pd-zones__title">Zones</h3>
        <button className="button button-secondary" onClick={() => { setIsAdding(true); setEditingKey(null); }}>
          Add Zone
        </button>
      </div>

      {isAdding && (
        <ZoneForm onSubmit={handleAdd} onCancel={() => setIsAdding(false)} />
      )}

      {zones.length === 0 && !isAdding && (
        <p className="pd-zones__empty">
          No zones defined. Draw on the canvas or click "Add Zone" to add one manually.
        </p>
      )}

      <ul className="pd-zones__list">
        {zones.map((zone, index) => (
          <li key={zone._key || index} className="pd-zone-item">
            {editingKey === (zone._key || index) ? (
              <ZoneForm
                initialData={zone}
                onSubmit={(data) => handleUpdate(index, data)}
                onCancel={() => setEditingKey(null)}
              />
            ) : (
              <div className="pd-zone-item__row">
                <div className="pd-zone-item__info">
                  <strong>{zone.name}</strong>
                  <span className="pd-zone-item__meta">
                    {zone.type} · {zone.x},{zone.y} · {zone.width}×{zone.height}px
                  </span>
                  <span className="pd-zone-item__types">
                    {(zone.allowed_types || []).join(', ')}
                  </span>
                </div>
                <div className="pd-zone-item__actions">
                  <button
                    className="button button-small"
                    onClick={() => { setEditingKey(zone._key || index); setIsAdding(false); }}
                  >
                    Edit
                  </button>
                  <button
                    className="button button-small pd-btn--danger"
                    onClick={() => {
                      if (window.confirm(`Delete zone "${zone.name}"?`)) removeZone(currentViewIndex, index);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
