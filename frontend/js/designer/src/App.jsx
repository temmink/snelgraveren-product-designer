import React, { useEffect, useState } from 'react';
import useDesignerStore from './store/useDesignerStore';
import { loadTemplate, createDesign, saveDesignView } from './api/designerApi';
import DesignerCanvas from './components/DesignerCanvas';
import Sidebar from './components/Sidebar';

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
  const [designerOpen, setDesignerOpen] = useState(config.display_mode !== 'modal');

  // Load template on mount
  useEffect(() => {
    if (!config.template_id) {
      setError('No template configured for this product.');
      setLoading(false);
      return;
    }

    loadTemplate(config.template_id)
      .then((data) => {
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
          await saveDesignView(hash, view.id, json, thumbnail);
        }
      }

      setIsDirty(false);
    } catch (err) {
      setError(err.message);
    } finally {
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
      {isModal && (
        <button
          type="button"
          className="pd-designer__close"
          onClick={(e) => { e.stopPropagation(); setDesignerOpen(false); }}
          aria-label="Close designer"
        >
          &times;
        </button>
      )}

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
            className="pd-designer__save-btn"
            onClick={handleSave}
            disabled={isSaving || !isDirty}
          >
            {isSaving ? 'Saving...' : 'Save Design'}
          </button>
        </div>
      </div>
    </div>
  );
}
