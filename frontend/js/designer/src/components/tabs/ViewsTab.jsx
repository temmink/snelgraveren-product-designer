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
    <div className="pf-sidebar__tab-content">
      <h3 className="pf-sidebar__heading">{__('Views', 'productforge')}</h3>
      <div className="pf-views" role="tablist" aria-label={__('Product views', 'productforge')}>
        {views.map((view, i) => (
          <button
            type="button"
            role="tab"
            key={view.id || i}
            aria-selected={i === currentViewIndex}
            className={`pf-views__btn${i === currentViewIndex ? ' pf-views__btn--active' : ''}`}
            onClick={() => handleSwitch(i)}
          >
            {view.name || sprintf(__('View %d', 'productforge'), i + 1)}
          </button>
        ))}
      </div>
    </div>
  );
}
