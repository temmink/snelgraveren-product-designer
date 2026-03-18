<?php
namespace ProductDesigner\API;

defined('ABSPATH') || exit;

use ProductDesigner\Database\DesignRepository;
use ProductDesigner\Database\TemplateRepository;
use ProductDesigner\Security\CapabilityChecker;

class RestDesigns {

    private DesignRepository $repo;

    public function __construct() {
        $this->repo = new DesignRepository();
    }

    public function register_routes(): void {
        $ns = 'pd/v1';

        register_rest_route($ns, '/designs', [
            ['methods' => 'POST', 'callback' => [$this, 'create_design'], 'permission_callback' => '__return_true'],
        ]);

        register_rest_route($ns, '/designs/(?P<hash>[a-f0-9]{32})', [
            ['methods' => 'GET',    'callback' => [$this, 'get_design'],    'permission_callback' => '__return_true'],
            ['methods' => 'PUT',    'callback' => [$this, 'update_design'],  'permission_callback' => '__return_true'],
            ['methods' => 'DELETE', 'callback' => [$this, 'delete_design'],  'permission_callback' => '__return_true'],
        ]);

        register_rest_route($ns, '/designs/(?P<hash>[a-f0-9]{32})/views', [
            ['methods' => 'POST', 'callback' => [$this, 'upsert_view'], 'permission_callback' => '__return_true'],
        ]);

        // Admin-only: list all designs
        register_rest_route($ns, '/admin/designs', [
            ['methods' => 'GET', 'callback' => [$this, 'admin_list'], 'permission_callback' => [$this, 'admin_permission']],
        ]);

        register_rest_route($ns, '/admin/designs/(?P<hash>[a-f0-9]{32})/status', [
            ['methods' => 'PUT', 'callback' => [$this, 'admin_update_status'], 'permission_callback' => [$this, 'admin_permission']],
        ]);
    }

    public function admin_permission(): bool {
        return current_user_can('edit_pd_templates');
    }

    private function owns_design(array $design): bool {
        $user_id    = get_current_user_id();
        $session_id = CapabilityChecker::current_session_id();

        if ($user_id && (int) $design['customer_id'] === $user_id) return true;
        if (!empty($session_id) && $design['session_id'] === $session_id) return true;
        if (current_user_can('edit_pd_templates')) return true;
        return false;
    }

    public function create_design(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $body = $request->get_json_params();
        if (empty($body['template_id'])) {
            return new \WP_Error('missing_template', 'template_id is required.', ['status' => 400]);
        }

        $template_repo = new TemplateRepository();
        $template = $template_repo->get((int) $body['template_id']);
        if (!$template || ($template['status'] ?? '') !== 'published') {
            return new \WP_Error('invalid_template', 'Template not found or not published.', ['status' => 400]);
        }

        $body['customer_id'] = get_current_user_id();
        $body['session_id']  = CapabilityChecker::current_session_id();

        $id = $this->repo->create($body);
        return new \WP_REST_Response($this->repo->get($id), 201);
    }

    public function get_design(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $design = $this->repo->get_by_hash($request['hash']);
        if (!$design) {
            return new \WP_Error('not_found', 'Design not found.', ['status' => 404]);
        }
        if (!$this->owns_design($design)) {
            return new \WP_Error('forbidden', 'Access denied.', ['status' => 403]);
        }
        return rest_ensure_response($design);
    }

    public function update_design(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $design = $this->repo->get_by_hash($request['hash']);
        if (!$design) return new \WP_Error('not_found', 'Design not found.', ['status' => 404]);
        if (!$this->owns_design($design)) return new \WP_Error('forbidden', 'Access denied.', ['status' => 403]);

        $body = $request->get_json_params();
        if (!empty($body['status'])) {
            $this->repo->update_status((int) $design['id'], $body['status']);
        }
        return rest_ensure_response($this->repo->get_by_hash($request['hash']));
    }

    public function delete_design(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $design = $this->repo->get_by_hash($request['hash']);
        if (!$design) return new \WP_Error('not_found', 'Design not found.', ['status' => 404]);
        if (!$this->owns_design($design)) return new \WP_Error('forbidden', 'Access denied.', ['status' => 403]);

        $this->repo->delete((int) $design['id']);
        return new \WP_REST_Response(null, 204);
    }

    public function upsert_view(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $design = $this->repo->get_by_hash($request['hash']);
        if (!$design) return new \WP_Error('not_found', 'Design not found.', ['status' => 404]);
        if (!$this->owns_design($design)) return new \WP_Error('forbidden', 'Access denied.', ['status' => 403]);

        $body    = $request->get_json_params();
        $view_id = (int) ($body['view_id'] ?? 0);
        $json    = $body['canvas_json'] ?? [];
        $thumb   = sanitize_text_field($body['thumbnail'] ?? '');

        $this->repo->upsert_view((int) $design['id'], $view_id, $json, $thumb);
        return new \WP_REST_Response($this->repo->get_by_hash($request['hash']), 200);
    }

    public function admin_list(\WP_REST_Request $request): \WP_REST_Response {
        global $wpdb;
        $table    = $wpdb->prefix . 'pd_designs';
        $per_page = (int) ($request['per_page'] ?? 20);
        $page     = (int) ($request['page'] ?? 1);
        $offset   = ($page - 1) * $per_page;

        $rows  = $wpdb->get_results(
            $wpdb->prepare("SELECT * FROM {$table} ORDER BY created_at DESC LIMIT %d OFFSET %d", $per_page, $offset),
            ARRAY_A
        ) ?: [];
        $total = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$table}");

        $response = rest_ensure_response($rows);
        $response->header('X-WP-Total', $total);
        return $response;
    }

    public function admin_update_status(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $design = $this->repo->get_by_hash($request['hash']);
        if (!$design) return new \WP_Error('not_found', 'Design not found.', ['status' => 404]);

        $body = $request->get_json_params();
        $this->repo->update_status((int) $design['id'], $body['status'] ?? 'draft');
        return rest_ensure_response($this->repo->get_by_hash($request['hash']));
    }
}
