<?php
namespace ProductDesigner\Export;

defined('ABSPATH') || exit;

class PdfExporter {

    private SvgExporter $svg_exporter;

    public function __construct() {
        $this->svg_exporter = new SvgExporter();
    }

    /**
     * Export design views to a multi-page PDF file.
     *
     * Strategy: render each view as SVG first, then embed the SVG
     * into a PDF page via TCPDF's ImageSVG. This ensures consistent
     * positioning across all export formats since the SVG exporter
     * handles Fabric.js coordinate translation.
     *
     * @param array[] $views Array of ['canvas_json' => [...], 'width' => int, 'height' => int]
     */
    public function export(array $views, string $file_path): bool {
        if (empty($views)) {
            return false;
        }

        $dir = dirname($file_path);
        if (!wp_mkdir_p($dir)) {
            return false;
        }

        try {
            $pdf = new \TCPDF('P', 'pt', 'A4', true, 'UTF-8', false);
            $pdf->SetCreator('Product Designer');
            $pdf->SetAuthor('Product Designer for WooCommerce');
            $pdf->SetTitle('Design Export');
            $pdf->setPrintHeader(false);
            $pdf->setPrintFooter(false);
            $pdf->SetAutoPageBreak(false, 0);

            foreach ($views as $view) {
                $canvas_json = $view['canvas_json'] ?? [];
                $width  = (int) ($view['width'] ?? 800);
                $height = (int) ($view['height'] ?? 600);

                $pdf->AddPage('', [$width, $height]);

                // Render the view as SVG, then embed in the PDF page
                $svg = $this->svg_exporter->render($canvas_json, $width, $height);

                // Write SVG to temp file for TCPDF
                $tmp = tempnam(sys_get_temp_dir(), 'pd_svg_');
                file_put_contents($tmp, $svg);

                // Embed SVG into the PDF page at full size
                $pdf->ImageSVG($tmp, 0, 0, $width, $height);

                @unlink($tmp);
            }

            $pdf->Output($file_path, 'F');
            return file_exists($file_path);
        } catch (\Exception $e) {
            return false;
        }
    }

    /**
     * Export a single view to PDF.
     */
    public function export_single(array $canvas_json, int $width, int $height, string $file_path): bool {
        return $this->export([
            ['canvas_json' => $canvas_json, 'width' => $width, 'height' => $height],
        ], $file_path);
    }
}
