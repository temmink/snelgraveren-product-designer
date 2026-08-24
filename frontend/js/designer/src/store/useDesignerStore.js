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

  // Canvas ref (set by DesignerCanvas, used by App for thumbnails)
  fabricCanvasRef: null,

  // Stable ref object (set ONCE by DesignerCanvas, .current kept in sync on
  // every render) holding DesignerCanvas's applyPermissions callback. Toolbar
  // renders as a sibling of DesignerCanvas and instantiates its own
  // useCanvasHistory() for the undo/redo buttons (DesignerCanvas's own
  // undo/redo, from its own useCanvasHistory() call, back only the Ctrl+Z
  // keyboard shortcut) — both need the SAME applyPermissions so a restore
  // triggered from either one re-floors minScaleLimit and re-enforces lock
  // state identically. Store the REF OBJECT (not the function) so re-renders
  // never change its identity — only .current changes, read live at restore
  // time, exactly like every other *Ref pattern in DesignerCanvas.
  applyPermissionsRef: null,

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

  setFabricCanvasRef: (ref) => set({ fabricCanvasRef: ref }),

  setApplyPermissionsRef: (ref) => set({ applyPermissionsRef: ref }),

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

  // History state for undo/redo (per view)
  historyByView: {},   // { [viewIndex]: { undoStack: [], redoStack: [] } }

  // Drawing tool state (populated further in Task 3)
  drawingStrokeWidth: 3,
  drawingStrokeColor: '#000000',
  setDrawingStrokeWidth: (w) => set({ drawingStrokeWidth: w }),
  setDrawingStrokeColor: (c) => set({ drawingStrokeColor: c }),

  pushHistory: (viewIndex, json) =>
    set((s) => {
      const viewHistory = s.historyByView[viewIndex] || { undoStack: [], redoStack: [] };
      const undoStack = [...viewHistory.undoStack, json].slice(-30); // Max 30
      return {
        historyByView: {
          ...s.historyByView,
          [viewIndex]: { undoStack, redoStack: [] },
        },
      };
    }),

  // Reset design state for a fresh customization (after add-to-cart)
  resetDesign: () =>
    set({
      designHash: null,
      isDirty: false,
      canvasSnapshots: {},
      selectedObject: null,
      zoneFillColors: {},
      solidFillColor: null,
      error: null,
      historyByView: {},
      drawingStrokeWidth: 3,
      drawingStrokeColor: '#000000',
    }),
}));

export default useDesignerStore;
