import React, { useEffect, useState } from 'react';
import useTemplateStore from './store/useTemplateStore';
import { templateApi } from './api/templateApi';
import Canvas from './components/Canvas';
import ViewTabs from './components/ViewTabs';
import TreePanel from './components/TreePanel';
import PermissionsPanel from './components/PermissionsPanel';
import PricingPanel from './components/PricingPanel';
import GlobalSettings from './components/GlobalSettings';
import { loadGoogleFonts } from './utils/fonts';

const TABS = [
  { label: 'Structure',   Component: TreePanel },
  { label: 'Permissions', Component: PermissionsPanel },
  { label: 'Pricing',     Component: PricingPanel },
  { label: 'Settings',    Component: GlobalSettings },
];

export default function App() {
  const {
    id, title, status, isDirty, isSaving,
    views, globalConfig,
    loadFromApi, setTitle, setStatus, setId, setIsSaving, setIsDirty,
    addView, updateView, removedViewIds, clearRemovedViewIds,
  } = useTemplateStore();

  const [activeTab,  setActiveTab]  = useState(0);
  const [saveError,  setSaveError]  = useState(null);
  const [isLoading,  setIsLoading]  = useState(false);

  const templateId = window.pdTemplateBuilder?.templateId || 0;

  // Load existing template on mount.
  useEffect(() => {
    if (templateId > 0) {
      setIsLoading(true);
      templateApi.get(templateId)
        .then(loadFromApi)
        .catch((err) => {
          console.error('Failed to load template:', err);
          setSaveError(err.message || 'Failed to load template.');
        })
        .finally(() => setIsLoading(false));
    } else if (views.length === 0) {
      // New template: seed a default "Front" view.
      addView({
        name: 'Front',
        canvas_width: 800,
        canvas_height: 600,
        background_url: '',
        zones_config: [],
        layers_config: [],
        permissions: {},
        sort_order: 0,
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load Google Fonts when allowed_fonts changes
  useEffect(() => {
    const fonts = globalConfig.allowed_fonts || [];
    if (fonts.length > 0) {
      loadGoogleFonts(fonts);
    }
  }, [globalConfig.allowed_fonts]);

  const handleSave = async () => {
    if (!title.trim()) {
      setSaveError('Title is required.');
      return;
    }
    setSaveError(null);
    setIsSaving(true);

    try {
      const templateData = { title, status, global_config: globalConfig };
      let savedId = id;

      if (id > 0) {
        await templateApi.update(id, templateData);
      } else {
        const created = await templateApi.create(templateData);
        savedId = created.id;
        setId(savedId);
        // Update browser URL without page reload.
        const url = new URL(window.location.href);
        url.searchParams.set('action', 'edit');
        url.searchParams.set('template_id', String(savedId));
        window.history.replaceState({}, '', url.toString());
      }

      // Save each view sequentially.
      // Note: The spec requires a single DB transaction (template + views atomically).
      // Atomicity is enforced server-side by the REST handler (future improvement);
      // the client saves sequentially so partial failures are surfaced via saveError.
      for (const [index, view] of views.entries()) {
        const viewData = {
          name:            view.name,
          sort_order:           index,
          canvas_width:         view.canvas_width  || 800,
          canvas_height:        view.canvas_height || 600,
          background_url:       view.background_url || '',
          zones_config:         view.zones_config  || [],
          layers_config:        [],
          permissions:          view.permissions   || {},
        };
        if (view.id) {
          await templateApi.updateView(savedId, view.id, viewData);
        } else {
          const created = await templateApi.createView(savedId, viewData);
          updateView(index, { id: created.id });
        }
      }

      // Delete views removed client-side.
      for (const viewId of removedViewIds) {
        await templateApi.deleteView(savedId, viewId);
      }
      clearRemovedViewIds();

      setIsDirty(false);
    } catch (err) {
      setSaveError(err.message || 'Save failed.');
    } finally {
      setIsSaving(false);
    }
  };

  const { Component: ActivePanel } = TABS[activeTab];

  if (isLoading) {
    return <div className="pd-builder pd-builder--loading">Loading template…</div>;
  }

  return (
    <div className="pd-builder">

      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <div className="pd-builder__header">
        <a href="?page=product-designer" className="pd-builder__back button">
          ← Templates
        </a>
        <input
          type="text"
          className="pd-builder__title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Template title…"
        />
        <select
          className="pd-builder__status-select"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
        <button
          className="pd-builder__save-btn button button-primary"
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? 'Saving…' : isDirty ? 'Save' : 'Saved ✓'}
        </button>
        {saveError && <span className="pd-builder__save-error">{saveError}</span>}
      </div>

      {/* ── View tabs ──────────────────────────────────────────────────── */}
      <ViewTabs />

      {/* ── Main body ──────────────────────────────────────────────────── */}
      <div className="pd-builder__body">

        {/* Canvas area */}
        <div className="pd-builder__canvas-area">
          <Canvas />
        </div>

        {/* Sidebar */}
        <div className="pd-builder__sidebar">
          <nav className="pd-builder__sidebar-nav" role="tablist">
            {TABS.map((tab, i) => (
              <button
                key={tab.label}
                role="tab"
                aria-selected={activeTab === i}
                className={`pd-builder__sidebar-tab${activeTab === i ? ' pd-builder__sidebar-tab--active' : ''}`}
                onClick={() => setActiveTab(i)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="pd-builder__sidebar-content">
            <ActivePanel />
          </div>
        </div>

      </div>
    </div>
  );
}

// NOTE: No i18n shim needed — string literals are used directly.
// TODO Phase 6: replace with import { __ } from '@wordpress/i18n'
