<?php
namespace ProductForge\API;

defined('ABSPATH') || exit;

use ProductForge\Database\TemplateRepository;

class RestTemplates {

    private TemplateRepository $repo;

    public function __construct() {
        $this->repo = new TemplateRepository();
    }

    public function register_routes(): void {
        $ns = 'pf/v1';

        register_rest_route($ns, '/templates', [
            ['methods' => 'GET',  'callback' => [$this, 'list_templates'],   'permission_callback' => [$this, 'admin_permission']],
            ['methods' => 'POST', 'callback' => [$this, 'create_template'],  'permission_callback' => [$this, 'admin_permission']],
        ]);

        register_rest_route($ns, '/templates/(?P<id>\d+)', [
            ['methods' => 'GET',    'callback' => [$this, 'get_template'],    'permission_callback' => [$this, 'admin_permission']],
            ['methods' => 'PUT',    'callback' => [$this, 'update_template'], 'permission_callback' => [$this, 'admin_permission']],
            ['methods' => 'DELETE', 'callback' => [$this, 'delete_template'], 'permission_callback' => [$this, 'admin_permission']],
        ]);

        register_rest_route($ns, '/templates/(?P<id>\d+)/duplicate', [
            ['methods' => 'POST', 'callback' => [$this, 'duplicate_template'], 'permission_callback' => [$this, 'admin_permission']],
        ]);

        register_rest_route($ns, '/templates/(?P<id>\d+)/public', [
            ['methods' => 'GET', 'callback' => [$this, 'get_public_template'], 'permission_callback' => '__return_true'],
        ]);

        register_rest_route($ns, '/templates/(?P<template_id>\d+)/views', [
            ['methods' => 'GET',  'callback' => [$this, 'list_views'],  'permission_callback' => [$this, 'admin_permission']],
            ['methods' => 'POST', 'callback' => [$this, 'create_view'], 'permission_callback' => [$this, 'admin_permission']],
        ]);

        register_rest_route($ns, '/templates/(?P<template_id>\d+)/views/(?P<view_id>\d+)', [
            ['methods' => 'PUT',    'callback' => [$this, 'update_view'], 'permission_callback' => [$this, 'admin_permission']],
            ['methods' => 'DELETE', 'callback' => [$this, 'delete_view'], 'permission_callback' => [$this, 'admin_permission']],
        ]);
    }

    public function admin_permission(): bool {
        return current_user_can('edit_sgpd_templates');
    }

    public function list_templates(\WP_REST_Request $request): \WP_REST_Response {
        $per_page = (int) ($request['per_page'] ?? 20);
        $page     = (int) ($request['page'] ?? 1);
        $status   = sanitize_text_field($request['status'] ?? '');

        $templates = $this->repo->list($per_page, $page, $status);
        $total     = $this->repo->count($status);

        $template_ids = array_column($templates, 'id');
        $view_counts  = $this->repo->count_views_batch(array_map('intval', $template_ids));

        foreach ($templates as &$t) {
            $t['global_config'] = json_decode($t['global_config'], true) ?: [];
            $t['view_count']    = $view_counts[(int) $t['id']] ?? 0;
        }
        unset($t);

        $response = rest_ensure_response($templates);
        $response->header('X-WP-Total', $total);
        $response->header('X-WP-TotalPages', (int) ceil($total / $per_page));
        return $response;
    }

    public function create_template(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $body = $request->get_json_params();
        if (empty($body['title'])) {
            return new \WP_Error('missing_title', 'Title is required.', ['status' => 400]);
        }
        $id = $this->repo->create($body);
        if (!$id) {
            return new \WP_Error('create_failed', 'Failed to create template.', ['status' => 500]);
        }
        $template = $this->repo->get($id);
        return new \WP_REST_Response($template, 201);
    }

    public function get_template(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $template = $this->repo->get((int) $request['id']);
        if (!$template) {
            return new \WP_Error('not_found', 'Template not found.', ['status' => 404]);
        }
        return rest_ensure_response($template);
    }

    public function update_template(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $id   = (int) $request['id'];
        $body = $request->get_json_params();

        if (!$this->repo->get($id)) {
            return new \WP_Error('not_found', 'Template not found.', ['status' => 404]);
        }
        $this->repo->update($id, $body);
        return rest_ensure_response($this->repo->get($id));
    }

    public function delete_template(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $id = (int) $request['id'];
        $template = $this->repo->get($id);
        if (!$template) {
            return new \WP_Error('not_found', 'Template not found.', ['status' => 404]);
        }
        $force = filter_var($request->get_param('force'), FILTER_VALIDATE_BOOLEAN);
        if ($force) {
            $this->repo->delete($id);
        } else {
            $this->repo->trash($id);
        }
        return new \WP_REST_Response(null, 204);
    }

    public function duplicate_template(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $new_id = $this->repo->duplicate((int) $request['id']);
        if (!$new_id) {
            return new \WP_Error('not_found', 'Template not found.', ['status' => 404]);
        }
        return new \WP_REST_Response($this->repo->get($new_id), 201);
    }

