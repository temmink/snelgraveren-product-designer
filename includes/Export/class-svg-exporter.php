<?php
namespace ProductDesigner\Export;

defined('ABSPATH') || exit;

class SvgExporter {

    /**
     * Generate SVG markup from a Fabric.js canvas JSON structure.
     */
    public function render(array $canvas_json, int $width, int $height): string {
        $bg = $canvas_json['background'] ?? '#ffffff';
        $objects = $canvas_json['objects'] ?? [];

        $svg  = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
        $svg .= '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
        $svg .= ' width="' . $width . '" height="' . $height . '"';
        $svg .= ' viewBox="0 0 ' . $width . ' ' . $height . '">';

        // Background: solid color or 'none'
        if (!empty($bg) && $bg !== 'none') {
            $svg .= '<rect width="' . $width . '" height="' . $height . '" fill="' . esc_attr($bg) . '"/>';
        }

        // Background image (product photo)
        $bg_image = $canvas_json['backgroundImage'] ?? null;
        if ($bg_image && !empty($bg_image['src'])) {
            $svg .= $this->render_image($bg_image);
        }

        foreach ($objects as $obj) {
            $svg .= $this->render_object($obj);
        }

        $svg .= '</svg>';

        // Do NOT sanitize: this SVG is generated server-side from known data.
        // The enshrined/svg-sanitize library strips <image>, <text>, and
        // attributes like dominant-baseline, breaking the export.
        return $svg;
    }

    /**
     * Export a design view to an SVG file.
     */
    public function export(array $canvas_json, int $width, int $height, string $file_path): bool {
        $svg = $this->render($canvas_json, $width, $height);
        $dir = dirname($file_path);
        if (!wp_mkdir_p($dir)) {
            return false;
        }
        return (bool) file_put_contents($file_path, $svg);
    }

    private function render_object(array $obj): string {
        $type = $obj['type'] ?? '';

        return match (true) {
            in_array($type, ['i-text', 'IText', 'Textbox', 'textbox', 'Text'], true) => $this->render_text($obj),
            in_array($type, ['Image', 'image'], true) => $this->render_image($obj),
            in_array($type, ['Path', 'path'], true) => $this->render_path($obj),
            in_array($type, ['Group', 'group'], true) => $this->render_group($obj),
            in_array($type, ['Rect', 'rect'], true) => $this->render_rect($obj),
            in_array($type, ['Circle', 'circle'], true) => $this->render_circle($obj),
            default => '',
        };
    }

    private function render_text(array $obj): string {
        $left   = (float) ($obj['left'] ?? 0);
        $top    = (float) ($obj['top'] ?? 0);
        $text   = $obj['text'] ?? '';
        $fill   = $obj['fill'] ?? '#000000';
        $size   = (float) ($obj['fontSize'] ?? 20);
        $family = $obj['fontFamily'] ?? 'sans-serif';
        $weight = ($obj['fontWeight'] ?? 'normal') === 'bold' ? 'bold' : 'normal';
        $style  = ($obj['fontStyle'] ?? 'normal') === 'italic' ? 'italic' : 'normal';
        $angle  = (float) ($obj['angle'] ?? 0);
        $scaleX = (float) ($obj['scaleX'] ?? 1);
        $scaleY = (float) ($obj['scaleY'] ?? 1);
        $opacity = (float) ($obj['opacity'] ?? 1);

        $transform = $this->build_transform($left, $top, $angle, $scaleX, $scaleY);

        $lines = explode("\n", $text);
        $line_height = $size * 1.16;
        // Fabric.js top = top of bounding box. SVG default baseline is alphabetic.
        // Offset y by ~80% of fontSize (font ascent) to match Fabric.js positioning.
        $ascent_offset = $size * 0.8;

        $svg = '<g transform="' . esc_attr($transform) . '" opacity="' . $opacity . '">';
        foreach ($lines as $i => $line) {
            $y = ($i * $line_height) + $ascent_offset;
            $svg .= '<text x="0" y="' . $y . '"'
                . ' fill="' . esc_attr($fill) . '"'
                . ' font-size="' . $size . '"'
                . ' font-family="' . esc_attr($family) . '"'
                . ' font-weight="' . $weight . '"'
                . ' font-style="' . $style . '"'
                . '>' . esc_html($line) . '</text>';
        }
        $svg .= '</g>';

        return $svg;
    }

