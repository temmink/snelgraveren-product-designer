import React, { useEffect, useRef, useState, useCallback } from 'react';
import { __ } from '@wordpress/i18n';
import { Canvas as FabricCanvas } from 'fabric';
import useDesignerStore from './store/useDesignerStore';
import { loadTemplate, loadDesign, createDesign, saveDesignView, fetchCustomFonts, fetchClipartCollections } from './api/designerApi';
import DesignerCanvas from './components/DesignerCanvas';
import Sidebar from './components/Sidebar';
import Toolbar from './components/Toolbar';
import { loadGoogleFonts, loadCustomFonts } from './utils/fonts';
import useIsMobile from './hooks/useIsMobile';

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

const config = window.pfDesigner || {};

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

  const isMobile = useIsMobile();
  const effectiveDisplayMode = isMobile ? 'modal' : (config.display_mode || 'embedded');

  const [loading, setLoading] = useState(true);
  const [designerOpen, setDesignerOpen] = useState(effectiveDisplayMode !== 'modal' || !!config.auto_open || !!config.existing_design_hash);
  const [savedRecently, setSavedRecently] = useState(false);
  const [designSaved, setDesignSaved] = useState(!!config.existing_design_hash);

  const modalRef = useRef(null);
  const returnFocusRef = useRef(null);
  const savingForCartRef = useRef(false);

  // Load template on mount, then load existing design if hash is present
  useEffect(() => {
    if (!config.template_id) {
      setError(__('No template configured for this product.', 'productforge'));
      setLoading(false);
      return;
    }

    loadTemplate(config.template_id)
      .then(async (data) => {
        // Load custom fonts BEFORE Google Fonts (so custom families are excluded from Google loading)
        const allowedFonts = data.global_config?.allowed_fonts || [];
        fetchCustomFonts()
          .then((customFonts) => {
            loadCustomFonts(customFonts);
            loadGoogleFonts(allowedFonts);
          })
          .catch(() => {
            // If custom fonts fail, still load Google Fonts
            loadGoogleFonts(allowedFonts);
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Modal open/close
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
  }, []);

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

  // Intercept cart form submit: auto-save design before adding to cart
  useEffect(() => {
    const form = document.querySelector('form.cart');
    if (!form) return;

    const handleSubmit = async (e) => {
      const store = useDesignerStore.getState();

      // If customization is required but no design was saved, block submission
      if (customizationRequired && !store.designHash && Object.keys(store.canvasSnapshots).length === 0) {
        e.preventDefault();
        setError(__('Please customize your product before adding to cart.', 'productforge'));
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
          for (const [viewIndex, json] of Object.entries(store.canvasSnapshots)) {
            const idx = parseInt(viewIndex, 10);
            const view = views[idx];
            if (view?.id) {
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
              await saveDesignView(hash, view.id, json, thumbnail, exportSvg);
            }
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
          setError(__('Failed to save design. Please try again.', 'productforge'));
        }
        return;
      }
    };

    form.addEventListener('submit', handleSubmit);
    return () => form.removeEventListener('submit', handleSubmit);
  }, [template, customizationRequired]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save handler
  const handleSave = async () => {
    if (useDesignerStore.getState().isSaving) return;
    clearError();
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
      for (const [viewIndex, json] of Object.entries(freshSnapshots)) {
        const idx = parseInt(viewIndex, 10);
        const view = views[idx];
        if (view?.id) {
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
          savedDesign = await saveDesignView(hash, view.id, json, thumbnail, exportSvg);
        }
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
      setSavedRecently(true);
      setTimeout(() => setSavedRecently(false), 2000);
    } catch (err) {
      setError(err.message);
      setIsSaving(false);
    }
  };

  if (loading) {
    return <div className="pf-designer pf-designer--loading">{__('Loading designer...', 'productforge')}</div>;
  }

  if (!template) {
    return <div className="pf-designer pf-designer--error">{error || __('Template not available.', 'productforge')}</div>;
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
          {__('Customize Product', 'productforge')}
        </button>
      )}
      <div
        ref={isModal ? modalRef : undefined}
        className={wrapperClass}
        role={isModal ? 'dialog' : undefined}
        aria-modal={isModal ? 'true' : undefined}
        aria-label={isModal ? __('ProductForge designer', 'productforge') : undefined}
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
            <button
              type="button"
              className={`pf-designer__save-btn${savedRecently ? ' pf-designer__save-btn--saved' : ''}`}
              onClick={handleSave}
              disabled={isSaving || !isDirty}
            >
              <span aria-live="polite">
                {isSaving ? __('Saving...', 'productforge') : savedRecently ? __('Saved!', 'productforge') : __('Save Design', 'productforge')}
              </span>
            </button>
            {isModal && (
              <button
                type="button"
                className="pf-designer__close-btn"
                onClick={(e) => { e.stopPropagation(); setDesignerOpen(false); }}
              >
                {__('Close Designer', 'productforge')}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
