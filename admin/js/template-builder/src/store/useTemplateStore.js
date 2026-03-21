import { create } from 'zustand';

const MAX_HISTORY = 50;

const DEFAULT_GLOBAL_CONFIG = {
  customization_required: false,
  pricing_mode: 'per_element',
  fonts_enabled: false,
  colors_enabled: false,
  any_color: false,
  allowed_fonts: [],
  allowed_colors: [],
  max_elements_per_view: 50,
  max_file_size_mb: 10,
  min_width: 0,
  min_height: 0,
  min_dpi: 0,
  allowed_image_types: ['jpg', 'png', 'svg', 'webp'],
  text_price: 0,
  image_price: 0,
  svg_price: 0,
  extra_layer_price: 0,
  tiers: [],
  min_surcharge: 0,
  max_surcharge: null,
  permissions: {
    text:  { resize: true, rotate: true, delete: true, recolor: true, change_font: true, min_scale: 0.1, max_scale: 10, snap_to_grid: false, grid_size: 10, max_chars: 0 },
    image: { resize: true, rotate: true, delete: true, min_scale: 0.1, max_scale: 10, snap_to_grid: false, grid_size: 10 },
    svg:   { resize: true, rotate: true, delete: true, recolor: true, min_scale: 0.1, max_scale: 10, snap_to_grid: false, grid_size: 10 },
  },
};

/**
 * Migrate old any_color / allowed_colors fields to the new color_mode system.
 */
function migrateGlobalConfig(config) {
  if (!config.color_mode) {
    if (config.any_color) {
      config.color_mode = 'all';
    } else if (config.allowed_colors?.length > 0) {
      config.color_mode = 'individual';
    } else {
      config.color_mode = 'individual';
    }
  }
  return config;
}

function migrateViewToNestedLayers(view) {
  const zones = view.zones_config || [];
  const allMigrated = zones.length > 0 && zones.every((z) => Array.isArray(z.layers));
  if (allMigrated) return view;
  if (!view.layers_config?.length) {
    // No layers to migrate, but ensure all zones have a layers array.
    return {
      ...view,
      zones_config: zones.map((z) => Array.isArray(z.layers) ? z : { ...z, layers: [] }),
    };
  }

  const zonesWithLayers = zones.map((z) => ({ ...z, layers: Array.isArray(z.layers) ? [...z.layers] : [] }));
  const layers = view.layers_config || [];

  layers.forEach((layer) => {
    // Find zone by center point of layer.
    const cx = (layer.left || 0) + ((layer.width || 0) / 2);
    const cy = (layer.top || 0) + ((layer.height || 0) / 2);

    let bestIdx = -1;
    let bestArea = Infinity;

    zonesWithLayers.forEach((z, i) => {
      if (cx >= z.x && cx <= z.x + z.width && cy >= z.y && cy <= z.y + z.height) {
        const area = z.width * z.height;
        if (area < bestArea) {
          bestIdx = i;
          bestArea = area;
        }
      }
    });

    if (bestIdx < 0) {
      // No zone contains this layer — assign to first zone.
      if (zonesWithLayers.length > 0) {
        console.warn('[PF] Layer outside all zones, assigning to first zone:', layer.name || layer.type);
        bestIdx = 0;
      } else {
        return; // No zones at all — drop the layer (shouldn't happen with the guard).
      }
    }

    zonesWithLayers[bestIdx].layers.push(layer);
  });

  const { layers_config: _dropped, ...rest } = view;
  return { ...rest, zones_config: zonesWithLayers };
}

