import React, { useRef, useEffect, useCallback } from 'react';
import { Canvas as FabricCanvas, Rect, IText, FabricImage } from 'fabric';
import useDesignerStore from '../store/useDesignerStore';
import { uploadFile } from '../api/designerApi';

const ALLOWED_FABRIC_TYPES = ['i-text', 'image', 'rect'];

function filterFabricJson(json) {
  if (!json || !json.objects) return json;
  return {
    ...json,
    objects: json.objects.filter((obj) => ALLOWED_FABRIC_TYPES.includes(obj.type)),
  };
}

export default function DesignerCanvas() {
  const canvasEl  = useRef(null);
  const fabricRef = useRef(null);
  const fileInputRef = useRef(null);

  const {
    template, currentViewIndex, activeTool,
    canvasSnapshots, snapshotView, setActiveTool,
    setSelectedObject, setError, setTriggerFileUpload,
  } = useDesignerStore();

  const currentView = template?.views?.[currentViewIndex];
  const zones = currentView?.zones_config || [];
  const globalConfig = template?.global_config || {};
  const permissions = globalConfig.permissions || {};

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

    // If bounding rect exceeds zone, scale down
    if (bound.width > zone.width || bound.height > zone.height) {
      const ratio = Math.min(zone.width / bound.width, zone.height / bound.height);
      obj.set({ scaleX: obj.scaleX * ratio, scaleY: obj.scaleY * ratio });
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
    });
    fabricRef.current = canvas;

    let disposed = false;

    // Render zone rects
    zones.forEach((zone) => {
      const isRestrict = zone.behavior === 'restrict';
      const rect = new Rect({
        left:           zone.x,
        top:            zone.y,
        width:          zone.width,
        height:         zone.height,
        fill:           isRestrict ? 'rgba(59,130,246,0.08)' : 'transparent',
        stroke:         isRestrict ? '#3b82f6' : '#9ca3af',
        strokeWidth:    2,
        strokeDashArray: isRestrict ? null : [6, 4],
        selectable:     false,
        evented:        false,
        data:           { isZoneOverlay: true },
      });
      canvas.add(rect);
    });

    // Load background image
    if (currentView.background_url) {
      FabricImage.fromURL(currentView.background_url, { crossOrigin: 'anonymous' })
        .then((img) => {
          if (disposed) return;
          img.set({ selectable: false, evented: false });
          img.scaleToWidth(width);
          canvas.set('backgroundImage', img);
          canvas.renderAll();
        })
        .catch(() => {});
    }

    // Restore snapshot if switching back to a previously edited view
    const existing = canvasSnapshots[currentViewIndex];
    if (existing) {
      const filtered = filterFabricJson(existing);
      canvas.loadFromJSON(filtered).then(() => {
        if (!disposed) canvas.renderAll();
      });
    }

    // ── Event handlers ────────────────────────────────────────────────────

    canvas.on('object:moving', (e) => {
      snapToGrid(e.target);
      clampToZone(e.target);
    });

    canvas.on('object:scaling', (e) => {
      clampScaleToZone(e.target);
    });

    canvas.on('object:modified', () => {
      if (!disposed) snapshotView(currentViewIndex, canvas.toJSON());
    });

    canvas.on('object:removed', () => {
      if (!disposed) snapshotView(currentViewIndex, canvas.toJSON());
    });

    canvas.on('selection:created', (e) => {
      const obj = e.selected?.[0];
      if (obj && !obj.data?.isZoneOverlay) {
        setSelectedObject({
          type: obj.data?.elementType || 'unknown',
          fabricObj: obj,
        });
      }
    });

    canvas.on('selection:updated', (e) => {
      const obj = e.selected?.[0];
      if (obj && !obj.data?.isZoneOverlay) {
        setSelectedObject({
          type: obj.data?.elementType || 'unknown',
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
      // Snapshot current canvas state before switching views
      if (!disposed && fabricRef.current) {
        snapshotView(currentViewIndex, fabricRef.current.toJSON());
      }
      disposed = true;
      document.removeEventListener('keydown', onKeyDown);
      canvas.dispose();
      fabricRef.current = null;
    };
  }, [currentViewIndex, template]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tool: add-text on canvas click ────────────────────────────────────────

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || activeTool !== 'add-text') return;

    canvas.defaultCursor = 'crosshair';

    const onClick = (opt) => {
      const ptr = canvas.getPointer(opt.e);
      const zoneIdx = findZoneForPoint(ptr.x, ptr.y, 'text');

      const text = new IText('Your text here', {
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
      canvas.add(text);
      canvas.setActiveObject(text);

      if (zoneIdx >= 0) clampToZone(text);

      canvas.renderAll();
      snapshotView(currentViewIndex, canvas.toJSON());
      setActiveTool('select');
    };

    canvas.on('mouse:down', onClick);
    return () => {
      canvas.off('mouse:down', onClick);
      canvas.defaultCursor = 'default';
    };
  }, [activeTool, currentViewIndex, findZoneForPoint, applyPermissions, clampToZone, snapshotView, setActiveTool]);

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
      canvas.add(img);
      canvas.setActiveObject(img);

      if (zoneIdx >= 0) clampToZone(img);

      canvas.renderAll();
      snapshotView(currentViewIndex, canvas.toJSON());
    } catch (err) {
      setError(err.message);
    }

    setActiveTool('select');
  }, [findFirstZoneForType, zones, applyPermissions, clampToZone, snapshotView, currentViewIndex, setActiveTool, setError]);

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
    <div className="pd-canvas-wrap">
      <div className="pd-canvas-scroll">
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
