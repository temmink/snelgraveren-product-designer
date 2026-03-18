# Phase 3: Frontend Customer Designer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a customer-facing Fabric.js designer on WooCommerce product pages — text/image/SVG tools, zone enforcement, manual save, embedded/modal display modes.

**Architecture:** PHP `Frontend` class hooks into WooCommerce product page to render a React app mount point and localize config. A new public REST endpoint serves published template data. React frontend uses Zustand for state, Fabric.js 6.x for canvas, and a sidebar with tool/element/view tabs.

**Tech Stack:** PHP 8.2, WordPress 6.7, WooCommerce 10.6, React 18, Zustand 4, Fabric.js 6.x, Vite 5

**Spec:** `docs/superpowers/specs/2026-03-18-phase3-frontend-customer-designer.md`

**Field name notes (from codebase exploration):**
- Template views use `name` (not `label`) and `background_url` (not `background_image_url`)
- `DesignRepository::create()` returns the insert ID — call `get()` or `get_by_hash()` after to get the full row with `design_hash`
- `RestDesigns::create_design()` already calls `$this->repo->get($id)` after insert, so the response includes `design_hash`
- Upload endpoint returns `{ url: "..." }` on success (201)
- API classes register routes inside the `rest_api_init` callback in `class-product-designer.php`

---

## Task 0: Fix Vite CSS Output Path

**Files:**
- Modify: `vite.config.js`

The current `assetFileNames: 'assets/[name]-[hash][extname]'` outputs CSS to `dist/assets/[name]-[hash].css`, but the PHP enqueue expects `dist/[name].css`. Both admin (`class-admin.php:80`) and frontend need predictable paths.

- [ ] **Step 1: Update assetFileNames**

Change `assetFileNames` from `'assets/[name]-[hash][extname]'` to `'[name][extname]'`:

```js
output: {
  entryFileNames: '[name].js',
  chunkFileNames: 'chunks/[name]-[hash].js',
  assetFileNames: '[name][extname]',
},
```

This puts CSS at `dist/frontend-designer.css` and `dist/admin-template-builder.css` — matching what the PHP enqueue expects.

- [ ] **Step 2: Build and verify**

```bash
npm run build
ls dist/*.css
# Expected: dist/frontend-designer.css dist/admin-template-builder.css
```

- [ ] **Step 3: Commit**

```bash
git add vite.config.js
git commit -m "fix: output CSS without hash for predictable enqueue paths"
```

---

## Task 1: Public Template Endpoint

**Files:**
- Modify: `includes/API/class-rest-templates.php`

Add `GET /pd/v1/templates/{id}/public` — unauthenticated, returns published templates only with sanitized fields.

- [ ] **Step 1: Add the route registration**

In `register_routes()`, add after the existing `templates/(?P<id>\d+)` block:

```php
register_rest_route($ns, '/templates/(?P<id>\d+)/public', [
    ['methods' => 'GET', 'callback' => [$this, 'get_public_template'], 'permission_callback' => '__return_true'],
]);
```

- [ ] **Step 2: Implement `get_public_template` method**

```php
public function get_public_template(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
    $template = $this->repo->get((int) $request['id']);
    if (!$template || ($template['status'] ?? '') !== 'published') {
        return new \WP_Error('not_found', 'Template not found.', ['status' => 404]);
    }

    $views = $this->repo->get_views((int) $template['id']);
    $sanitized_views = array_map(function ($v) {
        return [
            'id'              => (int) $v['id'],
            'name'            => $v['name'] ?? '',
            'canvas_width'    => (int) ($v['canvas_width'] ?? 800),
            'canvas_height'   => (int) ($v['canvas_height'] ?? 600),
            'background_url'  => $v['background_url'] ?? '',
            'zones_config'    => is_string($v['zones_config'] ?? '') ? json_decode($v['zones_config'], true) : ($v['zones_config'] ?? []),
            'layers_config'   => is_string($v['layers_config'] ?? '') ? json_decode($v['layers_config'], true) : ($v['layers_config'] ?? []),
        ];
    }, $views);

    $global_config = $template['global_config'] ?? '{}';
    if (is_string($global_config)) {
        $global_config = json_decode($global_config, true) ?: [];
    }

    return rest_ensure_response([
        'id'            => (int) $template['id'],
        'title'         => $template['title'],
        'global_config' => $global_config,
        'views'         => $sanitized_views,
    ]);
}
```

- [ ] **Step 3: Verify endpoint manually**

```bash
# Create a published template via admin if none exists, then:
curl -s http://localhost:8080/wp-json/pd/v1/templates/1/public | jq .

# Should return template data if published, or 404 if draft
```

- [ ] **Step 4: Verify draft templates are hidden**

```bash
# Set template status to draft via admin, then:
curl -s http://localhost:8080/wp-json/pd/v1/templates/1/public
# Should return 404
```

- [ ] **Step 5: Commit**

```bash
git add includes/API/class-rest-templates.php
git commit -m "feat: add public template endpoint for customer designer"
```

---

## Task 2: Template Validation in `create_design`

**Files:**
- Modify: `includes/API/class-rest-designs.php`

Guard: `create_design()` must verify `template_id` references a published template.

- [ ] **Step 1: Add template validation**

Add at the top of `create_design()`, after the existing `template_id` check:

```php
$template_repo = new \ProductDesigner\Database\TemplateRepository();
$template = $template_repo->get((int) $body['template_id']);
if (!$template || ($template['status'] ?? '') !== 'published') {
    return new \WP_Error('invalid_template', 'Template not found or not published.', ['status' => 400]);
}
```

- [ ] **Step 2: Add `use` statement**

Ensure at top of file:
```php
use ProductDesigner\Database\TemplateRepository;
```

And update the validation to use just `TemplateRepository`:
```php
$template_repo = new TemplateRepository();
```

- [ ] **Step 3: Verify**

```bash
# Try creating a design with a non-existent template_id:
curl -s -X POST http://localhost:8080/wp-json/pd/v1/designs \
  -H "Content-Type: application/json" \
  -d '{"template_id": 99999}' | jq .
# Should return 400 error
```

- [ ] **Step 4: Commit**

```bash
git add includes/API/class-rest-designs.php
git commit -m "feat: validate template_id is published before creating design"
```

---

## Task 3: Frontend PHP Class

**Files:**
- Create: `includes/Frontend/class-frontend.php`
- Modify: `includes/class-product-designer.php`

Register the Frontend class that enqueues assets and renders the designer container on WooCommerce product pages.

- [ ] **Step 1: Create `includes/Frontend/class-frontend.php`**

