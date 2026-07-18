import React, { useState, useCallback, useEffect } from 'react';
import { __ } from '@wordpress/i18n';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import useTemplateStore from '../store/useTemplateStore';
import TreeNode from './TreeNode';
import ZoneForm from './ZoneForm';
import { AVAILABLE_FONTS, mergeCustomFonts } from '../utils/fonts';
import { clipartApi } from '../api/templateApi';

export default function TreePanel() {
  const {
    views, currentViewIndex, globalConfig,
    addZone, updateZone, removeZone, reorderZone,
    addLayer, updateLayer, removeLayer, moveLayer,
    canvasSelectedKey,
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

  // When solid_color is enabled and a zone's fill color changes,
  // propagate that color to all SVG zones across all other views.
  const propagateSolidColor = useCallback((patch) => {
    if (!globalConfig.solid_color || !patch.svg_fill_color) return;
    const color = patch.svg_fill_color;
    views.forEach((view, vi) => {
      if (vi === currentViewIndex) return;
      (view.zones_config || []).forEach((zone, zi) => {
        if (zone.boundary_type === 'svg' && zone.svg_url && zone.svg_fill_editable) {
          updateZone(vi, zi, { svg_fill_color: color });
        }
      });
    });
  }, [globalConfig.solid_color, views, currentViewIndex, updateZone]);

  // Sync tree selection when a layer is clicked on the canvas.
  useEffect(() => {
    if (!canvasSelectedKey) {
      setSelectedNode(null);
      return;
    }
    for (const zone of zones) {
      const layer = (zone.layers || []).find((l) => l._key === canvasSelectedKey);
      if (layer) {
        setSelectedNode({ node: layer, nodeType: 'layer' });
        setExpandedZones((prev) => ({ ...prev, [zone._key]: true }));
        break;
      }
    }
  }, [canvasSelectedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const toggleExpanded = (key) => {
    setExpandedZones((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSelect = useCallback((node, nodeType) => {
    setSelectedNode({ node, nodeType });
  }, []);

  const handleAction = useCallback((action, node, zoneIndex, layerIndex, extra) => {
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
      case 'rename':
        if (layerIndex != null) {
          updateLayer(currentViewIndex, zoneIndex, layerIndex, { name: extra });
        } else {
          updateZone(currentViewIndex, zoneIndex, { name: extra });
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
    <div className="pf-tree-panel">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={allSortableKeys} strategy={verticalListSortingStrategy}>
          {zones.length === 0 && (
            <p className="pf-tree-panel__empty">{ __( 'Add a boundary first to place layers.', 'snelgraveren-product-designer' ) }</p>
          )}
          {zones.map((zone, zoneIndex) => {
            const isExpanded = expandedZones[zone._key] !== false; // Default expanded.
            return (
              <div key={zone._key} className="pf-tree-panel__zone-group">
                <TreeNode
                  node={zone}
                  nodeType="zone"
                  isSelected={selectedNode?.node?._key === zone._key}
                  isExpanded={isExpanded}
                  onSelect={handleSelect}
                  onToggleExpand={() => toggleExpanded(zone._key)}
                  onAction={(action, n, extra) => handleAction(action, n, zoneIndex, undefined, extra)}
                  depth={0}
                >
                  {isExpanded && (
                    <div className="pf-tree-panel__children">
                      {(zone.layers || []).map((layer, layerIndex) => (
                        <TreeNode
                          key={layer._key}
                          node={layer}
                          nodeType="layer"
                          isSelected={selectedNode?.node?._key === layer._key}
                          onSelect={handleSelect}
                          onAction={(action, n, extra) => handleAction(action, n, zoneIndex, layerIndex, extra)}
                          depth={1}
                        />
                      ))}
                      {addingLayerToZone === zoneIndex && (
                        <AddLayerPanel
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

      <div className="pf-tree-panel__footer">
        <button
          className="pf-tree-panel__add-zone-btn"
          onClick={() => setIsAddingZone(true)}
          aria-label={ __( 'Add Boundary', 'snelgraveren-product-designer' ) }
        >
          { __( '+ Add Boundary', 'snelgraveren-product-designer' ) }
        </button>
        {savedMsg && <span className="pf-zone-form__saved">{ __( 'Saved Boundary', 'snelgraveren-product-designer' ) }</span>}
      </div>

      {isAddingZone && (
        <ZoneForm
          onSubmit={(zone) => { addZone(currentViewIndex, zone); setIsAddingZone(false); flashSaved(); }}
          onCancel={() => setIsAddingZone(false)}
        />
      )}

      {selectedNode && (
        <div className="pf-tree-panel__detail">
          {selectedNode.nodeType === 'zone' && (() => {
            const zoneIdx = zones.findIndex((z) => z._key === selectedNode.node._key);
            const liveZone = zoneIdx >= 0 ? zones[zoneIdx] : selectedNode.node;
            return (
              <ZoneForm
                key={selectedNode.node._key}
                initialData={liveZone}
                onChange={(patch) => {
                  if (zoneIdx >= 0) {
                    updateZone(currentViewIndex, zoneIdx, patch);
                    propagateSolidColor(patch);
                  }
                }}
                onSubmit={(patch) => {
                  if (zoneIdx >= 0) {
                    updateZone(currentViewIndex, zoneIdx, patch);
                    propagateSolidColor(patch);
                    flashSaved();
                  }
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

function AddLayerPanel({ zone, onAdd, onCancel }) {
  const [mode, setMode] = useState(null); // null = source picker, 'clipart' = clipart browser
  const [collections, setCollections] = useState([]);
  const [activeCollection, setActiveCollection] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const allowedTypes = zone.allowed_types || ['text', 'image', 'svg'];

  const addFromUrl = (src, name, type = 'svg') => {
    // Load image to get dimensions, then scale to fit boundary
    const img = new Image();
    img.onload = () => {
      const zoneW = zone.width || 200;
      const zoneH = zone.height || 200;
      const padding = 20;
      const maxW = zoneW - padding;
      const maxH = zoneH - padding;
      const scale = Math.min(maxW / (img.naturalWidth || 200), maxH / (img.naturalHeight || 200), 1);
      onAdd({
        name: name || type,
        type,
        locked: false,
        visible: true,
        src,
        left: zone.x + (zoneW - img.naturalWidth * scale) / 2,
        top: zone.y + (zoneH - img.naturalHeight * scale) / 2,
        scaleX: scale,
        scaleY: scale,
        angle: 0,
      });
    };
    img.onerror = () => {
      // Fallback: add without scaling
      onAdd({ name: name || type, type, locked: false, visible: true, src, left: zone.x + 20, top: zone.y + 20, scaleX: 1, scaleY: 1, angle: 0 });
    };
    img.src = src;
  };

  const handleText = () => {
    onAdd({ name: __('Text', 'snelgraveren-product-designer'), type: 'text', locked: false, visible: true, text: __('Text', 'snelgraveren-product-designer'), fontSize: 24, fontFamily: 'Arial', fill: '#000000', left: zone.x + 20, top: zone.y + 20 });
  };

  const handleMedia = (mediaType) => {
    if (!window.wp?.media) return;
    const frame = window.wp.media({
      title: mediaType === 'svg' ? __('Select SVG', 'snelgraveren-product-designer') : __('Select Image', 'snelgraveren-product-designer'),
      button: { text: __('Use', 'snelgraveren-product-designer') },
      multiple: false,
      library: { type: mediaType === 'svg' ? 'image/svg+xml' : 'image' },
    });
    frame.on('select', () => {
      const attachment = frame.state().get('selection').first().toJSON();
      addFromUrl(attachment.url, attachment.filename, mediaType);
    });
    frame.open();
  };

  const handleClipartMode = async () => {
    setMode('clipart');
    setLoading(true);
    try {
      const data = await clipartApi.listCollections();
      const cols = data || [];
      setCollections(cols);
      if (cols.length > 0) {
        setActiveCollection(cols[0].id);
        const colData = await clipartApi.getCollection(cols[0].id);
        setItems(colData.items || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleCollectionTab = async (id) => {
    if (id === activeCollection) return;
    setActiveCollection(id);
    setLoadingItems(true);
    try {
      const data = await clipartApi.getCollection(id);
      setItems(data.items || []);
    } catch {
      setItems([]);
    }
    setLoadingItems(false);
  };

  // Clipart browser mode
  if (mode === 'clipart') {
    return (
      <div className="pf-add-layer">
        <div className="pf-add-layer__header">
          <button type="button" className="pf-add-layer__back" onClick={() => setMode(null)}>
            ← {__('Back', 'snelgraveren-product-designer')}
          </button>
          <span className="pf-add-layer__title">{__('Clipart Library', 'snelgraveren-product-designer')}</span>
          <button type="button" className="pf-add-layer__close" onClick={onCancel}>×</button>
        </div>

        {loading ? (
          <p className="pf-add-layer__status">{__('Loading...', 'snelgraveren-product-designer')}</p>
        ) : collections.length === 0 ? (
          <p className="pf-add-layer__status">
            {__('No collections yet.', 'snelgraveren-product-designer')}{' '}
            <a href="?page=pf-clipart">{__('Create one', 'snelgraveren-product-designer')}</a>
          </p>
        ) : (
          <>
            <div className="pf-add-layer__tabs">
              {collections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`pf-add-layer__tab${activeCollection === c.id ? ' pf-add-layer__tab--active' : ''}`}
                  onClick={() => handleCollectionTab(c.id)}
                >
                  {c.name}
                  <span className="pf-add-layer__tab-count">{c.item_count}</span>
                </button>
              ))}
            </div>

            {loadingItems ? (
              <p className="pf-add-layer__status">{__('Loading...', 'snelgraveren-product-designer')}</p>
            ) : items.length === 0 ? (
              <p className="pf-add-layer__status">{__('Empty collection.', 'snelgraveren-product-designer')}</p>
            ) : (
              <div className="pf-add-layer__grid">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="pf-add-layer__tile"
                    onClick={() => addFromUrl(item.svg_url, item.name, 'svg')}
                    title={item.name}
                  >
                    <img src={item.svg_url} alt={item.name} />
                    <span className="pf-add-layer__tile-name">{item.name}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // Source picker mode (default)
  return (
    <div className="pf-add-layer">
      <div className="pf-add-layer__header">
        <span className="pf-add-layer__title">{__('Add Layer', 'snelgraveren-product-designer')}</span>
        <button type="button" className="pf-add-layer__close" onClick={onCancel}>×</button>
      </div>
      <div className="pf-add-layer__sources">
        {allowedTypes.includes('text') && (
          <button type="button" className="pf-add-layer__source" onClick={handleText}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" />
            </svg>
            <span>{__('Text', 'snelgraveren-product-designer')}</span>
          </button>
        )}
        {(allowedTypes.includes('image') || allowedTypes.includes('svg')) && (
          <button type="button" className="pf-add-layer__source" onClick={() => handleMedia(allowedTypes.includes('image') ? 'image' : 'svg')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
            </svg>
            <span>{__('Media Library', 'snelgraveren-product-designer')}</span>
          </button>
        )}
        {allowedTypes.includes('svg') && (
          <button type="button" className="pf-add-layer__source" onClick={handleClipartMode}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
            </svg>
            <span>{__('Clipart', 'snelgraveren-product-designer')}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function resolveElementColors(globalConfig, colorPalettes) {
  const enabled = globalConfig.element_colors_enabled ?? globalConfig.colors_enabled ?? true;
  if (!enabled) return { enabled: false, anyColor: false, colors: [] };

  const mode = globalConfig.element_color_mode || globalConfig.color_mode || 'all';
  if (mode === 'all') return { enabled: true, anyColor: true, colors: [] };

  if (mode === 'palette') {
    const paletteId = globalConfig.element_color_palette_id || globalConfig.color_palette_id || '';
    const palette = (colorPalettes || []).find((p) => p.id === paletteId);
    return { enabled: true, anyColor: false, colors: palette ? palette.colors : [] };
  }

  // individual
  const colors = globalConfig.element_allowed_colors || globalConfig.allowed_colors || [];
  return { enabled: true, anyColor: false, colors };
}

function ColorField({ value, onChange, globalConfig, colorPalettes }) {
  const { enabled, anyColor, colors } = resolveElementColors(globalConfig, colorPalettes);

  if (!enabled) return null;

  if (anyColor || colors.length === 0) {
    return (
      <label>
        { __( 'Color', 'snelgraveren-product-designer' ) }
        <input type="color" value={value || '#000000'} onChange={(e) => onChange(e.target.value)} />
      </label>
    );
  }

  return (
    <div className="pf-tree-panel__color-field">
      <span className="pf-tree-panel__color-label">{ __( 'Color', 'snelgraveren-product-designer' ) }</span>
      <div className="pf-tree-panel__color-swatches">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            className={`pf-tree-panel__color-swatch${value === c ? ' pf-tree-panel__color-swatch--active' : ''}`}
            style={{ background: c }}
            onClick={() => onChange(c)}
            title={c}
          />
        ))}
      </div>
    </div>
  );
}

function LayerDetail({ layer, onChange }) {
  const { globalConfig, customFonts, colorPalettes } = useTemplateStore();
  const allowedFonts = globalConfig.allowed_fonts || [];
  const allFonts = mergeCustomFonts(customFonts);
  // In admin, show allowed fonts if configured, otherwise show all available fonts (including custom)
  const fontOptions = allowedFonts.length > 0
    ? allowedFonts
    : allFonts.map((f) => f.family);

  if (layer.type === 'text') {
    return (
      <div className="pf-tree-panel__layer-detail">
        <h4>{ __( 'Text Properties', 'snelgraveren-product-designer' ) }</h4>
        <label>
          { __( 'Text', 'snelgraveren-product-designer' ) }
          <input type="text" value={layer.text || ''} onChange={(e) => onChange({ text: e.target.value })} />
        </label>
        <label>
          { __( 'Font Size', 'snelgraveren-product-designer' ) }
          <input type="number" min="8" max="200" value={layer.fontSize || 24} onChange={(e) => onChange({ fontSize: parseInt(e.target.value, 10) || 24 })} />
        </label>
        <label>
          { __( 'Font Family', 'snelgraveren-product-designer' ) }
          <select value={layer.fontFamily || 'Arial'} onChange={(e) => onChange({ fontFamily: e.target.value })}>
            {fontOptions.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
        <ColorField
          value={layer.fill}
          onChange={(color) => onChange({ fill: color })}
          globalConfig={globalConfig}
          colorPalettes={colorPalettes}
        />
        <label>
          { __( 'Text Align', 'snelgraveren-product-designer' ) }
          <select value={layer.textAlign || 'left'} onChange={(e) => onChange({ textAlign: e.target.value })}>
            <option value="left">{ __( 'Left', 'snelgraveren-product-designer' ) }</option>
            <option value="center">{ __( 'Center', 'snelgraveren-product-designer' ) }</option>
            <option value="right">{ __( 'Right', 'snelgraveren-product-designer' ) }</option>
          </select>
        </label>
        <label>
          { __( 'Width', 'snelgraveren-product-designer' ) }
          <input type="number" min="20" value={layer.width || 200} onChange={(e) => onChange({ width: parseInt(e.target.value, 10) || 200 })} />
        </label>
        <div className="pf-tree-panel__coord-row">
          <label>
            { __( 'X', 'snelgraveren-product-designer' ) }
            <input type="number" value={layer.left || 0} onChange={(e) => onChange({ left: parseInt(e.target.value, 10) || 0 })} />
          </label>
          <label>
            { __( 'Y', 'snelgraveren-product-designer' ) }
            <input type="number" value={layer.top || 0} onChange={(e) => onChange({ top: parseInt(e.target.value, 10) || 0 })} />
          </label>
        </div>
      </div>
    );
  }

  const typeLabel = (layer.type || __( 'Layer', 'snelgraveren-product-designer' )).charAt(0).toUpperCase() + (layer.type || '').slice(1);
  return (
    <div className="pf-tree-panel__layer-detail">
      {/* translators: %s is the layer type (e.g. Image, SVG) */}
      <h4>{ `${typeLabel} ${ __( 'Properties', 'snelgraveren-product-designer' ) }` }</h4>
      <label>
        { __( 'Name', 'snelgraveren-product-designer' ) }
        <input type="text" value={layer.name || ''} onChange={(e) => onChange({ name: e.target.value })} />
      </label>
      {layer.src && (
        <div style={{ margin: '8px 0' }}>
          <img src={layer.src} alt={ __( 'Preview', 'snelgraveren-product-designer' ) } style={{ maxWidth: '100%', maxHeight: 60, borderRadius: 4 }} />
        </div>
      )}
      <div className="pf-tree-panel__coord-row">
        <label>
          { __( 'X', 'snelgraveren-product-designer' ) }
          <input type="number" value={layer.left || 0} onChange={(e) => onChange({ left: parseInt(e.target.value, 10) || 0 })} />
        </label>
        <label>
          { __( 'Y', 'snelgraveren-product-designer' ) }
          <input type="number" value={layer.top || 0} onChange={(e) => onChange({ top: parseInt(e.target.value, 10) || 0 })} />
        </label>
      </div>
      <div className="pf-tree-panel__coord-row">
        <label>
          { __( 'Scale X', 'snelgraveren-product-designer' ) }
          <input type="number" step="0.1" min="0.1" value={layer.scaleX || 1} onChange={(e) => onChange({ scaleX: parseFloat(e.target.value) || 1 })} />
        </label>
        <label>
          { __( 'Scale Y', 'snelgraveren-product-designer' ) }
          <input type="number" step="0.1" min="0.1" value={layer.scaleY || 1} onChange={(e) => onChange({ scaleY: parseFloat(e.target.value) || 1 })} />
        </label>
      </div>
      <label>
        { __( 'Rotation', 'snelgraveren-product-designer' ) }
        <input type="number" min="0" max="360" value={layer.angle || 0} onChange={(e) => onChange({ angle: parseInt(e.target.value, 10) || 0 })} />
      </label>
    </div>
  );
}
