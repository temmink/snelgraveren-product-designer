<?php
namespace ProductForge\API;

defined('ABSPATH') || exit;

use ProductForge\Export\ExportManager;
use ProductForge\Database\ExportRepository;
use ProductForge\ProductForge;

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

        if ( $format === 'pdf' && ! ProductForge::has_feature( 'pdf_export' ) ) {
            return new \WP_REST_Response( ['error' => __( 'PDF export requires ProductForge Pro.', 'productforge' )], 403 );
        }
        if ( $format === 'svg' && ! ProductForge::has_feature( 'svg_export' ) ) {
            return new \WP_REST_Response( ['error' => __( 'SVG export requires ProductForge Pro.', 'productforge' )], 403 );
        }

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

        $paths = $this->manager()->get_download_paths($export_id);

        if (empty($paths)) {
            return new \WP_REST_Response(['error' => 'Export not found or not ready'], 404);
        }

        nocache_headers();
        header('X-Content-Type-Options: nosniff');

        if (count($paths) === 1) {
            // Single file — stream directly
            $path = $paths[0];
            $filename = basename($path);
            $filename = preg_replace('/[^a-zA-Z0-9._-]/', '_', $filename);

            $mime = match (pathinfo($path, PATHINFO_EXTENSION)) {
                'pdf' => 'application/pdf',
                'png' => 'image/png',
                'svg' => 'image/svg+xml',
                default => 'application/octet-stream',
            };

            header('Content-Type: ' . $mime);
            header('Content-Disposition: attachment; filename="' . $filename . '"');
            header('Content-Length: ' . filesize($path));
            readfile($path); // phpcs:ignore WordPress.WP.AlternativeFunctions
            exit;
        }

        // Multi-view — create a zip on the fly
        $zip_path = sys_get_temp_dir() . '/pf-export-' . $export_id . '.zip';
        $zip = new \ZipArchive();
        if ($zip->open($zip_path, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            return new \WP_REST_Response(['error' => 'Failed to create zip'], 500);
        }

        foreach ($paths as $path) {
            $zip->addFile($path, basename($path));
        }
        $zip->close();

        $zip_name = preg_replace('/[^a-zA-Z0-9._-]/', '_', basename($paths[0], '.' . pathinfo($paths[0], PATHINFO_EXTENSION))) . '-all-views.zip';

        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="' . $zip_name . '"');
        header('Content-Length: ' . filesize($zip_path));
        readfile($zip_path); // phpcs:ignore WordPress.WP.AlternativeFunctions
        @unlink($zip_path);
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

        // Delete file from disk (with path traversal protection)
        if (!empty($export['file_path'])) {
            $upload_dir  = wp_upload_dir();
            $exports_dir = realpath($upload_dir['basedir'] . '/pf-exports');
            $real_path   = realpath($export['file_path']);
            if ($exports_dir && $real_path && str_starts_with($real_path, $exports_dir . '/')) {
                @unlink($real_path);
            }
        }

        $repo->delete($export_id);

        return new \WP_REST_Response(null, 204);
    }
}
