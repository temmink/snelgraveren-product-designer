<?php
use PHPUnit\Framework\TestCase;
use Snelgraveren\ProductDesigner\Database\TemplateRepository;
use Snelgraveren\ProductDesigner\Database\DesignRepository;

/**
 * POST /designs/{hash}/views as multipart/form-data.
 *
 * Why this exists: cPanel hosts run ModSecurity with SecRequestBodyNoFilesLimit
 * at 1 MiB. A view save that carried the 3x export PNG as a base64 string in
 * one JSON body blew through that as soon as the design held a photo, the host
 * bounced the POST, and WordPress answered the fallback GET with rest_no_route
 * (le-denhelder.nl, 2026-09-08). File parts fall under SecRequestBodyLimit
 * instead, so the client now sends every blob as a file. The JSON body stays
 * accepted for bundles still cached from before the change.
 */
class DesignViewMultipartTest extends TestCase {
    private $server;
    private TemplateRepository $template_repo;
    private DesignRepository $design_repo;
    private array $template_ids = [];
    private array $design_hashes = [];
    private array $tmp_files = [];

    // 1x1 transparent PNG
    private const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    protected function setUp(): void {
        global $wp_rest_server;
        $this->server        = $wp_rest_server = new \WP_REST_Server();
        do_action('rest_api_init');
        $this->template_repo = new TemplateRepository();
        $this->design_repo   = new DesignRepository();
        wp_set_current_user(1); // admin owns every design (edit_sgpd_templates)
    }

    private function create_design(): string {
        $template_id = $this->template_repo->create(['title' => 'Multipart ' . uniqid(), 'status' => 'published']);
        $this->template_ids[] = $template_id;
        $design_id = $this->design_repo->create(['template_id' => $template_id, 'customer_id' => 1, 'product_id' => 0]);
        $design    = $this->design_repo->get($design_id);
        $this->design_hashes[] = $design['design_hash'];
        return $design['design_hash'];
    }

    private function part(string $contents, string $type, string $name): array {
        $tmp = tempnam(sys_get_temp_dir(), 'sgpd');
        file_put_contents($tmp, $contents);
        $this->tmp_files[] = $tmp;
        return ['name' => $name, 'type' => $type, 'tmp_name' => $tmp, 'error' => UPLOAD_ERR_OK, 'size' => strlen($contents)];
    }

    private function post_multipart(string $hash, array $params, array $files): \WP_REST_Response {
        $request = new \WP_REST_Request('POST', '/pf/v1/designs/' . $hash . '/views');
        $request->set_header('X-WP-Nonce', wp_create_nonce('wp_rest'));
        $request->set_header('Content-Type', 'multipart/form-data; boundary=x');
        $request->set_body_params($params);
        $request->set_file_params($files);
        return rest_ensure_response($this->server->dispatch($request));
    }

    public function test_file_parts_are_stored_exactly_like_the_json_body_was(): void {
        $hash = $this->create_design();
        $png  = base64_decode(self::PNG_B64);
        $json = ['objects' => [['type' => 'IText', 'text' => 'hoi']], 'version' => '6.9.1'];

        $response = $this->post_multipart($hash, ['view_id' => 42], [
            'canvas_json'         => $this->part(wp_json_encode($json), 'application/json', 'canvas.json'),
            'thumbnail'           => $this->part($png, 'image/png', 'thumb.png'),
            'export_svg'          => $this->part($png, 'image/png', 'export.png'),
            'export_vector'       => $this->part('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1"/></svg>', 'image/svg+xml', 'v.svg'),
            'export_vector_embed' => $this->part('<svg xmlns="http://www.w3.org/2000/svg"><text>a</text></svg>', 'image/svg+xml', 'e.svg'),
        ]);
        $this->assertEquals(200, $response->get_status(), print_r($response->get_data(), true));

        $design = $this->design_repo->get_by_hash($hash);
        $views  = array_values(array_filter($design['views'], fn($v) => (int) $v['view_id'] === 42));
        $this->assertCount(1, $views, 'view 42 must exist');
        $view = $views[0];

        $stored_json = is_array($view['canvas_json']) ? $view['canvas_json'] : json_decode($view['canvas_json'], true);
        $this->assertSame('hoi', $stored_json['objects'][0]['text']);
        // The PNG file part lands in the column in the exact shape the JSON path stored: a data URL.
        $this->assertSame('data:image/png;base64,' . self::PNG_B64, $view['export_svg']);
        $this->assertStringContainsString('<path', $view['export_vector']);
        $this->assertStringContainsString('<text', $view['export_vector_embed']);
        $this->assertMatchesRegularExpression('#/pf-thumbnails/' . $hash . '-view-42\.png$#', (string) $view['thumbnail']);
    }

    public function test_json_body_is_still_accepted(): void {
        $hash    = $this->create_design();
        $request = new \WP_REST_Request('POST', '/pf/v1/designs/' . $hash . '/views');
        $request->set_header('X-WP-Nonce', wp_create_nonce('wp_rest'));
        $request->set_header('Content-Type', 'application/json');
        $request->set_body(wp_json_encode([
            'view_id'     => 5,
            'canvas_json' => ['objects' => []],
            'export_svg'  => 'data:image/png;base64,' . self::PNG_B64,
        ]));
        $response = $this->server->dispatch($request);
        $this->assertEquals(200, $response->get_status());
        $design = $this->design_repo->get_by_hash($hash);
        $views  = array_values(array_filter($design['views'], fn($v) => (int) $v['view_id'] === 5));
        $this->assertSame('data:image/png;base64,' . self::PNG_B64, $views[0]['export_svg']);
    }

    public function test_a_part_that_is_not_a_png_never_becomes_a_png_data_url(): void {
        $hash     = $this->create_design();
        $response = $this->post_multipart($hash, ['view_id' => 3], [
            'canvas_json' => $this->part(wp_json_encode(['objects' => []]), 'application/json', 'c.json'),
            'export_svg'  => $this->part('<?php echo 1;', 'image/png', 'evil.png'),
        ]);
        $this->assertEquals(200, $response->get_status());
        $design = $this->design_repo->get_by_hash($hash);
        $views  = array_values(array_filter($design['views'], fn($v) => (int) $v['view_id'] === 3));
        $this->assertSame('', (string) $views[0]['export_svg']);
    }

    public function test_an_empty_request_is_refused_instead_of_writing_an_empty_view(): void {
        // PHP drops BOTH $_POST and $_FILES when post_max_size is exceeded; the
        // old code then upserted "view 0" with an empty canvas.
        $hash     = $this->create_design();
        $response = $this->post_multipart($hash, [], []);
        $this->assertEquals(400, $response->get_status());
        $this->assertSame('sgpd_empty_view_payload', $response->get_data()['code']);
        $design = $this->design_repo->get_by_hash($hash);
        $this->assertCount(0, $design['views'] ?? []);
    }

    protected function tearDown(): void {
        global $wp_rest_server;
        $wp_rest_server = null;
        foreach ($this->tmp_files as $f) { @unlink($f); }
        foreach ($this->design_hashes as $hash) {
            $design = $this->design_repo->get_by_hash($hash);
            if ($design) $this->design_repo->delete((int) $design['id']);
        }
        foreach ($this->template_ids as $id) { $this->template_repo->delete($id); }
    }
}
