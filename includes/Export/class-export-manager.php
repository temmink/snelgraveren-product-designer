<?php
namespace ProductForge\Export;

defined('ABSPATH') || exit;

use ProductForge\Database\DesignRepository;
use ProductForge\Database\ExportRepository;
use ProductForge\Database\TemplateRepository;
use ProductForge\ProductForge;

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
        if ( ! ProductForge::has_feature( 'auto_export' ) ) {
            return;
        }

        $trigger_status = get_option('pf_export_trigger_status', 'completed');
        if ($to !== $trigger_status) {
            return;
        }

        $default_format = get_option('pf_export_default_format', 'pdf');

        foreach ($order->get_items() as $item) {
            $hash = $item->get_meta('_pf_design_hash');
            if (empty($hash)) {
                continue;
            }

            $this->generate_export($hash, $default_format, $order_id);
        }
    }

    /**
     * Generate an export for a design hash.
     *
     * Uses the pre-rendered SVG from canvas.toSVG() stored during design save.
     * This produces pixel-perfect output because Fabric.js itself generated the SVG.
     *
     * @return array{export_id: int, status: string, file_path: string}|array{error: string}
     */
    public function generate_export(string $design_hash, string $format = 'pdf', int $order_id = 0): array {
        if ( $format === 'pdf' && ! ProductForge::has_feature( 'pdf_export' ) ) {
            return [ 'error' => __( 'PDF export requires ProductForge Pro.', 'productforge' ) ];
        }
        if ( $format === 'svg' && ! ProductForge::has_feature( 'svg_export' ) ) {
            return [ 'error' => __( 'SVG export requires ProductForge Pro.', 'productforge' ) ];
        }

        $design = $this->designs->get_by_hash($design_hash);
        if (!$design) {
            return ['error' => 'Design not found'];
        }

        $template = $this->templates->get((int) $design['template_id']);
        if (!$template) {
            return ['error' => 'Template not found'];
        }

        $design_id = (int) $design['id'];

        // Remove previous exports of the same format for this design.
        // Multi-view exports store paths as a comma-separated list, so split before unlinking.
        $existing = $this->exports->get_by_design($design_id);
        foreach ($existing as $old) {
            if ($old['format'] === $format) {
                if (!empty($old['file_path'])) {
                    foreach (explode(',', $old['file_path']) as $old_path) {
                        $old_path = trim($old_path);
                        if ($old_path !== '' && file_exists($old_path)) {
                            wp_delete_file($old_path);
                        }
                    }
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

        // Check that views have export_svg data
        $has_svg = false;
        foreach ($views as $view) {
            if (!empty($view['export_svg'])) {
                $has_svg = true;
                break;
            }
        }
        if (!$has_svg) {
            $this->exports->update_status($export_id, 'failed');
            return ['error' => 'Design has no export SVG data. Please re-save the design to generate export data.'];
        }

        $export_dir = $this->get_export_dir($format);
        $file_name  = $design_hash . '-' . $design_id;

        try {
            $file_path = match ($format) {
                'pdf' => $this->export_pdf($views, $template, $export_dir, $file_name),
                'png' => $this->export_png($views, $template, $export_dir, $file_name),
                'svg' => $this->export_svg($views, $export_dir, $file_name),
                default => throw new \InvalidArgumentException(esc_html(sprintf('Unsupported format: %s', $format))),
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
     * Get the file path(s) for a completed export, verifying they exist.
     * Returns an array of validated paths (supports multi-view exports).
     */
    public function get_download_paths(int $export_id): array {
        $export = $this->exports->get_by_id($export_id);
        if (!$export || $export['status'] !== 'done') {
            return [];
        }

        $stored = $export['file_path'] ?? '';
        if (empty($stored)) {
            return [];
        }

        $upload_dir  = wp_upload_dir();
        $exports_dir = realpath($upload_dir['basedir'] . '/pf-exports');
        if (!$exports_dir) {
            return [];
        }

        $paths = [];
        foreach (explode(',', $stored) as $path) {
            $path = trim($path);
            $real_path = realpath($path);
            if ($real_path && str_starts_with($real_path, $exports_dir . '/')) {
                $paths[] = $real_path;
            }
        }

        return $paths;
    }

    /**
     * Get the file path for a completed export, verifying it exists.
     * For backwards compatibility, returns only the first file.
     */
    public function get_download_path(int $export_id): string {
        $paths = $this->get_download_paths($export_id);
        return $paths[0] ?? '';
    }

    /**
     * Decode export data from a view. Supports both PNG data URLs and raw SVG.
     * Returns ['type' => 'png'|'svg', 'data' => binary|string] or null.
     */
    private function decode_export_data(string $raw): ?array {
        if (str_starts_with($raw, 'data:image/png;base64,')) {
            $base64 = substr($raw, strlen('data:image/png;base64,'));
            $binary = base64_decode($base64, true);
            if ($binary === false) {
                return null;
            }
            return ['type' => 'png', 'data' => $binary];
        }

        if (str_starts_with($raw, '<')) {
            return ['type' => 'svg', 'data' => $raw];
        }

        return null;
    }

    /**
     * Export views as SVG files. Only works with SVG export data.
     * PNG data URLs cannot be converted to vector SVG.
     */
    private function export_svg(array $views, string $dir, string $file_name): string {
        $paths = [];
        foreach ($views as $i => $view) {
            $raw = $view['export_svg'] ?? '';
            if (empty($raw)) {
                continue;
            }

            $export = $this->decode_export_data($raw);
            if (!$export) {
                continue;
            }

            $suffix    = count($views) > 1 ? '-view-' . ($i + 1) : '';
            $file_path = $dir . $file_name . $suffix . '.svg';

            if ($export['type'] === 'svg') {
                if (file_put_contents($file_path, $export['data']) === false) {
                    throw new \RuntimeException(esc_html(sprintf('SVG export failed for view %d', $i + 1)));
                }
            } else {
                // PNG data: wrap in an SVG container
                $b64 = base64_encode($export['data']);
                $svg = '<?xml version="1.0" encoding="UTF-8"?>'
                     . '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
                     . '<image width="100%" height="100%" href="data:image/png;base64,' . $b64 . '"/>'
                     . '</svg>';
                if (file_put_contents($file_path, $svg) === false) {
                    throw new \RuntimeException(esc_html(sprintf('SVG export failed for view %d', $i + 1)));
                }
            }

            $paths[] = $file_path;
        }

        if (empty($paths)) {
            throw new \RuntimeException('No views with export data');
        }

        return implode(',', $paths);
    }

    /**
     * Export views as PNG files. Supports both PNG data URLs (direct save)
     * and SVG data (convert via rsvg/Imagick).
     */
    private function export_png(array $views, array $template, string $dir, string $file_name): string {
        $paths = [];
        foreach ($views as $i => $view) {
            $raw = $view['export_svg'] ?? '';
            if (empty($raw)) {
                continue;
            }

            $export = $this->decode_export_data($raw);
            if (!$export) {
                continue;
            }

            $suffix    = count($views) > 1 ? '-view-' . ($i + 1) : '';
            $file_path = $dir . $file_name . $suffix . '.png';

            if ($export['type'] === 'png') {
                // Browser-rendered PNG: save directly
                if (file_put_contents($file_path, $export['data']) === false) {
                    throw new \RuntimeException(esc_html(sprintf('PNG export failed for view %d', $i + 1)));
                }
            } else {
                // SVG data: convert via rsvg/Imagick
                $dimensions = $this->get_view_dimensions($view, $template);
                if (!$this->svg_to_png($export['data'], $dimensions['width'], $dimensions['height'], $file_path)) {
                    throw new \RuntimeException(esc_html(sprintf('PNG export failed for view %d', $i + 1)));
                }
            }

            $paths[] = $file_path;
        }

        if (empty($paths)) {
            throw new \RuntimeException('No views with export data');
        }

        return implode(',', $paths);
    }

    /**
     * Export views as a multi-page PDF. Uses browser-rendered PNG when available,
     * falls back to SVG→PNG conversion for legacy data.
     */
    private function export_pdf(array $views, array $template, string $dir, string $file_name): string {
        $file_path = $dir . $file_name . '.pdf';
        $temp_pngs = [];

        try {
            $pdf = new \TCPDF('P', 'mm', 'A4', true, 'UTF-8', false);
            $pdf->SetCreator('ProductForge');
            $pdf->SetAuthor('ProductForge for WooCommerce');
            $pdf->SetTitle('Design Export');
            $pdf->setPrintHeader(false);
            $pdf->setPrintFooter(false);
            $pdf->SetAutoPageBreak(false, 0);
            $pdf->SetMargins(0, 0, 0);
            $pdf->setCellPaddings(0, 0, 0, 0);

            foreach ($views as $view) {
                $raw = $view['export_svg'] ?? '';
                if (empty($raw)) {
                    continue;
                }

                $export = $this->decode_export_data($raw);
                if (!$export) {
                    continue;
                }

                $dimensions = $this->get_view_dimensions($view, $template);
                $w_px = $dimensions['width'];
                $h_px = $dimensions['height'];

                // Convert pixels to mm for TCPDF (1px at 96dpi = 25.4/96 mm)
                $px_to_mm = 25.4 / 96;
                $w_mm = $w_px * $px_to_mm;
                $h_mm = $h_px * $px_to_mm;

                // Set orientation based on canvas aspect ratio
                $orientation = ($w_mm >= $h_mm) ? 'L' : 'P';
                $pdf->AddPage($orientation, [$w_mm, $h_mm]);

                $temp_png = tempnam(sys_get_temp_dir(), 'pf-pdf-');

                if ($export['type'] === 'png') {
                    // Browser-rendered PNG: write directly to temp file
                    file_put_contents($temp_png, $export['data']);
                    $temp_pngs[] = $temp_png;
                    $pdf->Image($temp_png, 0, 0, $w_mm, $h_mm, 'PNG');
                } else {
                    // SVG: convert to PNG first
                    if ($this->svg_to_png($export['data'], $w_px, $h_px, $temp_png, 300)) {
                        $temp_pngs[] = $temp_png;
                        $pdf->Image($temp_png, 0, 0, $w_mm, $h_mm, 'PNG');
                    }
                }
            }

            $pdf->Output($file_path, 'F');

            foreach ($temp_pngs as $tmp) {
                wp_delete_file($tmp);
            }

            if (!file_exists($file_path)) {
                throw new \RuntimeException('PDF export failed');
            }

            return $file_path;
        } catch (\Exception $e) {
            foreach ($temp_pngs as $tmp) {
                wp_delete_file($tmp);
            }
            throw $e;
        }
    }

    /**
     * Convert SVG string to PNG file.
     *
     * Tries in order: rsvg-convert (best quality), Imagick with SVG support.
     */
    private function svg_to_png(string $svg, int $width, int $height, string $file_path, int $dpi = 300): bool {
        $dir = dirname($file_path);
        if (!wp_mkdir_p($dir)) {
            return false;
        }

        // Write SVG to temp file (both methods need it on disk)
        $tmp_svg = tempnam(sys_get_temp_dir(), 'pf-svg-');
        file_put_contents($tmp_svg, $svg);

        // Try rsvg-convert first (best quality, handles CSS/fonts well)
        $rsvg = $this->svg_to_png_rsvg($tmp_svg, $width, $height, $file_path, $dpi);
        if ($rsvg) {
            wp_delete_file($tmp_svg);
            return true;
        }

        // Try Imagick with SVG support
        if (extension_loaded('imagick')) {
            $result = $this->svg_to_png_imagick($svg, $width, $height, $file_path, $dpi);
            wp_delete_file($tmp_svg);
            return $result;
        }

        wp_delete_file($tmp_svg);
        return false;
    }

    /**
     * Convert SVG to PNG using rsvg-convert command-line tool.
     * All arguments are integers or escaped paths — no user input reaches the shell.
     *
     * Fabric.js toSVG() outputs pixel coordinates at 96 DPI (browser default).
     * We scale output dimensions for high-res but keep DPI at 96 so coordinates
     * are interpreted correctly.
     */
    private function svg_to_png_rsvg(string $svg_path, int $width, int $height, string $file_path, int $dpi): bool {
        $rsvg_bin = '/usr/bin/rsvg-convert';
        if (!file_exists($rsvg_bin)) {
            return false;
        }

        // Scale output pixel dimensions for high-res, but don't change DPI
        // interpretation (Fabric.js SVGs use pixel units at 96 DPI)
        $scale = $dpi / 96;
        $render_width  = (int) round($width * $scale);
        $render_height = (int) round($height * $scale);

        $args = [
            escapeshellarg($rsvg_bin),
            '--width=' . $render_width,
            '--height=' . $render_height,
            '--output=' . escapeshellarg($file_path),
            escapeshellarg($svg_path),
        ];

        // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.system_calls_exec -- controlled binary with escaped args
        exec(implode(' ', $args) . ' 2>&1', $output, $return_code);
        return $return_code === 0 && file_exists($file_path);
    }

    private function svg_to_png_imagick(string $svg, int $width, int $height, string $file_path, int $dpi): bool {
        try {
            $formats = \Imagick::queryFormats('SVG');
            if (empty($formats)) {
                return false;
            }

            $imagick = new \Imagick();
            $imagick->setResolution($dpi, $dpi);
            $scale = $dpi / 72;
            $render_width  = (int) round($width * $scale);
            $render_height = (int) round($height * $scale);
            $imagick->readImageBlob($svg);
            $imagick->setImageFormat('png');
            $imagick->resizeImage($render_width, $render_height, \Imagick::FILTER_LANCZOS, 1);
            $result = $imagick->writeImage($file_path);
            $imagick->destroy();
            return $result;
        } catch (\Exception $e) {
            return false;
        }
    }

    /**
     * Get canvas dimensions for a design view by looking up the template view.
     */
    private function get_view_dimensions(array $design_view, array $template): array {
        $view_id = (int) ($design_view['view_id'] ?? 0);

        $template_views = $template['views'] ?? [];
        foreach ($template_views as $tv) {
            if ((int) ($tv['id'] ?? 0) === $view_id) {
                return [
                    'width'  => (int) ($tv['canvas_width'] ?? 800),
                    'height' => (int) ($tv['canvas_height'] ?? 600),
                ];
            }
        }

        $canvas = $design_view['canvas_json'] ?? [];
        return [
            'width'  => (int) ($canvas['width'] ?? 800),
            'height' => (int) ($canvas['height'] ?? 600),
        ];
    }

    private function get_export_dir(string $format): string {
        $upload_dir = wp_upload_dir();
        $dir = $upload_dir['basedir'] . '/pf-exports/' . $format . '/';
        wp_mkdir_p($dir);

        // Add index.php and .htaccess for security
        $index = $dir . 'index.php';
        if (!file_exists($index)) {
            file_put_contents($index, '<?php // Silence is golden.');
        }
        $htaccess = $dir . '.htaccess';
        if (!file_exists($htaccess)) {
            file_put_contents($htaccess, "Options -Indexes\nDeny from all");
        }

        return $dir;
    }
}
