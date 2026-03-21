# Split Color Pickers: Product vs Elements

## Summary

Split the single color picker configuration into two independent configurations: one for product color (zone fills) and one for element colors (text fill, SVG tint). Both are independently configurable by the admin in GlobalSettings.

## Current State

One shared config controls both product color and element color:
- `colors_enabled` — enables color picking
- `color_mode` — `all` | `palette` | `individual`
- `color_palette_id` — selected palette ID
- `allowed_colors` — array of hex strings
- `any_color` — derived in PHP: true when mode is `all`

Frontend `ElementTab.jsx` reads these for both `ZoneFillSection` (product color) and `TextProperties`/`ImageProperties` (element colors).

## New Config Keys

### Product Color Picker

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `product_colors_enabled` | boolean | false | Show product color picker in frontend |
| `product_color_mode` | string | `individual` | `all` / `palette` / `individual` |
| `product_color_palette_id` | string | `''` | Selected palette ID |
| `product_allowed_colors` | array | `[]` | Hex color strings for individual mode |

### Element Color Picker

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `element_colors_enabled` | boolean | false | Show element color controls in frontend |
| `element_color_mode` | string | `individual` | `all` / `palette` / `individual` |
| `element_color_palette_id` | string | `''` | Selected palette ID |
| `element_allowed_colors` | array | `[]` | Hex color strings for individual mode |

Note: default for `*_color_mode` is `individual` to match the existing default in `migrateGlobalConfig()`.

## Backwards Compatibility

When loading a template's `global_config`, if the new keys are absent but old keys exist, migrate automatically:

```
product_colors_enabled   ← colors_enabled
product_color_mode       ← color_mode
product_color_palette_id ← color_palette_id
product_allowed_colors   ← allowed_colors
element_colors_enabled   ← colors_enabled
element_color_mode       ← color_mode
element_color_palette_id ← color_palette_id
element_allowed_colors   ← allowed_colors
```

This means existing templates get both pickers set to whatever the old single picker was. The old keys are not deleted (no DB migration needed) — they're simply ignored once the new keys are present.

### Migration locations

The migration must run in three places:

1. **`useTemplateStore.js` → `migrateGlobalConfig()`** — admin template builder (existing migration function)
2. **`class-rest-templates.php` → `get_public_template()`** — frontend public API
3. **`class-rest-templates.php` → `list_templates()`** — admin template list

## Visibility Semantics

- When `product_colors_enabled` is **false**, the `ZoneFillSection` does not render at all (no product color UI).
- When `element_colors_enabled` is **false**, the color control in `TextProperties` and the tint control in `ImageProperties` are hidden entirely, regardless of the `perms.recolor` permission.
- When either is **true**, the `perms.recolor` permission still applies as an additional gate for element colors.

## Admin UI Changes

### GlobalSettings.jsx

Replace the current "Color Picker" fieldset with two fieldsets:

**Fieldset: "Colorpicker Product"** (position: after "Product Color" fieldset)
- Checkbox: "Enable product color picker"
- When enabled: mode selector (all / palette / individual), same UI pattern as current
- Uses `product_*` config keys
- Has its own `pendingColor` state for the individual-mode color input

**Fieldset: "Colorpicker Elements"** (position: after "Colorpicker Product")
- Checkbox: "Enable element color picker"
- When enabled: mode selector (all / palette / individual), same UI pattern as current
- Uses `element_*` config keys
- Has its own `pendingColor` state for the individual-mode color input

Each fieldset independently shows a "Manage Palettes" button when in palette mode. Both render the same `PaletteManager` component with independent toggle state.

To reduce duplication, extract a `ColorModeFieldset` component that takes a config key prefix (`product_` or `element_`), a legend string, and renders the shared checkbox + mode selector + palette/swatch UI.

## Frontend Changes

### PHP Public Template Response

In `get_public_template()`, resolve both color pickers to a simple, flat output:

```php
// For each picker (product_, element_):
$config['product_any_color']      = ($config['product_color_mode'] ?? 'individual') === 'all';
$config['product_allowed_colors'] = self::resolve_colors($config, 'product_');
$config['element_any_color']      = ($config['element_color_mode'] ?? 'individual') === 'all';
$config['element_allowed_colors'] = self::resolve_colors($config, 'element_');
```

Where `resolve_colors()` returns:
- For mode `all`: empty array (frontend uses free picker)
- For mode `individual`: the `*_allowed_colors` array as-is
- For mode `palette`: look up the palette by `*_color_palette_id` and return its colors array

This keeps the frontend contract simple: check `*_any_color` for free picker, otherwise use `*_allowed_colors` as swatches.

### ElementTab.jsx — ZoneFillSection

- Only render when `product_colors_enabled` is true AND `editableZones.length > 0`
- Read `product_any_color` and `product_allowed_colors` (resolved by PHP)
- The `solid_color` setting remains orthogonal — it controls whether zones sync colors across views, not whether the picker appears

### ElementTab.jsx — TextProperties

- Color control only renders when `element_colors_enabled` is true AND `perms.recolor !== false`
- Read `element_any_color` and `element_allowed_colors` (resolved by PHP)

### ElementTab.jsx — ImageProperties (SVG tint)

Same as TextProperties — reads `element_*` resolved keys.

## Files to Modify

| File | Change |
|------|--------|
| `admin/js/template-builder/src/components/GlobalSettings.jsx` | Split "Color Picker" into two fieldsets, extract `ColorModeFieldset` |
| `admin/js/template-builder/src/store/useTemplateStore.js` | Update `migrateGlobalConfig()` for new keys |
| `frontend/js/designer/src/components/tabs/ElementTab.jsx` | Read separate `product_*` / `element_*` config keys |
| `includes/API/class-rest-templates.php` | Migrate old keys + resolve palettes in `get_public_template()` |

## Not in Scope

- New database tables or migrations (config lives in existing `global_config` JSON column)
- New REST endpoints (palette API already exists)
- Changes to export system (exports use canvas state, not config)
- Changes to pricing system
- Changes to `solid_color` behavior (orthogonal to color picker split)
