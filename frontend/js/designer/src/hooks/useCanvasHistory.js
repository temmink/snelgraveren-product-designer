import { useCallback } from 'react';
import useDesignerStore from '../store/useDesignerStore';
import { filterFabricJson } from '../utils/fabricJson';
import { reapplyPostRestoreState } from '../utils/postRestoreState';
import { recordState, undoStep, redoStep } from '../utils/historyModel';

// Shared by EVERY instance of this hook. There are two — DesignerCanvas (which
// records changes and backs Ctrl+Z) and Toolbar (the buttons customers click)
// — but only one canvas. While these lived in per-instance refs, a restore
// started from the Toolbar raised the Toolbar's guard only: the canvas events
// that restore fired went to DesignerCanvas's instance, whose own guard was
// down, and the restored state was recorded as a brand-new change.
const shared = {
  restoring: false,
  timer: null,
  pending: null,     // () => void — the debounced record, so undo can flush it
  settling: true,    // true until the customer touches the designer
};

/** A freshly built canvas is assembling itself; nothing recorded is the customer's yet. */
export function beginHistorySettling() {
  shared.settling = true;
}

/** The customer did something — from here on every recorded state is a step. */
export function endHistorySettling() {
  shared.settling = false;
}

function flushPending() {
  if (!shared.pending) return;
  clearTimeout(shared.timer);
  const run = shared.pending;
  shared.pending = null;
  run();
}

function commitHistory(viewIndex, next) {
  const store = useDesignerStore.getState();
  useDesignerStore.setState({
    historyByView: { ...store.historyByView, [viewIndex]: next },
  });
}

// Every snapshot of a view is a state worth going back to. The sidebar
// (font, size, colour, the text field, filters) edits an object directly and
// then calls snapshotView — it has no canvas event to hang a history record
// on, which is why those edits could not be undone. Recording from the
// snapshot itself covers every such edit, present and future, in one place.
// Same debounce and the same guards as a record from the canvas.
useDesignerStore.subscribe((state, prev) => {
  if (state.canvasSnapshots === prev.canvasSnapshots || shared.restoring) return;
  const changed = Object.keys(state.canvasSnapshots)
    .find((k) => state.canvasSnapshots[k] !== prev.canvasSnapshots[k]);
  if (changed === undefined) return;
  const viewIndex = Number(changed);
  const json = state.canvasSnapshots[changed];
  if (!json) return;

  clearTimeout(shared.timer);
  shared.pending = () => {
    if (shared.restoring) return;
    const store = useDesignerStore.getState();
    commitHistory(viewIndex, recordState(
      store.historyByView[viewIndex], json, { settling: shared.settling },
    ));
  };
  shared.timer = setTimeout(flushPending, 300);
});

// `applyPermissionsRef` is DesignerCanvas's applyPermissions callback, handed
// over by ref (it's defined further down in that component, after this hook
// is called — see the comment at the DesignerCanvas call site). Read via
// .current at restore time, never captured by value, so this hook always
// uses the latest permissions/canvasWidth/widthMm closure.
export default function useCanvasHistory(fabricCanvasRef, currentViewIndex, applyPermissionsRef) {
  const pushHistory = useCallback(() => {
    if (shared.restoring) return;
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    clearTimeout(shared.timer);
    shared.pending = () => {
      if (shared.restoring) return;
      // The canvas this was scheduled for may be gone (view switch).
      if (fabricCanvasRef.current !== canvas) return;
      const store = useDesignerStore.getState();
      commitHistory(currentViewIndex, recordState(
        store.historyByView[currentViewIndex],
        canvas.toObject(['data']),
        { settling: shared.settling },
      ));
    };
    shared.timer = setTimeout(flushPending, 300);
  }, [fabricCanvasRef, currentViewIndex]);

  const applySnapshot = useCallback((snapshot) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !snapshot) return;
    shared.restoring = true;
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
        // Events fired by the restore may have queued a record; it would only
        // re-record what was just applied, so drop it with the guard.
        clearTimeout(shared.timer);
        shared.pending = null;
        shared.restoring = false;
      });
  }, [fabricCanvasRef, currentViewIndex, applyPermissionsRef]);

  const step = useCallback((stepFn) => {
    if (shared.restoring) return;
    if (!fabricCanvasRef.current) return;
    // A change made in the last 300 ms is not on the stack yet; without this
    // the step would skip straight past it.
    flushPending();
    const result = stepFn(useDesignerStore.getState().historyByView[currentViewIndex]);
    if (!result) return;
    commitHistory(currentViewIndex, result.history);
    applySnapshot(result.state);
  }, [fabricCanvasRef, currentViewIndex, applySnapshot]);

  const undo = useCallback(() => step(undoStep), [step]);
  const redo = useCallback(() => step(redoStep), [step]);

  return { pushHistory, undo, redo };
}
