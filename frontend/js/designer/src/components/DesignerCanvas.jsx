import React, { useRef, useEffect, useCallback } from 'react';
import { __ } from '@wordpress/i18n';
import { Canvas as FabricCanvas, Rect, Textbox, IText, FabricImage, Path as FabricPath, PencilBrush, loadSVGFromString, util, cache as fabricCache } from 'fabric';
import { archUpPath } from '../utils/curvePresets';
import { renderHersheyText, ENGRAVING_FONTS } from '../utils/hersheyFonts';
import useDesignerStore from '../store/useDesignerStore';
import { uploadFile } from '../api/designerApi';
import useCanvasScale from '../hooks/useCanvasScale';
import useIsMobile from '../hooks/useIsMobile';
import useCanvasHistory from '../hooks/useCanvasHistory';
import { filterFabricJson } from '../utils/fabricJson';
import { zoneShapePath, objectSamplePoints, pointsInsideZoneShape } from '../../../../../shared/js/zoneContainment';

// Infer element type from Fabric object type when data.elementType is missing
// (e.g. designs saved before data serialisation was added).
function inferElementType(obj) {
  if (obj.data?.elementType) return obj.data.elementType;
  const t = (obj.type || '').toLowerCase();
  if (t === 'textbox' || t === 'itext' || t === 'i-text') return 'text';
  if (t === 'image') return 'image';
  if (t === 'path' || t === 'group') return 'svg';
  return 'unknown';
}

// Stable fallbacks for optional template config. Inline `|| {}` / `|| []`
// literals create a NEW reference every render, which makes every useCallback
// depending on them unstable; the setAddClipart effect then writes to the
// Zustand store on each render → re-render → infinite loop (React #185).
// Templates without permissions/zones (all free-build templates: the public
// endpoint strips `permissions`) crashed the whole designer this way.
const EMPTY_ZONES = [];
const EMPTY_CONFIG = {};
const EMPTY_PERMISSIONS = {};

