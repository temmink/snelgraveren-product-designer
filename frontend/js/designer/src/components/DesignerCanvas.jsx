import React, { useRef, useEffect, useCallback } from 'react';
import { __ } from '@wordpress/i18n';
import { Canvas as FabricCanvas, Rect, IText, FabricImage, loadSVGFromString, util } from 'fabric';
import useDesignerStore from '../store/useDesignerStore';
import { uploadFile } from '../api/designerApi';
import useCanvasScale from '../hooks/useCanvasScale';
import useIsMobile from '../hooks/useIsMobile';

// Fabric.js 6.x uses PascalCase in JSON but lowercase-hyphenated at runtime.
// Accept both forms for safe whitelist filtering.
const ALLOWED_FABRIC_TYPES = new Set([
  'IText', 'Image', 'Rect', 'Path', 'Group',
  'i-text', 'image', 'rect', 'path', 'group',
]);

// Infer element type from Fabric object type when data.elementType is missing
// (e.g. designs saved before data serialisation was added).
function inferElementType(obj) {
  if (obj.data?.elementType) return obj.data.elementType;
  const t = (obj.type || '').toLowerCase();
  if (t === 'itext' || t === 'i-text') return 'text';
  if (t === 'image') return 'image';
  if (t === 'path' || t === 'group') return 'svg';
  return 'unknown';
}

function filterFabricJson(json) {
  if (!json || !json.objects) return json;
  return {
    ...json,
    objects: json.objects.filter((obj) => ALLOWED_FABRIC_TYPES.has(obj.type)),
  };
}

