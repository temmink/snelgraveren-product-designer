import React from 'react';
import { __ } from '@wordpress/i18n';

export default function SettingsTools({ globalConfig, update }) {
  return (
    <>
      <h3 className="pf-settings__section-title">{__('Tools', 'productforge')}</h3>
      <p className="pf-settings__section-desc">{__('Configure which tools are available to customers.', 'productforge')}</p>
      <p style={{ color: '#888', fontStyle: 'italic' }}>{__('No additional tools configured.', 'productforge')}</p>
    </>
  );
}
