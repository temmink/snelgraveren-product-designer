<?php
namespace Snelgraveren\ProductDesigner\API;

defined('ABSPATH') || exit;

use Snelgraveren\ProductDesigner\Database\TemplateRepository;
use Snelgraveren\ProductDesigner\Database\FontRepository;

/**
 * Cross-site template transfer: export a product template (views/zones/layers
 * plus every referenced upload) as one self-contained JSON document, and
 * import such a document on another site.
 *
 * Export rewrites uploads URLs (view background_url, zone svg_url, layer src)
 * to `asset:{key}` references and embeds the file contents base64 in an
 * `assets` map — the starter-templates pattern, but with the catalog inlined
 * in the payload. Import reverses this: every asset is re-validated (SVGs
 * through enshrined Sanitizer, raster images through finfo magic bytes),
 * written to uploads/pf-template-assets/, and the refs are rewritten to the
 * new URLs. Inline svg_markup on zones/layers is re-sanitized as well — the
 * payload is user-supplied and must never be trusted.
 */
class RestTemplateTransfer {

    private const FORMAT           = 'sgpd-template';
    private const VERSION          = 1;
    private const MAX_IMPORT_BYTES = 20 * 1024 * 1024; // whole payload
    private const ALLOWED_RASTER   = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

    /** Font families shipped with the designer (utils/fonts.js) — anything
     *  else must exist in wp_pf_fonts on the target site or we warn. */
    private const BUILTIN_FONTS = [
        'Arial', 'Verdana', 'Helvetica', 'Tahoma', 'Trebuchet MS', 'Times New Roman',
        'Georgia', 'Garamond', 'Courier New', 'Impact', 'Comic Sans MS', 'Roboto',
        'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Inter', 'Raleway', 'Nunito',
        'Ubuntu', 'Oswald', 'Playfair Display', 'Merriweather', 'Lora', 'PT Serif',
        'Roboto Slab', 'Roboto Mono', 'Source Code Pro', 'Fira Code', 'Dancing Script',
        'Pacifico', 'Great Vibes', 'Caveat', 'Satisfy', 'Bebas Neue', 'Lobster',
        'Righteous', 'Permanent Marker', 'Alfa Slab One', 'Anton', 'Bangers',
    ];

    private TemplateRepository $repo;

    public function __construct() {
        $this->repo = new TemplateRepository();
    }

    public function register_routes(): void {
        $ns = 'pf/v1';
        register_rest_route($ns, '/templates/(?P<id>\d+)/export', [
            ['methods' => 'GET', 'callback' => [$this, 'export_template'], 'permission_callback' => [$this, 'admin_permission']],
        ]);
        register_rest_route($ns, '/templates/import', [
            ['methods' => 'POST', 'callback' => [$this, 'import_template'], 'permission_callback' => [$this, 'admin_permission']],
        ]);
    }

    public function admin_permission(): bool {
        return current_user_can('edit_sgpd_templates');
    }

    // ── Export ────────────────────────────────────────────────────────────

    public function export_template(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $template = $this->repo->get((int) $request['id']);
        if (!$template) {
            return new \WP_Error('pf_not_found', __('Template not found.', 'snelgraveren-product-designer'), ['status' => 404]);
        }

        $uploads = wp_upload_dir();
        $assets  = [];
        $url_map = []; // url → asset:key (dedupe shared assets)

        $embed = function ($url) use ($uploads, &$assets, &$url_map) {
            if (!is_string($url) || $url === '' || !str_starts_with($url, $uploads['baseurl'])) {
                return $url; // external or empty — leave untouched
            }
            if (isset($url_map[$url])) {
                return $url_map[$url];
            }
            $path = str_replace($uploads['baseurl'], $uploads['basedir'], $url);
            $data = is_readable($path) ? file_get_contents($path) : false;
            if ($data === false) {
                return $url; // unreadable — keep original URL (best effort)
            }
            $key = 'a' . (count($assets) + 1) . '-' . sanitize_file_name(basename($path));
            $finfo = new \finfo(FILEINFO_MIME_TYPE);
            $assets[$key] = [
                'name' => sanitize_file_name(basename($path)),
                'mime' => $finfo->buffer($data) ?: 'application/octet-stream',
                'data' => base64_encode($data),
            ];
            $url_map[$url] = 'asset:' . $key;
            return $url_map[$url];
        };

        $views = [];
        foreach ($template['views'] as $view) {
            unset($view['id'], $view['template_id'], $view['created_at'], $view['updated_at']);
            $view['background_url'] = $embed($view['background_url'] ?? '');
            $zones = is_array($view['zones_config'] ?? null) ? $view['zones_config'] : [];
            foreach ($zones as &$zone) {
                if (isset($zone['svg_url'])) {
                    $zone['svg_url'] = $embed($zone['svg_url']);
                }
                foreach (($zone['layers'] ?? []) as &$layer) {
                    if (isset($layer['src'])) {
                        $layer['src'] = $embed($layer['src']);
                    }
                }
                unset($layer);
            }
            unset($zone);
            $view['zones_config'] = $zones;
            $views[] = $view;
        }

        return new \WP_REST_Response([
            'format'         => self::FORMAT,
            'version'        => self::VERSION,
            'plugin_version' => defined('SGPD_VERSION') ? SGPD_VERSION : '',
            'template'       => [
                'title'         => $template['title'],
                'global_config' => $template['global_config'],
            ],
            'views'          => $views,
            'assets'         => $assets,
        ], 200);
    }