```php
<?php
namespace ProductDesigner\Frontend;

defined('ABSPATH') || exit;

class Frontend {

    public function init(): void {
        add_action('wp_enqueue_scripts', [$this, 'enqueue_assets']);
        add_action('woocommerce_before_add_to_cart_button', [$this, 'render_designer']);
        add_filter('woocommerce_add_cart_item_data', [$this, 'add_cart_item_data'], 10, 2);
    }

    /**
     * Stub for Phase 4 — attach design_hash to cart item data.
     */
    public function add_cart_item_data(array $cart_item_data, int $product_id): array {
        return $cart_item_data;
    }

    public function enqueue_assets(): void {
        if (!is_product()) {
            return;
        }

        global $post;
        $product_id = $post->ID;

        if (!get_post_meta($product_id, '_pd_designer_enabled', true)) {
            return;
        }

        $template_id = (int) get_post_meta($product_id, '_pd_template_id', true);
        if (!$template_id) {
            return;
        }

        $dist_path = PD_PLUGIN_DIR . 'dist/';
        $dist_url  = PD_PLUGIN_URL . 'dist/';

        // Enqueue JS
        $js_file = 'frontend-designer.js';
        if (file_exists($dist_path . $js_file)) {
            wp_enqueue_script(
                'pd-frontend-designer',
                $dist_url . $js_file,
                [],
                PD_VERSION,
                true
            );

            wp_localize_script('pd-frontend-designer', 'pdDesigner', [
                'template_id'     => $template_id,
                'product_id'      => $product_id,
                'display_mode'    => get_post_meta($product_id, '_pd_display_mode', true) ?: 'embedded',
                'nonce'           => wp_create_nonce('wp_rest'),
                'api_base'        => rest_url('pd/v1'),
                'currency_symbol' => function_exists('get_woocommerce_currency_symbol')
                    ? get_woocommerce_currency_symbol()
                    : '€',
            ]);
        }

        // Enqueue CSS if present
        $css_file = 'frontend-designer.css';
        if (file_exists($dist_path . $css_file)) {
            wp_enqueue_style(
                'pd-frontend-designer',
                $dist_url . $css_file,
                [],
                PD_VERSION
            );
        }
    }

    public function render_designer(): void {
        if (!is_product()) {
            return;
        }

        global $post;
        if (!get_post_meta($post->ID, '_pd_designer_enabled', true)) {
            return;
        }

        $mode = get_post_meta($post->ID, '_pd_display_mode', true) ?: 'embedded';
        echo '<div id="pd-designer-root" data-mode="' . esc_attr($mode) . '"></div>';

        if ($mode === 'modal') {
            echo '<button type="button" class="pd-open-designer button">Customize Product</button>';
        }
    }
}
```

- [ ] **Step 2: Register Frontend in main plugin class**

In `includes/class-product-designer.php`, in the `init()` method, add the frontend init for non-admin context:

```php
if (!is_admin()) {
    $frontend = new Frontend\Frontend();
    $frontend->init();
}
```

Ensure `PD_PLUGIN_DIR` and `PD_PLUGIN_URL` constants exist in `product-designer.php`. Check the bootstrap file — they should already be defined there. If they use different names, match the existing constants.

- [ ] **Step 3: Verify constants**

```bash
# Check what constants are defined in the bootstrap file:
grep -n 'define(' product-designer.php
```

Update `class-frontend.php` if the constant names differ (e.g., `PRODUCT_DESIGNER_DIR` instead of `PD_PLUGIN_DIR`).

- [ ] **Step 4: Verify assets enqueue on a product page**

1. In WP admin, edit a product and set `_pd_designer_enabled = 1` and `_pd_template_id = 1` via Custom Fields
2. Visit the product page in the frontend
3. View page source — verify `pd-frontend-designer` script is enqueued and `window.pdDesigner` config object is present
4. Verify `<div id="pd-designer-root">` is rendered before the add-to-cart button

- [ ] **Step 5: Commit**

```bash
git add includes/Frontend/class-frontend.php includes/class-product-designer.php
git commit -m "feat: add Frontend class for designer asset loading and container rendering"
```

---

## Task 4: Zustand Store

**Files:**
- Create: `frontend/js/designer/src/store/useDesignerStore.js`

- [ ] **Step 1: Create the store**

```js
import { create } from 'zustand';

const useDesignerStore = create((set) => ({
  // Template config (read-only after load)
  template: null,

  currentViewIndex: 0,

  // Design state
  designHash: null,
  isSaving: false,
  isDirty: false,

  // Per-view canvas state
  canvasSnapshots: {},

  // Tool mode
  activeTool: 'select',

  // Selected element
  selectedObject: null,

  // Error message
  error: null,

  // File upload trigger (set by DesignerCanvas, called by AddTab)
  triggerFileUpload: null,

  // Actions
  loadTemplate: (data) => set({ template: data, currentViewIndex: 0 }),

  setCurrentViewIndex: (i) => set({ currentViewIndex: i }),

  setActiveTool: (tool) => set({ activeTool: tool }),

  setSelectedObject: (obj) => set({ selectedObject: obj }),

  setDesignHash: (hash) => set({ designHash: hash }),

  setIsSaving: (v) => set({ isSaving: v }),

  setIsDirty: (v) => set({ isDirty: v }),

  setError: (msg) => set({ error: msg }),

  clearError: () => set({ error: null }),

  snapshotView: (viewIndex, json) =>
    set((s) => ({
      canvasSnapshots: { ...s.canvasSnapshots, [viewIndex]: json },
      isDirty: true,
    })),

  setTriggerFileUpload: (fn) => set({ triggerFileUpload: fn }),
}));

export default useDesignerStore;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/js/designer/src/store/useDesignerStore.js
git commit -m "feat: add useDesignerStore Zustand store for customer designer"
```

---

## Task 5: API Helper

**Files:**
- Create: `frontend/js/designer/src/api/designerApi.js`

- [ ] **Step 1: Create the API module**

```js
const config = window.pdDesigner || {};

function apiUrl(path) {
  return `${config.api_base}${path}`;
}

function headers(includeNonce = true) {
  const h = { 'Content-Type': 'application/json' };
  if (includeNonce && config.nonce) {
    h['X-WP-Nonce'] = config.nonce;
  }
  return h;
}

export async function loadTemplate(templateId) {
  const res = await fetch(apiUrl(`/templates/${templateId}/public`));
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to load template');
  }
  return res.json();
}

export async function createDesign(templateId, productId) {
  const res = await fetch(apiUrl('/designs'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ template_id: templateId, product_id: productId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to create design');
  }
  return res.json();
}

export async function saveDesignView(designHash, viewId, canvasJson) {
  const res = await fetch(apiUrl(`/designs/${designHash}/views`), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      view_id: viewId,
      canvas_json: canvasJson,
      thumbnail: '',
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to save view');
  }
  return res.json();
}

export async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(apiUrl('/uploads'), {
    method: 'POST',
    headers: config.nonce ? { 'X-WP-Nonce': config.nonce } : {},
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Upload failed');
  }
  return res.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/js/designer/src/api/designerApi.js
git commit -m "feat: add designerApi module for REST calls"
```

