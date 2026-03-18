import React, { useState, useEffect } from 'react';
import useDesignerStore from '../store/useDesignerStore';
import AddTab from './tabs/AddTab';
import ElementTab from './tabs/ElementTab';
import ViewsTab from './tabs/ViewsTab';

export default function Sidebar() {
  const { selectedObject } = useDesignerStore();
  const [activeTab, setActiveTab] = useState('add');

  // Auto-switch to Element tab when object selected
  useEffect(() => {
    if (selectedObject) {
      setActiveTab('element');
    } else if (activeTab === 'element') {
      setActiveTab('add');
    }
  }, [selectedObject]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="pd-sidebar">
      <div className="pd-sidebar__tabs">
        <button
          className={`pd-sidebar__tab${activeTab === 'add' ? ' pd-sidebar__tab--active' : ''}`}
          onClick={() => setActiveTab('add')}
        >
          Add
        </button>
        <button
          className={`pd-sidebar__tab${activeTab === 'element' ? ' pd-sidebar__tab--active' : ''}`}
          onClick={() => setActiveTab('element')}
          disabled={!selectedObject}
        >
          Element
        </button>
        <button
          className={`pd-sidebar__tab${activeTab === 'views' ? ' pd-sidebar__tab--active' : ''}`}
          onClick={() => setActiveTab('views')}
        >
          Views
        </button>
      </div>
      <div className="pd-sidebar__content">
        {activeTab === 'add' && <AddTab />}
        {activeTab === 'element' && <ElementTab />}
        {activeTab === 'views' && <ViewsTab />}
      </div>
    </div>
  );
}
