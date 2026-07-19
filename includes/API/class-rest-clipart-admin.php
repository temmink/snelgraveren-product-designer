<?php
namespace ProductForge\API;

defined('ABSPATH') || exit;

use ProductForge\Database\ClipartRepository;
use ProductForge\ProductForge;
use ProductForge\Security\ClipartValidator;

/**
 * Premium-only clipart management endpoints (create/rename/delete collections,
 * upload/delete items). Listed under @fs_premium_only in productforge.php, so
 * this file is absent from the free build. The public GET endpoints that the
 * frontend designer needs live in RestClipart and stay free.
 */
class RestClipartAdmin {

    public function register_routes(): void {
        // Admin: create collection
        register_rest_route('pf/v1', '/clipart/collections', [
            'methods'             => 'POST',
            'callback'            => [$this, 'create_collection'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // Admin: rename collection
        register_rest_route('pf/v1', '/clipart/collections/(?P<id>\d+)', [
            'methods'             => 'PUT',
            'callback'            => [$this, 'rename_collection'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // Admin: delete collection
        register_rest_route('pf/v1', '/clipart/collections/(?P<id>\d+)', [
            'methods'             => 'DELETE',
            'callback'            => [$this, 'delete_collection'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // Admin: upload clip art SVG
        register_rest_route('pf/v1', '/clipart', [
            'methods'             => 'POST',
            'callback'            => [$this, 'upload_item'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // Admin: delete single clip art item
        register_rest_route('pf/v1', '/clipart/(?P<id>\d+)', [
            'methods'             => 'DELETE',
            'callback'            => [$this, 'delete_item'],
            'permission_callback' => [$this, 'can_edit'],
        ]);
    }

    public function can_edit(): bool {
        return current_user_can('edit_sgpd_templates');
    }

    public function create_collection(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        if ( ! ProductForge::has_feature( 'clipart' ) ) {
            return ProductForge::premium_error( 'clipart' );
        }

        $name = sanitize_text_field($request->get_param('name') ?? '');
        if (empty($name)) {
            return new \WP_Error('no_name', 'Collection name is required.', ['status' => 400]);
        }

        $id = ClipartRepository::create_collection($name);

        return new \WP_REST_Response([
            'id'         => $id,
            'name'       => $name,
            'item_count' => 0,
            'items'      => [],
        ], 201);
    }

    public function rename_collection(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        if ( ! ProductForge::has_feature( 'clipart' ) ) {
            return ProductForge::premium_error( 'clipart' );
        }

        $id   = (int) $request['id'];
        $name = sanitize_text_field($request->get_param('name') ?? '');
        if (empty($name)) {
            return new \WP_Error('no_name', 'Collection name is required.', ['status' => 400]);
        }

        $ok = ClipartRepository::rename_collection($id, $name);
        if (!$ok) {
            return new \WP_Error('not_found', 'Collection not found.', ['status' => 404]);
        }

        return rest_ensure_response(['id' => $id, 'name' => $name]);
    }

    public function delete_collection(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        if ( ! ProductForge::has_feature( 'clipart' ) ) {
            return ProductForge::premium_error( 'clipart' );
        }

        $id    = (int) $request['id'];
        $items = ClipartRepository::delete_collection($id);

        if ($items === null) {
            return new \WP_Error('not_found', 'Collection not found.', ['status' => 404]);
        }

        foreach ($items as $item) {
            self::delete_file($item['svg_url']);
        }

        return new \WP_REST_Response(null, 204);
    }

    public function upload_item(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        if ( ! ProductForge::has_feature( 'clipart' ) ) {
            return ProductForge::premium_error( 'clipart' );
        }

        $files = $request->get_file_params();
        if (empty($files['file'])) {
            return new \WP_Error('no_file', 'No SVG file uploaded.', ['status' => 400]);
        }

        $collection_id = (int) ($request->get_param('collection_id') ?? 0);
        if ($collection_id <= 0) {
            return new \WP_Error('no_collection', 'Collection ID is required.', ['status' => 400]);
        }

        if (!ClipartRepository::collection_exists($collection_id)) {
            return new \WP_Error('not_found', 'Collection not found.', ['status' => 404]);
        }

        $name = sanitize_text_field($request->get_param('name') ?? '');
        if (empty($name)) {
            // Derive name from filename
            $name = pathinfo($files['file']['name'], PATHINFO_FILENAME);
            $name = sanitize_text_field($name);
        }

        try {
            $result = ClipartValidator::validate_and_store($files['file']);
            $id     = ClipartRepository::create_item($collection_id, $name, $result['svg_url']);

            return new \WP_REST_Response([
                'id'            => $id,
                'collection_id' => $collection_id,
                'name'          => $name,
                'svg_url'       => $result['svg_url'],
            ], 201);
        } catch (\RuntimeException $e) {
            $code = $e->getCode() ?: 400;
            return new \WP_Error('clipart_upload_failed', $e->getMessage(), ['status' => $code]);
        }
    }

    public function delete_item(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        if ( ! ProductForge::has_feature( 'clipart' ) ) {
            return ProductForge::premium_error( 'clipart' );
        }

        $id  = (int) $request['id'];
        $row = ClipartRepository::delete_item($id);

        if (!$row) {
            return new \WP_Error('not_found', 'Clip art item not found.', ['status' => 404]);
        }

        self::delete_file($row['svg_url']);

        return new \WP_REST_Response(null, 204);
    }

    private static function delete_file(string $url): void {
        $upload_dir = wp_upload_dir();
        $path = str_replace($upload_dir['baseurl'], $upload_dir['basedir'], $url);
        $expected_dir = $upload_dir['basedir'] . '/pf-clipart/';
        if (strpos($path, $expected_dir) === 0 && file_exists($path)) {
            wp_delete_file($path);
        }
    }
}