    private function render_image(array $obj): string {
        $left   = (float) ($obj['left'] ?? 0);
        $top    = (float) ($obj['top'] ?? 0);
        $width  = (float) ($obj['width'] ?? 0);
        $height = (float) ($obj['height'] ?? 0);
        $src    = $obj['src'] ?? '';
        $angle  = (float) ($obj['angle'] ?? 0);
        $scaleX = (float) ($obj['scaleX'] ?? 1);
        $scaleY = (float) ($obj['scaleY'] ?? 1);
        $opacity = (float) ($obj['opacity'] ?? 1);

        if (empty($src)) {
            return '';
        }

        // Embed as base64 data URI for portability (works offline, in TCPDF, etc.)
        $data_uri = $this->image_to_data_uri($src);
        if (empty($data_uri)) {
            return '';
        }

        $transform = $this->build_transform($left, $top, $angle, $scaleX, $scaleY);

        return '<image'
            . ' transform="' . esc_attr($transform) . '"'
            . ' width="' . $width . '" height="' . $height . '"'
            . ' href="' . $data_uri . '"'
            . ' opacity="' . $opacity . '"'
            . ' preserveAspectRatio="none"'
            . '/>';
    }

    private function render_path(array $obj): string {
        $path_data = $obj['path'] ?? null;
        if ($path_data === null) {
            return '';
        }

        // Fabric.js stores path as nested array; convert to d string
        $d = is_array($path_data) ? $this->path_array_to_string($path_data) : (string) $path_data;
        if (empty($d)) {
            return '';
        }

        $left   = (float) ($obj['left'] ?? 0);
        $top    = (float) ($obj['top'] ?? 0);
        $fill   = $obj['fill'] ?? 'none';
        $stroke = $obj['stroke'] ?? 'none';
        $strokeWidth = (float) ($obj['strokeWidth'] ?? 1);
        $angle  = (float) ($obj['angle'] ?? 0);
        $scaleX = (float) ($obj['scaleX'] ?? 1);
        $scaleY = (float) ($obj['scaleY'] ?? 1);
        $opacity = (float) ($obj['opacity'] ?? 1);

        // Make invisible boundary shapes visible for export
        $export_fill   = $this->export_color($fill);
        $export_stroke = $this->export_color($stroke);
        if ($export_fill === 'none' && $export_stroke === 'none') {
            $export_stroke = '#888888';
            $strokeWidth = max($strokeWidth, 0.5);
        }

        $transform = $this->build_transform($left, $top, $angle, $scaleX, $scaleY);

        return '<path'
            . ' transform="' . esc_attr($transform) . '"'
            . ' d="' . esc_attr($d) . '"'
            . ' fill="' . esc_attr($export_fill) . '"'
            . ' stroke="' . esc_attr($export_stroke) . '"'
            . ' stroke-width="' . $strokeWidth . '"'
            . ' opacity="' . $opacity . '"'
            . '/>';
    }

    private function render_group(array $obj): string {
        $left   = (float) ($obj['left'] ?? 0);
        $top    = (float) ($obj['top'] ?? 0);
        $angle  = (float) ($obj['angle'] ?? 0);
        $scaleX = (float) ($obj['scaleX'] ?? 1);
        $scaleY = (float) ($obj['scaleY'] ?? 1);
        $opacity = (float) ($obj['opacity'] ?? 1);
        $objects = $obj['objects'] ?? [];
        $width  = (float) ($obj['width'] ?? 0);
        $height = (float) ($obj['height'] ?? 0);

        // Fabric.js Group: children are positioned relative to the group center.
        // Translate to group position, then offset by half width/height so
        // children's relative coordinates resolve correctly.
        $cx = $width / 2;
        $cy = $height / 2;

        $transform = $this->build_transform($left, $top, $angle, $scaleX, $scaleY);

        $svg = '<g transform="' . esc_attr($transform) . '" opacity="' . $opacity . '">';
        $svg .= '<g transform="translate(' . $cx . ',' . $cy . ')">';
        foreach ($objects as $child) {
            $svg .= $this->render_object($child);
        }
        $svg .= '</g>';
        $svg .= '</g>';

        return $svg;
    }

