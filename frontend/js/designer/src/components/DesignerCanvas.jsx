import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { __ } from '@wordpress/i18n';
import { Canvas as FabricCanvas, Rect, IText, FabricImage, Path as FabricPath, PencilBrush, loadSVGFromString, util, cache as fabricCache } from 'fabric';
import { archUpPath } from '../utils/curvePresets';
import { renderHersheyText, ENGRAVING_FONTS } from '../utils/hersheyFonts';
import useDesignerStore from '../store/useDesignerStore';
import { uploadFile } from '../api/designerApi';
import useCanvasScale from '../hooks/useCanvasScale';
import useIsMobile from '../hooks/useIsMobile';
import useCanvasHistory from '../hooks/useCanvasHistory';
import { filterFabricJson } from '../utils/fabricJson';
import { fitInsideZoneShape } from '../../../../../shared/js/zoneContainment';
import { clampObjectDuringMove, settleObjectInZone, zoneContainmentShape } from '../../../../../shared/js/zoneClamp';
import { zoneClips, firstZoneForCustomerType, zoneAtPointForCustomerType } from '../../../../../shared/js/zoneSelection';
import { minFontSizePx, textMinScaleLimit } from '../../../../../shared/js/fontSizeLimits';
import { isLayerLockedForCustomer } from '../../../../../shared/js/layerLockForCustomer';
import MmRuler from '../../../../../shared/js/MmRuler.jsx';
import { resolveWidthMm } from '../../../../../shared/js/rulerTicks';
import { resolveTextAnchor } from '../../../../../shared/js/textAnchor';
import { ensureFontMeasured } from '../../../../../shared/js/ensureFontMeasured';
import { onFontFamilyLoaded } from '../../../../../shared/js/googleFontLoader';
import { installTextPlaceholders, isTextPlaceholder } from '../../../../../shared/js/textPlaceholder';
import { inferElementType, reapplyPostRestoreState } from '../utils/postRestoreState';