---

## Task 6: DesignerCanvas — Canvas Init, Zone Rendering, Zone Enforcement

**Files:**
- Create: `frontend/js/designer/src/components/DesignerCanvas.jsx`

This is the largest task. It creates the Fabric.js canvas, renders zone overlays, enforces restrict-zone boundaries, handles tool modes (add-text, add-image, add-svg), applies permissions, and validates Fabric JSON on snapshot restore.

- [ ] **Step 1: Create canvas with zone rendering**

```jsx
import React, { useRef, useEffect, useCallback } from 'react';
import { Canvas as FabricCanvas, Rect, IText, FabricImage } from 'fabric';
import useDesignerStore from '../store/useDesignerStore';
import { uploadFile } from '../api/designerApi';

const ALLOWED_FABRIC_TYPES = ['i-text', 'image', 'rect'];

function filterFabricJson(json) {
  if (!json || !json.objects) return json;
  return {
    ...json,
    objects: json.objects.filter((obj) => ALLOWED_FABRIC_TYPES.includes(obj.type)),
  };
}

export default function DesignerCanvas() {
  const canvasEl  = useRef(null);
  const fabricRef = useRef(null);
  const fileInputRef = useRef(null);

  const {
    template, currentViewIndex, activeTool,
    canvasSnapshots, snapshotView, setActiveTool,
    setSelectedObject, setError, setTriggerFileUpload,
  } = useDesignerStore();

  const currentView = template?.views?.[currentViewIndex];
  const zones = currentView?.zones_config || [];
  const globalConfig = template?.global_config || {};
  const permissions = globalConfig.permissions || {};

  // ── Zone helpers ──────────────────────────────────────────────────────────

  const findZoneForPoint = useCallback((x, y, elementType) => {
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (z.behavior !== 'restrict') continue;
      if (!(z.allowed_types || []).includes(elementType)) continue;
      if (x >= z.x && x <= z.x + z.width && y >= z.y && y <= z.y + z.height) {
        return i;
      }
    }
    return -1;
  }, [zones]);

  const findFirstZoneForType = useCallback((elementType) => {
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (z.behavior !== 'restrict') continue;
      if ((z.allowed_types || []).includes(elementType)) return i;
    }
    return -1;
  }, [zones]);

  // ── Apply permissions to a fabric object ──────────────────────────────────

  const applyPermissions = useCallback((obj, elementType) => {
    const perms = permissions[elementType] || {};

    if (perms.resize === false) {
      obj.set({ hasControls: false });
    }

    if (perms.rotate === false) {
      obj.setControlVisible('mtr', false);
    }

    if (perms.min_scale != null) {
      obj.set({ minScaleLimit: perms.min_scale });
    }
  }, [permissions]);

  // ── Clamp object inside its assigned zone ─────────────────────────────────

  const clampToZone = useCallback((obj) => {
    const zi = obj.data?.zoneIndex;
    if (zi == null || zi < 0 || !zones[zi] || zones[zi].behavior !== 'restrict') return;

    const zone = zones[zi];
    const bound = obj.getBoundingRect();

    let left = obj.left;
    let top  = obj.top;

    if (bound.left < zone.x) left += zone.x - bound.left;
    if (bound.top  < zone.y) top  += zone.y - bound.top;
    if (bound.left + bound.width  > zone.x + zone.width)
      left -= (bound.left + bound.width) - (zone.x + zone.width);
    if (bound.top  + bound.height > zone.y + zone.height)
      top  -= (bound.top + bound.height) - (zone.y + zone.height);

    obj.set({ left, top });
    obj.setCoords();
  }, [zones]);

  const clampScaleToZone = useCallback((obj) => {
    const zi = obj.data?.zoneIndex;
    if (zi == null || zi < 0 || !zones[zi] || zones[zi].behavior !== 'restrict') return;

    const zone  = zones[zi];
    const perms = permissions[obj.data?.elementType] || {};
    const bound = obj.getBoundingRect();

    // Enforce max_scale
    if (perms.max_scale != null) {
      if (obj.scaleX > perms.max_scale) obj.set({ scaleX: perms.max_scale });
      if (obj.scaleY > perms.max_scale) obj.set({ scaleY: perms.max_scale });
    }

    // If bounding rect exceeds zone, scale down
    if (bound.width > zone.width || bound.height > zone.height) {
      const ratio = Math.min(zone.width / bound.width, zone.height / bound.height);
      obj.set({ scaleX: obj.scaleX * ratio, scaleY: obj.scaleY * ratio });
    }

    obj.setCoords();
    clampToZone(obj);
  }, [zones, permissions, clampToZone]);

  // ── Snap to grid ──────────────────────────────────────────────────────────

  const snapToGrid = useCallback((obj) => {
    const perms = permissions[obj.data?.elementType] || {};
    if (!perms.snap_to_grid) return;
    const grid = perms.grid_size || 10;
    obj.set({
      left: Math.round(obj.left / grid) * grid,
      top:  Math.round(obj.top / grid) * grid,
    });
    obj.setCoords();
  }, [permissions]);

  // ── Canvas init ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!canvasEl.current || !currentView) return;

    const width  = currentView.canvas_width  || 800;
    const height = currentView.canvas_height || 600;

    const canvas = new FabricCanvas(canvasEl.current, {
      width,
      height,
      selection: true,
      preserveObjectStacking: true,
    });
    fabricRef.current = canvas;

    let disposed = false;

    // Render zone rects
    zones.forEach((zone) => {
      const isRestrict = zone.behavior === 'restrict';
      const rect = new Rect({
        left:           zone.x,
        top:            zone.y,
        width:          zone.width,
        height:         zone.height,
        fill:           isRestrict ? 'rgba(59,130,246,0.08)' : 'transparent',
        stroke:         isRestrict ? '#3b82f6' : '#9ca3af',
        strokeWidth:    2,
        strokeDashArray: isRestrict ? null : [6, 4],
        selectable:     false,
        evented:        false,
        data:           { isZoneOverlay: true },
      });
      canvas.add(rect);
    });

    // Load background image
    if (currentView.background_url) {
      FabricImage.fromURL(currentView.background_url, { crossOrigin: 'anonymous' })
        .then((img) => {
          if (disposed) return;
          img.set({ selectable: false, evented: false });
          img.scaleToWidth(width);
          canvas.set('backgroundImage', img);
          canvas.renderAll();
        })
        .catch(() => {});
    }

    // Restore snapshot if switching back to a previously edited view
    const existing = canvasSnapshots[currentViewIndex];
    if (existing) {
      const filtered = filterFabricJson(existing);
      canvas.loadFromJSON(filtered).then(() => {
        if (!disposed) canvas.renderAll();
      });
    }

    // ── Event handlers ────────────────────────────────────────────────────

    canvas.on('object:moving', (e) => {
      snapToGrid(e.target);
      clampToZone(e.target);
    });

    canvas.on('object:scaling', (e) => {
      clampScaleToZone(e.target);
    });

    canvas.on('object:modified', () => {
      if (!disposed) snapshotView(currentViewIndex, canvas.toJSON());
    });

    canvas.on('object:removed', () => {
      if (!disposed) snapshotView(currentViewIndex, canvas.toJSON());
    });

    canvas.on('selection:created', (e) => {
      const obj = e.selected?.[0];
      if (obj && !obj.data?.isZoneOverlay) {
        setSelectedObject({
          type: obj.data?.elementType || 'unknown',
          fabricObj: obj,
        });
      }
    });

    canvas.on('selection:updated', (e) => {
      const obj = e.selected?.[0];
      if (obj && !obj.data?.isZoneOverlay) {
        setSelectedObject({
          type: obj.data?.elementType || 'unknown',
          fabricObj: obj,
        });
      }
    });

    canvas.on('selection:cleared', () => {
      setSelectedObject(null);
    });

    // Delete key handler
    const onKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;

        const active = canvas.getActiveObject();
        if (!active || active.data?.isZoneOverlay) return;

        const perms = permissions[active.data?.elementType] || {};
        if (perms.delete === false) return;

        e.preventDefault();
        canvas.remove(active);
        canvas.discardActiveObject();
        canvas.renderAll();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    canvas.renderAll();

    return () => {
      disposed = true;
      document.removeEventListener('keydown', onKeyDown);
      canvas.dispose();
      fabricRef.current = null;
    };
  }, [currentViewIndex, template]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tool: add-text on canvas click ────────────────────────────────────────

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || activeTool !== 'add-text') return;

    canvas.defaultCursor = 'crosshair';

    const onClick = (opt) => {
      const ptr = canvas.getPointer(opt.e);
      const zoneIdx = findZoneForPoint(ptr.x, ptr.y, 'text');

      const text = new IText('Your text here', {
        left: ptr.x,
        top: ptr.y,
        fontSize: 24,
        fill: '#000000',
        data: {
          elementType: 'text',
          zoneIndex: zoneIdx,
        },
      });

      applyPermissions(text, 'text');
      canvas.add(text);
      canvas.setActiveObject(text);

      if (zoneIdx >= 0) clampToZone(text);

      canvas.renderAll();
      snapshotView(currentViewIndex, canvas.toJSON());
      setActiveTool('select');
    };

    canvas.on('mouse:down', onClick);
    return () => {
      canvas.off('mouse:down', onClick);
      canvas.defaultCursor = 'default';
    };
  }, [activeTool, currentViewIndex, findZoneForPoint, applyPermissions, clampToZone, snapshotView, setActiveTool]);

  // ── Tool: add-image / add-svg via file input ──────────────────────────────

  const handleFileUpload = useCallback(async (file, elementType) => {
    try {
      const result = await uploadFile(file);
      const canvas = fabricRef.current;
      if (!canvas) return;

      const img = await FabricImage.fromURL(result.url, { crossOrigin: 'anonymous' });
      const zoneIdx = findFirstZoneForType(elementType);

      // Position: center on zone if found, otherwise center on canvas
      if (zoneIdx >= 0) {
        const zone = zones[zoneIdx];
        img.scaleToWidth(Math.min(img.width, zone.width * 0.8));
        img.set({
          left: zone.x + zone.width / 2 - (img.getScaledWidth() / 2),
          top:  zone.y + zone.height / 2 - (img.getScaledHeight() / 2),
        });
      } else {
        img.scaleToWidth(Math.min(img.width, canvas.width * 0.5));
        img.set({
          left: canvas.width / 2 - img.getScaledWidth() / 2,
          top:  canvas.height / 2 - img.getScaledHeight() / 2,
        });
      }

      img.set({
        data: { elementType, zoneIndex: zoneIdx },
      });

      applyPermissions(img, elementType);
      canvas.add(img);
      canvas.setActiveObject(img);

      if (zoneIdx >= 0) clampToZone(img);

      canvas.renderAll();
      snapshotView(currentViewIndex, canvas.toJSON());
    } catch (err) {
      setError(err.message);
    }

    setActiveTool('select');
  }, [findFirstZoneForType, zones, applyPermissions, clampToZone, snapshotView, currentViewIndex, setActiveTool, setError]);

  // Called by AddTab
  const triggerFileUpload = useCallback((elementType) => {
    const input = fileInputRef.current;
    if (!input) return;

    input.accept = elementType === 'svg'
      ? 'image/svg+xml'
      : 'image/jpeg,image/png,image/webp,image/gif';
    input.dataset.elementType = elementType;
    input.value = '';
    input.click();
  }, []);

  const onFileSelected = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const elementType = e.target.dataset.elementType || 'image';
    handleFileUpload(file, elementType);
  }, [handleFileUpload]);

  // Expose triggerFileUpload to AddTab via store
  useEffect(() => {
    setTriggerFileUpload(triggerFileUpload);
  }, [triggerFileUpload, setTriggerFileUpload]);

  return (
    <div className="pd-canvas-wrap">
      <div className="pd-canvas-scroll">
        <canvas ref={canvasEl} />
      </div>
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={onFileSelected}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify canvas renders with zones**

1. Ensure a template with zones exists (created via admin builder in Phase 2)
2. Set product meta `_pd_designer_enabled = 1`, `_pd_template_id = <id>`
3. Visit product page — canvas should render with zone overlays
4. Verify restrict zones show solid blue border, suggest zones show dashed grey

- [ ] **Step 3: Verify zone enforcement**

1. Switch to add-text tool, click inside a restrict zone
2. Try dragging the text outside the zone boundary — it should be clamped
3. Add text outside zones — should move freely

- [ ] **Step 4: Verify file upload tools**

1. Click Image tool — file picker should open
2. Select a JPG — image should appear on canvas, centered on first matching zone
3. Click SVG tool — file picker should open
4. Upload an SVG — should appear similarly

- [ ] **Step 5: Commit**

```bash
git add frontend/js/designer/src/components/DesignerCanvas.jsx
git commit -m "feat: add DesignerCanvas with zone rendering, enforcement, and tool modes"
```

---

## Task 7: Sidebar & AddTab

**Files:**
- Create: `frontend/js/designer/src/components/Sidebar.jsx`
- Create: `frontend/js/designer/src/components/tabs/AddTab.jsx`

- [ ] **Step 1: Create AddTab**

```jsx
import React from 'react';
import useDesignerStore from '../../store/useDesignerStore';