export default function DesignerCanvas() {
  const canvasEl  = useRef(null);
  const fabricRef = useRef(null);
  const fileInputRef = useRef(null);

  // Stable refs for callbacks used in canvas event handlers to avoid stale closures.
  const clampToZoneRef     = useRef(null);
  const clampScaleRef      = useRef(null);
  const snapToGridRef      = useRef(null);
  const snapshotViewRef    = useRef(null);
  const pushHistoryRef     = useRef(null);
  const currentViewIndexRef = useRef(0);

  const isMobile = useIsMobile();
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile; // keep ref in sync for event handlers

  const {
    template, currentViewIndex, activeTool,
    canvasSnapshots, snapshotView, setActiveTool,
    setSelectedObject, setError, setFabricCanvasRef,
    drawingStrokeColor, drawingStrokeWidth,
  } = useDesignerStore();

  const currentView = template?.views?.[currentViewIndex];
  const zones = currentView?.zones_config || EMPTY_ZONES;
  const globalConfig = template?.global_config || EMPTY_CONFIG;
  const permissions = globalConfig.permissions || EMPTY_PERMISSIONS;

  const canvasWidth = currentView?.canvas_width || 800;
  const canvasHeight = currentView?.canvas_height || 600;
  const { containerRef: scaleContainerRef } = useCanvasScale(canvasWidth, canvasHeight, fabricRef);

  // Pass fabricRef (the ref object) so useCanvasHistory always reads .current at call time,
  // avoiding stale closures from null captured at mount.
  const { pushHistory, undo, redo } = useCanvasHistory(fabricRef, currentViewIndex);

  // ── Keyboard shortcut: undo/redo ──────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't intercept undo/redo during text input or IText editing
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      if (fabricRef.current?.getActiveObject()?.isEditing) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // ── Zone helpers ──────────────────────────────────────────────────────────

  // A zone that visually clips its elements: 'restrict' also clamps movement
  // inside the boundary, 'clip' lets elements move freely but cuts them off
  // at the boundary. Every other behavior enforces nothing.
  const zoneClips = (z) => !!z && (z.behavior === 'restrict' || z.behavior === 'clip');

  const findZoneForObject = useCallback((obj) => {
    const bound = obj.getBoundingRect();
    const cx = bound.left + bound.width / 2;
    const cy = bound.top + bound.height / 2;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (!zoneClips(z)) continue;
      if (cx >= z.x && cx <= z.x + z.width && cy >= z.y && cy <= z.y + z.height) {
        return i;
      }
    }
    return null;
  }, [zones]);

  const findZoneForPoint = useCallback((x, y, elementType) => {
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (!zoneClips(z)) continue;
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
      if (!zoneClips(z)) continue;
      if ((z.allowed_types || []).includes(elementType)) return i;
    }
    return -1;
  }, [zones]);

  // ── Clip object to its zone ───────────────────────────────────────────────

  const applyZoneClip = useCallback((obj, zoneIdx) => {
    if (zoneIdx < 0 || !zoneClips(zones[zoneIdx])) return;
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

    // True shape containment for inline svg boundaries — the rect clamp below
    // only holds the zone's bounding box, which for a non-rectangular contour
    // is far larger than the visible outline (restrict would feel like clip).
    // Mirrors the template builder's clampToZone.
    if (zone.boundary_type === 'svg' && zone.svg_markup && !zone.svg_rotation) {
      const shape = zoneShapePath(zone);
      if (shape) {
        const pts = objectSamplePoints(obj.getCoords());
        if (pts.length && pointsInsideZoneShape(shape, zone, pts)) {
          obj._sgpdLastValid = { left: obj.left, top: obj.top };
          return;
        }
        if (obj._sgpdLastValid) {
          obj.set(obj._sgpdLastValid);
          obj.setCoords();
          return;
        }
        // No valid anchor yet (object placed outside the shape) → rect clamp.
      }
    }

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
  pushHistoryRef.current      = pushHistory;
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
      if (zone.boundary_type === 'svg' && (zone.svg_url || zone.svg_markup)) {
        // Load SVG from URL asynchronously, or use inline markup directly
        const promise = (zone.svg_url
          ? fetch(zone.svg_url).then((r) => r.text())
          : Promise.resolve(zone.svg_markup))
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
              data:        { zoneIndex: index, isZoneOverlay: true, svgFillEditable: !!zone.svg_fill_editable },
            });
            // Fabric.js 6.x Group.toObject doesn't serialize custom properties like `data`.
            // Override toObject to ensure `data` is included in canvas.toJSON(['data']).
            const _origToObject = group.toObject.bind(group);
            group.toObject = function(propertiesToInclude) {
              const obj = _origToObject(propertiesToInclude);
              if (this.data) obj.data = this.data;
              return obj;
            };
            // Show a boundary outline so customers can see the design area.
            // Use stronger visibility on mobile where the canvas is smaller.
            // Child paths get the visible stroke; group stroke is nulled (Fabric draws group stroke as a bounding rect).
            // For solid color products, use the shared color across all views.
            // If no solidFillColor is set yet and no snapshot exists (fresh product),
            // initialize from this zone's default color.
            let solidColor = useDesignerStore.getState().solidFillColor;
            const isSolid = globalConfig.solid_color;
            const hasSnapshot = !!useDesignerStore.getState().canvasSnapshots[currentViewIndex];
            if (isSolid && !solidColor && !hasSnapshot && zone.svg_fill_color && zone.svg_fill_editable) {
              solidColor = zone.svg_fill_color;
              useDesignerStore.getState().setSolidFillColor(solidColor);
            }
            const zoneFill = (isSolid && solidColor) || zone.svg_fill_color || (isMobileRef.current ? 'rgba(0, 0, 0, 0.06)' : 'rgba(0, 0, 0, 0.03)');
            const hasFill = !!(isSolid && solidColor) || !!zone.svg_fill_color;
            const zoneStroke = hasFill ? 'transparent' : (isMobileRef.current ? '#aaaaaa' : '#cccccc');
            const zoneStrokeWidth = hasFill ? 0 : (isMobileRef.current ? 2 : 1);
            if (group.getObjects) {
              group.getObjects().forEach((c) => c.set({ fill: zoneFill, stroke: zoneStroke, strokeWidth: zoneStrokeWidth, strokeUniform: true }));
            }
            group.set({ stroke: null, strokeWidth: 0 });

            // Remove any duplicate zone overlay from a loaded snapshot (async SVG fetch
            // completes after loadFromJSON, creating duplicates). Match by zone index
            // or by position. Preserve the customer's fill color from the snapshot.
            const dupes = canvas.getObjects().filter(
              (o) => o !== group && (o.type === 'group' || o.type === 'Group')
                && (o.data?.zoneIndex === index
                  || (Math.abs((o.left || 0) - (group.left || 0)) < 2
                      && Math.abs((o.top || 0) - (group.top || 0)) < 2
                      && o._objects?.length === group._objects?.length))
            );
            dupes.forEach((dupe) => {
              // Carry over the customer-chosen fill color from the snapshot version.
              const dupeFill = dupe._objects?.[0]?.fill;
              if (dupeFill && dupeFill !== zoneFill) {
                group.getObjects().forEach((c) => c.set({ fill: dupeFill }));
                useDesignerStore.setState((s) => ({
                  zoneFillColors: { ...s.zoneFillColors, [index]: dupeFill },
                }));
                // For solid color products, also update the shared color.
                if (isSolid) {
                  useDesignerStore.getState().setSolidFillColor(dupeFill);
                }
              }
              canvas.remove(dupe);
            });

            canvas.add(group);
            canvas.sendObjectToBack(group);
            canvas.renderAll();

            // Apply clip paths to any template layers already on canvas for this zone
            canvas.getObjects().forEach((obj) => {
              if (obj.data?.zoneIndex === index && !obj.data?.isZoneOverlay && zoneClips(zone)) {
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

    // Whether a saved snapshot exists for this view. If it does, the loadFromJSON
    // call below will restore it — including any template svg layer, with whatever
    // position/scale/rotation the customer left it in. The svg branch below loads
    // its markup asynchronously (fetch + loadSVGFromString), and that promise can
    // resolve AFTER loadFromJSON finishes restoring the snapshot, stacking a second
    // copy of the svg on top of the one the snapshot already contains — the same
    // race documented above for the zone-overlay svg dedup. Unlike that overlay
    // (which is regenerated fresh every time, non-selectable boundary art), a
    // template svg layer is customer-editable content, so we can't just delete the
    // snapshot's copy and replace it — that would discard any edits the customer
    // made to it. Skipping the reseed entirely when a snapshot exists is safe: the
    // text branch stays unguarded because it runs synchronously, before
    // loadFromJSON's own clear() wipes the canvas, so it never survives to double up.
    const hasSnapshotForView = !!useDesignerStore.getState().canvasSnapshots[currentViewIndex];

    // Render pre-placed template layers from zones.
    zones.forEach((zone, zoneIdx) => {
      (zone.layers || []).forEach((layer) => {
        if (layer.type === 'text' && layer.text) {
          const text = new Textbox(layer.text, {
            left:       layer.left       ?? (zone.x + 20),
            top:        layer.top        ?? (zone.y + 20),
            width:      layer.width      || zone.width - 20,
            fontSize:   layer.fontSize   || 24,
            fontFamily: layer.fontFamily || 'Arial',
            fill:       layer.fill       || '#000000',
            textAlign:  layer.textAlign  || 'left',
            data:       { elementType: 'text', zoneIndex: zoneIdx },
          });
          applyPermissions(text, 'text');
          if (zoneClips(zone)) applyZoneClip(text, zoneIdx);
          canvas.add(text);
          if (zone.behavior === 'restrict') clampToZone(text);
        }

        if (!hasSnapshotForView && layer.type === 'svg' && (layer.svg_markup || layer.src)) {
          const markupPromise = layer.svg_markup
            ? Promise.resolve(layer.svg_markup)
            : fetch(layer.src).then((r) => r.text());
          markupPromise
            .then((svgString) => loadSVGFromString(svgString))
            .then(({ objects, options }) => {
              if (disposed) return;
              const filtered = (objects || []).filter(Boolean);
              if (!filtered.length) return;
              filtered.forEach((o) => o.set({ strokeUniform: true }));
              const group = util.groupSVGElements(filtered, options);
              group.set({
                left:          layer.left   ?? (zone.x),
                top:           layer.top    ?? (zone.y),
                scaleX:        layer.scaleX || 1,
                scaleY:        layer.scaleY || 1,
                angle:         layer.angle  || 0,
                strokeUniform: true,
                data:          { elementType: 'svg', zoneIndex: zoneIdx },
              });
              applyPermissions(group, 'svg');
              if (zoneClips(zone)) applyZoneClip(group, zoneIdx);
              canvas.add(group);
              group.setCoords();
              if (zone.behavior === 'restrict') clampToZone(group);
              canvas.renderAll();
            })
            .catch((err) => console.warn('[PF] template svg layer load failed:', err));
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
          // For solid color products, apply the shared color to all zone overlays
          // regardless of what the snapshot contained (it may be stale).
          const latestSolidColor = useDesignerStore.getState().solidFillColor;
          const isSolidProduct = globalConfig.solid_color;

          // Sync zone fill colors from restored zone overlay objects.
          // Zone overlays may have `data.isZoneOverlay` (new saves) or may be
          // plain Groups without data (old saves). Match by position with zone config.
          const fills = {};
          canvas.getObjects().forEach((obj) => {
            if (obj.type !== 'group') return;
            const children = obj.getObjects?.();
            if (!children?.length) return;

            // Identify zone overlay: by data flag or by position match with zone config
            let zoneIdx = -1;
            let isEditable = false;
            if (obj.data?.isZoneOverlay) {
              zoneIdx = obj.data.zoneIndex;
              isEditable = !!obj.data.svgFillEditable;
            } else {
              // Legacy: match Group position with zone config
              for (let zi = 0; zi < zones.length; zi++) {
                const z = zones[zi];
                if (z.boundary_type === 'svg' && z.svg_url
                  && Math.abs((obj.left || 0) - (z.x || 0)) < 2
                  && Math.abs((obj.top || 0) - (z.y || 0)) < 2) {
                  zoneIdx = zi;
                  isEditable = !!z.svg_fill_editable;
                  break;
                }
              }
            }
            if (zoneIdx < 0) return;

            if (isSolidProduct) {
              if (latestSolidColor) {
                children.forEach((c) => c.set({ fill: latestSolidColor }));
                obj.dirty = true;
              } else if (isEditable) {
                const savedColor = children[0]?.fill;
                if (savedColor) {
                  useDesignerStore.getState().setSolidFillColor(savedColor);
                }
              }
            }
            if (isEditable) {
              fills[zoneIdx] = children[0].fill;
            }
          });
          if (Object.keys(fills).length > 0) {
            Object.entries(fills).forEach(([idx, color]) => {
              useDesignerStore.setState((s) => ({ zoneFillColors: { ...s.zoneFillColors, [idx]: color } }));
            });
          }
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
      if (!disposed) {
        snapshotViewRef.current?.(currentViewIndexRef.current, canvas.toJSON(['data']));
        pushHistoryRef.current?.();
      }
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
      if (!disposed) {
        snapshotViewRef.current?.(currentViewIndexRef.current, canvas.toJSON(['data']));
        pushHistoryRef.current?.();
      }
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
      // Only snapshot if canvas finished loading AND actually has objects —
      // prevents overwriting a good snapshot with an incomplete/empty canvas
      // during fast view switching or a load race (which would wipe the design).
      if (!disposed && canvasReady && fabricRef.current
          && fabricRef.current.getObjects().length > 0) {
        snapshotView(currentViewIndex, fabricRef.current.toJSON(['data']));
      }
      disposed = true;
      document.removeEventListener('keydown', onKeyDown);
      canvas.dispose();
      fabricRef.current = null;
    };
  }, [currentViewIndex, template]); // eslint-disable-line react-hooks/exhaustive-deps

  // Responsive zoom is handled directly by useCanvasScale via ResizeObserver
  // (no React state in the loop — instant, no visible grow/shrink animation)

  // ── Re-measure text objects after fonts load ────────────────────────────
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

  // ── Tool: add-text on canvas click ────────────────────────────────────────

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || activeTool !== 'add-text') return;

    canvas.defaultCursor = 'crosshair';

    const onClick = (opt) => {
      const ptr = canvas.getPointer(opt.e);
      const zoneIdx = findZoneForPoint(ptr.x, ptr.y, 'text');

      const zone = zoneIdx >= 0 ? zones[zoneIdx] : null;
      const defaultFont = zone?.defaultFontFamily || 'Arial';

      const textWidth = zone ? zone.width - 20 : 200;
      const text = new Textbox(__('Your text here', 'snelgraveren-product-designer'), {
        left: ptr.x,
        top: ptr.y,
        width: textWidth,
        fontFamily: defaultFont,
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

  // ── Tool: add-curved-text on canvas click ─────────────────────────────────

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || activeTool !== 'add-curved-text') return;

    canvas.defaultCursor = 'crosshair';

    const onClick = (opt) => {
      const ptr = canvas.getPointer(opt.e);
      const zoneIdx = findZoneForPoint(ptr.x, ptr.y, 'text');

      const zone = zoneIdx >= 0 ? zones[zoneIdx] : null;
      const defaultFont = zone?.defaultFontFamily || 'Arial';

      const defaultText = __('Your text here', 'snelgraveren-product-designer');
      const pathWidth = 200;
      const pathStr = archUpPath(pathWidth, 60);
      const pathObj = new FabricPath(pathStr, { visible: false });

      const text = new IText(defaultText, {
        left: ptr.x,
        top: ptr.y,
        fontFamily: defaultFont,
        fontSize: 24,
        fill: '#000000',
        path: pathObj,
        data: {
          elementType: 'curved-text',
          curvePreset: 'arch-up',
          curveIntensity: 60,
          zoneIndex: zoneIdx,
        },
      });

      applyPermissions(text, 'text');
      if (zoneIdx >= 0) applyZoneClip(text, zoneIdx);
      canvas.add(text);
      canvas.setActiveObject(text);

      if (zoneIdx >= 0) clampToZone(text);

      pushHistoryRef.current?.();
      canvas.renderAll();
      snapshotView(currentViewIndex, canvas.toJSON(['data']));
      setActiveTool('select');
    };

    canvas.on('mouse:down', onClick);
    return () => {
      canvas.off('mouse:down', onClick);
      canvas.defaultCursor = 'default';
    };
  }, [activeTool, currentViewIndex, zones, findZoneForPoint, applyPermissions, applyZoneClip, clampToZone, snapshotView, setActiveTool]);

  // ── Tool: add-engraving-text on canvas click ────────────────────────────────
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || activeTool !== 'add-engraving-text') return;
    canvas.defaultCursor = 'crosshair';

    const onClick = (opt) => {
      const ptr = canvas.getPointer(opt.e);
      const zoneIdx = findZoneForPoint(ptr.x, ptr.y, 'text');

      const defaultText = __('Your text', 'snelgraveren-product-designer');
      const fontId = 'hershey-simplex';
      const fontSize = 24;
      const { d, width, height } = renderHersheyText(defaultText, fontId, { fontSize });

      if (!d) return; // nothing to render

      const path = new FabricPath(d, {
        left: ptr.x,
        top: ptr.y,
        fill: '',
        stroke: '#000000',
        strokeWidth: 1.5,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
        selectable: true,
        data: {
          elementType: 'engraving-text',
          engravingText: defaultText,
          engravingFontId: fontId,
          engravingFontSize: fontSize,
          zoneIndex: zoneIdx,
        },
      });

      applyPermissions(path, 'text');
      if (zoneIdx >= 0) applyZoneClip(path, zoneIdx);
      canvas.add(path);
      canvas.setActiveObject(path);
      if (zoneIdx >= 0) clampToZone(path);
      pushHistoryRef.current?.();
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
    if (elementType === 'image' && template?.global_config?.vector_only) {
      setError(__('Photos are not possible on this product (engraving requires vector artwork).', 'snelgraveren-product-designer'));
      return;
    }

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
  }, [findFirstZoneForType, zones, template, applyPermissions, applyZoneClip, clampToZone, snapshotView, currentViewIndex, setActiveTool, setError]);

  const addClipartToCanvas = useCallback(async (svgUrl) => {
    try {
      const canvas = fabricRef.current;
      if (!canvas) return;

      const clipartRecolor = template?.global_config?.clipart_recolor;

      // Find the first text element's color to match clip art to
      let matchColor = null;
      if (clipartRecolor !== false) {
        const firstText = canvas.getObjects().find((o) => {
          const t = o.type?.toLowerCase();
          return t === 'i-text' || t === 'itext' || t === 'text' || t === 'textbox';
        });
        if (firstText?.fill) matchColor = firstText.fill;
      }

      // If we have a color to match, recolor the SVG source before loading
      let imgUrl = svgUrl;
      if (matchColor) {
        try {
          const resp = await fetch(svgUrl);
          let svgText = await resp.text();
          // Replace all fill and stroke colors in the SVG with the target color
          svgText = svgText.replace(/fill\s*=\s*"(?!none)[^"]*"/gi, `fill="${matchColor}"`);
          svgText = svgText.replace(/stroke\s*=\s*"(?!none)[^"]*"/gi, `stroke="${matchColor}"`);
          svgText = svgText.replace(/fill\s*:\s*(?!none)[^;"]+/gi, `fill:${matchColor}`);
          svgText = svgText.replace(/stroke\s*:\s*(?!none)[^;"]+/gi, `stroke:${matchColor}`);
          imgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
        } catch (_) { /* fall back to original URL */ }
      }

      const img = await FabricImage.fromURL(imgUrl, { crossOrigin: 'anonymous' });
      const zoneIdx = findFirstZoneForType('svg');

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
        data: {
          elementType: 'svg',
          zoneIndex: zoneIdx,
          ...(clipartRecolor === false ? { clipartNoRecolor: true } : {}),
        },
      });

      applyPermissions(img, 'svg');

      if (zoneIdx >= 0) applyZoneClip(img, zoneIdx);
      canvas.add(img);
      canvas.setActiveObject(img);

      if (zoneIdx >= 0) clampToZone(img);

      canvas.renderAll();
      snapshotView(currentViewIndex, canvas.toJSON(['data']));
    } catch (err) {
      setError(err.message);
    }
  }, [findFirstZoneForType, zones, template, applyPermissions, applyZoneClip, clampToZone, snapshotView, currentViewIndex, setError]);

  // ── Tool: draw (PencilBrush) ───────────────────────────────────────────────

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    if (activeTool === 'draw') {
      canvas.isDrawingMode = true;
      const brush = new PencilBrush(canvas);
      brush.color = useDesignerStore.getState().drawingStrokeColor;
      brush.width = useDesignerStore.getState().drawingStrokeWidth;
      canvas.freeDrawingBrush = brush;
    } else {
      canvas.isDrawingMode = false;
    }
  }, [activeTool]);

  // Update brush when stroke settings change
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !canvas.freeDrawingBrush) return;
    canvas.freeDrawingBrush.color = drawingStrokeColor;
    canvas.freeDrawingBrush.width = drawingStrokeWidth;
  }, [drawingStrokeColor, drawingStrokeWidth]);

  // Handle completed drawn paths
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const onPathCreated = ({ path }) => {
      const zi = findZoneForObject(path);
      path.set({ data: { elementType: 'drawing', zoneIndex: zi } });

      if (zi != null) {
        applyZoneClip(path, zi);
      }

      pushHistoryRef.current?.();
      snapshotViewRef.current?.(currentViewIndexRef.current, canvas.toJSON(['data']));
    };

    canvas.on('path:created', onPathCreated);
    return () => {
      canvas.off('path:created', onPathCreated);
    };
  }, [currentViewIndex, findZoneForObject, applyZoneClip]);

  // ── Tool: erase (click drawn paths to remove) ─────────────────────────────

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || activeTool !== 'erase') return;

    let hoveredPath = null;

    const handleMouseMove = (opt) => {
      const target = canvas.findTarget(opt.e);
      if (hoveredPath && hoveredPath !== target) {
        hoveredPath.set({ opacity: 1 });
        canvas.renderAll();
      }
      if (target && target.data?.elementType === 'drawing') {
        hoveredPath = target;
        target.set({ opacity: 0.4 });
        canvas.renderAll();
      } else {
        hoveredPath = null;
      }
    };

    const handleMouseDown = (opt) => {
      const target = canvas.findTarget(opt.e);
      if (target && target.data?.elementType === 'drawing') {
        pushHistoryRef.current?.();
        canvas.remove(target);
        canvas.renderAll();
        snapshotViewRef.current?.(currentViewIndexRef.current, canvas.toJSON(['data']));
        hoveredPath = null;
      }
    };

    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:down', handleMouseDown);
    canvas.defaultCursor = 'crosshair';

    return () => {
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:down', handleMouseDown);
      canvas.defaultCursor = 'default';
      if (hoveredPath) {
        hoveredPath.set({ opacity: 1 });
        canvas.renderAll();
      }
    };
  }, [activeTool, currentViewIndex]);

  const onFileSelected = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const elementType = e.target.dataset.elementType || 'image';
    e.target.value = '';
    handleFileUpload(file, elementType);
  }, [handleFileUpload]);

  const setAddClipart = useDesignerStore((s) => s.setAddClipart);

  useEffect(() => {
    setAddClipart(addClipartToCanvas);
  }, [addClipartToCanvas, setAddClipart]);

  return (
    <div className="pf-canvas-wrap" ref={scaleContainerRef}>
      <div className="pf-canvas-scroll">
        <canvas ref={canvasEl} />
      </div>
      <input
        id="pf-upload-image"
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        data-element-type="image"
        style={{ display: 'none' }}
        onChange={onFileSelected}
      />
      <input
        id="pf-upload-svg"
        type="file"
        accept="image/svg+xml"
        data-element-type="svg"
        style={{ display: 'none' }}
        onChange={onFileSelected}
      />
    </div>
  );
}
