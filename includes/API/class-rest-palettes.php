<?php
namespace ProductForge\API;

defined('ABSPATH') || exit;

use ProductForge\ProductForge;

/**
 * Color-palette endpoints. The whole controller is premium-only: palettes are
 * only used by the (Pro-gated) template-builder admin UI, never by the
 * frontend designer. Listed under @fs_premium_only in productforge.php, so
 * this file is absent from the free build; registration in ProductForge is
 * guarded with class_exists().
 */
class RestPalettes {

    private const OPTION_KEY = 'pf_color_palettes';

    public function register_routes(): void {
        $ns = 'pf/v1';

        register_rest_route($ns, '/palettes', [
            ['methods' => 'GET',  'callback' => [$this, 'list_palettes'],  'permission_callback' => [$this, 'admin_permission']],
            ['methods' => 'POST', 'callback' => [$this, 'create_palette'], 'permission_callback' => [$this, 'admin_permission']],
        ]);

        register_rest_route($ns, '/palettes/(?P<id>[a-f0-9]+)', [
            ['methods' => 'PUT',    'callback' => [$this, 'update_palette'], 'permission_callback' => [$this, 'admin_permission']],
            ['methods' => 'DELETE', 'callback' => [$this, 'delete_palette'], 'permission_callback' => [$this, 'admin_permission']],
        ]);
    }

    public function admin_permission(): bool {
        return current_user_can('edit_pf_templates');
    }

    private function get_palettes(): array {
        $palettes = get_option(self::OPTION_KEY, []);
        return is_array($palettes) ? $palettes : [];
    }

    private function save_palettes(array $palettes): bool {
        return update_option(self::OPTION_KEY, $palettes, false);
    }

    public function list_palettes(): \WP_REST_Response {
        return rest_ensure_response($this->get_palettes());
    }

    public function create_palette(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        if ( ! ProductForge::has_feature( 'color_palettes' ) ) {
            return ProductForge::premium_error( 'color_palettes' );
        }

        $body = $request->get_json_params();
        $name = sanitize_text_field($body['name'] ?? '');
        if (empty($name)) {
            return new \WP_Error('missing_name', 'Palette name is required.', ['status' => 400]);
        }

        $colors = $this->sanitize_colors($body['colors'] ?? []);

        $palette = [
            'id'     => bin2hex(random_bytes(8)),
            'name'   => $name,
            'colors' => $colors,
        ];

        $palettes = $this->get_palettes();
        $palettes[] = $palette;
        $this->save_palettes($palettes);

        return new \WP_REST_Response($palette, 201);
    }

    public function update_palette(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        if ( ! ProductForge::has_feature( 'color_palettes' ) ) {
            return ProductForge::premium_error( 'color_palettes' );
        }

        $id       = sanitize_text_field($request['id']);
        $palettes = $this->get_palettes();
        $index    = array_search($id, array_column($palettes, 'id'), true);

        if ($index === false) {
            return new \WP_Error('not_found', 'Palette not found.', ['status' => 404]);
        }

        $body = $request->get_json_params();
        if (isset($body['name'])) {
            $palettes[$index]['name'] = sanitize_text_field($body['name']);
        }
        if (isset($body['colors'])) {
            $palettes[$index]['colors'] = $this->sanitize_colors($body['colors']);
        }

        $this->save_palettes($palettes);
        return rest_ensure_response($palettes[$index]);
    }

    public function delete_palette(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        if ( ! ProductForge::has_feature( 'color_palettes' ) ) {
            return ProductForge::premium_error( 'color_palettes' );
        }

        $id       = sanitize_text_field($request['id']);
        $palettes = $this->get_palettes();
        $index    = array_search($id, array_column($palettes, 'id'), true);

        if ($index === false) {
            return new \WP_Error('not_found', 'Palette not found.', ['status' => 404]);
        }

        array_splice($palettes, $index, 1);
        $this->save_palettes($palettes);

        return new \WP_REST_Response(null, 204);
    }

    /**
     * Sanitize an array of hex color strings.
     */
    private function sanitize_colors(array $colors): array {
        $sanitized = [];
        foreach ($colors as $color) {
            $color = sanitize_hex_color($color);
            if ($color) {
                $sanitized[] = $color;
            }
        }
        return $sanitized;
    }
}
