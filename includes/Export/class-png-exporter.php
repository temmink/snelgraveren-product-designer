<?php
namespace ProductDesigner\Export;

defined('ABSPATH') || exit;

use Intervention\Image\ImageManager;
use Intervention\Image\Drivers\Gd\Driver as GdDriver;
use Intervention\Image\Drivers\Imagick\Driver as ImagickDriver;

class PngExporter {

    /**
     * Export a design view to a PNG file using Intervention Image.
     *
     * Renders canvas objects (text, images, rects) directly onto a GD/Imagick canvas.
     */
    public function export(array $canvas_json, int $width, int $height, string $file_path, int $dpi = 300): bool {
        $dir = dirname($file_path);
        if (!wp_mkdir_p($dir)) {
            return false;
        }

        try {
            // Use Imagick driver if available, fall back to GD
            $driver = extension_loaded('imagick') ? new ImagickDriver() : new GdDriver();
            $manager = new ImageManager($driver);

            // Scale up for higher DPI output
            $scale = $dpi / 72;
            $render_width  = (int) round($width * $scale);
            $render_height = (int) round($height * $scale);

            // Create canvas with background color
            $bg = $canvas_json['background'] ?? '#ffffff';
            $fill_color = (!empty($bg) && $bg !== 'none') ? $bg : '#ffffff';
            $image = $manager->create($render_width, $render_height)->fill($fill_color);

            // Render background image (product photo)
            $bg_image = $canvas_json['backgroundImage'] ?? null;
            if ($bg_image && !empty($bg_image['src'])) {
                $this->render_image($image, $bg_image, $scale);
            }

            // Render objects
            $objects = $canvas_json['objects'] ?? [];
            foreach ($objects as $obj) {
                $this->render_object($image, $obj, $scale);
            }

            $image->toPng()->save($file_path);

            return file_exists($file_path);
        } catch (\Exception $e) {
            return false;
        }
    }

    private function render_object($image, array $obj, float $scale): void {
        $type = $obj['type'] ?? '';

        match (true) {
            in_array($type, ['i-text', 'IText', 'Textbox', 'textbox', 'Text'], true) => $this->render_text($image, $obj, $scale),
            in_array($type, ['Image', 'image'], true) => $this->render_image($image, $obj, $scale),
            in_array($type, ['Rect', 'rect'], true) => $this->render_rect($image, $obj, $scale),
            default => null,
        };
    }

    private function render_text($image, array $obj, float $scale): void {
        $left   = (float) ($obj['left'] ?? 0) * $scale;
        $top    = (float) ($obj['top'] ?? 0) * $scale;
        $text   = $obj['text'] ?? '';
        $fill   = $obj['fill'] ?? '#000000';
        $size   = (float) ($obj['fontSize'] ?? 20);
        $scaleX = (float) ($obj['scaleX'] ?? 1);
        $scaleY = (float) ($obj['scaleY'] ?? 1);
        $weight = ($obj['fontWeight'] ?? 'normal') === 'bold' ? 'bold' : 'normal';

        $actual_size = $size * $scaleY * $scale;

        try {
            $image->text($text, (int) $left, (int) $top, function ($font) use ($actual_size, $fill) {
                $font->size($actual_size);
                $font->color($fill);
                $font->valign('top');
            });
        } catch (\Exception $e) {
            // Font rendering may fail; skip gracefully
        }
    }

    private function render_image($image, array $obj, float $scale): void {
        $left   = (float) ($obj['left'] ?? 0) * $scale;
        $top    = (float) ($obj['top'] ?? 0) * $scale;
        $width  = (float) ($obj['width'] ?? 0);
        $height = (float) ($obj['height'] ?? 0);
        $src    = $obj['src'] ?? '';
        $scaleX = (float) ($obj['scaleX'] ?? 1);
        $scaleY = (float) ($obj['scaleY'] ?? 1);

        if (empty($src)) {
            return;
        }

        $local_path = $this->url_to_local_path($src);
        if (empty($local_path) || !file_exists($local_path)) {
            return;
        }

        try {
            $actual_width  = (int) round($width * $scaleX * $scale);
            $actual_height = (int) round($height * $scaleY * $scale);

            $driver = extension_loaded('imagick') ? new ImagickDriver() : new GdDriver();
            $manager = new ImageManager($driver);
            $overlay = $manager->read($local_path);
            $overlay->resize($actual_width, $actual_height);
            $image->place($overlay, 'top-left', (int) $left, (int) $top);
        } catch (\Exception $e) {
            // Skip images that fail to load
        }
    }

    private function render_rect($image, array $obj, float $scale): void {

        $left   = (float) ($obj['left'] ?? 0) * $scale;
        $top    = (float) ($obj['top'] ?? 0) * $scale;
        $width  = (float) ($obj['width'] ?? 0);
        $height = (float) ($obj['height'] ?? 0);
        $fill   = $obj['fill'] ?? '';
        $scaleX = (float) ($obj['scaleX'] ?? 1);
        $scaleY = (float) ($obj['scaleY'] ?? 1);

        if (empty($fill) || $fill === 'transparent') {
            return;
        }

        $actual_width  = (int) round($width * $scaleX * $scale);
        $actual_height = (int) round($height * $scaleY * $scale);

        try {
            $image->drawRectangle(
                (int) $left,
                (int) $top,
                function ($draw) use ($actual_width, $actual_height, $fill) {
                    $draw->size($actual_width, $actual_height);
                    $draw->background($fill);
                }
            );
        } catch (\Exception $e) {
            // Skip rects that fail
        }
    }

    private function url_to_local_path(string $url): string {
        $upload_dir = wp_upload_dir();
        $base_url = $upload_dir['baseurl'];
        $base_dir = $upload_dir['basedir'];

        if (str_starts_with($url, $base_url)) {
            return str_replace($base_url, $base_dir, $url);
        }

        $site_url = site_url();
        $abspath  = ABSPATH;
        if (str_starts_with($url, $site_url)) {
            $relative = str_replace($site_url, '', $url);
            $path = $abspath . ltrim($relative, '/');
            if (file_exists($path)) {
                return $path;
            }
        }

        return '';
    }
}
