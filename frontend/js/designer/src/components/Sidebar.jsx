import React, { useState, useEffect } from 'react';
import { __ } from '@wordpress/i18n';
import useDesignerStore from '../store/useDesignerStore';
import AddTab from './tabs/AddTab';
import ElementTab from './tabs/ElementTab';
import ViewsTab from './tabs/ViewsTab';

export default function Sidebar() {
  const { selectedObject } = useDesignerStore();
  const [activeTab, setActiveTab] = useState('views');

  // Auto-switch to Element tab when object selected
  useEffect(() => {
    if (selectedObject) {
      setActiveTab('element');
    } else if (activeTab === 'element') {
      setActiveTab('views');
    }
  }, [selectedObject]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="pd-sidebar">
      <div className="pd-sidebar__tabs" role="tablist" aria-label={__('Designer tools', 'product-designer')}>
        <button
          type="button"
          role="tab"
          id="pd-tab-views"
          aria-selected={activeTab === 'views'}
          aria-controls="pd-panel-views"
          className={`pd-sidebar__tab${activeTab === 'views' ? ' pd-sidebar__tab--active' : ''}`}
          onClick={() => setActiveTab('views')}
        >
          {__('Views', 'product-designer')}
        </button>
        <button
          type="button"
          role="tab"
          id="pd-tab-element"
          aria-selected={activeTab === 'element'}
          aria-controls="pd-panel-element"
          className={`pd-sidebar__tab${activeTab === 'element' ? ' pd-sidebar__tab--active' : ''}`}
          onClick={() => setActiveTab('element')}
          disabled={!selectedObject}
        >
          {__('Element', 'product-designer')}
        </button>
        <button
          type="button"
          role="tab"
          id="pd-tab-add"
          aria-selected={activeTab === 'add'}
          aria-controls="pd-panel-add"
          className={`pd-sidebar__tab${activeTab === 'add' ? ' pd-sidebar__tab--active' : ''}`}
          onClick={() => setActiveTab('add')}
        >
          {__('Add', 'product-designer')}
        </button>
      </div>
      <div className="pd-sidebar__content">
        {activeTab === 'views' && (
          <div role="tabpanel" id="pd-panel-views" aria-labelledby="pd-tab-views">
            <ViewsTab />
          </div>
        )}
        {activeTab === 'element' && (
          <div role="tabpanel" id="pd-panel-element" aria-labelledby="pd-tab-element">
            <ElementTab />
          </div>
        )}
        {activeTab === 'add' && (
          <div role="tabpanel" id="pd-panel-add" aria-labelledby="pd-tab-add">
            <AddTab />
          </div>
        )}
      </div>
    </div>
  );
}
