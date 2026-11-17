import React from 'react';
import { __ } from '@wordpress/i18n';
import useDesignerStore from '../store/useDesignerStore';
import { viewLabel } from '../utils/viewLabel';

/**
 * The sides of the product (front / back), always visible above the tools.
 *
 * It used to be a tab — the one the designer OPENED on, so the first thing a
 * customer saw was a single button naming the side they were already looking
 * at, and nothing about what to do. A product with one side shows nothing
 * here at all.
 */
export default function ViewSwitcher() {
  const { template, currentViewIndex, setCurrentViewIndex } = useDesignerStore();
  const views = template?.views || [];
  if (views.length < 2) return null;

  return (
    <div className="pf-views" role="tablist" aria-label={__('Product views', 'snelgraveren-product-designer')}>
      {views.map((view, i) => (
        <button
          type="button"
          role="tab"
          key={view.id || i}
          aria-selected={i === currentViewIndex}
          className={`pf-views__btn${i === currentViewIndex ? ' pf-views__btn--active' : ''}`}
          onClick={() => { if (i !== currentViewIndex) setCurrentViewIndex(i); }}
        >
          {viewLabel(view, i)}
        </button>
      ))}
    </div>
  );
}
