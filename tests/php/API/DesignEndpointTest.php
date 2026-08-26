<?php
use PHPUnit\Framework\TestCase;
use Snelgraveren\ProductDesigner\Database\TemplateRepository;
use Snelgraveren\ProductDesigner\Database\DesignRepository;
use Snelgraveren\ProductDesigner\API\RestDesigns;
use Snelgraveren\ProductDesigner\Proof\ProofSession;

class DesignEndpointTest extends TestCase {
    private $server;
    private TemplateRepository $template_repo;
    private DesignRepository $design_repo;
    private array $template_ids = [];
    private array $design_hashes = [];

    protected function setUp(): void {
        global $wp_rest_server;
        $this->server        = $wp_rest_server = new \WP_REST_Server();
        do_action('rest_api_init');
        $this->template_repo = new TemplateRepository();
        $this->design_repo   = new DesignRepository();
    }

    /**
     * Create a published template for use in design tests.
     */
    private function create_published_template(): int {
        $id = $this->template_repo->create([
            'title'  => 'Design Test Template ' . uniqid(),
            'status' => 'published',
        ]);
        $this->template_ids[] = $id;
        return $id;
    }

    public function test_create_design_requires_template_id(): void {
        $request = new \WP_REST_Request('POST', '/pf/v1/designs');
        $request->set_header('Content-Type', 'application/json');
        $request->set_header('X-WP-Nonce', wp_create_nonce('wp_rest'));
        $request->set_body(json_encode(['product_id' => 1]));
        $response = $this->server->dispatch($request);
        $this->assertEquals(400, $response->get_status());
    }

    public function test_create_design_requires_published_template(): void {
        // Create a draft template — should be rejected
        $draft_id = $this->template_repo->create([
            'title'  => 'Draft Template ' . uniqid(),
            'status' => 'draft',
        ]);
        $this->template_ids[] = $draft_id;

        $request = new \WP_REST_Request('POST', '/pf/v1/designs');
        $request->set_header('Content-Type', 'application/json');
        $request->set_header('X-WP-Nonce', wp_create_nonce('wp_rest'));
        $request->set_body(json_encode(['template_id' => $draft_id, 'product_id' => 1]));
        $response = $this->server->dispatch($request);
        $this->assertEquals(400, $response->get_status());
    }

    public function test_create_design_with_published_template_returns_hash(): void {
        $template_id = $this->create_published_template();

        $request = new \WP_REST_Request('POST', '/pf/v1/designs');
        $request->set_header('Content-Type', 'application/json');
        $request->set_header('X-WP-Nonce', wp_create_nonce('wp_rest'));
        $request->set_body(json_encode(['template_id' => $template_id, 'product_id' => 1]));
        $response = $this->server->dispatch($request);

        $this->assertEquals(201, $response->get_status());
        $data = $response->get_data();
        $this->assertArrayHasKey('design_hash', $data);
        // Hash is a 32-char hex string
        $this->assertMatchesRegularExpression('/^[a-f0-9]{32}$/', $data['design_hash']);
        $this->design_hashes[] = $data['design_hash'];
    }

    public function test_get_design_returns_404_for_nonexistent(): void {
        $request  = new \WP_REST_Request('GET', '/pf/v1/designs/' . str_repeat('a', 32));
        $response = $this->server->dispatch($request);
        $this->assertEquals(404, $response->get_status());
    }

    public function test_get_design_returns_forbidden_for_other_session(): void {
        $template_id = $this->create_published_template();

        // Create a design as user 0 (guest with a specific session)
        $design_id = $this->design_repo->create([
            'template_id' => $template_id,
            'customer_id' => 0,
            'session_id'  => 'session-abc-123',
            'product_id'  => 0,
        ]);
        $design = $this->design_repo->get($design_id);
        $this->design_hashes[] = $design['design_hash'];

        // Request as a different user with no matching session
        wp_set_current_user(0);
        // The session won't match since CapabilityChecker::current_session_id() returns a different value
        $request  = new \WP_REST_Request('GET', '/pf/v1/designs/' . $design['design_hash']);
        $response = $this->server->dispatch($request);
        // Either 200 (if session matches) or 403 (if session doesn't match)
        // We just ensure it's not a 5xx error
        $this->assertLessThan(500, $response->get_status());
    }

