# Five New Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add undo/redo, curved text, design templates, image filters, and drawing tool to ProductForge.

**Architecture:** Six sequential tasks: (1) reorganize admin settings into sub-sections, (2) add toolbar + undo/redo, (3) drawing tool, (4) image filters, (5) curved text, (6) design templates with DB/REST/admin. Each task builds on the previous but produces working software independently.

**Tech Stack:** React 18, Zustand, Fabric.js 6.x, PHP 8.1, WordPress REST API, custom DB tables.

**Spec:** `docs/superpowers/specs/2026-03-21-five-features-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|----------------|
| `admin/js/template-builder/src/components/settings/SettingsGeneral.jsx` | General settings sub-section (cart behavior, solid color) |
| `admin/js/template-builder/src/components/settings/SettingsColors.jsx` | Color picker settings (product + element) |
| `admin/js/template-builder/src/components/settings/SettingsFonts.jsx` | Font picker + custom font upload |
| `admin/js/template-builder/src/components/settings/SettingsTools.jsx` | Drawing, curved text, image filters toggles |
| `admin/js/template-builder/src/components/settings/SettingsAssets.jsx` | Clip art + design templates |
| `admin/js/template-builder/src/components/settings/SettingsUploads.jsx` | Image upload restrictions |
| `admin/js/template-builder/src/components/settings/SettingsPricing.jsx` | Pricing config |
| `admin/js/template-builder/src/components/settings/SettingsPermissions.jsx` | Per-element permissions |
| `frontend/js/designer/src/components/Toolbar.jsx` | Canvas toolbar (undo/redo, draw/erase, options) |
| `frontend/js/designer/src/hooks/useCanvasHistory.js` | Undo/redo state management hook |
| `frontend/js/designer/src/utils/curvePresets.js` | SVG path generators for curved text presets |
| `frontend/js/designer/src/components/CurvedTextProperties.jsx` | Curve preset picker + sliders |
| `frontend/js/designer/src/components/ImageFilters.jsx` | Filter presets + adjustment sliders |
| `frontend/js/designer/src/components/DesignTemplates.jsx` | Frontend template picker (Add tab section) |
| `includes/Admin/views/design-templates.php` | Admin page view (renders React mount point) |
| `admin/js/design-templates/src/App.jsx` | Admin design templates management React app |
| `includes/Database/class-migration600.php` | DB migration for design_templates + design_template_views |
| `includes/Database/class-design-template-repository.php` | CRUD for design templates |
| `includes/API/class-rest-design-templates.php` | REST controller for design templates |
| `includes/Security/class-design-template-validator.php` | JSON import validation |

### Modified files

| File | Changes |
|------|---------|
| `admin/js/template-builder/src/components/GlobalSettings.jsx` | Replace single scroll with sub-section nav + render active section |
| `frontend/js/designer/src/App.jsx` | Add Toolbar component above layout |
| `frontend/js/designer/src/components/DesignerCanvas.jsx` | History integration, drawing mode, curved text tool, keyboard shortcuts |
| `frontend/js/designer/src/components/tabs/AddTab.jsx` | Curved text button, design templates section |
| `frontend/js/designer/src/components/tabs/ElementTab.jsx` | CurvedTextProperties, ImageFilters integration |
| `frontend/js/designer/src/store/useDesignerStore.js` | History state, drawing state, new actions |
| `frontend/js/designer/src/designer.css` | Toolbar, drawing panel, filter, curved text styles |
| `includes/Database/class-db-manager.php` | Register migration 600 |
| `includes/class-product-forge.php` | Register RestDesignTemplates controller |
| `includes/Admin/class-admin.php` | Add Design Templates admin menu item |
| `frontend/js/designer/src/api/designerApi.js` | Add fetchDesignTemplates API call |

---

## Task 1: Admin Settings Reorganization

**Files:**
- Modify: `admin/js/template-builder/src/components/GlobalSettings.jsx`
- Create: `admin/js/template-builder/src/components/settings/SettingsGeneral.jsx`
- Create: `admin/js/template-builder/src/components/settings/SettingsColors.jsx`
- Create: `admin/js/template-builder/src/components/settings/SettingsFonts.jsx`
- Create: `admin/js/template-builder/src/components/settings/SettingsTools.jsx`
- Create: `admin/js/template-builder/src/components/settings/SettingsAssets.jsx`
- Create: `admin/js/template-builder/src/components/settings/SettingsUploads.jsx`
- Create: `admin/js/template-builder/src/components/settings/SettingsPricing.jsx`
- Create: `admin/js/template-builder/src/components/settings/SettingsPermissions.jsx`

**Context:** GlobalSettings.jsx is currently 910 lines with all fieldsets in one scroll. We split it into 8 sub-components with a left-side mini-nav. Each sub-component receives `globalConfig`, `update`, and any other props it needs (like `colorPalettes`, `customFonts`).

- [ ] **Step 1: Read GlobalSettings.jsx and map each fieldset to its target sub-section**

Read the full file. Identify exact line ranges for each fieldset and which sub-component they belong to:
- General: Cart Behavior + Product Color fieldsets
- Colors: ColorModeFieldset components (product + element) + PaletteManager
- Fonts: Font picker + custom font upload
- Tools: (empty for now — will be populated in tasks 3-5)
- Assets: Clip Art fieldset + CollectionManager
- Uploads: Image Upload Restrictions fieldset
- Pricing: Pricing fieldsets
- Permissions: Permissions fieldsets

- [ ] **Step 2: Create SettingsGeneral.jsx**

Extract Cart Behavior and Product Color fieldsets into this component:

```jsx
import React from 'react';
import { __ } from '@wordpress/i18n';

export default function SettingsGeneral({ globalConfig, update }) {
  return (
    <>
      <h3 className="pf-settings__section-title">{__('General', 'productforge')}</h3>
      <p className="pf-settings__section-desc">{__('Cart behavior and product display settings.', 'productforge')}</p>

      <fieldset className="pf-settings__fieldset">
        <legend>{__('Cart Behavior', 'productforge')}</legend>
        <label className="pf-settings__check">
          <input
            type="checkbox"
            checked={globalConfig.require_customization || false}
            onChange={(e) => update('require_customization', e.target.checked)}
          />
          {__('Require customization before adding to cart', 'productforge')}
        </label>
      </fieldset>

      <fieldset className="pf-settings__fieldset">
        <legend>{__('Product Color', 'productforge')}</legend>
        <label className="pf-settings__check">
          <input
            type="checkbox"
            checked={globalConfig.solid_color || false}
            onChange={(e) => update('solid_color', e.target.checked)}
          />
          {__('Solid color product (all views share one color)', 'productforge')}
        </label>
      </fieldset>
    </>
  );
}
```

- [ ] **Step 3: Create remaining 7 sub-section components**

For each sub-section, extract the relevant JSX from GlobalSettings.jsx into a new file. Each component has the signature:

```jsx
export default function Settings{Name}({ globalConfig, update, ...extraProps }) {
```

Extra props per component:
- `SettingsColors`: `colorPalettes`, `setColorPalettes`
- `SettingsFonts`: `customFonts`
- `SettingsTools`: (none for now)
- `SettingsAssets`: `colorPalettes`, `setColorPalettes` (for CollectionManager)
- Others: none

`SettingsTools.jsx` starts empty (placeholder with heading):

```jsx
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
```

- [ ] **Step 4: Rewrite GlobalSettings.jsx with sub-section navigation**

Replace the current single-scroll content with a nav + active section pattern:

```jsx
import React, { useState } from 'react';
import { __ } from '@wordpress/i18n';
import useTemplateStore from '../store/useTemplateStore';
import SettingsGeneral from './settings/SettingsGeneral';
import SettingsColors from './settings/SettingsColors';
import SettingsFonts from './settings/SettingsFonts';
import SettingsTools from './settings/SettingsTools';
import SettingsAssets from './settings/SettingsAssets';
import SettingsUploads from './settings/SettingsUploads';
import SettingsPricing from './settings/SettingsPricing';
import SettingsPermissions from './settings/SettingsPermissions';

const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'colors', label: 'Colors' },
  { id: 'fonts', label: 'Fonts' },
  { id: 'tools', label: 'Tools' },
  { id: 'assets', label: 'Assets' },
  { id: 'uploads', label: 'Uploads' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'permissions', label: 'Permissions' },
];

