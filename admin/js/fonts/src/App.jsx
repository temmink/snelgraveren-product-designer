import React, { useState, useEffect, useCallback } from 'react';
import { __ } from '@wordpress/i18n';
// The font catalogue and loader helpers are owned by the template builder;
// import them rather than copying (shared-module rule — a copy WILL drift).
import { AVAILABLE_FONTS, mergeCustomFonts, loadCustomFonts, loadGoogleFonts } from '../../template-builder/src/utils/fonts';

const { restUrl, nonce, isPremium, upgradeUrl } = window.sgpdFonts || {};

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

function uploadFontFile(file, family) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('family', family);
  return fetch(`${restUrl}pf/v1/fonts`, {
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
    <div className="pf-fa__upgrade">
      <span className="pf-fa__upgrade-badge">PRO</span>
      <p>{__('Font management requires Snelgraveren Product Designer Pro.', 'snelgraveren-product-designer')}</p>
      {upgradeUrl && (
        <a href={upgradeUrl} className="button button-primary">{__('Upgrade Now', 'snelgraveren-product-designer')}</a>
      )}
    </div>
  );
}

/* ── Group Card ────────────────────────────────────────────────────────── */
function GroupCard({ group, allFonts, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  // Local copy so checkbox toggles feel instant; the PUT below is the truth.
  const [families, setFamilies] = useState(group.families);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => { setFamilies(group.families); }, [group.families]);

  const saveFamilies = async (next) => {
    setFamilies(next);
    setSaveError(null);
    try {
      await api(`/font-groups/${group.id}`, {
        method: 'PUT',
        body: JSON.stringify({ families: next }),
      });
      onRefresh();
    } catch (err) {
      setSaveError(err.message);
      setFamilies(group.families);
    }
  };

  const toggleFamily = (family) => {
    const next = families.includes(family)
      ? families.filter((f) => f !== family)
      : [...families, family];
    saveFamilies(next);
  };

  const handleRename = async () => {
    if (!editName.trim()) return;
    try {
      await api(`/font-groups/${group.id}`, {
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
    if (!confirm(__('Delete group "%s"? Templates using it keep their other fonts.', 'snelgraveren-product-designer').replace('%s', group.name))) return;
    try {
      await api(`/font-groups/${group.id}`, { method: 'DELETE' });
      onRefresh();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="pf-fa__card">
      <div className="pf-fa__card-header" onClick={() => setExpanded(!expanded)}>
        <span className={`pf-fa__chevron${expanded ? ' pf-fa__chevron--open' : ''}`}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 3l4 4-4 4" />
          </svg>
        </span>

        {editing ? (
          <input
            className="pf-fa__rename-input"
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setEditing(false); }}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span className="pf-fa__card-name">{group.name}</span>
        )}

        <span className="pf-fa__card-count">{families.length}</span>

        <span className="pf-fa__card-actions" onClick={(e) => e.stopPropagation()}>
          {editing ? (
            <>
              <button className="button button-small button-primary" onClick={handleRename}>
                {__('Save', 'snelgraveren-product-designer')}
              </button>
              <button className="button button-small" onClick={() => setEditing(false)}>
                {__('Cancel', 'snelgraveren-product-designer')}
              </button>
            </>
          ) : (
            <>
              <button className="button button-small" onClick={() => { setEditName(group.name); setEditing(true); }}>
                {__('Rename', 'snelgraveren-product-designer')}
              </button>
              <button className="button button-small pf-fa__btn-danger" onClick={handleDelete}>
                {__('Delete', 'snelgraveren-product-designer')}
              </button>
            </>
          )}
        </span>
      </div>

      {expanded && (
        <div className="pf-fa__card-body">
          {saveError && <p className="pf-fa__error">{saveError}</p>}
          <div className="pf-fa__font-grid">
            {allFonts.map((font) => (
              <label key={font.family} className="pf-fa__font-check">
                <input
                  type="checkbox"
                  checked={families.includes(font.family)}
                  onChange={() => toggleFamily(font.family)}
                />
                <span className="pf-fa__font-sample" style={{ fontFamily: `'${font.family}'` }}>
                  {font.family}
                </span>
                <span className="pf-fa__font-cat">{font.category}</span>
              </label>
            ))}
          </div>
          {/* A group member whose font was deleted (or a family from an import)
              no longer appears in the catalogue — keep it removable. */}
          {families.filter((f) => !allFonts.some((font) => font.family === f)).map((family) => (
            <label key={family} className="pf-fa__font-check pf-fa__font-check--missing">
              <input type="checkbox" checked onChange={() => toggleFamily(family)} />
              <span className="pf-fa__font-sample">{family}</span>
              <span className="pf-fa__font-cat">{__('unknown font', 'snelgraveren-product-designer')}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Custom font upload + list ─────────────────────────────────────────── */
function CustomFonts({ customFonts, onChanged }) {
  const [uploadFamily, setUploadFamily] = useState('');
  const [pendingFile, setPendingFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);

  const deriveFamilyName = (filename) => {
    const base = filename.replace(/\.(woff2?|ttf)$/i, '');
    return base.replace(/[-_](Regular|Bold|Italic|Light|Medium|SemiBold|ExtraBold|Thin|Black|BoldItalic)$/i, '');
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setUploadFamily(deriveFamilyName(file.name));
    e.target.value = '';
  };

  const handleUpload = async () => {
    if (!pendingFile || !uploadFamily.trim()) return;
    setIsUploading(true);
    setError(null);
    try {
      await uploadFontFile(pendingFile, uploadFamily.trim());
      setUploadFamily('');
      setPendingFile(null);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteFamily = async (family) => {
    if (!confirm(__('Delete font "%s"? It is also removed from every group.', 'snelgraveren-product-designer').replace('%s', family))) return;
    setError(null);
    try {
      await api(`/fonts/family/${encodeURIComponent(family)}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="pf-fa__custom">
      <h2 className="pf-fa__section-title">{__('Custom Fonts', 'snelgraveren-product-designer')}</h2>

      {!pendingFile ? (
        <label className="button pf-fa__upload-btn">
          {__('Upload Font File', 'snelgraveren-product-designer')}
          <input
            type="file"
            accept=".woff2,.woff,.ttf"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
        </label>
      ) : (
        <div className="pf-fa__upload-row">
          <input
            type="text"
            value={uploadFamily}
            onChange={(e) => setUploadFamily(e.target.value)}
            placeholder={__('Font family name', 'snelgraveren-product-designer')}
          />
          <span className="pf-fa__note">{pendingFile.name}</span>
          <button
            className="button button-primary"
            onClick={handleUpload}
            disabled={isUploading || !uploadFamily.trim()}
          >
            {isUploading ? __('Uploading…', 'snelgraveren-product-designer') : __('Upload', 'snelgraveren-product-designer')}
          </button>
          <button className="button" onClick={() => { setPendingFile(null); setUploadFamily(''); }} disabled={isUploading}>
            {__('Cancel', 'snelgraveren-product-designer')}
          </button>
        </div>
      )}
      <p className="pf-fa__note">
        {__('Supported formats: .woff2, .woff, .ttf. You can upload multiple files for the same family name (e.g. regular + bold).', 'snelgraveren-product-designer')}
      </p>
      {error && <p className="pf-fa__error">{error}</p>}

      {customFonts.length > 0 && (
        <div className="pf-fa__custom-list">
          {customFonts.map((font) => (
            <div key={font.family} className="pf-fa__custom-item">
              <span className="pf-fa__font-sample" style={{ fontFamily: `'${font.family}'` }}>{font.family}</span>
              <span className="pf-fa__note">
                ({font.files.length} {font.files.length === 1 ? 'file' : 'files'})
              </span>
              <button
                className="button button-small pf-fa__btn-danger"
                onClick={() => handleDeleteFamily(font.family)}
              >
                {__('Delete', 'snelgraveren-product-designer')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main App ──────────────────────────────────────────────────────────── */
export default function App() {
  const [groups, setGroups] = useState([]);
  const [customFonts, setCustomFonts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const loadAll = useCallback(async () => {
    try {
      const [groupData, fontData] = await Promise.all([
        api('/font-groups'),
        api('/fonts'),
      ]);
      setGroups(groupData);
      setCustomFonts(fontData);
      loadCustomFonts(fontData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Load every Google font in the catalogue once, so group checkboxes can
  // preview each family in its own face.
  useEffect(() => {
    const googleFamilies = AVAILABLE_FONTS.filter((f) => f.source === 'google').map((f) => f.family);
    loadGoogleFonts(googleFamilies, `${restUrl}pf/v1`);
  }, []);

  if (!isPremium) return <UpgradePrompt />;

  const allFonts = mergeCustomFonts(customFonts);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api('/font-groups', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim() }),
      });
      setNewName('');
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="pf-fa">
      {error && <div className="notice notice-error"><p>{error}</p></div>}

      <h2 className="pf-fa__section-title">{__('Font Groups', 'snelgraveren-product-designer')}</h2>
      <p className="pf-fa__intro">
        {__('Select a group in the template builder to allow all its fonts at once. Adding a font to a group later automatically updates every template using that group.', 'snelgraveren-product-designer')}
      </p>

      <div className="pf-fa__create-bar">
        <input
          type="text"
          className="pf-fa__create-input"
          placeholder={__('New group name...', 'snelgraveren-product-designer')}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
        />
        <button
          className="button button-primary"
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
        >
          {creating ? __('Creating...', 'snelgraveren-product-designer') : __('Create Group', 'snelgraveren-product-designer')}
        </button>
      </div>

      {loading ? (
        <p>{__('Loading...', 'snelgraveren-product-designer')}</p>
      ) : groups.length === 0 ? (
        <div className="pf-fa__empty">
          <p>{__('No font groups yet. Create one and tick the fonts that belong in it.', 'snelgraveren-product-designer')}</p>
        </div>
      ) : (
        <div className="pf-fa__list">
          {groups.map((g) => (
            <GroupCard key={g.id} group={g} allFonts={allFonts} onRefresh={loadAll} />
          ))}
        </div>
      )}

      <CustomFonts customFonts={customFonts} onChanged={loadAll} />
    </div>
  );
}
