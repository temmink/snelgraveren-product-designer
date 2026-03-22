import React, { useRef, useEffect, useCallback, useState } from 'react';
import { __ } from '@wordpress/i18n';
import { Canvas as FabricCanvas, Rect, FabricImage, Textbox, FabricText, loadSVGFromString, util, cache as fabricCache } from 'fabric';
import useTemplateStore from '../store/useTemplateStore';
import { parseSvgToFabric } from '../utils/svgPathUtils';
import { alignElement } from '../../../../../shared/js/alignElement';

const ALLOWED_FABRIC_TYPES = new Set([
  'IText', 'Textbox', 'Image', 'Rect', 'Path', 'Group', 'FabricText',
  'i-text', 'textbox', 'image', 'rect', 'path', 'group',
]);

function filterFabricJson(json) {
  if (!json || !json.objects) return json;
  return {
    ...json,
    objects: json.objects.filter((obj) => ALLOWED_FABRIC_TYPES.has(obj.type)),
  };
}

export default function Canvas() {
  const canvasEl    = useRef(null);
  const fabricRef   = useRef(null);
  const pendingLoads = useRef(new Set()); // Track in-flight async SVG/image loads by _key

  // Stable refs for callbacks used in canvas event handlers to avoid stale closures.
  const clampToZoneRef     = useRef(null);
  const clampScaleRef      = useRef(null);
  const snapToGridRef      = useRef(null);

  // Ref for applyZoneClip so async callbacks can use the latest version.
  const applyZoneClipRef   = useRef(null);

  // Background editing state
  const [editingBg, setEditingBg] = useState(false);
  const bgObjectRef = useRef(null);

  // Selected element tracking (for alignment toolbar).
  // Use both a ref (stable for handlers) and state (for conditional rendering).
  const selectedObjRef = useRef(null);
  const [hasSelection, setHasSelection] = useState(false);

  const {
    views, currentViewIndex,
    updateView, updateZone, updateLayer, pushHistory, undo, redo, canUndo, canRedo,
    isFreeMove, setFreeMove, setCanvasSelectedKey,
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

    if (zone.boundary_type === 'svg') {
      // Clone the zone boundary group already on the canvas for use as clip path.
      const canvas = fabricRef.current;
      if (!canvas) return;
      const zoneObj = canvas.getObjects().find(
        (o) => o.data?.isZone && o.data?.zoneKey === zone._key
      );
      if (zoneObj) {
        zoneObj.clone().then((cloned) => {
          cloned.set({ absolutePositioned: true });
          // Clip paths render by filled area — ensure all child shapes have a fill.
          if (cloned.getObjects) {
            cloned.getObjects().forEach((c) => c.set({ fill: '#000000' }));
          }
          obj.clipPath = cloned;
          canvas.renderAll();
        });
      }
      // If zone SVG hasn't loaded yet, no clip is applied now — it will be
      // re-applied when the SVG boundary loads (see zone sync effect).
    } else {
      // Rect boundary clip.
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

  // Keep refs in sync so canvas event handlers always use the latest callbacks.
  clampToZoneRef.current    = clampToZone;
  clampScaleRef.current     = clampScaleToZone;
  snapToGridRef.current     = snapToGrid;
  applyZoneClipRef.current  = applyZoneClip;

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
      pushHistory(viewKey, canvas.toJSON(['data']));
    };
    canvas.on('object:modified', onModified);

    canvas.on('object:moving', (e) => {
      if (e.target?.data?.isZone) return; // Don't clamp boundaries to themselves.
      snapToGridRef.current?.(e.target);
      clampToZoneRef.current?.(e.target);
    });

    canvas.on('object:scaling', (e) => {
      if (e.target?.data?.isZone) return;
      clampScaleRef.current?.(e.target);
    });

    canvas.on('selection:created', (e) => {
      const obj = e.selected?.[0];
      const sel = obj?.data?.isZone ? null : obj || null;
      selectedObjRef.current = sel;
      setHasSelection(!!sel);
      setCanvasSelectedKey(sel?.data?.layerKey || null);
    });
    canvas.on('selection:updated', (e) => {
      const obj = e.selected?.[0];
      const sel = obj?.data?.isZone ? null : obj || null;
      selectedObjRef.current = sel;
      setHasSelection(!!sel);
      setCanvasSelectedKey(sel?.data?.layerKey || null);
    });
    canvas.on('selection:cleared', () => {
      // Don't clear the ref — alignment buttons read it on mousedown,
      // which fires after Fabric clears the selection. The ref gets
      // overwritten on the next selection:created/updated anyway.
      setHasSelection(false);
      setCanvasSelectedKey(null);
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
          const t = currentView.background_transform || {};
          if (t.scaleX) {
            img.set({ scaleX: t.scaleX, scaleY: t.scaleY || t.scaleX, left: t.left || 0, top: t.top || 0 });
          } else {
            img.scaleToWidth(width);
          }
          canvas.backgroundImage = img;
          canvas.renderAll();
          pushHistory(viewKey, canvas.toJSON(['data']));
        })
        .catch((err) => {
          if (disposed) return;
          console.warn('Background load failed:', err);
          // Background load failure is non-fatal; seed history without background.
          pushHistory(viewKey, canvas.toJSON(['data']));
        });
    } else {
      canvas.renderAll();
      pushHistory(viewKey, canvas.toJSON(['data']));
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
    let cancelled = false;

    // Build map of existing zone objects by _key for in-place updates.
    const existingByKey = {};
    canvas.getObjects().forEach((obj) => {
      if (obj.data?.isZone && obj.data?.zoneKey) {
        existingByKey[obj.data.zoneKey] = obj;
      }
    });

    const handledKeys = new Set();

    const zoneStyleFor = (zone) => ({
      fill:           isFreeMove ? 'transparent' : (zone.svg_fill_color || 'rgba(59, 130, 246, 0.08)'),
      stroke:         '#3b82f6',
      strokeWidth:    2,
      strokeUniform:  true,
      strokeDashArray: isFreeMove ? [6, 4] : undefined,
      selectable:     !zone.locked,
      evented:        !zone.locked,
      hasControls:    !zone.locked,
      lockMovementX:  !!zone.locked,
      lockMovementY:  !!zone.locked,
    });

    const sendZonesToBack = () => {
      canvas.getObjects().forEach((obj) => {
        if (obj.data?.isZone) canvas.sendObjectToBack(obj);
      });
      canvas.renderAll();
    };

    zones.forEach((zone, index) => {
      const key = zone._key;
      handledKeys.add(key);
      const existing = existingByKey[key];

      if (zone.boundary_type === 'svg' && zone.svg_url) {
        if (existing) {
          // Update SVG zone in-place (position/scale/rotation only).
          // For SVG groups, stroke/fill lives on child paths, not the group.
          const style = zoneStyleFor(zone);
          if (existing.getObjects) {
            existing.getObjects().forEach((c) => c.set({
              stroke: style.stroke,
              strokeWidth: style.strokeWidth,
              strokeUniform: true,
              fill: style.fill,
            }));
          }
          existing.set({
            ...style,
            stroke: null,
            strokeWidth: 0,
            left:   zone.x,
            top:    zone.y,
            scaleX: zone.svg_scale || 1,
            scaleY: zone.svg_scale || 1,
            angle:  zone.svg_rotation || 0,
          });
          existing.data = { ...existing.data, zoneIndex: index };
          existing.setCoords();
        } else {
          // Load SVG boundary asynchronously.
          fetch(zone.svg_url)
            .then((r) => r.text())
            .then((svgText) => parseSvgToFabric(svgText))
            .then((result) => {
              if (cancelled || !result || !fabricRef.current) return;
              const { objects, options } = result;
              objects.forEach((o) => o.set({ stroke: '#3b82f6', strokeWidth: 2, strokeUniform: true, fill: 'rgba(59, 130, 246, 0.08)' }));

              const group = util.groupSVGElements(objects, options);
              group.set({
                ...zoneStyleFor(zone),
                stroke: null,
                strokeWidth: 0,
                left:   zone.x,
                top:    zone.y,
                scaleX: zone.svg_scale || 1,
                scaleY: zone.svg_scale || 1,
                angle:  zone.svg_rotation || 0,
                data:   { zoneIndex: index, zoneKey: key, isZone: true },
              });
              canvas.add(group);
              group.setCoords();
              sendZonesToBack();

              // Re-apply SVG clip paths to any layers already in this zone
              // by cloning the newly created boundary group.
              canvas.getObjects().forEach((layerObj) => {
                if (layerObj.data?.zoneIndex === index && layerObj.data?.layerKey) {
                  group.clone().then((cloned) => {
                    cloned.set({ absolutePositioned: true });
                    // Clip paths render by filled area — ensure all child shapes have a fill.
                    if (cloned.getObjects) {
                      cloned.getObjects().forEach((c) => c.set({ fill: '#000000' }));
                    }
                    layerObj.clipPath = cloned;
                    fabricRef.current?.renderAll();
                  });
                }
              });
            })
            .catch((err) => console.warn('[PF] SVG boundary load failed:', err));
        }
      } else {
        // Rect boundary.
        if (existing) {
          existing.set({
            ...zoneStyleFor(zone),
            left:   zone.x,
            top:    zone.y,
            width:  zone.width,
            height: zone.height,
            scaleX: 1,
            scaleY: 1,
          });
          existing.data = { ...existing.data, zoneIndex: index };
          existing.setCoords();
        } else {
          const shape = new Rect({
            ...zoneStyleFor(zone),
            left:   zone.x,
            top:    zone.y,
            width:  zone.width,
            height: zone.height,
            lockRotation: true,
            data:   { zoneIndex: index, zoneKey: key, isZone: true },
          });
          canvas.add(shape);
        }
      }
    });

    // Remove zone objects that no longer exist in the store.
    Object.entries(existingByKey).forEach(([key, obj]) => {
      if (!handledKeys.has(key)) canvas.remove(obj);
    });

    sendZonesToBack();

    return () => { cancelled = true; };
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

    // Build a map of existing layer objects by layer key.
    const existingByKey = {};
    fabricObjects.forEach((obj) => {
      if (obj.data?.layerKey) {
        existingByKey[obj.data.layerKey] = obj;
      }
    });

    // Track which keys we've handled.
    const handledKeys = new Set();

    const layerData = (layer) => ({
      layerKey:    layer._key,
      layerIndex:  layer._layerIndex,
      zoneIndex:   layer._zoneIndex,
      layerType:   layer.type,
      elementType: layer.type,
    });

    const applyClipAndClamp = (obj, layer) => {
      const zi = layer._zoneIndex;
      if (zi != null && zi >= 0) {
        applyZoneClip(obj, zi);
        clampToZone(obj);
      }
    };

    layers.forEach((layer) => {
      const existing = existingByKey[layer._key];
      handledKeys.add(layer._key);

      if (layer.type === 'text') {
        if (!layer.text) {
          if (existing) canvas.remove(existing);
          return;
        }

        const fontFamily = layer.fontFamily || 'Arial';

        if (existing) {
          if (existing.fontFamily !== fontFamily) {
            fabricCache.clearFontCache(fontFamily);
          }
          const parentZone = zones[layer._zoneIndex];
          existing.set({
            text:       layer.text,
            left:       layer.left       || 100,
            top:        layer.top        || 100,
            width:      layer.width || (parentZone ? parentZone.width - 20 : existing.width),
            fontSize:   layer.fontSize   || 24,
            fontFamily,
            fill:       layer.fill       || '#000000',
            textAlign:  layer.textAlign  || 'left',
            scaleX:     1,
            scaleY:     1,
            selectable: !layer.locked,
            evented:    !layer.locked,
          });
          existing.initDimensions();
          existing.setCoords();
          existing.data = { ...existing.data, layerIndex: layer._layerIndex, zoneIndex: layer._zoneIndex };
          applyClipAndClamp(existing, layer);
        } else {
          fabricCache.clearFontCache(fontFamily);
          const parentZone = zones[layer._zoneIndex];
          const textWidth = layer.width || (parentZone ? parentZone.width - 20 : 200);
          const text = new Textbox(layer.text, {
            left:       layer.left       || 100,
            top:        layer.top        || 100,
            width:      textWidth,
            fontSize:   layer.fontSize   || 24,
            fontFamily,
            fill:       layer.fill       || '#000000',
            textAlign:  layer.textAlign  || 'left',
            selectable: !layer.locked,
            evented:    !layer.locked,
            data:       layerData(layer),
          });
          canvas.add(text);
          applyPermissions(text, layer.type);
          applyClipAndClamp(text, layer);
        }
      } else if (layer.type === 'image') {
        if (existing) {
          existing.set({
            left:       layer.left   || 100,
            top:        layer.top    || 100,
            scaleX:     layer.scaleX || 1,
            scaleY:     layer.scaleY || 1,
            angle:      layer.angle  || 0,
            selectable: !layer.locked,
            evented:    !layer.locked,
          });
          existing.data = { ...existing.data, layerIndex: layer._layerIndex, zoneIndex: layer._zoneIndex };
          existing.setCoords();
          applyClipAndClamp(existing, layer);
        } else if (layer.src && !pendingLoads.current.has(layer._key)) {
          pendingLoads.current.add(layer._key);
          FabricImage.fromURL(layer.src, { crossOrigin: 'anonymous' })
            .then((img) => {
              pendingLoads.current.delete(layer._key);
              if (!fabricRef.current) return;
              img.set({
                left:       layer.left   || 100,
                top:        layer.top    || 100,
                scaleX:     layer.scaleX || 1,
                scaleY:     layer.scaleY || 1,
                angle:      layer.angle  || 0,
                selectable: !layer.locked,
                evented:    !layer.locked,
                data:       layerData(layer),
              });
              canvas.add(img);
              img.setCoords();
              applyPermissions(img, layer.type);
              applyClipAndClamp(img, layer);
              canvas.renderAll();
            })
            .catch(() => {
              pendingLoads.current.delete(layer._key);
            });
        }
      } else if (layer.type === 'svg') {
        if (existing) {
          existing.set({
            left:       layer.left   || 100,
            top:        layer.top    || 100,
            scaleX:     layer.scaleX || 1,
            scaleY:     layer.scaleY || 1,
            angle:      layer.angle  || 0,
            selectable: !layer.locked,
            evented:    !layer.locked,
          });
          existing.data = { ...existing.data, layerIndex: layer._layerIndex, zoneIndex: layer._zoneIndex };
          existing.setCoords();
          applyClipAndClamp(existing, layer);
        } else if (layer.src && !pendingLoads.current.has(layer._key)) {
          pendingLoads.current.add(layer._key);
          // Fetch SVG text, normalize mm/cm/in units to px, then parse with Fabric.
          fetch(layer.src)
            .then((r) => r.text())
            .then((svgText) => {
              // Convert unit-based width/height to px (1mm≈3.7795px, 1cm≈37.795px, 1in≈96px).
              const normalized = svgText.replace(
                /(<svg[^>]*?(?:width|height)="[\d.]+)(mm|cm|in)(")/g,
                (_, prefix, unit, suffix) => {
                  const val = parseFloat(prefix.match(/([\d.]+)$/)[1]);
                  const scale = unit === 'mm' ? 3.7795 : unit === 'cm' ? 37.795 : 96;
                  const px = (val * scale).toFixed(2);
                  return prefix.replace(/([\d.]+)$/, px) + suffix;
                }
              );
              return loadSVGFromString(normalized);
            })
            .then(({ objects, options }) => {
              pendingLoads.current.delete(layer._key);
              if (!fabricRef.current) return;
              const filtered = objects.filter(Boolean);
              filtered.forEach((o) => o.set({ strokeUniform: true }));
              const group = util.groupSVGElements(filtered, options);
              group.set({
                left:          layer.left   || 100,
                top:           layer.top    || 100,
                scaleX:        layer.scaleX || 1,
                scaleY:        layer.scaleY || 1,
                angle:         layer.angle  || 0,
                selectable:    !layer.locked,
                evented:       !layer.locked,
                strokeUniform: true,
                subTargetCheck: false,
                interactive:   false,
                data:          layerData(layer),
              });
              canvas.add(group);
              group.setCoords();
              applyPermissions(group, layer.type);
              applyClipAndClamp(group, layer);
              canvas.renderAll();
            })
            .catch((err) => {
              pendingLoads.current.delete(layer._key);
              console.warn('[PF] SVG layer load failed:', err);
            });
        }
      }
    });

    // Remove fabric objects for layers that no longer exist.
    Object.entries(existingByKey).forEach(([key, obj]) => {
      if (!handledKeys.has(key)) {
        canvas.remove(obj);
      }
    });

    // ── Z-ordering: match tree panel order ──
    // Zone boundaries stay at the bottom. Layer objects are ordered to match
    // the flattened layers array (zone 0 layers first, then zone 1, etc.).
    // This ensures the tree panel top-to-bottom order = canvas bottom-to-top
    // stacking (last in array = visually on top).
    const allObjects = canvas.getObjects();
    const zoneObjects = allObjects.filter((o) => o.data?.isZone);
    const layerObjects = allObjects.filter((o) => o.data?.layerKey);

    // Build desired layer order from the flattened layers array.
    const layerKeyOrder = layers.map((l) => l._key);
    layerObjects.sort((a, b) => {
      const ai = layerKeyOrder.indexOf(a.data.layerKey);
      const bi = layerKeyOrder.indexOf(b.data.layerKey);
      return ai - bi;
    });

    // Re-stack: zones at bottom, then layers in tree order.
    zoneObjects.forEach((obj) => canvas.sendObjectToBack(obj));
    layerObjects.forEach((obj) => canvas.bringObjectToFront(obj));

    canvas.renderAll();
  }, [layers]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-measure text objects after fonts load ────────────────────────────
  // Custom fonts may load asynchronously. When loaded, Fabric's static char
  // width cache contains stale measurements from fallback fonts, causing
  // bounding box mismatches. Clear the cache and re-init dimensions.
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const onFontLoad = () => {
      fabricCache.clearFontCache();
      canvas.getObjects().forEach((obj) => {
        if (obj.type === 'text' || obj.type === 'i-text') {
          obj.initDimensions();
          obj.setCoords();
        }
      });
      canvas.renderAll();
    };

    document.fonts.ready.then(onFontLoad);
    document.fonts.addEventListener('loadingdone', onFontLoad);
    return () => document.fonts.removeEventListener('loadingdone', onFontLoad);
  }, []);

  // ── Sync canvas object moves back to store ──────────────────────────────
  // When the user drags/resizes a text object on the canvas, update the
  // layer config in the store so the sidebar stays in sync.

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const onObjectModified = (e) => {
      const obj = e.target;

      // ── Zone boundary modified ──
      if (obj?.data?.isZone) {
        const zoneIndex = obj.data.zoneIndex;
        const zone = zones[zoneIndex];
        if (!zone) return;

        if (zone.boundary_type === 'svg') {
          const scale = obj.scaleX || 1;
          const intrinsicW = obj.width || 200;
          const intrinsicH = obj.height || 200;
          updateZone(currentViewIndex, zoneIndex, {
            x:                   Math.round(obj.left),
            y:                   Math.round(obj.top),
            width:               Math.round(intrinsicW * scale),
            height:              Math.round(intrinsicH * scale),
            svg_intrinsic_width:  intrinsicW,
            svg_intrinsic_height: intrinsicH,
            svg_scale:           scale,
            svg_rotation:        Math.round(obj.angle || 0),
          });
        } else {
          // Rect: absorb scale into width/height.
          const newWidth  = Math.round((obj.width  || 200) * (obj.scaleX || 1));
          const newHeight = Math.round((obj.height || 200) * (obj.scaleY || 1));
          obj.set({ width: newWidth, height: newHeight, scaleX: 1, scaleY: 1 });
          obj.setCoords();
          updateZone(currentViewIndex, zoneIndex, {
            x:      Math.round(obj.left),
            y:      Math.round(obj.top),
            width:  newWidth,
            height: newHeight,
          });
        }
        return;
      }

      // ── Layer modified ──
      if (!obj?.data?.layerType) return;

      const patch = {
        left:  Math.round(obj.left),
        top:   Math.round(obj.top),
        angle: Math.round(obj.angle || 0),
      };

      if (obj.data.layerType === 'text') {
        // Convert canvas scale into fontSize so the layer sync can reset scale to 1.
        const newFontSize = Math.round((obj.fontSize || 24) * (obj.scaleX || 1));
        obj.set({ fontSize: newFontSize, scaleX: 1, scaleY: 1 });
        patch.fontSize = newFontSize;
      } else {
        // For image/svg layers, persist scale values.
        patch.scaleX = obj.scaleX || 1;
        patch.scaleY = obj.scaleY || 1;
      }

      updateLayer(currentViewIndex, obj.data.zoneIndex, obj.data.layerIndex, patch);
    };

    canvas.on('object:modified', onObjectModified);
    return () => canvas.off('object:modified', onObjectModified);
  }, [currentViewIndex, updateLayer, updateZone, zones]);

  const enableFreeMove = useCallback(() => {
    setFreeMove(true);
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.getObjects().forEach((obj) => {
      if (obj.data?.isZone || obj.data?.isZoneOverlay) return;
      obj.clipPath = undefined;
    });
    pushHistory(viewKey, canvas.toJSON(['data']));
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
    pushHistory(viewKey, canvas.toJSON(['data']));
    canvas.renderAll();
  }, [setFreeMove, applyZoneClip, clampToZone, pushHistory, viewKey]);

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
        fabricRef.current.loadFromJSON(filterFabricJson(snapshot))
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
      title: __( 'Select Background Image', 'productforge' ),
      button: { text: __( 'Set Background', 'productforge' ) },
      multiple: false,
      library: { type: 'image' },
    });

    frame.on('select', () => {
      const attachment = frame.state().get('selection').first().toJSON();
      const url = attachment.url;

      // Reset transform when changing background image
      updateView(currentViewIndex, { background_url: url, background_transform: {} });

      const canvas = fabricRef.current;
      if (canvas) {
        // Clean up any editing state
        if (bgObjectRef.current) { canvas.remove(bgObjectRef.current); bgObjectRef.current = null; }
        setEditingBg(false);

        FabricImage.fromURL(url, { crossOrigin: 'anonymous' })
          .then((img) => {
            img.scaleToWidth(canvas.width);
            canvas.backgroundImage = img;
            canvas.renderAll();
            pushHistory(viewKey, canvas.toJSON(['data']));
          });
      }
    });

    frame.open();
  }, [currentViewIndex, updateView, pushHistory]);

  const removeBackground = useCallback(() => {
    if (editingBg) setEditingBg(false);
    updateView(currentViewIndex, { background_url: '', background_transform: {} });
    const canvas = fabricRef.current;
    if (canvas) {
      if (bgObjectRef.current) { canvas.remove(bgObjectRef.current); bgObjectRef.current = null; }
      canvas.backgroundImage = undefined;
      canvas.renderAll();
      pushHistory(viewKey, canvas.toJSON(['data']));
    }
  }, [currentViewIndex, updateView, pushHistory, editingBg]);

  // Enter background editing: convert backgroundImage to a selectable object
  const enterBgEdit = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || !canvas.backgroundImage) return;

    const bg = canvas.backgroundImage;
    const { scaleX, scaleY, left, top } = bg;

    FabricImage.fromURL(currentView.background_url, { crossOrigin: 'anonymous' })
      .then((img) => {
        img.set({
          scaleX, scaleY, left: left || 0, top: top || 0,
          lockUniScaling: true,
          hasControls: true,
          hasBorders: true,
          selectable: true,
          evented: true,
          data: { elementType: '_background' },
          opacity: 0.85,
        });
        // Hide the real background while editing
        canvas.backgroundImage = undefined;
        canvas.add(img);
        canvas.sendObjectToBack(img);
        canvas.setActiveObject(img);
        canvas.renderAll();
        bgObjectRef.current = img;
        setEditingBg(true);
      });
  }, [currentView?.background_url]);

  // Exit background editing: apply transform back to backgroundImage
  const exitBgEdit = useCallback(() => {
    const canvas = fabricRef.current;
    const obj = bgObjectRef.current;
    if (!canvas || !obj) return;

    const transform = {
      scaleX: obj.scaleX,
      scaleY: obj.scaleY,
      left: obj.left,
      top: obj.top,
    };

    // Remove the temp object and restore as backgroundImage
    canvas.remove(obj);
    bgObjectRef.current = null;

    FabricImage.fromURL(currentView.background_url, { crossOrigin: 'anonymous' })
      .then((img) => {
        img.set(transform);
        canvas.backgroundImage = img;
        canvas.renderAll();
        pushHistory(viewKey, canvas.toJSON(['data']));
      });

    // Save transform to view config
    updateView(currentViewIndex, { background_transform: transform });
    setEditingBg(false);
  }, [currentView?.background_url, currentViewIndex, updateView, pushHistory]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const applyUndo = () => {
    const snap = undo(viewKey);
    if (snap && fabricRef.current) {
      fabricRef.current.loadFromJSON(filterFabricJson(snap)).then(() => fabricRef.current?.renderAll());
    }
  };

  const applyRedo = () => {
    const snap = redo(viewKey);
    if (snap && fabricRef.current) {
      fabricRef.current.loadFromJSON(filterFabricJson(snap)).then(() => fabricRef.current?.renderAll());
    }
  };

  const handleAlign = useCallback((dir) => {
    const canvas = fabricRef.current;
    const obj = selectedObjRef.current;
    if (!obj || !canvas || obj.data?.isZone) return;

    // Find the zone boundary: use the Fabric zone object's bounding rect
    // so SVG boundaries align within the actual SVG shape, not just the config rect.
    const zi = obj.data?.zoneIndex;
    let bounds;
    if (zi != null) {
      const zoneObj = canvas.getObjects().find(
        (o) => o.data?.isZone && o.data?.zoneIndex === zi
      );
      if (zoneObj) {
        const r = zoneObj.getBoundingRect();
        bounds = { x: r.left, y: r.top, width: r.width, height: r.height };
      }
    }
    if (!bounds) {
      const zones = views[currentViewIndex]?.zones_config || [];
      const zone = (zi != null && zones[zi]) ? zones[zi] : null;
      bounds = zone || { x: 0, y: 0, width: currentView?.canvas_width || 800, height: currentView?.canvas_height || 600 };
    }

    alignElement(obj, dir, bounds);

    // Persist position to Zustand store so the layer-sync effect doesn't reset it.
    if (obj.data?.zoneIndex != null && obj.data?.layerIndex != null) {
      updateLayer(currentViewIndex, obj.data.zoneIndex, obj.data.layerIndex, {
        left: Math.round(obj.left),
        top:  Math.round(obj.top),
      });
    }

    // Re-select so the object stays active for further alignment clicks.
    canvas.setActiveObject(obj);
    canvas.renderAll();
    setHasSelection(true);
    pushHistory(viewKey, canvas.toJSON(['data']));
  }, [views, currentViewIndex, currentView, updateLayer, pushHistory, viewKey]);

  return (
    <div className="pf-canvas-wrap">
      <div className="pf-canvas-toolbar">
        <button
          className={`pf-canvas-toolbar__btn${isFreeMove ? ' pf-canvas-toolbar__btn--active' : ''}`}
          onClick={isFreeMove ? disableFreeMove : enableFreeMove}
          title={ isFreeMove ? __( 'Enable zone enforcement', 'productforge' ) : __( 'Disable zone enforcement for free positioning', 'productforge' ) }
        >
          { isFreeMove ? __( 'Enforce Zones', 'productforge' ) : __( 'Free Move', 'productforge' ) }
        </button>
        <button
          className="pf-canvas-toolbar__btn"
          onClick={openMediaPicker}
          title={ __( 'Set background image', 'productforge' ) }
        >
          { currentView?.background_url ? __( 'Change Background', 'productforge' ) : __( 'Set Background', 'productforge' ) }
        </button>
        {currentView?.background_url && !editingBg && (
          <button
            className="pf-canvas-toolbar__btn"
            onClick={enterBgEdit}
            title={ __( 'Resize and reposition the background image', 'productforge' ) }
          >
            { __( 'Resize BG', 'productforge' ) }
          </button>
        )}
        {editingBg && (
          <button
            className="pf-canvas-toolbar__btn pf-canvas-toolbar__btn--active"
            onClick={exitBgEdit}
            title={ __( 'Apply background position', 'productforge' ) }
          >
            { __( 'Done', 'productforge' ) }
          </button>
        )}
        {currentView?.background_url && (
          <button
            className="pf-canvas-toolbar__btn"
            onClick={removeBackground}
            title={ __( 'Remove background image', 'productforge' ) }
          >
            { __( 'Remove BG', 'productforge' ) }
          </button>
        )}
        <button
          className="pf-canvas-toolbar__btn"
          onClick={applyUndo}
          disabled={!canUndo(viewKey)}
          title={ __( 'Undo (Ctrl+Z)', 'productforge' ) }
        >
          { __( '↩ Undo', 'productforge' ) }
        </button>
        <button
          className="pf-canvas-toolbar__btn"
          onClick={applyRedo}
          disabled={!canRedo(viewKey)}
          title={ __( 'Redo (Ctrl+Shift+Z)', 'productforge' ) }
        >
          { __( '↪ Redo', 'productforge' ) }
        </button>
        {!editingBg && (
          <AlignToolbar hasSelection={hasSelection} handleAlign={handleAlign} />
        )}
      </div>
      <div className="pf-canvas-scroll">
        <canvas ref={canvasEl} />
      </div>
    </div>
  );
}

