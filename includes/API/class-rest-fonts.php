<?php
namespace ProductForge\API;

defined('ABSPATH') || exit;

use ProductForge\Database\FontRepository;

/**
 * Public font read endpoint. The frontend designer needs the font list for
 * guest customers, so it is intentionally public and stays in the free build.
 * All management (upload/delete) endpoints live in RestFontsAdmin, which is
 * premium-only and stripped from the free build.
 */
class RestFonts {

    public function register_routes(): void {
        // Public: list all custom fonts (needed by frontend designer)
        register_rest_route('pf/v1', '/fonts', [
            'methods'             => 'GET',
            'callback'            => [$this, 'list_fonts'],
            'permission_callback' => '__return_true',
        ]);
    }

    public function list_fonts(): \WP_REST_Response {
        return rest_ensure_response(FontRepository::all());
    }
}
