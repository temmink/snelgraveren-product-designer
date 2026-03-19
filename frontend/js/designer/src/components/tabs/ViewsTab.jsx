import React, { useCallback } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import useDesignerStore from '../../store/useDesignerStore';

export default function ViewsTab() {
  const { template, currentViewIndex, setCurrentViewIndex } = useDesignerStore();

  const views = template?.views || [];

  const handleSwitch = useCallback((index) => {
    if (index === currentViewIndex) return;
    setCurrentViewIndex(index);
  }, [currentViewIndex, setCurrentViewIndex]);

  return (
    <div className="pd-sidebar__tab-content">
      <h3 className="pd-sidebar__heading">{__('Views', 'product-designer')}</h3>
      <div className="pd-views" role="tablist" aria-label={__('Product views', 'product-designer')}>
        {views.map((view, i) => (
          <button
            type="button"
            role="tab"
            key={view.id || i}
            aria-selected={i === currentViewIndex}
            className={`pd-views__btn${i === currentViewIndex ? ' pd-views__btn--active' : ''}`}
            onClick={() => handleSwitch(i)}
          >
            {view.name || sprintf(__('View %d', 'product-designer'), i + 1)}
          </button>
        ))}
      </div>
    </div>
  );
}