export default function GlobalSettings() {
  const { globalConfig, updateGlobalConfig, colorPalettes, setColorPalettes, customFonts } = useTemplateStore();
  const [activeSection, setActiveSection] = useState('general');

  const update = (key, val) => updateGlobalConfig(key, val);

  const commonProps = { globalConfig, update };

  return (
    <div className="pf-settings">
      <nav className="pf-settings__nav">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`pf-settings__nav-btn${activeSection === s.id ? ' pf-settings__nav-btn--active' : ''}`}
            onClick={() => setActiveSection(s.id)}
          >
            {__(s.label, 'productforge')}
          </button>
        ))}
      </nav>
      <div className="pf-settings__content">
        {activeSection === 'general' && <SettingsGeneral {...commonProps} />}
        {activeSection === 'colors' && <SettingsColors {...commonProps} colorPalettes={colorPalettes} setColorPalettes={setColorPalettes} />}
        {activeSection === 'fonts' && <SettingsFonts {...commonProps} customFonts={customFonts} />}
        {activeSection === 'tools' && <SettingsTools {...commonProps} />}
        {activeSection === 'assets' && <SettingsAssets {...commonProps} colorPalettes={colorPalettes} setColorPalettes={setColorPalettes} />}
        {activeSection === 'uploads' && <SettingsUploads {...commonProps} />}
        {activeSection === 'pricing' && <SettingsPricing {...commonProps} />}
        {activeSection === 'permissions' && <SettingsPermissions {...commonProps} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add CSS for settings nav**

Add to admin template builder CSS (or inline in GlobalSettings if admin CSS is separate). The styles needed:

```css
.pf-settings { display: flex; gap: 0; min-height: 400px; }
.pf-settings__nav { width: 140px; background: #f9fafb; border-right: 1px solid #e5e7eb; padding: 8px 0; flex-shrink: 0; }
.pf-settings__nav-btn { display: block; width: 100%; padding: 8px 14px; border: none; background: none; text-align: left; cursor: pointer; font-size: 13px; color: #666; }
.pf-settings__nav-btn--active { background: white; border-left: 3px solid #2271b1; color: #2271b1; font-weight: 600; }
.pf-settings__nav-btn:hover:not(.pf-settings__nav-btn--active) { background: #f0f0f0; }
.pf-settings__content { flex: 1; padding: 16px; overflow-y: auto; }
.pf-settings__section-title { margin: 0 0 4px; font-size: 15px; }
.pf-settings__section-desc { color: #888; font-size: 12px; margin: 0 0 16px; }
```

- [ ] **Step 6: Build and verify**

```bash
npm run build
```

Open the template builder in the browser. Verify:
- Settings tab shows left nav with 8 sections
- Clicking each section shows the correct content
- All existing settings (cart behavior, colors, fonts, clip art, uploads, pricing, permissions) work as before
- Save template preserves all settings

- [ ] **Step 7: Commit**

```bash
git add admin/js/template-builder/src/components/GlobalSettings.jsx \
       admin/js/template-builder/src/components/settings/
git commit -m "refactor: reorganize admin settings into sub-sections with navigation"
```

---

## Task 2: Undo/Redo + Toolbar

**Files:**
- Create: `frontend/js/designer/src/components/Toolbar.jsx`
- Create: `frontend/js/designer/src/hooks/useCanvasHistory.js`
- Modify: `frontend/js/designer/src/store/useDesignerStore.js`
- Modify: `frontend/js/designer/src/components/DesignerCanvas.jsx`
- Modify: `frontend/js/designer/src/App.jsx`
- Modify: `frontend/js/designer/src/designer.css`

**Context:** No toolbar exists yet. The layout is `<DesignerCanvas /> + <Sidebar />` inside `.pf-designer__layout`. We add a toolbar above the canvas. Undo/redo uses a per-view state snapshot stack stored in Zustand.

- [ ] **Step 1: Add history state to useDesignerStore.js**

Add these state keys and actions to the store:

```javascript
// After existing state keys:
historyByView: {},   // { [viewIndex]: { undoStack: [], redoStack: [] } }
drawingStrokeWidth: 3,      // Stub for Toolbar's DrawingOptions (populated in Task 3)
drawingStrokeColor: '#000000',
setDrawingStrokeWidth: (w) => set({ drawingStrokeWidth: w }),
setDrawingStrokeColor: (c) => set({ drawingStrokeColor: c }),

// New actions:
pushHistory: (viewIndex, json) =>
  set((s) => {
    const viewHistory = s.historyByView[viewIndex] || { undoStack: [], redoStack: [] };
    const undoStack = [...viewHistory.undoStack, json].slice(-30); // Max 30
    return {
      historyByView: {
        ...s.historyByView,
        [viewIndex]: { undoStack, redoStack: [] },
      },
    };
  }),

// Note: undo/redo logic is handled entirely in useCanvasHistory hook (Step 2),
// which manages current-state saving before applying snapshots.
// The store only provides pushHistory for recording + historyByView for state.
```

Also update `resetDesign` to include `historyByView: {}`.

- [ ] **Step 2: Create useCanvasHistory.js hook**

```javascript
import { useCallback, useRef } from 'react';
import useDesignerStore from '../store/useDesignerStore';

export default function useCanvasHistory(fabricCanvasRef, currentViewIndex) {
  const debounceTimer = useRef(null);

  const pushHistory = useCallback(() => {
    const canvas = fabricCanvasRef;
    if (!canvas) return;

    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const json = canvas.toJSON(['data']);
      useDesignerStore.getState().pushHistory(currentViewIndex, json);
    }, 300);
  }, [fabricCanvasRef, currentViewIndex]);

  const applySnapshot = useCallback((snapshot) => {
    const canvas = fabricCanvasRef;
    if (!canvas || !snapshot) return;
    canvas.loadFromJSON(snapshot).then(() => {
      // Re-mark zone objects as non-selectable
      canvas.getObjects().forEach((obj) => {
        if (obj.data?.isZone || obj.data?.isZoneOverlay || obj.data?.isBackground) {
          obj.set({ selectable: false, evented: false });
        }
      });
      canvas.renderAll();
      useDesignerStore.getState().snapshotView(currentViewIndex, canvas.toJSON(['data']));
    });
  }, [fabricCanvasRef, currentViewIndex]);

  const undo = useCallback(() => {
    const store = useDesignerStore.getState();
    const canvas = fabricCanvasRef;
    if (!canvas) return;
    const vh = store.historyByView[currentViewIndex];
    if (!vh || vh.undoStack.length === 0) return;

    // Save current state to redo before applying undo
    const currentJson = canvas.toJSON(['data']);
    const undoStack = [...vh.undoStack];
    const snapshot = undoStack.pop();

    useDesignerStore.setState({
      historyByView: {
        ...store.historyByView,
        [currentViewIndex]: {
          undoStack,
          redoStack: [...(vh.redoStack || []), currentJson],
        },
      },
    });

    applySnapshot(snapshot);
  }, [fabricCanvasRef, currentViewIndex, applySnapshot]);

  const redo = useCallback(() => {
    const store = useDesignerStore.getState();
    const canvas = fabricCanvasRef;
    if (!canvas) return;
    const vh = store.historyByView[currentViewIndex];
    if (!vh || vh.redoStack.length === 0) return;

    const currentJson = canvas.toJSON(['data']);
    const redoStack = [...vh.redoStack];
    const snapshot = redoStack.pop();

    useDesignerStore.setState({
      historyByView: {
        ...store.historyByView,
        [currentViewIndex]: {
          undoStack: [...(vh.undoStack || []), currentJson],
          redoStack,
        },
      },
    });

    applySnapshot(snapshot);
  }, [fabricCanvasRef, currentViewIndex, applySnapshot]);

  return { pushHistory, undo, redo };
}
```

- [ ] **Step 3: Create Toolbar.jsx**

```jsx
import React from 'react';
import { __ } from '@wordpress/i18n';
import useDesignerStore from '../store/useDesignerStore';

export default function Toolbar({ onUndo, onRedo, canUndo, canRedo }) {
  const { activeTool, setActiveTool, template } = useDesignerStore();
  const globalConfig = template?.global_config || {};
  const drawingEnabled = globalConfig.drawing_enabled || false;

  return (
    <div className="pf-toolbar">
      <div className="pf-toolbar__group">
        <button
          type="button"
          className="pf-toolbar__btn"
          onClick={onUndo}
          disabled={!canUndo}
          title={__('Undo (Ctrl+Z)', 'productforge')}
        >
          ↩
        </button>
        <button
          type="button"
          className="pf-toolbar__btn"
          onClick={onRedo}
          disabled={!canRedo}
          title={__('Redo (Ctrl+Shift+Z)', 'productforge')}
        >
          ↪
        </button>
      </div>

      {drawingEnabled && (
        <>
          <div className="pf-toolbar__separator" />
          <div className="pf-toolbar__group">
            <button
              type="button"
              className={`pf-toolbar__btn${activeTool === 'select' || !['draw', 'erase'].includes(activeTool) ? ' pf-toolbar__btn--active' : ''}`}
              onClick={() => setActiveTool('select')}
              title={__('Select', 'productforge')}
            >
              ↖
            </button>
            <button
              type="button"
              className={`pf-toolbar__btn${activeTool === 'draw' ? ' pf-toolbar__btn--active' : ''}`}
              onClick={() => setActiveTool(activeTool === 'draw' ? 'select' : 'draw')}
              title={__('Draw', 'productforge')}
            >
              ✏️
            </button>
            <button
              type="button"
              className={`pf-toolbar__btn${activeTool === 'erase' ? ' pf-toolbar__btn--active' : ''}`}
              onClick={() => setActiveTool(activeTool === 'erase' ? 'select' : 'erase')}
              title={__('Eraser', 'productforge')}
            >
              🧹
            </button>
          </div>
          <DrawingOptions />
        </>
      )}
    </div>
  );
}

function DrawingOptions() {
  const { activeTool, drawingStrokeWidth, drawingStrokeColor, setDrawingStrokeWidth, setDrawingStrokeColor } = useDesignerStore();

  if (activeTool !== 'draw' && activeTool !== 'erase') return null;

  return (
    <>
      <div className="pf-toolbar__separator" />
      <div className="pf-toolbar__group pf-toolbar__group--options">
        <label className="pf-toolbar__option">
          <span>{__('Size', 'productforge')}</span>
          <input
            type="range"
            min="1"
            max="50"
            value={drawingStrokeWidth}
            onChange={(e) => setDrawingStrokeWidth(parseInt(e.target.value, 10))}
          />
        </label>
        {activeTool === 'draw' && (
          <label className="pf-toolbar__option">
            <span>{__('Color', 'productforge')}</span>
            <input
              type="color"
              value={drawingStrokeColor}
              onChange={(e) => setDrawingStrokeColor(e.target.value)}
            />
          </label>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Integrate history into DesignerCanvas.jsx**

In DesignerCanvas.jsx, import and use the history hook. Modify the existing event handlers to push history before changes:

1. Import `useCanvasHistory` at the top.
2. Call it: `const { pushHistory, undo, redo } = useCanvasHistory(fabricRef.current, currentViewIndex);`
3. Before existing `canvas.on('object:modified', ...)` handler, add `pushHistory()` call.
4. Same for `canvas.on('object:removed', ...)`.
5. Add keyboard shortcut handler:

```javascript
useEffect(() => {
  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
    }
  };
  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [undo, redo]);
