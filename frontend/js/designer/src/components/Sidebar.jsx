import React, { useState, useEffect } from 'react';
import { __ } from '@wordpress/i18n';
import useDesignerStore from '../store/useDesignerStore';
import ViewSwitcher from './ViewSwitcher';
import ProductOptions from './ProductOptions';
import { readVariantForm, hasColorOption } from '../utils/productVariants';
import { getDesignerConfig } from '../utils/config';
import AddTab from './tabs/AddTab';
import ElementTab from './tabs/ElementTab';
import LayersTab from './tabs/LayersTab';

export default function Sidebar() {
  const { selectedObject, template, currentViewIndex } = useDesignerStore();
  // Opens on Add: that is the first thing a customer can do. The product's
  // sides are no longer a tab (see ViewSwitcher).
  const [activeTab, setActiveTab] = useState('add');

  // Check if there are editable SVG zone fills (element tab should stay accessible)
  const currentView = template?.views?.[currentViewIndex];
  // …unless the product's colour is one of its options: then the option
  // decides the colour and the Edit tab has nothing to offer without a
  // selection (see ElementTab's colorIsProductOption).
  const hasEditableZones = (currentView?.zones_config || []).some(
    (z) => z.boundary_type === 'svg' && z.svg_url && z.svg_fill_editable
  ) && !hasColorOption(
    readVariantForm(document.querySelector('form.cart')),
    getDesignerConfig().color_names || {},
  );

  // Auto-switch to Element tab when object selected — except while the user
  // is on the Layers tab: that tab exists to select one element after
  // another, and yanking them to Element after every click would make it
  // useless for exactly its purpose.
  useEffect(() => {
    if (selectedObject) {
      if (activeTab !== 'layers') {
        setActiveTab('element');
      }
    } else if (activeTab === 'element' && !hasEditableZones) {
      setActiveTab('add');
    }
  }, [selectedObject]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs = [
    { id: 'add',     label: __('Add', 'snelgraveren-product-designer') },
    {
      id: 'element',
      label: __('Edit', 'snelgraveren-product-designer'),
      disabled: !selectedObject && !hasEditableZones,
    },
    { id: 'layers',  label: __('Layers', 'snelgraveren-product-designer') },
  ];

  return (
    <div className="pf-sidebar">
      <ProductOptions />
      <ViewSwitcher />
      <div className="pf-sidebar__tabs" role="tablist" aria-label={__('Designer tools', 'snelgraveren-product-designer')}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`pf-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`pf-panel-${tab.id}`}
            className={`pf-sidebar__tab${activeTab === tab.id ? ' pf-sidebar__tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            disabled={!!tab.disabled}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="pf-sidebar__content" role="tabpanel" id={`pf-panel-${activeTab}`} aria-labelledby={`pf-tab-${activeTab}`}>
        {activeTab === 'add' && <AddTab />}
        {activeTab === 'element' && <ElementTab />}
        {activeTab === 'layers' && <LayersTab />}
      </div>
    </div>
  );
}