const useTemplateStore = create((set, get) => ({
  // Persisted template data
  id: 0,
  title: '',
  slug: '',
  status: 'draft',
  globalConfig: { ...DEFAULT_GLOBAL_CONFIG },
  views: [],
  currentViewIndex: 0,

  // Custom fonts uploaded by the admin
  customFonts: [],

  // Global color palettes (shared across all templates)
  colorPalettes: [],

  // Clip art collections (shared across all templates)
  clipartCollections: [],

  // UI state
  isDirty: false,
  isSaving: false,
  isFreeMove: false,

  // Track removed view IDs for deletion on save
  removedViewIds: [],

  // Undo/redo history keyed by view._clientId
  // { [clientId]: { stack: string[], pointer: number } }
  history: {},

  // ── Core setters ──────────────────────────────────────────────────────────

  setCustomFonts:      (fonts)  => set({ customFonts: fonts }),
  setColorPalettes:    (p)     => set({ colorPalettes: p }),
  setClipartCollections: (collections) => set({ clipartCollections: collections }),

  setId:               (id)     => set({ id }),
  setTitle:            (title)  => set({ title, isDirty: true }),
  setSlug:             (slug)   => set({ slug, isDirty: true }),
  setStatus:           (status) => set({ status, isDirty: true }),
  setIsDirty:          (v)      => set({ isDirty: v }),
  setIsSaving:         (v)      => set({ isSaving: v }),
  setFreeMove:         (v)      => set({ isFreeMove: v }),
  setCurrentViewIndex: (i)      => set({ currentViewIndex: i }),

  setGlobalConfig: (patch) =>
    set((s) => ({ globalConfig: { ...s.globalConfig, ...patch }, isDirty: true })),

  // ── View management ───────────────────────────────────────────────────────

  addView: (view) =>
    set((s) => ({
      views: [...s.views, { _clientId: crypto.randomUUID(), ...view }],
      currentViewIndex: s.views.length,
      isDirty: true,
    })),

  removeView: (index) =>
    set((s) => {
      const view = s.views[index];
      const views = s.views.filter((_, i) => i !== index);
      const currentViewIndex = Math.min(s.currentViewIndex, Math.max(0, views.length - 1));

      // Remove history entry for the deleted view (keyed by _clientId).
      const history = { ...s.history };
      if (view?._clientId) delete history[view._clientId];

      // Track server ID for deletion on save (only if the view was persisted to the server).
      const removedViewIds = view?.id
        ? [...s.removedViewIds, view.id]
        : s.removedViewIds;

      return { views, currentViewIndex, history, removedViewIds, isDirty: true };
    }),

  updateView: (index, patch) =>
    set((s) => {
      const views = [...s.views];
      views[index] = { ...views[index], ...patch };
      return { views, isDirty: true };
    }),

  clearRemovedViewIds: () => set({ removedViewIds: [] }),

  // ── Zone management ───────────────────────────────────────────────────────

  addZone: (viewIndex, zone) =>
    set((s) => {
      const views = [...s.views];
      views[viewIndex] = {
        ...views[viewIndex],
        zones_config: [...(views[viewIndex].zones_config || []), { _key: crypto.randomUUID(), layers: [], ...zone }],
      };
      return { views, isDirty: true };
    }),

  updateZone: (viewIndex, zoneIndex, patch) =>
    set((s) => {
      const views = [...s.views];
      const zones = [...(views[viewIndex].zones_config || [])];
      zones[zoneIndex] = { ...zones[zoneIndex], ...patch };
      views[viewIndex] = { ...views[viewIndex], zones_config: zones };
      return { views, isDirty: true };
    }),

  removeZone: (viewIndex, zoneIndex) =>
    set((s) => {
      const views = [...s.views];
      const zones = (views[viewIndex].zones_config || []).filter((_, i) => i !== zoneIndex);
      views[viewIndex] = { ...views[viewIndex], zones_config: zones };
      return { views, isDirty: true };
    }),

  // ── Layer management ──────────────────────────────────────────────────────

  addLayer: (viewIndex, zoneIndex, layer) =>
    set((s) => {
      const views = [...s.views];
      const zones = [...(views[viewIndex].zones_config || [])];
      zones[zoneIndex] = {
        ...zones[zoneIndex],
        layers: [...(zones[zoneIndex].layers || []), { _key: crypto.randomUUID(), ...layer }],
      };
      views[viewIndex] = { ...views[viewIndex], zones_config: zones };
      return { views, isDirty: true };
    }),

  updateLayer: (viewIndex, zoneIndex, layerIndex, patch) =>
    set((s) => {
      const views = [...s.views];
      const zones = [...(views[viewIndex].zones_config || [])];
      const layers = [...(zones[zoneIndex].layers || [])];
      layers[layerIndex] = { ...layers[layerIndex], ...patch };
      zones[zoneIndex] = { ...zones[zoneIndex], layers };
      views[viewIndex] = { ...views[viewIndex], zones_config: zones };
      return { views, isDirty: true };
    }),

  removeLayer: (viewIndex, zoneIndex, layerIndex) =>
    set((s) => {
      const views = [...s.views];
      const zones = [...(views[viewIndex].zones_config || [])];
      const layers = (zones[zoneIndex].layers || [])
        .filter((_, i) => i !== layerIndex)
        .map((layer, i) => ({ ...layer, z_order: i }));
      zones[zoneIndex] = { ...zones[zoneIndex], layers };
      views[viewIndex] = { ...views[viewIndex], zones_config: zones };
      return { views, isDirty: true };
    }),

  moveLayer: (viewIndex, fromZoneIndex, fromLayerIndex, toZoneIndex, toLayerIndex) =>
    set((s) => {
      const views = [...s.views];
      const zones = [...(views[viewIndex].zones_config || [])];

      // Remove from source zone.
      const fromLayers = [...(zones[fromZoneIndex].layers || [])];
      const [moved] = fromLayers.splice(fromLayerIndex, 1);
      zones[fromZoneIndex] = { ...zones[fromZoneIndex], layers: fromLayers.map((l, i) => ({ ...l, z_order: i })) };

      // Insert into target zone.
      const toLayers = fromZoneIndex === toZoneIndex ? fromLayers : [...(zones[toZoneIndex].layers || [])];
      toLayers.splice(toLayerIndex, 0, moved);
      zones[toZoneIndex] = { ...zones[toZoneIndex], layers: toLayers.map((l, i) => ({ ...l, z_order: i })) };

      views[viewIndex] = { ...views[viewIndex], zones_config: zones };
      return { views, isDirty: true };
    }),

  reorderZone: (viewIndex, fromIndex, toIndex) =>
    set((s) => {
      const views = [...s.views];
      const zones = [...(views[viewIndex].zones_config || [])];
      if (fromIndex < 0 || fromIndex >= zones.length || toIndex < 0 || toIndex >= zones.length) return {};
      const [moved] = zones.splice(fromIndex, 1);
      zones.splice(toIndex, 0, moved);
      const reordered = zones.map((z, i) => ({ ...z, sort_order: i }));
      views[viewIndex] = { ...views[viewIndex], zones_config: reordered };
      return { views, isDirty: true };
    }),

  // ── Undo / Redo ───────────────────────────────────────────────────────────

  pushHistory: (viewKey, snapshot) =>
    set((s) => {
      const vh = s.history[viewKey] || { stack: [], pointer: -1 };
      const stack = vh.stack.slice(0, vh.pointer + 1);
      stack.push(snapshot);
      if (stack.length > MAX_HISTORY) stack.shift();
      return { history: { ...s.history, [viewKey]: { stack, pointer: stack.length - 1 } } };
    }),

  undo: (viewKey) => {
    const s = get();
    const vh = s.history[viewKey];
    if (!vh || vh.pointer <= 0) return null;
    const pointer = vh.pointer - 1;
    const snapshot = vh.stack[pointer];
    set((st) => ({ history: { ...st.history, [viewKey]: { ...vh, pointer } } }));
    return snapshot;
  },

  redo: (viewKey) => {
    const s = get();
    const vh = s.history[viewKey];
    if (!vh || vh.pointer >= vh.stack.length - 1) return null;
    const pointer = vh.pointer + 1;
    const snapshot = vh.stack[pointer];
    set((st) => ({ history: { ...st.history, [viewKey]: { ...vh, pointer } } }));
    return snapshot;
  },

  canUndo: (viewKey) => {
    const vh = get().history[viewKey];
    return vh ? vh.pointer > 0 : false;
  },

  canRedo: (viewKey) => {
    const vh = get().history[viewKey];
    return vh ? vh.pointer < vh.stack.length - 1 : false;
  },

  // ── Load from API ─────────────────────────────────────────────────────────

  loadFromApi: (data) =>
    set({
      id:           data.id     || 0,
      title:        data.title  || '',
      slug:         data.slug   || '',
      status:       data.status || 'draft',
      globalConfig: migrateGlobalConfig({ ...DEFAULT_GLOBAL_CONFIG, ...(data.global_config || {}) }),
      views:        (data.views || []).map((v) => {
        const migrated = migrateViewToNestedLayers(v);
        return {
          _clientId: crypto.randomUUID(),
          ...migrated,
          zones_config: (migrated.zones_config || []).map((z) => ({
            _key: crypto.randomUUID(),
            ...z,
            layers: (z.layers || []).map((l) => ({
              _key: crypto.randomUUID(),
              ...l,
            })),
          })),
        };
      }),
      currentViewIndex: 0,
      isDirty:      false,
      history:      {},
      removedViewIds: [],
    }),
}));

export default useTemplateStore;
