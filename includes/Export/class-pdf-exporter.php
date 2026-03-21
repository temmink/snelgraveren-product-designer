<?php
namespace ProductForge\Export;

defined('ABSPATH') || exit;

class PdfExporter {

    private array $custom_font_map = [];

    /**
     * Export design views to a multi-page PDF file.
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

        $this->load_custom_fonts();

        try {
            $pdf = new \TCPDF('P', 'pt', 'A4', true, 'UTF-8', false);
            $pdf->SetCreator('ProductForge');
            $pdf->SetAuthor('ProductForge for WooCommerce');
            $pdf->SetTitle('Design Export');
            $pdf->setPrintHeader(false);
            $pdf->setPrintFooter(false);
            $pdf->SetAutoPageBreak(false, 0);

            foreach ($views as $view) {
                $canvas_json = $view['canvas_json'] ?? [];
                $width  = (int) ($view['width'] ?? 800);
                $height = (int) ($view['height'] ?? 600);

                $pdf->AddPage('', [$width, $height]);

                // 1. Background color
                $bg = $canvas_json['background'] ?? '#ffffff';
                if (!empty($bg) && $bg !== 'none') {
                    $rgb = $this->hex_to_rgb($bg);
                    $pdf->SetFillColor($rgb[0], $rgb[1], $rgb[2]);
                    $pdf->Rect(0, 0, $width, $height, 'F');
                }

                // 2. Background image
                $bg_image = $canvas_json['backgroundImage'] ?? null;
                if ($bg_image && !empty($bg_image['src'])) {
                    $this->render_image($pdf, $bg_image);
                }

                // 3. Canvas objects
                $objects = $canvas_json['objects'] ?? [];
                foreach ($objects as $obj) {
                    $this->render_object($pdf, $obj);
                }
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

    private function render_object(\TCPDF $pdf, array $obj): void {
        $type = $obj['type'] ?? '';

        match (true) {
            in_array($type, ['i-text', 'IText', 'Textbox', 'textbox', 'Text'], true) => $this->render_text($pdf, $obj),
            in_array($type, ['Image', 'image'], true) => $this->render_image($pdf, $obj),
            in_array($type, ['Rect', 'rect'], true) => $this->render_rect($pdf, $obj),
            in_array($type, ['Circle', 'circle'], true) => $this->render_circle($pdf, $obj),
            in_array($type, ['Group', 'group'], true) => $this->render_group($pdf, $obj),
            default => null,
        };
    }

    private function render_text(\TCPDF $pdf, array $obj): void {
        $left   = (float) ($obj['left'] ?? 0);
        $top    = (float) ($obj['top'] ?? 0);
        $text   = $obj['text'] ?? '';
        $fill   = $obj['fill'] ?? '#000000';
        $size   = (float) ($obj['fontSize'] ?? 20);
        $weight = ($obj['fontWeight'] ?? 'normal') === 'bold' ? 'B' : '';
        $style  = ($obj['fontStyle'] ?? 'normal') === 'italic' ? 'I' : '';
        $scaleX = (float) ($obj['scaleX'] ?? 1);
        $scaleY = (float) ($obj['scaleY'] ?? 1);

        $rgb = $this->hex_to_rgb($fill);
        $pdf->SetTextColor($rgb[0], $rgb[1], $rgb[2]);

        $family = $obj['fontFamily'] ?? 'Arial';
        $actual_size = $size * $scaleY;
        $font_name = $this->resolve_font($pdf, $family);
        $pdf->SetFont($font_name, $weight . $style, $actual_size);

        // Fabric.js top = top of text bounding box; TCPDF SetXY = top-left
        $pdf->SetXY($left, $top);

        // Use Cell for single-line text for better positioning control
        $lines = explode("\n", $text);
        $line_height = $actual_size * 1.16;
        foreach ($lines as $i => $line) {
            $pdf->SetXY($left, $top + ($i * $line_height));
            $pdf->Cell(0, $line_height, $line, 0, 0, 'L');
        }
    }

    private function render_image(\TCPDF $pdf, array $obj): void {
        $left   = (float) ($obj['left'] ?? 0);
        $top    = (float) ($obj['top'] ?? 0);
        $width  = (float) ($obj['width'] ?? 0);
        $height = (float) ($obj['height'] ?? 0);
        $src    = $obj['src'] ?? '';
        $scaleX = (float) ($obj['scaleX'] ?? 1);
        $scaleY = (float) ($obj['scaleY'] ?? 1);

        if (empty($src)) {
            return;
        }

        $actual_width  = $width * $scaleX;
        $actual_height = $height * $scaleY;

        $local_path = FileUtils::url_to_local_path($src);
        if ($local_path && file_exists($local_path)) {
            try {
                $pdf->Image($local_path, $left, $top, $actual_width, $actual_height, '', '', '', false, 300, '', false, false, 0);
            } catch (\Exception $e) {
                // Skip images that fail to render
            }
        }
    }

    private function render_group(\TCPDF $pdf, array $obj): void {
        // Groups contain child objects — currently skip rendering
        // as TCPDF doesn't have a good way to handle Fabric.js Group transforms.
        // The boundary shape will be visible in SVG/PNG exports.
    }

    private function render_rect(\TCPDF $pdf, array $obj): void {
        $left   = (float) ($obj['left'] ?? 0);
        $top    = (float) ($obj['top'] ?? 0);
        $width  = (float) ($obj['width'] ?? 0);
        $height = (float) ($obj['height'] ?? 0);
        $fill   = $obj['fill'] ?? '';
        $scaleX = (float) ($obj['scaleX'] ?? 1);
        $scaleY = (float) ($obj['scaleY'] ?? 1);

        if (empty($fill) || $fill === 'transparent') {
            return;
        }

        $rgb = $this->hex_to_rgb($fill);
        $pdf->SetFillColor($rgb[0], $rgb[1], $rgb[2]);
        $pdf->Rect($left, $top, $width * $scaleX, $height * $scaleY, 'F');
    }

    private function render_circle(\TCPDF $pdf, array $obj): void {
        $left   = (float) ($obj['left'] ?? 0);
        $top    = (float) ($obj['top'] ?? 0);
        $radius = (float) ($obj['radius'] ?? 0);
        $fill   = $obj['fill'] ?? '';
        $scaleX = (float) ($obj['scaleX'] ?? 1);
        $scaleY = (float) ($obj['scaleY'] ?? 1);

        if (empty($fill) || $fill === 'transparent' || $radius <= 0) {
            return;
        }

        $rgb = $this->hex_to_rgb($fill);
        $pdf->SetFillColor($rgb[0], $rgb[1], $rgb[2]);
        $pdf->Ellipse(
            $left + ($radius * $scaleX),
            $top + ($radius * $scaleY),
            $radius * $scaleX,
            $radius * $scaleY,
            0, 0, 360, 'F'
        );
    }

    /**
     * Build a mapping of custom font family names to local TTF file paths.
     */
    private function load_custom_fonts(): void {
        $custom_fonts = \ProductForge\Database\FontRepository::all();
        foreach ($custom_fonts as $font) {
            foreach ($font['files'] as $file) {
                if ($file['format'] !== 'truetype') {
                    continue;
                }
                $local_path = FileUtils::url_to_local_path($file['file_url']);
                if ($local_path && file_exists($local_path)) {
                    $this->custom_font_map[$font['family']] = $local_path;
                    break;
                }
            }
        }
    }

