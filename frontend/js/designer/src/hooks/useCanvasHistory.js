import { useCallback, useRef } from 'react';
import useDesignerStore from '../store/useDesignerStore';
import { filterFabricJson } from '../utils/fabricJson';
import { reapplyPostRestoreState } from '../utils/postRestoreState';

// `applyPermissionsRef` is DesignerCanvas's applyPermissions callback, handed
// over by ref (it's defined further down in that component, after this hook
// is called — see the comment at the DesignerCanvas call site). Read via
// .current at restore time, never captured by value, so this hook always
// uses the latest permissions/canvasWidth/widthMm closure.
export default function useCanvasHistory(fabricCanvasRef, currentViewIndex, applyPermissionsRef) {
  const debounceTimer = useRef(null);
  const isRestoring = useRef(false);

  const pushHistory = useCallback(() => {
    if (isRestoring.current) return;
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      if (isRestoring.current) return;
      const json = canvas.toObject(['data']);
      useDesignerStore.getState().pushHistory(currentViewIndex, json);
    }, 300);
  }, [fabricCanvasRef, currentViewIndex]);

  const applySnapshot = useCallback((snapshot) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !snapshot) return;
    isRestoring.current = true;
    canvas.loadFromJSON(filterFabricJson(snapshot))
      .then(() => {
        canvas.getObjects().forEach((obj) => {
          if (obj.data?.isZone || obj.data?.isZoneOverlay || obj.data?.isBackground) {
            obj.set({ selectable: false, evented: false });
          }
        });
        // Undo/redo runs its own loadFromJSON on this same canvas, so it needs
        // the exact same post-restore treatment as DesignerCanvas's own restore
        // path (view switch / ?pf_design=HASH reload) — otherwise Ctrl+Z drops
        // the drag-handle floor (minScaleLimit isn't serialized) and unlocks
        // template-locked layers (selectable/evented aren't serialized either).
        // Shared implementation in utils/postRestoreState.js; see there for the
        // ordering rationale (lock enforcement must run last) and the
        // interactivity-only guarantee (never touches left/top/scaleX/scaleY/
        // angle/fontSize).
        if (applyPermissionsRef?.current) {
          reapplyPostRestoreState(canvas, applyPermissionsRef.current);
        }
        canvas.renderAll();
        useDesignerStore.getState().snapshotView(currentViewIndex, canvas.toObject(['data']));
      })
      .finally(() => {
        isRestoring.current = false;
      });
  }, [fabricCanvasRef, currentViewIndex, applyPermissionsRef]);

  const undo = useCallback(() => {
    const store = useDesignerStore.getState();
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const vh = store.historyByView[currentViewIndex];
    if (!vh || vh.undoStack.length === 0) return;

    // Save current state to redo before applying undo
    const currentJson = canvas.toObject(['data']);
    const undoStack = [...vh.undoStack];
    const snapshot = undoStack.pop();

    useDesignerStore.setState({
      historyByView: {
        ...store.historyByView,
        [currentViewIndex]: {
          undoStack,
          redoStack: [...(vh.redoStack || []), currentJson],
        },
      },
    });

    applySnapshot(snapshot);
  }, [fabricCanvasRef, currentViewIndex, applySnapshot]);

  const redo = useCallback(() => {
    const store = useDesignerStore.getState();
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const vh = store.historyByView[currentViewIndex];
    if (!vh || vh.redoStack.length === 0) return;

    const currentJson = canvas.toObject(['data']);
    const redoStack = [...vh.redoStack];
    const snapshot = redoStack.pop();

    useDesignerStore.setState({
      historyByView: {
        ...store.historyByView,
        [currentViewIndex]: {
          undoStack: [...(vh.undoStack || []), currentJson],
          redoStack,
        },
      },
    });

    applySnapshot(snapshot);
  }, [fabricCanvasRef, currentViewIndex, applySnapshot]);

  return { pushHistory, undo, redo };
}
