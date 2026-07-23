import React, { useEffect, useRef, useState, useCallback } from 'react';
import { __ } from '@wordpress/i18n';
import { Canvas as FabricCanvas, cache as fabricCache } from 'fabric';
import useDesignerStore from './store/useDesignerStore';
import { loadTemplate, loadDesign, createDesign, saveDesignView, fetchCustomFonts, fetchClipartCollections, previewPrice } from './api/designerApi';
import DesignerCanvas from './components/DesignerCanvas';
import Sidebar from './components/Sidebar';
import Toolbar from './components/Toolbar';
import { loadGoogleFonts, loadCustomFonts } from './utils/fonts';
import { getDesignerConfig } from './utils/config';
import { outlineSvgText, embedFontsInSvg } from './utils/textOutline';
import { countPriceableElements } from './utils/priceCounts';
import useIsMobile from './hooks/useIsMobile';

/**
 * Ensure every text object's font is loaded and re-measured before an offscreen
 * canvas is serialized. Without this, Fabric lays out (especially centered) text
 * using a fallback-font width — so the text ends up off-centre / mis-positioned
 * in the PNG and SVG exports even though the design looks right in the live
 * editor (where the font is already loaded).
 */
async function ensureFontsAndRemeasure(canvas) {
  const texts = canvas.getObjects().filter((o) => /text/i.test(o.type || ''));
  await Promise.all(texts.map((o) => {
    const fam  = o.fontFamily || 'sans-serif';
    const size = o.fontSize || 16;
    try { return document.fonts.load(`${size}px "${fam}"`).catch(() => {}); }
    catch (_) { return Promise.resolve(); }
  }));
  // Drop Fabric's global char-width cache: if a font finished loading only
  // AFTER the design first rendered (e.g. Google fonts fetched async via the
  // proxy), the cache holds fallback-font widths for these glyphs. initDimensions
  // would reuse them, so centred text lays out against the wrong width and drifts
  // in the export even though the glyphs themselves are outlined at the real
  // width. Clearing forces a fresh measurement with the now-loaded font.
  try { fabricCache.clearFontCache(); } catch (_) { /* ignore */ }
  texts.forEach((o) => { try { o.initDimensions(); o.setCoords(); } catch (_) { /* ignore */ } });
  canvas.renderAll();
}

/**
 * Render a thumbnail from canvas JSON using an offscreen Fabric canvas.
 * Returns a data URL (PNG) or empty string on failure.
 */
async function renderOffscreenThumbnail(canvasJson, width, height) {
  try {
    const el = document.createElement('canvas');
    el.width = width;
    el.height = height;
    const offscreen = new FabricCanvas(el, { width, height });
    await offscreen.loadFromJSON(canvasJson);
    await ensureFontsAndRemeasure(offscreen);
    offscreen.renderAll();
    const dataUrl = offscreen.toDataURL({ format: 'png', multiplier: 0.5 });
    offscreen.dispose();
    return dataUrl;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Offscreen thumbnail render failed:', err);
    }
    return '';
  }
}

/**
 * Generate high-res export PNG from canvas JSON using an offscreen Fabric canvas.
 * Returns a data URL (PNG at 3x resolution) or empty string on failure.
 * We use PNG instead of SVG because SVG text requires the exact fonts on the
 * server, whereas browser-rendered PNG captures text with loaded web fonts.
 */
async function renderOffscreenExportPng(canvasJson, width, height) {
  try {
    const el = document.createElement('canvas');
    el.width = width;
    el.height = height;
    const offscreen = new FabricCanvas(el, { width, height });
    await offscreen.loadFromJSON(canvasJson);
    await ensureFontsAndRemeasure(offscreen);
    offscreen.renderAll();
    const dataUrl = offscreen.toDataURL({ format: 'png', multiplier: 3 });
    offscreen.dispose();
    return dataUrl;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Offscreen export PNG render failed:', err);
    }
    return '';
  }
}

