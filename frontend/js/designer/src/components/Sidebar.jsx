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
    <div className="pf-sidebar">
      <div className="pf-sidebar__tabs" role="tablist" aria-label={__('Designer tools', 'productforge')}>
        <button
          type="button"
          role="tab"
          id="pf-tab-views"
          aria-selected={activeTab === 'views'}
          aria-controls="pf-panel-views"
          className={`pf-sidebar__tab${activeTab === 'views' ? ' pf-sidebar__tab--active' : ''}`}
          onClick={() => setActiveTab('views')}
        >
          {__('Views', 'productforge')}
        </button>
        <button
          type="button"
          role="tab"
          id="pf-tab-element"
          aria-selected={activeTab === 'element'}
          aria-controls="pf-panel-element"
          className={`pf-sidebar__tab${activeTab === 'element' ? ' pf-sidebar__tab--active' : ''}`}
          onClick={() => setActiveTab('element')}
          disabled={!selectedObject}
        >
          {__('Element', 'productforge')}
        </button>
        <button
          type="button"
          role="tab"
          id="pf-tab-add"
          aria-selected={activeTab === 'add'}
          aria-controls="pf-panel-add"
          className={`pf-sidebar__tab${activeTab === 'add' ? ' pf-sidebar__tab--active' : ''}`}
          onClick={() => setActiveTab('add')}
        >
          {__('Add', 'productforge')}
        </button>
      </div>
      <div className="pf-sidebar__content">
        {activeTab === 'views' && (
          <div role="tabpanel" id="pf-panel-views" aria-labelledby="pf-tab-views">
            <ViewsTab />
          </div>
        )}
        {activeTab === 'element' && (
          <div role="tabpanel" id="pf-panel-element" aria-labelledby="pf-tab-element">
            <ElementTab />
          </div>
        )}
        {activeTab === 'add' && (
          <div role="tabpanel" id="pf-panel-add" aria-labelledby="pf-tab-add">
            <AddTab />
          </div>
        )}
      </div>
    </div>
  );
}
