# Five New Features — Design Spec

## Goal

Add five features to bring ProductForge to feature-parity with Fancy Product Designer: **Undo/Redo**, **Curved Text**, **Design Templates**, **Image Filters**, and **Drawing Tool**. Each feature must be simple for customers and easy for admins to configure.

---

## 1. Undo / Redo

### Summary

Canvas-level undo/redo via a state snapshot stack. Always available — no admin toggle needed.

### Frontend UI

- **Toolbar** — new `pf-designer__toolbar` bar above the canvas (below the designer wrapper, above `pf-designer__layout`).
- Two buttons: Undo (↩) and Redo (↪), disabled when stack is empty.
- Keyboard shortcuts: `Ctrl+Z` (undo), `Ctrl+Shift+Z` (redo). Mac: `Cmd+Z` / `Cmd+Shift+Z`.

### Technical Design

- **State stack** stored in Zustand (`useDesignerStore`):
  - `undoStack: []` — array of Fabric.js JSON snapshots (via `canvas.toJSON(['data'])`)
  - `redoStack: []` — cleared on new change, populated on undo
  - `pushHistory(json)` — push current state before modification
  - `undo()` — pop undoStack, push current to redoStack, load via `canvas.loadFromJSON()`
  - `redo()` — pop redoStack, push current to undoStack, load via `canvas.loadFromJSON()`
- **Max stack size**: 30 entries (prevent memory issues). Drop oldest when exceeded.
- **Debounce**: Group rapid changes (e.g. slider drags) with 300ms debounce before pushing to stack.
- **Per-view**: Each view has its own history, stored as `historyByView: {}` in Zustand, keyed by view index. Each entry contains `{ undoStack: [], redoStack: [] }`. Switching views saves the current view's stacks and restores the target view's stacks.
- **Integration point**: Wrap existing `snapshotView()` calls — push to undo stack before snapshotting.
- **Zone/background objects**: Undo must preserve zone objects (`data.isZone`, `data.isZoneOverlay`, `data.isBackground`). After `loadFromJSON`, re-mark these objects as non-selectable.
- **JSON whitelist**: Pass snapshot through existing `filterFabricJson()` before `loadFromJSON()` for consistency with codebase rules.

### New Files

- `frontend/js/designer/src/hooks/useCanvasHistory.js` — history management hook
- `frontend/js/designer/src/components/Toolbar.jsx` — toolbar component

### Modified Files

- `frontend/js/designer/src/store/useDesignerStore.js` — add history state + actions
- `frontend/js/designer/src/components/DesignerCanvas.jsx` — integrate history push on modifications, keyboard shortcuts
- `frontend/js/designer/src/App.jsx` — render Toolbar component above layout
- `frontend/js/designer/src/designer.css` — toolbar styles

### Admin Settings

None — undo/redo is always available.

---

## 2. Drawing Tool

### Summary

Freehand pencil drawing + eraser on the canvas. Admin-toggleable per template.

### Frontend UI

- **Toolbar**: Select / Draw / Eraser toggle buttons (mutually exclusive with existing `activeTool`).
- **Drawing options** (visible when Draw or Eraser active): stroke width slider (1–50px), stroke color picker.
- Drawing creates `fabric.Path` objects that serialize normally via `toJSON()`.
- Eraser removes the last-drawn path under the cursor (not a true pixel eraser — removes whole stroke objects).

### Technical Design

- **Tool modes**: Extend `activeTool` with `'draw'` and `'erase'` values.
- **Draw mode**: Set `canvas.isDrawingMode = true`, configure `canvas.freeDrawingBrush` as `PencilBrush`.
  - `freeDrawingBrush.color` — from color picker
  - `freeDrawingBrush.width` — from slider
- **Erase mode**: Set `canvas.isDrawingMode = false`. On hover, highlight the topmost Path object under the cursor with reduced opacity to indicate which stroke will be removed. On `mouse:down`, remove that Path object.
- **Path metadata**: Set `data.elementType = 'drawing'` on created paths via `path:created` event. Assign `data.zoneIndex` based on which zone the center point falls in.
- **Zone enforcement**: Drawing paths are assigned to the zone containing their center point and clipped to that zone's boundary via `clipPath`, same as other elements. Strokes extending outside the zone are visually cropped.
- **Snapshot**: Push to undo stack + call `snapshotView()` on `path:created` and after erase.

