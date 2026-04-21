import { useCallback, useRef } from 'react';
import useDesignerStore from '../store/useDesignerStore';
import { filterFabricJson } from '../utils/fabricJson';

export default function useCanvasHistory(fabricCanvasRef, currentViewIndex) {
  const debounceTimer = useRef(null);
  const isRestoring = useRef(false);

  const pushHistory = useCallback(() => {
    if (isRestoring.current) return;
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      if (isRestoring.current) return;
      const json = canvas.toJSON(['data']);
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
        canvas.renderAll();
        useDesignerStore.getState().snapshotView(currentViewIndex, canvas.toJSON(['data']));
      })
      .finally(() => {
        isRestoring.current = false;
      });
  }, [fabricCanvasRef, currentViewIndex]);

  const undo = useCallback(() => {
    const store = useDesignerStore.getState();
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const vh = store.historyByView[currentViewIndex];
    if (!vh || vh.undoStack.length === 0) return;

    // Save current state to redo before applying undo
    const currentJson = canvas.toJSON(['data']);
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

    const currentJson = canvas.toJSON(['data']);
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
