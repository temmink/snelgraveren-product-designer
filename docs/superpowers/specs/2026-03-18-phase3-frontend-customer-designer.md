# Phase 3: Frontend Customer Designer

**Date:** 2026-03-18
**Status:** Approved for implementation
**Scope:** Fabric.js-based customer designer embedded on WooCommerce product pages — text, image upload, SVG upload tools; zone enforcement; manual save; three display modes.

---

## 1. Architecture Overview

### New PHP file
```
includes/Frontend/class-frontend.php
```

### New REST route
```
GET /pd/v1/templates/{id}/public   — unauthenticated; published templates only
```

### New JS files (`frontend/js/designer/src/`)
```
App.jsx                            — replaces placeholder; layout, load, init
store/useDesignerStore.js          — Zustand store
api/designerApi.js                 — API helpers
components/DesignerCanvas.jsx      — Fabric.js canvas
components/Sidebar.jsx             — Tab wrapper
components/tabs/AddTab.jsx         — Tool buttons
components/tabs/ElementTab.jsx     — Contextual element properties
components/tabs/ViewsTab.jsx       — View switcher
```

### Data flow
`window.pdDesigner` (PHP-localized) → `App.jsx` fetches `/templates/{id}/public` → initializes `useDesignerStore` → `DesignerCanvas` renders zones and handles tools → customer edits → "Save Design" writes to `POST /pd/v1/designs` + `POST /pd/v1/designs/{hash}/views`.

---

## 2. PHP — Frontend Class & Public Template Endpoint

### `includes/Frontend/class-frontend.php`

Hooks:
- `wp_enqueue_scripts` — enqueues `frontend-designer` JS/CSS only on product pages where `_pd_designer_enabled` meta is set. Localizes `window.pdDesigner`:
  ```js
  {
    template_id:     int,
    product_id:      int,      // current WC product ID
    display_mode:    'embedded' | 'modal' | 'full-page',
    nonce:           string,   // wp_create_nonce('wp_rest')
    api_base:        string,   // rest_url('pd/v1')
    currency_symbol: string,
  }
  ```
- `woocommerce_before_add_to_cart_button` — renders `<div id="pd-designer-root" data-mode="{mode}">`. For `modal` mode, also renders a "Customize Product" `<button class="pd-open-designer">`.
- `woocommerce_add_cart_item_data` — stub, returns data unchanged (Phase 4 attaches design_hash here).

### New product meta field
`_pd_display_mode` — values: `embedded` | `modal` | `full-page`. Phase 3 reads it with fallback `embedded`. Admin UI setting deferred to Phase 4.

### `GET /pd/v1/templates/{id}/public`
Added to `RestTemplates::register_routes()`:
- `permission_callback`: `__return_true`
- Guard: template `status` must equal `'published'`; otherwise `WP_Error('not_found', …, 404)`
- Response fields: `id`, `title`, `global_config` (JSON-decoded), `views[]`
- Each view includes: `id`, `name`, `canvas_width`, `canvas_height`, `background_url`, `zones_config`, `layers_config`
- Excludes: `created_at`, `updated_at`, and any internal fields

Existing admin routes remain unchanged and admin-only.

---

## 3. Zustand Store — `useDesignerStore`

```js
{
  // Template config (read-only after load)
  template: null,            // response from /templates/{id}/public

  currentViewIndex: 0,

  // Design
  designHash: null,          // null until first save
  isSaving: false,
  isDirty: false,

  // Per-view canvas state, keyed by view index
  canvasSnapshots: {},       // { [viewIndex]: fabricJSON }

  // Tool
  activeTool: 'select',      // 'select' | 'add-text' | 'add-image' | 'add-svg'

  // Selected element (drives ElementTab)
  selectedObject: null,      // { type: 'text'|'image'|'svg', props: {} } | null
}
```

**Actions:** `loadTemplate(data)`, `setCurrentViewIndex(i)`, `setActiveTool(tool)`, `setSelectedObject(obj)`, `setDesignHash(hash)`, `setIsSaving(v)`, `setIsDirty(v)`, `snapshotView(viewIndex, json)`.

No undo/redo — out of scope for Phase 3.

`snapshotView` is called on `object:modified` and `object:removed`. For element additions, `snapshotView` is called at the end of the add-element flow (after zone assignment and permission properties are applied), not in the `object:added` event handler — this avoids capturing incomplete state. On view switch, the outgoing view is snapshotted, the incoming view is restored from `canvasSnapshots` if available, otherwise initialized fresh from the template view config.

---

## 4. DesignerCanvas

### Zone rendering
Rendered as non-selectable `Rect` overlays on Fabric canvas init, layered above background image and below customer elements:

| Zone behavior | Style |
|---|---|
| `restrict` | Solid blue border `#3b82f6`, fill `rgba(59,130,246,0.08)` |
| `suggest`  | Dashed grey border `#9ca3af`, no fill |

### Zone enforcement (`restrict` only)
Each element added to a `restrict` zone gets `data.zoneIndex` stamped on it at creation. Handlers on `object:moving` and `object:scaling` clamp the object's bounding box so it cannot leave its assigned zone. Scaling is clamped so the resulting bounding box fits within zone bounds.

Elements placed in a `suggest` zone or on a view with no zones move freely.

