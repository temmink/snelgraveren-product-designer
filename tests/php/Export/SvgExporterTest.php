<?php
use PHPUnit\Framework\TestCase;
use ProductForge\Export\SvgExporter;

class SvgExporterTest extends TestCase {
    private SvgExporter $exporter;

    protected function setUp(): void {
        $this->exporter = new SvgExporter();
    }

    public function test_renders_valid_svg(): void {
        $canvas_json = [
            'background' => '#ffffff',
            'objects'    => [
                [
                    'type'     => 'IText',
                    'text'     => 'Test',
                    'left'     => 10,
                    'top'      => 10,
                    'fontSize' => 20,
                    'fill'     => '#000000',
                ],
            ],
        ];
        $svg = $this->exporter->render($canvas_json, 800, 600);
        $this->assertStringStartsWith('<?xml', $svg);
        $this->assertStringContainsString('<svg', $svg);
        $this->assertStringContainsString('Test', $svg);
        $this->assertStringContainsString('</svg>', $svg);
    }

    public function test_svg_has_correct_dimensions(): void {
        $canvas_json = ['background' => '#ffffff', 'objects' => []];
        $svg = $this->exporter->render($canvas_json, 1200, 900);
        $this->assertStringContainsString('width="1200"', $svg);
        $this->assertStringContainsString('height="900"', $svg);
        $this->assertStringContainsString('viewBox="0 0 1200 900"', $svg);
    }

    public function test_exports_to_file(): void {
        $canvas_json = ['background' => '#ffffff', 'objects' => []];
        $path = sys_get_temp_dir() . '/pf-test-' . uniqid() . '.svg';
        $result = $this->exporter->export($canvas_json, 800, 600, $path);
        $this->assertTrue($result);
        $this->assertFileExists($path);
        @unlink($path);
    }

    public function test_exports_file_contains_valid_svg(): void {
        $canvas_json = [
            'background' => '#ff0000',
            'objects'    => [],
        ];
        $path = sys_get_temp_dir() . '/pf-test-' . uniqid() . '.svg';
        $this->exporter->export($canvas_json, 400, 300, $path);
        $content = file_get_contents($path);
        $this->assertStringStartsWith('<?xml', $content);
        $this->assertStringContainsString('<svg', $content);
        $this->assertStringContainsString('</svg>', $content);
        @unlink($path);
    }

    public function test_renders_rect(): void {
        $canvas_json = [
            'objects' => [
                [
                    'type'   => 'Rect',
                    'left'   => 0,
                    'top'    => 0,
                    'width'  => 100,
                    'height' => 50,
                    'fill'   => '#ff0000',
                ],
            ],
        ];
        $svg = $this->exporter->render($canvas_json, 800, 600);
        $this->assertStringContainsString('<rect', $svg);
    }

    public function test_renders_circle(): void {
        $canvas_json = [
            'objects' => [
                [
                    'type'   => 'Circle',
                    'left'   => 50,
                    'top'    => 50,
                    'radius' => 40,
                    'fill'   => '#0000ff',
                ],
            ],
        ];
        $svg = $this->exporter->render($canvas_json, 800, 600);
        $this->assertStringContainsString('<circle', $svg);
    }

    public function test_renders_path(): void {
        $canvas_json = [
            'objects' => [
                [
                    'type'   => 'Path',
                    'left'   => 0,
                    'top'    => 0,
                    'path'   => [['M', 0, 0], ['L', 100, 100], ['Z']],
                    'fill'   => '#00ff00',
                    'stroke' => '#000000',
                ],
            ],
        ];
        $svg = $this->exporter->render($canvas_json, 800, 600);
        $this->assertStringContainsString('<path', $svg);
    }

    public function test_renders_background_color(): void {
        $canvas_json = [
            'background' => '#aabbcc',
            'objects'    => [],
        ];
        $svg = $this->exporter->render($canvas_json, 800, 600);
        // Background rect should have fill with the background color
        $this->assertStringContainsString('#aabbcc', $svg);
    }

    public function test_renders_group(): void {
        $canvas_json = [
            'objects' => [
                [
                    'type'    => 'Group',
                    'left'    => 10,
                    'top'     => 10,
                    'width'   => 200,
                    'height'  => 100,
                    'objects' => [
                        [
                            'type'   => 'Rect',
                            'left'   => 0,
                            'top'    => 0,
                            'width'  => 50,
                            'height' => 50,
                            'fill'   => '#333333',
                        ],
                    ],
                ],
            ],
        ];
        $svg = $this->exporter->render($canvas_json, 800, 600);
        // Group renders as nested <g> elements
        $this->assertStringContainsString('<g', $svg);
    }

    public function test_renders_multiline_text(): void {
        $canvas_json = [
            'objects' => [
                [
                    'type'     => 'IText',
                    'text'     => "Hello\nWorld",
                    'left'     => 10,
                    'top'      => 10,
                    'fontSize' => 18,
                    'fill'     => '#000000',
                ],
            ],
        ];
        $svg = $this->exporter->render($canvas_json, 800, 600);
        $this->assertStringContainsString('Hello', $svg);
        $this->assertStringContainsString('World', $svg);
    }

    public function test_transparent_background_omits_bg_rect(): void {
        $canvas_json = [
            'background' => 'none',
            'objects'    => [],
        ];
        $svg = $this->exporter->render($canvas_json, 800, 600);
        // Should contain opening svg tag but no background fill rect for 'none'
        $this->assertStringContainsString('<svg', $svg);
        // The only rect (if any) should not have fill="none" as background
        // Simply verify no background rect was added (only the svg wrapper exists)
        $this->assertStringNotContainsString('fill="none"', $svg);
    }

    public function test_skips_unknown_object_type(): void {
        $canvas_json = [
            'objects' => [
                ['type' => 'Triangle', 'left' => 0, 'top' => 0],
            ],
        ];
        // Should not throw; unknown types are silently skipped
        $svg = $this->exporter->render($canvas_json, 800, 600);
        $this->assertStringContainsString('<svg', $svg);
    }
}
