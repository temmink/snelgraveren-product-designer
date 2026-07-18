<?php
namespace ProductForge\API;

defined('ABSPATH') || exit;

use ProductForge\Database\DesignTemplateRepository;
use ProductForge\Security\DesignTemplateValidator;

class RestDesignTemplates {

    public function register_routes(): void {
        // List design templates (nonce required — used by frontend designer)
        register_rest_route('pf/v1', '/design-templates', [
            'methods'             => 'GET',
            'callback'            => [$this, 'list_templates'],
            'permission_callback' => '__return_true',
        ]);

        // Get single design template with views (nonce required)
        register_rest_route('pf/v1', '/design-templates/(?P<id>\d+)', [
            'methods'             => 'GET',
            'callback'            => [$this, 'get_template'],
            'permission_callback' => '__return_true',
        ]);

        // Admin: create design template
        register_rest_route('pf/v1', '/design-templates', [
            'methods'             => 'POST',
            'callback'            => [$this, 'create_template'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // Admin: update design template
        register_rest_route('pf/v1', '/design-templates/(?P<id>\d+)', [
            'methods'             => 'PUT',
            'callback'            => [$this, 'update_template'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // Admin: delete design template
        register_rest_route('pf/v1', '/design-templates/(?P<id>\d+)', [
            'methods'             => 'DELETE',
            'callback'            => [$this, 'delete_template'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // Admin: import design template from JSON
        register_rest_route('pf/v1', '/design-templates/import', [
            'methods'             => 'POST',
            'callback'            => [$this, 'import_template'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // Admin: export design template as JSON
        register_rest_route('pf/v1', '/design-templates/(?P<id>\d+)/export', [
            'methods'             => 'GET',
            'callback'            => [$this, 'export_template'],
            'permission_callback' => [$this, 'can_edit'],
        ]);
    }

    public function can_edit(): bool {
        return current_user_can('edit_pf_templates');
    }

    public function list_templates(\WP_REST_Request $request): \WP_REST_Response {
        $status = sanitize_text_field($request->get_param('status') ?? 'active');
        // Only users who can manage templates may request a non-published
        // status (e.g. to see archived design templates in the admin UI).
        // Everyone else — guest customers included, since this endpoint is
        // public — only ever sees published ("active") design templates,
        // regardless of what status they pass in the query string.
        if (!$this->can_edit()) {
            $status = 'active';
        }
        $template_id = $request->get_param('template_id');
        $ids_param   = $request->get_param('ids');

        $template_id = $template_id !== null ? (int) $template_id : null;
        $ids         = null;

        if ($ids_param) {
            $ids = array_map('intval', explode(',', sanitize_text_field($ids_param)));
            $ids = array_filter($ids, fn($id) => $id > 0);
        }

        $rows = DesignTemplateRepository::list($status, $template_id, $ids);

        foreach ($rows as &$row) {
            $row['id']          = (int) $row['id'];
            $row['template_id'] = $row['template_id'] !== null ? (int) $row['template_id'] : null;
        }

        return rest_ensure_response($rows);
    }

    public function get_template(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $id  = (int) $request['id'];
        $row = DesignTemplateRepository::get($id);

        if (!$row) {
            return new \WP_Error('not_found', 'Design template not found.', ['status' => 404]);
        }

        // This endpoint is public (guest customers load design templates in
        // the frontend designer). Non-published ("active") design templates
        // are only visible to users who can manage them — everyone else gets
        // the same 404 as a genuinely missing template, so drafts/archived
        // templates never leak their existence or content.
        if (($row['status'] ?? '') !== 'active' && !$this->can_edit()) {
            return new \WP_Error('not_found', 'Design template not found.', ['status' => 404]);
        }

        $row['id']          = (int) $row['id'];
        $row['template_id'] = $row['template_id'] !== null ? (int) $row['template_id'] : null;

        foreach ($row['views'] as &$view) {
            $view['id']                 = (int) $view['id'];
            $view['design_template_id'] = (int) $view['design_template_id'];
            $view['view_index']         = (int) $view['view_index'];
        }

        return rest_ensure_response($row);
    }

    public function create_template(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $name = sanitize_text_field($request->get_param('name') ?? '');
        if (empty($name)) {
            return new \WP_Error('no_name', 'Design template name is required.', ['status' => 400]);
        }

        $data = [
            'name'          => $name,
            'category'      => sanitize_text_field($request->get_param('category') ?? ''),
            'thumbnail_url' => esc_url_raw($request->get_param('thumbnail_url') ?? ''),
            'template_id'   => $request->get_param('template_id') !== null ? (int) $request->get_param('template_id') : null,
            'status'        => sanitize_text_field($request->get_param('status') ?? 'active'),
        ];

        $views = $request->get_param('views');
        if (is_array($views)) {
            $data['views'] = $views;
        }

        $id = DesignTemplateRepository::create($data);

        return new \WP_REST_Response([
            'id'   => $id,
            'name' => $data['name'],
        ], 201);
    }

    public function update_template(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $id = (int) $request['id'];

        $data = [];
        foreach (['name', 'category', 'status'] as $field) {
            $val = $request->get_param($field);
            if ($val !== null) {
                $data[$field] = sanitize_text_field($val);
            }
        }

        $thumbnail = $request->get_param('thumbnail_url');
        if ($thumbnail !== null) {
            $data['thumbnail_url'] = esc_url_raw($thumbnail);
        }

        $template_id = $request->get_param('template_id');
        if ($template_id !== null) {
            $data['template_id'] = (int) $template_id;
        }

        $views = $request->get_param('views');
        if (is_array($views)) {
            $data['views'] = $views;
        }

        $ok = DesignTemplateRepository::update($id, $data);
        if (!$ok) {
            return new \WP_Error('not_found', 'Design template not found.', ['status' => 404]);
        }

        return rest_ensure_response(['id' => $id, 'updated' => true]);
    }

    public function delete_template(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $id = (int) $request['id'];
        $ok = DesignTemplateRepository::delete($id);

        if (!$ok) {
            return new \WP_Error('not_found', 'Design template not found.', ['status' => 404]);
        }

        return new \WP_REST_Response(null, 204);
    }

    public function import_template(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $json_string = $request->get_body();
        if (empty($json_string)) {
            return new \WP_Error('no_body', 'Request body is required.', ['status' => 400]);
        }

        $validator = new DesignTemplateValidator();
        $data      = $validator->validate_import($json_string);

        if ($data === false) {
            return new \WP_Error('invalid_import', 'Invalid design template JSON.', ['status' => 400]);
        }

        $id = DesignTemplateRepository::create([
            'name'          => sanitize_text_field($data['name']),
            'category'      => sanitize_text_field($data['category'] ?? ''),
            'thumbnail_url' => esc_url_raw($data['thumbnail_url'] ?? ''),
            'template_id'   => isset($data['template_id']) ? (int) $data['template_id'] : null,
            'status'        => 'active',
            'views'         => $data['views'] ?? [],
        ]);

        return new \WP_REST_Response([
            'id'   => $id,
            'name' => $data['name'],
        ], 201);
    }

    public function export_template(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $id  = (int) $request['id'];
        $row = DesignTemplateRepository::get($id);

        if (!$row) {
            return new \WP_Error('not_found', 'Design template not found.', ['status' => 404]);
        }

        // Build export structure
        $export = [
            'name'          => $row['name'],
            'category'      => $row['category'],
            'thumbnail_url' => $row['thumbnail_url'],
            'template_id'   => $row['template_id'] !== null ? (int) $row['template_id'] : null,
            'views'         => array_map(function ($view) {
                return [
                    'view_index'  => (int) $view['view_index'],
                    'canvas_json' => $view['canvas_json'],
                ];
            }, $row['views']),
        ];

        return rest_ensure_response($export);
    }
}