    // ── Import ────────────────────────────────────────────────────────────

    public function import_template(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $raw = $request->get_body();
        if (strlen($raw) > self::MAX_IMPORT_BYTES) {
            return new \WP_Error('pf_import_too_large', __('Import file is too large (max 20 MB).', 'snelgraveren-product-designer'), ['status' => 400]);
        }
        $data = json_decode($raw, true);
        if (!is_array($data) || ($data['format'] ?? '') !== self::FORMAT || (int) ($data['version'] ?? 0) !== self::VERSION) {
            return new \WP_Error('pf_import_invalid', __('This is not a valid template export file.', 'snelgraveren-product-designer'), ['status' => 400]);
        }
        if (!class_exists(\enshrined\svgSanitize\Sanitizer::class)) {
            return new \WP_Error('pf_svg_sanitizer_missing', __('SVG sanitizer is not available.', 'snelgraveren-product-designer'), ['status' => 500]);
        }

        $warnings = [];

        // 1) Materialize every asset (validate + sanitize + write) up front.
        $asset_urls = [];
        foreach ((array) ($data['assets'] ?? []) as $key => $asset) {
            $url = $this->store_asset((string) $key, (array) $asset);
            if (is_wp_error($url)) {
                return $url;
            }
            if ($url === null) {
                $warnings[] = sprintf(
                    /* translators: %s: asset key */
                    __('Asset "%s" was skipped (unsupported or invalid file).', 'snelgraveren-product-designer'),
                    $key
                );
                continue;
            }
            $asset_urls['asset:' . $key] = $url;
        }

        $resolve = function ($ref) use ($asset_urls, &$warnings) {
            if (!is_string($ref) || !str_starts_with($ref, 'asset:')) {
                return is_string($ref) ? esc_url_raw($ref) : '';
            }
            if (isset($asset_urls[$ref])) {
                return $asset_urls[$ref];
            }
            $warnings[] = sprintf(
                /* translators: %s: asset reference */
                __('Missing asset reference "%s" — the field was cleared.', 'snelgraveren-product-designer'),
                $ref
            );
            return '';
        };

        // 2) Known fonts on THIS site (builtin + uploaded custom fonts).
        $known_fonts = array_map('strtolower', self::BUILTIN_FONTS);
        foreach (FontRepository::all() as $font) {
            $known_fonts[] = strtolower((string) ($font['family'] ?? ''));
        }

        // 3) Rebuild views with resolved refs + sanitized markup.
        $views          = [];
        $missing_fonts  = [];
        foreach ((array) ($data['views'] ?? []) as $view) {
            if (!is_array($view)) {
                continue;
            }
            $view['background_url'] = $resolve($view['background_url'] ?? '');
            $zones = is_array($view['zones_config'] ?? null) ? $view['zones_config'] : [];
            foreach ($zones as &$zone) {
                if (!is_array($zone)) {
                    continue;
                }
                if (isset($zone['svg_url'])) {
                    $zone['svg_url'] = $resolve($zone['svg_url']);
                }
                foreach (($zone['layers'] ?? []) as &$layer) {
                    if (!is_array($layer)) {
                        continue;
                    }
                    if (isset($layer['src'])) {
                        $layer['src'] = $resolve($layer['src']);
                    }
                    $family = (string) ($layer['fontFamily'] ?? '');
                    if ($family !== '' && !in_array(strtolower($family), $known_fonts, true)) {
                        $missing_fonts[$family] = true;
                    }
                }
                unset($layer);
            }
            unset($zone);
            $view['zones_config'] = $this->sanitize_zone_layers($zones);
            $views[] = $view;
        }

        foreach (array_keys($missing_fonts) as $family) {
            $warnings[] = sprintf(
                /* translators: %s: font family name */
                __('Font "%s" is not available on this site — text will fall back to Arial until you upload it.', 'snelgraveren-product-designer'),
                $family
            );
        }

        // 4) Create the template as a draft.
        $title = sanitize_text_field($data['template']['title'] ?? __('Imported template', 'snelgraveren-product-designer'));
        $template_id = $this->repo->create([
            'title'         => $title,
            'slug'          => sanitize_title($title) . '-import-' . time(),
            'status'        => 'draft',
            'global_config' => is_array($data['template']['global_config'] ?? null) ? $data['template']['global_config'] : [],
        ]);
        if (!$template_id) {
            return new \WP_Error('pf_import_create_failed', __('Failed to create template.', 'snelgraveren-product-designer'), ['status' => 500]);
        }

        foreach ($views as $index => $view) {
            $view['sort_order'] = (int) ($view['sort_order'] ?? $index);
            $this->repo->create_view($template_id, $view);
        }

        return new \WP_REST_Response(['id' => $template_id, 'warnings' => $warnings], 201);
    }

