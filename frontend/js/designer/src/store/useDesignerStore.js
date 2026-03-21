import { create } from 'zustand';

const useDesignerStore = create((set) => ({
  // Template config (read-only after load)
  template: null,

  currentViewIndex: 0,

  // Design state
  designHash: null,
  isSaving: false,
  isDirty: false,

  // Per-view canvas state
  canvasSnapshots: {},

  // Tool mode
  activeTool: 'select',

  // Selected element
  selectedObject: null,

  // Zone fill colors changed by customer (keyed by zoneIndex)
  zoneFillColors: {},

  // Solid color: single color applied across all views
  solidFillColor: null,

  // Error message
  error: null,

  // File upload trigger (set by DesignerCanvas, called by AddTab)
  triggerFileUpload: null,

  // Canvas ref (set by DesignerCanvas, used by App for thumbnails)
  fabricCanvasRef: null,

  // Actions
  loadTemplate: (data) => set({ template: data, currentViewIndex: 0 }),

  setCurrentViewIndex: (i) => set({ currentViewIndex: i }),

  setActiveTool: (tool) => set({ activeTool: tool }),

  setSelectedObject: (obj) => set({ selectedObject: obj }),

  setDesignHash: (hash) => set({ designHash: hash }),

  setIsSaving: (v) => set({ isSaving: v }),

  setIsDirty: (v) => set({ isDirty: v }),

  setError: (msg) => set({ error: msg }),

  clearError: () => set({ error: null }),

  snapshotView: (viewIndex, json) =>
    set((s) => ({
      canvasSnapshots: { ...s.canvasSnapshots, [viewIndex]: json },
      isDirty: true,
    })),

  setTriggerFileUpload: (fn) => set({ triggerFileUpload: fn }),

  setFabricCanvasRef: (ref) => set({ fabricCanvasRef: ref }),

  clipartCollections: [],
  setClipartCollections: (collections) => set({ clipartCollections: collections }),

  addClipart: null,
  setAddClipart: (fn) => set({ addClipart: fn }),

  setZoneFillColor: (zoneIndex, color) =>
    set((s) => ({
      zoneFillColors: { ...s.zoneFillColors, [zoneIndex]: color },
      isDirty: true,
    })),

  setSolidFillColor: (color) =>
    set({ solidFillColor: color, isDirty: true }),
}));

export default useDesignerStore;
