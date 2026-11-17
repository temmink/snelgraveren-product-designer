import React from 'react';
import { __ } from '@wordpress/i18n';

export default function SettingsPermissions({ globalConfig, update }) {
  return (
    <>
      <h3 className="pf-settings__section-title">{__('Permissions', 'snelgraveren-product-designer')}</h3>
      <p className="pf-settings__section-desc">{__('Control global customer permissions across all templates.', 'snelgraveren-product-designer')}</p>
      <p style={{ color: '#888', fontStyle: 'italic' }}>{__('No global permissions configured.', 'snelgraveren-product-designer')}</p>
    </>
  );
}
