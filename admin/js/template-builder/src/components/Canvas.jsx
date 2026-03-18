import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Canvas as FabricCanvas, Rect, FabricImage, FabricText, Path } from 'fabric';
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
    addZone, updateView, updateLayer, pushHistory, undo, redo, canUndo, canRedo,
    isFreeMove, setFreeMove,
  } = useTemplateStore();

  const permissions = useTemplateStore((s) => s.globalConfig?.permissions || {});

  const currentView = views[currentViewIndex];
  const viewKey = currentView?._clientId || currentViewIndex;

  // ── Zone enforcement helpers ─────────────────────────────────────────────

  const findZoneForPoint = useCallback((x, y, elementType) => {
    const zones = views[currentViewIndex]?.zones_config || [];
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (z.behavior !== 'restrict') continue;
      if (!(z.allowed_types || []).includes(elementType)) continue;
      if (x >= z.x && x <= z.x + z.width && y >= z.y && y <= z.y + z.height) {
        return i;
      }
    }
    return -1;
  }, [views, currentViewIndex]);

  const applyZoneClip = useCallback((obj, zoneIdx) => {
    if (isFreeMove) return;
    const zones = views[currentViewIndex]?.zones_config || [];
    if (zoneIdx < 0 || !zones[zoneIdx] || zones[zoneIdx].behavior !== 'restrict') return;
    const zone = zones[zoneIdx];

    if (zone.boundary_type === 'svg' && zone.svg_path_data) {
      obj.clipPath = new Path(zone.svg_path_data, {
        left:   zone.x,
        top:    zone.y,
        scaleX: zone.svg_scale || 1,
        scaleY: zone.svg_scale || 1,
        angle:  zone.svg_rotation || 0,
        absolutePositioned: true,
      });
    } else {
      obj.clipPath = new Rect({
        left:   zone.x,
        top:    zone.y,
        width:  zone.width,
        height: zone.height,
        absolutePositioned: true,
      });
    }
  }, [views, currentViewIndex, isFreeMove]);

  const clampToZone = useCallback((obj) => {
    if (isFreeMove) return;
    const zi = obj.data?.zoneIndex;
    const zones = views[currentViewIndex]?.zones_config || [];
    if (zi == null || zi < 0 || !zones[zi] || zones[zi].behavior !== 'restrict') return;

    const zone = zones[zi];
    const bound = obj.getBoundingRect();

    let left = obj.left;
    let top  = obj.top;

    if (bound.left < zone.x) left += zone.x - bound.left;
    if (bound.top  < zone.y) top  += zone.y - bound.top;
    if (bound.left + bound.width  > zone.x + zone.width)
      left -= (bound.left + bound.width) - (zone.x + zone.width);
    if (bound.top  + bound.height > zone.y + zone.height)
      top  -= (bound.top + bound.height) - (zone.y + zone.height);

    obj.set({ left, top });
    obj.setCoords();
  }, [views, currentViewIndex, isFreeMove]);

  const clampScaleToZone = useCallback((obj) => {
    if (isFreeMove) return;
    const zi = obj.data?.zoneIndex;
    const zones = views[currentViewIndex]?.zones_config || [];
    if (zi == null || zi < 0 || !zones[zi] || zones[zi].behavior !== 'restrict') return;

    const zone  = zones[zi];
    const perms = permissions[obj.data?.elementType] || {};
    const bound = obj.getBoundingRect();

    if (perms.max_scale != null) {
      if (obj.scaleX > perms.max_scale) obj.set({ scaleX: perms.max_scale });
      if (obj.scaleY > perms.max_scale) obj.set({ scaleY: perms.max_scale });
    }

    if (bound.width > zone.width || bound.height > zone.height) {
      const ratio = Math.min(zone.width / bound.width, zone.height / bound.height);
      let newScaleX = obj.scaleX * ratio;
      let newScaleY = obj.scaleY * ratio;
      if (perms.min_scale != null) {
        newScaleX = Math.max(newScaleX, perms.min_scale);
        newScaleY = Math.max(newScaleY, perms.min_scale);
      }
      obj.set({ scaleX: newScaleX, scaleY: newScaleY });
    }

    obj.setCoords();
    clampToZone(obj);
  }, [views, currentViewIndex, permissions, clampToZone, isFreeMove]);

  const snapToGrid = useCallback((obj) => {
    if (isFreeMove) return;
    const perms = permissions[obj.data?.elementType] || {};
    if (!perms.snap_to_grid) return;
    const grid = perms.grid_size || 10;
    obj.set({
      left: Math.round(obj.left / grid) * grid,
      top:  Math.round(obj.top  / grid) * grid,
    });
    obj.setCoords();
  }, [permissions, isFreeMove]);

  const applyPermissions = useCallback((obj, elementType) => {
    if (isFreeMove) return;
    const perms = permissions[elementType] || {};
    if (perms.resize === false) obj.set({ hasControls: false });
    if (perms.rotate === false && obj.controls?.mtr) obj.controls.mtr.visible = false;
    if (perms.min_scale != null) obj.set({ minScaleLimit: perms.min_scale });
  }, [permissions, isFreeMove]);

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
      enableRetinaScaling: false,
    });
    fabricRef.current = canvas;

    // Zone shapes are rendered by the real-time zone sync effect below.
    // Text layers are rendered by the real-time layer sync effect below.

    // Push history whenever an object is moved/scaled/rotated.
    let disposed = false;
    const onModified = () => {
      if (disposed) return;
      pushHistory(viewKey, canvas.toJSON());
    };
    canvas.on('object:modified', onModified);

    canvas.on('object:moving', (e) => {
      snapToGrid(e.target);
      clampToZone(e.target);
    });

    canvas.on('object:scaling', (e) => {
      clampScaleToZone(e.target);
    });

    canvas.on('text:changed', (e) => {
      const obj = e.target;
      if (!obj?.data?.elementType) return;
      const textPerms = permissions[obj.data.elementType] || {};
      const maxChars = textPerms.max_chars;
      if (maxChars && maxChars > 0 && obj.text && obj.text.length > maxChars) {
        obj.set({ text: obj.text.slice(0, maxChars) });
        canvas.renderAll();
      }
    });

    // Load background image; push initial history snapshot after it loads
    // so the first undo state includes the background.
    if (currentView?.background_url) {
      FabricImage.fromURL(currentView.background_url, { crossOrigin: 'anonymous' })
        .then((img) => {
          if (disposed) return;
          img.scaleToWidth(width);
          canvas.backgroundImage = img;
          canvas.renderAll();
          pushHistory(viewKey, canvas.toJSON());
        })
        .catch((err) => {
          if (disposed) return;
          console.warn('Background load failed:', err);
          // Background load failure is non-fatal; seed history without background.
          pushHistory(viewKey, canvas.toJSON());
        });
    } else {
      canvas.renderAll();
      pushHistory(viewKey, canvas.toJSON());
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

  // ── Real-time zone sync ─────────────────────────────────────────────────
  // When zones_config changes in the store (add/edit/delete), update the
  // Fabric zone rects to match.

  const zones = currentView?.zones_config || [];

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // Remove all existing zone rects from the canvas.
    const existing = canvas.getObjects().filter((o) => o.data?.isZone);
    existing.forEach((obj) => canvas.remove(obj));

    // Re-add zone shapes from current store state.
    zones.forEach((zone, index) => {
      let shape;
      if (zone.boundary_type === 'svg' && zone.svg_path_data) {
        shape = new Path(zone.svg_path_data, {
          left:        zone.x,
          top:         zone.y,
          scaleX:      zone.svg_scale || 1,
          scaleY:      zone.svg_scale || 1,
          angle:       zone.svg_rotation || 0,
          fill:        isFreeMove ? 'transparent' : 'rgba(59, 130, 246, 0.08)',
          stroke:      '#3b82f6',
          strokeWidth: 2,
          strokeDashArray: isFreeMove ? [6, 4] : undefined,
          selectable:  false,
          evented:     false,
          data:        { zoneIndex: index, isZone: true },
        });
      } else {
        shape = new Rect({
          left:        zone.x,
          top:         zone.y,
          width:       zone.width,
          height:      zone.height,
          fill:        isFreeMove ? 'transparent' : 'rgba(59, 130, 246, 0.15)',
          stroke:      '#3b82f6',
          strokeWidth: 2,
          strokeDashArray: isFreeMove ? [6, 4] : undefined,
          selectable:  false,
          evented:     false,
          data:        { zoneIndex: index, isZone: true },
        });
      }
      canvas.add(shape);
    });

    // Move zone rects to the bottom so they stay behind text/image layers.
    canvas.getObjects().forEach((obj) => {
      if (obj.data?.isZone) canvas.sendObjectToBack(obj);
    });

    canvas.renderAll();
  }, [zones, isFreeMove]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Real-time layer sync ────────────────────────────────────────────────
  // When zone-nested layers change in the store, update/add/remove fabric text
  // objects to match. This makes sidebar edits appear on the canvas instantly.

  const layers = (currentView?.zones_config || []).flatMap((zone, zoneIndex) =>
    (zone.layers || []).map((layer, layerIndex) => ({
      ...layer,
      _zoneIndex: zoneIndex,
      _layerIndex: layerIndex,
    }))
  );

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const fabricObjects = canvas.getObjects();

    // Build a map of existing text objects by layer key.
    const existingByKey = {};
    fabricObjects.forEach((obj) => {
      if (obj.data?.layerKey) {
        existingByKey[obj.data.layerKey] = obj;
      }
    });

    // Track which keys we've handled.
    const handledKeys = new Set();

    layers.forEach((layer) => {
      if (layer.type !== 'text') return;

      const existing = existingByKey[layer._key];

      if (!layer.text) {
        // No text content — remove existing object if any.
        if (existing) {
          canvas.remove(existing);
        }
        return;
      }

      if (existing) {
        // Update existing fabric text object.
        existing.set({
          text:       layer.text,
          left:       layer.left       || 100,
          top:        layer.top        || 100,
          fontSize:   layer.fontSize   || 24,
          fontFamily: layer.fontFamily || 'Arial',
          fill:       layer.fill       || '#000000',
          scaleX:     1,
          scaleY:     1,
          selectable: !layer.locked,
          evented:    !layer.locked,
        });
        // Update data in case zone/layer indices changed.
        existing.data = {
          ...existing.data,
          layerIndex: layer._layerIndex,
          zoneIndex:  layer._zoneIndex,
        };
        // Refresh clipPath in case zone config changed.
        const zi = layer._zoneIndex;
        if (zi != null && zi >= 0) {
          applyZoneClip(existing, zi);
        }
        handledKeys.add(layer._key);
      } else {
        // Create new fabric text object.
        const text = new FabricText(layer.text, {
          left:       layer.left       || 100,
          top:        layer.top        || 100,
          fontSize:   layer.fontSize   || 24,
          fontFamily: layer.fontFamily || 'Arial',
          fill:       layer.fill       || '#000000',
          selectable: !layer.locked,
          evented:    !layer.locked,
          data:       {
            layerKey:    layer._key,
            layerIndex:  layer._layerIndex,
            zoneIndex:   layer._zoneIndex,
            layerType:   layer.type,
            elementType: layer.type,
          },
        });
        canvas.add(text);
        applyPermissions(text, layer.type);
        const zi = layer._zoneIndex;
        if (zi >= 0) {
          applyZoneClip(text, zi);
          clampToZone(text);
        }
        handledKeys.add(layer._key);
      }
    });

    // Remove fabric objects for layers that no longer exist.
    Object.entries(existingByKey).forEach(([key, obj]) => {
      if (!handledKeys.has(key)) {
        canvas.remove(obj);
      }
    });

    canvas.renderAll();
  }, [layers]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync canvas object moves back to store ──────────────────────────────
  // When the user drags/resizes a text object on the canvas, update the
  // layer config in the store so the sidebar stays in sync.

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const onObjectModified = (e) => {
      const obj = e.target;
      if (!obj?.data?.layerType) return;

      if (obj.data.layerType === 'text') {
        // Convert canvas scale into fontSize so the layer sync can reset scale to 1.
        const newFontSize = Math.round((obj.fontSize || 24) * (obj.scaleX || 1));
        obj.set({ fontSize: newFontSize, scaleX: 1, scaleY: 1 });

        updateLayer(currentViewIndex, obj.data.zoneIndex, obj.data.layerIndex, {
          left:     Math.round(obj.left),
          top:      Math.round(obj.top),
          fontSize: newFontSize,
        });
      }
    };

    canvas.on('object:modified', onObjectModified);
    return () => canvas.off('object:modified', onObjectModified);
  }, [currentViewIndex, updateLayer]);

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

  const enableFreeMove = useCallback(() => {
    setFreeMove(true);
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.getObjects().forEach((obj) => {
      if (obj.data?.isZone || obj.data?.isZoneOverlay) return;
      obj.clipPath = undefined;
    });
    pushHistory(viewKey, canvas.toJSON());
    canvas.renderAll();
  }, [setFreeMove, pushHistory, viewKey]);

  const disableFreeMove = useCallback(() => {
    setFreeMove(false);
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.getObjects().forEach((obj) => {
      if (obj.data?.isZone || obj.data?.isZoneOverlay) return;
      if (obj.data?.zoneIndex >= 0) {
        applyZoneClip(obj, obj.data.zoneIndex);
        clampToZone(obj);
      }
    });
    pushHistory(viewKey, canvas.toJSON());
    canvas.renderAll();
  }, [setFreeMove, applyZoneClip, clampToZone, pushHistory, viewKey]);

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

      // Remove the draft rect — the zone sync effect will recreate a proper
      // zone rect (with data.isZone) once addZone updates the store.
      canvas.remove(rect);

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

      disableDrawMode();
      pushHistory(viewKey, canvas.toJSON());
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

      const snapshot = isUndo ? undo(viewKey) : redo(viewKey);
      if (snapshot && fabricRef.current) {
        fabricRef.current.loadFromJSON(snapshot)
          .then(() => fabricRef.current?.renderAll());
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [currentViewIndex, undo, redo]);

  // ── Background image via WP Media Library ────────────────────────────────

  const openMediaPicker = useCallback(() => {
    if (!window.wp?.media) return;

    const frame = window.wp.media({
      title: 'Select Background Image',
      button: { text: 'Set Background' },
      multiple: false,
      library: { type: 'image' },
    });

    frame.on('select', () => {
      const attachment = frame.state().get('selection').first().toJSON();
      const url = attachment.url;

      updateView(currentViewIndex, { background_url: url });

      const canvas = fabricRef.current;
      if (canvas) {
        FabricImage.fromURL(url, { crossOrigin: 'anonymous' })
          .then((img) => {
            img.scaleToWidth(canvas.width);
            canvas.backgroundImage = img;
            canvas.renderAll();
            pushHistory(viewKey, canvas.toJSON());
          });
      }
    });

    frame.open();
  }, [currentViewIndex, updateView, pushHistory]);

  const removeBackground = useCallback(() => {
    updateView(currentViewIndex, { background_url: '' });
    const canvas = fabricRef.current;
    if (canvas) {
      canvas.backgroundImage = undefined;
      canvas.renderAll();
      pushHistory(viewKey, canvas.toJSON());
    }
  }, [currentViewIndex, updateView, pushHistory]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const applyUndo = () => {
    const snap = undo(viewKey);
    if (snap && fabricRef.current) {
      fabricRef.current.loadFromJSON(snap).then(() => fabricRef.current?.renderAll());
    }
  };

  const applyRedo = () => {
    const snap = redo(viewKey);
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
          className={`pd-canvas-toolbar__btn${isFreeMove ? ' pd-canvas-toolbar__btn--active' : ''}`}
          onClick={isFreeMove ? disableFreeMove : enableFreeMove}
          title={isFreeMove ? 'Enable zone enforcement' : 'Disable zone enforcement for free positioning'}
        >
          {isFreeMove ? 'Enforce Zones' : 'Free Move'}
        </button>
        <button
          className="pd-canvas-toolbar__btn"
          onClick={openMediaPicker}
          title="Set background image"
        >
          {currentView?.background_url ? 'Change Background' : 'Set Background'}
        </button>
        {currentView?.background_url && (
          <button
            className="pd-canvas-toolbar__btn"
            onClick={removeBackground}
            title="Remove background image"
          >
            Remove BG
          </button>
        )}
        <button
          className="pd-canvas-toolbar__btn"
          onClick={applyUndo}
          disabled={!canUndo(viewKey)}
          title="Undo (Ctrl+Z)"
        >
          ↩ Undo
        </button>
        <button
          className="pd-canvas-toolbar__btn"
          onClick={applyRedo}
          disabled={!canRedo(viewKey)}
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