    public function get_public_template(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $template = $this->repo->get((int) $request['id']);
        if (!$template || ($template['status'] ?? '') !== 'published') {
            return new \WP_Error('not_found', 'Template not found.', ['status' => 404]);
        }

        $views = $this->repo->get_views((int) $template['id']);
        $sanitized_views = array_map(function ($v) {
            return [
                'id'              => (int) $v['id'],
                'name'            => $v['name'] ?? '',
                'canvas_width'    => (int) ($v['canvas_width'] ?? 800),
                'canvas_height'   => (int) ($v['canvas_height'] ?? 600),
                'background_url'       => $v['background_url'] ?? '',
                'background_transform' => $v['background_transform'] ?? new \stdClass(),
                'zones_config'    => $v['zones_config'] ?? [],
                'layers_config'   => $v['layers_config'] ?? [],
            ];
        }, $views);

        $global_config = $template['global_config'] ?? '{}';
        if (is_string($global_config)) {
            $global_config = json_decode($global_config, true) ?: [];
        }

        // Migrate legacy single color picker to split product/element pickers
        if (!isset($global_config['product_colors_enabled']) && !isset($global_config['element_colors_enabled'])) {
            $enabled    = $global_config['colors_enabled'] ?? false;
            $mode       = $global_config['color_mode'] ?? 'individual';
            $palette_id = $global_config['color_palette_id'] ?? '';
            $colors     = $global_config['allowed_colors'] ?? [];

            $global_config['product_colors_enabled']   = $enabled;
            $global_config['product_color_mode']       = $mode;
            $global_config['product_color_palette_id'] = $palette_id;
            $global_config['product_allowed_colors']   = $colors;

            $global_config['element_colors_enabled']   = $enabled;
            $global_config['element_color_mode']       = $mode;
            $global_config['element_color_palette_id'] = $palette_id;
            $global_config['element_allowed_colors']   = $colors;
        }

        // Resolve both color pickers to flat arrays for the frontend
        $palettes = get_option('sgpd_color_palettes', []);

        foreach (['product', 'element'] as $prefix) {
            $mode       = $global_config["{$prefix}_color_mode"] ?? 'individual';
            $palette_id = $global_config["{$prefix}_color_palette_id"] ?? '';

            if ($mode === 'all') {
                $global_config["{$prefix}_any_color"]      = true;
                $global_config["{$prefix}_allowed_colors"] = [];
            } elseif ($mode === 'palette') {
                $resolved = [];
                foreach ($palettes as $p) {
                    if (($p['id'] ?? '') === $palette_id) {
                        $resolved = $p['colors'] ?? [];
                        break;
                    }
                }
                $global_config["{$prefix}_allowed_colors"] = $resolved;
                $global_config["{$prefix}_any_color"]      = false;
            } else {
                // individual mode — allowed_colors already set
                $global_config["{$prefix}_any_color"] = false;
            }

            // Remove internal fields from public response
            unset($global_config["{$prefix}_color_mode"], $global_config["{$prefix}_color_palette_id"]);
        }

        // Also set legacy fields for backwards compatibility with older frontend cache
        $global_config['any_color']      = $global_config['product_any_color'] ?? false;
        $global_config['allowed_colors'] = $global_config['product_allowed_colors'] ?? [];

        // Remove legacy internal fields
        unset($global_config['color_mode'], $global_config['color_palette_id']);

        $response = rest_ensure_response([
            'id'            => (int) $template['id'],
            'title'         => $template['title'],
            'global_config' => $global_config,
            'views'         => $sanitized_views,
        ]);
        // Prevent caching by LiteSpeed / CDN / browser so edits appear immediately.
        $response->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        return $response;
    }

    public function list_views(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $template_id = (int) $request['template_id'];
        $template = $this->repo->get($template_id);
        if (!$template) {
            return new \WP_Error('not_found', 'Template not found.', ['status' => 404]);
        }
        // Views are already loaded by get() — avoid redundant query
        return rest_ensure_response($template['views'] ?? $this->repo->get_views($template_id));
    }

    public function create_view(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $template_id = (int) $request['template_id'];

        if (!$this->repo->get($template_id)) {
            return new \WP_Error('not_found', 'Template not found.', ['status' => 404]);
        }
        $body = $request->get_json_params();
        $id   = $this->repo->create_view($template_id, $body);
        return new \WP_REST_Response($this->repo->get_view($template_id, $id), 201);
    }

    public function update_view(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $template_id = (int) $request['template_id'];
        $view_id     = (int) $request['view_id'];
        $view        = $this->repo->get_view($template_id, $view_id);
        if (!$view) {
            return new \WP_Error('not_found', 'View not found.', ['status' => 404]);
        }
        $this->repo->update_view($template_id, $view_id, $request->get_json_params());
        return rest_ensure_response($this->repo->get_view($template_id, $view_id));
    }

    public function delete_view(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $template_id = (int) $request['template_id'];
        $view_id     = (int) $request['view_id'];
        if (!$this->repo->get_view($template_id, $view_id)) {
            return new \WP_Error('not_found', 'View not found.', ['status' => 404]);
        }
        $this->repo->delete_view($template_id, $view_id);
        return new \WP_REST_Response(null, 204);
    }
}