/**
 * Alignment toolbar that uses native capture-phase mousedown listeners
 * to fire before Fabric.js clears the canvas selection.
 */
function AlignToolbar({ hasSelection, handleAlign }) {
  const groupRef = useRef(null);
  const handleAlignRef = useRef(handleAlign);
  handleAlignRef.current = handleAlign;

  useEffect(() => {
    const el = groupRef.current;
    if (!el) return;

    const onMouseDown = (e) => {
      const dir = e.target.dataset?.align;
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation();
      handleAlignRef.current(dir);
    };

    // Capture phase fires before Fabric's document-level listener.
    el.addEventListener('mousedown', onMouseDown, true);
    return () => el.removeEventListener('mousedown', onMouseDown, true);
  }, []);

  const dirs = [
    ['left', '⬅', __('Align left', 'productforge')],
    ['center', '↔', __('Align center', 'productforge')],
    ['right', '➡', __('Align right', 'productforge')],
    ['top', '⬆', __('Align top', 'productforge')],
    ['middle', '↕', __('Align middle', 'productforge')],
    ['bottom', '⬇', __('Align bottom', 'productforge')],
  ];

  return (
    <span className="pf-canvas-toolbar__group" ref={groupRef}>
      <span className="pf-canvas-toolbar__sep" />
      {dirs.map(([dir, icon, title]) => (
        <button
          key={dir}
          className={`pf-canvas-toolbar__btn${hasSelection ? '' : ' pf-canvas-toolbar__btn--dim'}`}
          data-align={dir}
          title={title}
        >
          {icon}
        </button>
      ))}
    </span>
  );
}
