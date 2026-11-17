/**
 * Empty-text placeholders — ONE mechanism for the template builder and the
 * customer designer.
 *
 * THE PROBLEM: a text layer whose text is empty used to disappear. The builder
 * removed the fabric object outright (Canvas.jsx: `if (!layer.text) { remove }`)
 * and the designer never created one (`if (layer.type === 'text' && layer.text)`).
 * Clearing the field to retype made the whole layer vanish from the canvas, and
 * a template layer authored empty on purpose could never be filled in at all.
 * Leaving the empty IText on the canvas is not enough either: an IText with no
 * text is about two pixels wide, so there is nothing to click.
 *
 * THE DESIGN:
 *
 *   The LAYER stays exactly what it was — its own IText, with text '', keeping
 *   its font, size, colour, anchor and `data`. It is still serialised, still
 *   carries its layerKey, still restores from a snapshot. Nothing about a layer
 *   is lost by having been empty, and restoring text needs no reconstruction:
 *   the object it goes back into is the same object.
 *
 *   A separate dashed Rect — the DECORATION — gives it a real clickable area.
 *   The decoration is pure chrome: it is created here, never authored, never
 *   saved, and never seen by an export.
 *
 * WHY THE DECORATION NEVER REACHES AN EXPORT OR A THUMBNAIL — three separate
 * mechanisms, because the pipeline has three separate paths:
 *
 *   1. Fabric's NATIVE `excludeFromExport: true` keeps it out of
 *      `canvas.toObject(['data'])`. That is the JSON that gets saved AND the
 *      JSON every offscreen render (thumbnail, 3x export PNG, vector SVG) is
 *      built from, so all of those are covered at the source.
 *   2. `data.excludeFromExport: true` is the plugin's own flag, which
 *      App.jsx#withoutExcludedObjects hides before the LIVE canvas 3x export
 *      render. Native and plugin flag are different properties that merely
 *      share a name — mixing them up has bitten this branch before.
 *   3. `withoutTextPlaceholders()` below, for the live-canvas thumbnail render:
 *      `toDataURL()` rasterises what is on screen and honours neither flag.
 *
 * LOCK STATE: the decoration mirrors its host. A locked layer's placeholder is
 * visible but not evented, exactly as a locked filled text layer is visible but
 * not selectable.
 *
 * Pure Fabric, no React and no app state, so the builder and the designer get
 * identical behaviour from identical code — the "one mechanism, two places"
 * duplication is what produced most of the defects on this branch.
 */

/** Marker on the decoration's `data`. */
export const PLACEHOLDER_FLAG = 'isTextPlaceholder';

const MIN_BOX_HEIGHT = 10;
const BOX_PADDING = 4;

/** Fabric 6 reports lowercase-hyphenated runtime types; be liberal. */
function isTextType(obj) {
  const t = String(obj?.type || '').toLowerCase();
  return t === 'i-text' || t === 'itext' || t === 'text' || t === 'textbox';
}

/**
 * A text object that currently has nothing in it, and is therefore invisible
 * and unclickable without help.
 *
 * Engraving text is excluded: it is a stroked Path whose content lives in
 * data.engravingText, not a text object at all.
 */
export function isEmptyTextObject(obj) {
  if (!obj || obj.data?.[PLACEHOLDER_FLAG]) return false;
  if (obj.data?.isZone || obj.data?.isZoneOverlay || obj.data?.isBackground) return false;
  if (!isTextType(obj)) return false;
  return String(obj.text ?? '') === '';
}

/** True for the dashed decoration itself. */
export function isTextPlaceholder(obj) {
  return !!obj?.data?.[PLACEHOLDER_FLAG];
}

/**
 * Geometry of the placeholder box: sits at the host's own anchor, with the
 * host's origin and angle, sized from the host's font size so it reads as
 * "text goes here, about this big".
 */
function placeholderGeometry(host) {
  const fontSize = Number(host.fontSize) || 24;
  const lineHeight = Number(host.lineHeight) || 1.16;
  const scaleX = Number(host.scaleX) || 1;
  const scaleY = Number(host.scaleY) || 1;
  const height = Math.max(MIN_BOX_HEIGHT, fontSize * lineHeight * scaleY) + BOX_PADDING * 2;
  const width = Math.max(fontSize * 3.5 * scaleX, 40) + BOX_PADDING * 2;
  return {
    left: Number(host.left) || 0,
    top: Number(host.top) || 0,
    originX: host.originX || 'left',
    originY: host.originY || 'top',
    angle: Number(host.angle) || 0,
    width,
    height,
  };
}

/**
 * Everything about the decoration that has to track its host: where it is, how
 * big it is, whether it is shown, and whether it can be clicked.
 *
 * `evented` mirrors the host's interactivity rather than being decided here, so
 * lock state needs no second rule to stay in step with the filled case.
 */
function refreshPlaceholder(deco, host) {
  const g = placeholderGeometry(host);
  const clickable = host.selectable !== false && host.evented !== false;
  deco.set({
    left: g.left,
    top: g.top,
    originX: g.originX,
    originY: g.originY,
    angle: g.angle,
    width: g.width,
    height: g.height,
    scaleX: 1,
    scaleY: 1,
    visible: host.visible !== false,
    evented: clickable,
    hoverCursor: clickable ? 'text' : 'default',
    opacity: host.opacity ?? 1,
  });
  deco.setCoords();
}

/**
 * Build the decoration. `RectCtor` is Fabric's Rect, passed in by the caller so
 * this module needs no import of its own and cannot end up bundling a second
 * copy of Fabric.
 */
