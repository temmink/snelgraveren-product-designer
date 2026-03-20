<?php
namespace ProductForge\API;

defined('ABSPATH') || exit;

use ProductForge\Security\CapabilityChecker;
use ProductForge\Security\UploadValidator;

class RestUploads {

    public function register_routes(): void {
        register_rest_route('pf/v1', '/uploads', [
            'methods'             => 'POST',
            'callback'            => [$this, 'handle_upload'],
            'permission_callback' => [$this, 'verify_nonce'],
        ]);
    }

    /**
     * Verify the WP REST nonce to prevent CSRF on upload requests.
     */
    public function verify_nonce(\WP_REST_Request $request): bool {
        return (bool) wp_verify_nonce(
            $request->get_header('x-wp-nonce') ?? '',
            'wp_rest'
        );
    }

    public function handle_upload(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $files = $request->get_file_params();
        if (empty($files['file'])) {
            return new \WP_Error('no_file', 'No file uploaded.', ['status' => 400]);
        }

        $session_id = CapabilityChecker::current_session_id();

        try {
            $result = UploadValidator::validate_and_store($files['file'], $session_id);
            return new \WP_REST_Response(['url' => $result['url']], 201);
        } catch (\RuntimeException $e) {
            $code = $e->getCode() ?: 400;
            return new \WP_Error('upload_failed', $e->getMessage(), ['status' => $code]);
        }
    }
}
