<?php
namespace ProductDesigner\API;

defined('ABSPATH') || exit;

use ProductDesigner\Database\DesignRepository;
use ProductDesigner\Database\TemplateRepository;
use ProductDesigner\Security\CapabilityChecker;

class RestDesigns {

    private DesignRepository $repo;
    private TemplateRepository $template_repo;

    public function __construct() {
        $this->repo          = new DesignRepository();
        $this->template_repo = new TemplateRepository();
    }

    /**
     * Strip internal sequential IDs from design data before sending to non-admin users.
     * CLAUDE.md rule 4: "Never expose sequential IDs — designs use CSPRNG hashes".
     */
    private function sanitize_for_customer(array $design): array {
        unset($design['id'], $design['template_id'], $design['customer_id'], $design['session_id']);
        if (!empty($design['views'])) {
            $design['views'] = array_map(function ($view) {
                unset($view['id'], $view['design_id']);
                return $view;
            }, $design['views']);
        }
        return $design;
    }

    /**
     * Verify the WP REST nonce is present and valid.
     * This prevents CSRF on write operations.
     */
    public function verify_nonce(\WP_REST_Request $request): bool {
        return (bool) wp_verify_nonce(
            $request->get_header('x-wp-nonce') ?? '',
            'wp_rest'
        );
    }

    public function register_routes(): void {
        $ns = 'pd/v1';

        register_rest_route($ns, '/designs', [
            ['methods' => 'POST', 'callback' => [$this, 'create_design'], 'permission_callback' => [$this, 'verify_nonce']],
        ]);

        register_rest_route($ns, '/designs/(?P<hash>[a-f0-9]{32})', [
            ['methods' => 'GET',    'callback' => [$this, 'get_design'],    'permission_callback' => '__return_true'],
            ['methods' => 'PUT',    'callback' => [$this, 'update_design'],  'permission_callback' => [$this, 'verify_nonce']],
            ['methods' => 'DELETE', 'callback' => [$this, 'delete_design'],  'permission_callback' => [$this, 'verify_nonce']],
        ]);

        register_rest_route($ns, '/designs/(?P<hash>[a-f0-9]{32})/views', [
            ['methods' => 'POST', 'callback' => [$this, 'upsert_view'], 'permission_callback' => [$this, 'verify_nonce']],
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

        $template = $this->template_repo->get((int) $body['template_id']);
        if (!$template || ($template['status'] ?? '') !== 'published') {
            return new \WP_Error('invalid_template', 'Template not found or not published.', ['status' => 400]);
        }

        $body['customer_id'] = get_current_user_id();
        $body['session_id']  = CapabilityChecker::current_session_id();

        $id = $this->repo->create($body);
        return new \WP_REST_Response($this->sanitize_for_customer($this->repo->get($id)), 201);
    }

    public function get_design(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $design = $this->repo->get_by_hash($request['hash']);
        if (!$design) {
            return new \WP_Error('not_found', 'Design not found.', ['status' => 404]);
        }
        if (!$this->owns_design($design)) {
            return new \WP_Error('forbidden', 'Access denied.', ['status' => 403]);
        }
        return rest_ensure_response($this->sanitize_for_customer($design));
    }

    public function update_design(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $design = $this->repo->get_by_hash($request['hash']);
        if (!$design) return new \WP_Error('not_found', 'Design not found.', ['status' => 404]);
        if (!$this->owns_design($design)) return new \WP_Error('forbidden', 'Access denied.', ['status' => 403]);

        $body = $request->get_json_params();
        if (!empty($body['status'])) {
            $this->repo->update_status((int) $design['id'], $body['status']);
            $design['status'] = $body['status'];
        }
        return rest_ensure_response($this->sanitize_for_customer($design));
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
        $thumb   = $body['thumbnail'] ?? '';

        // Save base64 thumbnail as a file
        $thumb_url = '';
        if (!empty($thumb) && str_starts_with($thumb, 'data:image/png;base64,')) {
            $thumb_url = $this->save_thumbnail_file($request['hash'], $view_id, $thumb);
        }

        $this->repo->upsert_view((int) $design['id'], $view_id, $json, $thumb_url);
        $this->repo->invalidate_cache($request['hash']);
        return new \WP_REST_Response($this->sanitize_for_customer($this->repo->get_by_hash($request['hash'])), 200);
    }

    private function save_thumbnail_file(string $hash, int $view_id, string $data_url): string {
        $upload_dir = wp_upload_dir();
        $pd_dir     = $upload_dir['basedir'] . '/pd-thumbnails';

        // Create directory if needed (wp_mkdir_p is safe to call if it already exists)
        wp_mkdir_p($pd_dir);

        // Protect directory from browsing
        if (!file_exists($pd_dir . '/index.php')) {
            file_put_contents($pd_dir . '/index.php', '<?php // Silence is golden.');
        }
        if (!file_exists($pd_dir . '/.htaccess')) {
            file_put_contents($pd_dir . '/.htaccess', 'Options -Indexes');
        }

        $base64  = str_replace('data:image/png;base64,', '', $data_url);

        // Cap base64 payload at ~5 MB decoded (≈6.67 MB base64) to prevent memory exhaustion
        if (strlen($base64) > 7_000_000) {
            return '';
        }

        $decoded = base64_decode($base64, true);
        if (!$decoded) {
            return '';
        }

        // Validate PNG magic bytes: \x89PNG\r\n\x1a\n
        if (strlen($decoded) < 8 || substr($decoded, 0, 8) !== "\x89PNG\r\n\x1a\n") {
            return '';
        }

        $filename = $hash . '-view-' . $view_id . '.png';
        $filepath = $pd_dir . '/' . $filename;

        if (file_put_contents($filepath, $decoded) === false) {
            return '';
        }

        return $upload_dir['baseurl'] . '/pd-thumbnails/' . $filename;
    }

    public function admin_list(\WP_REST_Request $request): \WP_REST_Response {
        $per_page = (int) ($request['per_page'] ?? 20);
        $page     = (int) ($request['page'] ?? 1);

        $rows  = $this->repo->list($per_page, $page);
        $total = $this->repo->count();

        $response = rest_ensure_response($rows);
        $response->header('X-WP-Total', $total);
        return $response;
    }

    public function admin_update_status(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $design = $this->repo->get_by_hash($request['hash']);
        if (!$design) return new \WP_Error('not_found', 'Design not found.', ['status' => 404]);

        $body = $request->get_json_params();
        $new_status = $body['status'] ?? 'draft';
        $this->repo->update_status((int) $design['id'], $new_status);
        $design['status'] = $new_status;
        return rest_ensure_response($design);
    }
}
