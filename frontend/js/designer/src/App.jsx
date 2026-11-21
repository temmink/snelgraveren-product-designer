import React, { useEffect, useRef, useState, useCallback } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import useDesignerStore from './store/useDesignerStore';
import { loadTemplate, loadDesign, createDesign, saveDesignView, fetchCustomFonts, fetchClipartCollections, previewPrice } from './api/designerApi';
import DesignerCanvas from './components/DesignerCanvas';
import Sidebar from './components/Sidebar';
import Toolbar from './components/Toolbar';
import { loadGoogleFonts, loadCustomFonts } from './utils/fonts';
import { getDesignerConfig } from './utils/config';
import { getExternalOpenButtons } from './utils/openDesignerButtons';
import StartBar from './components/StartBar';
import { missingProductOptions, unavailableReason } from './utils/productOptions';
import {
  collectSampleTexts, firstSampleObject, emptySamplesOnCanvas, emptySamplesInJson,
} from './utils/sampleTexts';
import { viewLabel } from './utils/viewLabel';
import {
  withoutExcludedObjects,
  renderOffscreenThumbnail,
  renderOffscreenExportPng,
} from './utils/exportRender';
import { loadProExport, buildProExportVectors } from './utils/proExport';
import { countPriceableElements } from './utils/priceCounts';
import useIsMobile from './hooks/useIsMobile';
import { withoutTextPlaceholders } from '../../../../shared/js/textPlaceholder';
import atLogicalCanvasSize from '../../../../shared/js/atLogicalCanvasSize';
import { resolveWidthMm } from '../../../../shared/js/rulerTicks';

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
  // PHP renders a "Customize Product" button next to the root in modal mode.
  // When it is there, React must not render a second one on mobile (the two
  // sat one under the other, and the PHP one was dead — see the modal effect).
  const [hasExternalOpenButton, setHasExternalOpenButton] = useState(() => getExternalOpenButtons().length > 0);

  const [loading, setLoading] = useState(true);
  // These initializers only see a real config when it was readable at mount;
  // the sync effect below re-derives them when the retry loop fills config in
  // later. Until then a modal-mode product must NOT default to open (an empty
  // config makes effectiveDisplayMode fall back to 'embedded', which would
  // pop the modal open uninvited once the real display_mode arrives).
  const [designerOpen, setDesignerOpen] = useState(() => !!config.template_id
    && (effectiveDisplayMode !== 'modal' || !!config.auto_open || (!!config.existing_design_hash && !config.resume_closed)));
  const [savedRecently, setSavedRecently] = useState(false);
  const [designSaved, setDesignSaved] = useState(!!config.existing_design_hash);
  const [missingOptions, setMissingOptions] = useState([]);
  const [unavailable, setUnavailable] = useState('');
  // Example texts still on the product when the customer pressed order.
  const [sampleTexts, setSampleTexts] = useState([]);
  // The shop refused the previous add-to-cart and the design was handed back
  // (see Frontend::get_design_hash_from_refused_add_to_cart). Say so: without
  // it the customer is back on the product page with no sign their work is
  // still there.
  const [resumedAfterRefusal, setResumedAfterRefusal] = useState(!!config.resume_closed);
  useEffect(() => { if (config.resume_closed) setResumedAfterRefusal(true); }, [config.resume_closed]);

  // Re-derive mount-time state when config arrives late via the retry loop.
  // Runs once when template_id transitions empty → set; on a normal load
  // (config present at mount) it recomputes the same values, which is a no-op.
  useEffect(() => {
    if (!config.template_id) return;
    setDesignerOpen(effectiveDisplayMode !== 'modal' || !!config.auto_open || (!!config.existing_design_hash && !config.resume_closed));
    setDesignSaved(!!config.existing_design_hash);
  }, [config.template_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arriving with a design to reopen (the link from the cart): bring the
  // designer into view. A phone opens it over the page; on a desktop it sits
  // in the page, more than a screen below the top, and the customer would
  // land on the product photo with no sign of the design they came back for.
  const broughtIntoView = useRef(false);
  useEffect(() => {
    if (broughtIntoView.current || loading || !template) return;
    if (!config.existing_design_hash || config.resume_closed) return;
    if (effectiveDisplayMode === 'modal') return;
    broughtIntoView.current = true;
    const el = document.querySelector('#pf-designer-root .pf-designer');
    // After the browser's own scroll restoration and the gallery's layout.
    setTimeout(() => el?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
  }, [loading, template, config.existing_design_hash, config.resume_closed, effectiveDisplayMode]);

  const modalRef = useRef(null);
  const returnFocusRef = useRef(null);
  const submittingFromDesigner = useRef(false);
  const handleSaveRef = useRef(null);
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
    // Pricing is a premium feature: the free build ships without the
    // /pricing/preview route at all (bin/free-build.sh strips includes/Pricing),
    // so without this gate every canvas change fired a 404 into the server log.
    if (!config.isPremium) {
      setPricePreview(null);
      return;
    }
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

  // Pro sites: fetch the vector-export bundle while the customer designs, so
  // the first save does not wait for it. No URL (free build) → nothing.
  useEffect(() => {
    if (config.pro_export_url) loadProExport(config.pro_export_url);
  }, [config.pro_export_url]);

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
            // An ORDERED design is the production record of that order and is
            // never written to again (the server refuses it). Reopening one is
            // "start from what I ordered before": it is loaded as the starting
            // point, and saving creates a NEW design with its own hash, its
            // own preview and its own production files. Keeping the old hash
            // here is what made two orders share — and overwrite — one design.
            if (design.status !== 'ordered') {
              setDesignHash(design.design_hash);
            }

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
            // Mark as not dirty since we just loaded — except for a copy of an
            // ordered design, which has not been saved under its new hash yet.
            setIsDirty(design.status === 'ordered');
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
    // …but not when the design was handed back after a FAILED add-to-cart:
    // the shop's error message is on the page underneath and must be seen.
    if (config.existing_design_hash && !config.resume_closed) {
      setDesignerOpen(true);
    }

    // Wire EVERY button outside the root, not the first `.pf-open-designer`
    // in the DOM: on mobile that first match was React's own (already wired)
    // button, so the PHP-rendered one below it never got a listener.
    const buttons = getExternalOpenButtons();
    setHasExternalOpenButton(buttons.length > 0);
    if (buttons.length === 0) return;

    const handler = () => setDesignerOpen(true);
    buttons.forEach((btn) => btn.addEventListener('click', handler));
    return () => buttons.forEach((btn) => btn.removeEventListener('click', handler));
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

  // The cart form can be submitted WITHOUT the designer's own button: Enter in
  // the quantity field, the "Go" key on a phone keyboard, another plugin's
  // buy-now button. Every such submit is handed to handleSave, so there is
  // exactly ONE way a design reaches the cart and every check in it (product
  // options, stock, example texts, the save itself) always runs.
  //
  // This effect used to carry its own second copy of the save, and each check
  // added to handleSave was silently missing from it.
  //
  // `submittingFromDesigner` marks the submit handleSave itself fires once it
  // is done (see submitCartForm) — that one must pass, or the two would hand
  // the form back and forth forever.
  useEffect(() => {
    const form = document.querySelector('form.cart');
    if (!form) return;

    const handleSubmit = (e) => {
      if (submittingFromDesigner.current) return;

      const store = useDesignerStore.getState();
      const nothingDesigned = !store.designHash && Object.keys(store.canvasSnapshots).length === 0;
      // A product that may be ordered plain, and nothing was designed: this
      // is an ordinary WooCommerce order and none of our business.
      if (nothingDesigned && !customizationRequired) return;

      e.preventDefault();
      handleSaveRef.current?.({ fromForm: true });
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

    // WooCommerce adds to cart via the `add-to-cart=<product_id>` param, which
    // is normally carried by the submit BUTTON's name/value. A programmatic
    // form submit does not include button values, so without this the POST has
    // no add-to-cart param and WooCommerce adds nothing (the "button does
    // nothing" symptom). Inject it as a hidden input, taking the id from the
    // native button when present, else from the designer config.
    const nativeBtn = form.querySelector('button[name="add-to-cart"], input[name="add-to-cart"]:not([type="hidden"])');
    const productId = (nativeBtn && nativeBtn.value) || config.product_id;
    if (productId) {
      let atc = form.querySelector('input[type="hidden"][name="add-to-cart"]');
      if (!atc) {
        atc = document.createElement('input');
        atc.type = 'hidden';
        atc.name = 'add-to-cart';
        form.appendChild(atc);
      }
      atc.value = productId;
    }

    // requestSubmit() fires the submit event synchronously, so the flag is up
    // exactly while our own interceptor sees it. (form.submit() fires no
    // event at all.)
    submittingFromDesigner.current = true;
    try {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.submit();
      }
    } finally {
      submittingFromDesigner.current = false;
    }
  };

  // Scroll to the product's options (size, colour, …). On a phone the designer
  // covers the page, so it steps aside first — the design stays in memory.
  const goToProductOptions = () => {
    setMissingOptions([]);
    setUnavailable('');
    if (effectiveDisplayMode === 'modal') setDesignerOpen(false);
    const target = document.querySelector('form.cart .variations') || document.querySelector('form.cart');
    setTimeout(() => target?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  // "Change it": hand the customer the first example still standing.
  const editSampleText = () => {
    const first = sampleTexts[0];
    setSampleTexts([]);
    if (!first) return;
    const state = useDesignerStore.getState();
    if (first.viewIndex !== state.currentViewIndex) {
      // It is on another side; show that side. Selecting has to wait for its
      // canvas, and the customer sees the example in front of them either way.
      state.setCurrentViewIndex(first.viewIndex);
      return;
    }
    const canvas = state.fabricCanvasRef;
    const obj = firstSampleObject(canvas);
    if (canvas && obj) {
      canvas.setActiveObject(obj);
      canvas.requestRenderAll();
    }
  };

  // "Leave it out": empty every example, on every side, then order.
  const orderWithoutSampleTexts = () => {
    const state = useDesignerStore.getState();
    const canvas = state.fabricCanvasRef;
    if (emptySamplesOnCanvas(canvas) > 0) {
      state.snapshotView(state.currentViewIndex, canvas.toObject(['data']));
    }
    Object.entries(state.canvasSnapshots).forEach(([key, json]) => {
      if (Number(key) === state.currentViewIndex) return;
      const emptied = emptySamplesInJson(json);
      if (emptied !== json) state.snapshotView(Number(key), emptied);
    });
    setSampleTexts([]);
    handleSave({ samplesChecked: true });
  };

  // A check stopped an order that was started from the page's own form, not
  // from the designer. The message is in the designer — on a desktop more
  // than a screen below the quantity field, on a phone behind a closed
  // overlay — so bring it in front of the customer, or Enter "did nothing".
  const revealDesignerMessage = () => {
    if (effectiveDisplayMode === 'modal') {
      setDesignerOpen(true);
      return;
    }
    setTimeout(() => {
      document.querySelector('#pf-designer-root .pf-designer__actions')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  const handleSave = async ({ samplesChecked = false, fromForm = false } = {}) => {
    if (useDesignerStore.getState().isSaving) return;
    clearError();

    // Never save-and-submit into a form WooCommerce will reject: the reload
    // that follows throws the design away. Ask for the options first.
    const cartForm = document.querySelector('form.cart');
    const stillToChoose = missingProductOptions(cartForm);
    const unavailable = stillToChoose.length === 0 ? unavailableReason(cartForm) : '';
    setMissingOptions(stillToChoose);
    setUnavailable(unavailable);
    // From here on the customer is acting on the design again, so the
    // "your design was kept" note from a refused attempt has done its job.
    setResumedAfterRefusal(false);
    if (stillToChoose.length > 0 || unavailable) {
      if (fromForm) revealDesignerMessage();
      return;
    }

    // An example text still on the product ("Achternaam") would be engraved
    // as it stands. Ask once; the customer may well mean it.
    if (!samplesChecked) {
      const state = useDesignerStore.getState();
      const samples = collectSampleTexts({
        canvas: state.fabricCanvasRef,
        activeViewIndex: state.currentViewIndex,
        snapshots: state.canvasSnapshots,
      });
      setSampleTexts(samples);
      if (samples.length > 0) {
        if (fromForm) revealDesignerMessage();
        return;
      }
    }

    // Block when customization is required but nothing has been designed yet —
    // otherwise we'd create an empty design and drop it in the cart.
    {
      const s = useDesignerStore.getState();
      if (customizationRequired && !s.designHash && Object.keys(s.canvasSnapshots).length === 0) {
        setError(__('Please customize your product before adding to cart.', 'snelgraveren-product-designer'));
        if (fromForm) revealDesignerMessage();
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
          try { json = fabricCanvasRef.toObject(['data']); } catch (_) { json = snapJson; }
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
            // See the matching comment in the add-to-cart save path above.
            thumbnail = atLogicalCanvasSize(fabricCanvasRef, w, h, () =>
              withoutTextPlaceholders(fabricCanvasRef, () =>
                fabricCanvasRef.toDataURL({ format: 'png', multiplier: 0.5 })
              )
            );
          } catch (_) { /* ignore */ }
          try {
            exportSvg = atLogicalCanvasSize(fabricCanvasRef, w, h, () =>
              withoutExcludedObjects(fabricCanvasRef, () =>
                fabricCanvasRef.toDataURL({ format: 'png', multiplier: 3 })
              )
            );
          } catch (_) { /* ignore */ }
        } else {
          // Non-active view: render offscreen
          thumbnail = await renderOffscreenThumbnail(json, w, h);
          exportSvg = await renderOffscreenExportPng(json, w, h);
        }
        // Real vector SVG (outline default + font-embedded variant), rendered
        // offscreen at native size so it is zoom-independent and correctly scaled.
        const { outline: exportVector, embed: exportVectorEmbed, lbrn: exportLbrn } =
          await buildProExportVectors(config.pro_export_url, json, w, h, {
            customFonts: customFontsRef.current,
            restUrl: config.rest_url,
            widthMm: resolveWidthMm(views, idx).widthMm,
          });
        savedDesign = await saveDesignView(hash, view.id, json, thumbnail, exportSvg, exportVector, exportVectorEmbed, exportLbrn);
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
      if (fromForm) revealDesignerMessage();
    }
  };
  handleSaveRef.current = handleSave;

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
      {isMobile && !designerOpen && !hasExternalOpenButton && (
        <button
          type="button"
          className="pf-open-designer button"
          onClick={() => setDesignerOpen(true)}
        >
          {__('Customize Product', 'snelgraveren-product-designer')}
        </button>
      )}
      {config.sticky_start !== false && !(isModal && designerOpen) && (
        <StartBar
          note={resumedAfterRefusal ? __('Your design is kept.', 'snelgraveren-product-designer') : ''}
          // Modal (every phone): the open button is the way in. Embedded: the
          // designer itself is, and "start" means scrolling to it.
          watchKey={`${effectiveDisplayMode}:${hasExternalOpenButton}`}
          getTarget={() => (isModal
            ? document.querySelector('.pf-open-designer')
            : document.querySelector('#pf-designer-root .pf-designer'))}
          onStart={() => {
            if (isModal) { setDesignerOpen(true); return; }
            document.querySelector('#pf-designer-root .pf-designer')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        />
      )}
      <div
        ref={isModal ? modalRef : undefined}
        className={wrapperClass}
        role={isModal ? 'dialog' : undefined}
        aria-modal={isModal ? 'true' : undefined}
        aria-label={isModal ? __('Product Designer', 'snelgraveren-product-designer') : undefined}
        // A click on the dark backdrop closes the designer — and ONLY that.
        // This handler used to close on any click that bubbled up to it, and
        // the toolbar is a child of this element: pressing Undo or Redo closed
        // the designer instead of undoing (reported for 1.12.5; every phone
        // uses this full-screen mode).
        onClick={isModal ? (e) => { if (e.target === e.currentTarget) setDesignerOpen(false); } : undefined}
      >
        <Toolbar />
        <div className="pf-designer__layout" onClick={isModal ? (e) => e.stopPropagation() : undefined}>
          <DesignerCanvas />
          <div className="pf-designer__sidebar-wrap">
            <Sidebar />
            {/* Everything that finishes the job, kept together so a phone can
                pin it to the bottom of the screen: with the options open the
                order button used to scroll out of sight. */}
            <div className="pf-designer__actions">
              {error && (
                <div className="pf-designer__error" onClick={clearError}>
                  {error}
                </div>
              )}
              {missingOptions.length > 0 && (
                <div className="pf-designer__notice" role="alert">
                  <span>
                    {sprintf(
                      /* translators: %s: the product options still to choose, e.g. "Size, Colour" */
                      __('First choose: %s. Your design is kept.', 'snelgraveren-product-designer'),
                      missingOptions.join(', '),
                    )}
                  </span>
                  <button type="button" className="pf-designer__notice-btn" onClick={goToProductOptions}>
                    {__('Choose options', 'snelgraveren-product-designer')}
                  </button>
                </div>
              )}
              {unavailable && (
                <div className="pf-designer__notice" role="alert">
                  <span>
                    {unavailable === '-'
                      ? __('This combination of options cannot be ordered. Choose another one. Your design is kept.', 'snelgraveren-product-designer')
                      : sprintf(
                        /* translators: %s: the shop's own availability message, e.g. "Out of stock" */
                        __('%s — choose another option. Your design is kept.', 'snelgraveren-product-designer'),
                        unavailable,
                      )}
                  </span>
                  <button type="button" className="pf-designer__notice-btn" onClick={goToProductOptions}>
                    {__('Choose options', 'snelgraveren-product-designer')}
                  </button>
                </div>
              )}
              {sampleTexts.length > 0 && (
                <div className="pf-designer__notice" role="alert">
                  <span>
                    {sprintf(
                      /* translators: %s: the example texts, quoted and comma-separated, e.g. “First name”, “Phone number” (Back) */
                      __('Still the example text: %s. It will be engraved like this.', 'snelgraveren-product-designer'),
                      sampleTexts.map((sample) => {
                        const quoted = `“${sample.text}”`;
                        const views = template?.views || [];
                        return views.length > 1
                          ? `${quoted} (${viewLabel(views[sample.viewIndex], sample.viewIndex)})`
                          : quoted;
                      }).join(', '),
                    )}
                  </span>
                  <div className="pf-designer__notice-actions">
                    <button type="button" className="pf-designer__notice-btn pf-designer__notice-btn--primary" onClick={editSampleText}>
                      {__('Change it', 'snelgraveren-product-designer')}
                    </button>
                    <button type="button" className="pf-designer__notice-btn" onClick={orderWithoutSampleTexts}>
                      {__('Leave it out', 'snelgraveren-product-designer')}
                    </button>
                    <button type="button" className="pf-designer__notice-btn" onClick={() => { setSampleTexts([]); handleSave({ samplesChecked: true }); }}>
                      {__('Order as it is', 'snelgraveren-product-designer')}
                    </button>
                  </div>
                </div>
              )}
              {resumedAfterRefusal && !unavailable && missingOptions.length === 0 && (
                <div className="pf-designer__notice" role="status">
                  <span>{__('This could not be added to the cart yet — see the message at the top of the page. Your design is kept.', 'snelgraveren-product-designer')}</span>
                </div>
              )}
              {pricePreview && pricePreview.surcharge > 0 && (
                <div className="pf-designer__price" aria-live="polite">
                  {__('Design surcharge:', 'snelgraveren-product-designer')}{' '}
                  <strong>{pricePreview.currency_symbol}{pricePreview.surcharge.toFixed(2)}</strong>
                </div>
              )}
              <div className="pf-designer__buttons">
                {isModal && (
                  <button
                    type="button"
                    className="pf-designer__close-btn"
                    onClick={(e) => { e.stopPropagation(); setDesignerOpen(false); }}
                  >
                    {__('Close', 'snelgraveren-product-designer')}
                  </button>
                )}
                <button
                  type="button"
                  className="pf-designer__save-btn"
                  onClick={() => handleSave()}
                  disabled={isSaving}
                >
                  <span aria-live="polite">
                    {isSaving
                      ? __('Saving…', 'snelgraveren-product-designer')
                      : __('Save & add to cart', 'snelgraveren-product-designer')}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