export default function DesignerCanvas() {
  const canvasEl  = useRef(null);
  const fabricRef = useRef(null);
  const fileInputRef = useRef(null);

  // Stable refs for callbacks used in canvas event handlers to avoid stale closures.
  const clampToZoneRef     = useRef(null);
  const clampScaleRef      = useRef(null);
  const snapToGridRef      = useRef(null);
  const snapshotViewRef    = useRef(null);
  const currentViewIndexRef = useRef(0);

  const isMobile = useIsMobile();
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile; // keep ref in sync for event handlers

  const {
    template, currentViewIndex, activeTool,
    canvasSnapshots, snapshotView, setActiveTool,
    setSelectedObject, setError, setTriggerFileUpload, setFabricCanvasRef,
  } = useDesignerStore();

  const currentView = template?.views?.[currentViewIndex];
  const zones = currentView?.zones_config || [];
  const globalConfig = template?.global_config || {};
  const permissions = globalConfig.permissions || {};

  const canvasWidth = currentView?.canvas_width || 800;
  const canvasHeight = currentView?.canvas_height || 600;
  const { scale, containerRef: scaleContainerRef } = useCanvasScale(canvasWidth);

  // ── Zone helpers ──────────────────────────────────────────────────────────

  const findZoneForPoint = useCallback((x, y, elementType) => {
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (z.behavior !== 'restrict') continue;
      if (!(z.allowed_types || []).includes(elementType)) continue;
      if (x >= z.x && x <= z.x + z.width && y >= z.y && y <= z.y + z.height) {
        return i;
      }
    }
    return -1;
  }, [zones]);

  const findFirstZoneForType = useCallback((elementType) => {
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (z.behavior !== 'restrict') continue;
      if ((z.allowed_types || []).includes(elementType)) return i;
    }
    return -1;
  }, [zones]);

  // ── Clip object to its zone ───────────────────────────────────────────────

  const applyZoneClip = useCallback((obj, zoneIdx) => {
    if (zoneIdx < 0 || !zones[zoneIdx] || zones[zoneIdx].behavior !== 'restrict') return;
    const zone = zones[zoneIdx];

    if (zone.boundary_type === 'svg') {
      // Clone the zone boundary group from the canvas for use as clip path
      const canvas = fabricRef.current;
      if (!canvas) return;
      const zoneObj = canvas.getObjects().find(
        (o) => o.data?.isZoneOverlay && o.data?.zoneIndex === zoneIdx
      );
      if (zoneObj) {
        zoneObj.clone().then((cloned) => {
          cloned.set({ absolutePositioned: true });
          if (cloned.getObjects) {
            cloned.getObjects().forEach((c) => c.set({ fill: '#000000' }));
          }
          obj.clipPath = cloned;
          canvas.renderAll();
        });
      }
    } else {
      obj.clipPath = new Rect({
        left:   zone.x,
        top:    zone.y,
        width:  zone.width,
        height: zone.height,
        absolutePositioned: true,
      });
    }
  }, [zones]);

  // ── Apply permissions to a fabric object ──────────────────────────────────

  const applyPermissions = useCallback((obj, elementType) => {
    const perms = permissions[elementType] || {};

    if (perms.resize === false) {
      obj.set({ hasControls: false });
    }

    if (perms.rotate === false) {
      obj.setControlVisible('mtr', false);
    }

    if (perms.min_scale != null) {
      obj.set({ minScaleLimit: perms.min_scale });
    }
  }, [permissions]);

  // ── Clamp object inside its assigned zone ─────────────────────────────────

  const clampToZone = useCallback((obj) => {
    const zi = obj.data?.zoneIndex;
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
  }, [zones]);

  const clampScaleToZone = useCallback((obj) => {
    const zi = obj.data?.zoneIndex;
    if (zi == null || zi < 0 || !zones[zi] || zones[zi].behavior !== 'restrict') return;

    const zone  = zones[zi];
    const perms = permissions[obj.data?.elementType] || {};
    const bound = obj.getBoundingRect();

    // Enforce max_scale
    if (perms.max_scale != null) {
      if (obj.scaleX > perms.max_scale) obj.set({ scaleX: perms.max_scale });
      if (obj.scaleY > perms.max_scale) obj.set({ scaleY: perms.max_scale });
    }

    // If bounding rect exceeds zone, scale down (but respect min_scale)
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
  }, [zones, permissions, clampToZone]);

  // ── Snap to grid ──────────────────────────────────────────────────────────

  const snapToGrid = useCallback((obj) => {
    const perms = permissions[obj.data?.elementType] || {};
    if (!perms.snap_to_grid) return;
    const grid = perms.grid_size || 10;
    obj.set({
      left: Math.round(obj.left / grid) * grid,
      top:  Math.round(obj.top / grid) * grid,
    });
    obj.setCoords();
  }, [permissions]);

  // ── Sync refs so canvas event handlers always use the latest callbacks ───
  clampToZoneRef.current      = clampToZone;
  clampScaleRef.current       = clampScaleToZone;
  snapToGridRef.current       = snapToGrid;
  snapshotViewRef.current     = snapshotView;
  currentViewIndexRef.current = currentViewIndex;

  // ── Canvas init ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!canvasEl.current || !currentView) return;

    const width  = currentView.canvas_width  || 800;
    const height = currentView.canvas_height || 600;

    const canvas = new FabricCanvas(canvasEl.current, {
      width,
      height,
      selection: true,
      preserveObjectStacking: true,
      enableRetinaScaling: false,
    });
    fabricRef.current = canvas;
    setFabricCanvasRef(canvas);

    // Disable multi-select on mobile (too error-prone with touch)
    if (isMobileRef.current) {
      canvas.selection = false;
    }

    // Apply mobile-friendly controls to every object added to the canvas
    canvas.on('object:added', (e) => {
      const obj = e.target;
      if (!isMobileRef.current || !obj || obj.data?.isZoneOverlay) return;
      obj.set({
        cornerSize: 28,
        touchCornerSize: 40,
        cornerStyle: 'circle',
        transparentCorners: false,
        cornerColor: '#2563eb',
        borderColor: '#2563eb',
      });
    });

    let disposed = false;
    let canvasReady = false;

    // Render zone shapes
    const svgZonePromises = [];
    zones.forEach((zone, index) => {
      const isRestrict = zone.behavior === 'restrict';

      if (zone.boundary_type === 'svg' && zone.svg_url) {
        // Load SVG from URL asynchronously
        const promise = fetch(zone.svg_url)
          .then((r) => r.text())
          .then((svgString) => loadSVGFromString(svgString))
          .then(({ objects, options }) => {
            if (disposed) return;
            const filtered = objects.filter(Boolean);
            if (filtered.length === 0) return;
            const group = util.groupSVGElements(filtered, options);
            group.set({
              left:        zone.x,
              top:         zone.y,
              scaleX:      zone.svg_scale || 1,
              scaleY:      zone.svg_scale || 1,
              angle:       zone.svg_rotation || 0,
              selectable:  false,
              evented:     false,
              data:        { zoneIndex: index, isZoneOverlay: true },
            });
            // Show a subtle boundary outline so customers can see the design area.
            // Child paths get the visible stroke; group stroke is nulled (Fabric draws group stroke as a bounding rect).
            if (group.getObjects) {
              group.getObjects().forEach((c) => c.set({ fill: 'rgba(0, 0, 0, 0.03)', stroke: '#cccccc', strokeWidth: 1, strokeUniform: true }));
            }
            group.set({ stroke: null, strokeWidth: 0 });
            canvas.add(group);
            canvas.sendObjectToBack(group);
            canvas.renderAll();

            // Apply clip paths to any template layers already on canvas for this zone
            canvas.getObjects().forEach((obj) => {
              if (obj.data?.zoneIndex === index && !obj.data?.isZoneOverlay && zone.behavior === 'restrict') {
                group.clone().then((cloned) => {
                  cloned.set({ absolutePositioned: true });
                  if (cloned.getObjects) {
                    cloned.getObjects().forEach((c) => c.set({ fill: '#000000' }));
                  }
                  obj.clipPath = cloned;
                  canvas.renderAll();
                });
              }
            });
          })
          .catch(() => {});
        svgZonePromises.push(promise);
      } else {
        const shape = new Rect({
          left:            zone.x,
          top:             zone.y,
          width:           zone.width,
          height:          zone.height,
          fill:            'transparent',
          stroke:          'transparent',
          strokeWidth:     0,
          selectable:      false,
          evented:         false,
          data:            { zoneIndex: index, isZoneOverlay: true },
        });
        canvas.add(shape);
      }
    });

    // Load background image
    if (currentView.background_url) {
      FabricImage.fromURL(currentView.background_url, { crossOrigin: 'anonymous' })
        .then((img) => {
          if (disposed) return;
          const t = currentView.background_transform || {};
          img.set({ selectable: false, evented: false });
          if (t.scaleX) {
            img.set({ scaleX: t.scaleX, scaleY: t.scaleY || t.scaleX, left: t.left || 0, top: t.top || 0 });
          } else {
            img.scaleToWidth(width);
          }
          canvas.backgroundImage = img;
          canvas.renderAll();
        })
        .catch(() => {});
    }

    // Render pre-placed template layers from zones.
    zones.forEach((zone, zoneIdx) => {
      (zone.layers || []).forEach((layer) => {
        if (layer.type === 'text' && layer.text) {
          const text = new IText(layer.text, {
            left:       layer.left       || zone.x + 20,
            top:        layer.top        || zone.y + 20,
            fontSize:   layer.fontSize   || 24,
            fontFamily: layer.fontFamily || 'Arial',
            fill:       layer.fill       || '#000000',
            data:       { elementType: 'text', zoneIndex: zoneIdx },
          });
          applyPermissions(text, 'text');
          if (zone.behavior === 'restrict') applyZoneClip(text, zoneIdx);
          canvas.add(text);
          if (zone.behavior === 'restrict') clampToZone(text);
        }
      });
    });

    // Restore snapshot if switching back to a previously edited view
    // Read latest from store to avoid stale closure
    const latestSnapshots = useDesignerStore.getState().canvasSnapshots;
    const existing = latestSnapshots[currentViewIndex];
    if (existing) {
      const filtered = filterFabricJson(existing);
      canvas.loadFromJSON(filtered).then(() => {
        if (!disposed) {
          canvas.renderAll();
          canvasReady = true;
        }
      });
    } else {
      canvasReady = true;
    }

    // ── Event handlers ────────────────────────────────────────────────────

    canvas.on('object:moving', (e) => {
      snapToGridRef.current?.(e.target);
      clampToZoneRef.current?.(e.target);
    });

    canvas.on('object:scaling', (e) => {
      clampScaleRef.current?.(e.target);
    });

    canvas.on('object:modified', () => {
      if (!disposed) snapshotViewRef.current?.(currentViewIndexRef.current, canvas.toJSON(['data']));
    });

    // Enforce max_chars on in-canvas text editing
    canvas.on('text:changed', (e) => {
      const obj = e.target;
      if (!obj?.data?.elementType) return;
      const perms = useDesignerStore.getState().template?.global_config?.permissions || {};
      const textPerms = perms[obj.data.elementType] || {};
      const maxChars = textPerms.max_chars;
      if (maxChars && maxChars > 0 && obj.text && obj.text.length > maxChars) {
        obj.set({ text: obj.text.slice(0, maxChars) });
        canvas.renderAll();
      }
    });

    canvas.on('object:removed', () => {
      if (!disposed) snapshotViewRef.current?.(currentViewIndexRef.current, canvas.toJSON(['data']));
    });

    canvas.on('selection:created', (e) => {
      const obj = e.selected?.[0];
      if (obj && !obj.data?.isZoneOverlay) {
        setSelectedObject({
          type: inferElementType(obj),
          fabricObj: obj,
        });
      }
    });

    canvas.on('selection:updated', (e) => {
      const obj = e.selected?.[0];
      if (obj && !obj.data?.isZoneOverlay) {
        setSelectedObject({
          type: inferElementType(obj),
          fabricObj: obj,
        });
      }
    });

    canvas.on('selection:cleared', () => {
      setSelectedObject(null);
    });

    // Delete key handler
    const onKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;

        const active = canvas.getActiveObject();
        if (!active || active.data?.isZoneOverlay) return;

        const perms = permissions[active.data?.elementType] || {};
        if (perms.delete === false) return;

        e.preventDefault();
        canvas.remove(active);
        canvas.discardActiveObject();
        canvas.renderAll();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    canvas.renderAll();

    return () => {
      // Only snapshot if canvas finished loading — prevents overwriting
      // good snapshots with incomplete state during fast view switching
      if (!disposed && canvasReady && fabricRef.current) {
        snapshotView(currentViewIndex, fabricRef.current.toJSON(['data']));
      }
      disposed = true;
      document.removeEventListener('keydown', onKeyDown);
      canvas.dispose();
      fabricRef.current = null;
    };
  }, [currentViewIndex, template]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply responsive zoom via Fabric.js (NOT CSS transform — that breaks pointer math)
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.setZoom(scale);
    canvas.setDimensions(
      { width: canvasWidth * scale, height: canvasHeight * scale },
      { cssOnly: true }
    );
    canvas.renderAll();
  }, [scale, canvasWidth, canvasHeight]);

  // ── Tool: add-text on canvas click ────────────────────────────────────────

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || activeTool !== 'add-text') return;

    canvas.defaultCursor = 'crosshair';

    const onClick = (opt) => {
      const ptr = canvas.getPointer(opt.e);
      const zoneIdx = findZoneForPoint(ptr.x, ptr.y, 'text');

      const text = new IText(__('Your text here', 'productforge'), {
        left: ptr.x,
        top: ptr.y,
        fontSize: 24,
        fill: '#000000',
        data: {
          elementType: 'text',
          zoneIndex: zoneIdx,
        },
      });

      applyPermissions(text, 'text');
      if (zoneIdx >= 0) applyZoneClip(text, zoneIdx);
      canvas.add(text);
      canvas.setActiveObject(text);

      if (zoneIdx >= 0) clampToZone(text);

      canvas.renderAll();
      snapshotView(currentViewIndex, canvas.toJSON(['data']));
      setActiveTool('select');
    };

    canvas.on('mouse:down', onClick);
    return () => {
      canvas.off('mouse:down', onClick);
      canvas.defaultCursor = 'default';
    };
  }, [activeTool, currentViewIndex, findZoneForPoint, applyPermissions, applyZoneClip, clampToZone, snapshotView, setActiveTool]);

  // ── Tool: add-image / add-svg via file input ──────────────────────────────

  const handleFileUpload = useCallback(async (file, elementType) => {
    try {
      const result = await uploadFile(file);
      const canvas = fabricRef.current;
      if (!canvas) return;

      const img = await FabricImage.fromURL(result.url, { crossOrigin: 'anonymous' });
      const zoneIdx = findFirstZoneForType(elementType);

      // Position: center on zone if found, otherwise center on canvas
      if (zoneIdx >= 0) {
        const zone = zones[zoneIdx];
        img.scaleToWidth(Math.min(img.width, zone.width * 0.8));
        img.set({
          left: zone.x + zone.width / 2 - (img.getScaledWidth() / 2),
          top:  zone.y + zone.height / 2 - (img.getScaledHeight() / 2),
        });
      } else {
        img.scaleToWidth(Math.min(img.width, canvas.width * 0.5));
        img.set({
          left: canvas.width / 2 - img.getScaledWidth() / 2,
          top:  canvas.height / 2 - img.getScaledHeight() / 2,
        });
      }

      img.set({
        data: { elementType, zoneIndex: zoneIdx },
      });

      applyPermissions(img, elementType);
      if (zoneIdx >= 0) applyZoneClip(img, zoneIdx);
      canvas.add(img);
      canvas.setActiveObject(img);

      if (zoneIdx >= 0) clampToZone(img);

      canvas.renderAll();
      snapshotView(currentViewIndex, canvas.toJSON(['data']));
    } catch (err) {
      setError(err.message);
    }

    setActiveTool('select');
  }, [findFirstZoneForType, zones, applyPermissions, applyZoneClip, clampToZone, snapshotView, currentViewIndex, setActiveTool, setError]);

  // Called by AddTab via store
  const triggerFileUpload = useCallback((elementType) => {
    const input = fileInputRef.current;
    if (!input) return;

    input.accept = elementType === 'svg'
      ? 'image/svg+xml'
      : 'image/jpeg,image/png,image/webp,image/gif';
    input.dataset.elementType = elementType;
    input.value = '';
    input.click();
  }, []);

  const onFileSelected = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const elementType = e.target.dataset.elementType || 'image';
    handleFileUpload(file, elementType);
  }, [handleFileUpload]);

  // Expose triggerFileUpload to AddTab via store
  useEffect(() => {
    setTriggerFileUpload(triggerFileUpload);
  }, [triggerFileUpload, setTriggerFileUpload]);

  return (
    <div className="pf-canvas-wrap" ref={scaleContainerRef}>
      <div className="pf-canvas-scroll">
        <canvas ref={canvasEl} />
      </div>
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={onFileSelected}
      />
    </div>
  );
}
