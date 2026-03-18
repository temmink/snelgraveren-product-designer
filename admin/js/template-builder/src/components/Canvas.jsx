import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Canvas as FabricCanvas, Rect, FabricImage } from 'fabric';
import useTemplateStore from '../store/useTemplateStore';

export default function Canvas() {
  const canvasEl    = useRef(null);
  const fabricRef   = useRef(null);
  const isDrawing   = useRef(false);
  const drawStart   = useRef(null);
  const draftRect   = useRef(null);

  const [isDrawMode, setIsDrawMode] = useState(false);

  const {
    views, currentViewIndex,
    addZone, pushHistory, undo, redo, canUndo, canRedo,
  } = useTemplateStore();

  const currentView = views[currentViewIndex];

  // ── Fabric initialisation ─────────────────────────────────────────────────

  useEffect(() => {
    if (!canvasEl.current) return;

    // Reset draw-mode state for the new view.
    setIsDrawMode(false);
    isDrawing.current = false;
    draftRect.current = null;

    const width  = currentView?.canvas_width  || 800;
    const height = currentView?.canvas_height || 600;

    const canvas = new FabricCanvas(canvasEl.current, {
      width,
      height,
      selection: true,
      preserveObjectStacking: true,
    });
    fabricRef.current = canvas;

    // Draw existing zone rects.
    const zones = currentView?.zones_config || [];
    zones.forEach((zone, index) => {
      const rect = new Rect({
        left:        zone.x,
        top:         zone.y,
        width:       zone.width,
        height:      zone.height,
        fill:        'rgba(59, 130, 246, 0.15)',
        stroke:      '#3b82f6',
        strokeWidth: 2,
        selectable:  true,
        data:        { zoneIndex: index },
      });
      canvas.add(rect);
    });

    // Push history whenever an object is moved/scaled/rotated.
    let disposed = false;
    const onModified = () => {
      if (disposed) return;
      pushHistory(currentViewIndex, canvas.toJSON());
    };
    canvas.on('object:modified', onModified);

    // Load background image; push initial history snapshot after it loads
    // so the first undo state includes the background.
    if (currentView?.background_image_url) {
      FabricImage.fromURL(currentView.background_image_url, { crossOrigin: 'anonymous' })
        .then((img) => {
          if (disposed) return;
          img.set({ selectable: false, evented: false });
          img.scaleToWidth(width);
          canvas.set('backgroundImage', img);
          canvas.renderAll();
          pushHistory(currentViewIndex, canvas.toJSON());
        })
        .catch(() => {
          if (disposed) return;
          // Background load failure is non-fatal; seed history without background.
          pushHistory(currentViewIndex, canvas.toJSON());
        });
    } else {
      canvas.renderAll();
      pushHistory(currentViewIndex, canvas.toJSON());
    }

    // Intentionally omit currentView/pushHistory from deps: we only want to
    // re-initialise the Fabric canvas when the active view index changes, not on
    // every Zustand state update. currentView and pushHistory are read inside
    // the effect via closure and are stable enough for this purpose.
    return () => {
      disposed = true;
      canvas.dispose();
      fabricRef.current = null;
    };
  }, [currentViewIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zone drawing ──────────────────────────────────────────────────────────

  const enableDrawMode = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    setIsDrawMode(true);
    c.selection       = false;
    c.defaultCursor   = 'crosshair';
    c.hoverCursor     = 'crosshair';
  }, []);

  const disableDrawMode = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    setIsDrawMode(false);
    c.selection     = true;
    c.defaultCursor = 'default';
    c.hoverCursor   = 'move';
  }, []);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const onMouseDown = (opt) => {
      if (!isDrawMode) return;
      const ptr = canvas.getPointer(opt.e);
      isDrawing.current = true;
      drawStart.current = ptr;

      const rect = new Rect({
        left: ptr.x, top: ptr.y, width: 0, height: 0,
        fill: 'rgba(59, 130, 246, 0.15)',
        stroke: '#3b82f6', strokeWidth: 2,
        selectable: false, evented: false,
      });
      canvas.add(rect);
      draftRect.current = rect;
    };

    const onMouseMove = (opt) => {
      if (!isDrawing.current || !draftRect.current) return;
      const ptr = canvas.getPointer(opt.e);
      const s   = drawStart.current;
      draftRect.current.set({
        left:   Math.min(s.x, ptr.x),
        top:    Math.min(s.y, ptr.y),
        width:  Math.abs(ptr.x - s.x),
        height: Math.abs(ptr.y - s.y),
      });
      canvas.renderAll();
    };

    const onMouseUp = () => {
      if (!isDrawing.current || !draftRect.current) return;
      isDrawing.current = false;

      const rect = draftRect.current;
      draftRect.current = null;

      // Discard tiny accidental drags.
      if (rect.width < 10 || rect.height < 10) {
        canvas.remove(rect);
        canvas.renderAll();
        return;
      }

      const viewZones = views[currentViewIndex]?.zones_config || [];
      addZone(currentViewIndex, {
        x:             Math.round(rect.left),
        y:             Math.round(rect.top),
        width:         Math.round(rect.width),
        height:        Math.round(rect.height),
        name:          `Zone ${viewZones.length + 1}`,
        type:          'safe_area',
        allowed_types: ['text', 'image', 'svg'],
        behavior:      'restrict',
        mask_svg_url:  '',
      });

      rect.set({ selectable: true, evented: true });
      canvas.setActiveObject(rect);
      disableDrawMode();
      pushHistory(currentViewIndex, canvas.toJSON());
    };

    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up',   onMouseUp);

    return () => {
      canvas.off('mouse:down', onMouseDown);
      canvas.off('mouse:move', onMouseMove);
      canvas.off('mouse:up',   onMouseUp);
    };
  }, [isDrawMode, currentViewIndex, views, addZone, disableDrawMode, pushHistory]);

  // ── Keyboard undo/redo ────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e) => {
      // Don't intercept undo in text inputs — let the browser handle those.
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;

      const isUndo = (e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey;
      const isRedo = (e.ctrlKey || e.metaKey) && e.key === 'z' &&  e.shiftKey;

      if (!isUndo && !isRedo) return;
      e.preventDefault();

      const snapshot = isUndo ? undo(currentViewIndex) : redo(currentViewIndex);
      if (snapshot && fabricRef.current) {
        fabricRef.current.loadFromJSON(snapshot)
          .then(() => fabricRef.current?.renderAll());
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [currentViewIndex, undo, redo]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const applyUndo = () => {
    const snap = undo(currentViewIndex);
    if (snap && fabricRef.current) {
      fabricRef.current.loadFromJSON(snap).then(() => fabricRef.current?.renderAll());
    }
  };

  const applyRedo = () => {
    const snap = redo(currentViewIndex);
    if (snap && fabricRef.current) {
      fabricRef.current.loadFromJSON(snap).then(() => fabricRef.current?.renderAll());
    }
  };

  return (
    <div className="pd-canvas-wrap">
      <div className="pd-canvas-toolbar">
        <button
          className={`pd-canvas-toolbar__btn${isDrawMode ? ' pd-canvas-toolbar__btn--active' : ''}`}
          onClick={isDrawMode ? disableDrawMode : enableDrawMode}
          title={isDrawMode ? 'Cancel (Esc)' : 'Draw zone'}
        >
          {isDrawMode ? '✕ Cancel' : '⬚ Draw Zone'}
        </button>
        <button
          className="pd-canvas-toolbar__btn"
          onClick={applyUndo}
          disabled={!canUndo(currentViewIndex)}
          title="Undo (Ctrl+Z)"
        >
          ↩ Undo
        </button>
        <button
          className="pd-canvas-toolbar__btn"
          onClick={applyRedo}
          disabled={!canRedo(currentViewIndex)}
          title="Redo (Ctrl+Shift+Z)"
        >
          ↪ Redo
        </button>
      </div>
      <div className="pd-canvas-scroll">
        <canvas ref={canvasEl} />
      </div>
    </div>
  );
}
