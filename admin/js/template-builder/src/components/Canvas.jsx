import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import { Canvas as FabricCanvas, Rect, FabricImage, IText, FabricText, loadSVGFromString, util, cache as fabricCache } from 'fabric';
import useTemplateStore from '../store/useTemplateStore';
import { parseSvgToFabric } from '../utils/svgPathUtils';
import { alignElement } from '../../../../../shared/js/alignElement';
import { clampObjectDuringMove, settleObjectInZone } from '../../../../../shared/js/zoneClamp';
import { mergeLayersToBoundary } from '../utils/mergeLayersToBoundary';
import MmRuler from '../../../../../shared/js/MmRuler.jsx';
import { resolveWidthMm } from '../../../../../shared/js/rulerTicks';
import { textMinScaleLimit } from '../../../../../shared/js/fontSizeLimits';
import { installTextPlaceholders, syncTextPlaceholders } from '../../../../../shared/js/textPlaceholder';
import { resolveTextAnchor, buildTextAnchorPatch } from '../../../../../shared/js/textAnchor';
import { ensureFontMeasured } from '../../../../../shared/js/ensureFontMeasured';
import { onFontFamilyLoaded } from '../../../../../shared/js/googleFontLoader';

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
  const settleRef          = useRef(null);
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
    updateView, updateZone, updateLayer, addZone, pushHistory, undo, redo, canUndo, canRedo,
    isFreeMove, setFreeMove, setCanvasSelectedKey,
  } = useTemplateStore();

  const permissions = useTemplateStore((s) => s.globalConfig?.permissions || {});

  const currentView = views[currentViewIndex];
  const viewKey = currentView?._clientId || currentViewIndex;
  // Ruler physical width: falls back to a sibling view's width_mm when this
  // view has none set (R13 — front/back of one physical object share it).
  const { widthMm } = resolveWidthMm(views, currentViewIndex);
  // Same defaults the Fabric canvas is initialised with below. Paired with
  // widthMm, canvasWidth is the mm→px scale used for the minimum-font-size
  // floor, so the floor and the ruler always read the view the same way.
  // Every consumer of the canvas size in this component derives from these two
  // so they cannot disagree after a resize (see the live-resize effect below).
  const canvasWidth  = currentView?.canvas_width  || 800;
  const canvasHeight = currentView?.canvas_height || 600;

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

  // A zone that visually clips its layers: 'restrict' also clamps movement
  // inside the boundary, 'clip' lets layers move freely but cuts them off at
  // the boundary. Mirrors the frontend designer's zoneClips helper.
  const zoneClips = (z) => !!z && (z.behavior === 'restrict' || z.behavior === 'clip');

  const applyZoneClip = useCallback((obj, zoneIdx) => {
    if (isFreeMove) return;
    const zones = views[currentViewIndex]?.zones_config || [];
    if (zoneIdx < 0 || !zoneClips(zones[zoneIdx])) return;
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

  // The temporary object the background-edit mode puts on the canvas
  // (enterBgEdit below). A background is MEANT to bleed past the canvas edge,
  // so it is the one movable object the canvas fallback must not touch.
  const isBackgroundObject = (obj) => obj?.data?.elementType === '_background';

  // The whole canvas, as the fallback keep-inside rect for a layer that belongs
  // to no restrict zone (shared/js/zoneClamp.js#keepInsideRect). Memoised so it
  // does not destabilise the callbacks that depend on it. Free move still
  // switches every clamp off, so the merchant keeps a way out.
  const canvasRect = useMemo(
    () => ({ width: canvasWidth, height: canvasHeight }),
    [canvasWidth, canvasHeight]
  );

  const zoneOf = useCallback((obj) => {
    const zi = obj?.data?.zoneIndex;
    const zones = views[currentViewIndex]?.zones_config || [];
    if (zi == null || zi < 0 || !zones[zi] || zones[zi].behavior !== 'restrict') return null;
    return zones[zi];
  }, [views, currentViewIndex]);

  // Live clamp, run on EVERY frame of a drag/scale: bounding box only. The
  // outline is deliberately not enforced here — see shared/js/zoneClamp.js for
  // why enforcing it mid-drag froze the object against the pointer.
  const clampToZone = useCallback((obj) => {
    if (isFreeMove) return;
    if (isBackgroundObject(obj)) return;
    clampObjectDuringMove(obj, zoneOf(obj), { canvas: canvasRect });
  }, [zoneOf, isFreeMove, canvasRect]);

  // End-of-gesture enforcement: hold the object inside the actual svg outline,
  // or — when nothing fits at its current size — leave it alone rather than
  // trap it. Same shared decision the customer designer applies.
  const settleIntoZone = useCallback((obj) => {
    if (isFreeMove) return;
    if (isBackgroundObject(obj)) return;
    settleObjectInZone(obj, zoneOf(obj), { canvas: canvasRect });
  }, [zoneOf, isFreeMove, canvasRect]);

  const clampScaleToZone = useCallback((obj) => {
    if (isFreeMove) return;
    const zone = zoneOf(obj);
    // No zone: never resize the layer to fit anything — just keep its position
    // honest against the canvas fallback while the handle is held.
    if (!zone) { clampToZone(obj); return; }

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
    // Live scaling gets the LENIENT clamp only, for the same reason dragging
    // does: enforcing the outline while the handle is held snaps the object
    // back on every frame and the merchant can no longer resize it. The
    // outline is enforced once on object:modified, when the handle is let go.
    clampToZone(obj);
  }, [zoneOf, permissions, clampToZone, isFreeMove]);

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
  settleRef.current         = settleIntoZone;
  snapToGridRef.current     = snapToGrid;
  applyZoneClipRef.current  = applyZoneClip;

  // The template's minimum font size (authored in mm) enforced on the CANVAS
  // handles, exactly as the customer designer enforces it
  // (DesignerCanvas.jsx#applyPermissions — same textMinScaleLimit helper, same
  // widthMm the ruler uses). Corner handles change scaleY, not fontSize, so
  // the rendered size is fontSize * scaleY: flooring only the size input in
  // TreePanel would leave the handles as an open door under the minimum, which
  // is precisely the hole the merchant had and the customer did not.
  //
  // Deliberately NOT gated on isFreeMove: Free Move suspends ZONE enforcement
  // (positioning), and legibility in millimetres has nothing to do with zones.
  // The customer has no such escape hatch, and the requirement is that the
  // merchant is held to the same floor.
  //
  // Only ever sets minScaleLimit, which constrains interactive scaling and
  // never resizes anything — opening a template that already contains
  // sub-minimum text must not silently rewrite it.
  const applyTextFontFloor = useCallback((obj) => {
    if (!obj) return;
    const perms = permissions.text || {};
    const limit = textMinScaleLimit({
      minFontSizeMm: perms.min_font_size_mm,
      canvasWidth,
      widthMm,
      fontSize: obj.fontSize,
      minScale: perms.min_scale,
    });
    if (limit != null) obj.set({ minScaleLimit: limit });
  }, [permissions, canvasWidth, widthMm]);

  const applyPermissions = useCallback((obj, elementType) => {
    // Before the Free Move bail-out on purpose — see applyTextFontFloor.
    applyTextFontFloor(obj);
    if (isFreeMove) return;
    const perms = permissions[elementType] || {};
    if (perms.resize === false) obj.set({ hasControls: false });
    if (perms.rotate === false && obj.controls?.mtr) obj.controls.mtr.visible = false;
    if (perms.min_scale != null) obj.set({ minScaleLimit: perms.min_scale });
    // min_scale must not undercut the font floor, so re-assert it last.
    applyTextFontFloor(obj);
  }, [permissions, isFreeMove, applyTextFontFloor]);

  // ── Fabric initialisation ─────────────────────────────────────────────────

  useEffect(() => {
    if (!canvasEl.current) return;

    const width  = currentView?.canvas_width  || 800;
    const height = currentView?.canvas_height || 600;
    // Same values as canvasWidth/canvasHeight above, re-read here because this
    // effect deliberately runs only on a view change and must not close over
    // a size that changed since. The live-resize effect below keeps the
    // already-created canvas in step with later changes.

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
    const onModified = (e) => {
      if (disposed) return;
      // The gesture is over: NOW enforce the zone's real outline, once. This
      // must run before the snapshot so history records the settled position,
      // and this handler is registered first so it also runs before the
      // layer-persist handler further down reads left/top off the object.
      if (!e?.target?.data?.isZone) settleRef.current?.(e?.target);
      pushHistory(viewKey, canvas.toObject(['data']));
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
          pushHistory(viewKey, canvas.toObject(['data']));
        })
        .catch((err) => {
          if (disposed) return;
          console.warn('Background load failed:', err);
          // Background load failure is non-fatal; seed history without background.
          pushHistory(viewKey, canvas.toObject(['data']));
        });
    } else {
      canvas.renderAll();
      pushHistory(viewKey, canvas.toObject(['data']));
    }

    // Empty text layers stay visible as a dashed, clickable placeholder; a
    // click on one selects the layer so the merchant can type into the tree
    // panel's Text field. No enterEditing here — on-canvas text edits are not
    // written back to the store in the builder, so the tree field is the only
    // place text actually persists.
    const disposePlaceholders = installTextPlaceholders(canvas, Rect, { enterEditing: false });

    // Intentionally omit currentView/pushHistory from deps: we only want to
    // re-initialise the Fabric canvas when the active view index changes, not on
    // every Zustand state update. currentView and pushHistory are read inside
    // the effect via closure and are stable enough for this purpose.
    return () => {
      disposed = true;
      canvas.__sgpdDisposed = true;
      disposePlaceholders();
      canvas.dispose();
      fabricRef.current = null;
    };
  }, [currentViewIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Live canvas resize ───────────────────────────────────────────────────
  // The Fabric canvas is created once per VIEW (effect above, deps
  // [currentViewIndex]). The view's canvas_width/canvas_height are DATA, not a
  // settings field, and an import rewrites them for the view that is already
  // open — ImportLightBurn sizes the view to the design it just parsed. The
  // init effect never re-runs for that, so the <canvas> ELEMENT kept the size
  // it was created with. MmRuler derives mm-per-pixel by MEASURING that
  // element, so every millimetre reading was wrong by the stale/true ratio
  // until the merchant switched views or reloaded — an 800×600 element holding
  // a 600×290 design reported a 400 mm design as 300 mm.
  //
  // Resize the existing canvas rather than widening the init effect's
  // dependency array: re-creating the Fabric canvas would throw away the
  // objects, the undo history and the selection.
  //
  // No pushHistory here, deliberately. setDimensions() fires no object events,
  // so it cannot pollute the undo stack through the loadFromJSON/isRestoring
  // path; and the resize belongs to the import's own snapshot, not to a
  // separate undo step the merchant would have to step past.
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || canvas.__sgpdDisposed) return;
    if (canvas.getWidth() === canvasWidth && canvas.getHeight() === canvasHeight) return;

    canvas.setDimensions({ width: canvasWidth, height: canvasHeight });

    // A background that was auto-fitted to the OLD width (init effect:
    // scaleToWidth) no longer covers the canvas. One the merchant positioned
    // by hand (background_transform) is left exactly where they put it, and
    // mid-background-edit there is no backgroundImage at all — the image is a
    // regular selectable object then, so this is a no-op.
    const view = useTemplateStore.getState().views[currentViewIndex];
    if (canvas.backgroundImage && !view?.background_transform?.scaleX) {
      canvas.backgroundImage.scaleToWidth(canvasWidth);
    }

    canvas.requestRenderAll();
  }, [canvasWidth, canvasHeight, currentViewIndex]);

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
      visible:        zone.visible !== false,
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

      if (zone.boundary_type === 'svg' && (zone.svg_url || zone.svg_markup)) {
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
          (zone.svg_url
            ? fetch(zone.svg_url).then((r) => r.text())
            : Promise.resolve(zone.svg_markup))
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
                if (layerObj.data?.zoneIndex === index && layerObj.data?.layerKey && zoneClips(zone)) {
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

    // Deliberately the LENIENT clamp, not the outline settle: this runs on the
    // layer-sync effect, i.e. on any store update (typing in the text field,
    // nudging a font size). Relocating the merchant's layer to satisfy the
    // contour there would move things they never dragged. The outline is
    // enforced on their gestures — drop, scale release, leaving Free Move.
    const applyClipAndClamp = (obj, layer) => {
      const zi = layer._zoneIndex;
      if (zi != null && zi >= 0) {
        applyZoneClip(obj, zi);
        clampToZone(obj);
      }
    };

    // Compatibility anchor for text layers. New layers set originX/originY
    // explicitly ('center') and left/top IS that anchor point — used as-is.
    // Layers saved before this change have neither: they were authored as a
    // wide Textbox + textAlign, where `left` meant the BOX's left edge, not
    // where the glyphs sit. An auto-width IText anchored raw at that `left`
    // would shift text that was centered/right-aligned in its old box (this
    // is the "compatibility trap" — mirrors the same calc in the customer
    // designer's DesignerCanvas.jsx so old templates render identically).
    const textAnchor = (layer) => resolveTextAnchor(layer, zones[layer._zoneIndex]);

    layers.forEach((layer) => {
      const existing = existingByKey[layer._key];
      handledKeys.add(layer._key);

      if (layer.type === 'text') {
        // An EMPTY text layer stays on the canvas. It used to be removed here,
        // so clearing the Text field to retype made the whole layer vanish and
        // a layer authored empty could never be filled in. The object keeps
        // every property it had — font, size, colour, anchor, layerKey — and
        // shared/js/textPlaceholder.js hangs a dashed, clickable box on it so
        // there is something to aim at while it has no glyphs of its own.
        const fontFamily = layer.fontFamily || 'Arial';

        const anchor = textAnchor(layer);

        if (existing) {
          existing.set({
            text:       layer.text || '',
            left:       anchor.left,
            top:        anchor.top,
            originX:    anchor.originX,
            originY:    anchor.originY,
            fontSize:   layer.fontSize   || 24,
            fontFamily,
            fill:       layer.fill       || '#000000',
            textAlign:  layer.textAlign  || 'left',
            scaleX:     1,
            scaleY:     1,
            visible:    layer.visible !== false,
            opacity:    layer.opacity ?? 1,
            selectable: !layer.locked,
            evented:    !layer.locked,
          });
          existing.initDimensions();
          existing.setCoords();
          existing.data = { ...existing.data, layerIndex: layer._layerIndex, zoneIndex: layer._zoneIndex };
          applyClipAndClamp(existing, layer);
          // fontFamily/fontSize may reference a face that hasn't finished
          // loading yet (e.g. right after picking a new font in the
          // sidebar) — re-measure once it's confirmed loaded so the
          // selection box matches the glyphs, not a fallback face.
          ensureFontMeasured(existing, fabricCache);
        } else {
          const text = new IText(layer.text || '', {
            left:       anchor.left,
            top:        anchor.top,
            originX:    anchor.originX,
            originY:    anchor.originY,
            fontSize:   layer.fontSize   || 24,
            fontFamily,
            fill:       layer.fill       || '#000000',
            textAlign:  layer.textAlign  || 'left',
            opacity:    layer.opacity    ?? 1,
            visible:    layer.visible !== false,
            selectable: !layer.locked,
            evented:    !layer.locked,
            data:       layerData(layer),
          });
          canvas.add(text);
          applyPermissions(text, layer.type);
          applyClipAndClamp(text, layer);
          ensureFontMeasured(text, fabricCache);
        }
      } else if (layer.type === 'image') {
        if (existing) {
          existing.set({
            left:       layer.left   ?? 100,
            top:        layer.top    ?? 100,
            scaleX:     layer.scaleX || 1,
            scaleY:     layer.scaleY || 1,
            angle:      layer.angle  || 0,
            visible:    layer.visible !== false,
            opacity:    layer.opacity ?? 1,
            originX:    layer.originX || 'left',
            originY:    layer.originY || 'top',
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
                left:       layer.left   ?? 100,
                top:        layer.top    ?? 100,
                scaleX:     layer.scaleX || 1,
                scaleY:     layer.scaleY || 1,
                angle:      layer.angle  || 0,
                visible:    layer.visible !== false,
                opacity:    layer.opacity ?? 1,
                originX:    layer.originX || 'left',
                originY:    layer.originY || 'top',
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
            left:       layer.left   ?? 100,
            top:        layer.top    ?? 100,
            scaleX:     layer.scaleX || 1,
            scaleY:     layer.scaleY || 1,
            angle:      layer.angle  || 0,
            visible:    layer.visible !== false,
            opacity:    layer.opacity ?? 1,
            originX:    layer.originX || 'left',
            originY:    layer.originY || 'top',
            selectable: !layer.locked,
            evented:    !layer.locked,
          });
          existing.data = { ...existing.data, layerIndex: layer._layerIndex, zoneIndex: layer._zoneIndex };
          existing.setCoords();
          applyClipAndClamp(existing, layer);
        } else if (layer.svg_markup && !layer.src && !pendingLoads.current.has(layer._key)) {
          pendingLoads.current.add(layer._key);
          loadSVGFromString(layer.svg_markup)
            .then(({ objects, options }) => {
              pendingLoads.current.delete(layer._key);
              if (!fabricRef.current) return;
              const filtered = objects.filter(Boolean);
              filtered.forEach((o) => o.set({ strokeUniform: true }));
              const group = util.groupSVGElements(filtered, options);
              group.set({
                left:           layer.left   ?? 100,
                top:            layer.top    ?? 100,
                scaleX:         layer.scaleX || 1,
                scaleY:         layer.scaleY || 1,
                angle:          layer.angle  || 0,
                visible:        layer.visible !== false,
                opacity:        layer.opacity ?? 1,
                originX:        layer.originX || 'left',
                originY:        layer.originY || 'top',
                selectable:     !layer.locked,
                evented:        !layer.locked,
                strokeUniform:  true,
                subTargetCheck: false,
                interactive:    false,
                data:           layerData(layer),
              });
              canvas.add(group);
              group.setCoords();
              applyPermissions(group, layer.type);
              applyClipAndClamp(group, layer);
              canvas.renderAll();
            })
            .catch((err) => {
              pendingLoads.current.delete(layer._key);
              console.warn('[PF] inline SVG layer load failed:', err);
            });
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
                left:          layer.left   ?? 100,
                top:           layer.top    ?? 100,
                scaleX:        layer.scaleX || 1,
                scaleY:        layer.scaleY || 1,
                angle:         layer.angle  || 0,
                visible:       layer.visible !== false,
                opacity:       layer.opacity ?? 1,
                originX:       layer.originX || 'left',
                originY:       layer.originY || 'top',
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

    // Existing objects are mutated in place above, which fires no fabric
    // event, so the placeholder bridge would not hear about a text layer that
    // just became empty (or just stopped being empty). Sync explicitly.
    syncTextPlaceholders(canvas, Rect);

    canvas.renderAll();
  }, [layers]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-apply the minimum-font-size floor ────────────────────────────────
  // The floor is a ratio against each object's own fontSize, so it goes stale
  // the moment any of its three inputs move: the template's permissions (the
  // merchant edits min_font_size_mm in the Permissions panel), the view's
  // physical width in mm, the canvas width, or a layer's own font size
  // (changed from the tree panel, which updates the existing fabric object
  // without going back through applyPermissions).
  //
  // Declared AFTER the layer-sync effect so it runs after that effect has
  // created/updated this render's objects. Interactivity only — it never
  // touches geometry, so a template that already contains sub-minimum text
  // opens unchanged and is only held to the floor when the merchant next
  // drags a handle.
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.getObjects().forEach((obj) => {
      if (obj.data?.isZone || obj.data?.isZoneOverlay) return;
      applyTextFontFloor(obj);
    });
  }, [layers, applyTextFontFloor]);


  // ── Re-measure text objects after fonts load (secondary safety net) ─────
  // Custom fonts may load asynchronously. When loaded, Fabric's static char
  // width cache contains stale measurements from fallback fonts, causing
  // bounding box mismatches. Clear the cache and re-init dimensions.
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
  // setup) so it stays correct even if the canvas is recreated later.
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
        // Persist the origin the object is actually anchored at. Without this,
        // a legacy layer (no stored originX) keeps re-deriving its anchor from
        // textAlign on every layer-sync pass, and since `left` above is already
        // the compensated anchor, re-deriving a SECOND time double-applies the
        // compensation — the text jumps by half/all of the box width on the
        // very next re-render. Writing originX/originY here converts the layer
        // to the explicit convention permanently, so textAnchor() short-circuits
        // the compensation from now on and `left`/`top` stay unambiguous.
        // Built through buildTextAnchorPatch() so this stays in lockstep with
        // handleAlign()'s write-back — see shared/js/textAnchor.js.
        const anchorPatch = buildTextAnchorPatch(obj);
        patch.originX = anchorPatch.originX;
        patch.originY = anchorPatch.originY;
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
    pushHistory(viewKey, canvas.toObject(['data']));
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
    pushHistory(viewKey, canvas.toObject(['data']));
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
      title: __( 'Select Background Image', 'snelgraveren-product-designer' ),
      button: { text: __( 'Set Background', 'snelgraveren-product-designer' ) },
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
            pushHistory(viewKey, canvas.toObject(['data']));
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
      pushHistory(viewKey, canvas.toObject(['data']));
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
        pushHistory(viewKey, canvas.toObject(['data']));
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
      bounds = zone || { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
    }

    alignElement(obj, dir, bounds);

    // Persist position to Zustand store so the layer-sync effect doesn't reset it.
    if (obj.data?.zoneIndex != null && obj.data?.layerIndex != null) {
      // Text layers must also persist originX/originY here, exactly as the
      // object:modified handler does (built through the same
      // buildTextAnchorPatch() helper — see shared/js/textAnchor.js).
      // Without it, a legacy layer (no stored originX) gets its anchor-left
      // written raw by the align click, and the next layer-sync re-derives
      // the textAlign compensation on top of it: the identical half-box
      // jump the drag path was fixed for (ccb341f), reached through the
      // align toolbar instead of a drag.
      const patch = obj.data?.layerType === 'text'
        ? buildTextAnchorPatch(obj)
        : { left: Math.round(obj.left), top: Math.round(obj.top) };
      updateLayer(currentViewIndex, obj.data.zoneIndex, obj.data.layerIndex, patch);
    }

    // Re-select so the object stays active for further alignment clicks.
    canvas.setActiveObject(obj);
    canvas.renderAll();
    setHasSelection(true);
    pushHistory(viewKey, canvas.toObject(['data']));
  }, [views, currentViewIndex, canvasWidth, canvasHeight, updateLayer, pushHistory, viewKey]);

  const isPremium = window.sgpdTemplateBuilder?.isPremium;

  const handleUseAsBoundary = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObjects() || [];
    const views = useTemplateStore.getState().views;   // read fresh (avoid stale closure)
    const view = views[currentViewIndex];

    const items = [];
    let ignored = 0;
    active.forEach((obj) => {
      const d = obj.data || {};
      const layer = view?.zones_config?.[d.zoneIndex]?.layers?.[d.layerIndex];
      if (d.elementType === 'svg' && layer && layer.svg_markup) {
        const b = obj.getBoundingRect();
        items.push({
          svgMarkup: layer.svg_markup,
          left: b.left,
          top: b.top,
          width: b.width,
          height: b.height,
          scaleX: obj.width ? b.width / obj.width : 1,
          scaleY: obj.height ? b.height / obj.height : 1,
        });
      } else {
        ignored += 1;
      }
    });

    const merged = items.length ? mergeLayersToBoundary(items) : null;
    if (!merged) {
      window.alert(__( 'Select at least one vector layer to use as a boundary.', 'snelgraveren-product-designer' ));
      return;
    }

    addZone(currentViewIndex, {
      name: __( 'Boundary', 'snelgraveren-product-designer' ),
      type: 'safe_area',
      behavior: 'restrict',
      boundary_type: 'svg',
      svg_markup: merged.svg_markup,
      svg_intrinsic_width: merged.width,
      svg_intrinsic_height: merged.height,
      x: merged.x,
      y: merged.y,
      width: merged.width,
      height: merged.height,
      svg_scale: 1,
      allowed_types: ['text', 'image', 'svg'],
    });

    if (ignored > 0) {
      window.alert(
        sprintf( __( 'Boundary created. Ignored non-vector layers: %d', 'snelgraveren-product-designer' ), ignored )
      );
    }
  }, [currentViewIndex, addZone]);

  return (
    <div className="pf-canvas-wrap">
      <div className="pf-canvas-toolbar">
        <button
          className={`pf-canvas-toolbar__btn${isFreeMove ? ' pf-canvas-toolbar__btn--active' : ''}`}
          onClick={isFreeMove ? disableFreeMove : enableFreeMove}
          title={ isFreeMove ? __( 'Enable zone enforcement', 'snelgraveren-product-designer' ) : __( 'Disable zone enforcement for free positioning', 'snelgraveren-product-designer' ) }
        >
          { isFreeMove ? __( 'Enforce Zones', 'snelgraveren-product-designer' ) : __( 'Free Move', 'snelgraveren-product-designer' ) }
        </button>
        {isPremium && hasSelection && (
          <button
            className="pf-canvas-toolbar__btn"
            onClick={handleUseAsBoundary}
            title={ __( 'Turn the selected vector layer(s) into a boundary', 'snelgraveren-product-designer' ) }
          >
            { __( 'Use as Boundary', 'snelgraveren-product-designer' ) }
          </button>
        )}
        <button
          className="pf-canvas-toolbar__btn"
          onClick={openMediaPicker}
          title={ __( 'Set background image', 'snelgraveren-product-designer' ) }
        >
          { currentView?.background_url ? __( 'Change Background', 'snelgraveren-product-designer' ) : __( 'Set Background', 'snelgraveren-product-designer' ) }
        </button>
        {currentView?.background_url && !editingBg && (
          <button
            className="pf-canvas-toolbar__btn"
            onClick={enterBgEdit}
            title={ __( 'Resize and reposition the background image', 'snelgraveren-product-designer' ) }
          >
            { __( 'Resize BG', 'snelgraveren-product-designer' ) }
          </button>
        )}
        {editingBg && (
          <button
            className="pf-canvas-toolbar__btn pf-canvas-toolbar__btn--active"
            onClick={exitBgEdit}
            title={ __( 'Apply background position', 'snelgraveren-product-designer' ) }
          >
            { __( 'Done', 'snelgraveren-product-designer' ) }
          </button>
        )}
        {currentView?.background_url && (
          <button
            className="pf-canvas-toolbar__btn"
            onClick={removeBackground}
            title={ __( 'Remove background image', 'snelgraveren-product-designer' ) }
          >
            { __( 'Remove BG', 'snelgraveren-product-designer' ) }
          </button>
        )}
        <button
          className="pf-canvas-toolbar__btn"
          onClick={applyUndo}
          disabled={!canUndo(viewKey)}
          title={ __( 'Undo (Ctrl+Z)', 'snelgraveren-product-designer' ) }
        >
          { __( '↩ Undo', 'snelgraveren-product-designer' ) }
        </button>
        <button
          className="pf-canvas-toolbar__btn"
          onClick={applyRedo}
          disabled={!canRedo(viewKey)}
          title={ __( 'Redo (Ctrl+Shift+Z)', 'snelgraveren-product-designer' ) }
        >
          { __( '↪ Redo', 'snelgraveren-product-designer' ) }
        </button>
        {!editingBg && (
          <AlignToolbar hasSelection={hasSelection} handleAlign={handleAlign} />
        )}
      </div>
      <div className={`pf-canvas-grid${widthMm > 0 ? ' pf-canvas-grid--ruler' : ''}`}>
        {widthMm > 0 && (
          <MmRuler
            key={currentViewIndex}
            canvasRef={canvasEl}
            widthMm={widthMm}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
          />
        )}
        <div className="pf-canvas-cell">
          <div className="pf-canvas-scroll">
            <canvas ref={canvasEl} />
          </div>
        </div>
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
    ['left', '⬅', __('Align left', 'snelgraveren-product-designer')],
    ['center', '↔', __('Align center', 'snelgraveren-product-designer')],
    ['right', '➡', __('Align right', 'snelgraveren-product-designer')],
    ['top', '⬆', __('Align top', 'snelgraveren-product-designer')],
    ['middle', '↕', __('Align middle', 'snelgraveren-product-designer')],
    ['bottom', '⬇', __('Align bottom', 'snelgraveren-product-designer')],
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
