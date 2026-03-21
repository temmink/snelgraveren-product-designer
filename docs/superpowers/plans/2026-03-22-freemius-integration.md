# Freemius Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Freemius SDK for license management and split ProductForge into Free (Lite) and Pro tiers with runtime feature gating.

**Architecture:** Single codebase with runtime checks — `ProductForge::is_premium()` and `ProductForge::has_feature()` guard all premium functionality. PHP gates on REST endpoints prevent data creation; server-side config stripping on the public template response prevents frontend rendering of premium UI. A React `UpgradePrompt` component replaces gated admin sections.

**Tech Stack:** Freemius SDK (PHP), WordPress REST API, React 18, Zustand

**Spec:** `docs/superpowers/specs/2026-03-21-freemius-integration-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `freemius/` | Create (SDK download) | Freemius SDK vendor files |
| `freemius-init.php` | Create | Non-namespaced SDK init (global `pf_fs()`) |
| `productforge.php` | Modify (lines 33-64) | Require freemius-init, remove update blocker |
| `includes/class-product-forge.php` | Modify | `is_premium()`, `has_feature()` helpers |
| `includes/Admin/class-admin.php` | Modify (lines 113-119) | Pass `isPremium` + `upgradeUrl` to JS |
| `includes/Frontend/class-frontend.php` | Modify (lines 213-228) | Pass `isPremium` to frontend JS |
| `includes/API/class-rest-templates.php` | Modify (lines 76-87, 231-239) | Template + view count limits |
| `includes/API/class-rest-fonts.php` | Modify (lines 49-90) | Gate font upload/delete |
| `includes/API/class-rest-palettes.php` | Modify (lines 41-97) | Gate palette CRUD |
| `includes/API/class-rest-clipart.php` | Modify (lines 92-174) | Gate clipart CRUD |
| `includes/API/class-rest-exports.php` | Modify (lines 65-81) | Gate PDF/SVG export |
| `includes/Export/class-export-manager.php` | Modify (lines 55-114) | Gate export format in generator |
| `includes/Frontend/class-order-integration.php` | Modify | Conditional export buttons |
| `admin/js/template-builder/src/components/UpgradePrompt.jsx` | Create | Reusable Pro upgrade CTA component |
| `admin/js/template-builder/src/components/GlobalSettings.jsx` | Modify | Gate premium settings sections |
| `admin/js/template-builder/src/components/ZoneForm.jsx` | Modify | Gate SVG boundary option |
| `admin/js/template-builder/src/components/ViewTabs.jsx` | Modify | Gate "+ Add View" button |
| `admin/js/template-builder/src/App.jsx` | Modify | Gate Permissions/Pricing tabs |
| `admin/js/template-builder/src/builder.css` | Modify | UpgradePrompt styling |

---

### Task 1: Freemius SDK Setup & Initialization

**Files:**
- Create: `freemius/` (SDK download)
- Modify: `productforge.php:27-40`
- Modify: `.gitignore`

- [ ] **Step 1: Download Freemius SDK**

Download the Freemius WordPress SDK from the Freemius dashboard after registering the plugin. Place the extracted `freemius/` directory in the plugin root:

```
ProductDesigner/
├── freemius/
│   ├── start.php
│   ├── includes/
│   └── ...
```

- [ ] **Step 2: Add `freemius/` to .gitignore exclusion**

The `freemius/` directory should be committed (it's a vendor dependency shipped with the plugin). Verify it's not in `.gitignore`. If it is, remove the entry.

- [ ] **Step 3: Add SDK initialization to `productforge.php`**

Insert after line 33 (after Composer autoloader closing brace), before the HPOS declaration block. **Important:** The file has `namespace ProductForge;` on line 17. The `pf_fs()` function must be defined in the **global namespace** so Freemius can find it. Use a fully-qualified `\function_exists` check and define the function with a backslash prefix:

```php
// ── Freemius SDK ─────────────────────────────────────────────────────────────
if ( ! \function_exists( 'pf_fs' ) ) {
    /**
     * Create a helper function for easy SDK access.
     * Defined in global namespace so Freemius can locate it.
     */
    function pf_fs() {
        global $pf_fs;
        if ( ! isset( $pf_fs ) ) {
            require_once __DIR__ . '/freemius/start.php';
            $pf_fs = fs_dynamic_init( array(
                'id'              => '<FREEMIUS_PLUGIN_ID>',
                'slug'            => 'productforge',
                'type'            => 'plugin',
                'public_key'      => '<PUBLIC_KEY>',
                'is_premium'      => false,
                'is_premium_only' => false,
                'has_addons'      => false,
                'has_paid_plans'  => true,
                'menu'            => array(
                    'slug' => 'productforge',
                ),
            ) );
        }
        return $pf_fs;
    }
    pf_fs();
    do_action( 'pf_fs_loaded' );
}
```

> **Note 1:** Replace `<FREEMIUS_PLUGIN_ID>` and `<PUBLIC_KEY>` with actual values from the Freemius dashboard after registering the plugin.

> **Note 2:** Because `productforge.php` is in the `ProductForge` namespace, functions declared here are namespaced as `ProductForge\pf_fs()`. Freemius internally expects the global `pf_fs()`. To resolve this, either (a) move the SDK init block into a separate non-namespaced file `freemius-init.php` and `require_once` it, or (b) wrap the function definition in a `namespace { }` block. Option (a) is cleaner — create `freemius-init.php` at the plugin root with no namespace declaration, containing the above code, and add `require_once PF_PLUGIN_DIR . 'freemius-init.php';` at line 34 of `productforge.php`.

- [ ] **Step 3b: Remove WordPress.org update blocker**

Freemius manages its own updates. Remove the update blocker at lines 42-64 of `productforge.php` (the `site_transient_update_plugins` and `http_request_args` filters). Freemius will handle update distribution through its own servers.

- [ ] **Step 4: Verify plugin still loads**

Open `http://localhost:8080/wp-admin/plugins.php` and confirm ProductForge is active without errors. Check browser console and PHP error log.

