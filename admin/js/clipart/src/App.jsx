import React, { useState, useEffect, useCallback, useRef } from 'react';
import { __ } from '@wordpress/i18n';

const { restUrl, nonce, isPremium, upgradeUrl } = window.pfClipart || {};

function api(path, opts = {}) {
  return fetch(`${restUrl}pf/v1${path}`, {
    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
    ...opts,
  }).then((r) => {
    if (r.status === 204) return null;
    if (!r.ok) return r.json().then((d) => { throw new Error(d.message || `HTTP ${r.status}`); });
    return r.json();
  });
}

function uploadFile(file, collectionId) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('collection_id', collectionId);
  return fetch(`${restUrl}pf/v1/clipart`, {
    method: 'POST',
    headers: { 'X-WP-Nonce': nonce },
    body: fd,
  }).then((r) => {
    if (!r.ok) return r.json().then((d) => { throw new Error(d.message || `HTTP ${r.status}`); });
    return r.json();
  });
}

/* ── Upgrade Prompt ────────────────────────────────────────────────────── */
function UpgradePrompt() {
  return (
    <div className="pf-ca__upgrade">
      <span className="pf-ca__upgrade-badge">PRO</span>
      <p>{__('Clipart management requires ProductForge Pro.', 'productforge')}</p>
      {upgradeUrl && (
        <a href={upgradeUrl} className="button button-primary">{__('Upgrade Now', 'productforge')}</a>
      )}
    </div>
  );
}

