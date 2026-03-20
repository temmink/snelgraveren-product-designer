<?php
namespace ProductForge\Export;

defined('ABSPATH') || exit;

use Intervention\Image\ImageManager;
use Intervention\Image\Drivers\Gd\Driver as GdDriver;
use Intervention\Image\Drivers\Imagick\Driver as ImagickDriver;

class PngExporter {

    private SvgExporter $svg_exporter;

    public function __construct() {
        $this->svg_exporter = new SvgExporter();
    }

    /**
     * Export a design view to a PNG file.
     *
     * Uses SVG exporter to generate an SVG, then converts to PNG
     * via Imagick. Falls back to direct Intervention Image rendering
     * if Imagick SVG support is unavailable.
     */
    public function export(array $canvas_json, int $width, int $height, string $file_path, int $dpi = 300): bool {
        $dir = dirname($file_path);
        if (!wp_mkdir_p($dir)) {
            return false;
        }

        // Try SVG-to-PNG via Imagick first (best quality, handles all objects)
        if (extension_loaded('imagick') && $this->imagick_supports_svg()) {
            $svg = $this->svg_exporter->render($canvas_json, $width, $height);
            if ($this->svg_to_png_imagick($svg, $width, $height, $file_path, $dpi)) {
                return true;
            }
        }

        // Fallback: render directly with Intervention Image (simpler rendering)
        return $this->render_direct($canvas_json, $width, $height, $file_path, $dpi);
    }

    private function imagick_supports_svg(): bool {
        try {
            $formats = \Imagick::queryFormats('SVG');
            return !empty($formats);
        } catch (\Exception $e) {
            return false;
        }
    }

    private function svg_to_png_imagick(string $svg, int $width, int $height, string $file_path, int $dpi): bool {
        try {
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
     * Direct rendering fallback using Intervention Image.
     * Renders background image, text, and basic shapes.
     */
    private function render_direct(array $canvas_json, int $width, int $height, string $file_path, int $dpi): bool {
        try {
            $driver = extension_loaded('imagick') ? new ImagickDriver() : new GdDriver();
            $manager = new ImageManager($driver);

            $scale = $dpi / 72;
            $render_width  = (int) round($width * $scale);
            $render_height = (int) round($height * $scale);

            $bg = $canvas_json['background'] ?? '#ffffff';
            $fill_color = (!empty($bg) && $bg !== 'none') ? $bg : '#ffffff';
            $image = $manager->create($render_width, $render_height)->fill($fill_color);

            // Render background image
            $bg_image = $canvas_json['backgroundImage'] ?? null;
            if ($bg_image && !empty($bg_image['src'])) {
                $this->render_image($image, $manager, $bg_image, $scale);
            }

            // Render objects
            $objects = $canvas_json['objects'] ?? [];
            foreach ($objects as $obj) {
                $this->render_object($image, $manager, $obj, $scale);
            }

            $image->toPng()->save($file_path);
            return file_exists($file_path);
        } catch (\Exception $e) {
            return false;
        }
    }

    private function render_object($image, ImageManager $manager, array $obj, float $scale): void {
        $type = $obj['type'] ?? '';

        match (true) {
            in_array($type, ['i-text', 'IText', 'Textbox', 'textbox', 'Text'], true) => $this->render_text($image, $obj, $scale),
            in_array($type, ['Image', 'image'], true) => $this->render_image($image, $manager, $obj, $scale),
            default => null,
        };
    }

    private function render_text($image, array $obj, float $scale): void {
        $left   = (float) ($obj['left'] ?? 0) * $scale;
        $top    = (float) ($obj['top'] ?? 0) * $scale;
        $text   = $obj['text'] ?? '';
        $fill   = $obj['fill'] ?? '#000000';
        $size   = (float) ($obj['fontSize'] ?? 20);
        $scaleY = (float) ($obj['scaleY'] ?? 1);
        $family = strtolower($obj['fontFamily'] ?? 'arial');

        $actual_size = $size * $scaleY * $scale;

        // Find a font file — try common system font paths
        $font_file = $this->find_font($family);

        try {
            $image->text($text, (int) $left, (int) $top, function ($font) use ($actual_size, $fill, $font_file) {
                if ($font_file) {
                    $font->filename($font_file);
                }
                $font->size($actual_size);
                $font->color($fill);
                $font->valign('top');
            });
        } catch (\Exception $e) {
            // Font rendering may fail; skip gracefully
        }
    }

    private function render_image($image, ImageManager $manager, array $obj, float $scale): void {
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

        $local_path = FileUtils::url_to_local_path($src);
        if (empty($local_path) || !file_exists($local_path)) {
            return;
        }

        try {
            $actual_width  = (int) round($width * $scaleX * $scale);
            $actual_height = (int) round($height * $scaleY * $scale);

            $overlay = $manager->read($local_path);
            $overlay->resize($actual_width, $actual_height);
            $image->place($overlay, 'top-left', (int) $left, (int) $top);
        } catch (\Exception $e) {
            // Skip images that fail to load
        }
    }

    /**
     * Find a TrueType font file for the given font family name.
     */
    private function find_font(string $family): string {
        $family = strtolower(trim($family));

        // Common mappings
        $map = [
            'arial'       => ['Arial.ttf', 'arial.ttf', 'LiberationSans-Regular.ttf', 'DejaVuSans.ttf'],
            'helvetica'   => ['Helvetica.ttf', 'Arial.ttf', 'arial.ttf', 'LiberationSans-Regular.ttf', 'DejaVuSans.ttf'],
            'times'       => ['Times.ttf', 'times.ttf', 'LiberationSerif-Regular.ttf', 'DejaVuSerif.ttf'],
            'courier'     => ['Courier.ttf', 'courier.ttf', 'LiberationMono-Regular.ttf', 'DejaVuSansMono.ttf'],
            'sans-serif'  => ['DejaVuSans.ttf', 'LiberationSans-Regular.ttf', 'arial.ttf'],
        ];

        $candidates = $map[$family] ?? [$family . '.ttf', 'DejaVuSans.ttf'];

        // Search common font directories
        $dirs = [
            '/usr/share/fonts/truetype/',
            '/usr/share/fonts/truetype/dejavu/',
            '/usr/share/fonts/truetype/liberation/',
            '/usr/share/fonts/',
            '/usr/local/share/fonts/',
        ];

        foreach ($candidates as $file) {
            foreach ($dirs as $dir) {
                $path = $dir . $file;
                if (file_exists($path)) {
                    return $path;
                }
            }
        }

        return '';
    }

}
