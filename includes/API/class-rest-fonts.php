<?php
namespace ProductForge\API;

defined('ABSPATH') || exit;

class RestFonts {

    public function register_routes(): void {
        register_rest_route('pf/v1', '/fonts', [
            'methods'             => 'GET',
            'callback'            => [$this, 'list_fonts'],
            'permission_callback' => '__return_true',
        ]);
    }

    public function list_fonts(\WP_REST_Request $request): \WP_REST_Response {
        // Phase 4 will implement font management.
        // For now return an empty list.
        return rest_ensure_response([]);
    }
}
