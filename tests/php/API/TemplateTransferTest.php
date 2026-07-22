<?php
use PHPUnit\Framework\TestCase;
use ProductForge\Database\TemplateRepository;

/**
 * Round-trip tests for GET /templates/{id}/export and POST /templates/import.
 * Runs against the real dev WordPress (see bootstrap.php).
 */
class TemplateTransferTest extends TestCase {
    private $server;
    private TemplateRepository $repo;
    private array $created_ids = [];
    private array $created_files = [];

    protected function setUp(): void {
        global $wp_rest_server;
        $this->server = $wp_rest_server = new \WP_REST_Server();
        do_action('rest_api_init');
        $this->repo = new TemplateRepository();
        wp_set_current_user(1);
    }

    protected function tearDown(): void {
        foreach ($this->created_ids as $id) {
            $this->repo->delete($id);
        }
        foreach ($this->created_files as $f) {
            if (file_exists($f)) unlink($f);
        }
        $this->created_ids = $this->created_files = [];
    }

    /** Seed a template with one view referencing an uploads SVG + inline markup. */
    private function seed_template(): array {
        $uploads = wp_upload_dir();
        $dir = $uploads['basedir'] . '/pf-template-assets';
        if (!is_dir($dir)) wp_mkdir_p($dir);
        $asset_path = $dir . '/transfer-test-' . uniqid() . '.svg';
        file_put_contents($asset_path, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
        $this->created_files[] = $asset_path;
        $asset_url = str_replace($uploads['basedir'], $uploads['baseurl'], $asset_path);

        $id = $this->repo->create(['title' => 'Transfer test ' . uniqid(), 'status' => 'published']);
        $this->created_ids[] = $id;
        $this->repo->create_view($id, [
            'name'           => 'Front',
            'canvas_width'   => 600,
            'canvas_height'  => 600,
            'background_url' => $asset_url,
            'zones_config'   => [[
                'name' => 'Zone', 'behavior' => 'restrict', 'boundary_type' => 'svg',
                'svg_url' => $asset_url,
                'x' => 0, 'y' => 0, 'width' => 600, 'height' => 600,
                'allowed_types' => ['text'],
                'layers' => [
                    ['type' => 'svg', 'svg_markup' => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5"><path d="M0 0L5 5"/></svg>', 'left' => 1, 'top' => 2],
                    ['type' => 'text', 'text' => 'Naam', 'fontFamily' => 'SomeMissingFont', 'left' => 3, 'top' => 4],
                ],
            ]],
        ]);
        return ['id' => $id, 'asset_url' => $asset_url];
    }

    private function export(int $id): array {
        $request  = new \WP_REST_Request('GET', "/pf/v1/templates/{$id}/export");
        $response = $this->server->dispatch($request);
        $this->assertEquals(200, $response->get_status());
        return $response->get_data();
    }

    public function test_export_embeds_upload_assets_and_rewrites_urls(): void {
        $seed = $this->seed_template();
        $data = $this->export($seed['id']);

        $this->assertSame('sgpd-template', $data['format']);
        $this->assertSame(1, $data['version']);
        $this->assertNotEmpty($data['template']['title']);
        $this->assertCount(1, $data['views']);

        $view = $data['views'][0];
        $this->assertStringStartsWith('asset:', $view['background_url']);
        $this->assertStringStartsWith('asset:', $view['zones_config'][0]['svg_url']);

        $key = substr($view['background_url'], strlen('asset:'));
        $this->assertArrayHasKey($key, $data['assets']);
        $decoded = base64_decode($data['assets'][$key]['data']);
        $this->assertStringContainsString('<svg', $decoded);
    }

    public function test_export_requires_admin(): void {
        $seed = $this->seed_template();
        wp_set_current_user(0);
        $request  = new \WP_REST_Request('GET', "/pf/v1/templates/{$seed['id']}/export");
        $response = $this->server->dispatch($request);
        $this->assertContains($response->get_status(), [401, 403]);
    }

    public function test_import_round_trip_creates_draft_with_rewritten_assets(): void {
        $seed = $this->seed_template();
        $data = $this->export($seed['id']);

        $request = new \WP_REST_Request('POST', '/pf/v1/templates/import');
        $request->set_header('Content-Type', 'application/json');
        $request->set_body(wp_json_encode($data));
        $response = $this->server->dispatch($request);
        $this->assertEquals(201, $response->get_status(), print_r($response->get_data(), true));

        $new_id = (int) $response->get_data()['id'];
        $this->created_ids[] = $new_id;
        $imported = $this->repo->get($new_id);

        $this->assertSame('draft', $imported['status']);
        $this->assertCount(1, $imported['views']);
        $view = $imported['views'][0];
        // Asset refs rewritten to real URLs on this site, files exist on disk.
        $uploads = wp_upload_dir();
        foreach ([$view['background_url'], $view['zones_config'][0]['svg_url']] as $url) {
            $this->assertStringStartsWith($uploads['baseurl'], $url);
            $path = str_replace($uploads['baseurl'], $uploads['basedir'], $url);
            $this->assertFileExists($path);
            $this->created_files[] = $path;
        }
        // Layers survived (markup + text).
        $layers = $view['zones_config'][0]['layers'];
        $this->assertCount(2, $layers);
        $this->assertStringContainsString('<svg', $layers[0]['svg_markup']);
        // Missing font reported as warning.
        $warnings = $response->get_data()['warnings'] ?? [];
        $this->assertNotEmpty(array_filter($warnings, fn($w) => str_contains($w, 'SomeMissingFont')));
    }

    public function test_import_sanitizes_svg_assets(): void {
        $seed = $this->seed_template();
        $data = $this->export($seed['id']);
        // Inject a script into the exported asset.
        $key = array_key_first($data['assets']);
        $data['assets'][$key]['data'] = base64_encode(
            '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1"/></svg>'
        );

        $request = new \WP_REST_Request('POST', '/pf/v1/templates/import');
        $request->set_header('Content-Type', 'application/json');
        $request->set_body(wp_json_encode($data));
        $response = $this->server->dispatch($request);
        $this->assertEquals(201, $response->get_status());
        $new_id = (int) $response->get_data()['id'];
        $this->created_ids[] = $new_id;

        $imported = $this->repo->get($new_id);
        $uploads  = wp_upload_dir();
        $url  = $imported['views'][0]['background_url'];
        $path = str_replace($uploads['baseurl'], $uploads['basedir'], $url);
        $this->created_files[] = $path;
        $this->assertStringNotContainsString('<script', file_get_contents($path));
    }

    public function test_import_rejects_wrong_format(): void {
        $request = new \WP_REST_Request('POST', '/pf/v1/templates/import');
        $request->set_header('Content-Type', 'application/json');
        $request->set_body(wp_json_encode(['format' => 'something-else']));
        $response = $this->server->dispatch($request);
        $this->assertEquals(400, $response->get_status());
    }
}
