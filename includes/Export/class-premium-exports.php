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
     * Export views as SVG files. Only works with SVG export data.
     * PNG data URLs cannot be converted to vector SVG.
     */
    public function export_svg(array $views, string $dir, string $file_name): string {
        $paths = [];
        foreach ($views as $i => $view) {
            $raw = $view['export_svg'] ?? '';
            if (empty($raw)) {
                continue;
            }

            $export = $this->manager->decode_export_data($raw);
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
     * Export views as a multi-page PDF. Uses browser-rendered PNG when available,
     * falls back to SVG→PNG conversion for legacy data.
     */
    public function export_pdf(array $views, array $template, string $dir, string $file_name): string {
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

                $export = $this->manager->decode_export_data($raw);
                if (!$export) {
                    continue;
                }

                $dimensions = $this->manager->get_view_dimensions($view, $template);
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