```

- [ ] **Step 5: Render Toolbar in App.jsx**

Toolbar is self-contained: it reads `historyByView` from the store to determine `canUndo`/`canRedo`, and calls undo/redo via the canvas ref already available in the store (`fabricCanvasRef`). **No props need to be passed from App.**

In App.jsx, import Toolbar and render it above the layout:

```jsx
import Toolbar from './components/Toolbar';
```

Change the layout JSX from:
```jsx
<div className="pf-designer__layout">
  <DesignerCanvas />
```
To:
```jsx
<Toolbar />
<div className="pf-designer__layout">
  <DesignerCanvas />
```

Update Toolbar.jsx accordingly — change the signature from `Toolbar({ onUndo, onRedo, canUndo, canRedo })` to `Toolbar()` and use `useCanvasHistory` inside:

```jsx
import useCanvasHistory from '../hooks/useCanvasHistory';

export default function Toolbar() {
  const { activeTool, setActiveTool, template, fabricCanvasRef, currentViewIndex, historyByView } = useDesignerStore();
  const { undo, redo } = useCanvasHistory(fabricCanvasRef, currentViewIndex);
  const vh = historyByView[currentViewIndex];
  const canUndo = vh?.undoStack?.length > 0;
  const canRedo = vh?.redoStack?.length > 0;
  // ... rest of render uses canUndo, canRedo, undo, redo directly
```

This keeps App.jsx simple and avoids prop-drilling or ref-lifting.

- [ ] **Step 6: Add toolbar CSS to designer.css**

```css
/* Toolbar */
.pf-toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
.pf-toolbar__group { display: flex; gap: 4px; }
.pf-toolbar__separator { width: 1px; height: 24px; background: #ddd; }
.pf-toolbar__btn { padding: 4px 10px; border: 1px solid #ccc; border-radius: 4px; background: white; cursor: pointer; font-size: 14px; line-height: 1; color: #333; }
.pf-toolbar__btn:hover:not(:disabled) { background: #f0f0f0; }
.pf-toolbar__btn--active { border-color: #2271b1; background: #e8f0fe; color: #2271b1; }
.pf-toolbar__btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pf-toolbar__group--options { align-items: center; gap: 8px; font-size: 12px; color: #666; }
.pf-toolbar__option { display: flex; align-items: center; gap: 4px; }
.pf-toolbar__option input[type="range"] { width: 80px; }
.pf-toolbar__option input[type="color"] { width: 28px; height: 24px; padding: 0; border: 1px solid #ccc; border-radius: 3px; cursor: pointer; }
```

- [ ] **Step 7: Build and verify**

```bash
npm run build
```

Test in browser:
- Toolbar appears above canvas with Undo/Redo buttons
- Add a text element → Undo removes it → Redo restores it
- Ctrl+Z and Ctrl+Shift+Z work
- Undo across view switches works correctly
- Draw/Erase buttons only appear if `drawing_enabled` is set (they won't yet since Task 3 adds the admin toggle)

- [ ] **Step 8: Commit**

```bash
git add frontend/js/designer/src/components/Toolbar.jsx \
       frontend/js/designer/src/hooks/useCanvasHistory.js \
       frontend/js/designer/src/store/useDesignerStore.js \
       frontend/js/designer/src/components/DesignerCanvas.jsx \
       frontend/js/designer/src/App.jsx \
       frontend/js/designer/src/designer.css
git commit -m "feat: add canvas toolbar with undo/redo support"
```

---

## Task 3: Drawing Tool

**Files:**
- Modify: `frontend/js/designer/src/components/DesignerCanvas.jsx`
- Modify: `frontend/js/designer/src/components/Toolbar.jsx`
- Modify: `admin/js/template-builder/src/components/settings/SettingsTools.jsx`
- Modify: `frontend/js/designer/src/designer.css`

**Context:** Toolbar already exists from Task 2 with Draw/Erase buttons (hidden until `drawing_enabled`). Now we implement the actual drawing logic and the admin toggle.

- [ ] **Step 1: Add drawing state to useDesignerStore.js**

Add these state keys (after existing state):

```javascript
drawingStrokeWidth: 3,
drawingStrokeColor: '#000000',

setDrawingStrokeWidth: (w) => set({ drawingStrokeWidth: w }),
setDrawingStrokeColor: (c) => set({ drawingStrokeColor: c }),
```

Also update `resetDesign` to reset these values.

- [ ] **Step 2: Add drawing mode logic to DesignerCanvas.jsx**

Add a useEffect that activates Fabric.js drawing mode when `activeTool === 'draw'`:

```javascript
// Drawing mode
useEffect(() => {
  const canvas = fabricRef.current;
  if (!canvas) return;

  if (activeTool === 'draw') {
    canvas.isDrawingMode = true;
    const brush = new fabric.PencilBrush(canvas);
    brush.color = useDesignerStore.getState().drawingStrokeColor;
    brush.width = useDesignerStore.getState().drawingStrokeWidth;
    canvas.freeDrawingBrush = brush;
  } else {
    canvas.isDrawingMode = false;
  }
}, [activeTool]);

// Update brush when stroke settings change
useEffect(() => {
  const canvas = fabricRef.current;
  if (!canvas || !canvas.freeDrawingBrush) return;
  canvas.freeDrawingBrush.color = drawingStrokeColor;
  canvas.freeDrawingBrush.width = drawingStrokeWidth;
}, [drawingStrokeColor, drawingStrokeWidth]);
```

Destructure `drawingStrokeColor` and `drawingStrokeWidth` from the store at the top of the component.

- [ ] **Step 3: Handle path:created event**

Add handler for when a drawn stroke is completed:

```javascript
canvas.on('path:created', ({ path }) => {
  // Set metadata
  path.set({ data: { elementType: 'drawing', zoneIndex: findZoneForObject(path, zones) } });

  // Apply zone clipping
  const zi = path.data.zoneIndex;
  if (zi != null) {
    applyZoneClip(canvas, path, zi);
  }

  pushHistory();
  snapshotView(currentViewIndex, canvas.toJSON(['data']));
});
```

The `findZoneForObject` helper finds which zone contains the center of the path. The `applyZoneClip` helper applies the zone's clipPath — reuse existing zone enforcement logic from the component.

- [ ] **Step 4: Implement eraser mode**

Add a useEffect for `activeTool === 'erase'`:

```javascript
useEffect(() => {
  const canvas = fabricRef.current;
  if (!canvas || activeTool !== 'erase') return;

  let hoveredPath = null;

  const handleMouseMove = (opt) => {
    const target = canvas.findTarget(opt.e);
    if (hoveredPath && hoveredPath !== target) {
      hoveredPath.set({ opacity: 1 });
      canvas.renderAll();
    }
    if (target && target.data?.elementType === 'drawing') {
      hoveredPath = target;
      target.set({ opacity: 0.4 });
      canvas.renderAll();
    } else {
      hoveredPath = null;
    }
  };

  const handleMouseDown = (opt) => {
    const target = canvas.findTarget(opt.e);
    if (target && target.data?.elementType === 'drawing') {
      pushHistory();
      canvas.remove(target);
      canvas.renderAll();
      snapshotView(currentViewIndex, canvas.toJSON(['data']));
      hoveredPath = null;
    }
  };

  canvas.on('mouse:move', handleMouseMove);
  canvas.on('mouse:down', handleMouseDown);
  canvas.defaultCursor = 'crosshair';

  return () => {
    canvas.off('mouse:move', handleMouseMove);
    canvas.off('mouse:down', handleMouseDown);
    canvas.defaultCursor = 'default';
    if (hoveredPath) {
      hoveredPath.set({ opacity: 1 });
      canvas.renderAll();
    }
  };
}, [activeTool, currentViewIndex, pushHistory, snapshotView]);
```

- [ ] **Step 5: Add drawing toggle to SettingsTools.jsx**

```jsx
import React from 'react';
import { __ } from '@wordpress/i18n';

export default function SettingsTools({ globalConfig, update }) {
  return (
    <>
      <h3 className="pf-settings__section-title">{__('Tools', 'productforge')}</h3>
      <p className="pf-settings__section-desc">{__('Configure which tools are available to customers.', 'productforge')}</p>

      <fieldset className="pf-settings__fieldset">
        <legend>{__('Drawing Tool', 'productforge')}</legend>
        <label className="pf-settings__check">
          <input
            type="checkbox"
            checked={globalConfig.drawing_enabled || false}
            onChange={(e) => update('drawing_enabled', e.target.checked)}
          />
          {__('Enable drawing tool', 'productforge')}
        </label>
        {globalConfig.drawing_enabled && (
          <div style={{ paddingLeft: 20, marginTop: 8 }}>
            <label className="pf-settings__field">
              <span>{__('Default stroke width', 'productforge')}</span>
              <input
                type="number"
                min="1"
                max="50"
                value={globalConfig.drawing_default_width || 3}
                onChange={(e) => update('drawing_default_width', parseInt(e.target.value, 10) || 3)}
              />
            </label>
            <label className="pf-settings__field">
              <span>{__('Default stroke color', 'productforge')}</span>
              <input
                type="color"
                value={globalConfig.drawing_default_color || '#000000'}
                onChange={(e) => update('drawing_default_color', e.target.value)}
              />
            </label>
          </div>
        )}
      </fieldset>
    </>
  );
}
```

- [ ] **Step 6: Build and verify**

```bash
npm run build
```

Test:
- Enable drawing tool in admin Settings → Tools
- Frontend shows Draw/Erase buttons in toolbar
- Draw freehand strokes on canvas
- Erase by clicking a stroke (hover shows opacity change)
- Undo/Redo works with drawing
- Strokes persist after save/reload

- [ ] **Step 7: Commit**

```bash
git add frontend/js/designer/src/components/DesignerCanvas.jsx \
       frontend/js/designer/src/components/Toolbar.jsx \
       frontend/js/designer/src/store/useDesignerStore.js \
       admin/js/template-builder/src/components/settings/SettingsTools.jsx \
       frontend/js/designer/src/designer.css
git commit -m "feat: add freehand drawing tool with pencil and eraser"
```

---

## Task 4: Image Filters

**Files:**
- Create: `frontend/js/designer/src/components/ImageFilters.jsx`
- Modify: `frontend/js/designer/src/components/tabs/ElementTab.jsx`
- Modify: `admin/js/template-builder/src/components/settings/SettingsTools.jsx`
- Modify: `frontend/js/designer/src/designer.css`

**Context:** ImageFilters renders inside ElementTab when an image is selected. It shows admin-selected preset buttons and adjustment sliders. Uses Fabric.js `filters` API.

- [ ] **Step 1: Create ImageFilters.jsx**

```jsx
import React, { useState, useCallback, useEffect } from 'react';
import { __ } from '@wordpress/i18n';
import { filters as FabricFilters } from 'fabric';

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

    if (preset && FabricFilters[preset]) {
      filterList.push(new FabricFilters[preset]());
    }

    Object.entries(adjs).forEach(([type, value]) => {
      if (value === 0 || value === 1 && type === 'Pixelate') return;
      const adjDef = ADJUSTMENTS.find((a) => a.type === type);
      if (adjDef && FabricFilters[type]) {
        filterList.push(new FabricFilters[type]({ [adjDef.prop]: value }));
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
        <span className="pf-filters__title">{__('Filters', 'productforge')}</span>
        <button type="button" className="pf-filters__reset" onClick={resetFilters}>
          {__('Reset', 'productforge')}
        </button>
      </div>

      {visiblePresets.length > 0 && (
        <div className="pf-filters__presets">
          <button
            type="button"
            className={`pf-filters__preset${!activePreset ? ' pf-filters__preset--active' : ''}`}
            onClick={() => { setActivePreset(null); applyFilters(null, adjustments); }}
          >
            {__('None', 'productforge')}
          </button>
          {visiblePresets.map((p) => (
            <button
              key={p.type}
              type="button"
              className={`pf-filters__preset${activePreset === p.type ? ' pf-filters__preset--active' : ''}`}
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
```

- [ ] **Step 2: Integrate ImageFilters into ElementTab.jsx**

In the `ImageProperties` component (around line 297), add the filters section after the existing SVG recolor section:

```jsx
import ImageFilters from '../ImageFilters';

// Inside ImageProperties, after the SVG recolor section:
{type === 'image' && globalConfig.filters_enabled && (
  <ImageFilters
    fabricObj={fabricObj}
    allowedFilters={globalConfig.allowed_filters || ['Brightness', 'Contrast', 'Saturation', 'Grayscale', 'Sepia']}
    snapshotView={snapshotView}
    currentViewIndex={currentViewIndex}
  />
)}
```

Pass `globalConfig` as a prop to `ImageProperties` if not already available.

- [ ] **Step 3: Add filter settings to SettingsTools.jsx**

Add below the Drawing Tool fieldset:

```jsx
<fieldset className="pf-settings__fieldset">
  <legend>{__('Image Filters', 'productforge')}</legend>
  <label className="pf-settings__check">
    <input
      type="checkbox"
      checked={globalConfig.filters_enabled || false}
      onChange={(e) => update('filters_enabled', e.target.checked)}
    />
    {__('Enable image filters', 'productforge')}
  </label>
  {globalConfig.filters_enabled && (
    <div style={{ paddingLeft: 20, marginTop: 8 }}>
      <div className="pf-settings__filter-label">{__('Available filters:', 'productforge')}</div>
      <div className="pf-settings__filter-pills">
        {ALL_FILTERS.map((f) => {
          const allowed = globalConfig.allowed_filters || DEFAULT_FILTERS;
          const checked = allowed.includes(f);
          return (
            <label key={f} className="pf-settings__filter-pill">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...allowed, f]
                    : allowed.filter((x) => x !== f);
                  update('allowed_filters', next);
                }}
              />
              {f}
            </label>
          );
        })}
      </div>
    </div>
  )}
</fieldset>
```

Where `ALL_FILTERS` and `DEFAULT_FILTERS` are constants:
```javascript
const ALL_FILTERS = ['Brightness', 'Contrast', 'Saturation', 'Grayscale', 'Sepia', 'Blur', 'Invert', 'Vintage', 'Noise', 'Pixelate', 'HueRotation', 'Vibrance', 'BlackWhite', 'Brownie', 'Kodachrome', 'Technicolor', 'Polaroid'];
const DEFAULT_FILTERS = ['Brightness', 'Contrast', 'Saturation', 'Grayscale', 'Sepia'];
```

- [ ] **Step 4: Add filter CSS to designer.css**

```css
/* Image Filters */
.pf-filters__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.pf-filters__title { font-weight: 600; font-size: 13px; }
.pf-filters__reset { font-size: 11px; color: #2271b1; background: none; border: none; cursor: pointer; }
.pf-filters__presets { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
.pf-filters__preset { padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px; background: #f9fafb; cursor: pointer; font-size: 10px; }
.pf-filters__preset--active { border-color: #2271b1; background: #e8f0fe; color: #2271b1; font-weight: 600; }
.pf-filters__slider { display: block; margin-bottom: 6px; }
.pf-filters__slider-header { display: flex; justify-content: space-between; font-size: 11px; color: #666; margin-bottom: 2px; }
.pf-filters__slider input[type="range"] { width: 100%; }
```

- [ ] **Step 5: Build and verify**

```bash
npm run build
```

Test:
- Enable image filters in admin Settings → Tools, select some filters
- Upload an image in frontend designer
- Select image → Element tab shows Filters section
- Apply presets (grayscale, sepia, etc.)
- Adjust sliders (brightness, contrast)
- Reset clears all filters
- Filters persist after save/reload
- Only admin-selected filters appear

- [ ] **Step 6: Commit**

```bash
git add frontend/js/designer/src/components/ImageFilters.jsx \
       frontend/js/designer/src/components/tabs/ElementTab.jsx \
       admin/js/template-builder/src/components/settings/SettingsTools.jsx \
       frontend/js/designer/src/designer.css
git commit -m "feat: add configurable image filters with presets and sliders"
```

---

## Task 5: Curved Text

**Files:**
- Create: `frontend/js/designer/src/utils/curvePresets.js`
- Create: `frontend/js/designer/src/components/CurvedTextProperties.jsx`
- Modify: `frontend/js/designer/src/components/tabs/AddTab.jsx`
- Modify: `frontend/js/designer/src/components/tabs/ElementTab.jsx`
- Modify: `frontend/js/designer/src/components/DesignerCanvas.jsx`
- Modify: `admin/js/template-builder/src/components/settings/SettingsTools.jsx`
- Modify: `frontend/js/designer/src/designer.css`

**Context:** Curved text uses Fabric.js IText with a `path` property. The path is generated from presets or a custom slider. Text on path is a BETA feature in Fabric.js — cursor rendering is imperfect but acceptable.

- [ ] **Step 1: Create curvePresets.js**

```javascript
/**
 * Generate SVG path strings for curved text presets.
 * @param {number} width - Text bounding width
 * @param {number} intensity - Curve intensity (-100 to 100)
 */

export function archUpPath(width, intensity = 60) {
  const h = Math.abs(intensity) * (width / 200);
  return `M 0 ${h} Q ${width / 2} ${-h * 0.5} ${width} ${h}`;
}

export function archDownPath(width, intensity = 60) {
  const h = Math.abs(intensity) * (width / 200);
  return `M 0 0 Q ${width / 2} ${h * 1.5} ${width} 0`;
}

export function wavePath(width, intensity = 60) {
  const h = Math.abs(intensity) * (width / 300);
  return `M 0 ${h} C ${width * 0.25} ${-h} ${width * 0.75} ${h * 3} ${width} ${h}`;
}

export function circlePath(width) {
  const r = width / (2 * Math.PI);
  const cx = width / 2;
  const cy = r;
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy}`;
}

export function straightPath(width) {
  return `M 0 0 L ${width} 0`;
}

export function customPath(width, intensity) {
  if (intensity >= 0) return archUpPath(width, intensity);
  return archDownPath(width, Math.abs(intensity));
}

export const PRESETS = [
  { id: 'arch-up', label: 'Arch up', generator: archUpPath },
  { id: 'arch-down', label: 'Arch down', generator: archDownPath },
  { id: 'wave', label: 'Wave', generator: wavePath },
  { id: 'circle', label: 'Circle', generator: circlePath },
  { id: 'straight', label: 'Straight', generator: straightPath },
  { id: 'custom', label: 'Custom', generator: customPath },
];
```

- [ ] **Step 2: Create CurvedTextProperties.jsx**

```jsx
import React, { useState, useCallback, useEffect } from 'react';
import { __ } from '@wordpress/i18n';
import { Path as FabricPath } from 'fabric';
import { PRESETS, customPath } from '../utils/curvePresets';

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
          <button
            key={p.id}
            type="button"
            className={`pf-curved-text__preset${preset === p.id ? ' pf-curved-text__preset--active' : ''}`}
            onClick={() => { setPreset(p.id); applyPath(p.id, intensity); }}
            title={p.label}
          >
            <PresetIcon id={p.id} />
            <span>{p.label}</span>
          </button>
        ))}
      </div>

      <label className="pf-element__field">
        <span>{__('Curve intensity', 'productforge')}</span>
        <input
          type="range"
          min="-100"
          max="100"
          value={intensity}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            setIntensity(val);
            applyPath(preset === 'custom' ? 'custom' : preset, val);
          }}
        />
      </label>

      <label className="pf-element__field">
        <span>{__('Letter spacing', 'productforge')}</span>
        <input
          type="range"
          min="-50"
          max="200"
          value={letterSpacing}
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
```

- [ ] **Step 3: Add curved text button to AddTab.jsx**

After the existing Text button (around line 48), add:

```jsx
{globalConfig.curved_text_enabled && (
  <button
    type="button"
    className={`pf-add-tools__btn${activeTool === 'add-curved-text' ? ' pf-add-tools__btn--active' : ''}`}
    onClick={() => handleToolClick('add-curved-text')}
  >
    ⌒ {__('Curved', 'productforge')}
  </button>
)}
```

Get `globalConfig` from the template: `const globalConfig = template?.global_config || {};`

- [ ] **Step 4: Add curved text tool handler to DesignerCanvas.jsx**

Add a useEffect for the `add-curved-text` tool, similar to the existing `add-text` handler:

```javascript
useEffect(() => {
  const canvas = fabricRef.current;
  if (!canvas || activeTool !== 'add-curved-text') return;

  canvas.defaultCursor = 'crosshair';

  const handleMouseDown = async (opt) => {
    const pointer = canvas.getViewportPoint(opt.e);
    const { IText, Path: FabricPath } = await import('fabric');
    const { archUpPath } = await import('../utils/curvePresets');

    const textWidth = 200;
    const pathStr = archUpPath(textWidth, 60);
    const pathObj = new FabricPath(pathStr, { visible: false });

    const text = new IText('Your text', {
      left: pointer.x,
      top: pointer.y,
      fontSize: 24,
      fontFamily: zoneFontFamily || 'Arial',
      fill: '#000000',
      path: pathObj,
      charSpacing: 0,
      data: { elementType: 'curved-text', curvePreset: 'arch-up', curveIntensity: 60, zoneIndex },
    });

    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
    setActiveTool('select');
    pushHistory();
    snapshotView(currentViewIndex, canvas.toJSON(['data']));
  };

  canvas.on('mouse:down', handleMouseDown);
  return () => {
    canvas.off('mouse:down', handleMouseDown);
    canvas.defaultCursor = 'default';
  };
}, [activeTool, currentViewIndex]);
```

- [ ] **Step 5: Render CurvedTextProperties in ElementTab.jsx**

In ElementTab, where element type is checked (around line 43), add a case for `curved-text`:

```jsx
import CurvedTextProperties from '../CurvedTextProperties';

// After the existing text properties block:
{type === 'curved-text' && (
  <>
    <CurvedTextProperties
      fabricObj={fabricObj}
      snapshotView={snapshotView}
      currentViewIndex={currentViewIndex}
    />
    <TextProperties fabricObj={fabricObj} perms={perms} globalConfig={globalConfig} snapshotView={snapshotView} currentViewIndex={currentViewIndex} />
  </>
)}
```

- [ ] **Step 6: Add curved text toggle to SettingsTools.jsx**

Add after the Drawing Tool fieldset:

```jsx
<fieldset className="pf-settings__fieldset">
  <legend>{__('Curved Text', 'productforge')}</legend>
  <label className="pf-settings__check">
    <input
      type="checkbox"
      checked={globalConfig.curved_text_enabled || false}
      onChange={(e) => update('curved_text_enabled', e.target.checked)}
    />
    {__('Enable curved text tool', 'productforge')}
  </label>
</fieldset>
```

- [ ] **Step 7: Add curved text CSS to designer.css**

```css
/* Curved Text */
.pf-curved-text__presets { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-bottom: 10px; }
.pf-curved-text__preset { padding: 6px; border: 1px solid #ddd; border-radius: 4px; background: white; cursor: pointer; text-align: center; font-size: 9px; color: #666; }
.pf-curved-text__preset--active { border-color: #2271b1; background: #e8f0fe; color: #2271b1; }
.pf-curved-text__preset svg { display: block; margin: 0 auto 2px; }
```

- [ ] **Step 8: Build and verify**

```bash
npm run build
```

Test:
- Enable curved text in admin Settings → Tools
- Frontend Add tab shows "⌒ Curved" button
- Click → click canvas → curved text appears with arch-up preset
- Select curved text → Element tab shows curve presets + intensity slider + text properties
- Switch presets (arch up, arch down, wave, circle, straight, custom)
- Adjust intensity slider
- Double-click to edit text content
- Save/reload preserves curved text with correct curve

- [ ] **Step 9: Commit**

```bash
git add frontend/js/designer/src/utils/curvePresets.js \
       frontend/js/designer/src/components/CurvedTextProperties.jsx \
       frontend/js/designer/src/components/tabs/AddTab.jsx \
       frontend/js/designer/src/components/tabs/ElementTab.jsx \
       frontend/js/designer/src/components/DesignerCanvas.jsx \
       admin/js/template-builder/src/components/settings/SettingsTools.jsx \
       frontend/js/designer/src/designer.css
git commit -m "feat: add curved text with presets and custom intensity slider"
```

---

## Task 6: Design Templates

**Files:**
- Create: `includes/Database/class-migration600.php`
- Create: `includes/Database/class-design-template-repository.php`
- Create: `includes/API/class-rest-design-templates.php`
- Create: `includes/Security/class-design-template-validator.php`
- Create: `frontend/js/designer/src/components/DesignTemplates.jsx`
- Modify: `includes/Database/class-db-manager.php`
- Modify: `includes/class-product-forge.php`
- Modify: `includes/Admin/class-admin.php`
- Modify: `frontend/js/designer/src/components/tabs/AddTab.jsx`
- Modify: `frontend/js/designer/src/api/designerApi.js`
- Modify: `admin/js/template-builder/src/components/settings/SettingsAssets.jsx`

**Context:** This is the most complex feature. It requires a new DB table, REST API, admin management page, and frontend picker. Follow existing patterns closely (model after ClipartRepository + RestClipart).

- [ ] **Step 1: Create database migration (class-migration600.php)**

```php
<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

class Migration600 {
    public static function up(): void {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();

        $wpdb->query("CREATE TABLE IF NOT EXISTS {$wpdb->prefix}pf_design_templates (
            id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            name varchar(255) NOT NULL,
            category varchar(100) NOT NULL DEFAULT '',
            thumbnail_url varchar(500) NOT NULL DEFAULT '',
            template_id bigint(20) UNSIGNED DEFAULT NULL,
            status varchar(20) NOT NULL DEFAULT 'active',
            created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_status (status),
            KEY idx_template_id (template_id)
        ) ENGINE=InnoDB {$charset}");

        $wpdb->query("CREATE TABLE IF NOT EXISTS {$wpdb->prefix}pf_design_template_views (
            id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            design_template_id bigint(20) UNSIGNED NOT NULL,
            view_index int UNSIGNED NOT NULL DEFAULT 0,
            canvas_json longtext NOT NULL,
            PRIMARY KEY (id),
            KEY idx_design_template_id (design_template_id),
            CONSTRAINT fk_dtv_dt FOREIGN KEY (design_template_id) REFERENCES {$wpdb->prefix}pf_design_templates(id) ON DELETE CASCADE
        ) ENGINE=InnoDB {$charset}");
    }
}
```

- [ ] **Step 2: Register migration in class-db-manager.php**

Add `600 => Migration600::class` to the `$migrations` array (after the existing `500 => Migration500::class`).

- [ ] **Step 3: Create DesignTemplateRepository**

Follow the pattern of `ClipartRepository`. Key methods:

```php
<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

class DesignTemplateRepository {
    public function list(string $status = 'active', ?int $template_id = null): array { /* ... */ }
    public function get(int $id): ?array { /* includes views */ }
    public function create(array $data): int { /* insert template + views */ }
    public function update(int $id, array $data): bool { /* ... */ }
    public function delete(int $id): bool { /* CASCADE handles views */ }
    public function add_view(int $design_template_id, int $view_index, string $canvas_json): int { /* ... */ }
    public function get_views(int $design_template_id): array { /* ... */ }
}
```

All queries use `$wpdb->prepare()`. Return arrays with decoded `canvas_json`.

- [ ] **Step 4: Create DesignTemplateValidator**

```php
<?php
namespace ProductForge\Security;

defined('ABSPATH') || exit;

class DesignTemplateValidator {
    private const ALLOWED_TYPES = ['IText', 'i-text', 'Image', 'image', 'Path', 'path', 'Group', 'group', 'Rect', 'rect', 'Circle', 'circle', 'Textbox', 'textbox'];
    private const MAX_IMPORT_SIZE = 5 * 1024 * 1024; // 5MB

    public function validate_import(string $json_string): array|false {
        if (strlen($json_string) > self::MAX_IMPORT_SIZE) return false;

        $data = json_decode($json_string, true);
        if (!$data || !isset($data['name'])) return false;

        // Validate views
        $views = $data['views'] ?? [];
        foreach ($views as &$view) {
            if (!isset($view['objects']) || !is_array($view['objects'])) continue;
            $view['objects'] = array_filter($view['objects'], function ($obj) {
                return isset($obj['type']) && in_array($obj['type'], self::ALLOWED_TYPES, true);
            });
            // Validate src attributes
            foreach ($view['objects'] as &$obj) {
                if (isset($obj['src'])) {
                    $obj['src'] = $this->validate_url($obj['src']);
                    if ($obj['src'] === false) unset($obj['src']);
                }
            }
        }

        $data['views'] = $views;
        return $data;
    }

    private function validate_url(string $url): string|false {
        if (str_starts_with($url, '/')) return $url; // Relative URL OK
        $site_host = wp_parse_url(site_url(), PHP_URL_HOST);
        $url_host = wp_parse_url($url, PHP_URL_HOST);
        if ($url_host === $site_host) return $url;
        return false; // External URL rejected
    }
}
```

- [ ] **Step 5: Create RestDesignTemplates controller**

Follow the pattern of `RestClipart`. Endpoints:

```php
// GET    /design-templates              — list (nonce required)
// GET    /design-templates/{id}         — get with views (nonce required)
// POST   /design-templates              — create (admin)
// PUT    /design-templates/{id}         — update (admin)
// DELETE /design-templates/{id}         — delete (admin)
// POST   /design-templates/import       — import JSON (admin)
// GET    /design-templates/{id}/export  — export JSON (admin)
```

- [ ] **Step 6: Register REST controller in class-product-forge.php**

Add to the `init_api()` method:

```php
(new API\RestDesignTemplates())->register_routes();
```

- [ ] **Step 7: Add admin menu item and management page**

**7a. PHP view file:** Create `includes/Admin/views/design-templates.php`:

```php
<?php defined('ABSPATH') || exit; ?>
<div class="wrap">
  <h1><?php esc_html_e('Design Templates', 'productforge'); ?></h1>
  <div id="pf-design-templates-app"></div>
</div>
```

**7b. Admin menu:** In `class-admin.php`, add a submenu page for "Design Templates" under the ProductForge menu. Follow the existing pattern used for the templates list page. The callback loads the view file above.

**7c. Enqueue script:** Register a new entry point `admin/js/design-templates/src/App.jsx` in `vite.config.js`. Enqueue it on the design-templates admin page only (check `$hook_suffix`).

**7d. Admin React app:** Create `admin/js/design-templates/src/App.jsx` — a CRUD management interface:

```jsx
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { __ } from '@wordpress/i18n';

// API helpers (use wpApiSettings.root + wpApiSettings.nonce from wp_localize_script)
const apiBase = `${wpApiSettings.root}pf/v1`;
const headers = { 'X-WP-Nonce': wpApiSettings.nonce, 'Content-Type': 'application/json' };

function App() {
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null); // null = list view, object = edit/create view
  const [importFile, setImportFile] = useState(null);

  const load = () => fetch(`${apiBase}/design-templates`, { headers })
    .then((r) => r.json()).then(setTemplates);

  useEffect(() => { load(); }, []);

  const handleDelete = async (id) => {
    if (!confirm(__('Delete this design template?', 'productforge'))) return;
    await fetch(`${apiBase}/design-templates/${id}`, { method: 'DELETE', headers });
    load();
  };

  const handleExport = (id) => {
    window.open(`${apiBase}/design-templates/${id}/export?_wpnonce=${wpApiSettings.nonce}`);
  };

  const handleImport = async () => {
    if (!importFile) return;
    const text = await importFile.text();
    await fetch(`${apiBase}/design-templates/import`, { method: 'POST', headers, body: text });
    setImportFile(null);
    load();
  };

  const handleSave = async (data) => {
    const method = data.id ? 'PUT' : 'POST';
    const url = data.id ? `${apiBase}/design-templates/${data.id}` : `${apiBase}/design-templates`;
    await fetch(url, { method, headers, body: JSON.stringify(data) });
    setEditing(null);
    load();
  };

  if (editing) {
    return <TemplateForm template={editing} onSave={handleSave} onCancel={() => setEditing(null)} />;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <button className="button button-primary" onClick={() => setEditing({})}>
          {__('Add New', 'productforge')}
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="file" accept=".json" onChange={(e) => setImportFile(e.target.files[0])} />
          <button className="button" onClick={handleImport} disabled={!importFile}>
            {__('Import', 'productforge')}
          </button>
        </div>
      </div>
      <table className="wp-list-table widefat striped">
        <thead><tr>
          <th>{__('Thumbnail', 'productforge')}</th>
          <th>{__('Name', 'productforge')}</th>
          <th>{__('Category', 'productforge')}</th>
          <th>{__('Views', 'productforge')}</th>
          <th>{__('Actions', 'productforge')}</th>
        </tr></thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id}>
              <td>{t.thumbnail_url ? <img src={t.thumbnail_url} style={{ width: 60 }} /> : '—'}</td>
              <td>{t.name}</td>
              <td>{t.category || '—'}</td>
              <td>{t.views?.length || 0}</td>
              <td>
                <button className="button button-small" onClick={() => setEditing(t)}>{__('Edit', 'productforge')}</button>{' '}
                <button className="button button-small" onClick={() => handleExport(t.id)}>{__('Export', 'productforge')}</button>{' '}
                <button className="button button-small button-link-delete" onClick={() => handleDelete(t.id)}>{__('Delete', 'productforge')}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// TemplateForm handles create/edit with name, category, status fields.
// For canvas JSON editing, provide a textarea per view (paste JSON).
// Keep it simple — a full canvas editor is Phase 2.
function TemplateForm({ template, onSave, onCancel }) {
  const [name, setName] = useState(template.name || '');
  const [category, setCategory] = useState(template.category || '');
  const [status, setStatus] = useState(template.status || 'active');

  return (
    <div>
      <h2>{template.id ? __('Edit Template', 'productforge') : __('New Template', 'productforge')}</h2>
      <table className="form-table">
        <tbody>
          <tr><th>{__('Name', 'productforge')}</th><td><input className="regular-text" value={name} onChange={(e) => setName(e.target.value)} /></td></tr>
          <tr><th>{__('Category', 'productforge')}</th><td><input className="regular-text" value={category} onChange={(e) => setCategory(e.target.value)} /></td></tr>
          <tr><th>{__('Status', 'productforge')}</th><td>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">{__('Active', 'productforge')}</option>
              <option value="draft">{__('Draft', 'productforge')}</option>
            </select>
          </td></tr>
        </tbody>
      </table>
      <p className="description">{__('Tip: Use Import/Export to add canvas designs. A visual canvas editor will be added in a future update.', 'productforge')}</p>
      <button className="button button-primary" onClick={() => onSave({ ...template, name, category, status })}>{__('Save', 'productforge')}</button>{' '}
      <button className="button" onClick={onCancel}>{__('Cancel', 'productforge')}</button>
    </div>
  );
}

const el = document.getElementById('pf-design-templates-app');
if (el) createRoot(el).render(<App />);
```

This gives admins a functional list + create/edit/delete + import/export interface using WordPress admin styles.

- [ ] **Step 8: Add design templates toggle to SettingsAssets.jsx**

After the existing Clip Art fieldset:

```jsx
<fieldset className="pf-settings__fieldset">
  <legend>{__('Design Templates', 'productforge')}</legend>
  <label className="pf-settings__check">
    <input
      type="checkbox"
      checked={globalConfig.design_templates_enabled || false}
      onChange={(e) => update('design_templates_enabled', e.target.checked)}
    />
    {__('Enable design templates', 'productforge')}
  </label>
  {globalConfig.design_templates_enabled && (
    <>
      <p className="pf-settings__hint">
        {__('Manage design templates from the ProductForge → Design Templates admin page.', 'productforge')}
      </p>
      <label className="pf-settings__field" style={{ marginTop: 8 }}>
        <span>{__('Restrict to specific templates (leave empty for all)', 'productforge')}</span>
        <DesignTemplateSelector
          selected={globalConfig.allowed_design_templates || []}
          onChange={(ids) => update('allowed_design_templates', ids)}
        />
      </label>
    </>
  )}
</fieldset>
```

The `DesignTemplateSelector` is a simple multi-select that fetches all design templates via the admin REST API and shows checkboxes. Follow the same pattern as the clip art CollectionManager for fetching options. Keep it lightweight — a list of checkboxes with template names.

- [ ] **Step 9: Add fetchDesignTemplates to designerApi.js**

```javascript
export async function fetchDesignTemplates(templateId, allowedIds) {
  let url = `${apiBase}/design-templates?template_id=${templateId}`;
  if (allowedIds?.length) {
    url += `&ids=${allowedIds.join(',')}`;
  }
  const resp = await fetch(url, { headers: { 'X-WP-Nonce': nonce } });
  if (!resp.ok) return [];
  return resp.json();
}
```

- [ ] **Step 10: Create DesignTemplates.jsx frontend component**

```jsx
import React, { useState, useEffect } from 'react';
import { __ } from '@wordpress/i18n';
import { fetchDesignTemplates } from '../api/designerApi';
import useDesignerStore from '../store/useDesignerStore';
import * as fabric from 'fabric';

export default function DesignTemplates({ templateId, allowedIds }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('');
  const { fabricCanvasRef, currentViewIndex, snapshotView } = useDesignerStore();

  useEffect(() => {
    fetchDesignTemplates(templateId, allowedIds).then((data) => {
      setTemplates(data);
      setLoading(false);
    });
  }, [templateId]);

  const applyTemplate = async (dt) => {
    const canvas = fabricCanvasRef;
    if (!canvas) return;

    if (!confirm(__('Apply this template? This will replace your current design elements.', 'productforge'))) return;

    // Remove user-placed objects (keep zones, overlays, backgrounds)
    const userObjects = canvas.getObjects().filter(
      (o) => !o.data?.isZone && !o.data?.isZoneOverlay && !o.data?.isBackground
    );
    userObjects.forEach((o) => canvas.remove(o));

    // Find the view JSON for the current view
    const viewData = dt.views?.find((v) => v.view_index === currentViewIndex);
    if (viewData?.objects) {
      const objects = await fabric.util.enlivenObjects(viewData.objects);
      objects.forEach((obj) => canvas.add(obj));
    }

    canvas.discardActiveObject();
    canvas.renderAll();
    snapshotView(currentViewIndex, canvas.toJSON(['data']));
  };

  if (loading) return <p style={{ color: '#999', fontSize: 12 }}>{__('Loading templates...', 'productforge')}</p>;
  if (templates.length === 0) return null;

  // Group by category
  const categories = [...new Set(templates.map((t) => t.category || 'Uncategorized'))];
  const filtered = categoryFilter
    ? templates.filter((t) => (t.category || 'Uncategorized') === categoryFilter)
    : templates;

  return (
    <div className="pf-design-templates">
      <div className="pf-add-tools__heading">{__('Design Templates', 'productforge')}</div>
      {categories.length > 1 && (
        <select
          className="pf-design-templates__category-filter"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">{__('All categories', 'productforge')}</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      )}
      <div className="pf-design-templates__grid">
        {filtered.map((dt) => (
          <button
            key={dt.id}
            type="button"
            className="pf-design-templates__item"
            onClick={() => applyTemplate(dt)}
            title={dt.name}
          >
            {dt.thumbnail_url
              ? <img src={dt.thumbnail_url} alt={dt.name} />
              : <div className="pf-design-templates__placeholder">{dt.name}</div>
            }
            <span className="pf-design-templates__name">{dt.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 11: Integrate DesignTemplates into AddTab.jsx**

After the existing tools buttons and before Clip Art:

```jsx
import DesignTemplates from '../DesignTemplates';

// In the render:
{globalConfig.design_templates_enabled && (
  <DesignTemplates templateId={template?.id} allowedIds={globalConfig.allowed_design_templates} />
)}
```

- [ ] **Step 12: Add design template CSS**

```css
/* Design Templates */
.pf-design-templates__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 14px; }
.pf-design-templates__item { padding: 0; border: 1px solid #ddd; border-radius: 4px; background: white; cursor: pointer; overflow: hidden; text-align: center; }
.pf-design-templates__item:hover { border-color: #2271b1; }
.pf-design-templates__item img { width: 100%; aspect-ratio: 4/3; object-fit: cover; }
.pf-design-templates__placeholder { width: 100%; aspect-ratio: 4/3; background: #f3f4f6; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #999; }
.pf-design-templates__name { display: block; padding: 4px; font-size: 10px; color: #666; }
.pf-design-templates__category-filter { width: 100%; padding: 4px; margin-bottom: 8px; border: 1px solid #ddd; border-radius: 3px; font-size: 11px; }
```

- [ ] **Step 13: Build and verify**

```bash
npm run build
```

Test:
- Migration creates the two new tables
- REST API endpoints work (create, list, get, update, delete, import, export)
- Admin page shows design template management
- Frontend Add tab shows design templates grid (when enabled and templates exist)
- Clicking a template replaces user elements on canvas
- Multi-view templates apply correct view JSON
- Import validates JSON structure and rejects invalid types
- Export downloads valid JSON file

- [ ] **Step 14: Commit**

```bash
git add includes/Database/class-migration600.php \
       includes/Database/class-design-template-repository.php \
       includes/API/class-rest-design-templates.php \
       includes/Security/class-design-template-validator.php \
       includes/Database/class-db-manager.php \
       includes/class-product-forge.php \
       includes/Admin/class-admin.php \
       frontend/js/designer/src/components/DesignTemplates.jsx \
       frontend/js/designer/src/components/tabs/AddTab.jsx \
       frontend/js/designer/src/api/designerApi.js \
       admin/js/template-builder/src/components/settings/SettingsAssets.jsx \
       frontend/js/designer/src/designer.css
git commit -m "feat: add design templates with admin management, import/export, and frontend picker"
```
