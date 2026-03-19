import React, { useEffect, useState } from 'react';
import useDesignerStore from './store/useDesignerStore';
import { loadTemplate, loadDesign, createDesign, saveDesignView } from './api/designerApi';
import DesignerCanvas from './components/DesignerCanvas';
import Sidebar from './components/Sidebar';
import { loadGoogleFonts } from './utils/fonts';

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

  // Load template on mount, then load existing design if hash is present
  useEffect(() => {
    if (!config.template_id) {
      setError('No template configured for this product.');
      setLoading(false);
      return;
    }

    loadTemplate(config.template_id)
      .then(async (data) => {
        setTemplate(data);

        // Load Google Fonts used in this template
        const allowedFonts = data.global_config?.allowed_fonts || [];
        if (allowedFonts.length > 0) {
          loadGoogleFonts(allowedFonts);
        }

        // If returning from cart with an existing design, load it
        if (config.existing_design_hash) {
          try {
            const design = await loadDesign(config.existing_design_hash);
            setDesignHash(design.design_hash);

            // Populate canvas snapshots from saved views
            const views = data.views || [];
            if (design.views) {
              for (const dv of design.views) {
                const viewIndex = views.findIndex((v) => v.id === dv.view_id);
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

  // Save handler
  const handleSave = async () => {
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
      let savedDesign = null;
      for (const [viewIndex, json] of Object.entries(canvasSnapshots)) {
        const view = views[parseInt(viewIndex, 10)];
        if (view?.id) {
          // Generate thumbnail from current canvas (for the active view)
          let thumbnail = '';
          if (fabricCanvasRef && parseInt(viewIndex, 10) === useDesignerStore.getState().currentViewIndex) {
            try {
              thumbnail = fabricCanvasRef.toDataURL({ format: 'png', multiplier: 0.5 });
            } catch (_) { /* ignore */ }
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
      setSavedRecently(true);
      setTimeout(() => setSavedRecently(false), 2000);
    } catch (err) {
      setError(err.message);
      setIsSaving(false);
    }
  };

  if (loading) {
    return <div className="pd-designer pd-designer--loading">Loading designer...</div>;
  }

  if (!template) {
    return <div className="pd-designer pd-designer--error">{error || 'Template not available.'}</div>;
  }

  const isModal = config.display_mode === 'modal';
  const wrapperClass = [
    'pd-designer',
    `pd-designer--${config.display_mode || 'embedded'}`,
    isModal && designerOpen ? 'pd-designer--open' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={wrapperClass}
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
            {isSaving ? 'Saving...' : savedRecently ? 'Saved!' : 'Save Design'}
          </button>
          {isModal && (
            <button
              type="button"
              className="pd-designer__close-btn"
              onClick={(e) => { e.stopPropagation(); setDesignerOpen(false); }}
            >
              Close Designer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
