import React from 'react';
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
      <h3 className="pd-sidebar__heading">Add Element</h3>
      <div className="pd-add-tools">
        <button
          className={`pd-add-tools__btn${activeTool === 'add-text' ? ' pd-add-tools__btn--active' : ''}`}
          disabled={!isTypeAllowed('text')}
          onClick={() => handleToolClick('add-text')}
          title={!isTypeAllowed('text') ? 'Text not allowed on this view' : 'Add text'}
        >
          Text
        </button>
        <button
          className={`pd-add-tools__btn${activeTool === 'add-image' ? ' pd-add-tools__btn--active' : ''}`}
          disabled={!isTypeAllowed('image')}
          onClick={() => handleToolClick('add-image')}
          title={!isTypeAllowed('image') ? 'Images not allowed on this view' : 'Add image (jpg, png, webp)'}
        >
          Image
        </button>
        <button
          className={`pd-add-tools__btn${activeTool === 'add-svg' ? ' pd-add-tools__btn--active' : ''}`}
          disabled={!isTypeAllowed('svg')}
          onClick={() => handleToolClick('add-svg')}
          title={!isTypeAllowed('svg') ? 'SVGs not allowed on this view' : 'Add SVG'}
        >
          SVG
        </button>
      </div>
    </div>
  );
}
