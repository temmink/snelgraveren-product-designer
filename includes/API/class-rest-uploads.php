<?php
namespace ProductDesigner\API;

defined('ABSPATH') || exit;

use ProductDesigner\Security\CapabilityChecker;
use ProductDesigner\Security\UploadValidator;

class RestUploads {

    public function register_routes(): void {
        register_rest_route('pd/v1', '/uploads', [
            'methods'             => 'POST',
            'callback'            => [$this, 'handle_upload'],
            'permission_callback' => '__return_true',
        ]);
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
