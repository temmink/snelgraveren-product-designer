<?php
namespace ProductForge\API;

defined('ABSPATH') || exit;

use ProductForge\Database\ClipartRepository;
use ProductForge\ProductForge;
use ProductForge\Security\ClipartValidator;

class RestClipart {

    public function register_routes(): void {
        // Public: list collections with item count
        register_rest_route('pf/v1', '/clipart/collections', [
            'methods'             => 'GET',
            'callback'            => [$this, 'list_collections'],
            'permission_callback' => '__return_true',
        ]);

        // Admin: create collection
        register_rest_route('pf/v1', '/clipart/collections', [
            'methods'             => 'POST',
            'callback'            => [$this, 'create_collection'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // Public: get collection with all items
        register_rest_route('pf/v1', '/clipart/collections/(?P<id>\d+)', [
            'methods'             => 'GET',
            'callback'            => [$this, 'get_collection'],
            'permission_callback' => '__return_true',
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
        return current_user_can('edit_pf_templates');
    }

    public function list_collections(): \WP_REST_Response {
        $collections = ClipartRepository::list_collections();
        // Cast numeric fields
        foreach ($collections as &$c) {
            $c['id']         = (int) $c['id'];
            $c['item_count'] = (int) $c['item_count'];
        }
        return rest_ensure_response($collections);
    }

    public function get_collection(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $id         = (int) $request['id'];
        $collection = ClipartRepository::get_collection($id);

        if (!$collection) {
            return new \WP_Error('not_found', 'Collection not found.', ['status' => 404]);
        }

        $collection['id'] = (int) $collection['id'];
        foreach ($collection['items'] as &$item) {
            $item['id'] = (int) $item['id'];
        }

        return rest_ensure_response($collection);
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
