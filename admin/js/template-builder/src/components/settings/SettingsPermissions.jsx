import React from 'react';
import { __ } from '@wordpress/i18n';

export default function SettingsPermissions({ globalConfig, update }) {
  return (
    <>
      <h3 className="pf-settings__section-title">{__('Permissions', 'productforge')}</h3>
      <p className="pf-settings__section-desc">{__('Control global customer permissions across all templates.', 'productforge')}</p>
      <p style={{ color: '#888', fontStyle: 'italic' }}>{__('No global permissions configured.', 'productforge')}</p>
    </>
  );
}