- [ ] **Step 5: Commit**

```bash
git add freemius/ productforge.php
git commit -m "feat: add Freemius SDK initialization"
```

---

### Task 2: License Helper Methods

**Files:**
- Modify: `includes/class-product-forge.php`

- [ ] **Step 1: Add `is_premium()` static method**

Add after the existing static methods (after line ~49 `grant_template_cap` method) in `class-product-forge.php`:

```php
/**
 * Check if the Pro license is active.
 *
 * @return bool
 */
public static function is_premium(): bool {
    return function_exists( 'pf_fs' ) && pf_fs()->is_paying();
}
```

- [ ] **Step 2: Add `has_feature()` static method**

Add immediately after `is_premium()`:

```php
/**
 * Check if a specific premium feature is available.
 *
 * Unknown features are always available (fail-open for core features).
 *
 * @param string $feature Feature key.
 * @return bool
 */
public static function has_feature( string $feature ): bool {
    static $premium_features = [
        'unlimited_templates',
        'multi_view',
        'svg_boundaries',
        'product_colors',
        'color_palettes',
        'custom_fonts',
        'clipart',
        'pdf_export',
        'svg_export',
        'pricing',
        'permissions',
        'solid_color',
        'upload_restrictions',
        'auto_export',
    ];

    if ( ! in_array( $feature, $premium_features, true ) ) {
        return true;
    }

    return self::is_premium();
}
```

- [ ] **Step 3: Add `premium_error()` helper for consistent REST responses**

Add immediately after `has_feature()`:

```php
/**
 * Create a WP_Error for premium-required responses.
 *
 * @param string $feature  Feature key.
 * @param string $message  Optional custom message.
 * @return \WP_Error
 */
public static function premium_error( string $feature, string $message = '' ): \WP_Error {
    if ( ! $message ) {
        $message = __( 'This feature requires ProductForge Pro.', 'productforge' );
    }
    return new \WP_Error(
        'pf_premium_required',
        $message,
        [ 'status' => 403, 'feature' => $feature ]
    );
}
```