/* ── Drop Zone ─────────────────────────────────────────────────────────── */
function DropZone({ collectionId, onUploaded }) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const fileRef = useRef(null);

  const processFiles = async (files) => {
    const svgs = Array.from(files).filter((f) => f.name.toLowerCase().endsWith('.svg'));
    if (svgs.length === 0) return;

    setUploading(true);
    const results = [];
    for (let i = 0; i < svgs.length; i++) {
      setProgress(`${i + 1} / ${svgs.length}`);
      try {
        const item = await uploadFile(svgs[i], collectionId);
        results.push(item);
      } catch (err) {
        console.error(`Upload failed for ${svgs[i].name}:`, err);
      }
    }
    setUploading(false);
    setProgress('');
    if (results.length > 0) onUploaded(results);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    processFiles(e.dataTransfer.files);
  };

  return (
    <div
      className={`pf-ca__dropzone${dragOver ? ' pf-ca__dropzone--active' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {uploading ? (
        <span className="pf-ca__dropzone-text">
          {__('Uploading', 'productforge')} {progress}...
        </span>
      ) : (
        <>
          <span className="pf-ca__dropzone-text">
            {__('Drop SVG files here or', 'productforge')}{' '}
            <button type="button" className="pf-ca__dropzone-btn" onClick={() => fileRef.current?.click()}>
              {__('browse', 'productforge')}
            </button>
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".svg"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { processFiles(e.target.files); e.target.value = ''; }}
          />
        </>
      )}
    </div>
  );
}

/* ── Collection Card ───────────────────────────────────────────────────── */
function CollectionCard({ collection, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const loadItems = useCallback(async () => {
    try {
      const data = await api(`/clipart/collections/${collection.id}`);
      setItems(data.items || []);
    } catch (err) {
      console.error(err);
    }
  }, [collection.id]);

  const handleExpand = () => {
    if (!expanded && items === null) loadItems();
    setExpanded(!expanded);
    setSelected(new Set());
  };

  const handleRename = async () => {
    if (!editName.trim()) return;
    try {
      await api(`/clipart/collections/${collection.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editName.trim() }),
      });
      setEditing(false);
      onRefresh();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async () => {
    if (!confirm(__('Delete collection "%s" and all its items?', 'productforge').replace('%s', collection.name))) return;
    try {
      await api(`/clipart/collections/${collection.id}`, { method: 'DELETE' });
      onRefresh();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm(__('Delete %d selected items?', 'productforge').replace('%d', selected.size))) return;
    setDeleting(true);
    for (const id of selected) {
      try {
        await api(`/clipart/${id}`, { method: 'DELETE' });
      } catch (err) {
        console.error(err);
      }
    }
    setSelected(new Set());
    setDeleting(false);
    loadItems();
    onRefresh();
  };

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!items) return;
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  };

  const handleUploaded = (newItems) => {
    setItems((prev) => [...(prev || []), ...newItems]);
    onRefresh();
  };

  return (
    <div className="pf-ca__card">
      <div className="pf-ca__card-header" onClick={handleExpand}>
        <span className={`pf-ca__chevron${expanded ? ' pf-ca__chevron--open' : ''}`}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 3l4 4-4 4" />
          </svg>
        </span>

        {editing ? (
          <input
            className="pf-ca__rename-input"
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setEditing(false); }}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span className="pf-ca__card-name">{collection.name}</span>
        )}

        <span className="pf-ca__card-count">{collection.item_count}</span>

        <span className="pf-ca__card-actions" onClick={(e) => e.stopPropagation()}>
          {editing ? (
            <>
              <button className="button button-small button-primary" onClick={handleRename}>
                {__('Save', 'productforge')}
              </button>
              <button className="button button-small" onClick={() => setEditing(false)}>
                {__('Cancel', 'productforge')}
              </button>
            </>
          ) : (
            <>
              <button className="button button-small" onClick={() => { setEditName(collection.name); setEditing(true); }}>
                {__('Rename', 'productforge')}
              </button>
              <button className="button button-small pf-ca__btn-danger" onClick={handleDelete}>
                {__('Delete', 'productforge')}
              </button>
            </>
          )}
        </span>
      </div>

      {expanded && (
        <div className="pf-ca__card-body">
          {items === null ? (
            <p className="pf-ca__loading">{__('Loading...', 'productforge')}</p>
          ) : (
            <>
              {items.length > 0 && (
                <div className="pf-ca__bulk-bar">
                  <label className="pf-ca__select-all">
                    <input
                      type="checkbox"
                      checked={items.length > 0 && selected.size === items.length}
                      onChange={toggleSelectAll}
                    />
                    {__('Select All', 'productforge')}
                  </label>
                  {selected.size > 0 && (
                    <button
                      className="button button-small pf-ca__btn-danger"
                      onClick={handleDeleteSelected}
                      disabled={deleting}
                    >
                      {deleting
                        ? __('Deleting...', 'productforge')
                        : __('Delete Selected', 'productforge') + ` (${selected.size})`}
                    </button>
                  )}
                </div>
              )}

              <div className="pf-ca__grid">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className={`pf-ca__tile${selected.has(item.id) ? ' pf-ca__tile--selected' : ''}`}
                    onClick={() => toggleSelect(item.id)}
                    title={item.name}
                  >
                    <img src={item.svg_url} alt={item.name} />
                    <input
                      type="checkbox"
                      className="pf-ca__tile-check"
                      checked={selected.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                ))}
              </div>

              <DropZone collectionId={collection.id} onUploaded={handleUploaded} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main App ──────────────────────────────────────────────────────────── */
export default function App() {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const loadCollections = useCallback(async () => {
    try {
      const data = await api('/clipart/collections');
      setCollections(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCollections(); }, [loadCollections]);

  if (!isPremium) return <UpgradePrompt />;

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api('/clipart/collections', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim() }),
      });
      setNewName('');
      loadCollections();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="pf-ca">
      {error && <div className="notice notice-error"><p>{error}</p></div>}

      <div className="pf-ca__create-bar">
        <input
          type="text"
          className="pf-ca__create-input"
          placeholder={__('New collection name...', 'productforge')}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
        />
        <button
          className="button button-primary"
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
        >
          {creating ? __('Creating...', 'productforge') : __('Create Collection', 'productforge')}
        </button>
      </div>

      {loading ? (
        <p>{__('Loading collections...', 'productforge')}</p>
      ) : collections.length === 0 ? (
        <div className="pf-ca__empty">
          <p>{__('No clip art collections yet. Create one to get started.', 'productforge')}</p>
        </div>
      ) : (
        <div className="pf-ca__list">
          {collections.map((c) => (
            <CollectionCard key={c.id} collection={c} onRefresh={loadCollections} />
          ))}
        </div>
      )}
    </div>
  );
}