// Shape-aware initial placement for a newly-added image/clipart object.
// Uses zoneContainmentShape() — the same test the clamp and the settle use —
// so all three agree about which zones are enforced against their outline.
// Placing blind at the bbox centre would leave the object outside a concave or
// off-centre contour. Returns true (and mutates `img`'s left/top/scaleX/scaleY)
// when it placed the object via the shape fit; false means the caller should
// fall back to the existing bbox-centred placement unchanged.
// Unlike the settle, this one MAY scale the object down: it is choosing an
// initial size for something the customer has not sized yet, not overriding a
// size they chose.
function placeInsideZoneShape(img, zone) {
  // One shared answer to "is this zone enforced against its outline?" — the
  // clamp, the settle and this placement must never disagree about that.
  const shape = zoneContainmentShape(zone);
  if (!shape) return false;
  // Same cap as the existing scaleToWidth(Math.min(img.width, zone.width * 0.8))
  // call it replaces: never upscale past the source's natural pixel size.
  const maxScale = Math.min(1, (zone.width * 0.8) / img.width);
  const fit = fitInsideZoneShape({ shape, zone, width: img.width, height: img.height, maxScale });
  if (!fit) return false;
  img.set({ scaleX: fit.scale, scaleY: fit.scale, left: fit.left, top: fit.top });
  return true;
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
  const settleRef          = useRef(null);
  const clampEngravingTextRef = useRef(null);
  const snapToGridRef      = useRef(null);
  const snapshotViewRef    = useRef(null);
  const pushHistoryRef     = useRef(null);
  const currentViewIndexRef = useRef(0);
  const addTextGuardRef    = useRef(false);
  const applyPermissionsRef = useRef(null);

  const isMobile = useIsMobile();
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile; // keep ref in sync for event handlers

  const {
    template, currentViewIndex, activeTool,
    canvasSnapshots, snapshotView, setActiveTool,
    setSelectedObject, setError, setFabricCanvasRef,
    setApplyPermissionsRef,
    drawingStrokeColor, drawingStrokeWidth,
  } = useDesignerStore();

  const currentView = template?.views?.[currentViewIndex];
  const zones = currentView?.zones_config || EMPTY_ZONES;
  const globalConfig = template?.global_config || EMPTY_CONFIG;
  const permissions = globalConfig.permissions || EMPTY_PERMISSIONS;

  const canvasWidth = currentView?.canvas_width || 800;
  const canvasHeight = currentView?.canvas_height || 600;
  const { containerRef: scaleContainerRef } = useCanvasScale(canvasWidth, canvasHeight, fabricRef);

  // Physical width (mm) for this view: falls back to a sibling view's
  // width_mm when this view has none set (R13 — front/back of one physical
  // object share it). Single derived value reused by the ruler AND by
  // minFontSizePx below (R15) — one physical width per view, read one way,
  // so the ruler and the minimum-font-size enforcement never disagree.
  const { widthMm } = resolveWidthMm(template?.views, currentViewIndex);
  const showRuler = widthMm > 0 && !isMobile;

  // Pass fabricRef (the ref object) so useCanvasHistory always reads .current at call time,
  // avoiding stale closures from null captured at mount. applyPermissionsRef is the same
  // pattern: applyPermissions is defined further down (it depends on `permissions`,
  // `canvasWidth`, `widthMm`), so useCanvasHistory reads it via ref at undo/redo time
  // rather than needing it in scope here.
  const { pushHistory, undo, redo } = useCanvasHistory(fabricRef, currentViewIndex, applyPermissionsRef);

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

  // The whole canvas, as the fallback keep-inside rect for an element that
  // belongs to no restrict zone (shared/js/zoneClamp.js#keepInsideRect).
  // Memoised: an inline object literal would be a new reference every render
  // and would destabilise every useCallback that depends on it.
  const canvasRect = useMemo(
    () => ({ width: canvasWidth, height: canvasHeight }),
    [canvasWidth, canvasHeight]
  );

  // zoneClips / the two "which zone accepts this?" walks live in
  // shared/js/zoneSelection.js — one rule, one place.

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

  const findZoneForPoint = useCallback(
    (x, y, elementType) => zoneAtPointForCustomerType(zones, x, y, elementType),
    [zones]
  );

  const findFirstZoneForType = useCallback(
    (elementType) => firstZoneForCustomerType(zones, elementType),
    [zones]
  );

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

    // Corner handles change scaleY, not fontSize, so the effective size is
    // fontSize * scaleY. Clamping the size input alone leaves the handles as an
    // open door under the template's engraving minimum. Same helper the
    // template builder's Canvas.jsx uses — the merchant is held to the exact
    // same floor as the customer, from one implementation.
    const limit = textMinScaleLimit({
      minFontSizeMm: permissions.text?.min_font_size_mm,
      canvasWidth,
      widthMm,
      fontSize: obj.fontSize,
      minScale: perms.min_scale,
    });
    if (limit != null) obj.set({ minScaleLimit: limit });
  }, [permissions, canvasWidth, widthMm]);

  // ── Clamp object inside its assigned zone ─────────────────────────────────

  const zoneOf = useCallback((obj) => {
    const zi = obj?.data?.zoneIndex;
    if (zi == null || zi < 0 || !zones[zi] || zones[zi].behavior !== 'restrict') return null;
    return zones[zi];
  }, [zones]);

  // Live clamp, run on EVERY frame of a drag/scale: bounding box only. The
  // outline is deliberately NOT enforced here — see shared/js/zoneClamp.js for
  // why enforcing it mid-drag made the object fight the pointer and read as
  // frozen. Identical decision to the template builder's, from one module.
  // No zone (or a zone that only clips) falls back to the canvas, so nothing
  // the customer adds can be dragged off the design.
  const clampToZone = useCallback((obj) => {
    clampObjectDuringMove(obj, zoneOf(obj), { canvas: canvasRect });
  }, [zoneOf, canvasRect]);

  // End-of-gesture enforcement: hold the object inside the real svg outline,
  // or — when nothing fits at its current size — leave it exactly where the
  // customer put it, still selectable and still movable. Zoneless objects get
  // the canvas fallback here too, and never an outline.
  const settleIntoZone = useCallback((obj) => {
    settleObjectInZone(obj, zoneOf(obj), { canvas: canvasRect });
  }, [zoneOf, canvasRect]);

  const clampScaleToZone = useCallback((obj) => {
    const zone = zoneOf(obj);
    // No zone: never resize the object to fit anything — just keep its
    // position honest against the canvas fallback while the handle is held.
    if (!zone) { clampToZone(obj); return; }

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
    // Live scaling gets the LENIENT clamp only, for the same reason dragging
    // does: enforcing the outline while the handle is held snaps the object
    // back on every frame and it can no longer be resized. The outline is
    // enforced once on object:modified, when the handle is released.
    clampToZone(obj);
  }, [zoneOf, permissions, clampToZone]);

  // ── Clamp engraving-text scaling to the template minimum font size ───────
  // Engraving text (single-stroke Hershey Path, data.elementType ===
  // 'engraving-text') has no fontSize property — its size lives in
  // data.engravingFontSize — so minScaleLimit (a ratio against fontSize, set
  // in applyPermissions above) has nothing to hook into for this object
  // type. The corner handles are otherwise a second, open lever below the
  // template minimum. Reuses the SAME minFontSizePx floor as applyPermissions
  // and the size input in ElementTab.jsx — one source, two entry points,
  // never a second formula for this object shape.
  const clampEngravingTextScale = useCallback((obj) => {
    if (!obj || obj.data?.elementType !== 'engraving-text') return;

    const minPx = minFontSizePx({
      minFontSizeMm: permissions.text?.min_font_size_mm,
      canvasWidth,
      widthMm,
    });
    if (minPx <= 0) return;

    const baseSize = obj.data?.engravingFontSize;
    if (!baseSize || baseSize <= 0) return;

    const minScale = minPx / baseSize;
    let changed = false;
    if (obj.scaleY < minScale) { obj.set({ scaleY: minScale }); changed = true; }
    if (obj.scaleX < minScale) { obj.set({ scaleX: minScale }); changed = true; }
    if (changed) obj.setCoords();
  }, [permissions, canvasWidth, widthMm]);

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
  settleRef.current           = settleIntoZone;
  clampEngravingTextRef.current = clampEngravingTextScale;
  snapToGridRef.current       = snapToGrid;
  snapshotViewRef.current     = snapshotView;
  pushHistoryRef.current      = pushHistory;
  currentViewIndexRef.current = currentViewIndex;
  applyPermissionsRef.current = applyPermissions;

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
    // Publish the STABLE applyPermissionsRef object (identity never changes,
    // only .current does — see the store comment) so Toolbar's sibling
    // useCanvasHistory() instance (the one actually wired to the visible
    // undo/redo buttons) can re-apply permissions/lock state on its own
    // restores too, not just the Ctrl+Z keyboard path below.
    setApplyPermissionsRef(applyPermissionsRef);

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
            // Override toObject to ensure `data` is included in canvas.toObject(['data']).
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
        // An EMPTY template text layer is seeded too. It used to be skipped
        // entirely, so a layer the merchant authored empty for the customer to
        // fill in simply was not there. shared/js/textPlaceholder.js gives the
        // empty IText a dashed, clickable box; clicking it opens the caret.
        if (layer.type === 'text') {
          // Use IText (auto-width, hugs its content) instead of Textbox (fixed
          // width). A Textbox kept the old wide layout box even for a short
          // name, so the selection/drag box ran far past the text. The layer
          // was authored with a wide box + an alignment; anchor the IText by
          // that alignment so its VISUAL position stays put while the box now
          // hugs the text and grows/shrinks live as the customer types.
          const align  = layer.textAlign || 'left';
          const anchor = resolveTextAnchor(layer, zone);

          // R21: the padlock now governs the customer side too — text default
          // stays movable (locked only when the merchant explicitly locks it).
          const locked = isLayerLockedForCustomer(layer);

          const text = new IText(layer.text || '', {
            left:       anchor.left,
            top:        anchor.top,
            originX:    anchor.originX,
            originY:    anchor.originY,
            fontSize:   layer.fontSize   || 24,
            fontFamily: layer.fontFamily || 'Arial',
            fill:       layer.fill       || '#000000',
            textAlign:  align,
            opacity:    layer.opacity ?? 1,
            // evented:false (locked case) is what lets clicks fall through to
            // any layer above/below this one. data.templateLocked is
            // persisted via canvas.toObject(['data']) and re-enforced on
            // snapshot restore, since selectable/evented never serialize.
            ...(locked
              ? { selectable: false, evented: false, hasControls: false, lockMovementX: true, lockMovementY: true }
              : {}),
            data:       { elementType: 'text', zoneIndex: zoneIdx, templateLocked: locked },
          });
          if (zoneClips(zone)) applyZoneClip(text, zoneIdx);
          canvas.add(text);
          if (!locked) {
            applyPermissions(text, 'text');
            // Template-authored layers get the LENIENT clamp, not the outline
            // settle: this is what the merchant positioned, and load time is
            // not a customer gesture. Moving their layout on render would be a
            // surprise; the outline is enforced the moment the customer drags.
            if (zone.behavior === 'restrict') clampToZone(text);
          }
          // Template text renders before its custom font may have finished
          // loading (real-world timing, not covered by the global
          // 'loadingdone' listener below) — re-measure this object
          // specifically once its exact font is confirmed loaded.
          ensureFontMeasured(text, fabricCache);
        }

        if (!hasSnapshotForView && layer.type === 'svg' && (layer.svg_markup || layer.src)) {
          // R21: the padlock now governs the customer side too — svg defaults
          // to locked (matches what every unset-padlock layer already did)
          // and is released only when the merchant explicitly unlocks it.
          const locked = isLayerLockedForCustomer(layer);
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
                opacity:       layer.opacity ?? 1,
                strokeUniform: true,
                // evented:false (locked case) is what lets clicks fall through
                // to text sitting above/below this layer. data.templateLocked
                // is persisted via canvas.toObject(['data']) and re-enforced on
                // snapshot restore, since selectable/evented never serialize.
                ...(locked
                  ? { selectable: false, evented: false, hasControls: false, lockMovementX: true, lockMovementY: true }
                  : { selectable: true, evented: true }),
                data:          { elementType: 'svg', zoneIndex: zoneIdx, templateLocked: locked },
              });
              if (zoneClips(zone)) applyZoneClip(group, zoneIdx);
              canvas.add(group);
              if (!locked) {
                applyPermissions(group, 'svg');
                if (zone.behavior === 'restrict') clampToZone(group);
              }
              group.setCoords();
              // Template art loads async and lands ON TOP of the synchronously
              // added text layers; a group's hit-area is its bounding box, so
              // it swallows every click meant for the text underneath and the
              // customer cannot select/edit the text. Keep text layers above
              // template art.
              canvas.getObjects().forEach((o) => {
                if (o.data?.elementType === 'text') canvas.bringObjectToFront(o);
              });
              canvas.renderAll();
            })
            .catch((err) => console.warn('[PF] template svg layer load failed:', err));
        }

        if (!hasSnapshotForView && layer.type === 'image' && layer.src) {
          // R21: the bitmap background (template_art, default true — the
          // LightBurn-imported reference bitmap) stays locked regardless of
          // the padlock, per fe3b5d9. Any other image layer (template_art:
          // false — none exist on live templates today) follows the same
          // padlock rule as svg: locked unless explicitly unlocked.
          const isBackgroundArt = layer.template_art !== false;
          const locked = isBackgroundArt || isLayerLockedForCustomer(layer);
          FabricImage.fromURL(layer.src, { crossOrigin: 'anonymous' })
            .then((img) => {
              if (disposed) return;
              img.set({
                left:          layer.left   ?? zone.x,
                top:           layer.top    ?? zone.y,
                originX:       layer.originX || 'left',
                originY:       layer.originY || 'top',
                scaleX:        layer.scaleX || 1,
                scaleY:        layer.scaleY || 1,
                angle:         layer.angle  || 0,
                opacity:       layer.opacity ?? 1,
                visible:       layer.visible !== false,
                // evented:false (locked case) is what lets clicks fall through
                // to the text and logos above it. data.templateLocked is
                // persisted via canvas.toObject(['data']) and re-enforced on
                // snapshot restore, since selectable/evented never serialize.
                ...(locked
                  ? { selectable: false, evented: false, hasControls: false, lockMovementX: true, lockMovementY: true }
                  : {}),
                data: {
                  elementType:       'image',
                  zoneIndex:         zoneIdx,
                  templateLocked:    locked,
                  // Kept out of every export render (App.jsx) and out of both
                  // price counters (priceCounts.js / PriceCalculator).
                  excludeFromExport: layer.exclude_from_export !== false,
                  templateArt:       layer.template_art !== false,
                },
              });
              if (zoneClips(zone)) applyZoneClip(img, zoneIdx);
              canvas.add(img);
              if (isBackgroundArt) {
                canvas.sendObjectToBack(img);
              } else if (!locked) {
                applyPermissions(img, 'image');
                if (zone.behavior === 'restrict') clampToZone(img);
              }
              img.setCoords();
              canvas.renderAll();
            })
            .catch((err) => console.warn('[PF] template image layer load failed:', err));
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

          // Re-apply permission/interactivity state — minScaleLimit,
          // hasControls, mtr-control visibility — plus lock state, that
          // loadFromJSON cannot restore. Fabric 6 never serializes
          // minScaleLimit (it lives only in interactiveObjectDefaultValues,
          // not in toObject output), so every restore (view switch, undo,
          // ?pf_design=HASH reload) silently reopened the corner-handle
          // floor even though the number-input floor (ElementTab,
          // recomputed from the template on every render) stayed intact —
          // the exact creation-vs-restore divergence R14/R15 closed for the
          // other entry points, back via this one. Shared with
          // useCanvasHistory's undo/redo restore (same defect, same fix) —
          // see utils/postRestoreState.js for the full ordering rationale
          // and the geometry-never-touched guarantee.
          reapplyPostRestoreState(canvas, applyPermissions);

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
      // Live guard so the handle stops at the floor while dragging, not
      // only after release (R14 — same rule as the fontSize input clamp).
      clampEngravingTextRef.current?.(e.target);
    });

    canvas.on('object:modified', (e) => {
      // The gesture is over: NOW enforce the zone's real outline, once, before
      // anything snapshots the object's position. Never from object:moving —
      // see shared/js/zoneClamp.js.
      settleRef.current?.(e.target);
      // Backstop in case a path bypasses the live object:scaling event.
      clampEngravingTextRef.current?.(e.target);
      if (!disposed) {
        // Every snapshot in this file uses canvas.toObject(['data']), never
        // canvas.toJSON(['data']) — Fabric 6.9.1's Canvas.prototype.toJSON()
        // takes NO parameters and internally calls this.toObject() with no
        // arguments, so a propertiesToInclude argument passed to toJSON is
        // silently dropped (see node_modules/fabric/dist/index.mjs, the
        // `toJSON() { return this.toObject(); }` override). That made
        // `canvas.toJSON(['data'])` throughout this file equivalent to a bare
        // `canvas.toJSON()` for every object except the zone-boundary Group
        // above, which patches its own toObject() to inject `data`
        // unconditionally — real objects (IText/Image/Path) silently lost
        // `data.elementType`/`data.zoneIndex`/`data.templateLocked` on every
        // snapshot, breaking both the lock re-enforcement below and any
        // restore-time permission re-apply. canvas.toObject(['data'])
        // forwards propertiesToInclude correctly and returns the identical
        // plain-object shape loadFromJSON already accepts — a safe drop-in
        // fix, not a behavior change for anything that already worked.
        snapshotViewRef.current?.(currentViewIndexRef.current, canvas.toObject(['data']));
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

    canvas.on('object:removed', (e) => {
      // Placeholder decorations are chrome: they are added and removed as text
      // empties and fills, and are excluded from toObject() anyway. Snapshotting
      // and pushing history for them would add undo steps for a change that is
      // not in the design.
      if (isTextPlaceholder(e?.target)) return;
      if (!disposed) {
        snapshotViewRef.current?.(currentViewIndexRef.current, canvas.toObject(['data']));
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

    // An emptied text object — a template layer authored empty, or the
    // customer's own text they just cleared — stays on the canvas as a dashed,
    // clickable box. enterEditing: true because typing on the canvas is the
    // ONLY way a customer can put text back (the sidebar has no text field),
    // so a click has to open the caret, not just select.
    const disposePlaceholders = installTextPlaceholders(canvas, Rect, { enterEditing: true });

    canvas.renderAll();

    return () => {
      // Only snapshot if canvas finished loading AND actually has objects —
      // prevents overwriting a good snapshot with an incomplete/empty canvas
      // during fast view switching or a load race (which would wipe the design).
      if (!disposed && canvasReady && fabricRef.current
          && fabricRef.current.getObjects().length > 0) {
        snapshotView(currentViewIndex, fabricRef.current.toObject(['data']));
      }
      disposed = true;
      canvas.__sgpdDisposed = true;
      disposePlaceholders();
      document.removeEventListener('keydown', onKeyDown);
      canvas.dispose();
      fabricRef.current = null;
    };
  }, [currentViewIndex, template]); // eslint-disable-line react-hooks/exhaustive-deps

  // Responsive zoom is handled directly by useCanvasScale via ResizeObserver
  // (no React state in the loop — instant, no visible grow/shrink animation)

  // ── Re-measure text objects after fonts load (secondary safety net) ─────
  // NOTE: this only fires for genuine document.fonts loading-state
  // transitions (custom uploaded @font-face files, the css2 <link>
  // fallback for canonical Google Font names). It does NOT reliably fire
  // for a non-canonical alias ("BebasNeue") registered via the proxy-
  // FontFace path in shared/js/googleFontLoader.js, because that FontFace
  // is already `loaded` before it's added to the set — see the
  // onFontFamilyLoaded effect below, which is the authoritative mechanism
  // for that case.
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

  // ── Re-measure text objects when an exact-alias Google Font resolves ────
  // Authoritative for the proxy-registered-alias case (see comment above
  // and shared/js/googleFontLoader.js): driven directly from the loader's
  // own completion, not from a document.fonts event, so it fires exactly
  // when the family actually becomes available — including for text
  // objects that were created/measured against a fallback font before this
  // resolved. Reads fabricRef.current at call time (not captured at effect
  // setup) so it stays correct across the view-switch dispose/recreate
  // cycle (this component's fabric canvas is torn down and rebuilt by a
  // separate effect keyed on [currentViewIndex, template], while this
  // subscription effect itself only runs once).
  useEffect(() => {
    return onFontFamilyLoaded((family) => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      fabricCache.clearFontCache(family);
      canvas.getObjects().forEach((obj) => {
        if ((obj.type === 'text' || obj.type === 'i-text') && obj.fontFamily === family) {
          obj.initDimensions();
          obj.setCoords();
        }
      });
      canvas.renderAll();
    });
  }, []);

  // ── Tool: add-text, placed immediately centred in the boundary ─────────────

  useEffect(() => {
    if (activeTool !== 'add-text') addTextGuardRef.current = false;
  }, [activeTool]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || activeTool !== 'add-text') return;

    // setActiveTool('select') below is async with respect to this effect, so a
    // dependency change in the same tick could re-enter and add a second copy.
    // The ref makes the placement idempotent for one activation of the tool.
    if (addTextGuardRef.current) return;
    addTextGuardRef.current = true;

    // Place immediately, centred in the boundary — no click step. The customer
    // drags it into position afterwards, which is the interaction that actually
    // reads as "put the text where I want it".
    const zoneIdx = findFirstZoneForType('text');
    const zone = zoneIdx >= 0 ? zones[zoneIdx] : null;
    const defaultFont = zone?.defaultFontFamily || 'Arial';

    const minPx = minFontSizePx({
      minFontSizeMm: permissions.text?.min_font_size_mm,
      canvasWidth,
      widthMm,
    });

    const text = new IText(__('Your text here', 'snelgraveren-product-designer'), {
      left:       zone ? zone.x + zone.width / 2  : canvasWidth / 2,
      top:        zone ? zone.y + zone.height / 2 : canvasHeight / 2,
      originX:    'center',
      originY:    'center',
      fontFamily: defaultFont,
      fontSize:   Math.max(24, Math.ceil(minPx)),
      fill:       '#000000',
      data: {
        elementType: 'text',
        zoneIndex:   zoneIdx,
      },
    });

    applyPermissions(text, 'text');
    if (zoneIdx >= 0) applyZoneClip(text, zoneIdx);
    canvas.add(text);
    canvas.setActiveObject(text);
    // One-shot placement, so the strict settle applies: the zone's bounding-box
    // centre this text was just placed at can fall OUTSIDE a concave outline,
    // and the settle walks it to the nearest spot that actually fits. No anchor
    // is seeded any more — nothing snaps back to a remembered position.
    // Called unconditionally: with no zone the settle falls back to the canvas
    // rect, so even an unzoned element lands on the design.
    settleIntoZone(text);
    // The zone's default font may still be loading at the moment the tool
    // places this object — re-measure once it's confirmed loaded.
    ensureFontMeasured(text, fabricCache);

    pushHistoryRef.current?.();
    canvas.renderAll();
    snapshotView(currentViewIndex, canvas.toObject(['data']));
    setActiveTool('select');
  }, [activeTool, currentViewIndex, zones, permissions, canvasWidth, canvasHeight,
      widthMm, findFirstZoneForType, applyPermissions, applyZoneClip, settleIntoZone, snapshotView, setActiveTool]);

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
        left:       zone ? zone.x + zone.width / 2  : canvasWidth / 2,
        top:        zone ? zone.y + zone.height / 2 : canvasHeight / 2,
        originX:    'center',
        originY:    'center',
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
      // One-shot placement → strict settle (see the add-text tool above).
      settleIntoZone(text);
      // The zone's default font may still be loading at the moment the tool
      // places this object — re-measure once it's confirmed loaded.
      ensureFontMeasured(text, fabricCache);

      pushHistoryRef.current?.();
      canvas.renderAll();
      snapshotView(currentViewIndex, canvas.toObject(['data']));
      setActiveTool('select');
    };

    canvas.on('mouse:down', onClick);
    return () => {
      canvas.off('mouse:down', onClick);
      canvas.defaultCursor = 'default';
    };
  }, [activeTool, currentViewIndex, zones, canvasWidth, canvasHeight, findZoneForPoint, applyPermissions, applyZoneClip, settleIntoZone, snapshotView, setActiveTool]);

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
      // One-shot placement → strict settle (see the add-text tool above).
      settleIntoZone(path);
      pushHistoryRef.current?.();
      canvas.renderAll();
      snapshotView(currentViewIndex, canvas.toObject(['data']));
      setActiveTool('select');
    };

    canvas.on('mouse:down', onClick);
    return () => {
      canvas.off('mouse:down', onClick);
      canvas.defaultCursor = 'default';
    };
  }, [activeTool, currentViewIndex, findZoneForPoint, applyPermissions, applyZoneClip, settleIntoZone, snapshotView, setActiveTool]);

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
        if (!placeInsideZoneShape(img, zone)) {
          img.scaleToWidth(Math.min(img.width, zone.width * 0.8));
          img.set({
            left: zone.x + zone.width / 2 - (img.getScaledWidth() / 2),
            top:  zone.y + zone.height / 2 - (img.getScaledHeight() / 2),
          });
        }
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

      // One-shot placement → strict settle (see the add-text tool above).
      settleIntoZone(img);

      canvas.renderAll();
      snapshotView(currentViewIndex, canvas.toObject(['data']));
    } catch (err) {
      setError(err.message);
    }

    setActiveTool('select');
  }, [findFirstZoneForType, zones, template, applyPermissions, applyZoneClip, settleIntoZone, snapshotView, currentViewIndex, setActiveTool, setError]);

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
        if (!placeInsideZoneShape(img, zone)) {
          img.scaleToWidth(Math.min(img.width, zone.width * 0.8));
          img.set({
            left: zone.x + zone.width / 2 - (img.getScaledWidth() / 2),
            top:  zone.y + zone.height / 2 - (img.getScaledHeight() / 2),
          });
        }
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

      // One-shot placement → strict settle (see the add-text tool above).
      settleIntoZone(img);

      canvas.renderAll();
      snapshotView(currentViewIndex, canvas.toObject(['data']));
    } catch (err) {
      setError(err.message);
    }
  }, [findFirstZoneForType, zones, template, applyPermissions, applyZoneClip, settleIntoZone, snapshotView, currentViewIndex, setError]);

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
      snapshotViewRef.current?.(currentViewIndexRef.current, canvas.toObject(['data']));
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
        snapshotViewRef.current?.(currentViewIndexRef.current, canvas.toObject(['data']));
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
    <div className="pf-canvas-wrap">
      <div className={`pf-canvas-grid${showRuler ? ' pf-canvas-grid--ruler' : ''}`}>
        {showRuler && (
          <MmRuler
            key={currentViewIndex}
            canvasRef={canvasEl}
            widthMm={widthMm}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
          />
        )}
        <div className="pf-canvas-cell" ref={scaleContainerRef}>
          <div className="pf-canvas-scroll">
            <canvas ref={canvasEl} />
          </div>
        </div>
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
