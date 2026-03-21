import React from 'react';
import { __ } from '@wordpress/i18n';

export default function SettingsPricing({ globalConfig, update }) {
  return (
    <>
      <h3 className="pf-settings__section-title">{__('Pricing', 'productforge')}</h3>
      <p className="pf-settings__section-desc">{__('Configure global pricing rules for customization surcharges.', 'productforge')}</p>
      <p style={{ color: '#888', fontStyle: 'italic' }}>{__('No global pricing configured.', 'productforge')}</p>
    </>
  );
}