    /**
     * Validate and store one embedded asset in uploads/pf-template-assets/.
     * SVGs are sanitized; raster images must match an allowed mime by magic
     * bytes. Returns the new URL, null to skip (unsupported type), or a
     * WP_Error for infrastructure failures.
     */
    private function store_asset(string $key, array $asset): string|null|\WP_Error {
        $data = base64_decode((string) ($asset['data'] ?? ''), true);
        if ($data === false || $data === '') {
            return null;
        }

        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $mime  = $finfo->buffer($data) ?: '';
        $name  = sanitize_file_name((string) ($asset['name'] ?? $key));

        if ($mime === 'image/svg+xml' || str_contains($mime, 'xml') || str_starts_with(ltrim($data), '<')) {
            $sanitizer = new \enshrined\svgSanitize\Sanitizer();
            $clean     = $sanitizer->sanitize($data);
            if (!is_string($clean) || $clean === '') {
                return null;
            }
            $data = $clean;
            if (!str_ends_with(strtolower($name), '.svg')) {
                $name .= '.svg';
            }
        } elseif (!in_array($mime, self::ALLOWED_RASTER, true)) {
            return null;
        }

        $uploads = wp_upload_dir();
        $dir     = $uploads['basedir'] . '/pf-template-assets';
        if (!wp_mkdir_p($dir)) {
            return new \WP_Error('pf_import_dir_failed', __('Could not create the assets directory.', 'snelgraveren-product-designer'), ['status' => 500]);
        }
        $unique = wp_unique_filename($dir, $name);
        if (file_put_contents($dir . '/' . $unique, $data) === false) {
            return new \WP_Error('pf_import_write_failed', __('Could not store an imported asset.', 'snelgraveren-product-designer'), ['status' => 500]);
        }
        return $uploads['baseurl'] . '/pf-template-assets/' . $unique;
    }

    /**
     * Same contract as RestTemplates::sanitize_zone_layers (private there):
     * strip scripts/handlers from zone-level and layer-level svg_markup.
     */
    private function sanitize_zone_layers(array $zones): array {
        $sanitizer = new \enshrined\svgSanitize\Sanitizer();

        $clean_markup = static function ($markup) use ($sanitizer) {
            if (!is_string($markup) || $markup === '') {
                return '';
            }
            $clean = $sanitizer->sanitize($markup);
            return is_string($clean) ? $clean : '';
        };

        foreach ($zones as &$zone) {
            if (is_array($zone) && isset($zone['svg_markup'])) {
                $zone['svg_markup'] = $clean_markup($zone['svg_markup']);
            }
            if (empty($zone['layers']) || !is_array($zone['layers'])) {
                continue;
            }
            foreach ($zone['layers'] as &$layer) {
                if (is_array($layer) && isset($layer['svg_markup'])) {
                    $layer['svg_markup'] = $clean_markup($layer['svg_markup']);
                }
            }
            unset($layer);
        }
        unset($zone);

        return $zones;
    }
}
