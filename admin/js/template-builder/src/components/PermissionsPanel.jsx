import React from 'react';
import useTemplateStore from '../store/useTemplateStore';

const ELEMENT_TYPES = [
  { key: 'text',  label: 'Text',  extras: ['recolor', 'change_font'] },
  { key: 'image', label: 'Image', extras: [] },
  { key: 'svg',   label: 'SVG',   extras: ['recolor'] },
];

export default function PermissionsPanel() {
  const { globalConfig, setGlobalConfig } = useTemplateStore();
  const permissions = globalConfig.permissions || {};

  const getTypePerm = (type) => permissions[type] || {};

  const updatePerm = (type, key, value) => {
    setGlobalConfig({
      permissions: {
        ...permissions,
        [type]: { ...getTypePerm(type), [key]: value },
      },
    });
  };

  return (
    <div className="pd-permissions">
      {ELEMENT_TYPES.map(({ key, label, extras }) => {
        const perm = getTypePerm(key);
        const boolKeys = ['resize', 'rotate', 'delete', ...extras, 'snap_to_grid'];
        return (
          <fieldset key={key} className="pd-permissions__group">
            <legend>{label}</legend>
            {boolKeys.map((bk) => (
              <label key={bk} className="pd-permissions__check">
                <input
                  type="checkbox"
                  checked={perm[bk] !== false}
                  onChange={(e) => updatePerm(key, bk, e.target.checked)}
                />
                {bk.replace(/_/g, ' ')}
              </label>
            ))}
            <div className="pd-permissions__scales">
              <label>
                Min scale
                <input
                  type="number" step="0.1" min="0.01"
                  value={perm.min_scale ?? 0.1}
                  onChange={(e) => updatePerm(key, 'min_scale', parseFloat(e.target.value))}
                  className="pd-permissions__number"
                />
              </label>
              <label>
                Max scale
                <input
                  type="number" step="0.1" min="0.1"
                  value={perm.max_scale ?? 10}
                  onChange={(e) => updatePerm(key, 'max_scale', parseFloat(e.target.value))}
                  className="pd-permissions__number"
                />
              </label>
              {perm.snap_to_grid && (
                <label>
                  Grid size (px)
                  <input
                    type="number" min="1"
                    value={perm.grid_size ?? 10}
                    onChange={(e) => updatePerm(key, 'grid_size', parseInt(e.target.value, 10))}
                    className="pd-permissions__number"
                  />
                </label>
              )}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
