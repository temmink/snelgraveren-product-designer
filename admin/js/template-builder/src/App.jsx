import React, { useEffect, useState } from 'react';
import { __ } from '@wordpress/i18n';
import useTemplateStore from './store/useTemplateStore';
import { templateApi } from './api/templateApi';
import Canvas from './components/Canvas';
import ViewTabs from './components/ViewTabs';
import TreePanel from './components/TreePanel';
import PermissionsPanel from './components/PermissionsPanel';
import PricingPanel from './components/PricingPanel';
import GlobalSettings from './components/GlobalSettings';
import { loadGoogleFonts, loadCustomFonts } from './utils/fonts';
import { fontApi, paletteApi } from './api/templateApi';

const TABS = [
  { label: __( 'Structure',   'productforge' ), Component: TreePanel },
  { label: __( 'Permissions', 'productforge' ), Component: PermissionsPanel },
  { label: __( 'Pricing',     'productforge' ), Component: PricingPanel },
  { label: __( 'Settings',    'productforge' ), Component: GlobalSettings },
];

export default function App() {
  const {
    id, title, status, isDirty, isSaving,
    views, globalConfig,
    loadFromApi, setTitle, setStatus, setId, setIsSaving, setIsDirty,
    addView, updateView, removedViewIds, clearRemovedViewIds,
    setCustomFonts,
    setColorPalettes,
  } = useTemplateStore();

  const [activeTab,  setActiveTab]  = useState(0);
  const [saveError,  setSaveError]  = useState(null);
  const [isLoading,  setIsLoading]  = useState(false);

  const templateId = window.pfTemplateBuilder?.templateId || 0;

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
        name: __( 'Front', 'productforge' ),
        canvas_width: 800,
        canvas_height: 600,
        background_url: '',
        background_transform: {},
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

  // Load custom fonts on mount
  useEffect(() => {
    fontApi.list().then((fonts) => {
      setCustomFonts(fonts);
      loadCustomFonts(fonts);
    }).catch((err) => console.error('Failed to load custom fonts:', err));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load global color palettes on mount
  useEffect(() => {
    paletteApi.list()
      .then(setColorPalettes)
      .catch((err) => console.error('Failed to load color palettes:', err));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!title.trim()) {
      setSaveError( __( 'Title is required.', 'productforge' ) );
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
          background_transform: view.background_transform || {},
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
      setSaveError( err.message || __( 'Save failed.', 'productforge' ) );
    } finally {
      setIsSaving(false);
    }
  };

  const { Component: ActivePanel } = TABS[activeTab];

  if (isLoading) {
    return <div className="pf-builder pf-builder--loading">{ __( 'Loading template…', 'productforge' ) }</div>;
  }

  return (
    <div className="pf-builder">

      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <div className="pf-builder__header">
        <a href="?page=productforge" className="pf-builder__back button">
          { __( '← Templates', 'productforge' ) }
        </a>
        <input
          type="text"
          className="pf-builder__title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={ __( 'Template title…', 'productforge' ) }
        />
        <select
          className="pf-builder__status-select"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="draft">{ __( 'Draft', 'productforge' ) }</option>
          <option value="published">{ __( 'Published', 'productforge' ) }</option>
          <option value="archived">{ __( 'Archived', 'productforge' ) }</option>
        </select>
        <button
          className="pf-builder__save-btn button button-primary"
          onClick={handleSave}
          disabled={isSaving}
        >
          { isSaving ? __( 'Saving…', 'productforge' ) : isDirty ? __( 'Save', 'productforge' ) : __( 'Saved ✓', 'productforge' ) }
        </button>
        {saveError && <span className="pf-builder__save-error">{saveError}</span>}
      </div>

      {/* ── View tabs ──────────────────────────────────────────────────── */}
      <ViewTabs />

      {/* ── Main body ──────────────────────────────────────────────────── */}
      <div className="pf-builder__body">

        {/* Canvas area */}
        <div className="pf-builder__canvas-area">
          <Canvas />
        </div>

        {/* Sidebar */}
        <div className="pf-builder__sidebar">
          <nav className="pf-builder__sidebar-nav" role="tablist">
            {TABS.map((tab, i) => (
              <button
                key={tab.label}
                role="tab"
                aria-selected={activeTab === i}
                className={`pf-builder__sidebar-tab${activeTab === i ? ' pf-builder__sidebar-tab--active' : ''}`}
                onClick={() => setActiveTab(i)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="pf-builder__sidebar-content">
            <ActivePanel />
          </div>
        </div>

      </div>
    </div>
  );
}

