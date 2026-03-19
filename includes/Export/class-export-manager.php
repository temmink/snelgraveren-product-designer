<?php
namespace ProductDesigner\Export;

defined('ABSPATH') || exit;

use ProductDesigner\Database\DesignRepository;
use ProductDesigner\Database\ExportRepository;
use ProductDesigner\Database\TemplateRepository;

class ExportManager {

    private DesignRepository $designs;
    private ExportRepository $exports;
    private TemplateRepository $templates;

    public function __construct() {
        $this->designs   = new DesignRepository();
        $this->exports   = new ExportRepository();
        $this->templates = new TemplateRepository();
    }

    /**
     * Register WooCommerce hooks for auto-export on order status change.
     */
    public function init(): void {
        add_action('woocommerce_order_status_changed', [$this, 'on_order_status_changed'], 10, 4);
    }

    /**
     * Auto-export designs when order reaches the configured trigger status.
     */
    public function on_order_status_changed(int $order_id, string $from, string $to, \WC_Order $order): void {
        $trigger_status = get_option('pd_export_trigger_status', 'completed');
        if ($to !== $trigger_status) {
            return;
        }

        $default_format = get_option('pd_export_default_format', 'pdf');

        foreach ($order->get_items() as $item) {
            $hash = $item->get_meta('_pd_design_hash');
            if (empty($hash)) {
                continue;
            }

            $this->generate_export($hash, $default_format, $order_id);
        }
    }

    /**
     * Generate an export for a design hash.
     *
     * @return array{export_id: int, status: string, file_path: string}|array{error: string}
     */
    public function generate_export(string $design_hash, string $format = 'pdf', int $order_id = 0): array {
        $design = $this->designs->get_by_hash($design_hash);
        if (!$design) {
            return ['error' => 'Design not found'];
        }

        $template = $this->templates->get((int) $design['template_id']);
        if (!$template) {
            return ['error' => 'Template not found'];
        }

        $design_id = (int) $design['id'];

        // Remove previous exports of the same format for this design
        $existing = $this->exports->get_by_design($design_id);
        foreach ($existing as $old) {
            if ($old['format'] === $format) {
                if (!empty($old['file_path']) && file_exists($old['file_path'])) {
                    @unlink($old['file_path']);
                }
                $this->exports->delete((int) $old['id']);
            }
        }

        $export_id = $this->exports->create($design_id, $order_id, $format);
        if (!$export_id) {
            return ['error' => 'Failed to create export record'];
        }

        $this->exports->update_status($export_id, 'processing');

        $views = $design['views'] ?? [];
        if (empty($views)) {
            $this->exports->update_status($export_id, 'failed');
            return ['error' => 'Design has no views'];
        }

        $export_dir = $this->get_export_dir($format);
        $file_name  = $design_hash . '-' . $design_id;

        try {
            $file_path = match ($format) {
                'pdf' => $this->export_pdf($views, $template, $export_dir, $file_name),
                'png' => $this->export_png($views, $template, $export_dir, $file_name),
                'svg' => $this->export_svg($views, $template, $export_dir, $file_name),
                default => throw new \InvalidArgumentException('Unsupported format: ' . $format),
            };

            $this->exports->update_status($export_id, 'done', $file_path);

            return [
                'export_id' => $export_id,
                'status'    => 'done',
                'file_path' => $file_path,
            ];
        } catch (\Exception $e) {
            $this->exports->update_status($export_id, 'failed');
            return ['error' => $e->getMessage()];
        }
    }

    /**
     * Get the file path for a completed export, verifying it exists.
     */
    public function get_download_path(int $export_id): string {
        $export = $this->exports->get_by_id($export_id);
        if (!$export || $export['status'] !== 'done') {
            return '';
        }

        $path = $export['file_path'];
        if (empty($path) || !file_exists($path)) {
            return '';
        }

        // Ensure path is within the expected export directory to prevent path traversal
        $upload_dir  = wp_upload_dir();
        $exports_dir = realpath($upload_dir['basedir'] . '/pd-exports');
        $real_path   = realpath($path);
        if (!$exports_dir || !$real_path || !str_starts_with($real_path, $exports_dir . '/')) {
            return '';
        }

        return $real_path;
    }

    private function export_pdf(array $views, array $template, string $dir, string $file_name): string {
        $exporter  = new PdfExporter();
        $file_path = $dir . $file_name . '.pdf';

        $pdf_views = [];
        foreach ($views as $view) {
            $canvas_json = $view['canvas_json'] ?? [];
            $dimensions  = $this->get_view_dimensions($view, $template);
            $pdf_views[] = [
                'canvas_json' => $canvas_json,
                'width'       => $dimensions['width'],
                'height'      => $dimensions['height'],
            ];
        }

        if (!$exporter->export($pdf_views, $file_path)) {
            throw new \RuntimeException('PDF export failed');
        }

        return $file_path;
    }

    private function export_png(array $views, array $template, string $dir, string $file_name): string {
        $exporter = new PngExporter();

        // Export each view as a separate PNG
        $paths = [];
        foreach ($views as $i => $view) {
            $canvas_json = $view['canvas_json'] ?? [];
            $dimensions  = $this->get_view_dimensions($view, $template);
            $suffix      = count($views) > 1 ? '-view-' . ($i + 1) : '';
            $file_path   = $dir . $file_name . $suffix . '.png';

            if (!$exporter->export($canvas_json, $dimensions['width'], $dimensions['height'], $file_path)) {
                throw new \RuntimeException('PNG export failed for view ' . ($i + 1));
            }

            $paths[] = $file_path;
        }

        // Return the first path (or a comma-separated list for multi-view)
        return $paths[0];
    }

    private function export_svg(array $views, array $template, string $dir, string $file_name): string {
        $exporter = new SvgExporter();

        $paths = [];
        foreach ($views as $i => $view) {
            $canvas_json = $view['canvas_json'] ?? [];
            $dimensions  = $this->get_view_dimensions($view, $template);
            $suffix      = count($views) > 1 ? '-view-' . ($i + 1) : '';
            $file_path   = $dir . $file_name . $suffix . '.svg';

            if (!$exporter->export($canvas_json, $dimensions['width'], $dimensions['height'], $file_path)) {
                throw new \RuntimeException('SVG export failed for view ' . ($i + 1));
            }

            $paths[] = $file_path;
        }

        return $paths[0];
    }

    /**
     * Get canvas dimensions for a design view by looking up the template view.
     */
    private function get_view_dimensions(array $design_view, array $template): array {
        $view_id = (int) ($design_view['view_id'] ?? 0);

        // Look up template view for dimensions
        $template_views = $template['views'] ?? [];
        foreach ($template_views as $tv) {
            if ((int) ($tv['id'] ?? 0) === $view_id) {
                return [
                    'width'  => (int) ($tv['canvas_width'] ?? 800),
                    'height' => (int) ($tv['canvas_height'] ?? 600),
                ];
            }
        }

        // Fallback: try canvas_json dimensions or defaults
        $canvas = $design_view['canvas_json'] ?? [];
        return [
            'width'  => (int) ($canvas['width'] ?? 800),
            'height' => (int) ($canvas['height'] ?? 600),
        ];
    }

    private function get_export_dir(string $format): string {
        $upload_dir = wp_upload_dir();
        $dir = $upload_dir['basedir'] . '/pd-exports/' . $format . '/';
        wp_mkdir_p($dir);

        // Add index.php for security
        $index = $dir . 'index.php';
        if (!file_exists($index)) {
            file_put_contents($index, '<?php // Silence is golden.');
        }

        return $dir;
    }
}