### Admin Settings (GlobalSettings → Tools)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `drawing_enabled` | boolean | false | Master toggle |
| `drawing_default_width` | number | 3 | Default stroke width |
| `drawing_default_color` | string | '#000000' | Default stroke color |

### Frontend Config

When `template.global_config.drawing_enabled` is false, Draw/Eraser buttons are hidden in the toolbar.

### New Files

None — integrated into existing Toolbar.jsx and DesignerCanvas.jsx.

### Modified Files

- `frontend/js/designer/src/components/Toolbar.jsx` — draw/erase buttons + options
- `frontend/js/designer/src/components/DesignerCanvas.jsx` — drawing mode logic, path:created handler, erase logic
- `frontend/js/designer/src/store/useDesignerStore.js` — drawing-related state (stroke width, color)
- `admin/js/template-builder/src/components/GlobalSettings.jsx` — drawing toggle + defaults

---

## 3. Curved Text

### Summary

Text on a curved path with visual presets (arch up, arch down, wave, circle, straight) plus a custom curve slider.

### Frontend UI

- **Add tab**: "Curved Text" button (⌒) next to existing Text button. Clicking it activates `'add-curved-text'` tool mode. Next canvas click creates a curved text element.
- **Element tab** (when curved text selected): Shows curve presets as clickable SVG thumbnails + "Curve intensity" slider (-100 to +100) + "Letter spacing" slider + standard text properties (font, size, color, bold, italic).

### Technical Design

- **Fabric.js API**: Use `fabric.IText` with `path` property set to a `fabric.Path`.
  - Each preset generates a specific SVG path string (e.g., arch up = `M 0 h Q w/2 -curve h h`, arch down = `M 0 0 Q w/2 curve h 0`).
  - Custom slider adjusts the control point Y offset of a quadratic bezier.
  - Circle preset uses a full elliptical arc path.
- **Curve presets** (stored as path generator functions):
  - `arch-up` — quadratic bezier curving upward
  - `arch-down` — quadratic bezier curving downward
  - `wave` — cubic bezier with two control points (S-curve)
  - `circle` — elliptical arc (full circle)
  - `straight` — flat line (removes path, converts to regular text)
  - `custom` — quadratic bezier with admin-adjustable control point
- **Path regeneration**: When curve intensity or text width changes, regenerate the path to match the text's bounding width.
- **Metadata**: `data.elementType = 'curved-text'`, `data.curvePreset = 'arch-up'`, `data.curveIntensity = 60`.
- **JSON serialization**: Fabric.js serializes the `path` property natively. Custom metadata preserved via `toJSON(['data'])`.
- **Limitations**: No multiline support. Text editing works (IText) but cursor rendering on the curve is imperfect (Fabric.js beta feature). Acceptable for v1.

### Admin Settings (GlobalSettings → Tools)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `curved_text_enabled` | boolean | false | Master toggle |

### Frontend Config

When `template.global_config.curved_text_enabled` is false, the "Curved Text" button is hidden in the Add tab and curve properties are hidden in the Element tab.

### New Files

- `frontend/js/designer/src/utils/curvePresets.js` — path generator functions for each preset
- `frontend/js/designer/src/components/CurvedTextProperties.jsx` — preset picker + sliders

### Modified Files

- `frontend/js/designer/src/components/tabs/AddTab.jsx` — curved text button
- `frontend/js/designer/src/components/tabs/ElementTab.jsx` — render CurvedTextProperties for curved-text type
- `frontend/js/designer/src/components/DesignerCanvas.jsx` — `add-curved-text` tool handler
- `admin/js/template-builder/src/components/GlobalSettings.jsx` — toggle

---

## 4. Image Filters

### Summary

Apply visual filters (brightness, contrast, grayscale, sepia, etc.) to uploaded images. Admin selects which filters are available per template.

### Frontend UI

