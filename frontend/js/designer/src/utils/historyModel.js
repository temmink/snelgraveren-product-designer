// Undo/redo as pure functions over one view's history:
//   { undoStack: [...states], redoStack: [...states] }
//
// THE INVARIANT: the top of undoStack IS the state currently on the canvas.
// Every state below it is something the customer can go back to.
//
// The model this replaces recorded a state AFTER each change and then, on
// undo, popped that same state and applied it — restoring what was already on
// screen. The first undo therefore did nothing, and because the visible
// buttons and the canvas each ran their own "restoring" guard, that restore
// was recorded again as a fresh change, so no number of clicks ever got back
// (measured 2026-11: add a text, click Undo twice, the text is still there).

export const MAX_HISTORY = 31; // 30 steps back + the current state

const sameState = (a, b) => {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (_) {
    return false;
  }
};

export const emptyHistory = () => ({ undoStack: [], redoStack: [] });

/**
 * Record `state` as the current one.
 *
 * `settling` is true until the customer has touched the designer: the canvas
 * is still assembling itself then (template layers, images that arrive late),
 * and none of that is something the customer did. Those states replace the
 * baseline instead of stacking on it, so Undo can never peel a template layer
 * off the product.
 */
export function recordState(history, state, { settling = false } = {}) {
  const h = history || emptyHistory();
  const top = h.undoStack[h.undoStack.length - 1];

  if (h.undoStack.length > 0 && sameState(top, state)) return h;

  if (settling && h.undoStack.length <= 1) {
    return { undoStack: [state], redoStack: h.redoStack };
  }

  return {
    undoStack: [...h.undoStack, state].slice(-MAX_HISTORY),
    redoStack: [],
  };
}

export const canUndo = (history) => (history?.undoStack?.length || 0) > 1;
export const canRedo = (history) => (history?.redoStack?.length || 0) > 0;

/**
 * Step back. Returns { history, state } where `state` is what the canvas must
 * now show, or null when there is nothing to go back to.
 */
export function undoStep(history) {
  if (!canUndo(history)) return null;
  const undoStack = history.undoStack.slice(0, -1);
  const current = history.undoStack[history.undoStack.length - 1];
  return {
    history: { undoStack, redoStack: [...history.redoStack, current] },
    state: undoStack[undoStack.length - 1],
  };
}

/** Step forward again. Same return shape as undoStep. */
export function redoStep(history) {
  if (!canRedo(history)) return null;
  const redoStack = history.redoStack.slice(0, -1);
  const state = history.redoStack[history.redoStack.length - 1];
  return {
    history: { undoStack: [...history.undoStack, state], redoStack },
    state,
  };
}