export default function AddTab() {
  const { template, currentViewIndex, activeTool, setActiveTool, triggerFileUpload } = useDesignerStore();

  const currentView = template?.views?.[currentViewIndex];
  const zones = currentView?.zones_config || [];

  // Check if any zone allows a given type (or there are no zones at all)
  const isTypeAllowed = (type) => {
    if (zones.length === 0) return true;
    return zones.some((z) => (z.allowed_types || []).includes(type));
  };

  const handleToolClick = (tool) => {
    if (activeTool === tool) {
      setActiveTool('select');
    } else if (tool === 'add-image' || tool === 'add-svg') {
      const elementType = tool === 'add-image' ? 'image' : 'svg';
      triggerFileUpload?.(elementType);
    } else {
      setActiveTool(tool);
    }
  };

  return (
    <div className="pd-sidebar__tab-content">
      <h3 className="pd-sidebar__heading">Add Element</h3>
      <div className="pd-add-tools">
        <button
          className={`pd-add-tools__btn${activeTool === 'add-text' ? ' pd-add-tools__btn--active' : ''}`}
          disabled={!isTypeAllowed('text')}
          onClick={() => handleToolClick('add-text')}
          title={!isTypeAllowed('text') ? 'Text not allowed on this view' : 'Add text'}
        >
          Text
        </button>
        <button
          className={`pd-add-tools__btn${activeTool === 'add-image' ? ' pd-add-tools__btn--active' : ''}`}
          disabled={!isTypeAllowed('image')}
          onClick={() => handleToolClick('add-image')}
          title={!isTypeAllowed('image') ? 'Images not allowed on this view' : 'Add image (jpg, png, webp)'}
        >
          Image
        </button>
        <button
          className={`pd-add-tools__btn${activeTool === 'add-svg' ? ' pd-add-tools__btn--active' : ''}`}
          disabled={!isTypeAllowed('svg')}
          onClick={() => handleToolClick('add-svg')}
          title={!isTypeAllowed('svg') ? 'SVGs not allowed on this view' : 'Add SVG'}
        >
          SVG
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create Sidebar**

```jsx
import React, { useState, useEffect } from 'react';
import useDesignerStore from '../store/useDesignerStore';
import AddTab from './tabs/AddTab';

export default function Sidebar() {
  const { selectedObject } = useDesignerStore();
  const [activeTab, setActiveTab] = useState('add');

  // Auto-switch to Element tab when object selected
  useEffect(() => {
    if (selectedObject) {
      setActiveTab('element');
    } else if (activeTab === 'element') {
      setActiveTab('add');
    }
  }, [selectedObject]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="pd-sidebar">
      <div className="pd-sidebar__tabs">
        <button
          className={`pd-sidebar__tab${activeTab === 'add' ? ' pd-sidebar__tab--active' : ''}`}
          onClick={() => setActiveTab('add')}
        >
          Add
        </button>
        <button
          className={`pd-sidebar__tab${activeTab === 'element' ? ' pd-sidebar__tab--active' : ''}`}
          onClick={() => setActiveTab('element')}
          disabled={!selectedObject}
        >
          Element
        </button>
        <button
          className={`pd-sidebar__tab${activeTab === 'views' ? ' pd-sidebar__tab--active' : ''}`}
          onClick={() => setActiveTab('views')}
        >
          Views
        </button>
      </div>
      <div className="pd-sidebar__content">
        {activeTab === 'add' && <AddTab />}
        {activeTab === 'element' && <ElementTabPlaceholder />}
        {activeTab === 'views' && <ViewsTabPlaceholder />}
      </div>
    </div>
  );
}

function ElementTabPlaceholder() {
  return <div className="pd-sidebar__tab-content"><p>Element properties (Task 8)</p></div>;
}

function ViewsTabPlaceholder() {
  return <div className="pd-sidebar__tab-content"><p>View switcher (Task 9)</p></div>;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/js/designer/src/components/Sidebar.jsx frontend/js/designer/src/components/tabs/AddTab.jsx
git commit -m "feat: add Sidebar with AddTab tool buttons"
```

---

## Task 8: ElementTab

**Files:**
- Create: `frontend/js/designer/src/components/tabs/ElementTab.jsx`
- Modify: `frontend/js/designer/src/components/Sidebar.jsx` (replace placeholder import)

- [ ] **Step 1: Create ElementTab**

```jsx
import React, { useState, useCallback, useEffect } from 'react';
import useDesignerStore from '../../store/useDesignerStore';

export default function ElementTab() {
  const { selectedObject, template, snapshotView, currentViewIndex } = useDesignerStore();

  const globalConfig = template?.global_config || {};
  const permissions  = globalConfig.permissions || {};

  if (!selectedObject) {
    return <div className="pd-sidebar__tab-content"><p>Select an element</p></div>;
  }

  const { type, fabricObj } = selectedObject;
  const perms = permissions[type] || {};

  return (
    <div className="pd-sidebar__tab-content">
      <h3 className="pd-sidebar__heading">{type.charAt(0).toUpperCase() + type.slice(1)} Properties</h3>

      {type === 'text' && (
        <TextProperties
          fabricObj={fabricObj}
          perms={perms}
          globalConfig={globalConfig}
          snapshotView={snapshotView}
          currentViewIndex={currentViewIndex}
        />
      )}

      {(type === 'image' || type === 'svg') && (
        <ImageProperties
          fabricObj={fabricObj}
          type={type}
          perms={perms}
          globalConfig={globalConfig}
          snapshotView={snapshotView}
          currentViewIndex={currentViewIndex}
        />
      )}

      {perms.delete !== false && (
        <button
          className="pd-element__delete-btn"
          onClick={() => {
            const canvas = fabricObj.canvas;
            if (canvas) {
              canvas.remove(fabricObj);
              canvas.discardActiveObject();
              canvas.renderAll();
            }
          }}
        >
          Delete
        </button>
      )}
    </div>
  );
}

function TextProperties({ fabricObj, perms, globalConfig, snapshotView, currentViewIndex }) {
  const [fontSize, setFontSize] = useState(fabricObj.fontSize || 24);
  const [fill, setFill]         = useState(fabricObj.fill || '#000000');
  const [bold, setBold]         = useState(fabricObj.fontWeight === 'bold');
  const [italic, setItalic]     = useState(fabricObj.fontStyle === 'italic');
  const [fontFamily, setFontFamily] = useState(fabricObj.fontFamily || 'Arial');

  const update = useCallback((props) => {
    fabricObj.set(props);
    fabricObj.canvas?.renderAll();
    snapshotView(currentViewIndex, fabricObj.canvas?.toJSON());
  }, [fabricObj, snapshotView, currentViewIndex]);

  // Sync state when selected object changes
  useEffect(() => {
    setFontSize(fabricObj.fontSize || 24);
    setFill(fabricObj.fill || '#000000');
    setBold(fabricObj.fontWeight === 'bold');
    setItalic(fabricObj.fontStyle === 'italic');
    setFontFamily(fabricObj.fontFamily || 'Arial');
  }, [fabricObj]);

  const allowedFonts = globalConfig.allowed_fonts || [];
  const allowedColors = globalConfig.allowed_colors || [];
  const anyColor = globalConfig.any_color || false;

  return (
    <div className="pd-element__props">
      {/* Font family */}
      {perms.change_font !== false && allowedFonts.length > 0 && (
        <label className="pd-element__field">
          <span>Font</span>
          <select
            value={fontFamily}
            onChange={(e) => {
              setFontFamily(e.target.value);
              update({ fontFamily: e.target.value });
            }}
          >
            {allowedFonts.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
      )}

      {/* Font size */}
      <label className="pd-element__field">
        <span>Size</span>
        <input
          type="number"
          min="8"
          max="200"
          value={fontSize}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10) || 24;
            setFontSize(v);
            update({ fontSize: v });
          }}
        />
      </label>

      {/* Color */}
      {perms.recolor !== false && (
        <label className="pd-element__field">
          <span>Color</span>
          {anyColor ? (
            <input
              type="color"
              value={fill}
              onChange={(e) => {
                setFill(e.target.value);
                update({ fill: e.target.value });
              }}
            />
          ) : allowedColors.length > 0 ? (
            <div className="pd-element__color-swatches">
              {allowedColors.map((c) => (
                <button
                  key={c}
                  className={`pd-element__swatch${fill === c ? ' pd-element__swatch--active' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => {
                    setFill(c);
                    update({ fill: c });
                  }}
                />
              ))}
            </div>
          ) : (
            <input
              type="color"
              value={fill}
              onChange={(e) => {
                setFill(e.target.value);
                update({ fill: e.target.value });
              }}
            />
          )}
        </label>
      )}

      {/* Bold / Italic */}
      <div className="pd-element__toggles">
        <button
          className={`pd-element__toggle${bold ? ' pd-element__toggle--active' : ''}`}
          onClick={() => {
            const next = !bold;
            setBold(next);
            update({ fontWeight: next ? 'bold' : 'normal' });
          }}
        >
          B
        </button>
        <button
          className={`pd-element__toggle${italic ? ' pd-element__toggle--active' : ''}`}
          onClick={() => {
            const next = !italic;
            setItalic(next);
            update({ fontStyle: next ? 'italic' : 'normal' });
          }}
        >
          I
        </button>
      </div>
    </div>
  );
}

