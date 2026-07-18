import React, { useState, useCallback, useEffect } from 'react';
import { __ } from '@wordpress/i18n';
import { filters as fabricFilters } from 'fabric';

const PRESETS = [
  { type: 'Grayscale', label: 'Grayscale' },
  { type: 'Sepia', label: 'Sepia' },
  { type: 'Invert', label: 'Invert' },
  { type: 'Vintage', label: 'Vintage' },
  { type: 'BlackWhite', label: 'B&W' },
  { type: 'Brownie', label: 'Brownie' },
  { type: 'Kodachrome', label: 'Kodachrome' },
  { type: 'Technicolor', label: 'Technicolor' },
  { type: 'Polaroid', label: 'Polaroid' },
];

const ADJUSTMENTS = [
  { type: 'Brightness', label: 'Brightness', prop: 'brightness', min: -1, max: 1, step: 0.05 },
  { type: 'Contrast', label: 'Contrast', prop: 'contrast', min: -1, max: 1, step: 0.05 },
  { type: 'Saturation', label: 'Saturation', prop: 'saturation', min: -1, max: 1, step: 0.05 },
  { type: 'Blur', label: 'Blur', prop: 'blur', min: 0, max: 1, step: 0.02 },
  { type: 'Noise', label: 'Noise', prop: 'noise', min: 0, max: 500, step: 10 },
  { type: 'Pixelate', label: 'Pixelate', prop: 'blocksize', min: 1, max: 20, step: 1 },
  { type: 'HueRotation', label: 'Hue', prop: 'rotation', min: 0, max: 360, step: 5 },
  { type: 'Vibrance', label: 'Vibrance', prop: 'vibrance', min: -1, max: 1, step: 0.05 },
];

export default function ImageFilters({ fabricObj, allowedFilters, snapshotView, currentViewIndex }) {
  const [activePreset, setActivePreset] = useState(null);
  const [adjustments, setAdjustments] = useState({});

  // Sync state when selected object changes
  useEffect(() => {
    const currentFilters = fabricObj.filters || [];
    let preset = null;
    const adjs = {};

    currentFilters.forEach((f) => {
      const fType = f.type || f.constructor?.name;
      if (PRESETS.some((p) => p.type === fType)) {
        preset = fType;
      }
      const adj = ADJUSTMENTS.find((a) => a.type === fType);
      if (adj) {
        adjs[fType] = f[adj.prop] || 0;
      }
    });

    setActivePreset(preset);
    setAdjustments(adjs);
  }, [fabricObj]);

  const applyFilters = useCallback((preset, adjs) => {
    const filterList = [];

    if (preset && fabricFilters[preset]) {
      filterList.push(new fabricFilters[preset]());
    }

    Object.entries(adjs).forEach(([type, value]) => {
      if (value === 0 || (value === 1 && type === 'Pixelate')) return;
      const adjDef = ADJUSTMENTS.find((a) => a.type === type);
      if (adjDef && fabricFilters[type]) {
        filterList.push(new fabricFilters[type]({ [adjDef.prop]: value }));
      }
    });

    fabricObj.filters = filterList;
    fabricObj.applyFilters();
    fabricObj.canvas?.renderAll();
    snapshotView(currentViewIndex, fabricObj.canvas?.toJSON(['data']));
  }, [fabricObj, snapshotView, currentViewIndex]);

  const visiblePresets = PRESETS.filter((p) => allowedFilters.includes(p.type));
  const visibleAdjustments = ADJUSTMENTS.filter((a) => allowedFilters.includes(a.type));

  const resetFilters = () => {
    setActivePreset(null);
    setAdjustments({});
    applyFilters(null, {});
  };

  return (
    <div className="pf-filters">
      <div className="pf-filters__header">
        <span className="pf-filters__title">{__('Filters', 'snelgraveren-product-designer')}</span>
        <button type="button" className="pf-filters__reset" style={{ color: '#2271b1' }} onClick={resetFilters}>
          {__('Reset', 'snelgraveren-product-designer')}
        </button>
      </div>

      {visiblePresets.length > 0 && (
        <div className="pf-filters__presets">
          <button
            type="button"
            className={`pf-filters__preset${!activePreset ? ' pf-filters__preset--active' : ''}`}
            style={{ color: !activePreset ? '#2271b1' : '#333' }}
            onClick={() => { setActivePreset(null); applyFilters(null, adjustments); }}
          >
            {__('None', 'snelgraveren-product-designer')}
          </button>
          {visiblePresets.map((p) => (
            <button
              key={p.type}
              type="button"
              className={`pf-filters__preset${activePreset === p.type ? ' pf-filters__preset--active' : ''}`}
              style={{ color: activePreset === p.type ? '#2271b1' : '#333' }}
              onClick={() => { setActivePreset(p.type); applyFilters(p.type, adjustments); }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {visibleAdjustments.map((adj) => (
        <label key={adj.type} className="pf-filters__slider">
          <div className="pf-filters__slider-header">
            <span>{adj.label}</span>
            <span>{Math.round((adjustments[adj.type] || (adj.type === 'Pixelate' ? 1 : 0)) * (adj.max > 1 ? 1 : 100))}</span>
          </div>
          <input
            type="range"
            min={adj.min}
            max={adj.max}
            step={adj.step}
            value={adjustments[adj.type] || (adj.type === 'Pixelate' ? 1 : 0)}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              const newAdjs = { ...adjustments, [adj.type]: val };
              setAdjustments(newAdjs);
              applyFilters(activePreset, newAdjs);
            }}
          />
        </label>
      ))}
    </div>
  );
}
