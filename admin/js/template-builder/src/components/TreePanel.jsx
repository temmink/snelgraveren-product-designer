import React, { useState, useCallback } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import useTemplateStore from '../store/useTemplateStore';
import TreeNode from './TreeNode';
import ZoneForm from './ZoneForm';

export default function TreePanel() {
  const {
    views, currentViewIndex,
    addZone, updateZone, removeZone, reorderZone,
    addLayer, updateLayer, removeLayer, moveLayer,
  } = useTemplateStore();

  const [selectedNode, setSelectedNode] = useState(null);
  const [isAddingZone, setIsAddingZone] = useState(false);
  const [addingLayerToZone, setAddingLayerToZone] = useState(null);
  const [expandedZones, setExpandedZones] = useState({});

  const currentView = views[currentViewIndex];
  const zones = currentView?.zones_config || [];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const toggleExpanded = (key) => {
    setExpandedZones((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSelect = useCallback((node, nodeType) => {
    setSelectedNode({ node, nodeType });
  }, []);

  const handleAction = useCallback((action, node, zoneIndex, layerIndex) => {
    switch (action) {
      case 'add-layer':
        setAddingLayerToZone(zoneIndex);
        break;
      case 'toggle-visibility':
        if (layerIndex != null) {
          updateLayer(currentViewIndex, zoneIndex, layerIndex, { visible: node.visible === false });
        } else {
          updateZone(currentViewIndex, zoneIndex, { visible: node.visible === false });
        }
        break;
      case 'toggle-lock':
        if (layerIndex != null) {
          updateLayer(currentViewIndex, zoneIndex, layerIndex, { locked: !node.locked });
        } else {
          updateZone(currentViewIndex, zoneIndex, { locked: !node.locked });
        }
        break;
      case 'delete':
        if (layerIndex != null) {
          removeLayer(currentViewIndex, zoneIndex, layerIndex);
        } else {
          removeZone(currentViewIndex, zoneIndex);
        }
        setSelectedNode(null);
        break;
    }
  }, [currentViewIndex, updateZone, removeZone, updateLayer, removeLayer]);

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;

    // Check if dragging a zone (zone reordering).
    const fromZoneIdx = zones.findIndex((z) => z._key === active.id);
    const toZoneIdx = zones.findIndex((z) => z._key === over.id);
    if (fromZoneIdx >= 0 && toZoneIdx >= 0) {
      reorderZone(currentViewIndex, fromZoneIdx, toZoneIdx);
      return;
    }

    // Otherwise, dragging a layer.
    for (let zi = 0; zi < zones.length; zi++) {
      const layers = zones[zi].layers || [];
      const fromIdx = layers.findIndex((l) => l._key === active.id);
      if (fromIdx < 0) continue;

      for (let tzi = 0; tzi < zones.length; tzi++) {
        const tLayers = zones[tzi].layers || [];
        const toIdx = tLayers.findIndex((l) => l._key === over.id);
        if (toIdx < 0) continue;

        // Check allowed_types compatibility.
        const layer = layers[fromIdx];
        const targetZone = zones[tzi];
        if (!(targetZone.allowed_types || []).includes(layer.type)) return;

        moveLayer(currentViewIndex, zi, fromIdx, tzi, toIdx);
        return;
      }
    }
  }, [zones, currentViewIndex, moveLayer, reorderZone]);

  const handleAddLayer = useCallback((zoneIndex, layerData) => {
    addLayer(currentViewIndex, zoneIndex, layerData);
    setAddingLayerToZone(null);
  }, [currentViewIndex, addLayer]);

  // Collect all sortable IDs: zone _keys + layer _keys.
  const allSortableKeys = [
    ...zones.map((z) => z._key),
    ...zones.flatMap((z) => (z.layers || []).map((l) => l._key)),
  ];

  return (
    <div className="pd-tree-panel">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={allSortableKeys} strategy={verticalListSortingStrategy}>
          {zones.length === 0 && (
            <p className="pd-tree-panel__empty">Add a zone first to place layers.</p>
          )}
          {zones.map((zone, zoneIndex) => {
            const isExpanded = expandedZones[zone._key] !== false; // Default expanded.
            return (
              <div key={zone._key} className="pd-tree-panel__zone-group">
                <TreeNode
                  node={zone}
                  nodeType="zone"
                  isSelected={selectedNode?.node?._key === zone._key}
                  onSelect={(n, t) => { handleSelect(n, t); toggleExpanded(zone._key); }}
                  onAction={(action, n) => handleAction(action, n, zoneIndex)}
                  depth={0}
                >
                  {isExpanded && (
                    <div className="pd-tree-panel__children">
                      {(zone.layers || []).map((layer, layerIndex) => (
                        <TreeNode
                          key={layer._key}
                          node={layer}
                          nodeType="layer"
                          isSelected={selectedNode?.node?._key === layer._key}
                          onSelect={handleSelect}
                          onAction={(action, n) => handleAction(action, n, zoneIndex, layerIndex)}
                          depth={1}
                        />
                      ))}
                      {addingLayerToZone === zoneIndex && (
                        <AddLayerInline
                          zone={zone}
                          onAdd={(data) => handleAddLayer(zoneIndex, data)}
                          onCancel={() => setAddingLayerToZone(null)}
                        />
                      )}
                    </div>
                  )}
                </TreeNode>
              </div>
            );
          })}
        </SortableContext>
      </DndContext>

      <div className="pd-tree-panel__footer">
        <button
          className="pd-tree-panel__add-zone-btn"
          onClick={() => setIsAddingZone(true)}
        >
          + Add Zone
        </button>
      </div>

      {isAddingZone && (
        <ZoneForm
          onSubmit={(zone) => { addZone(currentViewIndex, zone); setIsAddingZone(false); }}
          onCancel={() => setIsAddingZone(false)}
        />
      )}

      {selectedNode && (
        <div className="pd-tree-panel__detail">
          {selectedNode.nodeType === 'zone' && (
            <ZoneForm
              key={selectedNode.node._key}
              initialData={selectedNode.node}
              onSubmit={(patch) => {
                const idx = zones.findIndex((z) => z._key === selectedNode.node._key);
                if (idx >= 0) updateZone(currentViewIndex, idx, patch);
              }}
              onCancel={() => setSelectedNode(null)}
            />
          )}
          {selectedNode.nodeType === 'layer' && (
            <LayerDetail
              layer={selectedNode.node}
              onChange={(patch) => {
                for (let zi = 0; zi < zones.length; zi++) {
                  const li = (zones[zi].layers || []).findIndex((l) => l._key === selectedNode.node._key);
                  if (li >= 0) { updateLayer(currentViewIndex, zi, li, patch); break; }
                }
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function AddLayerInline({ zone, onAdd, onCancel }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('text');
  const allowedTypes = zone.allowed_types || ['text', 'image', 'svg'];

  return (
    <div className="pd-tree-panel__add-layer" style={{ paddingLeft: '32px' }}>
      <input
        type="text"
        placeholder="Layer name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <select value={type} onChange={(e) => setType(e.target.value)}>
        {allowedTypes.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <button onClick={() => onAdd({ name: name || type, type, locked: false, visible: true, text: type === 'text' ? 'Text' : '', fontSize: 24, fontFamily: 'Arial', fill: '#000000', left: zone.x + 20, top: zone.y + 20 })}>
        Add
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}

function LayerDetail({ layer, onChange }) {
  if (layer.type === 'text') {
    return (
      <div className="pd-tree-panel__layer-detail">
        <h4>Text Properties</h4>
        <label>
          Text
          <input type="text" value={layer.text || ''} onChange={(e) => onChange({ text: e.target.value })} />
        </label>
        <label>
          Font Size
          <input type="number" min="8" max="200" value={layer.fontSize || 24} onChange={(e) => onChange({ fontSize: parseInt(e.target.value, 10) || 24 })} />
        </label>
        <label>
          Font Family
          <input type="text" value={layer.fontFamily || 'Arial'} onChange={(e) => onChange({ fontFamily: e.target.value })} />
        </label>
        <label>
          Color
          <input type="color" value={layer.fill || '#000000'} onChange={(e) => onChange({ fill: e.target.value })} />
        </label>
        <label>
          X
          <input type="number" value={layer.left || 0} onChange={(e) => onChange({ left: parseInt(e.target.value, 10) || 0 })} />
        </label>
        <label>
          Y
          <input type="number" value={layer.top || 0} onChange={(e) => onChange({ top: parseInt(e.target.value, 10) || 0 })} />
        </label>
      </div>
    );
  }

  return (
    <div className="pd-tree-panel__layer-detail">
      <h4>{(layer.type || 'Layer').charAt(0).toUpperCase() + (layer.type || '').slice(1)} Properties</h4>
      <label>
        Name
        <input type="text" value={layer.name || ''} onChange={(e) => onChange({ name: e.target.value })} />
      </label>
    </div>
  );
}