    private function render_rect(array $obj): string {
        $left   = (float) ($obj['left'] ?? 0);
        $top    = (float) ($obj['top'] ?? 0);
        $width  = (float) ($obj['width'] ?? 0);
        $height = (float) ($obj['height'] ?? 0);
        $fill   = $obj['fill'] ?? '#000000';
        $stroke = $obj['stroke'] ?? 'none';
        $strokeWidth = (float) ($obj['strokeWidth'] ?? 0);
        $angle  = (float) ($obj['angle'] ?? 0);
        $scaleX = (float) ($obj['scaleX'] ?? 1);
        $scaleY = (float) ($obj['scaleY'] ?? 1);
        $opacity = (float) ($obj['opacity'] ?? 1);
        $rx = (float) ($obj['rx'] ?? 0);

        $transform = $this->build_transform($left, $top, $angle, $scaleX, $scaleY);

        return '<rect'
            . ' transform="' . esc_attr($transform) . '"'
            . ' width="' . $width . '" height="' . $height . '"'
            . ' fill="' . esc_attr($this->export_color($fill) ?: 'none') . '"'
            . ' stroke="' . esc_attr($this->export_color($stroke) ?: 'none') . '"'
            . ' stroke-width="' . $strokeWidth . '"'
            . ' rx="' . $rx . '"'
            . ' opacity="' . $opacity . '"'
            . '/>';
    }

    private function render_circle(array $obj): string {
        $left   = (float) ($obj['left'] ?? 0);
        $top    = (float) ($obj['top'] ?? 0);
        $radius = (float) ($obj['radius'] ?? 0);
        $fill   = $obj['fill'] ?? '#000000';
        $stroke = $obj['stroke'] ?? 'none';
        $strokeWidth = (float) ($obj['strokeWidth'] ?? 0);
        $angle  = (float) ($obj['angle'] ?? 0);
        $scaleX = (float) ($obj['scaleX'] ?? 1);
        $scaleY = (float) ($obj['scaleY'] ?? 1);
        $opacity = (float) ($obj['opacity'] ?? 1);

        // Fabric.js uses left/top as origin; SVG circle uses cx/cy as center
        $cx = $radius;
        $cy = $radius;
        $transform = $this->build_transform($left, $top, $angle, $scaleX, $scaleY);

        $export_fill   = $this->export_color($fill);
        $export_stroke = $this->export_color($stroke);

        return '<circle'
            . ' transform="' . esc_attr($transform) . '"'
            . ' cx="' . $cx . '" cy="' . $cy . '" r="' . $radius . '"'
            . ' fill="' . esc_attr($export_fill ?: 'none') . '"'
            . ' stroke="' . esc_attr($export_stroke ?: 'none') . '"'
            . ' stroke-width="' . $strokeWidth . '"'
            . ' opacity="' . $opacity . '"'
            . '/>';
    }

    private function build_transform(float $left, float $top, float $angle, float $scaleX, float $scaleY): string {
        $parts = [];
        if ($left != 0 || $top != 0) {
            $parts[] = 'translate(' . $left . ',' . $top . ')';
        }
        if ($angle != 0) {
            $parts[] = 'rotate(' . $angle . ')';
        }
        if ($scaleX != 1 || $scaleY != 1) {
            $parts[] = 'scale(' . $scaleX . ',' . $scaleY . ')';
        }
        return implode(' ', $parts);
    }

    /**
     * Convert Fabric.js path array to SVG d attribute string.
     * Fabric stores paths as [['M', 0, 0], ['L', 100, 100], ...].
     */
    private function path_array_to_string(array $path): string {
        $parts = [];
        foreach ($path as $segment) {
            if (is_array($segment)) {
                $parts[] = implode(' ', $segment);
            }
        }
        return implode(' ', $parts);
    }

    /**
     * Convert a Fabric.js color to an export-safe color.
     * Maps 'transparent' to 'none' for SVG.
     */
    private function export_color(?string $color): string {
        if ($color === null || $color === '' || $color === 'transparent') {
            return 'none';
        }
        return $color;
    }

    /**
     * Convert an image URL to a base64 data URI by reading the local file.
     */
    private function image_to_data_uri(string $url): string {
        $local_path = FileUtils::url_to_local_path($url);
        if (empty($local_path) || !file_exists($local_path)) {
            return '';
        }

        $data = file_get_contents($local_path);
        if ($data === false) {
            return '';
        }

        $mime = mime_content_type($local_path) ?: 'image/png';
        return 'data:' . $mime . ';base64,' . base64_encode($data);
    }

}
