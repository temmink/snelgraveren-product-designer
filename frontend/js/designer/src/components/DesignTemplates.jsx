import React, { useState, useEffect } from 'react';
import { __ } from '@wordpress/i18n';
import { fetchDesignTemplates, fetchDesignTemplateDetail } from '../api/designerApi';
import useDesignerStore from '../store/useDesignerStore';
import * as fabric from 'fabric';

export default function DesignTemplates({ templateId, allowedIds }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('');
  const { fabricCanvasRef, currentViewIndex, snapshotView } = useDesignerStore();

  useEffect(() => {
    fetchDesignTemplates(templateId, allowedIds).then((data) => {
      setTemplates(data);
      setLoading(false);
    });
  }, [templateId]);

  const applyTemplate = async (dt) => {
    const canvas = fabricCanvasRef;
    if (!canvas) return;

    if (!confirm(__('Apply this template? This will replace your current design elements.', 'snelgraveren-product-designer'))) {
      return;
    }

    // Fetch full template detail with views
    const detail = await fetchDesignTemplateDetail(dt.id);
    if (!detail) return;

    // Remove user-placed objects (keep zones, overlays, backgrounds)
    const userObjects = canvas.getObjects().filter(
      (o) => !o.data?.isZone && !o.data?.isZoneOverlay && !o.data?.isBackground
    );
    userObjects.forEach((o) => canvas.remove(o));

    // Find the view JSON for the current view
    const viewData = detail.views?.find((v) => v.view_index === currentViewIndex);
    if (viewData?.canvas_json) {
      const parsed = typeof viewData.canvas_json === 'string'
        ? JSON.parse(viewData.canvas_json)
        : viewData.canvas_json;

      if (parsed.objects) {
        const objects = await fabric.util.enlivenObjects(parsed.objects);
        objects.forEach((obj) => canvas.add(obj));
      }
    }

    canvas.discardActiveObject();
    canvas.renderAll();
    snapshotView(currentViewIndex, canvas.toJSON(['data']));
  };

  if (loading) {
    return <p style={{ color: '#999', fontSize: 12 }}>{__('Loading templates...', 'snelgraveren-product-designer')}</p>;
  }

  if (templates.length === 0) {
    return null;
  }

  const categories = [...new Set(templates.map((t) => t.category || 'Uncategorized'))];
  const filtered = categoryFilter
    ? templates.filter((t) => (t.category || 'Uncategorized') === categoryFilter)
    : templates;

  return (
    <div className="pf-design-templates">
      <div className="pf-add-tools__heading">{__('Design Templates', 'snelgraveren-product-designer')}</div>
      {categories.length > 1 && (
        <select
          className="pf-design-templates__category-filter"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">{__('All categories', 'snelgraveren-product-designer')}</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      )}
      <div className="pf-design-templates__grid">
        {filtered.map((dt) => (
          <button
            key={dt.id}
            type="button"
            className="pf-design-templates__item"
            onClick={() => applyTemplate(dt)}
            title={dt.name}
            style={{ color: '#333' }}
          >
            {dt.thumbnail_url ? (
              <img src={dt.thumbnail_url} alt={dt.name} />
            ) : (
              <div className="pf-design-templates__placeholder">{dt.name}</div>
            )}
            <span className="pf-design-templates__name">{dt.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
