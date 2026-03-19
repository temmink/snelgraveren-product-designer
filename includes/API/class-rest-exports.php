<?php
namespace ProductDesigner\API;

defined('ABSPATH') || exit;

use ProductDesigner\Export\ExportManager;
use ProductDesigner\Database\ExportRepository;

class RestExports {

    public function register_routes(): void {
        // Trigger export for a design
        register_rest_route('pd/v1', '/exports/(?P<hash>[a-f0-9]{32})', [
            'methods'             => 'POST',
            'callback'            => [$this, 'trigger_export'],
            'permission_callback' => [$this, 'admin_permission'],
            'args'                => [
                'format' => [
                    'type'    => 'string',
                    'enum'    => ['pdf', 'png', 'svg'],
                    'default' => 'pdf',
                ],
                'order_id' => [
                    'type'    => 'integer',
                    'default' => 0,
                ],
            ],
        ]);

        // Download an export file
        register_rest_route('pd/v1', '/exports/(?P<id>\d+)/download', [
            'methods'             => 'GET',
            'callback'            => [$this, 'download_export'],
            'permission_callback' => [$this, 'admin_permission'],
        ]);

        // List exports for an order
        register_rest_route('pd/v1', '/orders/(?P<order_id>\d+)/exports', [
            'methods'             => 'GET',
            'callback'            => [$this, 'list_order_exports'],
            'permission_callback' => [$this, 'admin_permission'],
        ]);

        // Delete an export
        register_rest_route('pd/v1', '/exports/(?P<id>\d+)', [
            'methods'             => 'DELETE',
            'callback'            => [$this, 'delete_export'],
            'permission_callback' => [$this, 'admin_permission'],
        ]);
    }

    public function admin_permission(): bool {
        return current_user_can('edit_pd_templates');
    }

    public function trigger_export(\WP_REST_Request $request): \WP_REST_Response {
        $hash     = $request->get_param('hash');
        $format   = $request->get_param('format') ?: 'pdf';
        $order_id = (int) ($request->get_param('order_id') ?: 0);

        $manager = new ExportManager();
        $result  = $manager->generate_export($hash, $format, $order_id);

        if (isset($result['error'])) {
            return new \WP_REST_Response(['error' => $result['error']], 400);
        }

        return new \WP_REST_Response([
            'export_id' => $result['export_id'],
            'status'    => $result['status'],
            'format'    => $format,
        ], 201);
    }

    public function download_export(\WP_REST_Request $request): \WP_REST_Response {
        $export_id = (int) $request->get_param('id');

        $manager = new ExportManager();
        $path    = $manager->get_download_path($export_id);

        if (empty($path)) {
            return new \WP_REST_Response(['error' => 'Export not found or not ready'], 404);
        }

        $mime = match (pathinfo($path, PATHINFO_EXTENSION)) {
            'pdf' => 'application/pdf',
            'png' => 'image/png',
            'svg' => 'image/svg+xml',
            default => 'application/octet-stream',
        };

        $filename = basename($path);

        // Stream the file
        header('Content-Type: ' . $mime);
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . filesize($path));
        // phpcs:ignore WordPress.WP.AlternativeFunctions
        readfile($path);
        exit;
    }

    public function list_order_exports(\WP_REST_Request $request): \WP_REST_Response {
        $order_id = (int) $request->get_param('order_id');
        $repo     = new ExportRepository();
        $exports  = $repo->get_by_order($order_id);

        return new \WP_REST_Response($exports, 200);
    }

    public function delete_export(\WP_REST_Request $request): \WP_REST_Response {
        $export_id = (int) $request->get_param('id');
        $repo      = new ExportRepository();

        $export = $repo->get_by_id($export_id);
        if (!$export) {
            return new \WP_REST_Response(['error' => 'Export not found'], 404);
        }

        // Delete file from disk
        if (!empty($export['file_path']) && file_exists($export['file_path'])) {
            @unlink($export['file_path']);
        }

        $repo->delete($export_id);

        return new \WP_REST_Response(null, 204);
    }
}