function createPlaceholder(RectCtor, host) {
  const deco = new RectCtor({
    fill: 'rgba(148, 163, 184, 0.12)',
    stroke: '#7c8698',
    strokeWidth: 1,
    strokeDashArray: [6, 4],
    strokeUniform: true,
    rx: 3,
    ry: 3,
    selectable: false,
    hasControls: false,
    hasBorders: false,
    // Native flag: keeps it out of toObject()/toJSON()/toSVG(), hence out of
    // the saved design JSON and every offscreen render built from it.
    excludeFromExport: true,
    objectCaching: false,
    data: {
      [PLACEHOLDER_FLAG]: true,
      // Plugin flag: what App.jsx#withoutExcludedObjects looks for before the
      // live-canvas export render. Deliberately BOTH — see the file header.
      excludeFromExport: true,
    },
  });
  refreshPlaceholder(deco, host);
  return deco;
}

/**
 * Make the canvas hold exactly one decoration per empty text object: create
 * missing ones, refresh existing ones, drop orphans.
 *
 * Safe to call as often as you like — it is idempotent and returns true only
 * when it actually added or removed something.
 */
export function syncTextPlaceholders(canvas, RectCtor) {
  if (!canvas || !RectCtor) return false;
  // canvas.add()/remove() below fire object:added/object:removed, which the
  // bridge listens to; the guard stops that from recursing into a fresh sync
  // mid-pass.
  if (canvas.__sgpdPlaceholderSyncing) return false;
  canvas.__sgpdPlaceholderSyncing = true;

  let changed = false;
  try {
    const objects = canvas.getObjects();
    const hosts = objects.filter(isEmptyTextObject);

    objects.filter(isTextPlaceholder).forEach((deco) => {
      const host = deco.__sgpdHost;
      if (!host || hosts.indexOf(host) === -1) {
        if (host && host.__sgpdPlaceholder === deco) host.__sgpdPlaceholder = null;
        canvas.remove(deco);
        changed = true;
      }
    });

    hosts.forEach((host) => {
      let deco = host.__sgpdPlaceholder;
      if (deco && canvas.getObjects().indexOf(deco) === -1) deco = null;
      if (!deco) {
        deco = createPlaceholder(RectCtor, host);
        deco.__sgpdHost = host;
        host.__sgpdPlaceholder = deco;
        canvas.add(deco);
        changed = true;
      }
      refreshPlaceholder(deco, host);
      // Chrome belongs on top: it is never exported, and being under a template
      // graphic would make it unclickable — the one thing it exists for.
      canvas.bringObjectToFront(deco);
    });
  } finally {
    canvas.__sgpdPlaceholderSyncing = false;
  }

  if (changed) canvas.requestRenderAll();
  return changed;
}

/**
 * Keep placeholders in step with the canvas, and route a click on one back to
 * its host.
 *
 * `enterEditing` is the one difference between the two apps, and it is a UX
 * choice rather than a second rule: in the customer designer the only way to
 * put text back is to type on the canvas, so a click opens the caret straight
 * away. In the builder the text lives in the tree panel's Text field, so a
 * click selects the layer and lets the merchant type there.
 *
 * Returns a disposer.
 */
export function installTextPlaceholders(canvas, RectCtor, { enterEditing = false } = {}) {
  if (!canvas || !RectCtor) return () => {};

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    // A microtask, so a burst of object:added events during loadFromJSON
    // collapses into a single pass once the burst is over.
    Promise.resolve().then(() => {
      scheduled = false;
      if (canvas.__sgpdDisposed) return;
      syncTextPlaceholders(canvas, RectCtor);
    });
  };

  const onMouseUp = (opt) => {
    const deco = opt?.target;
    if (!isTextPlaceholder(deco)) return;
    const host = deco.__sgpdHost;
    if (!host || host.selectable === false || host.evented === false) return;
    // Deferred: Fabric finishes its own selection handling for this pointer
    // event synchronously, and would clear a selection made from inside the
    // handler. A microtask lands right after that, with no visible delay.
    Promise.resolve().then(() => {
      if (canvas.__sgpdDisposed) return;
      if (canvas.getObjects().indexOf(host) === -1) return;
      canvas.setActiveObject(host);
      if (enterEditing && typeof host.enterEditing === 'function') {
        host.enterEditing();
        if (host.hiddenTextarea && typeof host.hiddenTextarea.focus === 'function') {
          host.hiddenTextarea.focus();
        }
      }
      canvas.requestRenderAll();
    });
  };

  const events = [
    'object:added', 'object:removed', 'object:modified',
    'text:changed', 'text:editing:exited',
  ];
  events.forEach((name) => canvas.on(name, schedule));
  canvas.on('mouse:up', onMouseUp);
  schedule();

  return () => {
    events.forEach((name) => canvas.off(name, schedule));
    canvas.off('mouse:up', onMouseUp);
  };
}

/**
 * Run `fn` with every placeholder decoration hidden, then restore.
 *
 * For the LIVE-canvas thumbnail render: `toDataURL()` rasterises what is on
 * screen, so neither excludeFromExport flag can keep the dashed box out of it.
 * Restoration is in `finally` because this operates on the canvas the customer
 * is looking at — a throwing render must never leave chrome hidden in front of
 * them.
 */
export function withoutTextPlaceholders(canvas, fn) {
  const hidden = [];
  try {
    canvas.getObjects().forEach((o) => {
      if (isTextPlaceholder(o) && o.visible !== false) {
        hidden.push(o);
        o.visible = false;
      }
    });
    if (hidden.length) canvas.renderAll();
    return fn();
  } finally {
    if (hidden.length) {
      hidden.forEach((o) => { o.visible = true; });
      canvas.renderAll();
    }
  }
}
