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
    <div className="pd-sidebar__tab-content">
      <h3 className="pd-sidebar__heading">{__('Add Element', 'product-designer')}</h3>
      <div className="pd-add-tools">
        {isTypeAllowed('text') && (
          <button
            type="button"
            className={`pd-add-tools__btn${activeTool === 'add-text' ? ' pd-add-tools__btn--active' : ''}`}
            onClick={() => handleToolClick('add-text')}
            aria-label={__('Add text element', 'product-designer')}
            title={__('Add text', 'product-designer')}
          >
            {__('Text', 'product-designer')}
          </button>
        )}
        {isTypeAllowed('image') && (
          <button
            type="button"
            className={`pd-add-tools__btn${activeTool === 'add-image' ? ' pd-add-tools__btn--active' : ''}`}
            onClick={() => handleToolClick('add-image')}
            aria-label={__('Add image element', 'product-designer')}
            title={__('Add image (jpg, png, webp)', 'product-designer')}
          >
            {__('Image', 'product-designer')}
          </button>
        )}
        {isTypeAllowed('svg') && (
          <button
            type="button"
            className={`pd-add-tools__btn${activeTool === 'add-svg' ? ' pd-add-tools__btn--active' : ''}`}
            onClick={() => handleToolClick('add-svg')}
            aria-label={__('Add SVG element', 'product-designer')}
            title={__('Add SVG', 'product-designer')}
          >
            {__('SVG', 'product-designer')}
          </button>
        )}
      </div>
    </div>
  );
}
