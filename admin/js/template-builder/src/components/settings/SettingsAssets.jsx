import React, { useState } from 'react';
import { __ } from '@wordpress/i18n';
import { clipartApi } from '../../api/templateApi';

function CollectionManager({ collections, onUpdate }) {
  const [newName, setNewName] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  const [collectionItems, setCollectionItems] = useState({});

  const refreshCollections = async () => {
    const updated = await clipartApi.listCollections();
    onUpdate(updated);
    return updated;
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setError(null);
    try {
      await clipartApi.createCollection(newName.trim());
      await refreshCollections();
      setNewName('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(__('Delete this collection and all its clip art?', 'snelgraveren-product-designer'))) return;
    setError(null);
    try {
      await clipartApi.deleteCollection(id);
      await refreshCollections();
      setCollectionItems((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRename = async (id) => {
    if (!editName.trim()) return;
    setError(null);
    try {
      await clipartApi.renameCollection(id, editName.trim());
      await refreshCollections();
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleExpand = async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!collectionItems[id]) {
      try {
        const data = await clipartApi.getCollection(id);
        setCollectionItems((prev) => ({ ...prev, [id]: data.items }));
      } catch (err) {
        setError(err.message);
      }
    }
  };

  const handleUpload = async (e, collectionId) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    e.target.value = '';

    setIsUploading(true);
    setError(null);

    try {
      const results = [];
      for (const file of files) {
        const result = await clipartApi.upload(file, collectionId);
        results.push(result);
      }
      setCollectionItems((prev) => ({
        ...prev,
        [collectionId]: [...(prev[collectionId] || []), ...results],
      }));
      await refreshCollections();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteItem = async (itemId, collectionId) => {
    setError(null);
    try {
      await clipartApi.deleteItem(itemId);
      setCollectionItems((prev) => ({
        ...prev,
        [collectionId]: (prev[collectionId] || []).filter((i) => i.id !== itemId),
      }));
      await refreshCollections();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="pf-collection-manager">
      <h4>{__('Clip Art Collections', 'snelgraveren-product-designer')}</h4>
      {error && <p className="pf-settings__error">{error}</p>}

      {collections.map((c) => (
        <div key={c.id} className="pf-collection-manager__item">
          <div className="pf-collection-manager__header">
            {editingId === c.id ? (
              <div className="pf-collection-manager__edit-row">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="pf-settings__input"
                  onKeyDown={(e) => e.key === 'Enter' && handleRename(c.id)}
                />
                <button type="button" className="button button-primary button-small" onClick={() => handleRename(c.id)}>
                  {__('Save', 'snelgraveren-product-designer')}
                </button>
                <button type="button" className="button button-small" onClick={() => setEditingId(null)}>
                  {__('Cancel', 'snelgraveren-product-designer')}
                </button>
              </div>
            ) : (
              <div className="pf-collection-manager__row">
                <button
                  type="button"
                  className="pf-collection-manager__expand"
                  onClick={() => handleExpand(c.id)}
                >
                  {expandedId === c.id ? '\u25be' : '\u25b8'} <strong>{c.name}</strong> ({c.item_count})
                </button>
                <div className="pf-collection-manager__actions">
                  <button type="button" className="button button-small" onClick={() => { setEditingId(c.id); setEditName(c.name); }}>
                    {__('Rename', 'snelgraveren-product-designer')}
                  </button>
                  <button type="button" className="button button-small pf-btn--danger" onClick={() => handleDelete(c.id)}>
                    {__('Delete', 'snelgraveren-product-designer')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {expandedId === c.id && (
            <div className="pf-collection-manager__content">
              <div className="pf-clipart-grid">
                {(collectionItems[c.id] || []).map((item) => (
                  <div key={item.id} className="pf-clipart-grid__item">
                    <img src={item.svg_url} alt={item.name} title={item.name} />
                    <button
                      type="button"
                      className="pf-clipart-grid__remove"
                      onClick={() => handleDeleteItem(item.id, c.id)}
                      aria-label={`Delete ${item.name}`}
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
              <label className="button button-small pf-collection-manager__upload-btn">
                {isUploading ? __('Uploading\u2026', 'snelgraveren-product-designer') : __('Upload SVGs', 'snelgraveren-product-designer')}
                <input
                  type="file"
                  accept=".svg"
                  multiple
                  onChange={(e) => handleUpload(e, c.id)}
                  disabled={isUploading}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
          )}
        </div>
      ))}

      {/* Create new collection */}
      <div className="pf-collection-manager__new">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={__('New collection name', 'snelgraveren-product-designer')}
          className="pf-settings__input"
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        />
        <button
          type="button"
          className="button button-primary button-small"
          onClick={handleCreate}
          disabled={!newName.trim()}
        >
          {__('Create', 'snelgraveren-product-designer')}
        </button>
      </div>
    </div>
  );
}

export default function SettingsAssets({ globalConfig, update, clipartCollections, setClipartCollections }) {
  const [showCollectionManager, setShowCollectionManager] = useState(false);

  return (
    <>
      <h3 className="pf-settings__section-title">{__('Assets', 'snelgraveren-product-designer')}</h3>
      <p className="pf-settings__section-desc">{__('Manage clip art libraries available to customers.', 'snelgraveren-product-designer')}</p>

      <fieldset className="pf-settings__fieldset">
        <legend>{__('Clip Art', 'snelgraveren-product-designer')}</legend>
        <label className="pf-settings__check">
          <input type="checkbox" checked={globalConfig.clipart_enabled || false}
            onChange={(e) => update('clipart_enabled', e.target.checked)} />
          {__('Enable clip art library', 'snelgraveren-product-designer')}
        </label>
        {globalConfig.clipart_enabled && (
          <>
            <label className="pf-settings__check">
              <input type="checkbox" checked={globalConfig.clipart_recolor !== false}
                onChange={(e) => update('clipart_recolor', e.target.checked)} />
              {__('Allow recoloring clip art', 'snelgraveren-product-designer')}
            </label>

            {clipartCollections.length > 0 && (
              <div className="pf-settings__clipart-collections">
                <span className="pf-settings__label">{__('Available collections:', 'snelgraveren-product-designer')}</span>
                {clipartCollections.map((c) => {
                  const allowed = globalConfig.allowed_clipart_collections || [];
                  const isSelected = allowed.length === 0 || allowed.includes(c.id);
                  return (
                    <label key={c.id} className="pf-settings__check">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          let next;
                          if (e.target.checked) {
                            if (allowed.length === 0) {
                              next = clipartCollections.map((col) => col.id);
                            } else {
                              next = [...allowed, c.id];
                            }
                            if (next.length === clipartCollections.length) {
                              next = [];
                            }
                          } else {
                            if (allowed.length === 0) {
                              next = clipartCollections.filter((col) => col.id !== c.id).map((col) => col.id);
                            } else {
                              next = allowed.filter((id) => id !== c.id);
                            }
                          }
                          update('allowed_clipart_collections', next);
                        }}
                      />
                      {c.name} ({c.item_count})
                    </label>
                  );
                })}
              </div>
            )}

            <p className="pf-settings__note" style={{ marginTop: 8 }}>
              {__('Manage collections and upload SVGs from the', 'snelgraveren-product-designer')}{' '}
              <a href="?page=sgpd-clipart">{__('Clipart', 'snelgraveren-product-designer')}</a>{' '}
              {__('admin page.', 'snelgraveren-product-designer')}
            </p>
          </>
        )}
      </fieldset>

      <fieldset className="pf-settings__fieldset">
        <legend>{__('Design Templates', 'snelgraveren-product-designer')}</legend>
        <label className="pf-settings__check">
          <input type="checkbox" checked={globalConfig.design_templates_enabled || false}
            onChange={(e) => update('design_templates_enabled', e.target.checked)} />
          {__('Enable design templates', 'snelgraveren-product-designer')}
        </label>
        {globalConfig.design_templates_enabled && (
          <p className="pf-settings__hint">
            {__('Manage design templates from the Product Designer \u2192 Design Templates admin page.', 'snelgraveren-product-designer')}
          </p>
        )}
      </fieldset>
    </>
  );
}