/**
 * Generate a real vector SVG from canvas JSON using an offscreen Fabric canvas.
 * Returns SVG markup or empty string on failure.
 *
 * Rendered offscreen at the view's NATIVE dimensions (zoom = 1), so the
 * resulting <svg> carries the correct width/height/viewBox regardless of the
 * responsive zoom applied to the live on-screen canvas. This is stored as
 * `export_vector` and used by the SVG export — vector shapes/paths stay vector.
 * Text is emitted as <text> referencing its font family, so the production
 * machine needs that font installed (or the operator outlines it).
 */
async function renderOffscreenExportSvg(canvasJson, width, height) {
  try {
    const el = document.createElement('canvas');
    el.width = width;
    el.height = height;
    const offscreen = new FabricCanvas(el, { width, height });
    await offscreen.loadFromJSON(canvasJson);
    await ensureFontsAndRemeasure(offscreen);
    offscreen.renderAll();
    const svg = offscreen.toSVG();
    offscreen.dispose();
    return svg;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Offscreen export SVG render failed:', err);
    }
    return '';
  }
}

/**
 * Build the two production SVG variants from a view's canvas JSON:
 *   outline — text converted to vector <path> (default export; font-independent)
 *   embed   — text kept editable with the fonts embedded as base64 @font-face
 * Both fall back to the raw SVG if outlining/embedding fails, so a save never
 * breaks on a font that can't be resolved.
 */
async function buildExportVectors(canvasJson, width, height, opts) {
  const raw = await renderOffscreenExportSvg(canvasJson, width, height);
  if (!raw) return { outline: '', embed: '' };
  const [outline, embed] = await Promise.all([
    outlineSvgText(raw, opts).catch(() => raw),
    embedFontsInSvg(raw, opts).catch(() => raw),
  ]);
  return { outline: outline || raw, embed: embed || raw };
}