### Tool modes
- `add-text`: on next canvas click, adds `IText("Your text here")` at click point. Zone assignment: if click is inside a `restrict` zone whose `allowed_types` includes `'text'`, element is assigned to that zone. Resets to `select` after add.
- `add-image`: clicking tool triggers `<input type="file" accept="image/jpeg,image/png,image/webp,image/gif">`. On file select, `POST /pd/v1/uploads` → add `FabricImage`. Zone assignment: centered on the first `restrict` zone whose `allowed_types` includes `'image'`; if no matching zone exists, centered on the full canvas. Resets to `select` after add.
- `add-svg`: clicking tool triggers `<input type="file" accept="image/svg+xml">`. Same upload and zone assignment flow as `add-image` (using `'svg'` type). Resets to `select` after add.

If a view's zones have no zone with `allowed_types` including the tool's type, the tool button is disabled.

### Permissions (from `globalConfig.permissions[type]`)

| Permission | Fabric enforcement |
|---|---|
| `resize: false` | `hasControls: false` |
| `rotate: false` | Hide rotation control (verify Fabric.js 6.x control name — may differ from v5 `'mtr'`) |
| `delete: false` | Delete key handler skipped for that object |
| `min_scale` / `max_scale` | Enforced on `object:scaling` |
| `snap_to_grid: true` | `object:moving` snaps left/top to nearest `grid_size` |

### Fabric JSON validation
Before `loadFromJSON` (snapshot restore), allowed object types are whitelisted to `['i-text', 'image', 'rect']`. Any object with a type outside this list is stripped before load.

---

## 5. Sidebar

### `Sidebar.jsx`
Three tabs: **Add**, **Element**, **Views**. Auto-switches to **Element** when `selectedObject` is non-null; switches back to **Add** on deselection.

### `AddTab.jsx`
- Three tool buttons: Text, Image, SVG
- Active tool highlighted
- Clicking active tool resets to `select`
- Disabled with tooltip if current view has no zone permitting that type

### `ElementTab.jsx`
Shown only when an object is selected.

**Text:**
- Font family `<select>` — from `globalConfig.allowed_fonts`; hidden if `change_font: false` or list empty
- Font size `<input type="number">`
- Color picker — if `recolor: true`; restricted to `allowed_colors` unless `any_color: true`
- Bold / Italic toggles
- Delete button — if `delete: true`

**Image / SVG:**
- Read-only scale % display
- Color picker (SVG only, if `recolor: true`)
- Delete button — if `delete: true`

Changes fire directly on the Fabric object, then `canvas.renderAll()` + `snapshotView`.

### `ViewsTab.jsx`
List of view name buttons from `template.views`. Clicking switches `currentViewIndex` (with snapshot of outgoing view). Active view highlighted.

---

## 6. Save Flow

"Save Design" button: below sidebar, disabled while `isSaving` or `!isDirty`.

1. If no `designHash`: `POST /pd/v1/designs` with `{ template_id, product_id }` → store `response.design_hash`
2. For each view with a snapshot in `canvasSnapshots`: `POST /pd/v1/designs/{hash}/views` with `{ view_id, canvas_json, thumbnail: '' }`
   - Thumbnail left empty in Phase 3; populated in Phase 5
3. Set `isDirty = false`, `isSaving = false`
4. Store `designHash` in a hidden `<input name="pd_design_hash">` inside the WooCommerce add-to-cart form — Phase 4 reads it

Errors surface as a dismissible inline message above the Save button.

---

## 7. Display Modes

Read from `window.pdDesigner.display_mode`:

| Mode | Behavior |
|---|---|
| `embedded` | Designer renders inline below product images |
| `modal` | Mounted but hidden; "Customize Product" button toggles `.pd-designer--open` CSS class showing a fixed overlay; close button inside modal hides it |
| `full-page` | Deferred to Phase 4 (requires WP page registration + template) |

**CSS isolation:** `.pd-designer { all: initial; box-sizing: border-box; }`. All classes use `pd-` prefix with BEM naming.

---

## 8. Security

- `/templates/{id}/public` only returns `published` templates — draft/archived templates are never exposed to customers
- Fabric JSON whitelisting (`['i-text', 'image', 'rect']`) before `loadFromJSON` to prevent malicious canvas payloads
- Uploads go through existing `UploadValidator` (MIME via `finfo_file`, SVG sanitized via `enshrined/svg-sanitize`, rate-limited 10/min)
- Design ownership enforced in `RestDesigns` via `owns_design()` (customer_id or session_id match)
- Nonce sent on all **mutating** REST requests via `X-WP-Nonce` header (public read-only endpoints like `/templates/{id}/public` do not require nonce)
- `RestDesigns::create_design()` must validate that the supplied `template_id` references a published template; reject with 400 otherwise

---

## Pre-existing Issue (Not Phase 3 Scope)

`RestDesigns::admin_list()` uses `$wpdb` directly instead of `DesignRepository`, violating CLAUDE.md. Should be fixed separately but does not block Phase 3.

---

## Out of Scope for Phase 3

- Full-page display mode (Phase 4)
- Admin UI for `_pd_display_mode` setting (Phase 4)
- Design surcharge / price calculation (Phase 4)
- Export thumbnails (Phase 5)
- Undo/redo for customer canvas
- Cloud imports, 3D preview, AI image generation, QR codes
