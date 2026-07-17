<?php
namespace ProductForge\Admin;

defined('ABSPATH') || exit;

use ProductForge\Database\TemplateRepository;
use ProductForge\ProductForge;

/**
 * Bundled "starter" product templates (see templates/starter/manifest.json).
 *
 * Static content ships with the plugin; importing a starter copies its referenced
 * SVG assets into uploads/pf-template-assets/ (sanitized via enshrined/svg-sanitize),
 * rewrites the `asset:` placeholders to real URLs, and creates a real template + views
 * via TemplateRepository. Imported templates land as slug `starter-{id}`, which also
 * doubles as the "already imported" detector — no extra DB column needed.
 */
class StarterTemplates {

    private TemplateRepository $repo;

    public function __construct() {
        $this->repo = new TemplateRepository();
    }

    public function register_routes(): void {
        $ns = 'pf/v1';

        register_rest_route($ns, '/starter-templates', [
            ['methods' => 'GET', 'callback' => [$this, 'list_catalog'], 'permission_callback' => [$this, 'admin_permission']],
        ]);

        register_rest_route($ns, '/starter-templates/(?P<id>[a-z0-9-]+)/import', [
            ['methods' => 'POST', 'callback' => [$this, 'import_starter'], 'permission_callback' => [$this, 'admin_permission']],
        ]);
    }

    public function admin_permission(): bool {
        return current_user_can('edit_pf_templates');
    }

    public function list_catalog(\WP_REST_Request $request): \WP_REST_Response {
        return rest_ensure_response($this->get_catalog());
    }

    public function import_starter(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $starter_id = sanitize_text_field((string) $request['id']);
        $result     = $this->import($starter_id);

        if (is_wp_error($result)) {
            return $result;
        }

        return new \WP_REST_Response(['template_id' => $result], 201);
    }

    /**
     * Parsed manifest with an `imported` flag added to every entry.
     */
    public function get_catalog(): array {
        $catalog = [];
        foreach ($this->load_manifest() as $entry) {
            $entry['imported'] = (bool) $this->repo->get_by_slug('starter-' . ($entry['id'] ?? ''));
            $catalog[]          = $entry;
        }
        return $catalog;
    }

    /**
     * Import a starter template by manifest id. Returns the new template id, or a
     * WP_Error (free-tier limit reached, already imported, not found, or an asset
     * failure).
     *
     * @return int|\WP_Error
     */
    public function import(string $starter_id) {
        // Free-limit enforcement FIRST — mirrors RestTemplates::create_template exactly.
        if (!ProductForge::has_feature('unlimited_templates')) {
            $counts = $this->repo->get_status_counts();
            $total  = ($counts['draft'] ?? 0) + ($counts['published'] ?? 0) + ($counts['archived'] ?? 0);
            if ($total >= 1) {
                return ProductForge::premium_error(
                    'unlimited_templates',
                    __('Free version is limited to 1 template. Upgrade to Pro for unlimited templates.', 'productforge')
                );
            }
        }

        $entry = null;
        foreach ($this->load_manifest() as $item) {
            if (($item['id'] ?? '') === $starter_id) {
                $entry = $item;
                break;
            }
        }
        if ($entry === null) {
            return new \WP_Error(
                'pf_starter_not_found',
                __('Starter template not found.', 'productforge'),
                ['status' => 404]
            );
        }

        $slug = 'starter-' . $starter_id;
        if ($this->repo->get_by_slug($slug)) {
            return new \WP_Error(
                'pf_starter_already_imported',
                __('This starter template has already been imported.', 'productforge'),
                ['status' => 409]
            );
        }

        if (!class_exists(\enshrined\svgSanitize\Sanitizer::class)) {
            return new \WP_Error(
                'pf_svg_sanitizer_missing',
                __('SVG sanitizer is not available.', 'productforge'),
                ['status' => 500]
            );
        }

        // Resolve (copy + sanitize + rewrite) every `asset:` reference before touching the DB.
        $asset_cache = [];
        $views       = [];
        foreach ($entry['views'] ?? [] as $view) {
            $background_url = $this->resolve_asset((string) ($view['background_url'] ?? ''), $asset_cache);
            if (is_wp_error($background_url)) {
                return $background_url;
            }

            $zones = $view['zones'] ?? [];
            foreach ($zones as &$zone) {
                $svg_url = $this->resolve_asset((string) ($zone['svg_url'] ?? ''), $asset_cache);
                if (is_wp_error($svg_url)) {
                    return $svg_url;
                }
                $zone['svg_url'] = $svg_url;
            }
            unset($zone);

            $views[] = [
                'name'           => $view['name'] ?? '',
                'canvas_width'   => $view['canvas_width'] ?? 800,
                'canvas_height'  => $view['canvas_height'] ?? 600,
                'background_url' => $background_url,
                'zones_config'   => $zones,
                'layers_config'  => $view['layers'] ?? [],
                'permissions'    => $view['permissions'] ?? [],
            ];
        }

        $template_id = $this->repo->create([
            'title'         => $entry['title'] ?? $starter_id,
            'slug'          => $slug,
            'status'        => 'draft',
            'global_config' => $entry['global_config'] ?? [],
        ]);
        if (!$template_id) {
            return new \WP_Error(
                'pf_starter_create_failed',
                __('Failed to create template.', 'productforge'),
                ['status' => 500]
            );
        }

        foreach ($views as $index => $view) {
            $view['sort_order'] = $index;
            $this->repo->create_view($template_id, $view);
        }

        return $template_id;
    }

