# ProductForge — Freemius Integration & Freemium Model

## Doel

ProductForge integreren met Freemius voor licentie-management, updates, en verkoop. De plugin splitsen in een gratis Lite-versie en een betaalde Pro-versie met een duidelijke feature-verdeling.

---

## 1. Feature-verdeling: Free vs. Pro

### Free (Lite)

| Feature | Toelichting |
|---------|-------------|
| **1 template** | Voldoende om de plugin te evalueren op 1 product |
| **1 view per template** | Alleen voorkant, geen multi-view |
| **Rect zones** | Alleen rechthoekige zones (`boundary_type: 'rect'`) |
| **Tekst elementen** | Toevoegen, bewerken, font size, bold/italic |
| **Afbeelding upload** | JPG/PNG/WEBP upload in zones |
| **SVG upload** | Basis SVG upload in zones |
| **Basis kleuren** | Element color picker (volledig picker, geen paletten) |
| **PNG export** | Enkele export-format |
| **WooCommerce cart integratie** | Design hash, thumbnails, cart item label |
| **Meerdere customizations per product** | Designer reset na add-to-cart |
| **Mobile responsive** | Volledige mobiele ondersteuning |

### Pro

| Feature | Gate-locatie (bestaande code) |
|---------|------------------------------|
| **Onbeperkt templates** | `RestTemplates::create_item()` |
| **Meerdere views** (front + back) | `RestTemplates` views endpoints + frontend ViewsTab |
| **SVG boundary zones** | `ZoneForm` `boundary_type: 'svg'` + `DesignerCanvas` SVG rendering |
| **Product kleurkiezer** | `ZoneFillSection` in ElementTab, `product_colors_enabled` |
| **Kleurenpaletten** | `ColorModeFieldset`, `RestPalettes`, palette manager UI |
| **Custom fonts upload** | `RestFonts`, `FontValidator`, font upload UI |
| **Clip art library** | `RestClipart`, `CollectionManager`, frontend AddTab clipart sectie |
| **PDF export** | `PdfExporter` |
| **SVG export** | `SvgExporter` |
| **Pricing / surcharges** | `PriceCalculator`, `CartSurcharge`, pricing UI in GlobalSettings |
| **Permissions systeem** | Permissions tab in GlobalSettings |
| **Solid color product** | `solidFillColor` logica in store + ElementTab |
| **Image upload restrictions** (min DPI, min afmetingen) | `UploadValidator` advanced checks |
| **Auto-export op order status** | `ExportManager` order status hook |

---

## 2. Freemius SDK Integratie

### 2.1 SDK Installatie

Freemius SDK wordt toegevoegd als vendor dependency in de plugin root:

```
ProductDesigner/
├── freemius/           ← Freemius SDK (via hun WordPress SDK wizard)
├── productforge.php    ← SDK initialisatie hier
└── ...
```

### 2.2 SDK Initialisatie

In `productforge.php`, vóór de `ProductForge::instance()` call:

```php
if ( ! function_exists( 'pf_fs' ) ) {
    function pf_fs() {
        global $pf_fs;
        if ( ! isset( $pf_fs ) ) {
            require_once dirname( __FILE__ ) . '/freemius/start.php';
            $pf_fs = fs_dynamic_init( array(
                'id'                  => '<FREEMIUS_PLUGIN_ID>',
                'slug'                => 'productforge',
                'type'                => 'plugin',
                'public_key'          => '<PUBLIC_KEY>',
                'is_premium'          => false,   // false in free version
                'is_premium_only'     => false,   // false: plugin has free version
                'has_addons'          => false,
                'has_paid_plans'      => true,
                'menu'                => array(
                    'slug'    => 'productforge',
                    'support' => false,
                ),
            ) );
        }
        return $pf_fs;
    }
    pf_fs();
    do_action( 'pf_fs_loaded' );
}
```

### 2.3 Licentie Helper

Centraal in `includes/class-product-forge.php`:

```php
/**
 * Check of de Pro-versie actief is.
 */
public static function is_premium(): bool {
    return function_exists( 'pf_fs' ) && pf_fs()->is_paying();
}

/**
 * Check of een specifieke feature beschikbaar is.
 */
public static function has_feature( string $feature ): bool {
    $premium_features = [
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
        return true; // Onbekende feature = altijd beschikbaar
    }

    return self::is_premium();
}
```

