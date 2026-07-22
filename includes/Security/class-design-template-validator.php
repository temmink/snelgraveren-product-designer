<?php
namespace ProductForge\Security;

defined('ABSPATH') || exit;

class DesignTemplateValidator {

    private const ALLOWED_TYPES = [
        'IText', 'i-text',
        'Image', 'image',
        'Path', 'path',
        'Group', 'group',
        'Rect', 'rect',
        'Circle', 'circle',
        'Textbox', 'textbox',
    ];

    private const MAX_IMPORT_SIZE = 5 * 1024 * 1024; // 5MB

    /**
     * Filter each view's canvas_json down to whitelisted Fabric object types.
     *
     * Design-template canvas JSON is served to every (guest) customer who
     * applies the template in the designer, so it must never carry object
     * types outside the whitelist — regardless of whether it arrived via the
     * JSON import (validate_import) or the regular create/update endpoints.
     * Accepts canvas_json per view as an array or a JSON string and returns it
     * in the same form.
     *
     * @param array $views
     * @return array
     */
    public function sanitize_views(array $views): array {
        foreach ($views as &$view) {
            if (!is_array($view)) {
                continue;
            }
            $canvas     = $view['canvas_json'] ?? null;
            $was_string = is_string($canvas);
            if ($was_string) {
                $canvas = json_decode($canvas, true);
            }
            if (is_array($canvas) && isset($canvas['objects']) && is_array($canvas['objects'])) {
                $canvas['objects'] = array_values(array_filter($canvas['objects'], function ($obj) {
                    return isset($obj['type']) && in_array($obj['type'], self::ALLOWED_TYPES, true);
                }));
                $view['canvas_json'] = $was_string ? wp_json_encode($canvas) : $canvas;
            }
        }
        unset($view);
        return $views;
    }

    /**
     * Validate and sanitize an imported design template JSON string.
     *
     * @return array|false Sanitized data or false on failure.
     */
    public function validate_import(string $json_string): array|false {
        if (strlen($json_string) > self::MAX_IMPORT_SIZE) {
            return false;
        }

        $data = json_decode($json_string, true);
        if (!$data || !isset($data['name'])) {
            return false;
        }

        $views = $data['views'] ?? [];
        foreach ($views as &$view) {
            $canvas = $view['canvas_json'] ?? $view;
            if (is_string($canvas)) {
                $canvas = json_decode($canvas, true);
            }
            if (!is_array($canvas) || !isset($canvas['objects']) || !is_array($canvas['objects'])) {
                continue;
            }

            $canvas['objects'] = array_values(array_filter($canvas['objects'], function ($obj) {
                return isset($obj['type']) && in_array($obj['type'], self::ALLOWED_TYPES, true);
            }));

            foreach ($canvas['objects'] as &$obj) {
                if (isset($obj['src'])) {
                    $validated = $this->validate_url($obj['src']);
                    if ($validated === false) {
                        unset($obj['src']);
                    } else {
                        $obj['src'] = $validated;
                    }
                }
            }

            $view['canvas_json'] = $canvas;
        }

        $data['views'] = $views;

        return $data;
    }

    /**
     * Validate a URL: only allow relative paths or same-origin URLs.
     */
    private function validate_url(string $url): string|false {
        // Allow relative paths
        if (str_starts_with($url, '/')) {
            return $url;
        }

        // Allow same-origin URLs
        $site_host = wp_parse_url(site_url(), PHP_URL_HOST);
        $url_host  = wp_parse_url($url, PHP_URL_HOST);

        if ($url_host === $site_host) {
            return $url;
        }

        return false;
    }
}