    /**
     * Resolve an `asset:FILENAME` placeholder to a real uploads URL, copying and
     * sanitizing the source file on first use. Non-`asset:` values (including empty
     * strings) pass through unchanged. Results are cached per-import so an asset
     * referenced from multiple places (e.g. both a view background and its own zone
     * boundary) is only copied once.
     *
     * @return string|\WP_Error
     */
    private function resolve_asset(string $ref, array &$cache) {
        if ($ref === '' || !str_starts_with($ref, 'asset:')) {
            return $ref;
        }

        $filename = basename(substr($ref, strlen('asset:')));
        if (isset($cache[$filename])) {
            return $cache[$filename];
        }

        $source = $this->assets_dir() . $filename;
        if (!file_exists($source)) {
            return new \WP_Error(
                'pf_starter_asset_missing',
                /* translators: %s: asset filename */
                sprintf(__('Starter asset "%s" not found.', 'productforge'), $filename),
                ['status' => 500]
            );
        }

        $dirty = file_get_contents($source);
        if ($dirty === false) {
            return new \WP_Error(
                'pf_starter_asset_unreadable',
                __('Could not read starter asset.', 'productforge'),
                ['status' => 500]
            );
        }

        $sanitizer = new \enshrined\svgSanitize\Sanitizer();
        $clean     = $sanitizer->sanitize($dirty);
        if ($clean === false || $clean === '') {
            return new \WP_Error(
                'pf_starter_asset_invalid',
                __('Starter asset failed SVG sanitization.', 'productforge'),
                ['status' => 500]
            );
        }

        $upload_dir = wp_upload_dir();
        $dir        = $upload_dir['basedir'] . '/pf-template-assets';
        wp_mkdir_p($dir);

        $unique_name = wp_unique_filename($dir, $filename);
        $dest        = $dir . '/' . $unique_name;
        if (file_put_contents($dest, $clean) === false) {
            return new \WP_Error(
                'pf_starter_asset_write_failed',
                __('Could not store starter asset.', 'productforge'),
                ['status' => 500]
            );
        }

        $url                = $upload_dir['baseurl'] . '/pf-template-assets/' . $unique_name;
        $cache[$filename]   = $url;
        return $url;
    }

    private function load_manifest(): array {
        $path = $this->manifest_path();
        if (!file_exists($path)) {
            return [];
        }
        $json = file_get_contents($path);
        if ($json === false) {
            return [];
        }
        $data = json_decode($json, true);
        return is_array($data) ? $data : [];
    }

    private function manifest_path(): string {
        return PF_PLUGIN_DIR . 'templates/starter/manifest.json';
    }

    private function assets_dir(): string {
        return PF_PLUGIN_DIR . 'templates/starter/assets/';
    }
}
