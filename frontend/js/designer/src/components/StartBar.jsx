import React, { useEffect, useState } from 'react';
import { __ } from '@wordpress/i18n';

/**
 * "Personalise this product", pinned to the bottom of the screen for as long
 * as the way into the designer is scrolled out of sight.
 *
 * On a product page the designer (desktop) or its open button (phone) sits
 * below the title, price, description and variations — measured at 1260 px
 * and 1700 px down on the shop's own pages, well past the first screen. A
 * customer who does not scroll never learns the product can be personalised.
 *
 * `getTarget` returns the element that IS the way in; the bar hides whenever
 * that element is on screen, so the two are never shown together.
 */
export default function StartBar({ getTarget, onStart, watchKey, note = '' }) {
  const [targetVisible, setTargetVisible] = useState(true);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const target = getTarget();
    if (!target) { setTargetVisible(true); return undefined; }
    const observer = new IntersectionObserver(
      ([entry]) => setTargetVisible(entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [watchKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (targetVisible) return null;

  return (
    <div className="pf-start-bar">
      {note && <p className="pf-start-bar__note" role="status">{note}</p>}
      <button type="button" className="pf-start-bar__btn" onClick={onStart}>
        {__('Customize Product', 'snelgraveren-product-designer')}
      </button>
    </div>
  );
}