export default function App() {
  const {
    template, loadTemplate: setTemplate,
    designHash, setDesignHash,
    isSaving, setIsSaving,
    isDirty, setIsDirty,
    canvasSnapshots,
    error, setError, clearError,
    fabricCanvasRef,
  } = useDesignerStore();

  // Read config via state so we can RETRY if the first read comes back empty.
  // Observed in production (iOS Safari + LiteSpeed Delay JS, also Mac Safari/
  // Chrome in private mode): bundle runs, #pf-designer-root with correct
  // data-config is in the DOM, yet the first read of root.dataset.config
  // returns empty at mount. A few ms later it parses fine. Retry loop below
  // covers that window without requiring user interaction.
  const [config, setConfig] = useState(() => getDesignerConfig());
  useEffect(() => {
    if (config.template_id) return;
    let attempts = 0;
    let timer;
    const tick = () => {
      attempts += 1;
      const fresh = getDesignerConfig();
      if (fresh.template_id) {
        // Recovered — clear any timeout error a previous slow tick surfaced.
        clearError();
        setLoading(true);
        setConfig(fresh);
        return;
      }
      if (attempts === 40) {
        // ~2 s of fast polling produced nothing. PHP only enqueues this
        // bundle when a template IS configured, so a missing config is a
        // delivery problem, not a store-configuration problem — show an
        // accurate message and KEEP polling (slowly) so a late config still
        // recovers without a manual reload.
        setError(__('The designer could not load. Please reload the page.', 'snelgraveren-product-designer'));
        setLoading(false);
      }
      timer = setTimeout(tick, attempts < 40 ? 50 : 1000);
    };
    timer = setTimeout(tick, 50);
    return () => clearTimeout(timer);
  }, [config.template_id, setError, clearError]);

  const isMobile = useIsMobile();
  const effectiveDisplayMode = isMobile ? 'modal' : (config.display_mode || 'embedded');

  const [loading, setLoading] = useState(true);
  // These initializers only see a real config when it was readable at mount;
  // the sync effect below re-derives them when the retry loop fills config in
  // later. Until then a modal-mode product must NOT default to open (an empty
  // config makes effectiveDisplayMode fall back to 'embedded', which would
  // pop the modal open uninvited once the real display_mode arrives).
  const [designerOpen, setDesignerOpen] = useState(() => !!config.template_id
    && (effectiveDisplayMode !== 'modal' || !!config.auto_open || !!config.existing_design_hash));
  const [savedRecently, setSavedRecently] = useState(false);
  const [designSaved, setDesignSaved] = useState(!!config.existing_design_hash);

  // Re-derive mount-time state when config arrives late via the retry loop.
  // Runs once when template_id transitions empty → set; on a normal load
  // (config present at mount) it recomputes the same values, which is a no-op.
  useEffect(() => {
    if (!config.template_id) return;
    setDesignerOpen(effectiveDisplayMode !== 'modal' || !!config.auto_open || !!config.existing_design_hash);
    setDesignSaved(!!config.existing_design_hash);
  }, [config.template_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const modalRef = useRef(null);
  const returnFocusRef = useRef(null);
  const savingForCartRef = useRef(false);
  // Custom fonts (family + file URLs), used at save time to outline/embed text
  // in the SVG export. Kept in a ref so the save handlers read the latest set.
  const customFontsRef = useRef([]);

  const [pricePreview, setPricePreview] = useState(null); // {surcharge, currency_symbol}

  // Live price preview: recompute whenever snapshots change (snapshotView
  // fires on every object add/modify/remove). Debounced; failures are
  // silent — the authoritative price is always computed server-side in
  // the cart.
  useEffect(() => {
    if (!config.template_id || !template) return;
    const counts = countPriceableElements(canvasSnapshots);
    if (counts.text + counts.image + counts.svg === 0) {
      setPricePreview(null);
      return;
    }
    const timer = setTimeout(() => {
      previewPrice(config.template_id, counts)
        .then(setPricePreview)
        .catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [canvasSnapshots, config.template_id, template]);

  // Load template on mount, then load existing design if hash is present.
  // Depend on config.template_id (not []) so that if the first render sees an
  // empty config (e.g. helper couldn't parse dataset.config yet on iOS Safari
  // + LiteSpeed's delayed script loading), the next render — when config
  // succeeds — re-runs this effect with the real template_id.
  useEffect(() => {
    if (!config.template_id) {
      // Config not ready yet — bundle is loaded but helper couldn't parse
      // dataset.config on this call. Don't set an error; just wait for the
      // next render. If the config genuinely never arrives (unlikely — PHP
      // would not have enqueued the script), the loading state persists.
      return;
    }

    loadTemplate(config.template_id)
      .then(async (data) => {
        // Load custom fonts BEFORE Google Fonts (so custom families are excluded from Google loading)
        const allowedFonts = data.global_config?.allowed_fonts || [];
        fetchCustomFonts()
          .then((customFonts) => {
            customFontsRef.current = customFonts || [];
            loadCustomFonts(customFonts);
            loadGoogleFonts(allowedFonts, config.rest_url);
          })
          .catch(() => {
            // If custom fonts fail, still load Google Fonts
            loadGoogleFonts(allowedFonts, config.rest_url);
          });

        // If returning from cart with an existing design, load it BEFORE
        // setting the template so that canvas snapshots are available when
        // DesignerCanvas initialises.
        if (config.existing_design_hash) {
          try {
            const design = await loadDesign(config.existing_design_hash);
            setDesignHash(design.design_hash);

            // Populate canvas snapshots from saved views
            const views = data.views || [];
            if (design.views) {
              for (const dv of design.views) {
                const viewIndex = views.findIndex((v) => String(v.id) === String(dv.view_id));
                if (viewIndex !== -1 && dv.canvas_json) {
                  useDesignerStore.getState().snapshotView(viewIndex, dv.canvas_json);
                }
              }
            }
            // Mark as not dirty since we just loaded
            setIsDirty(false);
          } catch (_) {
            // Design load failed — continue with blank template
          }
        }

        // Set template last — this triggers DesignerCanvas to initialise,
        // and by now any saved design snapshots are already in the store.
        setTemplate(data);

        // Load clip art collections if enabled
        if (data.global_config?.clipart_enabled) {
          fetchClipartCollections().then((collections) => {
            const allowed = (data.global_config.allowed_clipart_collections || []).map(Number);
            const filtered = allowed.length > 0
              ? collections.filter((c) => allowed.includes(Number(c.id)))
              : collections;
            useDesignerStore.getState().setClipartCollections(filtered);
          }).catch(() => {});
        }

        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [config.template_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Modal open/close. Depends on the config/display mode (not []): when the
  // retry loop delivers config after mount, this must re-run — otherwise the
  // .pf-open-designer listener is never attached (dead Customize button) and
  // the return-from-cart auto-open never fires.
  useEffect(() => {
    if (effectiveDisplayMode !== 'modal') return;

    // Auto-open when returning from cart with an existing design
    if (config.existing_design_hash) {
      setDesignerOpen(true);
    }

    const btn = document.querySelector('.pf-open-designer');
    if (!btn) return;

    const handler = () => setDesignerOpen(true);
    btn.addEventListener('click', handler);
    return () => btn.removeEventListener('click', handler);
  }, [effectiveDisplayMode, config.template_id, config.existing_design_hash]);

  // Modal focus trapping and keyboard handling
  useEffect(() => {
    if (effectiveDisplayMode !== 'modal') return;

    if (designerOpen) {
      // Save the element that opened the modal so we can restore focus on close
      returnFocusRef.current = document.activeElement;

      // Focus the first interactive element inside the modal
      const focusable = modalRef.current?.querySelectorAll(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable && focusable.length > 0) {
        focusable[0].focus();
      }

      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          setDesignerOpen(false);
          return;
        }

        if (e.key === 'Tab' && modalRef.current) {
          const focusableEls = Array.from(
            modalRef.current.querySelectorAll(
              'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
            )
          );
          if (focusableEls.length === 0) return;

          const first = focusableEls[0];
          const last = focusableEls[focusableEls.length - 1];

          if (e.shiftKey) {
            if (document.activeElement === first) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    } else {
      // Restore focus when modal closes
      if (returnFocusRef.current) {
        returnFocusRef.current.focus();
        returnFocusRef.current = null;
      }
    }
  }, [designerOpen]);

  // Reset designer after successful add-to-cart so the next customization creates a new design.
  // WooCommerce triggers 'added_to_cart' (AJAX) or does a full page reload (non-AJAX).
  useEffect(() => {
    const handleAddedToCart = () => {
      const store = useDesignerStore.getState();
      const canvas = store.fabricCanvasRef;
      if (canvas) {
        // Remove user-added elements
        const userObjects = canvas.getObjects().filter((o) => !o.data?.isZone && !o.data?.isZoneOverlay && !o.data?.isBackground);
        userObjects.forEach((o) => canvas.remove(o));
        canvas.discardActiveObject();

        // Reset zone overlay fill colors to admin defaults
        const views = store.template?.views || [];
        const currentView = views[store.currentViewIndex];
        const zones = currentView?.zones_config || [];
        canvas.getObjects().forEach((obj) => {
          if (obj.data?.isZoneOverlay) {
            const zone = zones[obj.data.zoneIndex];
            const defaultColor = zone?.svg_fill_color || 'rgba(0, 0, 0, 0.03)';
            if (obj.getObjects) {
              obj.getObjects().forEach((c) => c.set({ fill: defaultColor }));
            }
            obj.set({ fill: defaultColor });
            obj.dirty = true;
          }
        });

        canvas.renderAll();
      }

      // Remove the hidden input so a fresh design can be created
      const input = document.querySelector('input[name="pf_design_hash"]');
      if (input) input.remove();

      // Reset store state
      useDesignerStore.getState().resetDesign();
      setDesignSaved(false);
      setSavedRecently(false);
    };

    // jQuery event fired by WooCommerce AJAX add-to-cart
    if (window.jQuery) {
      window.jQuery(document.body).on('added_to_cart.productforge', handleAddedToCart);
      return () => window.jQuery(document.body).off('added_to_cart.productforge', handleAddedToCart);
    }
  }, []);

  // Dispatch viewport events for mobile zoom lock (PHP inline script listens)
  useEffect(() => {
    if (designerOpen) {
      document.dispatchEvent(new Event('pf:designer-open'));
    } else {
      document.dispatchEvent(new Event('pf:designer-close'));
    }
  }, [designerOpen]);

  // Sync design hash to hidden input
  useEffect(() => {
    if (!designHash) return;
    let input = document.querySelector('input[name="pf_design_hash"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'pf_design_hash';
      const form = document.querySelector('form.cart');
      if (form) form.appendChild(input);
    }
    input.value = designHash;
  }, [designHash]);

  // Determine if customization is required from template config
  const customizationRequired = template?.global_config?.customization_required === true
    || template?.global_config?.customization_required === 'true';

  // Manage add-to-cart button state when customization is required
  useEffect(() => {
    if (!template) return;

    const btn = document.querySelector('.single_add_to_cart_button');
    if (!btn) return;

    if (customizationRequired && !designSaved) {
      btn.classList.add('pf-design-required');
      btn.setAttribute('data-pf-original-text', btn.textContent);
      // Don't disable — just add a class and intercept via the submit handler
    } else {
      btn.classList.remove('pf-design-required');
    }

    return () => {
      btn.classList.remove('pf-design-required');
    };
  }, [template, customizationRequired, designSaved]);

  // Hide the native WooCommerce add-to-cart button: the designer's
  // "Save & add to cart" button is now the single add-to-cart action, so a
  // second native button would be redundant and confusing. The form itself
  // stays in the DOM (we submit it programmatically). Scoped by a body class
  // so it only hides where the designer is actually present.
  useEffect(() => {
    if (!template) return;
    document.body.classList.add('pf-designer-present');
    return () => document.body.classList.remove('pf-designer-present');
  }, [template]);

  // Intercept cart form submit: auto-save design before adding to cart
  useEffect(() => {
    const form = document.querySelector('form.cart');
    if (!form) return;

    const handleSubmit = async (e) => {
      const store = useDesignerStore.getState();

      // If customization is required but no design was saved, block submission
      if (customizationRequired && !store.designHash && Object.keys(store.canvasSnapshots).length === 0) {
        e.preventDefault();
        setError(__('Please customize your product before adding to cart.', 'snelgraveren-product-designer'));
        return;
      }

      // Ensure hidden input is present for already-saved designs
      if (store.designHash) {
        let input = form.querySelector('input[name="pf_design_hash"]');
        if (!input) {
          input = document.createElement('input');
          input.type = 'hidden';
          input.name = 'pf_design_hash';
          form.appendChild(input);
        }
        input.value = store.designHash;
      }

      // If there are unsaved changes, auto-save before submitting
      if (store.isDirty && Object.keys(store.canvasSnapshots).length > 0) {
        e.preventDefault();
        savingForCartRef.current = true;

        try {
          let hash = store.designHash;

          // Create design if first save
          if (!hash) {
            const design = await createDesign(config.template_id, config.product_id);
            hash = design.design_hash;
            setDesignHash(hash);
          }

          // Save each view that has a snapshot
          const views = store.template?.views || [];
          for (const [viewIndex, snapJson] of Object.entries(store.canvasSnapshots)) {
            const idx = parseInt(viewIndex, 10);
            const view = views[idx];
            if (!view?.id) continue;

            // Active view: use the live canvas (the snapshot can be stale/empty
            // from a load race); other views use their stored snapshot.
            let json = snapJson;
            if (idx === store.currentViewIndex && store.fabricCanvasRef) {
              try { json = store.fabricCanvasRef.toJSON(['data']); } catch (_) { json = snapJson; }
            }
            // Never overwrite a saved view with an empty (0-object) canvas.
            if (!json || !Array.isArray(json.objects) || json.objects.length === 0) continue;

            let thumbnail = '';
            let exportSvg = '';
            const w = view.canvas_width || 600;
            const h = view.canvas_height || 600;

            if (idx === store.currentViewIndex && store.fabricCanvasRef) {
              try {
                thumbnail = store.fabricCanvasRef.toDataURL({ format: 'png', multiplier: 0.5 });
              } catch (_) { /* ignore */ }
              try {
                exportSvg = store.fabricCanvasRef.toDataURL({ format: 'png', multiplier: 3 });
              } catch (_) { /* ignore */ }
            } else {
              thumbnail = await renderOffscreenThumbnail(json, w, h);
              exportSvg = await renderOffscreenExportPng(json, w, h);
            }
            // Real vector SVG (outline default + font-embedded variant), rendered
            // offscreen at native size so it is zoom-independent and correctly scaled.
            const { outline: exportVector, embed: exportVectorEmbed } =
              await buildExportVectors(json, w, h, { customFonts: customFontsRef.current, restUrl: config.rest_url });
            await saveDesignView(hash, view.id, json, thumbnail, exportSvg, exportVector, exportVectorEmbed);
          }

          // Sync hash to hidden input
          let input = document.querySelector('input[name="pf_design_hash"]');
          if (!input) {
            input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'pf_design_hash';
            form.appendChild(input);
          }
          input.value = hash;

          setIsDirty(false);
          setDesignSaved(true);

          // Re-submit the form now that design is saved
          savingForCartRef.current = false;
          form.submit();
        } catch (err) {
          savingForCartRef.current = false;
          setError(__('Failed to save design. Please try again.', 'snelgraveren-product-designer'));
        }
        return;
      }
    };

    form.addEventListener('submit', handleSubmit);
    return () => form.removeEventListener('submit', handleSubmit);
  }, [template, customizationRequired]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save handler
  // Submit the WooCommerce add-to-cart form, carrying the saved design hash.
  // The form's submit interceptor (see effect above) also ensures the hidden
  // input, but we set it here too so a direct requestSubmit always carries it.
  const submitCartForm = () => {
    const form = document.querySelector('form.cart');
    if (!form) {
      setError(__('Could not find the add-to-cart form.', 'snelgraveren-product-designer'));
      return;
    }
    const hash = useDesignerStore.getState().designHash;
    if (hash) {
      let input = form.querySelector('input[name="pf_design_hash"]');
      if (!input) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'pf_design_hash';
        form.appendChild(input);
      }
      input.value = hash;
    }
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else {
      form.submit();
    }
  };

  const handleSave = async () => {
    if (useDesignerStore.getState().isSaving) return;
    clearError();

    // Block when customization is required but nothing has been designed yet —
    // otherwise we'd create an empty design and drop it in the cart.
    {
      const s = useDesignerStore.getState();
      if (customizationRequired && !s.designHash && Object.keys(s.canvasSnapshots).length === 0) {
        setError(__('Please customize your product before adding to cart.', 'snelgraveren-product-designer'));
        return;
      }
    }

    // Nothing changed since the last save → skip straight to the cart.
    if (!useDesignerStore.getState().isDirty && useDesignerStore.getState().designHash) {
      submitCartForm();
      return;
    }

    setIsSaving(true);
    const saveStart = Date.now();

    try {
      // Read fresh from store — closure values may be stale
      let hash = useDesignerStore.getState().designHash;

      // Create design if first save
      if (!hash) {
        const design = await createDesign(config.template_id, config.product_id);
        hash = design.design_hash;
        setDesignHash(hash);
      }

      // Save each view that has a snapshot
      // Read fresh from store — closure `canvasSnapshots` may be stale
      const freshSnapshots = useDesignerStore.getState().canvasSnapshots;
      const views = template?.views || [];
      const activeViewIndex = useDesignerStore.getState().currentViewIndex;
      let savedDesign = null;
      for (const [viewIndex, snapJson] of Object.entries(freshSnapshots)) {
        const idx = parseInt(viewIndex, 10);
        const view = views[idx];
        if (!view?.id) continue;

        // Source of truth for the ACTIVE view is the live canvas — the stored
        // snapshot can be stale/empty due to a load race, and writing that would
        // wipe the design. Other views use their stored snapshot.
        let json = snapJson;
        if (idx === activeViewIndex && fabricCanvasRef) {
          try { json = fabricCanvasRef.toJSON(['data']); } catch (_) { json = snapJson; }
        }
        // Never overwrite a saved view with an empty canvas (0 objects). A real
        // design always has at least a zone overlay; 0 objects means the canvas
        // hadn't loaded yet — skip so the previously saved design is preserved.
        if (!json || !Array.isArray(json.objects) || json.objects.length === 0) continue;

        let thumbnail = '';
        let exportSvg = '';
        const w = view.canvas_width || 600;
        const h = view.canvas_height || 600;

        if (idx === activeViewIndex && fabricCanvasRef) {
          // Active view: capture directly from the live canvas
          try {
            thumbnail = fabricCanvasRef.toDataURL({ format: 'png', multiplier: 0.5 });
          } catch (_) { /* ignore */ }
          try {
            exportSvg = fabricCanvasRef.toDataURL({ format: 'png', multiplier: 3 });
          } catch (_) { /* ignore */ }
        } else {
          // Non-active view: render offscreen
          thumbnail = await renderOffscreenThumbnail(json, w, h);
          exportSvg = await renderOffscreenExportPng(json, w, h);
        }
        // Real vector SVG (outline default + font-embedded variant), rendered
        // offscreen at native size so it is zoom-independent and correctly scaled.
        const { outline: exportVector, embed: exportVectorEmbed } =
          await buildExportVectors(json, w, h, { customFonts: customFontsRef.current, restUrl: config.rest_url });
        savedDesign = await saveDesignView(hash, view.id, json, thumbnail, exportSvg, exportVector, exportVectorEmbed);
      }

      // Update the product image on the page with the design thumbnail
      if (savedDesign?.views?.[0]?.thumbnail) {
        const thumbUrl = savedDesign.views[0].thumbnail;
        const productImg = document.querySelector('.woocommerce-product-gallery img, .wp-post-image');
        if (productImg) {
          productImg.src = thumbUrl;
          productImg.srcset = '';
        }
      }

      // Ensure "Saving..." shows for at least 600ms so the user sees feedback
      const elapsed = Date.now() - saveStart;
      if (elapsed < 600) {
        await new Promise((r) => setTimeout(r, 600 - elapsed));
      }

      setIsSaving(false);
      setIsDirty(false);
      setDesignSaved(true);
      // Save succeeded → add to cart. The page then POSTs/reloads (or the
      // WooCommerce AJAX path fires 'added_to_cart', handled elsewhere).
      submitCartForm();
    } catch (err) {
      setError(err.message);
      setIsSaving(false);
    }
  };

  if (loading) {
    return <div className="pf-designer pf-designer--loading">{__('Loading designer...', 'snelgraveren-product-designer')}</div>;
  }

  if (!template) {
    return <div className="pf-designer pf-designer--error">{error || __('Template not available.', 'snelgraveren-product-designer')}</div>;
  }

  const isModal = effectiveDisplayMode === 'modal';
  const wrapperClass = [
    'pf-designer',
    `pf-designer--${effectiveDisplayMode}`,
    isModal && designerOpen ? 'pf-designer--open' : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      {isMobile && !designerOpen && (
        <button
          type="button"
          className="pf-open-designer button"
          onClick={() => setDesignerOpen(true)}
        >
          {__('Customize Product', 'snelgraveren-product-designer')}
        </button>
      )}
      <div
        ref={isModal ? modalRef : undefined}
        className={wrapperClass}
        role={isModal ? 'dialog' : undefined}
        aria-modal={isModal ? 'true' : undefined}
        aria-label={isModal ? __('Product Designer', 'snelgraveren-product-designer') : undefined}
        onClick={isModal ? (e) => { e.stopPropagation(); setDesignerOpen(false); } : undefined}
      >
        <Toolbar />
        <div className="pf-designer__layout" onClick={isModal ? (e) => e.stopPropagation() : undefined}>
          <DesignerCanvas />
          <div className="pf-designer__sidebar-wrap">
            <Sidebar />
            {error && (
              <div className="pf-designer__error" onClick={clearError}>
                {error}
              </div>
            )}
            {pricePreview && pricePreview.surcharge > 0 && (
              <div className="pf-designer__price" aria-live="polite">
                {__('Design surcharge:', 'snelgraveren-product-designer')}{' '}
                <strong>{pricePreview.currency_symbol}{pricePreview.surcharge.toFixed(2)}</strong>
              </div>
            )}
            <button
              type="button"
              className="pf-designer__save-btn"
              onClick={handleSave}
              disabled={isSaving}
            >
              <span aria-live="polite">
                {isSaving
                  ? __('Saving…', 'snelgraveren-product-designer')
                  : __('Save & add to cart', 'snelgraveren-product-designer')}
              </span>
            </button>
            {isModal && (
              <button
                type="button"
                className="pf-designer__close-btn"
                onClick={(e) => { e.stopPropagation(); setDesignerOpen(false); }}
              >
                {__('Close Designer', 'snelgraveren-product-designer')}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
