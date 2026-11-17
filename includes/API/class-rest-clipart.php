<?php
namespace Snelgraveren\ProductDesigner\API;

defined('ABSPATH') || exit;

use Snelgraveren\ProductDesigner\Database\ClipartRepository;

/**
 * Public clipart read endpoints. Guest customers need these in the frontend
 * designer, so they are intentionally public and stay in the free build.
 * All management (mutation) endpoints live in RestClipartAdmin, which is
 * premium-only and stripped from the free build.
 */
class RestClipart {

    public function register_routes(): void {
        // Public: list collections with item count
        register_rest_route('pf/v1', '/clipart/collections', [
            'methods'             => 'GET',
            'callback'            => [$this, 'list_collections'],
            'permission_callback' => '__return_true',
        ]);

        // Public: get collection with all items
        register_rest_route('pf/v1', '/clipart/collections/(?P<id>\d+)', [
            'methods'             => 'GET',
            'callback'            => [$this, 'get_collection'],
            'permission_callback' => '__return_true',
        ]);
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
}
