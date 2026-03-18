<?php
namespace ProductDesigner\API;

defined('ABSPATH') || exit;

class RestExports {

    public function register_routes(): void {
        register_rest_route('pd/v1', '/exports/(?P<hash>[a-f0-9]{32})', [
            'methods'             => 'POST',
            'callback'            => [$this, 'trigger_export'],
            'permission_callback' => [$this, 'admin_permission'],
        ]);
    }

    public function admin_permission(): bool {
        return current_user_can('edit_pd_templates');
    }

    public function trigger_export(\WP_REST_Request $request): \WP_REST_Response {
        // Phase 5 will implement export logic.
        return new \WP_REST_Response(['status' => 'queued'], 202);
    }
}
