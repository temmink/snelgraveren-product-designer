<?php
namespace ProductForge\Export;

defined('ABSPATH') || exit;

use ProductForge\ProductForge;

/**
 * Premium-only export functionality: PDF/SVG generation and auto-export on
 * order status change.
 *
 * This file is listed under @fs_premium_only in productforge.php, so the
 * Freemius deployment processor removes it from the free build entirely.
 * Every call site guards with class_exists() so the free build degrades
 * cleanly (PNG export and downloads live in ExportManager and stay free).
 */
class PremiumExports {

    private ExportManager $manager;

    public function __construct(ExportManager $manager) {
        $this->manager = $manager;
    }

    /**
     * Register the auto-export hook (fires when an order reaches the
     * configured trigger status).
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

        $trigger_status = get_option('sgpd_export_trigger_status', 'completed');
        if ($to !== $trigger_status) {
            return;
        }

        $default_format = get_option('sgpd_export_default_format', 'pdf');

        foreach ($order->get_items() as $item) {
            $hash = $item->get_meta('_pf_design_hash');
            if (empty($hash)) {
                continue;
            }

            $this->manager->generate_export($hash, $default_format, $order_id);
        }
    }

    /**
     * Export views as SVG files.
     *
     * Prefers the real vector output (`export_vector`, from canvas.toSVG()),
     * which is a genuine editable vector. Designs saved before the vector
     * column existed only carry the raster `export_svg` PNG — for those we fall
     * back to wrapping the PNG in an SVG container sized to the view's native
     * dimensions (with width/height/viewBox) so at least the scale is correct.
     */
    public function export_svg(array $views, array $template, string $dir, string $file_name, string $variant = 'outline'): string {
        $paths = [];
        foreach ($views as $i => $view) {
            $suffix     = count($views) > 1 ? '-view-' . ($i + 1) : '';
            $file_path  = $dir . $file_name . $suffix . '.svg';
            $dimensions = $this->manager->get_view_dimensions($view, $template);

            // Primary: real vector SVG from the browser (already sanitized on save).
            // 'embed' → font-embedded variant (falls back to outline, then raw).
            $vector = '';
            if ($variant === 'embed') {
                $vector = trim($view['export_vector_embed'] ?? '');
            }
            if ($vector === '') {
                $vector = trim($view['export_vector'] ?? '');
            }
            if ($vector !== '' && str_starts_with($vector, '<')) {
                // Stamp real-world millimetre units on the root <svg> so the file
                // opens at true physical size (viewBox stays in px, so no distortion).
                $vector = $this->apply_physical_size($vector, $dimensions);
                if (file_put_contents($file_path, $vector) === false) {
                    throw new \RuntimeException(esc_html(sprintf('SVG export failed for view %d', $i + 1)));
                }
                $paths[] = $file_path;
                continue;
            }

            // Fallback: legacy designs without vector data.
            $raw = $view['export_svg'] ?? '';
            if (empty($raw)) {
                continue;
            }

            $export = $this->manager->decode_export_data($raw);
            if (!$export) {
                continue;
            }

            if ($export['type'] === 'svg') {
                if (file_put_contents($file_path, $export['data']) === false) {
                    throw new \RuntimeException(esc_html(sprintf('SVG export failed for view %d', $i + 1)));
                }
            } else {
                // PNG data: wrap in an SVG container sized to the view so the
                // design keeps its real dimensions and aspect ratio instead of
                // collapsing to the 300x150 SVG default viewport. When a physical
                // width is configured, the root gets real mm units; otherwise it
                // falls back to px (the 96-DPI assumption downstream).
                $w = (int) $dimensions['width'];
                $h = (int) $dimensions['height'];
                [$root_w, $root_h] = $this->physical_root_size($dimensions);
                $b64 = base64_encode($export['data']);
                $svg = '<?xml version="1.0" encoding="UTF-8"?>'
                     . '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
                     . ' width="' . $root_w . '" height="' . $root_h . '" viewBox="0 0 ' . $w . ' ' . $h . '">'
                     . '<image width="' . $w . '" height="' . $h . '" href="data:image/png;base64,' . $b64 . '"/>'
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
     * Physical width/height for an <svg> root, derived from the view dimensions.
     * Returns ["51mm", "38.25mm"] when a physical width is configured, or the
     * pixel dimensions as bare numbers otherwise. The height is always derived
     * from the canvas aspect ratio so the export is never distorted.
     *
     * @return array{0: string, 1: string}
     */
    private function physical_root_size(array $dimensions): array {
        $w_px     = max(1, (int) $dimensions['width']);
        $h_px     = max(1, (int) $dimensions['height']);
        $width_mm = (float) ($dimensions['width_mm'] ?? 0);

        if ($width_mm <= 0) {
            return [(string) $w_px, (string) $h_px];
        }

        $height_mm = $width_mm * $h_px / $w_px;
        return [$this->format_mm($width_mm) . 'mm', $this->format_mm($height_mm) . 'mm'];
    }

    /**
     * Stamp real-world millimetre units on the root <svg> of a vector export.
     * Only the width/height attributes of the first <svg> tag are rewritten; the
     * viewBox is left untouched so the internal coordinate system (px) — and thus
     * every path/text position — stays exactly as Fabric.js emitted it.
     */
    private function apply_physical_size(string $svg, array $dimensions): string {
        if ((float) ($dimensions['width_mm'] ?? 0) <= 0) {
            return $svg;
        }

        [$w_str, $h_str] = $this->physical_root_size($dimensions);

        return preg_replace_callback('/<svg\b[^>]*>/', function ($m) use ($w_str, $h_str) {
            $tag = $m[0];
            $tag = preg_match('/\swidth="[^"]*"/', $tag)
                ? preg_replace('/\swidth="[^"]*"/', ' width="' . $w_str . '"', $tag, 1)
                : preg_replace('/<svg\b/', '<svg width="' . $w_str . '"', $tag, 1);
            $tag = preg_match('/\sheight="[^"]*"/', $tag)
                ? preg_replace('/\sheight="[^"]*"/', ' height="' . $h_str . '"', $tag, 1)
                : preg_replace('/<svg\b/', '<svg height="' . $h_str . '"', $tag, 1);
            return $tag;
        }, $svg, 1);
    }

    /** Format a millimetre value with up to 2 decimals, no trailing zeros. */
    private function format_mm(float $mm): string {
        return rtrim(rtrim(number_format($mm, 2, '.', ''), '0'), '.');
    }

    /**
     * Export views as a multi-page PDF. Uses browser-rendered PNG when available,
     * falls back to SVG→PNG conversion for legacy data.
     */
    public function export_pdf(array $views, array $template, string $dir, string $file_name): string {
        $file_path = $dir . $file_name . '.pdf';
        $temp_pngs = [];

        try {
            $pdf = new \TCPDF('P', 'mm', 'A4', true, 'UTF-8', false);
            $pdf->SetCreator('Snelgraveren Product Designer');
            $pdf->SetAuthor('Snelgraveren Product Designer for WooCommerce');
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

                $export = $this->manager->decode_export_data($raw);
                if (!$export) {
                    continue;
                }

                $dimensions = $this->manager->get_view_dimensions($view, $template);
                $w_px = $dimensions['width'];
                $h_px = $dimensions['height'];

                // Physical page size. When the template defines a real-world width
                // (mm), use it and derive the height from the canvas aspect ratio.
                // Otherwise fall back to the 96-DPI pixel assumption (1px = 25.4/96 mm).
                $width_mm = (float) ($dimensions['width_mm'] ?? 0);
                if ($width_mm > 0) {
                    $w_mm = $width_mm;
                    $h_mm = $width_mm * $h_px / max(1, $w_px);
                } else {
                    $px_to_mm = 25.4 / 96;
                    $w_mm = $w_px * $px_to_mm;
                    $h_mm = $h_px * $px_to_mm;
                }

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
                    if ($this->manager->svg_to_png($export['data'], $w_px, $h_px, $temp_png, 300)) {
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
}
