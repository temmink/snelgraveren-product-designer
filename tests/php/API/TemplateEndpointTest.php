<?php
use PHPUnit\Framework\TestCase;
use ProductForge\Database\TemplateRepository;

class TemplateEndpointTest extends TestCase {
    private $server;
    private TemplateRepository $repo;
    private array $created_ids = [];

    protected function setUp(): void {
        global $wp_rest_server;
        $this->server = $wp_rest_server = new \WP_REST_Server();
        do_action('rest_api_init');
        $this->repo = new TemplateRepository();
    }

    public function test_list_templates_requires_admin(): void {
        wp_set_current_user(0);
        $request  = new \WP_REST_Request('GET', '/pf/v1/templates');
        $response = $this->server->dispatch($request);
        // WP REST returns 401 for unauthenticated and 403 for authenticated-but-unauthorized
        $this->assertContains($response->get_status(), [401, 403]);
    }

    public function test_create_template_requires_admin(): void {
        wp_set_current_user(0);
        $request = new \WP_REST_Request('POST', '/pf/v1/templates');
        $request->set_header('Content-Type', 'application/json');
        $request->set_body(json_encode(['title' => 'Unauthorized Test', 'status' => 'draft']));
        $response = $this->server->dispatch($request);
        // WP REST returns 401 for unauthenticated and 403 for authenticated-but-unauthorized
        $this->assertContains($response->get_status(), [401, 403]);
    }

    public function test_admin_can_list_templates(): void {
        wp_set_current_user(1);
        $request  = new \WP_REST_Request('GET', '/pf/v1/templates');
        $response = $this->server->dispatch($request);
        $this->assertContains($response->get_status(), [200, 204]);
    }

    public function test_admin_can_create_template(): void {
        wp_set_current_user(1);
        $request = new \WP_REST_Request('POST', '/pf/v1/templates');
        $request->set_header('Content-Type', 'application/json');
        $request->set_body(json_encode([
            'title'  => 'API Test Template ' . uniqid(),
            'status' => 'draft',
        ]));
        $response = $this->server->dispatch($request);
        $data     = $response->get_data();
        $this->assertEquals(201, $response->get_status());
        $this->assertArrayHasKey('id', $data);
        $this->created_ids[] = (int) $data['id'];
    }

    public function test_create_template_requires_title(): void {
        wp_set_current_user(1);
        $request = new \WP_REST_Request('POST', '/pf/v1/templates');
        $request->set_header('Content-Type', 'application/json');
        $request->set_body(json_encode(['status' => 'draft']));
        $response = $this->server->dispatch($request);
        $this->assertEquals(400, $response->get_status());
    }

    public function test_list_returns_pagination_headers(): void {
        wp_set_current_user(1);
        $request = new \WP_REST_Request('GET', '/pf/v1/templates');
        $request->set_param('per_page', 5);
        $request->set_param('page', 1);
        $response = $this->server->dispatch($request);
        $headers  = $response->get_headers();
        $this->assertArrayHasKey('X-WP-Total', $headers);
        $this->assertArrayHasKey('X-WP-TotalPages', $headers);
    }

    public function test_get_template_not_found_returns_404(): void {
        wp_set_current_user(1);
        $request  = new \WP_REST_Request('GET', '/pf/v1/templates/999999');
        $response = $this->server->dispatch($request);
        $this->assertEquals(404, $response->get_status());
    }

    public function test_admin_can_get_template(): void {
        wp_set_current_user(1);
        // Create a template first
        $id = $this->repo->create([
            'title'  => 'Get Test ' . uniqid(),
            'status' => 'draft',
        ]);
        $this->created_ids[] = $id;

        $request  = new \WP_REST_Request('GET', '/pf/v1/templates/' . $id);
        $response = $this->server->dispatch($request);
        $this->assertEquals(200, $response->get_status());
        $data = $response->get_data();
        $this->assertEquals($id, (int) $data['id']);
    }

    public function test_public_template_endpoint_returns_404_for_draft(): void {
        // Create a draft template
        $id = $this->repo->create([
            'title'  => 'Draft Public Test ' . uniqid(),
            'status' => 'draft',
        ]);
        $this->created_ids[] = $id;

        wp_set_current_user(0);
        $request  = new \WP_REST_Request('GET', '/pf/v1/templates/' . $id . '/public');
        $response = $this->server->dispatch($request);
        // Draft templates are not publicly accessible
        $this->assertEquals(404, $response->get_status());
    }

    public function test_public_template_endpoint_returns_published(): void {
        wp_set_current_user(1);
        // Create a published template
        $id = $this->repo->create([
            'title'  => 'Published Public Test ' . uniqid(),
            'status' => 'published',
        ]);
        $this->created_ids[] = $id;

        wp_set_current_user(0);
        $request  = new \WP_REST_Request('GET', '/pf/v1/templates/' . $id . '/public');
        $response = $this->server->dispatch($request);
        $this->assertEquals(200, $response->get_status());
        $data = $response->get_data();
        $this->assertArrayHasKey('id', $data);
        $this->assertArrayHasKey('views', $data);
    }

    protected function tearDown(): void {
        global $wp_rest_server;
        $wp_rest_server = null;
        foreach ($this->created_ids as $id) {
            $this->repo->delete($id);
        }
    }
}
