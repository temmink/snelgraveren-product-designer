<?php
use PHPUnit\Framework\TestCase;
use ProductForge\Export\PngExporter;

class PngExporterTest extends TestCase {

    private function make_exporter(): PngExporter {
        return new PngExporter();
    }

    public function test_exports_png_file(): void {
        $exporter = $this->make_exporter();
        $path = sys_get_temp_dir() . '/pf-test-' . uniqid() . '.png';
        $result = $exporter->export(
            ['background' => '#ffffff', 'objects' => []],
            800,
            600,
            $path
        );
        $this->assertTrue($result);
        $this->assertFileExists($path);
        @unlink($path);
    }

    public function test_exported_file_has_png_magic_bytes(): void {
        $exporter = $this->make_exporter();
        $path = sys_get_temp_dir() . '/pf-test-' . uniqid() . '.png';
        $result = $exporter->export(
            ['background' => '#ffffff', 'objects' => []],
            200,
            150,
            $path
        );
        $this->assertTrue($result);
        // PNG magic bytes: \x89PNG
        $header = file_get_contents($path, false, null, 0, 4);
        $this->assertEquals("\x89PNG", $header, 'File should start with PNG magic bytes');
        @unlink($path);
    }

    public function test_exported_file_is_not_empty(): void {
        $exporter = $this->make_exporter();
        $path = sys_get_temp_dir() . '/pf-test-' . uniqid() . '.png';
        $exporter->export(
            ['background' => '#ff0000', 'objects' => []],
            100,
            100,
            $path
        );
        $this->assertGreaterThan(100, filesize($path), 'PNG file should have a meaningful size');
        @unlink($path);
    }

    public function test_exports_with_text_object(): void {
        $exporter = $this->make_exporter();
        $path = sys_get_temp_dir() . '/pf-test-' . uniqid() . '.png';
        $result = $exporter->export(
            [
                'background' => '#ffffff',
                'objects'    => [
                    [
                        'type'     => 'IText',
                        'text'     => 'Hello PNG',
                        'left'     => 50,
                        'top'      => 50,
                        'fontSize' => 24,
                        'fill'     => '#000000',
                    ],
                ],
            ],
            400,
            300,
            $path
        );
        $this->assertTrue($result);
        $this->assertFileExists($path);
        @unlink($path);
    }

    public function test_exports_with_custom_dpi(): void {
        $exporter = $this->make_exporter();
        $path_72  = sys_get_temp_dir() . '/pf-test-' . uniqid() . '-72dpi.png';
        $path_150 = sys_get_temp_dir() . '/pf-test-' . uniqid() . '-150dpi.png';

        $canvas = ['background' => '#cccccc', 'objects' => []];

        $exporter->export($canvas, 200, 200, $path_72, 72);
        $exporter->export($canvas, 200, 200, $path_150, 150);

        $this->assertFileExists($path_72);
        $this->assertFileExists($path_150);

        // Higher DPI should produce a larger file (more pixels = more data)
        $this->assertGreaterThan(
            filesize($path_72),
            filesize($path_150),
            'Higher DPI export should produce a larger file'
        );

        @unlink($path_72);
        @unlink($path_150);
    }

    public function test_export_none_background(): void {
        $exporter = $this->make_exporter();
        $path = sys_get_temp_dir() . '/pf-test-' . uniqid() . '.png';
        // 'none' background should still produce a valid PNG (fallback to white)
        $result = $exporter->export(
            ['background' => 'none', 'objects' => []],
            200,
            150,
            $path
        );
        $this->assertTrue($result);
        $this->assertFileExists($path);
        @unlink($path);
    }
}