---

## 3. Gate-implementatie per laag

### 3.1 PHP — REST API Gates

Elke premium endpoint krijgt een early-return check. Patroon:

```php
// In elke premium endpoint callback:
if ( ! ProductForge::has_feature( 'custom_fonts' ) ) {
    return new \WP_Error(
        'pf_premium_required',
        __( 'This feature requires ProductForge Pro.', 'productforge' ),
        [ 'status' => 403 ]
    );
}
```

**Endpoints die gegated worden:**

| Endpoint | Feature key |
|----------|-------------|
| `POST /fonts` | `custom_fonts` |
| `DELETE /fonts/*` | `custom_fonts` |
| `POST /palettes` | `color_palettes` |
| `PUT/DELETE /palettes/*` | `color_palettes` |
| `POST /clipart/collections` | `clipart` |
| `POST /clipart` | `clipart` |
| `POST /exports/{hash}` (format=pdf) | `pdf_export` |
| `POST /exports/{hash}` (format=svg) | `svg_export` |
| `POST /templates` (als limiet bereikt) | `unlimited_templates` |
| `POST /templates/{id}/views` (als >1 view) | `multi_view` |

**Template limiet check** in `RestTemplates::create_item()`:

```php
if ( ! ProductForge::has_feature( 'unlimited_templates' ) ) {
    $repo = new TemplateRepository();
    $counts = $repo->get_status_counts();
    $total = ( $counts['draft'] ?? 0 ) + ( $counts['published'] ?? 0 ) + ( $counts['archived'] ?? 0 );
    if ( $total >= 1 ) {
        return new \WP_Error(
            'pf_template_limit',
            __( 'Free version is limited to 1 template. Upgrade to Pro for unlimited templates.', 'productforge' ),
            [ 'status' => 403 ]
        );
    }
}
```

**View limiet check** in `RestTemplates` view creation:

```php
if ( ! ProductForge::has_feature( 'multi_view' ) ) {
    $view_count = $repo->count_views( $template_id );
    if ( $view_count >= 1 ) {
        return new \WP_Error(
            'pf_view_limit',
            __( 'Free version is limited to 1 view per template. Upgrade to Pro for multiple views.', 'productforge' ),
            [ 'status' => 403 ]
        );
    }
}
```

### 3.2 PHP — Public Template Response

In `RestTemplates::get_public_template()`, strip premium config uit de response voor free users:

```php
if ( ! ProductForge::is_premium() ) {
    // Strip product color config
    unset( $config['product_colors_enabled'] );
    unset( $config['product_allowed_colors'] );
    unset( $config['product_any_color'] );

    // Strip pricing config
    unset( $config['pricing'] );

    // Strip permissions
    unset( $config['permissions'] );

    // Strip clipart
    unset( $config['clipart_enabled'] );

    // Enforce single view
    $views = array_slice( $views, 0, 1 );

    // Strip SVG boundary data from zones (downgrade to rect)
    foreach ( $views as &$view ) {
        if ( ! empty( $view['zones_config'] ) ) {
            foreach ( $view['zones_config'] as &$zone ) {
                if ( ( $zone['boundary_type'] ?? 'rect' ) === 'svg' ) {
                    $zone['boundary_type'] = 'rect';
                    unset( $zone['svg_url'], $zone['svg_path_data'] );
                }
            }
        }
    }
}
```

### 3.3 JavaScript — Admin UI Gates

Data doorgeven aan React via `wp_localize_script()` in `class-admin.php`:

```php
wp_localize_script( 'pf-template-builder', 'pfTemplateBuilder', [
    'restUrl'         => esc_url_raw( rest_url() ),
    'nonce'           => wp_create_nonce( 'wp_rest' ),
    'templateId'      => $template_id,
    'pluginUrl'       => PF_PLUGIN_URL,
    'currency_symbol' => get_woocommerce_currency_symbol(),
    'isPremium'       => ProductForge::is_premium(),       // ← NIEUW
    'upgradeUrl'      => function_exists( 'pf_fs' )        // ← NIEUW
                         ? pf_fs()->get_upgrade_url()
                         : '',
] );
```

### 3.4 JavaScript — React UpgradePrompt Component

Herbruikbaar component voor premium-gated secties:

```jsx
function UpgradePrompt({ feature, description }) {
  const upgradeUrl = window.pfTemplateBuilder?.upgradeUrl || '#';
  return (
    <div className="pf-upgrade-prompt">
      <span className="pf-upgrade-prompt__badge">Pro</span>
      <p>{description}</p>
      <a href={upgradeUrl} className="button button-primary" target="_blank" rel="noopener">
        {__('Upgrade to Pro', 'productforge')}
      </a>
    </div>
  );
}
```

### 3.5 JavaScript — Admin Feature Gates

In `GlobalSettings.jsx` conditioneel renderen:

```jsx
const isPremium = window.pfTemplateBuilder?.isPremium;

// Colorpicker Product — Pro only
{isPremium ? (
  <ColorModeFieldset prefix="product" ... />
) : (
  <UpgradePrompt feature="product_colors" description="Configure product color palettes with Pro." />
)}

// Pricing — Pro only
{isPremium ? (
  <PricingFieldset ... />
) : (
  <UpgradePrompt feature="pricing" description="Add design surcharges with Pro." />
)}

// Permissions — Pro only
{isPremium ? (
  <PermissionsTab ... />
) : (
  <UpgradePrompt feature="permissions" description="Fine-tune element permissions with Pro." />
)}
```

In `ZoneForm.jsx`:

```jsx
// SVG boundary — Pro only
<select value={data.boundary_type} onChange={...}>
  <option value="rect">{__('Rectangle', 'productforge')}</option>
  {isPremium && <option value="svg">{__('SVG Shape', 'productforge')}</option>}
</select>
```

In de view tabs:

```jsx
// "+ Add View" knop — Pro only
{isPremium ? (
  <button onClick={addView}>+ Add View</button>
) : (
  <span title="Multiple views require Pro" style={{ opacity: 0.5 }}>+ Add View (Pro)</span>
)}
```

### 3.6 JavaScript — Frontend Feature Gates

In `App.jsx` of via de public template response (die al gestript is door PHP):

```jsx
// Frontend hoeft minimaal gegated te worden omdat de PHP-laag
// premium config al uit de public template response verwijdert.
// De frontend rendert gewoon wat de API teruggeeft.
```

Het voordeel van server-side stripping: de frontend code hoeft niet aangepast te worden. Als `product_colors_enabled` niet in de config zit, toont de frontend gewoon geen product color picker. Als er maar 1 view is, toont hij geen view tabs.

---

## 4. Export Gate

In `ExportManager::generate_export()`:

```php
public function generate_export( string $design_hash, string $format = 'pdf', int $order_id = 0 ): array {
    // Gate premium export formats
    if ( $format === 'pdf' && ! ProductForge::has_feature( 'pdf_export' ) ) {
        return [ 'error' => __( 'PDF export requires ProductForge Pro.', 'productforge' ) ];
    }
    if ( $format === 'svg' && ! ProductForge::has_feature( 'svg_export' ) ) {
        return [ 'error' => __( 'SVG export requires ProductForge Pro.', 'productforge' ) ];
    }
    // ... bestaande logica
}
```

In de admin order view, toon alleen beschikbare export knoppen:

```php
// PNG altijd beschikbaar
echo '<button data-format="png">Export PNG</button>';

// PDF/SVG alleen voor Pro
if ( ProductForge::is_premium() ) {
    echo '<button data-format="pdf">Export PDF</button>';
    echo '<button data-format="svg">Export SVG</button>';
} else {
    echo '<span class="pf-pro-badge">Pro: PDF & SVG export</span>';
}
```

---

## 5. Freemius Dashboard & Distributie

### 5.1 Twee versies bouwen

Freemius ondersteunt twee distributiemodellen. Aanbevolen: **één codebase, runtime checks**.

- De free versie op WordPress.org bevat alle code maar gates premium features via `pf_fs()->is_paying()`.
- Bij activering van een Pro-licentie worden de features direct beschikbaar.
- Geen aparte "pro" bestanden nodig — alles is al in de plugin.

### 5.2 Freemius Features

Wat Freemius uit de doos biedt:

