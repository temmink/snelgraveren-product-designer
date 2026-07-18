import React from 'react';
import { __ } from '@wordpress/i18n';

export default function UpgradePrompt({ feature, description }) {
  const upgradeUrl = window.pfTemplateBuilder?.upgradeUrl || '#';

  return (
    <div className="pf-upgrade-prompt">
      <span className="pf-upgrade-prompt__badge">{__('Pro', 'snelgraveren-product-designer')}</span>
      <p className="pf-upgrade-prompt__text">{description}</p>
      <a
        href={upgradeUrl}
        className="button button-primary pf-upgrade-prompt__btn"
        target="_blank"
        rel="noopener noreferrer"
      >
        {__('Upgrade to Pro', 'snelgraveren-product-designer')}
      </a>
    </div>
  );
}
