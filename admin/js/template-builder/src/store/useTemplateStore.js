import { create } from 'zustand';

const MAX_HISTORY = 50;

const DEFAULT_GLOBAL_CONFIG = {
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

const useTemplateStore = create((set, get) => ({
  // Persisted template data
  id: 0,
  title: '',
  slug: '',
  status: 'draft',
  globalConfig: { ...DEFAULT_GLOBAL_CONFIG },
  views: [],
  currentViewIndex: 0,

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
        zones_config: [...(views[viewIndex].zones_config || []), { _key: crypto.randomUUID(), ...zone }],
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

  addLayer: (viewIndex, layer) =>
    set((s) => {
      const views = [...s.views];
      views[viewIndex] = {
        ...views[viewIndex],
        layers_config: [...(views[viewIndex].layers_config || []), { _key: crypto.randomUUID(), ...layer }],
      };
      return { views, isDirty: true };
    }),

  updateLayer: (viewIndex, layerIndex, patch) =>
    set((s) => {
      const views = [...s.views];
      const layers = [...(views[viewIndex].layers_config || [])];
      layers[layerIndex] = { ...layers[layerIndex], ...patch };
      views[viewIndex] = { ...views[viewIndex], layers_config: layers };
      return { views, isDirty: true };
    }),

  removeLayer: (viewIndex, layerIndex) =>
    set((s) => {
      const views = [...s.views];
      const layers = (views[viewIndex].layers_config || [])
        .filter((_, i) => i !== layerIndex)
        .map((layer, i) => ({ ...layer, z_order: i }));
      views[viewIndex] = { ...views[viewIndex], layers_config: layers };
      return { views, isDirty: true };
    }),

  moveLayer: (viewIndex, fromIndex, toIndex) =>
    set((s) => {
      const views = [...s.views];
      const layers = [...(views[viewIndex].layers_config || [])];
      if (fromIndex < 0 || fromIndex >= layers.length || toIndex < 0 || toIndex >= layers.length) return {};
      const [moved] = layers.splice(fromIndex, 1);
      layers.splice(toIndex, 0, moved);
      const reordered = layers.map((layer, i) => ({ ...layer, z_order: i }));
      views[viewIndex] = { ...views[viewIndex], layers_config: reordered };
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
      globalConfig: { ...DEFAULT_GLOBAL_CONFIG, ...(data.global_config || {}) },
      views:        (data.views || []).map((v) => ({ _clientId: crypto.randomUUID(), ...v })),
      currentViewIndex: 0,
      isDirty:      false,
      history:      {},
      removedViewIds: [],
    }),
}));

export default useTemplateStore;