- [ ] **Step 4: Verify no syntax errors**

Open any admin page and confirm no PHP fatal errors.

- [ ] **Step 5: Commit**

```bash
git add includes/class-product-forge.php
git commit -m "feat: add is_premium(), has_feature(), and premium_error() helpers"
```

---

### Task 3: Pass Premium Status to JavaScript

**Files:**
- Modify: `includes/Admin/class-admin.php:113-119`
- Modify: `includes/Frontend/class-frontend.php:213-228`

- [ ] **Step 1: Update admin `wp_localize_script`**

In `includes/Admin/class-admin.php`, modify the `wp_localize_script` call (lines 113-119) to add `isPremium` and `upgradeUrl`:

```php
wp_localize_script( 'pf-template-builder', 'pfTemplateBuilder', [
    'restUrl'         => esc_url_raw( rest_url() ),
    'nonce'           => wp_create_nonce( 'wp_rest' ),
    'templateId'      => $template_id,
    'pluginUrl'       => PF_PLUGIN_URL,
    'currency_symbol' => get_woocommerce_currency_symbol(),
    'isPremium'       => ProductForge::is_premium(),
    'upgradeUrl'      => function_exists( 'pf_fs' ) ? pf_fs()->get_upgrade_url() : '',
] );
```

Ensure the `use` statement at the top of the file includes `ProductForge`:

```php
use ProductForge\ProductForge;
```

