import React, { useState } from 'react';
import { __ } from '@wordpress/i18n';
import useTemplateStore from '../store/useTemplateStore';
import SettingsGeneral from './settings/SettingsGeneral';
import SettingsColors from './settings/SettingsColors';
import SettingsFonts from './settings/SettingsFonts';
import SettingsTools from './settings/SettingsTools';
import SettingsAssets from './settings/SettingsAssets';
import SettingsUploads from './settings/SettingsUploads';
import SettingsPricing from './settings/SettingsPricing';
import SettingsPermissions from './settings/SettingsPermissions';

const SECTIONS = [
  { id: 'general',     label: 'General' },
  { id: 'colors',      label: 'Colors' },
  { id: 'fonts',       label: 'Fonts' },
  { id: 'tools',       label: 'Tools' },
  { id: 'assets',      label: 'Assets' },
  { id: 'uploads',     label: 'Uploads' },
  { id: 'pricing',     label: 'Pricing' },
  { id: 'permissions', label: 'Permissions' },
];

export default function GlobalSettings() {
  const { globalConfig, setGlobalConfig, colorPalettes, setColorPalettes, clipartCollections, setClipartCollections } = useTemplateStore();
  const [activeSection, setActiveSection] = useState('general');

  const update = (key, value) => setGlobalConfig({ [key]: value });

  const renderSection = () => {
    switch (activeSection) {
      case 'general':
        return <SettingsGeneral globalConfig={globalConfig} update={update} />;
      case 'colors':
        return <SettingsColors globalConfig={globalConfig} update={update} colorPalettes={colorPalettes} setColorPalettes={setColorPalettes} />;
      case 'fonts':
        return <SettingsFonts globalConfig={globalConfig} update={update} />;
      case 'tools':
        return <SettingsTools globalConfig={globalConfig} update={update} />;
      case 'assets':
        return <SettingsAssets globalConfig={globalConfig} update={update} clipartCollections={clipartCollections} setClipartCollections={setClipartCollections} />;
      case 'uploads':
        return <SettingsUploads globalConfig={globalConfig} update={update} />;
      case 'pricing':
        return <SettingsPricing globalConfig={globalConfig} update={update} />;
      case 'permissions':
        return <SettingsPermissions globalConfig={globalConfig} update={update} />;
      default:
        return null;
    }
  };

  return (
    <div className="pf-settings">
      <nav className="pf-settings__nav">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`pf-settings__nav-btn${activeSection === section.id ? ' pf-settings__nav-btn--active' : ''}`}
            onClick={() => setActiveSection(section.id)}
          >
            {__(section.label, 'productforge')}
          </button>
        ))}
      </nav>
      <div className="pf-settings__content">
        {renderSection()}
      </div>
    </div>
  );
}