    /**
     * Resolve a font family name to a TCPDF font name.
     */
    private function resolve_font(\TCPDF $pdf, string $family): string {
        $builtin = [
            'arial' => 'helvetica',
            'helvetica' => 'helvetica',
            'times new roman' => 'times',
            'times' => 'times',
            'courier new' => 'courier',
            'courier' => 'courier',
            'georgia' => 'times',
            'verdana' => 'helvetica',
            'tahoma' => 'helvetica',
            'trebuchet ms' => 'helvetica',
            'sans-serif' => 'helvetica',
            'serif' => 'times',
            'monospace' => 'courier',
        ];

        $lower = strtolower($family);
        if (isset($builtin[$lower])) {
            return $builtin[$lower];
        }

        if (isset($this->custom_font_map[$family])) {
            try {
                $font_name = \TCPDF_FONTS::addTTFfont($this->custom_font_map[$family], 'TrueTypeUnicode', '', 96);
                if ($font_name) {
                    return $font_name;
                }
            } catch (\Exception $e) {
                // Fall through to default
            }
        }

        return 'helvetica';
    }

    private function hex_to_rgb(string $hex): array {
        $hex = ltrim($hex, '#');
        if (strlen($hex) === 3) {
            $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
        }
        if (strlen($hex) !== 6) {
            return [255, 255, 255];
        }
        return [
            hexdec(substr($hex, 0, 2)),
            hexdec(substr($hex, 2, 2)),
            hexdec(substr($hex, 4, 2)),
        ];
    }

}
