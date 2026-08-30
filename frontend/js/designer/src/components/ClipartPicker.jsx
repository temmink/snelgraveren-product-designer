import React, { useEffect, useRef } from 'react';
import { __ } from '@wordpress/i18n';

/**
 * Large-preview clipart chooser for one collection, shown as an overlay
 * covering the designer layout. The sidebar's 48px thumbnails are too small
 * to judge artwork by; this panel shows the same items at ~110px.
 *
 * Escape is swallowed (stopPropagation) — in modal display mode a
 * document-level listener closes the whole designer on Escape, and only the
 * picker should close.
 */
export default function ClipartPicker({ collection, onSelect, onClose }) {
  const panelRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    panelRef.current?.querySelector('button')?.focus();
    return () => {
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
        previousFocusRef.current.focus();
      }
    };
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="pf-clipart-picker"
      role="dialog"
      aria-modal="true"
      aria-label={collection.name}
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="pf-clipart-picker__panel"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pf-clipart-picker__header">
          <h3 className="pf-clipart-picker__title">{collection.name}</h3>
          <button
            type="button"
            className="pf-clipart-picker__close"
            onClick={onClose}
            aria-label={__('Close', 'snelgraveren-product-designer')}
          >
            ×
          </button>
        </div>
        <div className="pf-clipart-picker__grid">
          {(collection.items || []).map((item) => (
            <button
              key={item.id}
              type="button"
              className="pf-clipart-picker__item"
              onClick={() => onSelect(item.svg_url)}
              title={item.name}
              aria-label={item.name}
            >
              <img src={item.svg_url} alt="" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
