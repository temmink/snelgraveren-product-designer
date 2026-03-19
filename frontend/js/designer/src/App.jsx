import React, { useEffect, useRef, useState, useCallback } from 'react';
import { __ } from '@wordpress/i18n';
import { Canvas as FabricCanvas } from 'fabric';
import useDesignerStore from './store/useDesignerStore';
import { loadTemplate, loadDesign, createDesign, saveDesignView } from './api/designerApi';
import DesignerCanvas from './components/DesignerCanvas';
import Sidebar from './components/Sidebar';
import { loadGoogleFonts } from './utils/fonts';

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

const config = window.pdDesigner || {};

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

  const [loading, setLoading] = useState(true);
  const [designerOpen, setDesignerOpen] = useState(config.display_mode !== 'modal' || !!config.auto_open);
  const [savedRecently, setSavedRecently] = useState(false);
  const [designSaved, setDesignSaved] = useState(!!config.existing_design_hash);

  const modalRef = useRef(null);
  const returnFocusRef = useRef(null);
  const savingForCartRef = useRef(false);

  // Load template on mount, then load existing design if hash is present
  useEffect(() => {
    if (!config.template_id) {
      setError(__('No template configured for this product.', 'product-designer'));
      setLoading(false);
      return;
    }

    loadTemplate(config.template_id)
      .then(async (data) => {
        // Load Google Fonts used in this template
        const allowedFonts = data.global_config?.allowed_fonts || [];
        if (allowedFonts.length > 0) {
          loadGoogleFonts(allowedFonts);
        }

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
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Modal open/close
  useEffect(() => {
    if (config.display_mode !== 'modal') return;

    // Auto-open when returning from cart with an existing design
    if (config.existing_design_hash) {
      setDesignerOpen(true);
    }

    const btn = document.querySelector('.pd-open-designer');
    if (!btn) return;

    const handler = () => setDesignerOpen(true);
    btn.addEventListener('click', handler);
    return () => btn.removeEventListener('click', handler);
  }, []);

  // Modal focus trapping and keyboard handling
  useEffect(() => {
    if (config.display_mode !== 'modal') return;

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

  // Sync design hash to hidden input
  useEffect(() => {
    if (!designHash) return;
    let input = document.querySelector('input[name="pd_design_hash"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'pd_design_hash';
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
      btn.classList.add('pd-design-required');
      btn.setAttribute('data-pd-original-text', btn.textContent);
      // Don't disable — just add a class and intercept via the submit handler
    } else {
      btn.classList.remove('pd-design-required');
    }

    return () => {
      btn.classList.remove('pd-design-required');
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
        setError(__('Please customize your product before adding to cart.', 'product-designer'));
        return;
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
              if (idx === store.currentViewIndex && store.fabricCanvasRef) {
                try {
                  thumbnail = store.fabricCanvasRef.toDataURL({ format: 'png', multiplier: 0.5 });
                } catch (_) { /* ignore */ }
              } else {
                const w = view.canvas_width || 600;
                const h = view.canvas_height || 600;
                thumbnail = await renderOffscreenThumbnail(json, w, h);
              }
              await saveDesignView(hash, view.id, json, thumbnail);
            }
          }

          // Sync hash to hidden input
          let input = document.querySelector('input[name="pd_design_hash"]');
          if (!input) {
            input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'pd_design_hash';
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
          setError(__('Failed to save design. Please try again.', 'product-designer'));
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
      let hash = designHash;

      // Create design if first save
      if (!hash) {
        const design = await createDesign(config.template_id, config.product_id);
        hash = design.design_hash;
        setDesignHash(hash);
      }

      // Save each view that has a snapshot
      const views = template?.views || [];
      const activeViewIndex = useDesignerStore.getState().currentViewIndex;
      let savedDesign = null;
      for (const [viewIndex, json] of Object.entries(canvasSnapshots)) {
        const idx = parseInt(viewIndex, 10);
        const view = views[idx];
        if (view?.id) {
          let thumbnail = '';
          if (idx === activeViewIndex && fabricCanvasRef) {
            // Active view: capture directly from the live canvas
            try {
              thumbnail = fabricCanvasRef.toDataURL({ format: 'png', multiplier: 0.5 });
            } catch (_) { /* ignore */ }
          } else {
            // Non-active view: render offscreen to generate thumbnail
            const w = view.canvas_width || 600;
            const h = view.canvas_height || 600;
            thumbnail = await renderOffscreenThumbnail(json, w, h);
          }
          savedDesign = await saveDesignView(hash, view.id, json, thumbnail);
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
    return <div className="pd-designer pd-designer--loading">{__('Loading designer...', 'product-designer')}</div>;
  }

  if (!template) {
    return <div className="pd-designer pd-designer--error">{error || __('Template not available.', 'product-designer')}</div>;
  }

  const isModal = config.display_mode === 'modal';
  const wrapperClass = [
    'pd-designer',
    `pd-designer--${config.display_mode || 'embedded'}`,
    isModal && designerOpen ? 'pd-designer--open' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={isModal ? modalRef : undefined}
      className={wrapperClass}
      role={isModal ? 'dialog' : undefined}
      aria-modal={isModal ? 'true' : undefined}
      aria-label={isModal ? __('Product designer', 'product-designer') : undefined}
      onClick={isModal ? (e) => { e.stopPropagation(); setDesignerOpen(false); } : undefined}
      onMouseDown={isModal ? (e) => e.stopPropagation() : undefined}
    >
      <div className="pd-designer__layout" onClick={isModal ? (e) => e.stopPropagation() : undefined}>
        <DesignerCanvas />
        <div className="pd-designer__sidebar-wrap">
          <Sidebar />
          {error && (
            <div className="pd-designer__error" onClick={clearError}>
              {error}
            </div>
          )}
          <button
            type="button"
            className={`pd-designer__save-btn${savedRecently ? ' pd-designer__save-btn--saved' : ''}`}
            onClick={handleSave}
            disabled={isSaving || !isDirty}
          >
            <span aria-live="polite">
              {isSaving ? __('Saving...', 'product-designer') : savedRecently ? __('Saved!', 'product-designer') : __('Save Design', 'product-designer')}
            </span>
          </button>
          {isModal && (
            <button
              type="button"
              className="pd-designer__close-btn"
              onClick={(e) => { e.stopPropagation(); setDesignerOpen(false); }}
            >
              {__('Close Designer', 'product-designer')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
