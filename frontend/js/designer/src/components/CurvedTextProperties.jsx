import React, { useState, useCallback, useEffect } from 'react';
import { __ } from '@wordpress/i18n';
import { Path as FabricPath } from 'fabric';
import { PRESETS } from '../utils/curvePresets';

export default function CurvedTextProperties({ fabricObj, snapshotView, currentViewIndex }) {
  const [preset, setPreset] = useState(fabricObj.data?.curvePreset || 'arch-up');
  const [intensity, setIntensity] = useState(fabricObj.data?.curveIntensity ?? 60);
  const [letterSpacing, setLetterSpacing] = useState(fabricObj.charSpacing || 0);

  useEffect(() => {
    setPreset(fabricObj.data?.curvePreset || 'arch-up');
    setIntensity(fabricObj.data?.curveIntensity ?? 60);
    setLetterSpacing(fabricObj.charSpacing || 0);
  }, [fabricObj]);

  const applyPath = useCallback((presetId, curveIntensity) => {
    const presetDef = PRESETS.find((p) => p.id === presetId);
    if (!presetDef) return;

    const textWidth = fabricObj.width || 200;

    if (presetId === 'straight') {
      fabricObj.set({ path: null });
    } else {
      const pathStr = presetDef.generator(textWidth, curveIntensity);
      const pathObj = new FabricPath(pathStr, { visible: false });
      fabricObj.set({ path: pathObj });
    }

    fabricObj.set({
      data: { ...fabricObj.data, curvePreset: presetId, curveIntensity },
    });

    fabricObj.initDimensions();
    fabricObj.setCoords();
    fabricObj.canvas?.renderAll();
    snapshotView(currentViewIndex, fabricObj.canvas?.toJSON(['data']));
  }, [fabricObj, snapshotView, currentViewIndex]);

  return (
    <div className="pf-curved-text">
      <div className="pf-curved-text__presets">
        {PRESETS.map((p) => (
          <button key={p.id} type="button"
            className={`pf-curved-text__preset${preset === p.id ? ' pf-curved-text__preset--active' : ''}`}
            onClick={() => { setPreset(p.id); applyPath(p.id, intensity); }}
            title={p.label}
            style={{ color: preset === p.id ? '#2271b1' : '#666' }}
          >
            <PresetIcon id={p.id} />
            <span>{p.label}</span>
          </button>
        ))}
      </div>

      <label className="pf-element__field">
        <span>{__('Curve intensity', 'snelgraveren-product-designer')}</span>
        <input type="range" min="-100" max="100" value={intensity}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            setIntensity(val);
            applyPath(preset === 'custom' ? 'custom' : preset, val);
          }}
        />
      </label>

      <label className="pf-element__field">
        <span>{__('Letter spacing', 'snelgraveren-product-designer')}</span>
        <input type="range" min="-50" max="200" value={letterSpacing}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            setLetterSpacing(val);
            fabricObj.set({ charSpacing: val });
            fabricObj.canvas?.renderAll();
            snapshotView(currentViewIndex, fabricObj.canvas?.toJSON(['data']));
          }}
        />
      </label>
    </div>
  );
}

function PresetIcon({ id }) {
  const svgProps = { width: 40, height: 20, viewBox: '0 0 40 20' };
  const pathProps = { stroke: 'currentColor', strokeWidth: 2, fill: 'none' };

  switch (id) {
    case 'arch-up': return <svg {...svgProps}><path d="M 2 18 Q 20 0 38 18" {...pathProps} /></svg>;
    case 'arch-down': return <svg {...svgProps}><path d="M 2 2 Q 20 20 38 2" {...pathProps} /></svg>;
    case 'wave': return <svg {...svgProps}><path d="M 2 15 Q 12 2 20 10 Q 28 18 38 5" {...pathProps} /></svg>;
    case 'circle': return <svg {...svgProps} viewBox="0 0 40 25"><circle cx="20" cy="12" r="10" {...pathProps} /></svg>;
    case 'straight': return <svg {...svgProps}><path d="M 2 10 L 38 10" {...pathProps} /></svg>;
    case 'custom': return <svg {...svgProps}><path d="M 2 18 Q 20 -5 38 18" {...pathProps} strokeDasharray="3 2" /></svg>;
    default: return null;
  }
}
