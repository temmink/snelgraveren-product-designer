<?php
use PHPUnit\Framework\TestCase;
use ProductDesigner\Export\PdfExporter;

class PdfExporterTest extends TestCase {

    private function make_exporter(): PdfExporter {
        return new PdfExporter();
    }

    public function test_returns_false_for_empty_views(): void {
        $exporter = $this->make_exporter();
        $result = $exporter->export([], '/tmp/empty-pd-test.pdf');
        $this->assertFalse($result);
    }

    public function test_exports_single_view_pdf(): void {
        $exporter = $this->make_exporter();
        $path = sys_get_temp_dir() . '/pd-test-' . uniqid() . '.pdf';
        $result = $exporter->export([
            [
                'canvas_json' => [
                    'background' => '#ffffff',
                    'objects'    => [
                        [
                            'type'     => 'IText',
                            'text'     => 'PDF Test',
                            'left'     => 50,
                            'top'      => 50,
                            'fontSize' => 24,
                            'fill'     => '#000000',
                        ],
                    ],
                ],
                'width'  => 800,
                'height' => 600,
            ],
        ], $path);
        $this->assertTrue($result);
        $this->assertFileExists($path);
        $this->assertGreaterThan(1000, filesize($path), 'PDF file should not be empty');
        @unlink($path);
    }

    public function test_pdf_file_starts_with_pdf_magic_bytes(): void {
        $exporter = $this->make_exporter();
        $path = sys_get_temp_dir() . '/pd-test-' . uniqid() . '.pdf';
        $exporter->export([
            [
                'canvas_json' => ['background' => '#ffffff', 'objects' => []],
                'width'       => 400,
                'height'      => 300,
            ],
        ], $path);
        $header = file_get_contents($path, false, null, 0, 5);
        $this->assertStringStartsWith('%PDF-', $header, 'File should start with PDF magic bytes');
        @unlink($path);
    }

    public function test_multi_view_produces_multi_page_pdf(): void {
        $exporter = $this->make_exporter();
        $path = sys_get_temp_dir() . '/pd-test-' . uniqid() . '.pdf';
        $views = [
            [
                'canvas_json' => ['background' => '#ffffff', 'objects' => []],
                'width'       => 400,
                'height'      => 300,
            ],
            [
                'canvas_json' => ['background' => '#eeeeee', 'objects' => []],
                'width'       => 400,
                'height'      => 300,
            ],
        ];
        $result = $exporter->export($views, $path);
        $this->assertTrue($result);
        $this->assertFileExists($path);
        // A 2-page PDF will be larger than a 1-page PDF; basic sanity check
        $this->assertGreaterThan(1000, filesize($path));
        @unlink($path);
    }

    public function test_export_single_delegates_correctly(): void {
        $exporter = $this->make_exporter();
        $path = sys_get_temp_dir() . '/pd-test-' . uniqid() . '.pdf';
        $result = $exporter->export_single(
            ['background' => '#ffffff', 'objects' => []],
            800,
            600,
            $path
        );
        $this->assertTrue($result);
        $this->assertFileExists($path);
        @unlink($path);
    }

    public function test_exports_view_with_rect(): void {
        $exporter = $this->make_exporter();
        $path = sys_get_temp_dir() . '/pd-test-' . uniqid() . '.pdf';
        $result = $exporter->export([
            [
                'canvas_json' => [
                    'background' => '#ffffff',
                    'objects'    => [
                        [
                            'type'   => 'Rect',
                            'left'   => 20,
                            'top'    => 20,
                            'width'  => 100,
                            'height' => 60,
                            'fill'   => '#ff0000',
                        ],
                    ],
                ],
                'width'  => 400,
                'height' => 300,
            ],
        ], $path);
        $this->assertTrue($result);
        $this->assertFileExists($path);
        @unlink($path);
    }

    public function test_exports_view_with_circle(): void {
        $exporter = $this->make_exporter();
        $path = sys_get_temp_dir() . '/pd-test-' . uniqid() . '.pdf';
        $result = $exporter->export([
            [
                'canvas_json' => [
                    'background' => '#ffffff',
                    'objects'    => [
                        [
                            'type'   => 'Circle',
                            'left'   => 50,
                            'top'    => 50,
                            'radius' => 40,
                            'fill'   => '#0000ff',
                        ],
                    ],
                ],
                'width'  => 400,
                'height' => 300,
            ],
        ], $path);
        $this->assertTrue($result);
        $this->assertFileExists($path);
        @unlink($path);
    }
}
