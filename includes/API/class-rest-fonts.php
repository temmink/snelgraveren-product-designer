<?php
namespace ProductForge\API;

defined('ABSPATH') || exit;

use ProductForge\Database\FontRepository;
use ProductForge\ProductForge;
use ProductForge\Security\FontValidator;

class RestFonts {

    public function register_routes(): void {
        // Public: list all custom fonts (needed by frontend designer)
        register_rest_route('pf/v1', '/fonts', [
            'methods'             => 'GET',
            'callback'            => [$this, 'list_fonts'],
            'permission_callback' => '__return_true',
        ]);

        // Admin: upload a new font
        register_rest_route('pf/v1', '/fonts', [
            'methods'             => 'POST',
            'callback'            => [$this, 'upload_font'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // Admin: delete a font file by ID
        register_rest_route('pf/v1', '/fonts/(?P<id>\d+)', [
            'methods'             => 'DELETE',
            'callback'            => [$this, 'delete_font'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // Admin: delete all files for a font family
        register_rest_route('pf/v1', '/fonts/family/(?P<family>[^/]+)', [
            'methods'             => 'DELETE',
            'callback'            => [$this, 'delete_family'],
            'permission_callback' => [$this, 'can_edit'],
        ]);
    }

    public function can_edit(): bool {
        return current_user_can('edit_pf_templates');
    }

    public function list_fonts(): \WP_REST_Response {
        return rest_ensure_response(FontRepository::all());
    }

    public function upload_font(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        if ( ! ProductForge::has_feature( 'custom_fonts' ) ) {
            return ProductForge::premium_error( 'custom_fonts' );
        }

        $files = $request->get_file_params();
        if (empty($files['file'])) {
            return new \WP_Error('no_file', 'No font file uploaded.', ['status' => 400]);
        }

        $family = sanitize_text_field($request->get_param('family') ?? '');
        if (empty($family)) {
            return new \WP_Error('no_family', 'Font family name is required.', ['status' => 400]);
        }

        // Prevent collision with built-in web-safe and Google Fonts
        $reserved = [
            'Arial', 'Verdana', 'Helvetica', 'Tahoma', 'Trebuchet MS',
            'Times New Roman', 'Georgia', 'Garamond', 'Courier New',
            'Impact', 'Comic Sans MS', 'Roboto', 'Open Sans', 'Lato',
            'Montserrat', 'Poppins', 'Inter', 'Raleway', 'Nunito',
            'Ubuntu', 'Oswald', 'Playfair Display', 'Merriweather',
            'Lora', 'PT Serif', 'Roboto Slab', 'Roboto Mono',
            'Source Code Pro', 'Fira Code', 'Dancing Script', 'Pacifico',
            'Great Vibes', 'Caveat', 'Satisfy', 'Bebas Neue', 'Lobster',
            'Righteous', 'Permanent Marker', 'Alfa Slab One', 'Anton', 'Bangers',
        ];
        if (in_array($family, $reserved, true)) {
            return new \WP_Error('reserved_name', "'{$family}' is a built-in font name. Choose a different name.", ['status' => 400]);
        }

        try {
            $result = FontValidator::validate_and_store($files['file']);
            $id     = FontRepository::insert($family, $result['file_url'], $result['format']);

            return new \WP_REST_Response([
                'id'       => $id,
                'family'   => $family,
                'file_url' => $result['file_url'],
                'format'   => $result['format'],
            ], 201);
        } catch (\RuntimeException $e) {
            $code = $e->getCode() ?: 400;
            return new \WP_Error('font_upload_failed', $e->getMessage(), ['status' => $code]);
        }
    }

    public function delete_font(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        if ( ! ProductForge::has_feature( 'custom_fonts' ) ) {
            return ProductForge::premium_error( 'custom_fonts' );
        }

        $id  = (int) $request['id'];
        $row = FontRepository::delete($id);

        if (!$row) {
            return new \WP_Error('not_found', 'Font not found.', ['status' => 404]);
        }

        self::delete_file($row['file_url']);

        return new \WP_REST_Response(null, 204);
    }

    public function delete_family(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        if ( ! ProductForge::has_feature( 'custom_fonts' ) ) {
            return ProductForge::premium_error( 'custom_fonts' );
        }

        $family = sanitize_text_field(urldecode($request['family']));
        $rows   = FontRepository::delete_family($family);

        if (empty($rows)) {
            return new \WP_Error('not_found', 'Font family not found.', ['status' => 404]);
        }

        foreach ($rows as $row) {
            self::delete_file($row['file_url']);
        }

        return new \WP_REST_Response(null, 204);
    }

    private static function delete_file(string $url): void {
        $upload_dir = wp_upload_dir();
        $path = str_replace($upload_dir['baseurl'], $upload_dir['basedir'], $url);
        $expected_dir = $upload_dir['basedir'] . '/pf-fonts/';
        if (strpos($path, $expected_dir) === 0 && file_exists($path)) {
            unlink($path);
        }
    }
}
