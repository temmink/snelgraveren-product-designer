import React, { useState } from 'react';
import { __ } from '@wordpress/i18n';
import useDesignerStore from '../../store/useDesignerStore';
import DesignTemplates from '../DesignTemplates';
import ClipartPicker from '../ClipartPicker';

/**
 * What a customer can put on the product.
 *
 * Two main choices — a text, or their own image — and the rest behind "More".
 * It used to be five equal buttons (Text, Image, SVG, Curved, Engrave): the
 * difference between "Image" and "SVG" is a file format, not something a
 * customer chooses, and the two special kinds of text are for the few who
 * come looking for them.
 */
export default function AddTab() {
  const { template, currentViewIndex, activeTool, setActiveTool, clipartCollections, addClipart } = useDesignerStore();
  const [openClipartCollection, setOpenClipartCollection] = useState(null);

  const currentView = template?.views?.[currentViewIndex];
  const zones = currentView?.zones_config || [];
  const globalConfig = template?.global_config || {};

  const isTypeAllowed = (type) => {
    if (zones.length === 0) return true;
    return zones.some((z) => (z.allowed_types || []).includes(type));
  };

  const textAllowed  = isTypeAllowed('text');
  const photoAllowed = isTypeAllowed('image') && !globalConfig.vector_only;
  const svgAllowed   = isTypeAllowed('svg');
  const uploadAllowed = photoAllowed || svgAllowed;
  const curvedAllowed = textAllowed && !!globalConfig.curved_text_enabled;

  const toggleTool = (tool) => setActiveTool(activeTool === tool ? 'select' : tool);

  const handleClipartSelect = (svgUrl) => {
    addClipart?.(svgUrl);
    setOpenClipartCollection(null);
  };

  const showClipart = globalConfig.clipart_enabled && svgAllowed && clipartCollections.length > 0;
  const placing = activeTool === 'add-curved-text' || activeTool === 'add-engraving-text';

  const uploadHint = photoAllowed && svgAllowed
    ? __('Photo or logo: JPG, PNG, WebP or SVG', 'snelgraveren-product-designer')
    : photoAllowed
      ? __('Photo: JPG, PNG or WebP', 'snelgraveren-product-designer')
      : __('Vector artwork only: SVG', 'snelgraveren-product-designer');

  return (
    <div className="pf-sidebar__tab-content">
      <div className="pf-add-tools">
        {textAllowed && (
          <button
            type="button"
            className={`pf-add-tools__btn pf-add-tools__btn--main${activeTool === 'add-text' ? ' pf-add-tools__btn--active' : ''}`}
            onClick={() => toggleTool('add-text')}
          >
            <span className="pf-add-tools__icon" aria-hidden="true">T</span>
            <span className="pf-add-tools__label">{__('Add text', 'snelgraveren-product-designer')}</span>
          </button>
        )}
        {uploadAllowed && (
          <label htmlFor="pf-upload-file" className="pf-add-tools__btn pf-add-tools__btn--main" role="button" tabIndex={0}>
            <span className="pf-add-tools__icon" aria-hidden="true">↑</span>
            <span className="pf-add-tools__label">
              {__('Add image', 'snelgraveren-product-designer')}
              <small>{uploadHint}</small>
            </span>
          </label>
        )}
      </div>

      {textAllowed && (
        <details className="pf-add-more" open={placing || undefined}>
          <summary>{__('More kinds of text', 'snelgraveren-product-designer')}</summary>
          <div className="pf-add-tools">
            {curvedAllowed && (
              <button
                type="button"
                className={`pf-add-tools__btn${activeTool === 'add-curved-text' ? ' pf-add-tools__btn--active' : ''}`}
                onClick={() => toggleTool('add-curved-text')}
              >
                {__('Curved text', 'snelgraveren-product-designer')}
              </button>
            )}
            <button
              type="button"
              className={`pf-add-tools__btn${activeTool === 'add-engraving-text' ? ' pf-add-tools__btn--active' : ''}`}
              onClick={() => toggleTool('add-engraving-text')}
              title={__('Add engraving text (single-line font)', 'snelgraveren-product-designer')}
            >
              {__('Engraving text', 'snelgraveren-product-designer')}
            </button>
          </div>
          {placing && (
            // These two are placed where the customer clicks. Without this
            // line the button looked like it had done nothing.
            <p className="pf-add-more__hint" role="status">
              {__('Now click on the product where the text should go.', 'snelgraveren-product-designer')}
            </p>
          )}
        </details>
      )}

      {globalConfig.design_templates_enabled && (
        <DesignTemplates templateId={template?.id} allowedIds={globalConfig.allowed_design_templates} />
      )}

      {showClipart && (
        <div className="pf-clipart-section">
          <h3 className="pf-sidebar__heading">{__('Clip Art', 'snelgraveren-product-designer')}</h3>
          <div className="pf-clipart-categories">
            {clipartCollections.map((collection) => (
              <button
                key={collection.id}
                type="button"
                className="pf-clipart-category"
                onClick={() => setOpenClipartCollection(collection)}
              >
                <span className="pf-clipart-category__thumbs" aria-hidden="true">
                  {(collection.items || []).slice(0, 3).map((item) => (
                    <img key={item.id} src={item.svg_url} alt="" />
                  ))}
                </span>
                <span className="pf-clipart-category__name">{collection.name}</span>
                <span className="pf-clipart-category__count">{(collection.items || []).length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {openClipartCollection && (
        <ClipartPicker
          collection={openClipartCollection}
          onSelect={handleClipartSelect}
          onClose={() => setOpenClipartCollection(null)}
        />
      )}
    </div>
  );
}