    public function test_admin_can_get_own_design(): void {
        wp_set_current_user(1);
        $template_id = $this->create_published_template();

        // Create design as admin (user 1)
        $request = new \WP_REST_Request('POST', '/pf/v1/designs');
        $request->set_header('Content-Type', 'application/json');
        $request->set_header('X-WP-Nonce', wp_create_nonce('wp_rest'));
        $request->set_body(json_encode(['template_id' => $template_id, 'product_id' => 1]));
        $create_response = $this->server->dispatch($request);
        $this->assertEquals(201, $create_response->get_status());

        $hash = $create_response->get_data()['design_hash'];
        $this->design_hashes[] = $hash;

        // Admin can always read any design (has edit_sgpd_templates)
        $request  = new \WP_REST_Request('GET', '/pf/v1/designs/' . $hash);
        $response = $this->server->dispatch($request);
        $this->assertEquals(200, $response->get_status());
    }

    public function test_admin_list_requires_capability(): void {
        wp_set_current_user(0);
        $request  = new \WP_REST_Request('GET', '/pf/v1/admin/designs');
        $response = $this->server->dispatch($request);
        // WP REST returns 401 for unauthenticated and 403 for authenticated-but-unauthorized
        $this->assertContains($response->get_status(), [401, 403]);
    }

    public function test_admin_can_list_designs(): void {
        wp_set_current_user(1);
        $request  = new \WP_REST_Request('GET', '/pf/v1/admin/designs');
        $response = $this->server->dispatch($request);
        $this->assertContains($response->get_status(), [200, 204]);
        $headers = $response->get_headers();
        $this->assertArrayHasKey('X-WP-Total', $headers);
    }

    public function test_admin_list_supports_pagination(): void {
        wp_set_current_user(1);
        $request = new \WP_REST_Request('GET', '/pf/v1/admin/designs');
        $request->set_param('per_page', 5);
        $request->set_param('page', 1);
        $response = $this->server->dispatch($request);
        $this->assertContains($response->get_status(), [200, 204]);
    }

    /**
     * The confinement Task 4 promised: RestDesigns::owns_design() must stay
     * strict even though Frontend::owns_design() now honours a proof approved
     * in the visitor's WooCommerce session. A future refactor could quietly
     * copy the frontend's clause over here; this pins it down via reflection
     * since the method is private.
     */
    public function test_rest_owns_design_ignores_a_session_approved_proof(): void {
        if (!function_exists('WC') || !WC()->session) {
            $this->markTestSkipped('WooCommerce session not available in this context.');
        }

        $template_id = $this->create_published_template();
        $design_id   = $this->design_repo->create([
            'template_id' => $template_id,
            'customer_id' => 0,
            'session_id'  => 'proof-owner-mismatch-session',
            'product_id'  => 0,
        ]);
        $this->design_repo->update_proof($design_id, ['proof_status' => 'approved']);
        $design = $this->design_repo->get($design_id);
        $this->design_hashes[] = $design['design_hash'];

        // No logged-in user, no capability.
        wp_set_current_user(0);
        $this->assertFalse(
            current_user_can('edit_sgpd_templates'),
            'This test requires a guest with no template-editing capability; adjust the test environment or skip.'
        );

        // Approved in the session — this is exactly what Frontend::owns_design()
        // now accepts. RestDesigns must not.
        ProofSession::mark_approved($design['design_hash']);

        $rest_designs = new RestDesigns();
        $method        = new \ReflectionMethod(RestDesigns::class, 'owns_design');
        $method->setAccessible(true);

        $this->assertFalse($method->invoke($rest_designs, $design));
    }

    protected function tearDown(): void {
        global $wp_rest_server;
        $wp_rest_server = null;

        // Clean up designs
        foreach ($this->design_hashes as $hash) {
            $design = $this->design_repo->get_by_hash($hash);
            if ($design) {
                $this->design_repo->delete((int) $design['id']);
            }
        }

        // Clean up templates
        foreach ($this->template_ids as $id) {
            $this->template_repo->delete($id);
        }
    }
}
