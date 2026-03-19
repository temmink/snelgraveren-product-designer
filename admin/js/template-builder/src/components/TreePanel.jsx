import React, { useState, useCallback } from 'react';
import { __ } from '@wordpress/i18n';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import useTemplateStore from '../store/useTemplateStore';
import TreeNode from './TreeNode';
import ZoneForm from './ZoneForm';
import { AVAILABLE_FONTS } from '../utils/fonts';

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
  const [savedMsg, setSavedMsg] = useState(false);

  const flashSaved = () => {
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2000);
  };

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
            <p className="pd-tree-panel__empty">{ __( 'Add a boundary first to place layers.', 'product-designer' ) }</p>
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
          aria-label={ __( 'Add Boundary', 'product-designer' ) }
        >
          { __( '+ Add Boundary', 'product-designer' ) }
        </button>
        {savedMsg && <span className="pd-zone-form__saved">{ __( 'Saved Boundary', 'product-designer' ) }</span>}
      </div>

      {isAddingZone && (
        <ZoneForm
          onSubmit={(zone) => { addZone(currentViewIndex, zone); setIsAddingZone(false); flashSaved(); }}
          onCancel={() => setIsAddingZone(false)}
        />
      )}

      {selectedNode && (
        <div className="pd-tree-panel__detail">
          {selectedNode.nodeType === 'zone' && (() => {
            const zoneIdx = zones.findIndex((z) => z._key === selectedNode.node._key);
            const liveZone = zoneIdx >= 0 ? zones[zoneIdx] : selectedNode.node;
            return (
              <ZoneForm
                key={selectedNode.node._key}
                initialData={liveZone}
                onChange={(patch) => {
                  if (zoneIdx >= 0) updateZone(currentViewIndex, zoneIdx, patch);
                }}
                onSubmit={(patch) => {
                  if (zoneIdx >= 0) { updateZone(currentViewIndex, zoneIdx, patch); flashSaved(); }
                }}
                onCancel={() => setSelectedNode(null)}
              />
            );
          })()}
          {selectedNode.nodeType === 'layer' && (() => {
            let liveLayer = selectedNode.node;
            let liveZi = -1;
            let liveLi = -1;
            for (let zi = 0; zi < zones.length; zi++) {
              const li = (zones[zi].layers || []).findIndex((l) => l._key === selectedNode.node._key);
              if (li >= 0) { liveLayer = zones[zi].layers[li]; liveZi = zi; liveLi = li; break; }
            }
            return (
              <LayerDetail
                key={selectedNode.node._key}
                layer={liveLayer}
                onChange={(patch) => {
                  if (liveZi >= 0 && liveLi >= 0) updateLayer(currentViewIndex, liveZi, liveLi, patch);
                }}
              />
            );
          })()}
        </div>
      )}
    </div>
  );
}