(Check if it's already imported; it may be referenced via the full namespace.)

- [ ] **Step 2: Update frontend `wp_localize_script`**

In `includes/Frontend/class-frontend.php`, add `isPremium` to the `$js_config` array in `enqueue_assets()` (around line 213-228):

```php
'isPremium' => ProductForge::is_premium(),
```

Add this line inside the existing `$js_config` array.

- [ ] **Step 3: Verify values appear in browser**

Open the template builder in the browser. In the console, type:
```js
console.log(window.pfTemplateBuilder.isPremium, window.pfTemplateBuilder.upgradeUrl);
```

Expect `false` and a URL string (or empty string if Freemius SDK isn't configured yet).

- [ ] **Step 4: Commit**

```bash
git add includes/Admin/class-admin.php includes/Frontend/class-frontend.php
git commit -m "feat: pass isPremium and upgradeUrl to admin and frontend JS"
```

---

### Task 4: REST API Gates — Templates & Views

**Files:**
- Modify: `includes/API/class-rest-templates.php:76-87,231-239`

- [ ] **Step 1: Add template creation limit**

In `class-rest-templates.php`, add `use ProductForge\ProductForge;` at the top (after the namespace declaration). Then at the start of `create_template()` method (after line 76), add:

```php
if ( ! ProductForge::has_feature( 'unlimited_templates' ) ) {
    $counts = $this->repo->get_status_counts();
    $total  = ( $counts['draft'] ?? 0 ) + ( $counts['published'] ?? 0 ) + ( $counts['archived'] ?? 0 );
    if ( $total >= 1 ) {
        return ProductForge::premium_error(
            'unlimited_templates',
            __( 'Free version is limited to 1 template. Upgrade to Pro for unlimited templates.', 'productforge' )
        );
    }
}
```

- [ ] **Step 2: Add view creation limit**

In `create_view()` method (after line 232, after the `$template_id` assignment), add:

```php
if ( ! ProductForge::has_feature( 'multi_view' ) ) {
    $view_count = $this->repo->count_views( $template_id );
    if ( $view_count >= 1 ) {
        return ProductForge::premium_error(
            'multi_view',
            __( 'Free version is limited to 1 view per template. Upgrade to Pro for multiple views.', 'productforge' )
        );
    }
}
```

- [ ] **Step 3: Add public template response stripping**

In `get_public_template()` (line 131), insert **before line 210** (before `$response = rest_ensure_response(...)`) — the variables are `$global_config` and `$sanitized_views`:

```php
if ( ! ProductForge::is_premium() ) {
    // Strip premium config keys
    unset( $global_config['product_colors_enabled'] );
    unset( $global_config['product_allowed_colors'] );
    unset( $global_config['product_any_color'] );
    unset( $global_config['product_color_mode'] );
    unset( $global_config['product_color_palette_id'] );
    unset( $global_config['pricing'] );
    unset( $global_config['permissions'] );
    unset( $global_config['clipart_enabled'] );
    unset( $global_config['solid_color'] );
    unset( $global_config['filters_enabled'] );

    // Enforce single view
    $sanitized_views = array_slice( $sanitized_views, 0, 1 );

    // Downgrade SVG boundaries to rect for free users
    foreach ( $sanitized_views as &$view ) {
        if ( ! empty( $view['zones_config'] ) ) {
            foreach ( $view['zones_config'] as &$zone ) {
                if ( ( $zone['boundary_type'] ?? 'rect' ) === 'svg' ) {
                    $zone['boundary_type'] = 'rect';
                    unset( $zone['svg_url'], $zone['svg_path_data'] );
                }
            }
        }
    }
    unset( $view, $zone ); // break references
}
```

- [ ] **Step 4: Verify template limit works**

With a free license (default), try creating a second template via the admin. Expect a 403 error with the limit message.

- [ ] **Step 5: Commit**

```bash
git add includes/API/class-rest-templates.php
git commit -m "feat: gate template/view creation and strip premium config for free users"
```

---

### Task 5: REST API Gates — Fonts, Palettes, Clipart

**Files:**
- Modify: `includes/API/class-rest-fonts.php`
- Modify: `includes/API/class-rest-palettes.php`
- Modify: `includes/API/class-rest-clipart.php`

- [ ] **Step 1: Gate font upload and delete**

In `class-rest-fonts.php`, add `use ProductForge\ProductForge;` at the top. Then at the start of `upload_font()` (line ~49):

```php
if ( ! ProductForge::has_feature( 'custom_fonts' ) ) {
    return ProductForge::premium_error( 'custom_fonts' );
}
```

Add the same check at the start of `delete_font()` (line 92) and `delete_family()` (line 105) methods.

- [ ] **Step 2: Gate palette CRUD**

In `class-rest-palettes.php`, add `use ProductForge\ProductForge;` at the top. Then at the start of `create_palette()` (line ~41):

```php
if ( ! ProductForge::has_feature( 'color_palettes' ) ) {
    return ProductForge::premium_error( 'color_palettes' );
}
```

Add the same at the start of `update_palette()` and `delete_palette()`.

- [ ] **Step 3: Gate clipart CRUD**

In `class-rest-clipart.php`, add `use ProductForge\ProductForge;` at the top. Then at the start of `create_collection()` (line 92):

```php
if ( ! ProductForge::has_feature( 'clipart' ) ) {
    return ProductForge::premium_error( 'clipart' );
}
```

Add the same at the start of `rename_collection()` (line 108), `delete_collection()` (line 123), `upload_item()` (line 138), and `delete_item()` (line 176).

- [ ] **Step 4: Commit**

```bash
git add includes/API/class-rest-fonts.php includes/API/class-rest-palettes.php includes/API/class-rest-clipart.php
git commit -m "feat: gate font, palette, and clipart endpoints for Pro"
```

---

### Task 6: Export Format Gates

**Files:**
- Modify: `includes/API/class-rest-exports.php:65-81`
- Modify: `includes/Export/class-export-manager.php:55-114`
- Modify: `includes/Frontend/class-order-integration.php`

- [ ] **Step 1: Gate export format in REST endpoint**

In `class-rest-exports.php`, add `use ProductForge\ProductForge;` at the top. Then in `trigger_export()` (line ~65), after the existing `$format` assignment (line 67), add:

```php
if ( $format === 'pdf' && ! ProductForge::has_feature( 'pdf_export' ) ) {
    return ProductForge::premium_error( 'pdf_export', __( 'PDF export requires ProductForge Pro.', 'productforge' ) );
}
if ( $format === 'svg' && ! ProductForge::has_feature( 'svg_export' ) ) {
    return ProductForge::premium_error( 'svg_export', __( 'SVG export requires ProductForge Pro.', 'productforge' ) );
}
```

- [ ] **Step 2: Gate in ExportManager as defense-in-depth**

In `class-export-manager.php`, add `use ProductForge\ProductForge;` at the top. Then at the start of `generate_export()` (line ~55), add:

```php
if ( $format === 'pdf' && ! ProductForge::has_feature( 'pdf_export' ) ) {
    return [ 'error' => __( 'PDF export requires ProductForge Pro.', 'productforge' ) ];
}
if ( $format === 'svg' && ! ProductForge::has_feature( 'svg_export' ) ) {
    return [ 'error' => __( 'SVG export requires ProductForge Pro.', 'productforge' ) ];
}
```

- [ ] **Step 3: Conditional export buttons in order view**

In `class-order-integration.php`, add `use ProductForge\ProductForge;` at the top of the file (after the namespace declaration). The `render_export_actions()` method is at line 170. The method uses a `foreach (['pdf', 'png', 'svg'] as $format)` loop at line 194. Replace that loop with:

```php
// Export buttons — gate PDF/SVG for Pro
foreach ( ['png', 'pdf', 'svg'] as $format ) {
    if ( $format !== 'png' && ! ProductForge::has_feature( $format . '_export' ) ) {
        continue;
    }
    $label = strtoupper( $format );
    echo '<button type="button" class="button button-small pf-export-btn" '
        . 'data-hash="' . esc_attr( $hash ) . '" '
        . 'data-format="' . esc_attr( $format ) . '" '
        . 'data-api="' . esc_url( $api_base ) . '" '
        . 'data-nonce="' . esc_attr( $nonce ) . '" '
        . 'style="margin-right:4px;">'
        . esc_html( $label )
        . '</button>';
}

if ( ! ProductForge::is_premium() ) {
    echo '<span class="pf-pro-badge" style="font-size:11px;color:#666;margin-left:4px;">'
       . esc_html__( 'Pro: PDF & SVG export', 'productforge' ) . '</span>';
}
```

- [ ] **Step 4: Commit**

```bash
git add includes/API/class-rest-exports.php includes/Export/class-export-manager.php includes/Frontend/class-order-integration.php
git commit -m "feat: gate PDF and SVG export formats for Pro"
```

---

### Task 7: UpgradePrompt React Component

**Files:**
- Create: `admin/js/template-builder/src/components/UpgradePrompt.jsx`
- Modify: `admin/js/template-builder/src/builder.css`

- [ ] **Step 1: Create UpgradePrompt component**

```jsx
import React from 'react';
import { __ } from '@wordpress/i18n';

export default function UpgradePrompt({ feature, description }) {
  const upgradeUrl = window.pfTemplateBuilder?.upgradeUrl || '#';

  return (
    <div className="pf-upgrade-prompt">
      <span className="pf-upgrade-prompt__badge">{__('Pro', 'productforge')}</span>
      <p className="pf-upgrade-prompt__text">{description}</p>
      <a
        href={upgradeUrl}
        className="button button-primary pf-upgrade-prompt__btn"
        target="_blank"
        rel="noopener noreferrer"
      >
        {__('Upgrade to Pro', 'productforge')}
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Add CSS styles**

Append to `admin/js/template-builder/src/builder.css`:

```css
/* ── Upgrade Prompt ──────────────────────────────────────────────────── */
.pf-upgrade-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px 16px;
  margin: 8px 0;
  background: linear-gradient(135deg, #f0f4ff 0%, #e8eeff 100%);
  border: 1px solid #c3d4f7;
  border-radius: 8px;
  text-align: center;
}
.pf-upgrade-prompt__badge {
  display: inline-block;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #fff;
  background: #2563eb;
  border-radius: 10px;
}
.pf-upgrade-prompt__text {
  margin: 0;
  font-size: 13px;
  color: #555;
  line-height: 1.5;
}
.pf-upgrade-prompt__btn {
  margin-top: 4px;
}
```

- [ ] **Step 3: Commit**

```bash
git add admin/js/template-builder/src/components/UpgradePrompt.jsx admin/js/template-builder/src/builder.css
git commit -m "feat: add UpgradePrompt component with styling"
```

---

### Task 8: Admin UI Gates — GlobalSettings

**Files:**
- Modify: `admin/js/template-builder/src/components/GlobalSettings.jsx`

- [ ] **Step 1: Import UpgradePrompt and read premium status**

Add at the top of `GlobalSettings.jsx`:

```jsx
import UpgradePrompt from './UpgradePrompt';

const isPremium = window.pfTemplateBuilder?.isPremium;
```

- [ ] **Step 2: Gate premium settings sections**

In the `renderSection()` switch statement, wrap premium sections. For each premium section, replace the content with an `UpgradePrompt` when `!isPremium`:

**Product Colors section:**
```jsx
{isPremium ? (
  <SettingsColors ... />
) : (
  <UpgradePrompt
    feature="product_colors"
    description={__('Configure product color palettes and element color modes with Pro.', 'productforge')}
  />
)}
```

**Custom Fonts section:**
```jsx
{isPremium ? (
  <SettingsFonts ... />
) : (
  <UpgradePrompt
    feature="custom_fonts"
    description={__('Upload custom fonts for your designs with Pro.', 'productforge')}
  />
)}
```

**Clip Art section:**
```jsx
{isPremium ? (
  <SettingsAssets ... />
) : (
  <UpgradePrompt
    feature="clipart"
    description={__('Create clip art libraries for customers with Pro.', 'productforge')}
  />
)}
```

**Pricing section:**
```jsx
{isPremium ? (
  <SettingsPricing ... />
) : (
  <UpgradePrompt
    feature="pricing"
    description={__('Add design surcharges and per-element pricing with Pro.', 'productforge')}
  />
)}
```

**Permissions section:**
```jsx
{isPremium ? (
  <SettingsPermissions ... />
) : (
  <UpgradePrompt
    feature="permissions"
    description={__('Fine-tune element permissions per type with Pro.', 'productforge')}
  />
)}
```

Read the exact `renderSection()` structure to determine which sections map to which premium features. Some sections (general, basic colors) should remain available in free.

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Open the template builder Settings tab. Non-premium sections should show UpgradePrompt cards.

- [ ] **Step 4: Commit**

```bash
git add admin/js/template-builder/src/components/GlobalSettings.jsx
git commit -m "feat: gate premium settings sections with UpgradePrompt"
```

---

### Task 9: Admin UI Gates — ZoneForm & ViewTabs

**Files:**
- Modify: `admin/js/template-builder/src/components/ZoneForm.jsx`
- Modify: `admin/js/template-builder/src/components/ViewTabs.jsx`
- Modify: `admin/js/template-builder/src/App.jsx`

- [ ] **Step 1: Gate SVG boundary option in ZoneForm**

In `ZoneForm.jsx`, find the `boundary_type` select. Make the SVG option conditional:

```jsx
const isPremium = window.pfTemplateBuilder?.isPremium;

<select value={data.boundary_type} onChange={...}>
  <option value="rect">{__('Rectangle', 'productforge')}</option>
  {isPremium && <option value="svg">{__('SVG Shape', 'productforge')}</option>}
</select>
```

If the zone already has `boundary_type: 'svg'` but user is not premium, show it as read-only or force to rect.

- [ ] **Step 2: Gate "+ Add View" button in ViewTabs.jsx**

The "+ Add View" button is in `ViewTabs.jsx` at line 104-111. Modify the `handleAdd` function and button:

```jsx
const isPremium = window.pfTemplateBuilder?.isPremium;

const handleAdd = () => {
  if (!isPremium && views.length >= 1) return;
  addView({ ... });
};
```

And replace the button (line 104-111) with:

```jsx
<button
  className="pf-builder__view-tab-add"
  onClick={handleAdd}
  aria-label={__('Add view', 'productforge')}
  disabled={isSaving || (!isPremium && views.length >= 1)}
  title={!isPremium && views.length >= 1 ? __('Multiple views require Pro', 'productforge') : ''}
>
  {__('+ Add View', 'productforge')}
  {!isPremium && views.length >= 1 && <span className="pf-pro-badge-inline" style={{marginLeft:4,fontSize:10}}>Pro</span>}
</button>
```

- [ ] **Step 3: Gate Permissions and Pricing tabs**

In `App.jsx`, the TABS array (lines 14-19) includes Permissions and Pricing tabs. Gate these:

```jsx
const isPremium = window.pfTemplateBuilder?.isPremium;

const TABS = [
  { label: __('Structure', 'productforge'), Component: TreePanel },
  ...(isPremium ? [{ label: __('Permissions', 'productforge'), Component: PermissionsPanel }] : []),
  ...(isPremium ? [{ label: __('Pricing', 'productforge'), Component: PricingPanel }] : []),
  { label: __('Settings', 'productforge'), Component: GlobalSettings },
];
```

- [ ] **Step 4: Build and verify**

```bash
npm run build
```

Open the template builder. Verify:
- SVG boundary option is hidden in zone form
- Only 1 view can be added (if already 1 view)
- Permissions and Pricing tabs are hidden

- [ ] **Step 5: Commit**

```bash
git add admin/js/template-builder/src/components/ZoneForm.jsx admin/js/template-builder/src/components/ViewTabs.jsx admin/js/template-builder/src/App.jsx
git commit -m "feat: gate SVG boundaries, multiple views, permissions and pricing tabs for Pro"
```

---

### Task 10: Auto-Export Gate

**Files:**
- Modify: `includes/Export/class-export-manager.php:25-48`

- [ ] **Step 1: Gate auto-export on order status**

In `class-export-manager.php`, in the `on_order_status_changed()` method (line ~32), add at the start:

```php
if ( ! ProductForge::has_feature( 'auto_export' ) ) {
    return;
}
```

This silently skips auto-export for free users without erroring.

- [ ] **Step 2: Commit**

```bash
git add includes/Export/class-export-manager.php
git commit -m "feat: gate auto-export on order status for Pro"
```

---

### Task 11: Final Build & Package

**Files:**
- No new files

- [ ] **Step 1: Build production assets**

```bash
npm run build
```

- [ ] **Step 2: Manual testing checklist (free user)**

Test with no Freemius license (default state):

| Test | Expected |
|------|----------|
| Create 1 template | Works |
| Create 2nd template | 403 error with upgrade message |
| Add 1 view | Works |
| Add 2nd view | 403 error or button disabled |
| Add text element | Works |
| Upload image | Works |
| Upload SVG | Works |
| Change text color (full picker) | Works |
| Upload custom font | 403 error |
| Create color palette | 403 error |
| Create clipart collection | 403 error |
| Export PNG | Works |
| Export PDF | 403 error or button hidden |
| Export SVG | 403 error or button hidden |
| Settings > Pricing tab | Hidden or shows UpgradePrompt |
| Settings > Permissions tab | Hidden or shows UpgradePrompt |
| Zone form > SVG boundary | Option hidden |
| Mobile responsive | Works |
| Cart integration | Works |

- [ ] **Step 3: Manual testing checklist (Pro user)**

Activate a test Freemius Pro license and verify all features work:

| Test | Expected |
|------|----------|
| All free features | Work |
| Unlimited templates | Works |
| Multiple views | Works |
| SVG boundaries | Works |
| Custom fonts | Works |
| Color palettes | Works |
| Clipart library | Works |
| PDF/SVG export | Works |
| Pricing | Works |
| Permissions | Works |
| Auto-export | Works |

- [ ] **Step 4: Test downgrade behavior**

Deactivate the Pro license and verify:
- Existing templates preserved (but can't create new beyond limit)
- Existing multi-view templates show only 1 view to customers
- Custom fonts not loaded (text falls back to Arial)
- Existing designs fully intact

- [ ] **Step 5: Commit final state**

```bash
git add -A
git commit -m "feat: complete Freemius integration with free/pro feature gating"
```
