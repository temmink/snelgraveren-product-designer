import React from 'react';
import { __ } from '@wordpress/i18n';
import useDesignerStore from '../../store/useDesignerStore';

export default function AddTab() {
  const { template, currentViewIndex, activeTool, setActiveTool, triggerFileUpload } = useDesignerStore();

  const currentView = template?.views?.[currentViewIndex];
  const zones = currentView?.zones_config || [];

  // Check if any zone allows a given type (or there are no zones at all)
  const isTypeAllowed = (type) => {
    if (zones.length === 0) return true;
    return zones.some((z) => (z.allowed_types || []).includes(type));
  };

  const handleToolClick = (tool) => {
    if (activeTool === tool) {
      setActiveTool('select');
    } else if (tool === 'add-image' || tool === 'add-svg') {
      const elementType = tool === 'add-image' ? 'image' : 'svg';
      triggerFileUpload?.(elementType);
    } else {
      setActiveTool(tool);
    }
  };

  return (
    <div className="pf-sidebar__tab-content">
      <h3 className="pf-sidebar__heading">{__('Add Element', 'productforge')}</h3>
      <div className="pf-add-tools">
        {isTypeAllowed('text') && (
          <button
            type="button"
            className={`pf-add-tools__btn${activeTool === 'add-text' ? ' pf-add-tools__btn--active' : ''}`}
            onClick={() => handleToolClick('add-text')}
            aria-label={__('Add text element', 'productforge')}
            title={__('Add text', 'productforge')}
          >
            {__('Text', 'productforge')}
          </button>
        )}
        {isTypeAllowed('image') && (
          <button
            type="button"
            className={`pf-add-tools__btn${activeTool === 'add-image' ? ' pf-add-tools__btn--active' : ''}`}
            onClick={() => handleToolClick('add-image')}
            aria-label={__('Add image element', 'productforge')}
            title={__('Add image (jpg, png, webp)', 'productforge')}
          >
            {__('Image', 'productforge')}
          </button>
        )}
        {isTypeAllowed('svg') && (
          <button
            type="button"
            className={`pf-add-tools__btn${activeTool === 'add-svg' ? ' pf-add-tools__btn--active' : ''}`}
            onClick={() => handleToolClick('add-svg')}
            aria-label={__('Add SVG element', 'productforge')}
            title={__('Add SVG', 'productforge')}
          >
            {__('SVG', 'productforge')}
          </button>
        )}
      </div>
    </div>
  );
}
