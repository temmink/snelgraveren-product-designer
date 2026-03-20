<?php
namespace ProductForge\API;

defined('ABSPATH') || exit;

use ProductForge\Export\ExportManager;
use ProductForge\Database\ExportRepository;

class RestExports {

    private ?ExportManager $manager = null;

    private function manager(): ExportManager {
        if (!$this->manager) {
            $this->manager = new ExportManager();
        }
        return $this->manager;
    }

    public function register_routes(): void {
        // Trigger export for a design
        register_rest_route('pf/v1', '/exports/(?P<hash>[a-f0-9]{32})', [
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
        register_rest_route('pf/v1', '/exports/(?P<id>\d+)/download', [
            'methods'             => 'GET',
            'callback'            => [$this, 'download_export'],
            'permission_callback' => [$this, 'admin_permission'],
        ]);

        // List exports for an order
        register_rest_route('pf/v1', '/orders/(?P<order_id>\d+)/exports', [
            'methods'             => 'GET',
            'callback'            => [$this, 'list_order_exports'],
            'permission_callback' => [$this, 'admin_permission'],
        ]);

        // Delete an export
        register_rest_route('pf/v1', '/exports/(?P<id>\d+)', [
            'methods'             => 'DELETE',
            'callback'            => [$this, 'delete_export'],
            'permission_callback' => [$this, 'admin_permission'],
        ]);
    }

    public function admin_permission(): bool {
        return current_user_can('edit_pf_templates');
    }

    public function trigger_export(\WP_REST_Request $request): \WP_REST_Response {
        $hash     = $request->get_param('hash');
        $format   = $request->get_param('format') ?: 'pdf';
        $order_id = (int) ($request->get_param('order_id') ?: 0);

        $result = $this->manager()->generate_export($hash, $format, $order_id);

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

        $path = $this->manager()->get_download_path($export_id);

        if (empty($path)) {
            return new \WP_REST_Response(['error' => 'Export not found or not ready'], 404);
        }

        // Sanitize filename: only allow alphanumeric, hyphens, underscores, dots
        $filename = basename($path);
        $filename = preg_replace('/[^a-zA-Z0-9._-]/', '_', $filename);

        $mime = match (pathinfo($path, PATHINFO_EXTENSION)) {
            'pdf' => 'application/pdf',
            'png' => 'image/png',
            'svg' => 'image/svg+xml',
            default => 'application/octet-stream',
        };

        // Stream the file with proper headers
        nocache_headers();
        header('Content-Type: ' . $mime);
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . filesize($path));
        header('X-Content-Type-Options: nosniff');
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