function ImageProperties({ fabricObj, type, perms, globalConfig, snapshotView, currentViewIndex }) {
  const scalePercent = Math.round((fabricObj.scaleX || 1) * 100);

  const allowedColors = globalConfig.allowed_colors || [];
  const anyColor = globalConfig.any_color || false;
  const [fill, setFill] = useState('');

  const update = useCallback((props) => {
    fabricObj.set(props);
    fabricObj.canvas?.renderAll();
    snapshotView(currentViewIndex, fabricObj.canvas?.toJSON());
  }, [fabricObj, snapshotView, currentViewIndex]);

  return (
    <div className="pd-element__props">
      <div className="pd-element__field">
        <span>Scale</span>
        <span>{scalePercent}%</span>
      </div>

      {/* SVG recolor */}
      {type === 'svg' && perms.recolor !== false && (
        <label className="pd-element__field">
          <span>Color</span>
          {anyColor ? (
            <input
              type="color"
              value={fill}
              onChange={(e) => {
                setFill(e.target.value);
                update({ fill: e.target.value });
              }}
            />
          ) : allowedColors.length > 0 ? (
            <div className="pd-element__color-swatches">
              {allowedColors.map((c) => (
                <button
                  key={c}
                  className={`pd-element__swatch${fill === c ? ' pd-element__swatch--active' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => {
                    setFill(c);
                    update({ fill: c });
                  }}
                />
              ))}
            </div>
          ) : null}
        </label>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update Sidebar to use real ElementTab**

In `Sidebar.jsx`, replace the `ElementTabPlaceholder` with the real import:

```jsx
import ElementTab from './tabs/ElementTab';
```

And replace `{activeTab === 'element' && <ElementTabPlaceholder />}` with:

```jsx
{activeTab === 'element' && <ElementTab />}
```

Remove the `ElementTabPlaceholder` function.

- [ ] **Step 3: Verify element properties**

1. Add a text element on canvas
2. Sidebar should auto-switch to Element tab
3. Change font size — text should resize
4. Toggle bold/italic — text should update
5. Click delete — text should be removed

- [ ] **Step 4: Commit**

```bash
git add frontend/js/designer/src/components/tabs/ElementTab.jsx frontend/js/designer/src/components/Sidebar.jsx
git commit -m "feat: add ElementTab with text/image/SVG property controls"
```

---

## Task 9: ViewsTab

**Files:**
- Create: `frontend/js/designer/src/components/tabs/ViewsTab.jsx`
- Modify: `frontend/js/designer/src/components/Sidebar.jsx` (replace placeholder import)

- [ ] **Step 1: Create ViewsTab**

```jsx
import React, { useCallback } from 'react';
import useDesignerStore from '../../store/useDesignerStore';

export default function ViewsTab() {
  const { template, currentViewIndex, setCurrentViewIndex, snapshotView } = useDesignerStore();

  const views = template?.views || [];

  const handleSwitch = useCallback((index) => {
    if (index === currentViewIndex) return;

    // Snapshot outgoing view (canvas ref is handled by DesignerCanvas effect cleanup)
    const canvas = document.querySelector('.pd-canvas-wrap canvas');
    // The actual snapshot happens in DesignerCanvas cleanup — we just trigger the switch
    setCurrentViewIndex(index);
  }, [currentViewIndex, setCurrentViewIndex]);

  return (
    <div className="pd-sidebar__tab-content">
      <h3 className="pd-sidebar__heading">Views</h3>
      <div className="pd-views">
        {views.map((view, i) => (
          <button
            key={view.id || i}
            className={`pd-views__btn${i === currentViewIndex ? ' pd-views__btn--active' : ''}`}
            onClick={() => handleSwitch(i)}
          >
            {view.name || `View ${i + 1}`}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update Sidebar to use real ViewsTab**

In `Sidebar.jsx`, add import and replace placeholder:

```jsx
import ViewsTab from './tabs/ViewsTab';
```

Replace `{activeTab === 'views' && <ViewsTabPlaceholder />}` with:

```jsx
{activeTab === 'views' && <ViewsTab />}
```

Remove the `ViewsTabPlaceholder` function.

- [ ] **Step 3: Handle view switch snapshot in DesignerCanvas**

In `DesignerCanvas.jsx`, the canvas `useEffect` cleanup already calls `canvas.dispose()`. Add a snapshot before disposal so the outgoing view state is preserved. Before `return () => {`, the snapshot is already handled by `snapshotView` calls during editing. But we need to ensure a final snapshot on view switch. Add to the cleanup:

```js
return () => {
  // Snapshot current canvas state before switching views
  if (!disposed && fabricRef.current) {
    snapshotView(currentViewIndex, fabricRef.current.toJSON());
  }
  disposed = true;
  document.removeEventListener('keydown', onKeyDown);
  canvas.dispose();
  fabricRef.current = null;
};
```

- [ ] **Step 4: Verify view switching**

1. Load a template with 2+ views
2. Add text to View 1
3. Switch to View 2 — canvas should show View 2 zones/background
4. Switch back to View 1 — text element should be restored from snapshot

- [ ] **Step 5: Commit**

```bash
git add frontend/js/designer/src/components/tabs/ViewsTab.jsx frontend/js/designer/src/components/Sidebar.jsx frontend/js/designer/src/components/DesignerCanvas.jsx
git commit -m "feat: add ViewsTab with view switching and snapshot persistence"
```

---

## Task 10: App.jsx — Wire Everything Together

**Files:**
- Modify: `frontend/js/designer/src/App.jsx`

- [ ] **Step 1: Rewrite App.jsx**

```jsx
import React, { useEffect, useState } from 'react';
import useDesignerStore from './store/useDesignerStore';
import { loadTemplate, createDesign, saveDesignView } from './api/designerApi';
import DesignerCanvas from './components/DesignerCanvas';
import Sidebar from './components/Sidebar';

const config = window.pdDesigner || {};

export default function App() {
  const {
    template, loadTemplate: setTemplate,
    designHash, setDesignHash,
    isSaving, setIsSaving,
    isDirty, setIsDirty,
    canvasSnapshots,
    error, setError, clearError,
  } = useDesignerStore();

  const [loading, setLoading] = useState(true);
  const [designerOpen, setDesignerOpen] = useState(config.display_mode !== 'modal');

  // Load template on mount
  useEffect(() => {
    if (!config.template_id) {
      setError('No template configured for this product.');
      setLoading(false);
      return;
    }

    loadTemplate(config.template_id)
      .then((data) => {
        setTemplate(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Modal open/close
  useEffect(() => {
    if (config.display_mode !== 'modal') return;

    const btn = document.querySelector('.pd-open-designer');
    if (!btn) return;

    const handler = () => setDesignerOpen(true);
    btn.addEventListener('click', handler);
    return () => btn.removeEventListener('click', handler);
  }, []);

  // Sync design hash to hidden input
  useEffect(() => {
    if (!designHash) return;
    let input = document.querySelector('input[name="pd_design_hash"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'pd_design_hash';
      const form = document.querySelector('form.cart');
      if (form) form.appendChild(input);
    }
    input.value = designHash;
  }, [designHash]);

  // Save handler
  const handleSave = async () => {
    clearError();
    setIsSaving(true);

    try {
      let hash = designHash;

      // Create design if first save
      if (!hash) {
        const design = await createDesign(config.template_id, config.product_id);
        hash = design.design_hash;
        setDesignHash(hash);
      }

      // Save each view that has a snapshot
      const views = template?.views || [];
      for (const [viewIndex, json] of Object.entries(canvasSnapshots)) {
        const view = views[parseInt(viewIndex, 10)];
        if (view?.id) {
          await saveDesignView(hash, view.id, json);
        }
      }

      setIsDirty(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return <div className="pd-designer pd-designer--loading">Loading designer...</div>;
  }

  if (!template) {
    return <div className="pd-designer pd-designer--error">{error || 'Template not available.'}</div>;
  }

  const isModal = config.display_mode === 'modal';
  const wrapperClass = [
    'pd-designer',
    `pd-designer--${config.display_mode || 'embedded'}`,
    isModal && designerOpen ? 'pd-designer--open' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={wrapperClass}>
      {isModal && (
        <button
          className="pd-designer__close"
          onClick={() => setDesignerOpen(false)}
          aria-label="Close designer"
        >
          &times;
        </button>
      )}

      <div className="pd-designer__layout">
        <DesignerCanvas />
        <div className="pd-designer__sidebar-wrap">
          <Sidebar />
          {error && (
            <div className="pd-designer__error" onClick={clearError}>
              {error}
            </div>
          )}
          <button
            className="pd-designer__save-btn"
            onClick={handleSave}
            disabled={isSaving || !isDirty}
          >
            {isSaving ? 'Saving...' : 'Save Design'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify end-to-end embedded mode**

1. Product with `_pd_designer_enabled = 1`, `_pd_template_id` pointing to a published template
2. Visit product page — designer should render inline
3. Add text, change properties, add image
4. Click Save Design — should create design and save views without errors
5. Check database: `wp_pd_designs` row should have `design_hash`, `wp_pd_design_views` should have canvas JSON

- [ ] **Step 3: Verify modal mode**

1. Set `_pd_display_mode = modal` on the product
2. Visit product page — "Customize Product" button should appear, designer hidden
3. Click button — designer overlay should appear
4. Close button should hide it

- [ ] **Step 4: Commit**

```bash
git add frontend/js/designer/src/App.jsx
git commit -m "feat: wire up App.jsx with template loading, save flow, and display modes"
```

---

## Task 11: CSS — Designer Styles

**Files:**
- Create: `frontend/js/designer/src/designer.css`
- Modify: `frontend/js/designer/src/index.jsx` (import CSS)

- [ ] **Step 1: Create CSS**

```css
/* ── Reset & isolation ───────────────────────────────────────────────────── */

.pd-designer {
  all: initial;
  display: block;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #1f2937;
}

.pd-designer *,
.pd-designer *::before,
.pd-designer *::after {
  box-sizing: border-box;
}

/* ── Loading & error states ──────────────────────────────────────────────── */

.pd-designer--loading,
.pd-designer--error {
  padding: 2rem;
  text-align: center;
  color: #6b7280;
}

.pd-designer--error {
  color: #dc2626;
}

/* ── Layout ──────────────────────────────────────────────────────────────── */

.pd-designer__layout {
  display: flex;
  gap: 1rem;
  padding: 1rem 0;
}

.pd-canvas-wrap {
  flex: 1;
  min-width: 0;
}

.pd-canvas-scroll {
  overflow: auto;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  background: #f9fafb;
}

.pd-designer__sidebar-wrap {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

/* ── Modal mode ──────────────────────────────────────────────────────────── */

.pd-designer--modal {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 100000;
  background: rgba(0, 0, 0, 0.5);
  padding: 2rem;
  overflow-y: auto;
}

.pd-designer--modal.pd-designer--open {
  display: block;
}

.pd-designer--modal .pd-designer__layout {
  background: #fff;
  border-radius: 8px;
  padding: 1.5rem;
  max-width: 1200px;
  margin: 0 auto;
  position: relative;
}

.pd-designer__close {
  position: absolute;
  top: 0.5rem;
  right: 0.75rem;
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #6b7280;
  z-index: 1;
  line-height: 1;
}

.pd-designer__close:hover {
  color: #1f2937;
}

/* ── Open designer button (rendered by PHP) ──────────────────────────────── */

.pd-open-designer {
  margin: 1rem 0;
}

/* ── Sidebar ─────────────────────────────────────────────────────────────── */

.pd-sidebar {
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  background: #fff;
  overflow: hidden;
}

.pd-sidebar__tabs {
  display: flex;
  border-bottom: 1px solid #e5e7eb;
}

.pd-sidebar__tab {
  flex: 1;
  padding: 0.5rem;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: #6b7280;
  border-bottom: 2px solid transparent;
}

.pd-sidebar__tab:hover:not(:disabled) {
  color: #1f2937;
}

.pd-sidebar__tab--active {
  color: #2563eb;
  border-bottom-color: #2563eb;
}

.pd-sidebar__tab:disabled {
  opacity: 0.4;
  cursor: default;
}

.pd-sidebar__content {
  padding: 0.75rem;
}

.pd-sidebar__heading {
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 0.5rem;
  color: #374151;
}

.pd-sidebar__tab-content p {
  margin: 0;
  color: #6b7280;
  font-size: 13px;
}

/* ── Add tools ───────────────────────────────────────────────────────────── */

.pd-add-tools {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.pd-add-tools__btn {
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}

.pd-add-tools__btn:hover:not(:disabled) {
  border-color: #2563eb;
  color: #2563eb;
}

.pd-add-tools__btn--active {
  border-color: #2563eb;
  background: #eff6ff;
  color: #2563eb;
}

.pd-add-tools__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Element properties ──────────────────────────────────────────────────── */

.pd-element__props {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.pd-element__field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 13px;
}

.pd-element__field span {
  color: #6b7280;
  flex-shrink: 0;
}

.pd-element__field select,
.pd-element__field input[type="number"] {
  width: 120px;
  padding: 0.25rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 3px;
  font-size: 13px;
}

.pd-element__field input[type="color"] {
  width: 40px;
  height: 28px;
  padding: 0;
  border: 1px solid #d1d5db;
  border-radius: 3px;
  cursor: pointer;
}

.pd-element__color-swatches {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.pd-element__swatch {
  width: 24px;
  height: 24px;
  border: 2px solid #d1d5db;
  border-radius: 3px;
  cursor: pointer;
  padding: 0;
}

.pd-element__swatch--active {
  border-color: #2563eb;
  box-shadow: 0 0 0 1px #2563eb;
}

.pd-element__toggles {
  display: flex;
  gap: 4px;
}

.pd-element__toggle {
  width: 32px;
  height: 32px;
  border: 1px solid #d1d5db;
  border-radius: 3px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}

.pd-element__toggle--active {
  background: #eff6ff;
  border-color: #2563eb;
  color: #2563eb;
}

.pd-element__delete-btn {
  margin-top: 0.75rem;
  padding: 0.4rem 0.75rem;
  background: #fee2e2;
  color: #dc2626;
  border: 1px solid #fca5a5;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.pd-element__delete-btn:hover {
  background: #fecaca;
}

/* ── Views ───────────────────────────────────────────────────────────────── */

.pd-views {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.pd-views__btn {
  padding: 0.4rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}

.pd-views__btn--active {
  border-color: #2563eb;
  background: #eff6ff;
  color: #2563eb;
  font-weight: 500;
}

/* ── Save button ─────────────────────────────────────────────────────────── */

.pd-designer__save-btn {
  padding: 0.6rem 1rem;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.pd-designer__save-btn:hover:not(:disabled) {
  background: #1d4ed8;
}

.pd-designer__save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Error ────────────────────────────────────────────────────────────────── */

.pd-designer__error {
  padding: 0.5rem 0.75rem;
  background: #fee2e2;
  color: #dc2626;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}
```

- [ ] **Step 2: Import CSS in index.jsx**

Add at the top of `frontend/js/designer/src/index.jsx`:

```jsx
import './designer.css';
```

- [ ] **Step 3: Build and verify styles**

```bash
npm run build
```

Check that `dist/frontend-designer.css` is generated. Visit a product page and verify:
- Canvas area and sidebar are side-by-side
- Tabs look correct
- All buttons styled properly
- Modal overlay works for modal mode

- [ ] **Step 4: Commit**

```bash
git add frontend/js/designer/src/designer.css frontend/js/designer/src/index.jsx
git commit -m "feat: add designer CSS with isolation, layout, modal, and component styles"
```

---

## Task 12: Final Integration Verification

No new files — this task verifies the complete feature works end-to-end.

- [ ] **Step 1: Build assets**

```bash
npm run build
```

Verify no build errors. Check `dist/` contains `frontend-designer.js` and `frontend-designer.css`.

- [ ] **Step 2: Set up test product**

In WP admin:
1. Create or edit a product
2. Add custom fields: `_pd_designer_enabled = 1`, `_pd_template_id = <published template ID>`
3. Publish the product

- [ ] **Step 3: End-to-end embedded test**

Visit the product page as a non-admin (incognito or logged out):
1. Designer should render inline with canvas + sidebar
2. Click "Text" — crosshair cursor, click on canvas — text appears
3. Text auto-assigned to restrict zone if click was inside one
4. Try dragging text out of restrict zone — clamped at boundary
5. Select text — sidebar switches to Element tab with properties
6. Change font size, color, bold/italic — text updates live
7. Click Delete — text removed
8. Click "Image" — file picker opens, upload JPG — image appears on canvas
9. Click "SVG" — file picker opens, upload SVG — SVG appears on canvas
10. Click "Save Design" — button shows "Saving...", then design saved
11. Check database: `wp_pd_designs` has row, `wp_pd_design_views` has canvas JSON

- [ ] **Step 4: End-to-end modal test**

1. Set `_pd_display_mode = modal` on the product
2. Visit product page — designer hidden, "Customize Product" button visible
3. Click button — designer slides in as fixed overlay
4. Close button works

- [ ] **Step 5: View switching test**

1. Template with 2+ views
2. Add elements to View 1
3. Switch to View 2 — fresh canvas with View 2 config
4. Add elements to View 2
5. Switch back to View 1 — elements preserved from snapshot

- [ ] **Step 6: Security checks**

```bash
# Verify draft template is not accessible:
curl -s http://localhost:8080/wp-json/pd/v1/templates/999/public | jq .code
# Expected: "not_found"

# Verify creating design with invalid template fails:
curl -s -X POST http://localhost:8080/wp-json/pd/v1/designs \
  -H "Content-Type: application/json" \
  -d '{"template_id": 999}' | jq .code
# Expected: "invalid_template"
```

- [ ] **Step 7: Update current_status.md**

Update Phase 3 section from "What's next" to "What's complete" with a summary of all files added and features implemented.

- [ ] **Step 8: Final commit**

```bash
git add current_status.md
git commit -m "docs: update current_status.md — Phase 3 complete"
```