| Feature | Beschrijving |
|---------|-------------|
| **Licentie-activatie** | In-dashboard activatiescherm |
| **Auto-updates** | Pro updates via Freemius servers (niet WordPress.org) |
| **Deactivation feedback** | Vraag waarom bij deactivatie |
| **In-admin upgrade prompts** | Upgrade CTA's in de plugin admin pagina |
| **Trials** | Optioneel: 14-dagen gratis Pro trial |
| **Pricing page** | Gehost door Freemius |
| **Analytics** | Installaties, activaties, deactivaties, upgrade conversie |

### 5.3 Aanbevolen Pricing

| Plan | Prijs (suggestie) | Licentie |
|------|-------------------|----------|
| **Lite** | Gratis | Onbeperkt |
| **Pro (1 site)** | €49/jaar | 1 site |
| **Pro (5 sites)** | €99/jaar | 5 sites |
| **Pro (25 sites)** | €199/jaar | 25 sites |
| **Lifetime (1 site)** | €149 eenmalig | 1 site, lifetime updates |

---

## 6. Implementatie-volgorde

### Fase 1: SDK Setup (klein)
1. Freemius account aanmaken, plugin registreren
2. SDK downloaden en toevoegen aan plugin root
3. `pf_fs()` initialisatie in `productforge.php`
4. `is_premium()` en `has_feature()` helpers toevoegen
5. `isPremium` + `upgradeUrl` toevoegen aan `wp_localize_script()`

### Fase 2: PHP Gates (medium)
1. Template limiet check in `RestTemplates::create_item()`
2. View limiet check in view creation
3. Export format gates in `ExportManager`
4. Premium endpoint gates (fonts, clipart, palettes)
5. Public template response stripping voor free users

### Fase 3: Admin UI Gates (medium)
1. `UpgradePrompt` component maken
2. GlobalSettings premium secties conditioneel renderen
3. ZoneForm SVG boundary optie gaten
4. View tabs "+ Add View" gaten
5. Export knoppen in order view gaten
6. Pricing tab gaten
7. Permissions tab gaten

### Fase 4: Testen & Release (klein)
1. Testen als free user (geen licentie)
2. Testen als Pro user (met test-licentie)
3. Testen upgrade flow (free → Pro)
4. Testen downgrade flow (Pro → free, bestaande data behouden)
5. Package bouwen en uploaden naar Freemius

---

## 7. Belangrijk: Downgrade-gedrag

Wanneer een Pro-licentie verloopt:

- **Templates:** Bestaande templates blijven bewaard maar er kunnen geen nieuwe aangemaakt worden boven de limiet. Bestaande templates met meerdere views tonen alleen view 1 aan klanten.
- **SVG zones:** Worden als rect gerenderd voor klanten (admin kan ze nog zien maar niet bewerken).
- **Custom fonts:** Blijven in de database maar worden niet geladen. Tekst valt terug op Arial.
- **Exports:** PNG blijft werken. PDF/SVG knoppen verdwijnen.
- **Designs:** Alle bestaande klantontwerpen blijven volledig intact en bewerkbaar.

Het principe: **nooit data verwijderen bij downgrade**, alleen features beperken.

---

## 8. Bestanden die aangepast worden

| Bestand | Wijziging |
|---------|-----------|
| `productforge.php` | Freemius SDK init |
| `includes/class-product-forge.php` | `is_premium()`, `has_feature()` |
| `includes/Admin/class-admin.php` | `isPremium` + `upgradeUrl` in localized script |
| `includes/API/class-rest-templates.php` | Template/view limieten, public response stripping |
| `includes/API/class-rest-fonts.php` | Premium gate |
| `includes/API/class-rest-palettes.php` | Premium gate |
| `includes/API/class-rest-clipart.php` | Premium gate |
| `includes/API/class-rest-exports.php` | Format gate |
| `includes/Export/class-export-manager.php` | Format gate |
| `includes/Frontend/class-order-integration.php` | Export knoppen conditioneel |
| `admin/js/template-builder/src/components/GlobalSettings.jsx` | UpgradePrompt voor premium secties |
| `admin/js/template-builder/src/components/ZoneForm.jsx` | SVG optie gaten |
| `admin/js/template-builder/src/App.jsx` | View tabs gaten |
| **Nieuw:** `admin/js/template-builder/src/components/UpgradePrompt.jsx` | Herbruikbaar upgrade component |
| **Nieuw:** `freemius/` directory | Freemius SDK bestanden |
