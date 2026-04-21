import React from 'react';
import { __ } from '@wordpress/i18n';
import useDesignerStore from '../../store/useDesignerStore';
import DesignTemplates from '../DesignTemplates';

export default function AddTab() {
  const { template, currentViewIndex, activeTool, setActiveTool, clipartCollections, addClipart } = useDesignerStore();

  const currentView = template?.views?.[currentViewIndex];
  const zones = currentView?.zones_config || [];
  const globalConfig = template?.global_config || {};

  const isTypeAllowed = (type) => {
    if (zones.length === 0) return true;
    return zones.some((z) => (z.allowed_types || []).includes(type));
  };

  const handleToolClick = (tool) => {
    if (activeTool === tool) {
      setActiveTool('select');
    } else {
      setActiveTool(tool);
    }
  };

  const handleClipartClick = (svgUrl) => {
    addClipart?.(svgUrl);
  };

  const showClipart = globalConfig.clipart_enabled && isTypeAllowed('svg') && clipartCollections.length > 0;

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
          <label
            htmlFor="pf-upload-image"
            className="pf-add-tools__btn"
            role="button"
            tabIndex={0}
            aria-label={__('Add image element', 'productforge')}
            title={__('Add image (jpg, png, webp)', 'productforge')}
          >
            {__('Image', 'productforge')}
          </label>
        )}
        {isTypeAllowed('svg') && (
          <label
            htmlFor="pf-upload-svg"
            className="pf-add-tools__btn"
            role="button"
            tabIndex={0}
            aria-label={__('Add SVG element', 'productforge')}
            title={__('Add SVG', 'productforge')}
          >
            {__('SVG', 'productforge')}
          </label>
        )}
        {globalConfig.curved_text_enabled && isTypeAllowed('text') && (
          <button
            type="button"
            className={`pf-add-tools__btn${activeTool === 'add-curved-text' ? ' pf-add-tools__btn--active' : ''}`}
            onClick={() => handleToolClick('add-curved-text')}
            aria-label={__('Add curved text element', 'productforge')}
            title={__('Add curved text', 'productforge')}
            style={{ color: activeTool === 'add-curved-text' ? '#2271b1' : '#333' }}
          >
            ⌒ {__('Curved', 'productforge')}
          </button>
        )}

        {isTypeAllowed('text') && (
          <button
            type="button"
            className={`pf-add-tools__btn${activeTool === 'add-engraving-text' ? ' pf-add-tools__btn--active' : ''}`}
            onClick={() => handleToolClick('add-engraving-text')}
            aria-label={__('Add engraving text element', 'productforge')}
            title={__('Add engraving text (single-line font)', 'productforge')}
            style={{ color: activeTool === 'add-engraving-text' ? '#2271b1' : '#333' }}
          >
            ✦ {__('Engrave', 'productforge')}
          </button>
        )}
      </div>

      {globalConfig.design_templates_enabled && (
        <DesignTemplates templateId={template?.id} allowedIds={globalConfig.allowed_design_templates} />
      )}

      {showClipart && (
        <div className="pf-clipart-section">
          <h3 className="pf-sidebar__heading">{__('Clip Art', 'productforge')}</h3>
          {clipartCollections.map((collection) => (
            <div key={collection.id} className="pf-clipart-collection">
              <h4 className="pf-clipart-collection__name">{collection.name}</h4>
              <div className="pf-clipart-collection__grid">
                {(collection.items || []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="pf-clipart-collection__item"
                    onClick={() => handleClipartClick(item.svg_url)}
                    title={item.name}
                    aria-label={item.name}
                  >
                    <img src={item.svg_url} alt={item.name} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