- **Element tab** (when image selected): New "Filters" section below existing image properties.
  - **Preset row**: Small thumbnail buttons for one-click presets (Grayscale, Sepia, Invert, Vintage, etc.). Active preset has blue border.
  - **Adjustment sliders**: Brightness (-100 to +100), Contrast (-100 to +100), Saturation (-100 to +100), Blur (0 to 100). Only shown if admin enabled them.
  - "Reset filters" button to clear all.

### Technical Design

- **Filter categories**:
  - **Presets** (one-click, mutually exclusive): Grayscale, Sepia, Invert, Vintage, BlackWhite, Brownie, Kodachrome, Technicolor, Polaroid
  - **Adjustments** (sliders, stackable): Brightness, Contrast, Saturation, Blur, Noise, Pixelate, HueRotation, Vibrance
- **Applying filters**: Build `fabricObj.filters` array from active preset + active adjustments. Call `fabricObj.applyFilters()` then `canvas.renderAll()`.
- **Preset + adjustments**: A preset and adjustments can be combined. E.g., Sepia + increased brightness.
- **Serialization**: Fabric.js serializes filters natively in `toJSON()`. Each filter has `type` and parameters. Round-trips through `loadFromJSON` correctly.
- **Admin-controlled list**: `globalConfig.allowed_filters` is an array of filter type strings. Frontend only shows filters in this list.

### Admin Settings (GlobalSettings → Tools)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `filters_enabled` | boolean | false | Master toggle |
| `allowed_filters` | string[] | `['Brightness','Contrast','Saturation','Grayscale','Sepia']` | Which filters are available |

The admin UI shows checkboxes for all available filters (pill-shaped tags). Checking/unchecking adds/removes from the array.

### Frontend Config

When `template.global_config.filters_enabled` is false, the Filters section is hidden. When enabled, only filters in `allowed_filters` are shown.

### New Files

- `frontend/js/designer/src/components/ImageFilters.jsx` — preset buttons + adjustment sliders

### Modified Files

- `frontend/js/designer/src/components/tabs/ElementTab.jsx` — render ImageFilters when image selected
- `admin/js/template-builder/src/components/GlobalSettings.jsx` — filter toggle + filter selection

---

## 5. Design Templates

### Summary

Pre-made canvas layouts that customers can apply as a starting point. Managed by admins in a separate admin page with categories, import, and export.

### Concept

A "design template" is a named Fabric.js JSON snapshot (one per view) with a thumbnail, name, and category. Admins create them by designing a canvas in the template builder and saving it as a design template. Customers see thumbnails in the Add tab and click to apply.

### Database

Two new tables, mirroring the existing `wp_pf_templates` / `wp_pf_template_views` pattern:

**`wp_pf_design_templates`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | bigint PK | Auto-increment |
| `name` | varchar(255) | Display name |
| `category` | varchar(100) | Category (e.g. "Birthday", "Wedding") |
| `thumbnail_url` | varchar(500) | Preview image URL |
| `template_id` | bigint nullable | Associated product template (null = available for all) |
| `status` | varchar(20) | 'active' or 'archived' |
| `created_at` | datetime | |
| `updated_at` | datetime | |

**`wp_pf_design_template_views`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | bigint PK | Auto-increment |
| `design_template_id` | bigint FK | References `wp_pf_design_templates.id` ON DELETE CASCADE |
| `view_index` | int | Which view this JSON applies to (0-based) |
| `canvas_json` | longtext | Fabric.js JSON (objects only, no zones/backgrounds) |

This supports multi-view design templates. A design template for a front+back product has two rows in `wp_pf_design_template_views` (view_index 0 and 1). When applying, the frontend loads the correct JSON per view.

### Admin: Separate Management Page

New admin page under **ProductForge → Design Templates** (similar pattern to Templates list page).

