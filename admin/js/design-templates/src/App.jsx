import React, { useState, useEffect, useCallback } from 'react';
import { __ } from '@wordpress/i18n';

const { restUrl, nonce, templates: templatesList } = window.pfDesignTemplates || {};

function api(path, opts = {}) {
  return fetch(`${restUrl}pf/v1${path}`, {
    headers: {
      'X-WP-Nonce': nonce,
      'Content-Type': 'application/json',
    },
    ...opts,
  }).then((r) => {
    if (r.status === 204) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
}

function DesignTemplateForm({ item, templates, onSave, onCancel }) {
  const [name, setName] = useState(item?.name || '');
  const [category, setCategory] = useState(item?.category || '');
  const [templateId, setTemplateId] = useState(item?.template_id || '');
  const [status, setStatus] = useState(item?.status || 'active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(__('Name is required.', 'productforge'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        category: category.trim(),
        template_id: templateId ? parseInt(templateId, 10) : null,
        status,
      };
      if (item?.id) {
        await api(`/design-templates/${item.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api('/design-templates', { method: 'POST', body: JSON.stringify(body) });
      }
      onSave();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 500, marginBottom: 20 }}>
      <h2>{item?.id ? __('Edit Design Template', 'productforge') : __('New Design Template', 'productforge')}</h2>
      {error && <div className="notice notice-error"><p>{error}</p></div>}
      <table className="form-table">
        <tbody>
          <tr>
            <th><label>{__('Name', 'productforge')}</label></th>
            <td><input type="text" className="regular-text" value={name} onChange={(e) => setName(e.target.value)} /></td>
          </tr>
          <tr>
            <th><label>{__('Category', 'productforge')}</label></th>
            <td><input type="text" className="regular-text" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={__('e.g. T-Shirt, Mug', 'productforge')} /></td>
          </tr>
          <tr>
            <th><label>{__('Product Template', 'productforge')}</label></th>
            <td>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">{__('Any template', 'productforge')}</option>
                {(templates || []).map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            </td>
          </tr>
          <tr>
            <th><label>{__('Status', 'productforge')}</label></th>
            <td>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">{__('Active', 'productforge')}</option>
                <option value="inactive">{__('Inactive', 'productforge')}</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        <button type="submit" className="button button-primary" disabled={saving}>
          {saving ? __('Saving...', 'productforge') : __('Save', 'productforge')}
        </button>
        {' '}
        <button type="button" className="button" onClick={onCancel}>{__('Cancel', 'productforge')}</button>
      </p>
    </form>
  );
}

function ExportImport({ onImported }) {
  const [importing, setImporting] = useState(false);

  const handleExport = async (id, name) => {
    try {
      const data = await api(`/design-templates/${id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `design-template-${name.toLowerCase().replace(/\s+/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      await api('/design-templates/import', { method: 'POST', body: text });
      onImported();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  return { handleExport, handleImport, importing };
}

export default function App() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null = list, {} = new, {id:...} = edit
  const [templates, setTemplates] = useState(templatesList || []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const active = await api('/design-templates?status=active');
      const inactive = await api('/design-templates?status=inactive');
      setItems([...active, ...inactive]);
    } catch (err) {
      console.error('Failed to load design templates:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

  const handleDelete = async (id, name) => {
    if (!confirm(__('Delete design template "%s"?', 'productforge').replace('%s', name))) return;
    try {
      await api(`/design-templates/${id}`, { method: 'DELETE' });
      loadItems();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const { handleExport, handleImport, importing } = ExportImport({ onImported: () => { loadItems(); } });

  const templateName = (id) => {
    const t = templates.find((t) => t.id === id);
    return t ? t.title : '—';
  };

  if (editing !== null) {
    return (
      <DesignTemplateForm
        item={editing}
        templates={templates}
        onSave={() => { setEditing(null); loadItems(); }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="button button-primary" onClick={() => setEditing({})}>
          {__('Add New', 'productforge')}
        </button>
        <label className="button" style={{ position: 'relative', cursor: 'pointer' }}>
          {importing ? __('Importing...', 'productforge') : __('Import JSON', 'productforge')}
          <input type="file" accept=".json" onChange={handleImport} style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', left: 0, top: 0, cursor: 'pointer' }} />
        </label>
      </div>

      {loading ? (
        <p>{__('Loading...', 'productforge')}</p>
      ) : items.length === 0 ? (
        <p>{__('No design templates yet. Create one to get started.', 'productforge')}</p>
      ) : (
        <table className="wp-list-table widefat fixed striped">
          <thead>
            <tr>
              <th style={{ width: '25%' }}>{__('Name', 'productforge')}</th>
              <th style={{ width: '15%' }}>{__('Category', 'productforge')}</th>
              <th style={{ width: '20%' }}>{__('Product Template', 'productforge')}</th>
              <th style={{ width: '10%' }}>{__('Views', 'productforge')}</th>
              <th style={{ width: '10%' }}>{__('Status', 'productforge')}</th>
              <th style={{ width: '20%' }}>{__('Actions', 'productforge')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.name}</strong></td>
                <td>{item.category || '—'}</td>
                <td>{item.template_id ? templateName(parseInt(item.template_id, 10)) : __('Any', 'productforge')}</td>
                <td>{item.view_count ?? '—'}</td>
                <td>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: 3,
                    fontSize: 12,
                    background: item.status === 'active' ? '#dff0d8' : '#f2dede',
                    color: item.status === 'active' ? '#3c763d' : '#a94442',
                  }}>
                    {item.status === 'active' ? __('Active', 'productforge') : __('Inactive', 'productforge')}
                  </span>
                </td>
                <td>
                  <button className="button button-small" onClick={() => setEditing(item)}>
                    {__('Edit', 'productforge')}
                  </button>
                  {' '}
                  <button className="button button-small" onClick={() => handleExport(item.id, item.name)}>
                    {__('Export', 'productforge')}
                  </button>
                  {' '}
                  <button className="button button-small button-link-delete" onClick={() => handleDelete(item.id, item.name)}>
                    {__('Delete', 'productforge')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
