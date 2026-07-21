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
     * Register export hooks. Auto-export on order status change is premium-only:
     * PremiumExports is absent from the free build (@fs_premium_only), so the
     * class_exists() guard makes this a no-op there.
     */
    public function init(): void {
        if (class_exists(__NAMESPACE__ . '\\PremiumExports')) {
            (new PremiumExports($this))->init();
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
    public function generate_export(string $design_hash, string $format = 'pdf', int $order_id = 0, string $variant = 'outline'): array {
        if ( $format === 'pdf' && ! ProductForge::has_feature( 'pdf_export' ) ) {
            return [ 'error' => __( 'PDF export requires Snelgraveren Product Designer Pro.', 'snelgraveren-product-designer' ) ];
        }
        if ( $format === 'svg' && ! ProductForge::has_feature( 'svg_export' ) ) {
            return [ 'error' => __( 'SVG export requires Snelgraveren Product Designer Pro.', 'snelgraveren-product-designer' ) ];
        }
        // PDF/SVG generation lives in PremiumExports, which is stripped from
        // the free build — guard so a stray request degrades to an error, not a fatal.
        if ( in_array( $format, [ 'pdf', 'svg' ], true ) && ! class_exists( __NAMESPACE__ . '\\PremiumExports' ) ) {
            return [ 'error' => __( 'PDF and SVG export require Snelgraveren Product Designer Pro.', 'snelgraveren-product-designer' ) ];
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

        // Check that views have renderable export data (raster PNG or real vector)
        $has_svg = false;
        foreach ($views as $view) {
            if (!empty($view['export_svg']) || !empty($view['export_vector']) || !empty($view['export_vector_embed'])) {
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
                'pdf' => (new PremiumExports($this))->export_pdf($views, $template, $export_dir, $file_name),
                'png' => $this->export_png($views, $template, $export_dir, $file_name),
                'svg' => (new PremiumExports($this))->export_svg($views, $template, $export_dir, $file_name, $variant),
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
     *
     * @internal Public for PremiumExports; not part of any external API.
     */
    public function decode_export_data(string $raw): ?array {
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
     * Convert SVG string to PNG file.
     *
     * Tries in order: rsvg-convert (best quality), Imagick with SVG support.
     *
     * @internal Public for PremiumExports; not part of any external API.
     */
    public function svg_to_png(string $svg, int $width, int $height, string $file_path, int $dpi = 300): bool {
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
     *
     * @internal Public for PremiumExports; not part of any external API.
     */
    public function get_view_dimensions(array $design_view, array $template): array {
        $view_id = (int) ($design_view['view_id'] ?? 0);

        $template_views = $template['views'] ?? [];
        foreach ($template_views as $tv) {
            if ((int) ($tv['id'] ?? 0) === $view_id) {
                return [
                    'width'    => (int) ($tv['canvas_width'] ?? 800),
                    'height'   => (int) ($tv['canvas_height'] ?? 600),
                    'width_mm' => (float) ($tv['width_mm'] ?? 0),
                ];
            }
        }

        $canvas = $design_view['canvas_json'] ?? [];
        return [
            'width'    => (int) ($canvas['width'] ?? 800),
            'height'   => (int) ($canvas['height'] ?? 600),
            'width_mm' => 0.0,
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