function AddLayerInline({ zone, onAdd, onCancel }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('text');
  const allowedTypes = zone.allowed_types || ['text', 'image', 'svg'];

  const handleAdd = () => {
    if (type === 'text') {
      onAdd({ name: name || __( 'Text', 'product-designer' ), type, locked: false, visible: true, text: __( 'Text', 'product-designer' ), fontSize: 24, fontFamily: 'Arial', fill: '#000000', left: zone.x + 20, top: zone.y + 20 });
    } else {
      // Open WP Media Library for image/svg selection.
      if (!window.wp?.media) return;
      const frame = window.wp.media({
        title: type === 'svg' ? __( 'Select SVG', 'product-designer' ) : __( 'Select Image', 'product-designer' ),
        button: { text: __( 'Use', 'product-designer' ) },
        multiple: false,
        library: { type: type === 'svg' ? 'image/svg+xml' : 'image' },
      });
      frame.on('select', () => {
        const attachment = frame.state().get('selection').first().toJSON();
        onAdd({
          name: name || attachment.filename || type,
          type,
          locked: false,
          visible: true,
          src: attachment.url,
          left: zone.x + 20,
          top: zone.y + 20,
          scaleX: 1,
          scaleY: 1,
          angle: 0,
        });
      });
      frame.open();
    }
  };

  return (
    <div className="pd-tree-panel__add-layer" style={{ paddingLeft: '32px' }}>
      <input
        type="text"
        placeholder={ __( 'Layer name', 'product-designer' ) }
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <select value={type} onChange={(e) => setType(e.target.value)}>
        {allowedTypes.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <button onClick={handleAdd}>{ __( 'Add', 'product-designer' ) }</button>
      <button onClick={onCancel}>{ __( 'Cancel', 'product-designer' ) }</button>
    </div>
  );
}

function LayerDetail({ layer, onChange }) {
  const { globalConfig } = useTemplateStore();
  const allowedFonts = globalConfig.allowed_fonts || [];
  // In admin, show allowed fonts if configured, otherwise show all available fonts
  const fontOptions = allowedFonts.length > 0
    ? allowedFonts
    : AVAILABLE_FONTS.map((f) => f.family);

  if (layer.type === 'text') {
    return (
      <div className="pd-tree-panel__layer-detail">
        <h4>{ __( 'Text Properties', 'product-designer' ) }</h4>
        <label>
          { __( 'Text', 'product-designer' ) }
          <input type="text" value={layer.text || ''} onChange={(e) => onChange({ text: e.target.value })} />
        </label>
        <label>
          { __( 'Font Size', 'product-designer' ) }
          <input type="number" min="8" max="200" value={layer.fontSize || 24} onChange={(e) => onChange({ fontSize: parseInt(e.target.value, 10) || 24 })} />
        </label>
        <label>
          { __( 'Font Family', 'product-designer' ) }
          <select value={layer.fontFamily || 'Arial'} onChange={(e) => onChange({ fontFamily: e.target.value })}>
            {fontOptions.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
        <label>
          { __( 'Color', 'product-designer' ) }
          <input type="color" value={layer.fill || '#000000'} onChange={(e) => onChange({ fill: e.target.value })} />
        </label>
        <label>
          { __( 'X', 'product-designer' ) }
          <input type="number" value={layer.left || 0} onChange={(e) => onChange({ left: parseInt(e.target.value, 10) || 0 })} />
        </label>
        <label>
          { __( 'Y', 'product-designer' ) }
          <input type="number" value={layer.top || 0} onChange={(e) => onChange({ top: parseInt(e.target.value, 10) || 0 })} />
        </label>
      </div>
    );
  }

  const typeLabel = (layer.type || __( 'Layer', 'product-designer' )).charAt(0).toUpperCase() + (layer.type || '').slice(1);
  return (
    <div className="pd-tree-panel__layer-detail">
      {/* translators: %s is the layer type (e.g. Image, SVG) */}
      <h4>{ `${typeLabel} ${ __( 'Properties', 'product-designer' ) }` }</h4>
      <label>
        { __( 'Name', 'product-designer' ) }
        <input type="text" value={layer.name || ''} onChange={(e) => onChange({ name: e.target.value })} />
      </label>
      {layer.src && (
        <div style={{ margin: '8px 0' }}>
          <img src={layer.src} alt={ __( 'Preview', 'product-designer' ) } style={{ maxWidth: '100%', maxHeight: 60 }} />
        </div>
      )}
      <label>
        { __( 'X', 'product-designer' ) }
        <input type="number" value={layer.left || 0} onChange={(e) => onChange({ left: parseInt(e.target.value, 10) || 0 })} />
      </label>
      <label>
        { __( 'Y', 'product-designer' ) }
        <input type="number" value={layer.top || 0} onChange={(e) => onChange({ top: parseInt(e.target.value, 10) || 0 })} />
      </label>
      <label>
        { __( 'Scale X', 'product-designer' ) }
        <input type="number" step="0.1" min="0.1" value={layer.scaleX || 1} onChange={(e) => onChange({ scaleX: parseFloat(e.target.value) || 1 })} />
      </label>
      <label>
        { __( 'Scale Y', 'product-designer' ) }
        <input type="number" step="0.1" min="0.1" value={layer.scaleY || 1} onChange={(e) => onChange({ scaleY: parseFloat(e.target.value) || 1 })} />
      </label>
      <label>
        { __( 'Rotation', 'product-designer' ) }
        <input type="number" min="0" max="360" value={layer.angle || 0} onChange={(e) => onChange({ angle: parseInt(e.target.value, 10) || 0 })} />
      </label>
    </div>
  );
}