| Action | Description |
|--------|-------------|
| **Create** | Opens a simplified canvas editor. Admin places elements, clicks "Save as Design Template". Enters name + category. Thumbnail auto-generated. |
| **Edit** | Change name, category, thumbnail. Re-open canvas to modify layout. |
| **Delete** | Remove design template. |
| **Export** | Download as `.json` file containing name, category, and canvas JSON. |
| **Import** | Upload `.json` file. Validates JSON structure (whitelist allowed object types per CLAUDE.md security rules). Creates new design template. |
| **Bulk export** | *(Phase 2)* Select multiple, download as single `.json` file with array of templates. |
| **Bulk import** | *(Phase 2)* Upload file with multiple templates, each validated individually. |

### Admin: Template Builder Integration (Settings → Assets)

Per product template, admin configures:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `design_templates_enabled` | boolean | false | Master toggle |
| `allowed_design_templates` | int[] | `[]` | IDs of available design templates. Empty = all active templates available. |

### REST API

New endpoints under `pf/v1`:

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/design-templates` | Public | List active templates (filtered by template_id if provided) |
| `GET` | `/design-templates/{id}` | Public | Get single template with canvas JSON |
| `POST` | `/design-templates` | Admin | Create new design template |
| `PUT` | `/design-templates/{id}` | Admin | Update design template |
| `DELETE` | `/design-templates/{id}` | Admin | Delete design template |
| `POST` | `/design-templates/import` | Admin | Import from JSON file |
| `GET` | `/design-templates/{id}/export` | Admin | Export as JSON download |

### Frontend UI

- **Add tab**: "Design Templates" section showing thumbnail grid (2 columns).
- Thumbnails fetched from `GET /design-templates?template_id={current_template_id}` on mount.
- Click applies template: confirms with user ("Apply template? This will replace your current design."), then:
  1. Remove all user-placed objects (keep zones, overlays, backgrounds)
  2. Deserialize template objects via `fabric.util.enlivenObjects(json.objects)`
  3. Add objects to canvas, assign `zoneIndex` based on position
  4. Snapshot + push to undo stack
- Category filter dropdown if multiple categories exist.

### Security

- **Import validation**: Whitelist allowed Fabric.js object types (`IText`, `Image`, `Path`, `Group`, `Rect`, `Circle`). Reject unknown types.
- **SVG sanitization**: Any SVG data in imported templates run through the same sanitization as uploads.
- **URL validation**: Validate `src` attributes in imported objects — allow only relative URLs or URLs pointing to the same WordPress site (`site_url()`). Reject external domain URLs. Reject `data:` URIs for images (except small inline SVGs under 10KB).
- **Import size limit**: Maximum import file size of 5MB. Validate before `json_decode()`.

### New Files

- `includes/Database/class-design-template-repository.php` — CRUD for design templates
- `includes/Database/class-migration600.php` — migration
- `includes/API/class-rest-design-templates.php` — REST controller
- `includes/Security/class-design-template-validator.php` — JSON import validation
- `includes/Admin/views/design-templates.php` — admin list page HTML
- `admin/js/design-templates/` — small React app for the management page (or reuse template-builder patterns)
- `frontend/js/designer/src/components/DesignTemplates.jsx` — frontend template picker

### Modified Files

- `includes/class-product-forge.php` — register new REST controller, admin page
- `includes/Admin/class-admin.php` — add menu item, enqueue assets for design templates page
- `includes/Database/class-db-manager.php` — register migration
- `frontend/js/designer/src/components/tabs/AddTab.jsx` — render DesignTemplates section
- `frontend/js/designer/src/api/designerApi.js` — API call to fetch design templates
- `admin/js/template-builder/src/components/GlobalSettings.jsx` — toggle + template selection

---

## 6. Admin Settings Reorganization

### Summary

Split the existing GlobalSettings single-scroll panel into sub-sections with a left-side mini-navigation.

### Sub-sections

| Section | Config keys (existing + new) |
|---------|------------------------------|
| **General** | `require_customization`, `solid_color` |
| **Colors** | `product_colors_enabled`, `product_color_mode`, `product_color_palette_id`, `product_allowed_colors`, `element_colors_enabled`, `element_color_mode`, `element_color_palette_id`, `element_allowed_colors` + palette manager |
| **Fonts** | `fonts_enabled`, `allowed_fonts` + custom font upload |
| **Tools** | `drawing_enabled`, `drawing_default_width`, `drawing_default_color`, `curved_text_enabled`, `filters_enabled`, `allowed_filters` |
| **Assets** | `clipart_enabled`, `clipart_recolor`, `clipart_collections`, `design_templates_enabled`, `allowed_design_templates` |
| **Uploads** | `upload_max_size`, `upload_min_width`, `upload_min_height`, `upload_min_dpi`, `upload_allowed_types` |
| **Pricing** | `pricing_mode`, `pricing_per_element`, `pricing_tiers`, `pricing_cap` |
| **Permissions** | `permissions.text.*`, `permissions.image.*`, `permissions.svg.*` |

### Technical Design

- `GlobalSettings.jsx` gets a `activeSection` state (default: `'general'`).
- Left sidebar with section buttons. Clicking sets `activeSection`.
- Each section renders as a separate component (extracted from current GlobalSettings):
  - `SettingsGeneral.jsx`, `SettingsColors.jsx`, `SettingsFonts.jsx`, `SettingsTools.jsx`, `SettingsAssets.jsx`, `SettingsUploads.jsx`, `SettingsPricing.jsx`, `SettingsPermissions.jsx`
- All sub-components receive `globalConfig` + `update` function as props (same pattern as now).
- Existing code is reorganized, not rewritten. Each fieldset moves to its sub-component.

### Modified Files

- `admin/js/template-builder/src/components/GlobalSettings.jsx` — add section nav, render active section

### New Files

- `admin/js/template-builder/src/components/settings/SettingsGeneral.jsx`
- `admin/js/template-builder/src/components/settings/SettingsColors.jsx`
- `admin/js/template-builder/src/components/settings/SettingsFonts.jsx`
- `admin/js/template-builder/src/components/settings/SettingsTools.jsx`
- `admin/js/template-builder/src/components/settings/SettingsAssets.jsx`
- `admin/js/template-builder/src/components/settings/SettingsUploads.jsx`
- `admin/js/template-builder/src/components/settings/SettingsPricing.jsx`
- `admin/js/template-builder/src/components/settings/SettingsPermissions.jsx`

---

## 7. Export Considerations

All five features must serialize correctly for PDF, PNG, and SVG export.

| Feature | Export behavior |
|---------|---------------|
| **Undo/Redo** | No impact — exports use the saved canvas JSON, not history |
| **Drawing** | Path objects export natively (SVG path data) |
| **Curved text** | Text on path exports as SVG `<textPath>` in SVG export. PDF/PNG: render via Fabric.js toDataURL then embed |
| **Image filters** | Filters are applied at render time. Export captures the filtered result (Fabric.js `toDataURL` includes filters). PNG export via Imagick uses the filtered canvas output. |
| **Design templates** | No impact — templates produce standard Fabric.js objects that export normally |

### Known limitation

Curved text in PDF export may require special handling. TCPDF does not natively support text-on-path. Approach: render the curved text view as a rasterized image (via Fabric.js `toDataURL`) and embed as image in PDF. This maintains visual fidelity at the cost of text not being selectable in the PDF.

---

## 8. Mobile Considerations

| Feature | Mobile behavior |
|---------|----------------|
| **Toolbar** | Compact layout: undo/redo as icon-only buttons. Draw/erase buttons smaller. Drawing options collapse to a popover. |
| **Drawing** | Touch drawing works natively (Fabric.js PencilBrush supports touch events). |
| **Curved text** | Presets work well on mobile (tap to select). Slider for intensity works with touch. |
| **Image filters** | Preset thumbnails work well on mobile. Sliders work with touch. |
| **Design templates** | Thumbnail grid adapts to 2 columns (same as desktop). |

---

## 9. Implementation Order

Features should be implemented in this order based on dependencies:

1. **Admin Settings Reorganization** — creates the structure for new settings
2. **Undo/Redo** — foundation (toolbar component, history system) used by all other features
3. **Drawing Tool** — extends toolbar, simple Fabric.js API
4. **Image Filters** — extends Element tab, simple Fabric.js API
5. **Curved Text** — most complex Fabric.js integration
6. **Design Templates** — most complex overall (new DB table, REST API, admin page, frontend)
